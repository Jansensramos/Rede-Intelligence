import { createHash, createHmac, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import { integrationSecretVault } from "@/infrastructure/security/local-secret-vault";
import { assertSafeExternalUrl, decideRetry, type RetryableErrorClass } from "@/domain/integrations";
import { checkCircuitBreakerGate, recordCircuitBreakerOutcome } from "./resilience-service";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const CIRCUIT_POLICY = { failureThreshold: 5, cooldownMs: 60_000 };

/**
 * Adapter HTTP de saída, injetável — em produção seria `fetch`; nos testes é um
 * fake determinístico (plano §8: "não fazer chamadas reais nos testes").
 */
export interface OutboundHttpAdapter {
  send(input: { url: string; body: string; headers: Record<string, string> }): Promise<{ status: number }>;
}

export async function enqueueOutboxEvent(organizationId: string, input: { eventName: string; eventVersion?: number; entityType: string; entityId: string; payload: unknown }) {
  const eventVersion = input.eventVersion ?? 1;
  const idempotencyKey = `${organizationId}:${input.eventName}:${input.entityType}:${input.entityId}:${eventVersion}`;
  // upsert com update vazio = enfileiramento idempotente: reenviar o mesmo fato nunca duplica o evento de saída.
  return prisma.integrationOutboxEvent.upsert({
    where: { idempotencyKey },
    update: {},
    create: { organizationId, eventName: input.eventName, eventVersion, entityType: input.entityType, entityId: input.entityId, payload: json(input.payload), idempotencyKey, correlationId: randomUUID() },
  });
}

function matchesSubscription(events: unknown, eventName: string) {
  return Array.isArray(events) && (events.includes("*") || events.includes(eventName));
}

async function handleDeliveryFailure(event: { id: string; organizationId: string; attemptCount: number; payload: unknown }, errorClass: RetryableErrorClass, message: string) {
  const decision = decideRetry({ errorClass, attemptCount: event.attemptCount });
  if (decision.action === "RETRY") {
    await prisma.integrationOutboxEvent.update({ where: { id: event.id }, data: { status: "FAILED", attemptCount: { increment: 1 }, nextAttemptAt: new Date(Date.now() + decision.delayMs) } });
    return decision;
  }
  await prisma.$transaction([
    prisma.integrationOutboxEvent.update({ where: { id: event.id }, data: { status: "DEAD_LETTER", attemptCount: { increment: 1 } } }),
    prisma.integrationDeadLetter.create({ data: { organizationId: event.organizationId, sourceType: "OUTBOX_EVENT", sourceId: event.id, reason: message, errorClass, payload: event.payload ?? undefined } }),
  ]);
  return decision;
}

export interface DeliveryRunResult {
  attempted: number;
  delivered: number;
  retried: number;
  deadLettered: number;
  skippedCircuitOpen: number;
}

/**
 * Entrega eventos pendentes do outbox às subscriptions ativas: assina o corpo
 * (HMAC-SHA256 com o segredo do cofre, nunca exposto), aplica circuit breaker por
 * subscription e classifica o resultado em DELIVERED/retry/dead-letter.
 * Idempotência de efeito: um evento já DELIVERED nunca é reconsiderado (fora do
 * filtro `status IN (PENDING, FAILED)`), então rodar esta função de novo não gera
 * um segundo efeito para o mesmo evento.
 */
export async function deliverPendingOutboxEvents(organizationId: string, adapter: OutboundHttpAdapter, now = new Date()): Promise<DeliveryRunResult> {
  const subscriptions = await prisma.webhookSubscription.findMany({ where: { organizationId, status: "ACTIVE" } });
  const pending = await prisma.integrationOutboxEvent.findMany({
    where: { organizationId, status: { in: ["PENDING", "FAILED"] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    orderBy: { createdAt: "asc" },
  });

  const result: DeliveryRunResult = { attempted: 0, delivered: 0, retried: 0, deadLettered: 0, skippedCircuitOpen: 0 };

  for (const event of pending) {
    const subscription = subscriptions.find((item) => matchesSubscription(item.events, event.eventName));
    if (!subscription) continue;
    result.attempted += 1;

    try {
      assertSafeExternalUrl(subscription.endpointUrl);
    } catch (error) {
      await handleDeliveryFailure(event, "VALIDATION", error instanceof Error ? error.message : "URL de destino bloqueada.");
      result.deadLettered += 1;
      continue;
    }

    const scopeKey = `webhook-subscription:${subscription.id}`;
    const breakerDecision = await checkCircuitBreakerGate(organizationId, scopeKey, CIRCUIT_POLICY, now);
    if (!breakerDecision.allow) { result.skippedCircuitOpen += 1; continue; }

    let secret: string;
    try {
      secret = await integrationSecretVault.read(subscription.secretRef);
    } catch (error) {
      const decision = await handleDeliveryFailure(event, "AUTHENTICATION", error instanceof Error ? error.message : "Chave de assinatura de webhook inacessível.");
      if (decision.action === "RETRY") result.retried += 1; else result.deadLettered += 1;
      continue;
    }
    const body = JSON.stringify({ eventId: event.id, eventName: event.eventName, eventVersion: event.eventVersion, entityType: event.entityType, entityId: event.entityId, payload: event.payload });
    const signature = createHmac("sha256", secret).update(body).digest("hex");

    let response: { status: number } | null = null;
    try {
      response = await adapter.send({ url: subscription.endpointUrl, body, headers: { "content-type": "application/json", "x-rede-signature": signature, "x-rede-event-id": event.id } });
    } catch (error) {
      await recordCircuitBreakerOutcome(organizationId, scopeKey, false, CIRCUIT_POLICY, now);
      const decision = await handleDeliveryFailure(event, "NETWORK", error instanceof Error ? error.message : "Falha de rede na entrega.");
      if (decision.action === "RETRY") result.retried += 1; else result.deadLettered += 1;
      continue;
    }

    if (response.status >= 200 && response.status < 300) {
      await recordCircuitBreakerOutcome(organizationId, scopeKey, true, CIRCUIT_POLICY, now);
      await prisma.integrationOutboxEvent.update({ where: { id: event.id }, data: { status: "DELIVERED", deliveredAt: now, subscriptionId: subscription.id } });
      result.delivered += 1;
    } else if (response.status === 429) {
      await recordCircuitBreakerOutcome(organizationId, scopeKey, false, CIRCUIT_POLICY, now);
      const decision = await handleDeliveryFailure(event, "RATE_LIMIT", "HTTP 429 do consumidor.");
      if (decision.action === "RETRY") result.retried += 1; else result.deadLettered += 1;
    } else if (response.status >= 500) {
      await recordCircuitBreakerOutcome(organizationId, scopeKey, false, CIRCUIT_POLICY, now);
      const decision = await handleDeliveryFailure(event, "PROVIDER", `HTTP ${response.status} do consumidor.`);
      if (decision.action === "RETRY") result.retried += 1; else result.deadLettered += 1;
    } else {
      // 4xx (exceto 429): erro permanente do lado do consumidor — nunca insiste indefinidamente.
      await recordCircuitBreakerOutcome(organizationId, scopeKey, true, CIRCUIT_POLICY, now);
      await prisma.$transaction([
        prisma.integrationOutboxEvent.update({ where: { id: event.id }, data: { status: "DEAD_LETTER", attemptCount: { increment: 1 } } }),
        prisma.integrationDeadLetter.create({ data: { organizationId, sourceType: "OUTBOX_EVENT", sourceId: event.id, reason: `HTTP ${response.status} do consumidor.`, errorClass: "VALIDATION", payload: event.payload ?? undefined } }),
      ]);
      result.deadLettered += 1;
    }
  }

  return result;
}

export const webhookDeliveryInternals = { matchesSubscription, checksum: (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex") };
