import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest, assertApiScope, buildVersionedError } from "@/application/integrations/api-service";
import { checkAndConsumeRateLimit } from "@/application/integrations/resilience-service";
import { prisma } from "@/infrastructure/database/prisma";
import { reportInternalError, safeOperatorError } from "@/infrastructure/http/safe-error";

/**
 * Fundação de API pública v1 — leitura de instalações de conector, somente
 * escopo `integrations:read`. Não expõe credencial, segredo ou payload bruto.
 */
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get("x-correlation-id") ?? randomUUID();
  const headers = { "x-correlation-id": correlationId, "x-api-version": "v1" };
  try {
    const authorization = request.headers.get("authorization");
    const rawKey = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    if (!rawKey) return NextResponse.json(buildVersionedError("UNAUTHENTICATED", "Cabeçalho Authorization: Bearer ausente.", correlationId), { status: 401, headers });

    const client = await authenticateApiRequest(rawKey);
    if (!client) return NextResponse.json(buildVersionedError("UNAUTHENTICATED", "Chave de API inválida ou revogada.", correlationId), { status: 401, headers });

    try {
      assertApiScope(client, "integrations:read");
    } catch (error) {
      return NextResponse.json(buildVersionedError("FORBIDDEN", error instanceof Error ? error.message : "Escopo insuficiente.", correlationId), { status: 403, headers });
    }

    const rateLimit = await checkAndConsumeRateLimit(client.organizationId, `api-client:${client.id}:installations`, { limit: 60, windowMs: 60_000 });
    if (!rateLimit.allowed) {
      return NextResponse.json(buildVersionedError("RATE_LIMIT", "Limite de requisições excedido.", correlationId), { status: 429, headers: { ...headers, "retry-after": String(Math.ceil(rateLimit.retryAfterMs / 1000)) } });
    }

    const cursor = request.nextUrl.searchParams.get("cursor");
    const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 20) || 20));
    const installations = await prisma.connectorInstallation.findMany({
      where: { organizationId: client.organizationId, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: limit + 1,
      select: { id: true, name: true, status: true, healthStatus: true, direction: true, lastSyncAt: true, connectorDefinition: { select: { code: true, provider: true } } },
    });
    const hasMore = installations.length > limit;
    const page = installations.slice(0, limit);

    return NextResponse.json(
      {
        version: "v1",
        correlationId,
        data: page.map((item) => ({ id: item.id, name: item.name, provider: item.connectorDefinition.provider, connectorCode: item.connectorDefinition.code, status: item.status, healthStatus: item.healthStatus, direction: item.direction, lastSyncAt: item.lastSyncAt?.toISOString() ?? null })),
        pagination: { nextCursor: hasMore ? page[page.length - 1].id : null, hasMore },
      },
      { status: 200, headers },
    );
  } catch (error) {
    reportInternalError(error, { component: "api-v1-integrations", event: "installations_failed", correlationId });
    return NextResponse.json(buildVersionedError("INTERNAL_ERROR", safeOperatorError(correlationId), correlationId), { status: 500, headers });
  }
}
