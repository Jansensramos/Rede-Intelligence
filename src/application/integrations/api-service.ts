import { createHash, randomBytes } from "node:crypto";
import { Prisma, type ApiClient } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { assertIntegrationCapability } from "@/domain/integrations";

type IntegrationContext = Pick<AuthContext, "organizationId" | "userId" | "role">;
const json = (value: unknown) => value as Prisma.InputJsonValue;

/**
 * Fundação da API pública REDE (plano §29/§38): versionamento por URL (`/api/v1`),
 * API key com hash (nunca a chave em texto puro — mesmo princípio do
 * `CredentialReference`), scopes, idempotency key para writes e rate limit
 * (aplicado pelo chamador via `resilience-service`). Não é uma API de produção
 * completa: sem OpenAPI publicado, sem client SDK, sem rota pública liberada.
 */
export async function createApiClient(context: IntegrationContext, input: { name: string; scopes: string[] }) {
  assertIntegrationCapability(context.role, "INTEGRATION_API_MANAGE");
  const rawKey = `rede_v1_${randomBytes(24).toString("base64url")}`;
  const apiKeyHash = createHash("sha256").update(rawKey).digest("hex");
  const fingerprint = apiKeyHash.slice(0, 12);
  const client = await prisma.apiClient.create({
    data: { organizationId: context.organizationId, name: input.name, scopes: json(input.scopes), apiKeyHash, fingerprint, createdById: context.userId },
  });
  await prisma.auditLog.create({ data: { organizationId: context.organizationId, userId: context.userId, action: "API_CLIENT_CREATED", entityType: "ApiClient", entityId: client.id, after: json({ name: input.name, scopes: input.scopes, fingerprint }) } });
  return { client, rawKey }; // rawKey é retornado uma única vez; nunca persistido nem logado.
}

export async function authenticateApiRequest(rawKey: string): Promise<ApiClient | null> {
  const apiKeyHash = createHash("sha256").update(rawKey).digest("hex");
  const client = await prisma.apiClient.findUnique({ where: { apiKeyHash } });
  if (!client || client.status !== "ACTIVE") return null;
  return client;
}

export function assertApiScope(client: { scopes: unknown }, required: string) {
  const scopes = Array.isArray(client.scopes) ? (client.scopes as unknown[]).map(String) : [];
  if (!scopes.includes(required)) throw new Error(`Escopo ausente: ${required}.`);
}

export interface IdempotentApiResult<T> {
  statusCode: number;
  body: T;
  replayed: boolean;
}

/**
 * Aplica idempotência real a uma escrita da API pública: a mesma `Idempotency-Key`
 * do mesmo cliente sempre devolve a resposta original (nunca reexecuta o efeito);
 * a mesma chave com corpo de requisição diferente é rejeitada explicitamente.
 */
export async function withApiIdempotency<T>(
  client: Pick<ApiClient, "id" | "organizationId">,
  idempotencyKey: string | null,
  requestChecksum: string,
  handler: () => Promise<{ statusCode: number; body: T }>,
): Promise<IdempotentApiResult<T>> {
  if (!idempotencyKey) {
    const result = await handler();
    return { ...result, replayed: false };
  }
  const existing = await prisma.apiIdempotencyRecord.findUnique({ where: { apiClientId_idempotencyKey: { apiClientId: client.id, idempotencyKey } } });
  if (existing) {
    if (existing.requestChecksum !== requestChecksum) throw new Error("Idempotency-Key já usada com um corpo de requisição diferente.");
    return { statusCode: existing.statusCode, body: existing.responseSnapshot as T, replayed: true };
  }
  const result = await handler();
  await prisma.apiIdempotencyRecord.create({
    data: { organizationId: client.organizationId, apiClientId: client.id, idempotencyKey, requestChecksum, responseSnapshot: json(result.body), statusCode: result.statusCode },
  });
  return { ...result, replayed: false };
}

export interface VersionedApiError {
  error: { code: string; message: string; correlationId: string; version: "v1" };
}

export function buildVersionedError(code: string, message: string, correlationId: string): VersionedApiError {
  return { error: { code, message, correlationId, version: "v1" } };
}
