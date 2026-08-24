import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { createWebhookSubscription } from "./integrations-service";
import { deliverPendingOutboxEvents, enqueueOutboxEvent, type OutboundHttpAdapter } from "./webhook-delivery";

function fakeAdapter(statuses: number[]): OutboundHttpAdapter & { calls: number } {
  let index = 0;
  return {
    calls: 0,
    async send() {
      this.calls += 1;
      const status = statuses[Math.min(index, statuses.length - 1)];
      index += 1;
      return { status };
    },
  };
}

describe("Entrega de webhooks de saída (outbox → subscription → HTTP fake)", () => {
  let context: { organizationId: string; userId: string; role: "OWNER" };

  beforeAll(async () => {
    const membership = await prisma.organizationMembership.findFirstOrThrow({ where: { organization: { slug: "rede-nucleo-de-negocios" }, user: { email: "admin@rede.local" } } });
    context = { organizationId: membership.organizationId, userId: membership.userId, role: "OWNER" };
    await prisma.integrationDeadLetter.deleteMany({ where: { organizationId: context.organizationId, sourceType: "OUTBOX_EVENT" } });
    await prisma.integrationOutboxEvent.deleteMany({ where: { organizationId: context.organizationId } });
    await prisma.webhookSubscription.deleteMany({ where: { organizationId: context.organizationId } });
  });

  it("entrega com sucesso e nunca gera um segundo efeito para o mesmo evento", async () => {
    const subscription = await createWebhookSubscription(context, { endpointUrl: "https://consumer.example.com/webhooks/rede", events: ["sale.created"], secret: "demo-webhook-secret" });
    const entityId = randomUUID();
    await enqueueOutboxEvent(context.organizationId, { eventName: "sale.created", entityType: "Sale", entityId, payload: { amount: 1000 } });
    // enfileirar de novo com o mesmo fato é idempotente: nunca duplica o evento de saída.
    await enqueueOutboxEvent(context.organizationId, { eventName: "sale.created", entityType: "Sale", entityId, payload: { amount: 1000 } });
    const countBeforeDelivery = await prisma.integrationOutboxEvent.count({ where: { organizationId: context.organizationId, eventName: "sale.created", entityId } });
    expect(countBeforeDelivery).toBe(1);

    const adapter = fakeAdapter([200]);
    const firstRun = await deliverPendingOutboxEvents(context.organizationId, adapter);
    expect(firstRun.delivered).toBeGreaterThanOrEqual(1);
    expect(adapter.calls).toBeGreaterThanOrEqual(1);

    const callsAfterFirst = adapter.calls;
    const secondRun = await deliverPendingOutboxEvents(context.organizationId, adapter);
    expect(secondRun.attempted).toBe(0); // já DELIVERED: não é reconsiderado
    expect(adapter.calls).toBe(callsAfterFirst); // nenhuma chamada HTTP adicional — um evento, um efeito

    void subscription;
  });

  it("retry funciona: falha 5xx agenda nova tentativa e uma chamada futura entrega com sucesso", async () => {
    await createWebhookSubscription(context, { endpointUrl: "https://consumer-retry.example.com/webhooks/rede", events: ["payment.received"], secret: "demo-webhook-secret-2" });
    const entityId = randomUUID();
    await enqueueOutboxEvent(context.organizationId, { eventName: "payment.received", entityType: "Payment", entityId, payload: { amount: 500 } });

    const adapter = fakeAdapter([500, 200]);
    const now = new Date();
    const firstRun = await deliverPendingOutboxEvents(context.organizationId, adapter, now);
    expect(firstRun.retried).toBe(1);
    const afterFailure = await prisma.integrationOutboxEvent.findFirstOrThrow({ where: { organizationId: context.organizationId, eventName: "payment.received", entityId } });
    expect(afterFailure.status).toBe("FAILED");
    expect(afterFailure.nextAttemptAt).not.toBeNull();

    // simula o tempo passando até depois do próximo attempt agendado
    const later = new Date((afterFailure.nextAttemptAt as Date).getTime() + 10);
    const secondRun = await deliverPendingOutboxEvents(context.organizationId, adapter, later);
    expect(secondRun.delivered).toBe(1);
    const delivered = await prisma.integrationOutboxEvent.findFirstOrThrow({ where: { id: afterFailure.id } });
    expect(delivered.status).toBe("DELIVERED");
  });

  it("erro permanente (4xx) termina em dead-letter sem insistir indefinidamente", async () => {
    await createWebhookSubscription(context, { endpointUrl: "https://consumer-permanent.example.com/webhooks/rede", events: ["legal.obligation.due"], secret: "demo-webhook-secret-3" });
    const entityId = randomUUID();
    await enqueueOutboxEvent(context.organizationId, { eventName: "legal.obligation.due", entityType: "LegalObligation", entityId, payload: {} });

    const adapter = fakeAdapter([400]);
    await deliverPendingOutboxEvents(context.organizationId, adapter);
    const event = await prisma.integrationOutboxEvent.findFirstOrThrow({ where: { organizationId: context.organizationId, eventName: "legal.obligation.due", entityId } });
    expect(event.status).toBe("DEAD_LETTER");
    const deadLetter = await prisma.integrationDeadLetter.findFirstOrThrow({ where: { sourceType: "OUTBOX_EVENT", sourceId: event.id } });
    expect(deadLetter.reason).toContain("400");
  });

  it("bloqueia entrega para URL interna/SSRF mesmo que a subscription tenha sido criada antes", async () => {
    const subscription = await prisma.webhookSubscription.create({ data: { organizationId: context.organizationId, endpointUrl: "http://169.254.169.254/latest/meta-data", secretRef: "unused", events: ["budget.approved"], createdById: context.userId } });
    const entityId = randomUUID();
    await enqueueOutboxEvent(context.organizationId, { eventName: "budget.approved", entityType: "Budget", entityId, payload: {} });
    const adapter = fakeAdapter([200]);
    await deliverPendingOutboxEvents(context.organizationId, adapter);
    expect(adapter.calls).toBe(0); // nunca chega a chamar o adapter — bloqueado antes
    const event = await prisma.integrationOutboxEvent.findFirstOrThrow({ where: { organizationId: context.organizationId, eventName: "budget.approved", entityId } });
    expect(event.status).toBe("DEAD_LETTER");
    void subscription;
  });

  it("trata secretRef inexistente/corrompido como AUTHENTICATION e segue processando outros eventos do lote", async () => {
    // 1. Subscription com segredo inválido (arquivo inexistente no cofre)
    const brokenSubscription = await prisma.webhookSubscription.create({
      data: {
        organizationId: context.organizationId,
        endpointUrl: "https://consumer-broken-secret.example.com/webhooks/rede",
        secretRef: "non-existent-secret-ref-path-corrupted",
        events: ["user.created"],
        createdById: context.userId,
      },
    });

    // 2. Subscription válida com segredo íntegro no cofre
    const validSubscription = await createWebhookSubscription(context, {
      endpointUrl: "https://consumer-valid-secret.example.com/webhooks/rede",
      events: ["contract.signed"],
      secret: "valid-demo-secret-key-2026",
    });

    // 3. Enfileira ambos os eventos para o mesmo lote de entrega
    const brokenEntityId = randomUUID();
    const validEntityId = randomUUID();
    await enqueueOutboxEvent(context.organizationId, { eventName: "user.created", entityType: "User", entityId: brokenEntityId, payload: { name: "Teste" } });
    await enqueueOutboxEvent(context.organizationId, { eventName: "contract.signed", entityType: "OperationalContract", entityId: validEntityId, payload: { amount: 50000 } });

    // 4. Executa entrega do lote
    const adapter = fakeAdapter([200]);
    const runResult = await deliverPendingOutboxEvents(context.organizationId, adapter);

    // 5. O lote não foi derrubado: 2 tentados, 1 dead-letter (chave corrompida), 1 entregue com sucesso
    expect(runResult.attempted).toBe(2);
    expect(runResult.deadLettered).toBe(1);
    expect(runResult.delivered).toBe(1);
    expect(adapter.calls).toBe(1); // Somente o evento válido chamou o endpoint HTTP

    // 6. Evento com segredo corrompido vira DEAD_LETTER com classificação AUTHENTICATION
    const brokenEvent = await prisma.integrationOutboxEvent.findFirstOrThrow({ where: { organizationId: context.organizationId, eventName: "user.created", entityId: brokenEntityId } });
    expect(brokenEvent.status).toBe("DEAD_LETTER");
    const deadLetter = await prisma.integrationDeadLetter.findFirstOrThrow({ where: { sourceType: "OUTBOX_EVENT", sourceId: brokenEvent.id } });
    expect(deadLetter.errorClass).toBe("AUTHENTICATION");

    // 7. Evento válido foi entregue com sucesso
    const validEvent = await prisma.integrationOutboxEvent.findFirstOrThrow({ where: { organizationId: context.organizationId, eventName: "contract.signed", entityId: validEntityId } });
    expect(validEvent.status).toBe("DELIVERED");

    void brokenSubscription;
    void validSubscription;
  });
});
