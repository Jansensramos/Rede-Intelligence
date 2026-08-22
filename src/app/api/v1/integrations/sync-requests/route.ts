import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest, assertApiScope, buildVersionedError, withApiIdempotency, type VersionedApiError } from "@/application/integrations/api-service";
import { checkAndConsumeRateLimit } from "@/application/integrations/resilience-service";
import { enqueueJob } from "@/application/integrations/job-runner";
import { prisma } from "@/infrastructure/database/prisma";

/**
 * Fundação de API pública v1 — solicita sincronização assíncrona (nunca síncrona,
 * nunca destrutiva): apenas enfileira um `IntegrationJob`. Escopo
 * `integrations:sync`, `Idempotency-Key` obrigatório (a mesma chave sempre
 * devolve a mesma resposta, nunca enfileira duas vezes).
 */
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get("x-correlation-id") ?? randomUUID();
  const headers = { "x-correlation-id": correlationId, "x-api-version": "v1" };
  try {
    const authorization = request.headers.get("authorization");
    const rawKey = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    if (!rawKey) return NextResponse.json(buildVersionedError("UNAUTHENTICATED", "Cabeçalho Authorization: Bearer ausente.", correlationId), { status: 401, headers });

    const client = await authenticateApiRequest(rawKey);
    if (!client) return NextResponse.json(buildVersionedError("UNAUTHENTICATED", "Chave de API inválida ou revogada.", correlationId), { status: 401, headers });

    try {
      assertApiScope(client, "integrations:sync");
    } catch (error) {
      return NextResponse.json(buildVersionedError("FORBIDDEN", error instanceof Error ? error.message : "Escopo insuficiente.", correlationId), { status: 403, headers });
    }

    const rateLimit = await checkAndConsumeRateLimit(client.organizationId, `api-client:${client.id}:sync-requests`, { limit: 20, windowMs: 60_000 });
    if (!rateLimit.allowed) {
      return NextResponse.json(buildVersionedError("RATE_LIMIT", "Limite de requisições excedido.", correlationId), { status: 429, headers: { ...headers, "retry-after": String(Math.ceil(rateLimit.retryAfterMs / 1000)) } });
    }

    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) return NextResponse.json(buildVersionedError("VALIDATION", "Cabeçalho Idempotency-Key é obrigatório para esta operação.", correlationId), { status: 400, headers });

    const rawBody = await request.text();
    const body = rawBody ? JSON.parse(rawBody) as { installationId?: string; capability?: string } : {};
    if (!body.installationId || !body.capability) return NextResponse.json(buildVersionedError("VALIDATION", "installationId e capability são obrigatórios.", correlationId), { status: 400, headers });

    const requestChecksum = createHash("sha256").update(rawBody).digest("hex");

    type SyncRequestBody = VersionedApiError | { version: "v1"; correlationId: string; data: { jobId: string; status: string } };
    let idempotencyError: string | null = null;
    const result = await withApiIdempotency<SyncRequestBody>(client, idempotencyKey, requestChecksum, async () => {
      const installation = await prisma.connectorInstallation.findFirst({ where: { id: body.installationId, organizationId: client.organizationId } });
      if (!installation) return { statusCode: 404, body: buildVersionedError("NOT_FOUND", "Instalação não encontrada nesta organização.", correlationId) };
      const job = await enqueueJob({ organizationId: client.organizationId, installationId: installation.id, jobType: "SYNC_INSTALLATION", payload: { capability: body.capability }, correlationId: idempotencyKey });
      await prisma.auditLog.create({ data: { organizationId: client.organizationId, userId: client.createdById, action: "API_SYNC_REQUEST_ENQUEUED", entityType: "IntegrationJob", entityId: job.id, after: { installationId: installation.id, capability: body.capability, idempotencyKey } } });
      return { statusCode: 202, body: { version: "v1", correlationId, data: { jobId: job.id, status: job.status } } };
    }).catch((error: unknown) => { idempotencyError = error instanceof Error ? error.message : "Falha de idempotência."; return null; });

    if (idempotencyError) return NextResponse.json(buildVersionedError("IDEMPOTENCY_CONFLICT", idempotencyError, correlationId), { status: 409, headers });
    if (!result) return NextResponse.json(buildVersionedError("INTERNAL_ERROR", "Falha inesperada.", correlationId), { status: 500, headers });

    return NextResponse.json(result.body, { status: result.statusCode, headers: { ...headers, "x-idempotency-replayed": String(result.replayed) } });
  } catch (error) {
    return NextResponse.json(buildVersionedError("INTERNAL_ERROR", error instanceof Error ? error.message : "Falha inesperada.", correlationId), { status: 500, headers });
  }
}
