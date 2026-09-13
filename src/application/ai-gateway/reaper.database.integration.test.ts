import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { reapExpiredGatewayReservations } from "./reaper";
import { markGatewayExecutionTransportStarted, reserveGatewayExecution } from "./ledger-service";
import type { AiRequest } from "@/domain/ai-gateway";

/**
 * Correção focal pós-auditoria (achado MÉDIO "reserva órfã RUNNING"): prova real contra
 * PostgreSQL que o reaper libera com segurança só reservas QUEUED vencidas (transporte
 * comprovadamente nunca iniciado) e NUNCA toca reservas RUNNING vencidas (ambíguas).
 */

async function isolatedOrg(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organization = await prisma.organization.create({ data: { name: `REAPER ${label} ${suffix}`, slug: `reaper-${label}-${suffix}` } });
  const user = await prisma.user.create({ data: { name: `REAPER ${label}`, email: `reaper-${label}-${suffix}@test.local`, passwordHash: "test" } });
  const conversation = await prisma.aIConversation.create({ data: { organizationId: organization.id, title: "reaper-test", scope: "ORGANIZATION", contextSnapshot: {}, createdById: user.id } });
  await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 1000, createdById: user.id } });
  return { organization, user, conversation, ledger: { organizationId: organization.id, userId: user.id, conversationId: conversation.id } };
}
function req(overrides: Partial<AiRequest> = {}): AiRequest {
  return { correlationId: `c-${Math.random()}`, organizationId: "x", actorRef: "u", task: "CHAT", requiredCapabilities: ["TEXT_GENERATION"], dataClassification: "INTERNAL", criticality: "STANDARD", content: { systemInstructions: "s", trustedContext: "t" }, ...overrides };
}
async function backdateStartedAt(executionLogId: string, when: Date) {
  await prisma.aIExecutionLog.update({ where: { id: executionLogId }, data: { startedAt: when } });
}
const disposed: string[] = [];
async function cleanup(organizationId: string) {
  await prisma.aIPendingAction.deleteMany({ where: { organizationId } });
  await prisma.aIExecutionLog.deleteMany({ where: { organizationId } });
  await prisma.aIUsageBudget.deleteMany({ where: { organizationId } });
  await prisma.aIConversation.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } }).catch(() => {});
}

describe.sequential("reaper - reservas expiradas (correção focal, achado MÉDIO)", () => {
  afterAll(async () => { for (const id of disposed) await cleanup(id); await prisma.$disconnect(); });

  it("expiração ANTES do transporte (QUEUED vencida) libera com segurança e não conta mais para o orçamento", async () => {
    const { organization, ledger } = await isolatedOrg("queued-expire");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    await backdateStartedAt(outcome.executionLogId, new Date(Date.now() - 10 * 60_000));
    const result = await reapExpiredGatewayReservations({ organizationId: organization.id, staleAfterMs: 5 * 60_000 });
    expect(result.releasedExecutionLogIds).toEqual([outcome.executionLogId]);
    expect(result.ambiguousExecutionLogIds).toEqual([]);
    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    expect(log.status).toBe("FAILED");
    expect(Number(log.estimatedCost)).toBe(0);
    expect(log.errorCode).toBe("TIMEOUT");
    const pending = await prisma.aIPendingAction.findUniqueOrThrow({ where: { id: outcome.pendingActionId } });
    expect(pending.status).toBe("EXPIRED");
    const spend = await prisma.aIExecutionLog.aggregate({ where: { organizationId: organization.id, status: { notIn: ["FAILED", "CANCELLED"] } }, _sum: { estimatedCost: true } });
    expect(Number(spend._sum.estimatedCost ?? 0)).toBe(0);
  });

  it("execução ativa (QUEUED recente, dentro do limite) NÃO expira", async () => {
    const { organization, ledger } = await isolatedOrg("queued-active");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    const result = await reapExpiredGatewayReservations({ organizationId: organization.id, staleAfterMs: 5 * 60_000 });
    expect(result.releasedExecutionLogIds).toEqual([]);
    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    expect(log.status).toBe("QUEUED");
  });

  it("execução RUNNING vencida (ambígua) NUNCA é liberada automaticamente - só é contada", async () => {
    const { organization, ledger } = await isolatedOrg("running-ambiguous");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    await markGatewayExecutionTransportStarted(outcome.executionLogId, outcome.pendingActionId); // simula "transporte iniciado"
    await backdateStartedAt(outcome.executionLogId, new Date(Date.now() - 10 * 60_000));
    const result = await reapExpiredGatewayReservations({ organizationId: organization.id, staleAfterMs: 5 * 60_000 });
    expect(result.releasedExecutionLogIds).toEqual([]);
    expect(result.ambiguousExecutionLogIds).toEqual([outcome.executionLogId]);
    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    expect(log.status).toBe("RUNNING"); // intocada
    expect(Number(log.estimatedCost)).toBeCloseTo(10, 5); // continua contando contra o orçamento (conservador, nunca libera cobrança ambígua)
    const pending = await prisma.aIPendingAction.findUniqueOrThrow({ where: { id: outcome.pendingActionId } });
    expect(pending.status).toBe("EXECUTING"); // intocada
  });

  it("retry posterior (com nova idempotencyKey) após uma reserva RUNNING ambígua continua bloqueado pelo orçamento consumido - seguro por padrão", async () => {
    const { organization, ledger } = await isolatedOrg("running-ambiguous-retry");
    disposed.push(organization.id);
    const first = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (first.kind !== "RESERVED") throw new Error("unreachable");
    await markGatewayExecutionTransportStarted(first.executionLogId, first.pendingActionId);
    await backdateStartedAt(first.executionLogId, new Date(Date.now() - 10 * 60_000));
    await reapExpiredGatewayReservations({ organizationId: organization.id, staleAfterMs: 5 * 60_000 });
    // Orçamento é 1000 - sobra de sobra; o ponto é que a linha RUNNING ambígua continua
    // contando (10 USD), nunca é zerada pelo reaper.
    const spend = await prisma.aIExecutionLog.aggregate({ where: { organizationId: organization.id, status: { notIn: ["FAILED", "CANCELLED"] } }, _sum: { estimatedCost: true } });
    expect(Number(spend._sum.estimatedCost ?? 0)).toBeCloseTo(10, 5);
  });

  it("concorrência de dois reapers no mesmo lote: exatamente uma liberação, nenhuma dupla (CAS real)", async () => {
    const { organization, ledger } = await isolatedOrg("race-two-reapers");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    await backdateStartedAt(outcome.executionLogId, new Date(Date.now() - 10 * 60_000));
    const [a, b] = await Promise.all([
      reapExpiredGatewayReservations({ organizationId: organization.id, staleAfterMs: 5 * 60_000 }),
      reapExpiredGatewayReservations({ organizationId: organization.id, staleAfterMs: 5 * 60_000 }),
    ]);
    const totalReleased = a.releasedExecutionLogIds.length + b.releasedExecutionLogIds.length;
    expect(totalReleased).toBe(1); // exatamente um dos dois reapers venceu a corrida (CAS)
    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    expect(log.status).toBe("FAILED");
    expect(Number(log.estimatedCost)).toBe(0);
  });

  it("cross-tenant: reaper com organizationId não toca reservas de outra organização", async () => {
    const a = await isolatedOrg("tenant-a"); disposed.push(a.organization.id);
    const b = await isolatedOrg("tenant-b"); disposed.push(b.organization.id);
    const outcomeA = await reserveGatewayExecution(a.ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    const outcomeB = await reserveGatewayExecution(b.ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcomeA.kind !== "RESERVED" || outcomeB.kind !== "RESERVED") throw new Error("unreachable");
    await backdateStartedAt(outcomeA.executionLogId, new Date(Date.now() - 10 * 60_000));
    await backdateStartedAt(outcomeB.executionLogId, new Date(Date.now() - 10 * 60_000));
    const result = await reapExpiredGatewayReservations({ organizationId: a.organization.id, staleAfterMs: 5 * 60_000 });
    expect(result.releasedExecutionLogIds).toEqual([outcomeA.executionLogId]);
    const logB = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcomeB.executionLogId } });
    expect(logB.status).toBe("QUEUED"); // organização B não foi tocada
  });

  it("relógio avançado (now injetado): uma reserva recente pode ser tratada como vencida quando o relógio do teste avança", async () => {
    const { organization, ledger } = await isolatedOrg("clock-advance");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    const advancedNow = new Date(Date.now() + 10 * 60_000);
    const result = await reapExpiredGatewayReservations({ organizationId: organization.id, staleAfterMs: 5 * 60_000, now: advancedNow });
    expect(result.releasedExecutionLogIds).toEqual([outcome.executionLogId]);
  });

  it("lote parcial (batchLimit): respeita o limite, não processa mais que o pedido em uma chamada", async () => {
    const { organization, ledger } = await isolatedOrg("batch-limit");
    disposed.push(organization.id);
    const ids: string[] = [];
    // Reserva as 3 primeiro, SEM backdate ainda - correção crítica pós-reauditoria (achado
    // MÉDIO "reaper sem call site produtivo"): `reserveGatewayExecution` agora roda uma
    // recuperação oportunística antes de cada nova reserva; se a linha anterior já
    // estivesse vencida no momento da reserva seguinte, ela seria liberada ali mesmo,
    // nunca chegando às 3 QUEUED simultâneas que este teste precisa para testar o limite
    // de lote do reaper EXPLÍCITO abaixo.
    for (let i = 0; i < 3; i += 1) {
      const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: `k-${i}` }), 1_000_000, "v1", "disabled", "m");
      if (outcome.kind !== "RESERVED") throw new Error("unreachable");
      ids.push(outcome.executionLogId);
    }
    for (const id of ids) await backdateStartedAt(id, new Date(Date.now() - 10 * 60_000));
    const result = await reapExpiredGatewayReservations({ organizationId: organization.id, staleAfterMs: 5 * 60_000, batchLimit: 2 });
    expect(result.releasedExecutionLogIds.length).toBe(2);
  });

  it("idempotência: rodar o reaper duas vezes seguidas sobre o mesmo lote não causa efeito duplicado", async () => {
    const { organization, ledger } = await isolatedOrg("idempotent-reaper");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    await backdateStartedAt(outcome.executionLogId, new Date(Date.now() - 10 * 60_000));
    const first = await reapExpiredGatewayReservations({ organizationId: organization.id, staleAfterMs: 5 * 60_000 });
    const second = await reapExpiredGatewayReservations({ organizationId: organization.id, staleAfterMs: 5 * 60_000 });
    expect(first.releasedExecutionLogIds).toEqual([outcome.executionLogId]);
    expect(second.releasedExecutionLogIds).toEqual([]); // já não está mais QUEUED - nada para liberar de novo
    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    expect(Number(log.estimatedCost)).toBe(0); // não foi "liberado" duas vezes de forma que corrompesse o valor
  });

  it("AuditLog/AIExecutionLog e AIPendingAction ficam coerentes juntos (nunca um FAILED com o outro ainda EXECUTING)", async () => {
    const { organization, ledger } = await isolatedOrg("coherent-pair");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    await backdateStartedAt(outcome.executionLogId, new Date(Date.now() - 10 * 60_000));
    await reapExpiredGatewayReservations({ organizationId: organization.id, staleAfterMs: 5 * 60_000 });
    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    const pending = await prisma.aIPendingAction.findUniqueOrThrow({ where: { id: outcome.pendingActionId } });
    expect(log.status).toBe("FAILED");
    expect(pending.status).toBe("EXPIRED");
  });
});
