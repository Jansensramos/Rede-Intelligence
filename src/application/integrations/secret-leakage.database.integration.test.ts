import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { integrationSecretVault } from "@/infrastructure/security/local-secret-vault";
import { createApiClient } from "./api-service";
import { createConnectorInstallation, createWebhookSubscription, getIntegrationsWorkspace, storeInstallationCredential } from "./integrations-service";

/**
 * Revisão de segurança do cofre de segredos (plano §9): prova, por busca literal
 * do valor secreto em registros serializados, que Prisma/logs/read models nunca
 * recebem o segredo em texto puro — apenas `secretRef` (opaco) e `fingerprint`
 * (hash não reversível, 16 hex, sem uso reverso). O `LocalEncryptedSecretVault`
 * é uma implementação de DESENVOLVIMENTO: o segredo cifrado fica em disco local
 * (`.rede-storage/secrets`, gitignored), não em um secret manager gerenciado com
 * KMS/HSM, rotação automática de chave mestra ou auditoria de acesso própria —
 * ver o comentário de topo de `local-secret-vault.ts` e a seção "Limites" do
 * documento da fase.
 */
describe("Cofre de segredos — nunca em texto puro (PostgreSQL real)", () => {
  let context: { organizationId: string; userId: string; role: "OWNER" };
  const DISTINCT_SECRET = "SECRETO-LITERAL-NUNCA-DEVE-APARECER-EM-LOG-9H-XYZ123";

  beforeAll(async () => {
    const membership = await prisma.organizationMembership.findFirstOrThrow({ where: { organization: { slug: "rede-nucleo-de-negocios" }, user: { email: "admin@rede.local" } } });
    context = { organizationId: membership.organizationId, userId: membership.userId, role: "OWNER" };
  });

  it("credencial de instalação: segredo nunca aparece na linha, no AuditLog nem no read model", async () => {
    const definition = await prisma.connectorDefinition.findFirstOrThrow({ where: { code: "GOOGLE_DRIVE_MOCK" } });
    const project = await prisma.project.findFirstOrThrow({ where: { organizationId: context.organizationId } });
    const installation = await createConnectorInstallation(context, { connectorDefinitionCode: definition.code, name: "Instalação de teste — leakage", direction: "INBOUND", projectId: project.id });
    const credential = await storeInstallationCredential(context, installation.id, { method: "MANUAL", secret: DISTINCT_SECRET });

    expect(JSON.stringify(credential)).not.toContain(DISTINCT_SECRET);
    const rawRow = await prisma.credentialReference.findUniqueOrThrow({ where: { installationId: installation.id } });
    expect(JSON.stringify(rawRow)).not.toContain(DISTINCT_SECRET);

    const auditLogs = await prisma.auditLog.findMany({ where: { organizationId: context.organizationId, entityType: "CredentialReference", entityId: credential.id } });
    expect(auditLogs.length).toBeGreaterThan(0);
    expect(JSON.stringify(auditLogs)).not.toContain(DISTINCT_SECRET);

    const workspace = await getIntegrationsWorkspace(context, project.id);
    expect(JSON.stringify(workspace)).not.toContain(DISTINCT_SECRET);

    // o vault, por sua vez, recupera o segredo exato (não foi perdido — apenas não fica no Postgres).
    const recovered = await integrationSecretVault.read(credential.secretRef);
    expect(recovered).toBe(DISTINCT_SECRET);
    expect(integrationSecretVault.name).toBe("LOCAL_ENCRYPTED_V1");
  });

  it("API client: a chave em texto puro nunca é persistida — apenas o hash", async () => {
    const { client, rawKey } = await createApiClient(context, { name: "Cliente de teste — leakage", scopes: ["integrations:read"] });
    expect(rawKey).toMatch(/^rede_v1_/);
    expect(JSON.stringify(client)).not.toContain(rawKey);
    const rawRow = await prisma.apiClient.findUniqueOrThrow({ where: { id: client.id } });
    expect(JSON.stringify(rawRow)).not.toContain(rawKey);
    const auditLogs = await prisma.auditLog.findMany({ where: { organizationId: context.organizationId, entityType: "ApiClient", entityId: client.id } });
    expect(JSON.stringify(auditLogs)).not.toContain(rawKey);
  });

  it("webhook subscription: o segredo de assinatura nunca aparece na linha nem no AuditLog", async () => {
    const subscription = await createWebhookSubscription(context, { endpointUrl: "https://leakage-test.example.com/hook", events: ["sale.created"], secret: DISTINCT_SECRET });
    expect(JSON.stringify(subscription)).not.toContain(DISTINCT_SECRET);
    const auditLogs = await prisma.auditLog.findMany({ where: { organizationId: context.organizationId, entityType: "WebhookSubscription", entityId: subscription.id } });
    expect(JSON.stringify(auditLogs)).not.toContain(DISTINCT_SECRET);
    const recovered = await integrationSecretVault.read(subscription.secretRef);
    expect(recovered).toBe(DISTINCT_SECRET);
  });
});
