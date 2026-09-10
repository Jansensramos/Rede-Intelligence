import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import {
  applyMappingAndValidate,
  assertIntegrationCapability,
  buildPreview,
  parseImportFile,
  type FieldMappingRule,
  type ImportFormat,
} from "@/domain/integrations";
import { emitOperationalAlert } from "@/application/observability/operational-alerts";

type IntegrationContext = Pick<AuthContext, "organizationId" | "userId" | "role">;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const checksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function installationForTenant(organizationId: string, installationId: string) {
  const installation = await prisma.connectorInstallation.findFirst({ where: { id: installationId, organizationId } });
  if (!installation) throw new Error("Instalação de conector não encontrada nesta organização.");
  return installation;
}

/** Preview amostral: formato, colunas detectadas e primeiras linhas — sem persistir nada. */
export function previewImportFile(context: Pick<IntegrationContext, "role">, format: ImportFormat, content: string | Buffer) {
  assertIntegrationCapability(context.role, "INTEGRATION_CONFIGURE");
  return buildPreview(parseImportFile(format, content));
}

/**
 * Importador universal (plano §26): arquivo → preview → mapping → validação →
 * staging → erros por linha → import. Reaproveita `IntegrationSyncRun`/`IntegrationSyncItem`
 * (staging bem-sucedido) e `IntegrationQuarantineItem` (linhas rejeitadas) —
 * nenhuma tabela paralela de importação foi criada.
 */
export async function importUniversalFile(context: IntegrationContext, input: {
  installationId: string;
  capability: string;
  format: ImportFormat;
  content: string | Buffer;
  mapping: FieldMappingRule[];
}) {
  assertIntegrationCapability(context.role, "INTEGRATION_SYNC");
  const installation = await installationForTenant(context.organizationId, input.installationId);
  const parseReport = parseImportFile(input.format, input.content);
  const mappingReport = applyMappingAndValidate(parseReport.rows, input.mapping);
  const correlationId = randomUUID();

  const run = await prisma.integrationSyncRun.create({
    data: { organizationId: context.organizationId, installationId: installation.id, mode: "MANUAL", direction: installation.direction, status: "RUNNING", correlationId, triggeredById: context.userId },
  });

  for (const row of mappingReport.accepted) {
    await prisma.integrationSyncItem.create({
      data: { organizationId: context.organizationId, syncRunId: run.id, externalType: input.format, externalId: String(row.index), result: "APPLIED", checksum: checksum(row.data) },
    });
  }

  const rejectedRows = [...parseReport.structuralErrors, ...mappingReport.rejected];
  for (const rejection of rejectedRows) {
    await prisma.integrationSyncItem.create({
      data: { organizationId: context.organizationId, syncRunId: run.id, externalType: input.format, externalId: String(rejection.index), result: "QUARANTINED", errorMessage: rejection.message },
    });
    await prisma.integrationQuarantineItem.create({
      data: { organizationId: context.organizationId, installationId: installation.id, capability: input.capability, externalType: input.format, externalId: String(rejection.index), reason: rejection.message, errorClass: "VALIDATION", payload: json({ index: rejection.index }), status: "PENDING" },
    });
  }

  const applied = mappingReport.accepted.length;
  const errored = rejectedRows.length;
  const status = errored > 0 && applied === 0 ? "FAILED" : errored > 0 ? "PARTIAL" : "SUCCEEDED";
  const finished = await prisma.integrationSyncRun.update({
    where: { id: run.id },
    data: { status, finishedAt: new Date(), itemsRead: parseReport.rows.length, itemsApplied: applied, itemsErrored: errored },
  });
  // Um alerta por importação (não um por linha rejeitada) — evita tempestade quando
  // muitas linhas do mesmo arquivo caem em quarentena.
  if (errored > 0) {
    await emitOperationalAlert({ category: "QUARANTINE", severity: "warning", code: `IMPORT:${input.capability}`, organizationId: context.organizationId, correlationId });
  }
  await prisma.auditLog.create({
    data: { organizationId: context.organizationId, userId: context.userId, projectId: installation.projectId, action: "UNIVERSAL_IMPORT_COMPLETED", entityType: "IntegrationSyncRun", entityId: run.id, after: json({ format: input.format, applied, errored, status: finished.status }) },
  });

  return { run: finished, accepted: mappingReport.accepted, rejected: rejectedRows };
}
