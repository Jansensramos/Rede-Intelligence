import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { integrationSecretVault } from "@/infrastructure/security/local-secret-vault";
import {
  assertIntegrationCapability,
  assertSafeExternalUrl,
  calculateHealthScore,
  classifyInstallationState,
  hasIntegrationCapability,
  type IntegrationCapability,
  type IntegrationConnector,
} from "@/domain/integrations";

type IntegrationContext = Pick<AuthContext, "organizationId" | "userId" | "role">;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const checksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const CREDENTIAL_EXPIRY_WARNING_MS = 30 * 24 * 60 * 60 * 1000;

function requireCapability(context: Pick<IntegrationContext, "role">, capability: IntegrationCapability) {
  assertIntegrationCapability(context.role, capability);
}

const audit = (context: IntegrationContext, projectId: string | null, action: string, entityType: string, entityId: string, after?: unknown) => ({
  organizationId: context.organizationId,
  userId: context.userId,
  projectId,
  action,
  entityType,
  entityId,
  after: after === undefined ? undefined : json(after),
});

async function installationForTenant(organizationId: string, installationId: string) {
  const installation = await prisma.connectorInstallation.findFirst({ where: { id: installationId, organizationId } });
  if (!installation) throw new Error("Instalação de conector não encontrada nesta organização.");
  return installation;
}

export async function registerConnectorDefinition(input: {
  code: string;
  name: string;
  provider: string;
  category: Prisma.ConnectorDefinitionCreateInput["category"];
  authMethod: Prisma.ConnectorDefinitionCreateInput["authMethod"];
  capabilities: unknown;
  sourceOfTruthDefault?: unknown;
  adapterVersion: string;
  contractVersion: string;
  sandboxAvailable?: boolean;
  documentationUrl?: string | null;
}) {
  return prisma.connectorDefinition.upsert({
    where: { code: input.code },
    update: {
      name: input.name,
      provider: input.provider,
      category: input.category,
      authMethod: input.authMethod,
      capabilities: json(input.capabilities),
      sourceOfTruthDefault: input.sourceOfTruthDefault === undefined ? undefined : json(input.sourceOfTruthDefault),
      adapterVersion: input.adapterVersion,
      contractVersion: input.contractVersion,
      sandboxAvailable: input.sandboxAvailable ?? true,
      documentationUrl: input.documentationUrl ?? null,
    },
    create: {
      code: input.code,
      name: input.name,
      provider: input.provider,
      category: input.category,
      authMethod: input.authMethod,
      capabilities: json(input.capabilities),
      sourceOfTruthDefault: input.sourceOfTruthDefault === undefined ? undefined : json(input.sourceOfTruthDefault),
      adapterVersion: input.adapterVersion,
      contractVersion: input.contractVersion,
      sandboxAvailable: input.sandboxAvailable ?? true,
      documentationUrl: input.documentationUrl ?? null,
    },
  });
}

export async function createConnectorInstallation(context: IntegrationContext, input: {
  connectorDefinitionCode: string;
  name: string;
  direction: "INBOUND" | "OUTBOUND" | "BIDIRECTIONAL";
  economicGroupId?: string | null;
  companyId?: string | null;
  projectId?: string | null;
  configuration?: Record<string, unknown>;
}) {
  requireCapability(context, "INTEGRATION_CONFIGURE");
  const definition = await prisma.connectorDefinition.findUnique({ where: { code: input.connectorDefinitionCode } });
  if (!definition) throw new Error("Definição de conector não encontrada.");
  if (input.companyId) {
    const company = await prisma.company.findFirst({ where: { id: input.companyId, organizationId: context.organizationId } });
    if (!company) throw new Error("Empresa não encontrada nesta organização.");
  }
  if (input.projectId) {
    const project = await prisma.project.findFirst({ where: { id: input.projectId, organizationId: context.organizationId } });
    if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  }
  return prisma.$transaction(async (tx) => {
    const created = await tx.connectorInstallation.create({
      data: {
        organizationId: context.organizationId,
        connectorDefinitionId: definition.id,
        economicGroupId: input.economicGroupId ?? null,
        companyId: input.companyId ?? null,
        projectId: input.projectId ?? null,
        name: input.name,
        direction: input.direction,
        configuration: json(input.configuration ?? {}),
        createdById: context.userId,
      },
    });
    await tx.auditLog.create({ data: audit(context, input.projectId ?? null, "CONNECTOR_INSTALLATION_CREATED", "ConnectorInstallation", created.id, { connector: definition.code, direction: input.direction }) });
    return created;
  });
}

export async function storeInstallationCredential(context: IntegrationContext, installationId: string, input: {
  method: "OAUTH2" | "API_KEY" | "SERVICE_ACCOUNT" | "CERTIFICATE" | "MANUAL";
  secret: string;
  scopes?: string[];
  expiresAt?: Date | null;
}) {
  requireCapability(context, "INTEGRATION_CREDENTIALS");
  const installation = await installationForTenant(context.organizationId, installationId);
  const definition = await prisma.connectorDefinition.findUniqueOrThrow({ where: { id: installation.connectorDefinitionId } });
  const { secretRef, fingerprint } = await integrationSecretVault.store({ organizationId: context.organizationId, installationId, secret: input.secret });
  return prisma.$transaction(async (tx) => {
    const record = await tx.credentialReference.upsert({
      where: { installationId },
      update: {
        provider: definition.provider,
        method: input.method,
        secretRef,
        fingerprint,
        status: "ACTIVE",
        scopes: input.scopes ? json(input.scopes) : undefined,
        expiresAt: input.expiresAt ?? null,
        lastRotatedAt: new Date(),
      },
      create: {
        organizationId: context.organizationId,
        installationId,
        provider: definition.provider,
        method: input.method,
        secretRef,
        fingerprint,
        status: "ACTIVE",
        scopes: input.scopes ? json(input.scopes) : undefined,
        expiresAt: input.expiresAt ?? null,
        createdById: context.userId,
      },
    });
    await tx.auditLog.create({ data: audit(context, null, "CONNECTOR_CREDENTIAL_STORED", "CredentialReference", record.id, { fingerprint, method: input.method, expiresAt: input.expiresAt ?? null }) });
    return record;
  });
}

export async function receiveWebhookEvent(context: Pick<IntegrationContext, "organizationId">, installationId: string, input: {
  provider: string;
  eventId: string;
  signatureValid: boolean;
  payload: Record<string, unknown>;
}) {
  const installation = await installationForTenant(context.organizationId, installationId);
  const payloadChecksum = checksum(input.payload);
  const existing = await prisma.integrationInboxEvent.findUnique({
    where: { installationId_provider_eventId: { installationId, provider: input.provider, eventId: input.eventId } },
  });
  if (existing) return existing; // replay idempotente: efeito único, nunca reprocessa duplicado silenciosamente
  return prisma.integrationInboxEvent.create({
    data: {
      organizationId: context.organizationId,
      installationId: installation.id,
      provider: input.provider,
      eventId: input.eventId,
      signatureValid: input.signatureValid,
      payloadChecksum,
      payload: input.signatureValid ? json(input.payload) : undefined,
      status: input.signatureValid ? "RECEIVED" : "REJECTED",
      errorMessage: input.signatureValid ? null : "Assinatura de webhook inválida.",
    },
  });
}

export async function runConnectorSync(context: IntegrationContext, installationId: string, input: {
  mode: "MANUAL" | "SCHEDULED" | "WEBHOOK" | "INCREMENTAL" | "FULL" | "REPLAY";
  capability: string;
  connector: IntegrationConnector;
}) {
  requireCapability(context, "INTEGRATION_SYNC");
  const installation = await installationForTenant(context.organizationId, installationId);
  const cursorRecord = await prisma.integrationCursor.findUnique({
    where: { installationId_capability_partitionKey: { installationId, capability: input.capability, partitionKey: "default" } },
  });
  const correlationId = randomUUID();
  // FULL e REPLAY ignoram o cursor persistido e reconciliam desde o início (plano 9H §8/§10);
  // REPLAY, além disso, nunca avança o cursor oficial (ver upsert do cursor mais abaixo).
  const startCursor = input.mode === "FULL" || input.mode === "REPLAY" ? null : (cursorRecord?.cursorValue ?? null);
  const run = await prisma.integrationSyncRun.create({
    data: {
      organizationId: context.organizationId,
      installationId,
      mode: input.mode,
      direction: installation.direction,
      status: "RUNNING",
      cursorBefore: cursorRecord?.cursorValue ?? null,
      correlationId,
      triggeredById: context.userId,
    },
  });

  let page;
  try {
    page = await input.connector.pull({ capability: input.capability, cursor: startCursor, pageSize: 50 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida do provedor.";
    await prisma.integrationSyncRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), errorSummary: message } });
    await prisma.connectorInstallation.update({ where: { id: installationId }, data: { healthStatus: "DOWN" } });
    throw error;
  }

  let applied = 0;
  let ignored = 0;
  let errored = 0;
  const conflicted = 0;

  for (const item of page.items) {
    try {
      if (item.externalType === "DRIVE_FILE") {
        const itemChecksum = item.checksum ?? checksum(item.data);
        const data = item.data as { name?: string; mimeType?: string; size?: number; webUrl?: string };
        const documentReference = await prisma.connectorDocumentReference.upsert({
          where: { installationId_externalFileId: { installationId, externalFileId: item.externalId } },
          update: {
            name: data.name ?? item.externalId,
            mimeType: data.mimeType ?? null,
            size: data.size ?? null,
            webUrl: data.webUrl ?? null,
            checksum: itemChecksum,
            modifiedAtSource: item.occurredAt,
            externalVersionId: item.externalVersion ?? null,
          },
          create: {
            organizationId: context.organizationId,
            installationId,
            provider: installation.connectorDefinitionId,
            externalFileId: item.externalId,
            externalVersionId: item.externalVersion ?? null,
            name: data.name ?? item.externalId,
            mimeType: data.mimeType ?? null,
            size: data.size ?? null,
            webUrl: data.webUrl ?? null,
            checksum: itemChecksum,
            modifiedAtSource: item.occurredAt,
            referenceMode: "REFERENCE",
            companyId: installation.companyId,
            projectId: installation.projectId,
          },
        });
        await prisma.externalEntityReference.upsert({
          where: { installationId_externalType_externalId: { installationId, externalType: item.externalType, externalId: item.externalId } },
          update: { externalVersion: item.externalVersion ?? null, metadata: json({ documentReferenceId: documentReference.id }) },
          create: {
            organizationId: context.organizationId,
            installationId,
            entityType: "ConnectorDocumentReference",
            entityId: documentReference.id,
            externalType: item.externalType,
            externalId: item.externalId,
            externalVersion: item.externalVersion ?? null,
            companyId: installation.companyId,
            projectId: installation.projectId,
            metadata: json({ documentReferenceId: documentReference.id }),
          },
        });
        await prisma.integrationSyncItem.create({
          data: { organizationId: context.organizationId, syncRunId: run.id, externalType: item.externalType, externalId: item.externalId, resolvedEntityType: "ConnectorDocumentReference", resolvedEntityId: documentReference.id, result: "APPLIED", checksum: itemChecksum },
        });
        applied += 1;
      } else {
        await prisma.integrationSyncItem.create({
          data: { organizationId: context.organizationId, syncRunId: run.id, externalType: item.externalType, externalId: item.externalId, result: "SKIPPED", errorMessage: `Capability sem regra de aplicação registrada: ${item.externalType}.` },
        });
        ignored += 1;
      }
    } catch (error) {
      errored += 1;
      await prisma.integrationSyncItem.create({
        data: { organizationId: context.organizationId, syncRunId: run.id, externalType: item.externalType, externalId: item.externalId, result: "ERROR", errorMessage: error instanceof Error ? error.message : "Erro desconhecido ao aplicar item." },
      });
    }
  }

  if (input.mode !== "REPLAY") {
    await prisma.integrationCursor.upsert({
      where: { installationId_capability_partitionKey: { installationId, capability: input.capability, partitionKey: "default" } },
      update: { cursorValue: page.cursor, lastSuccessAt: new Date() },
      create: { organizationId: context.organizationId, installationId, capability: input.capability, cursorValue: page.cursor, lastSuccessAt: new Date() },
    });
  }

  const status = errored > 0 && applied === 0 && ignored === 0 ? "FAILED" : errored > 0 ? "PARTIAL" : "SUCCEEDED";
  const finished = await prisma.integrationSyncRun.update({
    where: { id: run.id },
    data: { status, finishedAt: new Date(), cursorAfter: page.cursor, itemsRead: page.items.length, itemsApplied: applied, itemsIgnored: ignored, itemsErrored: errored, itemsConflicted: conflicted },
  });
  await prisma.connectorInstallation.update({
    where: { id: installationId },
    data: { lastSyncAt: new Date(), healthStatus: status === "FAILED" ? "DOWN" : status === "PARTIAL" ? "DEGRADED" : "HEALTHY" },
  });
  await prisma.auditLog.create({ data: audit(context, installation.projectId, "CONNECTOR_SYNC_RUN_COMPLETED", "IntegrationSyncRun", run.id, { status: finished.status, itemsApplied: applied, itemsErrored: errored }) });
  return finished;
}

export async function reprocessQuarantineItem(context: IntegrationContext, quarantineId: string, decision: { discard: boolean; notes?: string }) {
  requireCapability(context, "INTEGRATION_RETRY");
  const item = await prisma.integrationQuarantineItem.findFirst({ where: { id: quarantineId, organizationId: context.organizationId } });
  if (!item) throw new Error("Item em quarentena não encontrado nesta organização.");
  if (item.status !== "PENDING") throw new Error("Item de quarentena já foi revisado.");
  const updated = await prisma.integrationQuarantineItem.update({
    where: { id: item.id },
    data: { status: decision.discard ? "DISCARDED" : "REVIEWED", reviewedById: context.userId, reviewedAt: new Date() },
  });
  await prisma.auditLog.create({ data: audit(context, null, "INTEGRATION_QUARANTINE_REVIEWED", "IntegrationQuarantineItem", item.id, { status: updated.status, notes: decision.notes ?? null }) });
  return updated;
}

export async function decideIntegrationConflict(context: IntegrationContext, conflictId: string, input: { decision: "APPLY_EXTERNAL" | "KEEP_LOCAL"; notes?: string }) {
  requireCapability(context, "INTEGRATION_APPROVE");
  const conflict = await prisma.integrationConflict.findFirst({ where: { id: conflictId, organizationId: context.organizationId } });
  if (!conflict) throw new Error("Conflito de integração não encontrado nesta organização.");
  if (conflict.status !== "OPEN") throw new Error("Conflito já foi resolvido.");
  const updated = await prisma.integrationConflict.update({
    where: { id: conflict.id },
    data: { status: "RESOLVED_MANUAL", resolution: json({ decision: input.decision, notes: input.notes ?? null }), resolvedById: context.userId, resolvedAt: new Date() },
  });
  await prisma.auditLog.create({ data: audit(context, null, "INTEGRATION_CONFLICT_RESOLVED", "IntegrationConflict", conflict.id, { decision: input.decision }) });
  return updated;
}

/**
 * Read model organização-wide da Central de Integrações (plano §44): `projectId`
 * é usado apenas como guarda de tenant/contexto ativo (o mesmo padrão das outras
 * fases), mas o resultado cobre TODAS as instalações da organização — Grupo,
 * Empresa, SPE e Empreendimento — para permitir os filtros de escopo na UI sem
 * duplicar regra de negócio na tela.
 */
export async function getIntegrationsWorkspace(context: Pick<IntegrationContext, "organizationId" | "role">, projectId: string) {
  requireCapability(context, "INTEGRATION_VIEW");
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: context.organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  const orgScope = { organizationId: context.organizationId };
  const [installations, syncRuns, conflicts, quarantineItems, deadLetters, credentials, healthSnapshots, ownershipPolicies] = await Promise.all([
    prisma.connectorInstallation.findMany({ where: orgScope, include: { connectorDefinition: true, credential: true, economicGroup: { select: { id: true, name: true } }, company: { select: { id: true, name: true, type: true } }, project: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.integrationSyncRun.findMany({ where: orgScope, orderBy: { startedAt: "desc" }, take: 100 }),
    prisma.integrationConflict.findMany({ where: orgScope, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.integrationQuarantineItem.findMany({ where: orgScope, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.integrationDeadLetter.findMany({ where: orgScope, orderBy: { occurredAt: "desc" }, take: 100 }),
    prisma.credentialReference.findMany({ where: orgScope, orderBy: { createdAt: "desc" } }),
    prisma.integrationHealthSnapshot.findMany({ where: orgScope, orderBy: { capturedAt: "desc" }, take: 100 }),
    prisma.dataOwnershipPolicy.findMany({ where: orgScope, orderBy: { createdAt: "desc" } }),
  ]);
  const now = Date.now();
  const isStale = (lastSyncAt: Date | null) => !lastSyncAt || now - lastSyncAt.getTime() > STALE_THRESHOLD_MS;

  const installationViews = installations.map((item) => {
    const credentialStatus = item.credential?.status ?? "PENDING";
    const stale = isStale(item.lastSyncAt);
    // "Empresa" e "SPE" são ambas Company (diferenciadas por CompanyType) — a Central de
    // Integrações precisa das quatro visões do plano (Grupo/Empresa/SPE/Empreendimento).
    const scopeLevel = item.economicGroup ? "GROUP" as const : item.company ? (item.company.type === "SPE" ? "SPE" as const : "COMPANY" as const) : item.project ? "PROJECT" as const : "ORGANIZATION" as const;
    return {
      id: item.id,
      name: item.name,
      connector: item.connectorDefinition.name,
      connectorCode: item.connectorDefinition.code,
      provider: item.connectorDefinition.provider,
      direction: item.direction,
      status: item.status,
      healthStatus: item.healthStatus,
      lastSyncAt: item.lastSyncAt?.toISOString() ?? null,
      nextSyncAt: item.nextSyncAt?.toISOString() ?? null,
      stale,
      credentialStatus,
      credentialExpiresAt: item.credential?.expiresAt?.toISOString() ?? null,
      uiState: classifyInstallationState({ installationStatus: item.status, healthStatus: item.healthStatus, credentialStatus, stale }),
      scope: { level: scopeLevel, groupId: item.economicGroup?.id ?? null, groupName: item.economicGroup?.name ?? null, companyId: item.company?.id ?? null, companyName: item.company?.name ?? null, projectId: item.project?.id ?? null, projectName: item.project?.name ?? null },
    };
  });

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    permissions: {
      canConfigure: hasIntegrationCapability(context.role, "INTEGRATION_CONFIGURE"),
      canSync: hasIntegrationCapability(context.role, "INTEGRATION_SYNC"),
      canManageCredentials: hasIntegrationCapability(context.role, "INTEGRATION_CREDENTIALS"),
      canApprove: hasIntegrationCapability(context.role, "INTEGRATION_APPROVE"),
      canRetry: hasIntegrationCapability(context.role, "INTEGRATION_RETRY"),
    },
    installations: installationViews,
    syncRuns: syncRuns.map((run) => ({ id: run.id, installationId: run.installationId, mode: run.mode, status: run.status, startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null, itemsRead: run.itemsRead, itemsApplied: run.itemsApplied, itemsErrored: run.itemsErrored, itemsConflicted: run.itemsConflicted, correlationId: run.correlationId })),
    conflicts: conflicts.map((item) => ({ id: item.id, installationId: item.installationId, entityType: item.entityType, entityId: item.entityId, fieldName: item.fieldName, status: item.status, policyApplied: item.policyApplied })),
    quarantine: quarantineItems.map((item) => ({ id: item.id, installationId: item.installationId, capability: item.capability, reason: item.reason, errorClass: item.errorClass, status: item.status })),
    deadLetters: deadLetters.map((item) => ({ id: item.id, sourceType: item.sourceType, errorClass: item.errorClass, reason: item.reason, resolved: Boolean(item.resolvedAt) })),
    credentials: credentials.map((item) => ({ id: item.id, installationId: item.installationId, status: item.status, expiresAt: item.expiresAt?.toISOString() ?? null, fingerprint: item.fingerprint })),
    healthSnapshots: healthSnapshots.map((item) => ({ id: item.id, installationId: item.installationId, capturedAt: item.capturedAt.toISOString(), healthScore: item.healthScore, backlogCount: item.backlogCount, freshnessSeconds: item.freshnessSeconds })),
    ownershipPolicies: ownershipPolicies.map((item) => ({ id: item.id, domain: item.domain, entityType: item.entityType, fieldPattern: item.fieldPattern, masterSystem: item.masterSystem, conflictPolicy: item.conflictPolicy, riskLevel: item.riskLevel })),
    summary: {
      installations: installationViews.length,
      staleInstallations: installationViews.filter((item) => item.stale).length,
      criticalInstallations: installationViews.filter((item) => item.uiState === "CRITICAL").length,
      attentionInstallations: installationViews.filter((item) => item.uiState === "ATTENTION").length,
      openConflicts: conflicts.filter((item) => item.status === "OPEN").length,
      pendingQuarantine: quarantineItems.filter((item) => item.status === "PENDING").length,
      unresolvedDeadLetters: deadLetters.filter((item) => !item.resolvedAt).length,
      expiringCredentials: credentials.filter((item) => item.expiresAt && item.expiresAt.getTime() - now < CREDENTIAL_EXPIRY_WARNING_MS).length,
    },
  };
}

export async function createWebhookSubscription(context: IntegrationContext, input: { endpointUrl: string; events: string[]; secret: string }) {
  requireCapability(context, "INTEGRATION_CONFIGURE");
  assertSafeExternalUrl(input.endpointUrl);
  const { secretRef } = await integrationSecretVault.store({ organizationId: context.organizationId, installationId: `webhook-subscription`, secret: input.secret });
  const subscription = await prisma.webhookSubscription.create({
    data: { organizationId: context.organizationId, endpointUrl: input.endpointUrl, secretRef, events: json(input.events), createdById: context.userId },
  });
  await prisma.auditLog.create({ data: audit(context, null, "WEBHOOK_SUBSCRIPTION_CREATED", "WebhookSubscription", subscription.id, { endpointUrl: input.endpointUrl, events: input.events }) });
  return subscription;
}

export type IntegrationsWorkspaceView = Awaited<ReturnType<typeof getIntegrationsWorkspace>>;
export const integrationsServiceInternals = { requireCapability, installationForTenant, calculateHealthScore };
