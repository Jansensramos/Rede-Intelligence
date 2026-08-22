import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { createApiClient } from "@/application/integrations/api-service";
import { GET as getInstallations } from "./installations/route";
import { POST as postSyncRequest } from "./sync-requests/route";

describe("API pública v1 — foundation (PostgreSQL real)", () => {
  let context: { organizationId: string; userId: string; role: "OWNER" };
  let readOnlyKey: string;
  let syncKey: string;
  let installationId: string;

  beforeAll(async () => {
    const membership = await prisma.organizationMembership.findFirstOrThrow({ where: { organization: { slug: "rede-nucleo-de-negocios" }, user: { email: "admin@rede.local" } } });
    context = { organizationId: membership.organizationId, userId: membership.userId, role: "OWNER" };
    const readOnly = await createApiClient(context, { name: "Cliente somente leitura — teste", scopes: ["integrations:read"] });
    readOnlyKey = readOnly.rawKey;
    const syncClient = await createApiClient(context, { name: "Cliente de sincronização — teste", scopes: ["integrations:read", "integrations:sync"] });
    syncKey = syncClient.rawKey;
    const installation = await prisma.connectorInstallation.findFirstOrThrow({ where: { organizationId: context.organizationId, connectorDefinition: { code: "GOOGLE_DRIVE_MOCK" } } });
    installationId = installation.id;
  });

  it("rejeita requisição sem Authorization com formato de erro versionado", async () => {
    const response = await getInstallations(new NextRequest("https://app.local/api/v1/integrations/installations"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toMatchObject({ code: "UNAUTHENTICATED", version: "v1" });
    expect(body.error.correlationId).toBeTruthy();
  });

  it("rejeita chave de API inválida", async () => {
    const response = await getInstallations(new NextRequest("https://app.local/api/v1/integrations/installations", { headers: { authorization: "Bearer chave-invalida" } }));
    expect(response.status).toBe(401);
  });

  it("rejeita escopo insuficiente (chave de sync sem escopo de leitura teria sido negada; aqui testamos o inverso: leitura tentando escrever)", async () => {
    const response = await postSyncRequest(new NextRequest("https://app.local/api/v1/integrations/sync-requests", { method: "POST", headers: { authorization: `Bearer ${readOnlyKey}`, "idempotency-key": "test-scope-1", "content-type": "application/json" }, body: JSON.stringify({ installationId, capability: "DOCUMENTS" }) }));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("lista instalações paginadas por cursor, sem expor credencial/segredo, com correlationId ecoado", async () => {
    const correlationId = "corr-test-123";
    const response = await getInstallations(new NextRequest("https://app.local/api/v1/integrations/installations?limit=1", { headers: { authorization: `Bearer ${readOnlyKey}`, "x-correlation-id": correlationId } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe(correlationId);
    const body = await response.json();
    expect(body.version).toBe("v1");
    expect(body.data).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/secretRef|apiKeyHash|password/i);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.pagination.nextCursor).toBeTruthy();
  });

  it("aplica idempotency-key em escrita: mesma chave nunca enfileira duas vezes; corpo diferente é rejeitado", async () => {
    const idempotencyKey = `test-idem-${Date.now()}`;
    const requestInit = { method: "POST" as const, headers: { authorization: `Bearer ${syncKey}`, "idempotency-key": idempotencyKey, "content-type": "application/json" }, body: JSON.stringify({ installationId, capability: "DOCUMENTS" }) };
    const first = await postSyncRequest(new NextRequest("https://app.local/api/v1/integrations/sync-requests", requestInit));
    expect(first.status).toBe(202);
    const firstBody = await first.json();
    expect(firstBody.data.jobId).toBeTruthy();

    const replay = await postSyncRequest(new NextRequest("https://app.local/api/v1/integrations/sync-requests", requestInit));
    expect(replay.status).toBe(202);
    expect(replay.headers.get("x-idempotency-replayed")).toBe("true");
    const replayBody = await replay.json();
    expect(replayBody.data.jobId).toBe(firstBody.data.jobId);

    const jobCount = await prisma.integrationJob.count({ where: { organizationId: context.organizationId, jobType: "SYNC_INSTALLATION", correlationId: idempotencyKey } });
    expect(jobCount).toBe(1);

    const conflicting = await postSyncRequest(new NextRequest("https://app.local/api/v1/integrations/sync-requests", { ...requestInit, body: JSON.stringify({ installationId, capability: "OTHER_CAPABILITY" }) }));
    expect(conflicting.status).toBe(409);
  });

  it("exige Idempotency-Key para escrita e valida corpo obrigatório", async () => {
    const missingKey = await postSyncRequest(new NextRequest("https://app.local/api/v1/integrations/sync-requests", { method: "POST", headers: { authorization: `Bearer ${syncKey}`, "content-type": "application/json" }, body: JSON.stringify({ installationId, capability: "DOCUMENTS" }) }));
    expect(missingKey.status).toBe(400);

    const missingBody = await postSyncRequest(new NextRequest("https://app.local/api/v1/integrations/sync-requests", { method: "POST", headers: { authorization: `Bearer ${syncKey}`, "idempotency-key": `test-missing-${Date.now()}`, "content-type": "application/json" }, body: JSON.stringify({}) }));
    expect(missingBody.status).toBe(400);
  });

  it("aplica o boundary de rate limit e retorna Retry-After", async () => {
    const client = await createApiClient(context, { name: "Cliente de rate limit — teste", scopes: ["integrations:read"] });
    let lastStatus = 200;
    let sawRateLimit = false;
    for (let i = 0; i < 65; i += 1) {
      const response = await getInstallations(new NextRequest("https://app.local/api/v1/integrations/installations?limit=1", { headers: { authorization: `Bearer ${client.rawKey}` } }));
      lastStatus = response.status;
      if (response.status === 429) { sawRateLimit = true; expect(response.headers.get("retry-after")).toBeTruthy(); break; }
    }
    expect(sawRateLimit).toBe(true);
    void lastStatus;
  });
});
