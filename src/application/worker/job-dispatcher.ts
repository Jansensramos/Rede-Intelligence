import type { IntegrationJob, MembershipRole } from "@prisma/client";
import { processStoredFile } from "@/application/design/design-service";
import { runConnectorSync } from "@/application/integrations/integrations-service";
import { deliverPendingOutboxEvents } from "@/application/integrations/webhook-delivery";
import { MockGoogleDriveConnector, type MockDriveFile } from "@/domain/integrations";
import { prisma } from "@/infrastructure/database/prisma";

type Payload = Record<string, unknown>;
const payloadOf = (job: IntegrationJob) => (job.payload && typeof job.payload === "object" && !Array.isArray(job.payload) ? job.payload as Payload : {});
const requiredString = (payload: Payload, key: string) => {
  const value = payload[key];
  if (typeof value !== "string" || !value) throw new Error(`Payload inválido: ${key} é obrigatório.`);
  return value;
};

async function integrationContext(job: IntegrationJob) {
  if (!job.installationId) throw new Error("Job de sincronização sem installationId.");
  const installation = await prisma.connectorInstallation.findFirst({
    where: { id: job.installationId, organizationId: job.organizationId },
    include: { connectorDefinition: true },
  });
  if (!installation) throw new Error("Instalação não encontrada no tenant do job.");
  const membership = await prisma.organizationMembership.findFirst({ where: { organizationId: job.organizationId, userId: installation.createdById } });
  if (!membership) throw new Error("Responsável pela instalação não pertence ao tenant do job.");
  return { installation, context: { organizationId: job.organizationId, userId: installation.createdById, role: membership.role as MembershipRole } };
}

export const supportedJobTypes = ["SYNC_INSTALLATION", "POLL_INSTALLATION", "DELIVER_WEBHOOKS", "PROCESS_DESIGN_FILE"] as const;

export async function dispatchJob(job: IntegrationJob, signal: AbortSignal) {
  signal.throwIfAborted();
  const payload = payloadOf(job);
  if (job.jobType === "PROCESS_DESIGN_FILE") {
    await processStoredFile({ organizationId: job.organizationId, userId: requiredString(payload, "userId") }, requiredString(payload, "fileId"), requiredString(payload, "designJobId"));
    signal.throwIfAborted();
    return;
  }
  if (job.jobType === "DELIVER_WEBHOOKS") {
    await deliverPendingOutboxEvents(job.organizationId, { send: async ({ url, body, headers }) => {
      const response = await fetch(url, { method: "POST", body, headers, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
      return { status: response.status };
    } });
    return;
  }
  if (job.jobType === "SYNC_INSTALLATION" || job.jobType === "POLL_INSTALLATION") {
    const { installation, context } = await integrationContext(job);
    if (installation.connectorDefinition.code !== "GOOGLE_DRIVE_MOCK") throw new Error(`Adapter ${installation.connectorDefinition.code} não possui execução segura no worker atual.`);
    const files = Array.isArray(payload.files) ? payload.files.map((item) => {
      const file = item as Omit<MockDriveFile, "modifiedAt"> & { modifiedAt: string | Date };
      return { ...file, modifiedAt: new Date(file.modifiedAt) };
    }) : [];
    await runConnectorSync(context, installation.id, {
      mode: job.jobType === "POLL_INSTALLATION" ? "SCHEDULED" : "MANUAL",
      capability: typeof payload.capability === "string" ? payload.capability : "DOCUMENTS",
      connector: new MockGoogleDriveConnector(files),
    });
    signal.throwIfAborted();
    return;
  }
  throw new Error(`Tipo de job não suportado pelo worker: ${job.jobType}`);
}
