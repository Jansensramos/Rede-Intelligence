import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { integrationSecretVault } from "@/infrastructure/security/secret-vault";
import { clicksignProviderForOrganization, configureClicksignInstallation, receiveClicksignWebhook } from "./clicksign-service";

const token = randomUUID().slice(0, 8);
const secret = `webhook-${token}`;
const bundle = JSON.stringify({ accessToken: `access-${token}`, webhookSecret: secret });
const installationIds: string[] = [];
const secretRefs: string[] = [];

function webhook(eventId: string, envelopeId: string, eventName = "envelope.closed", extra: Record<string, unknown> = {}) {
  return new TextEncoder().encode(JSON.stringify({ organizationId: "tenant-do-corpo-e-ignorado", data: { id: eventId, type: "events", attributes: { event_name: eventName, ...extra }, relationships: { envelope: { data: { type: "envelopes", id: envelopeId } } } } }));
}
function signature(raw: Uint8Array) { return createHmac("sha256", secret).update(raw).digest("hex"); }

describe.skipIf(!process.env.DATABASE_URL).sequential("Clicksign 9P.3A — webhook, tenant, idempotência e RBAC no PostgreSQL", () => {
  let organizationId: string;
  let userId: string;
  let otherOrganizationId: string;
  let primaryInstallationId: string;
  let otherInstallationId: string;

  beforeAll(async () => {
    const membership = await prisma.organizationMembership.findFirstOrThrow({ where: { organization: { slug: "rede-nucleo-de-negocios" }, user: { email: "admin@rede.local" } } });
    const otherMembership = await prisma.organizationMembership.findFirstOrThrow({ where: { organizationId: { not: membership.organizationId }, isActive: true } });
    organizationId = membership.organizationId; userId = membership.userId; otherOrganizationId = otherMembership.organizationId;
    const definition = await prisma.connectorDefinition.upsert({ where: { code: "CLICKSIGN_API_V3" }, update: {}, create: { code: "CLICKSIGN_API_V3", name: "Clicksign — API 3.0 Envelope", provider: "CLICKSIGN", category: "OTHER", authMethod: "API_KEY", capabilities: [{ code: "SIGNATURE_ENVELOPES" }], adapterVersion: "1.0.0", contractVersion: "3.0" } });

    for (const item of [{ organizationId, createdById: userId, name: `Clicksign primary ${token}` }, { organizationId: otherOrganizationId, createdById: otherMembership.userId, name: `Clicksign other ${token}` }]) {
      const installation = await prisma.connectorInstallation.create({ data: { organizationId: item.organizationId, connectorDefinitionId: definition.id, name: item.name, status: "ACTIVE", direction: "BIDIRECTIONAL", configuration: { mode: "REAL", signatureEnvelopeEnabled: true, environment: "SANDBOX", baseUrl: "https://sandbox.clicksign.com/api/v3" }, createdById: item.createdById } });
      installationIds.push(installation.id);
      const stored = await integrationSecretVault.store({ organizationId: item.organizationId, installationId: installation.id, secret: bundle });
      secretRefs.push(stored.secretRef);
      await prisma.credentialReference.create({ data: { organizationId: item.organizationId, installationId: installation.id, provider: "CLICKSIGN", method: "API_KEY", secretRef: stored.secretRef, fingerprint: stored.fingerprint, status: "ACTIVE", createdById: item.createdById } });
    }
    [primaryInstallationId, otherInstallationId] = installationIds;
  });

  afterAll(async () => {
    try {
      await prisma.integrationJob.deleteMany({ where: { installationId: { in: installationIds } } });
      await prisma.integrationQuarantineItem.deleteMany({ where: { installationId: { in: installationIds } } });
      await prisma.integrationInboxEvent.deleteMany({ where: { installationId: { in: installationIds } } });
      await prisma.credentialReference.deleteMany({ where: { installationId: { in: installationIds } } });
      await prisma.connectorInstallation.deleteMany({ where: { id: { in: installationIds } } });
      for (const reference of secretRefs) await integrationSecretVault.revoke(reference);
    } finally { await prisma.$disconnect(); }
  });

  it("rejeita assinatura inválida e instalação inexistente sem persistir", async () => {
    const raw = webhook(`invalid-${token}`, "env-invalid");
    const before = await prisma.integrationInboxEvent.count({ where: { installationId: primaryInstallationId } });
    await expect(receiveClicksignWebhook({ installationId: primaryInstallationId, rawBody: raw, signature: "0".repeat(64) })).rejects.toThrow("inválida");
    await expect(receiveClicksignWebhook({ installationId: "installation-inexistente", rawBody: raw, signature: signature(raw) })).rejects.toThrow("não encontrada ou indisponível");
    expect(await prisma.integrationInboxEvent.count({ where: { installationId: primaryInstallationId } })).toBe(before);
  });

  it("replay sequencial e concorrente produz um inbox e um job", async () => {
    const eventId = `replay-${token}`;
    const raw = webhook(eventId, `env-${token}`);
    const first = await receiveClicksignWebhook({ installationId: primaryInstallationId, rawBody: raw, signature: signature(raw) });
    const sequential = await receiveClicksignWebhook({ installationId: primaryInstallationId, rawBody: raw, signature: signature(raw) });
    const concurrent = await Promise.all(Array.from({ length: 6 }, () => receiveClicksignWebhook({ installationId: primaryInstallationId, rawBody: raw, signature: signature(raw) })));
    expect(first.status).toBe("ACCEPTED");
    expect(sequential.status).toBe("DUPLICATE");
    expect(concurrent.every((item) => item.inboxEventId === first.inboxEventId)).toBe(true);
    expect(await prisma.integrationInboxEvent.count({ where: { installationId: primaryInstallationId, provider: "CLICKSIGN", eventId } })).toBe(1);
    expect(await prisma.integrationJob.count({ where: { installationId: primaryInstallationId, jobType: "PROCESS_SIGNATURE_WEBHOOK", payload: { path: ["inboxEventId"], equals: first.inboxEventId } } })).toBe(1);
  });

  it("mesmo eventId com payload diferente é preservado em quarentena", async () => {
    const eventId = `conflict-${token}`;
    const first = webhook(eventId, "env-a");
    const changed = webhook(eventId, "env-b");
    await receiveClicksignWebhook({ installationId: primaryInstallationId, rawBody: first, signature: signature(first) });
    await expect(receiveClicksignWebhook({ installationId: primaryInstallationId, rawBody: changed, signature: signature(changed) })).resolves.toMatchObject({ status: "CONFLICT" });
    expect(await prisma.integrationQuarantineItem.count({ where: { installationId: primaryInstallationId, externalId: `duplicate:${eventId}` } })).toBe(1);
  });

  it("resolve tenant exclusivamente pela instalação do servidor", async () => {
    const raw = webhook(`tenant-${token}`, "env-tenant", "future.event", { organizationId });
    await receiveClicksignWebhook({ installationId: otherInstallationId, rawBody: raw, signature: signature(raw) });
    const inbox = await prisma.integrationInboxEvent.findUniqueOrThrow({ where: { installationId_provider_eventId: { installationId: otherInstallationId, provider: "CLICKSIGN", eventId: `tenant-${token}` } } });
    expect(inbox.organizationId).toBe(otherOrganizationId);
    expect(inbox.organizationId).not.toBe(organizationId);
    expect(JSON.stringify(inbox.payload)).not.toContain("tenant-do-corpo-e-ignorado");
  });

  it("VIEWER não configura e ID inexistente/alheio têm erro indistinguível", async () => {
    const viewer = { organizationId, userId, role: "VIEWER" as const };
    const owner = { organizationId, userId, role: "OWNER" as const };
    const config = { mode: "REAL" as const, signatureEnvelopeEnabled: true, environment: "SANDBOX" as const, baseUrl: "https://sandbox.clicksign.com/api/v3" };
    await expect(configureClicksignInstallation(viewer, primaryInstallationId, config)).rejects.toThrow("não possui a capacidade");
    const missing = await configureClicksignInstallation(owner, "missing", config).catch((error: Error) => error.message);
    const foreign = await configureClicksignInstallation(owner, otherInstallationId, config).catch((error: Error) => error.message);
    expect(foreign).toBe(missing);
  });

  it("REAL sem instalação/configuração válida falha fechado", async () => {
    await prisma.connectorInstallation.update({ where: { id: primaryInstallationId }, data: { status: "PAUSED" } });
    await expect(clicksignProviderForOrganization(organizationId, { request: async () => { throw new Error("não deve chamar"); } })).rejects.toThrow("não encontrada ou indisponível");
    await prisma.connectorInstallation.update({ where: { id: primaryInstallationId }, data: { status: "ACTIVE" } });
  });
});
