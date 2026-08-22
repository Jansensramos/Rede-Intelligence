import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { integrationSecretVault } from "@/infrastructure/security/local-secret-vault";
import { MockGoogleDriveConnector } from "@/domain/integrations";
import {
  createConnectorInstallation,
  decideIntegrationConflict,
  getIntegrationsWorkspace,
  receiveWebhookEvent,
  reprocessQuarantineItem,
  runConnectorSync,
  storeInstallationCredential,
} from "./integrations-service";

describe("Integrações 9H em PostgreSQL real", () => {
  let context: { organizationId: string; userId: string; role: "OWNER" };
  let projectId: string;
  let companyId: string;
  let driveInstallationId: string;
  let erpInstallationId: string;

  beforeAll(async () => {
    const membership = await prisma.organizationMembership.findFirstOrThrow({ where: { organization: { slug: "rede-nucleo-de-negocios" }, user: { email: "admin@rede.local" } } });
    const project = await prisma.project.findUniqueOrThrow({ where: { organizationId_name: { organizationId: membership.organizationId, name: "START BUTANTÃ" } } });
    const company = await prisma.company.findFirstOrThrow({ where: { organizationId: membership.organizationId, projects: { some: { id: project.id } } } });
    context = { organizationId: membership.organizationId, userId: membership.userId, role: "OWNER" };
    projectId = project.id;
    companyId = company.id;
    const driveInstallation = await prisma.connectorInstallation.findFirstOrThrow({ where: { organizationId: context.organizationId, projectId, connectorDefinition: { code: "GOOGLE_DRIVE_MOCK" } } });
    const erpInstallation = await prisma.connectorInstallation.findFirstOrThrow({ where: { organizationId: context.organizationId, companyId, connectorDefinition: { code: "ERP_SUPPLIERS_MOCK" } } });
    driveInstallationId = driveInstallation.id;
    erpInstallationId = erpInstallation.id;
  });

  it("carrega instalações, saúde, freshness, conflitos, quarentena e credenciais do START BUTANTÃ", async () => {
    const workspace = await getIntegrationsWorkspace(context, projectId);
    expect(workspace.installations.length).toBeGreaterThanOrEqual(2);
    const drive = workspace.installations.find((item) => item.id === driveInstallationId);
    expect(drive).toMatchObject({ healthStatus: "HEALTHY", stale: false });
    const erp = workspace.installations.find((item) => item.id === erpInstallationId);
    expect(erp?.credentialStatus).toBe("EXPIRED");
    expect(workspace.summary.openConflicts).toBe(0); // já resolvido pelo seed
    expect(workspace.summary.expiringCredentials).toBeGreaterThanOrEqual(1);
    expect(workspace.ownershipPolicies.some((item) => item.entityType === "Supplier" && item.fieldPattern === "taxId" && item.masterSystem === "ERP")).toBe(true);
  });

  it("nunca guarda o segredo em texto puro — apenas secretRef opaco e fingerprint não reversível", async () => {
    const credential = await prisma.credentialReference.findUniqueOrThrow({ where: { installationId: driveInstallationId } });
    expect(credential.secretRef).not.toContain("demo-oauth-refresh-token-not-a-real-secret");
    expect(JSON.stringify(credential)).not.toContain("demo-oauth-refresh-token-not-a-real-secret");
    const secret = await integrationSecretVault.read(credential.secretRef);
    expect(secret).toBe("demo-oauth-refresh-token-not-a-real-secret");
  });

  it("faz replay idempotente de webhook duplicado com efeito único (Caso Crítico B)", async () => {
    const payload = { fileId: "drive-file-memorial", changeType: "content" };
    const first = await receiveWebhookEvent(context, driveInstallationId, { provider: "GOOGLE_DRIVE", eventId: "evt-test-idempotency", signatureValid: true, payload });
    const replay = await receiveWebhookEvent(context, driveInstallationId, { provider: "GOOGLE_DRIVE", eventId: "evt-test-idempotency", signatureValid: true, payload });
    expect(replay.id).toBe(first.id);
    expect(await prisma.integrationInboxEvent.count({ where: { installationId: driveInstallationId, provider: "GOOGLE_DRIVE", eventId: "evt-test-idempotency" } })).toBe(1);
  });

  it("rejeita webhook com assinatura inválida e não expõe o payload não confiável", async () => {
    const rejected = await receiveWebhookEvent(context, driveInstallationId, { provider: "GOOGLE_DRIVE", eventId: "evt-invalid-signature", signatureValid: false, payload: { fileId: "drive-file-memorial" } });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.payload).toBeNull();
  });

  it("sincroniza o mock do Drive de forma paginada e idempotente por referência externa (FULL ignora cursor persistido)", async () => {
    const files = [
      { externalId: "drive-file-memorial", versionId: "v1", name: "Memorial descritivo — START BUTANTÃ.pdf", mimeType: "application/pdf", size: 812_400, webUrl: "https://drive.example.com/file/drive-file-memorial", checksum: "chk-memorial", modifiedAt: new Date("2026-08-10") },
    ];
    const connector = new MockGoogleDriveConnector(files);
    // FULL reconcilia desde o início mesmo com cursor já avançado por sincronizações anteriores (plano §8/§10) —
    // por isso este teste continua determinístico mesmo sendo executado repetidamente contra o mesmo banco.
    const run = await runConnectorSync(context, driveInstallationId, { mode: "FULL", capability: "DOCUMENTS", connector });
    expect(run.status).toBe("SUCCEEDED");
    expect(run.itemsApplied).toBe(1);
    const references = await prisma.externalEntityReference.count({ where: { installationId: driveInstallationId, externalType: "DRIVE_FILE", externalId: "drive-file-memorial" } });
    expect(references).toBe(1); // upsert, nunca duplica

    // REPLAY nunca avança o cursor oficial até validação completa: roda de novo e o cursor persistido não muda.
    const cursorBefore = await prisma.integrationCursor.findUniqueOrThrow({ where: { installationId_capability_partitionKey: { installationId: driveInstallationId, capability: "DOCUMENTS", partitionKey: "default" } } });
    await runConnectorSync(context, driveInstallationId, { mode: "REPLAY", capability: "DOCUMENTS", connector });
    const cursorAfter = await prisma.integrationCursor.findUniqueOrThrow({ where: { installationId_capability_partitionKey: { installationId: driveInstallationId, capability: "DOCUMENTS", partitionKey: "default" } } });
    expect(cursorAfter.cursorValue).toBe(cursorBefore.cursorValue);
  });

  it("não reprocessa quarentena nem reabre conflito já decidido", async () => {
    const quarantineItem = await prisma.integrationQuarantineItem.findFirstOrThrow({ where: { installationId: erpInstallationId, externalId: "ERP-SUP-9999" } });
    expect(quarantineItem.status).toBe("REVIEWED");
    await expect(reprocessQuarantineItem(context, quarantineItem.id, { discard: false })).rejects.toThrow("já foi revisado");

    const conflict = await prisma.integrationConflict.findFirstOrThrow({ where: { installationId: erpInstallationId, fieldName: "email" } });
    expect(conflict.status).toBe("RESOLVED_MANUAL");
    await expect(decideIntegrationConflict(context, conflict.id, { decision: "APPLY_EXTERNAL" })).rejects.toThrow("já foi resolvido");
  });

  it("valida escopo de tenant ao criar instalação com empresa de outra organização", async () => {
    const isolated = await prisma.organization.findUniqueOrThrow({ where: { slug: "grupo-atlas" } });
    const foreignCompany = await prisma.company.findFirst({ where: { organizationId: isolated.id } });
    if (foreignCompany) {
      await expect(createConnectorInstallation(context, { connectorDefinitionCode: "GOOGLE_DRIVE_MOCK", name: "Instalação cruzada inválida", direction: "INBOUND", companyId: foreignCompany.id })).rejects.toThrow("não encontrada nesta organização");
    }
  });

  it("isola organização e respeita capacidade de leitura versus configuração/credenciais", async () => {
    const isolated = await prisma.organization.findUniqueOrThrow({ where: { slug: "grupo-atlas" } });
    await expect(getIntegrationsWorkspace({ organizationId: isolated.id, role: "VIEWER" }, projectId)).rejects.toThrow("não encontrado");
    await expect(createConnectorInstallation({ organizationId: context.organizationId, userId: context.userId, role: "VIEWER" }, { connectorDefinitionCode: "GOOGLE_DRIVE_MOCK", name: "Tentativa não autorizada", direction: "INBOUND", projectId })).rejects.toThrow("não possui a capacidade");
    await expect(storeInstallationCredential({ organizationId: context.organizationId, userId: context.userId, role: "ANALYST" }, driveInstallationId, { method: "API_KEY", secret: "outro-segredo" })).rejects.toThrow("não possui a capacidade");
  });
});
