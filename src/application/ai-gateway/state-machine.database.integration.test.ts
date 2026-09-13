import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { reapExpiredGatewayReservations } from "./reaper";
import {
  confirmGatewayExecution,
  markGatewayExecutionTransportStarted,
  releaseGatewayExecution,
  reserveGatewayExecution,
  type GatewayLedgerContext,
} from "./ledger-service";
import * as ledgerService from "./ledger-service";
import { createAiGateway } from "./gateway";
import type { AiModelProfile, AiProviderAdapter, AiRequest, AiResponse, AiRoutingPolicy } from "@/domain/ai-gateway";

/**
 * Correção crítica pós-reauditoria (achado CRÍTICO "reserva expirada ressuscita"): prova
 * real contra PostgreSQL, com concorrência real (`Promise.all`, nunca `setTimeout`/delay
 * como "barreira"), de que a máquina de estados QUEUED -> RUNNING -> {COMPLETED|FAILED} é
 * atômica ponta a ponta e que um estado terminal nunca é ressuscitado por uma operação
 * tardia (confirm/release/reaper chegando fora de ordem).
 *
 * Invariantes cobertas:
 *   1. `adapter.execute` iniciado ⇒ AIExecutionLog e AIPendingAction já estão RUNNING/EXECUTING.
 *   2. Estado terminal ⇒ nenhuma operação automática posterior pode ressuscitá-lo.
 *   3. Reserva liberada (FAILED pelo reaper) ⇒ nenhum transporte relacionado pode começar depois.
 */

async function isolatedOrg(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organization = await prisma.organization.create({ data: { name: `SM ${label} ${suffix}`, slug: `sm-${label}-${suffix}` } });
  const user = await prisma.user.create({ data: { name: `SM ${label}`, email: `sm-${label}-${suffix}@test.local`, passwordHash: "test" } });
  const conversation = await prisma.aIConversation.create({ data: { organizationId: organization.id, title: "state-machine-test", scope: "ORGANIZATION", contextSnapshot: {}, createdById: user.id } });
  await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 1000, createdById: user.id } });
  return { organization, user, conversation, ledger: { organizationId: organization.id, userId: user.id, conversationId: conversation.id } as GatewayLedgerContext };
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

const FAKE_PROFILE: AiModelProfile = { provider: "fake", modelRef: "fake-model", capabilities: ["TEXT_GENERATION"], contextWindowTokens: 8000, maxOutputTokens: 1000, supportsJsonSchema: false, safetyTier: "STANDARD", retentionPolicy: "ZERO_RETENTION_CONFIRMED" };
function fakePolicy(): AiRoutingPolicy {
  return { organizationId: "any", task: "CHAT", allowedProviders: ["fake"], allowedModelsByCapability: { TEXT_GENERATION: ["fake"], STRUCTURED_OUTPUT: [], EMBEDDINGS: [], VISION: [], TOOL_USE: [], STREAMING: [] }, fallbackChain: [], maxFallbackAttempts: 0 };
}
class SpyAdapter implements AiProviderAdapter {
  readonly ref = "fake";
  readonly profile = FAKE_PROFILE;
  calls = 0;
  async execute(request: AiRequest): Promise<AiResponse> {
    this.calls += 1;
    return { correlationId: request.correlationId, status: "OK", content: "x", evidenceRefs: [], usage: { inputUnits: 1, outputUnits: 1, estimatedCostUsdMicros: 10, latencyMs: 1 }, routing: { provider: "fake", model: "fake-model", fallbackCount: 0, retryCount: 0 }, policyVersion: "", promptVersion: "" };
  }
}

describe.skipIf(!process.env.DATABASE_URL).sequential("máquina de estados QUEUED→RUNNING→terminal (correção crítica pós-reauditoria)", () => {
  afterAll(async () => { for (const id of disposed) await cleanup(id); await prisma.$disconnect(); });

  it("reaper vence antes de mark RUNNING: mark retorna transitioned=false, reasonCode explícito, adapter nunca chamado", async () => {
    const { organization, ledger } = await isolatedOrg("reaper-wins");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    await backdateStartedAt(outcome.executionLogId, new Date(Date.now() - 10 * 60_000));
    const reap = await reapExpiredGatewayReservations({ organizationId: organization.id, staleAfterMs: 5 * 60_000 });
    expect(reap.releasedExecutionLogIds).toEqual([outcome.executionLogId]);

    const mark = await markGatewayExecutionTransportStarted(outcome.executionLogId, outcome.pendingActionId);
    expect(mark).toEqual({ transitioned: false, reasonCode: "RESERVATION_NOT_ACTIVE" });
    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    expect(log.status).toBe("FAILED"); // NUNCA ressuscitado para RUNNING
    expect(Number(log.estimatedCost)).toBe(0); // orçamento continua liberado
  });

  it("mark RUNNING vence antes do reaper: reaper não toca a linha (já não é mais QUEUED)", async () => {
    const { organization, ledger } = await isolatedOrg("mark-wins");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    const mark = await markGatewayExecutionTransportStarted(outcome.executionLogId, outcome.pendingActionId);
    expect(mark).toEqual({ transitioned: true });
    await backdateStartedAt(outcome.executionLogId, new Date(Date.now() - 10 * 60_000));
    const reap = await reapExpiredGatewayReservations({ organizationId: organization.id, staleAfterMs: 5 * 60_000 });
    expect(reap.releasedExecutionLogIds).toEqual([]);
    expect(reap.ambiguousExecutionLogIds).toEqual([outcome.executionLogId]);
    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    expect(log.status).toBe("RUNNING");
  });

  it("reaper e mark chegam simultaneamente (Promise.all real): exatamente uma transição vence, nunca as duas", async () => {
    const { organization, ledger } = await isolatedOrg("simultaneous");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    await backdateStartedAt(outcome.executionLogId, new Date(Date.now() - 10 * 60_000));
    const [reap, mark] = await Promise.all([
      reapExpiredGatewayReservations({ organizationId: organization.id, staleAfterMs: 5 * 60_000 }),
      markGatewayExecutionTransportStarted(outcome.executionLogId, outcome.pendingActionId),
    ]);
    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    if (reap.releasedExecutionLogIds.length === 1) {
      // reaper venceu: mark deve ter perdido o CAS, linha permanece FAILED
      expect(mark.transitioned).toBe(false);
      expect(log.status).toBe("FAILED");
    } else {
      // mark venceu: reaper não encontrou candidata QUEUED, linha é RUNNING
      expect(mark.transitioned).toBe(true);
      expect(log.status).toBe("RUNNING");
    }
    // Nunca os dois "vencem" ao mesmo tempo (não existe estado intermediário/corrompido).
    expect(reap.releasedExecutionLogIds.length === 1 && mark.transitioned === true).toBe(false);
  });

  it("adapter spy: zero chamadas quando o CAS de mark é perdido (reserva já expirada pelo reaper)", async () => {
    const { organization, ledger } = await isolatedOrg("adapter-spy-zero-calls");
    disposed.push(organization.id);
    const spy = vi.spyOn(ledgerService, "markGatewayExecutionTransportStarted").mockResolvedValueOnce({ transitioned: false, reasonCode: "RESERVATION_NOT_ACTIVE" });
    try {
      const adapter = new SpyAdapter();
      const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger });
      await expect(gateway.execute(req({ organizationId: organization.id, idempotencyKey: "spy-key" }))).rejects.toMatchObject({ code: "RESERVATION_EXPIRED" });
      expect(adapter.calls).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("confirm após FAILED (reaper já expirou): rejeita fechado, nunca ressuscita, nunca cobra de novo", async () => {
    const { organization, ledger } = await isolatedOrg("confirm-after-failed");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    await backdateStartedAt(outcome.executionLogId, new Date(Date.now() - 10 * 60_000));
    await reapExpiredGatewayReservations({ organizationId: organization.id, staleAfterMs: 5 * 60_000 });
    await expect(
      confirmGatewayExecution(outcome.executionLogId, outcome.pendingActionId, { inputUnits: 1, outputUnits: 1, observedCostUsdMicros: 5_000_000, latencyMs: 1 }, "c1"),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    expect(log.status).toBe("FAILED");
    expect(Number(log.estimatedCost)).toBe(0); // nunca ressuscitado, orçamento nunca cobrado depois de liberado
    const pending = await prisma.aIPendingAction.findUniqueOrThrow({ where: { id: outcome.pendingActionId } });
    expect(pending.status).toBe("EXPIRED"); // também nunca ressuscitada
  });

  it("confirm após COMPLETED com valores diferentes: rejeita fechado sem mutar (nunca sobrescreve um resultado já confirmado)", async () => {
    const { organization, ledger } = await isolatedOrg("confirm-after-completed-diff");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    await markGatewayExecutionTransportStarted(outcome.executionLogId, outcome.pendingActionId);
    await confirmGatewayExecution(outcome.executionLogId, outcome.pendingActionId, { inputUnits: 5, outputUnits: 5, observedCostUsdMicros: 9_000_000, latencyMs: 10 }, "c1");
    await expect(
      confirmGatewayExecution(outcome.executionLogId, outcome.pendingActionId, { inputUnits: 999, outputUnits: 999, observedCostUsdMicros: 1, latencyMs: 1 }, "c2"),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    expect(log.inputTokens).toBe(5); // valor original preservado, nunca sobrescrito
    expect(Number(log.estimatedCost)).toBeCloseTo(9, 5);
  });

  it("confirm após COMPLETED com valores IDÊNTICOS: retorno idempotente, sem mutação", async () => {
    const { organization, ledger } = await isolatedOrg("confirm-after-completed-same");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    await markGatewayExecutionTransportStarted(outcome.executionLogId, outcome.pendingActionId);
    const usage = { inputUnits: 5, outputUnits: 5, observedCostUsdMicros: 9_000_000, latencyMs: 10 };
    const first = await confirmGatewayExecution(outcome.executionLogId, outcome.pendingActionId, usage, "c1");
    expect(first).toEqual({ outcome: "CONFIRMED" });
    const second = await confirmGatewayExecution(outcome.executionLogId, outcome.pendingActionId, usage, "c1-retry");
    expect(second).toEqual({ outcome: "ALREADY_CONFIRMED_IDENTICAL" });
  });

  it("release após FAILED: no-op seguro (released=false), nunca ressuscita nem re-zera duas vezes de forma corrompida", async () => {
    const { organization, ledger } = await isolatedOrg("release-after-failed");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    const first = await releaseGatewayExecution(outcome.executionLogId, outcome.pendingActionId, "PROVIDER_UNAVAILABLE");
    expect(first).toEqual({ released: true });
    const second = await releaseGatewayExecution(outcome.executionLogId, outcome.pendingActionId, "TIMEOUT");
    expect(second).toEqual({ released: false });
    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    expect(log.errorCode).toBe("PROVIDER_UNAVAILABLE"); // o segundo release não sobrescreveu o reasonCode
  });

  it("release após COMPLETED: no-op seguro, resultado confirmado nunca é revertido para FAILED", async () => {
    const { organization, ledger } = await isolatedOrg("release-after-completed");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    await markGatewayExecutionTransportStarted(outcome.executionLogId, outcome.pendingActionId);
    await confirmGatewayExecution(outcome.executionLogId, outcome.pendingActionId, { inputUnits: 1, outputUnits: 1, observedCostUsdMicros: 3_000_000, latencyMs: 1 }, "c1");
    const release = await releaseGatewayExecution(outcome.executionLogId, outcome.pendingActionId, "TIMEOUT");
    expect(release).toEqual({ released: false });
    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    expect(log.status).toBe("COMPLETED");
    expect(Number(log.estimatedCost)).toBeCloseTo(3, 5); // custo confirmado nunca é zerado por um release tardio
  });

  it("release concorrente com confirm (Promise.all real) sobre a mesma execução RUNNING: release é SEMPRE no-op (achado CRÍTICO fechado) - confirm sempre vence", async () => {
    const { organization, ledger } = await isolatedOrg("release-vs-confirm");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    await markGatewayExecutionTransportStarted(outcome.executionLogId, outcome.pendingActionId);
    // Correção crítica DEFINITIVA: `releaseGatewayExecution` não aceita mais RUNNING como
    // origem - não existe mais uma corrida real de "quem vence" aqui, o release é
    // estruturalmente garantido a ser um no-op sobre uma linha RUNNING; o teste confirma
    // exatamente isso sob concorrência real.
    const [confirmResult, releaseResult] = await Promise.allSettled([
      confirmGatewayExecution(outcome.executionLogId, outcome.pendingActionId, { inputUnits: 2, outputUnits: 2, observedCostUsdMicros: 4_000_000, latencyMs: 2 }, "c1"),
      releaseGatewayExecution(outcome.executionLogId, outcome.pendingActionId, "TIMEOUT"),
    ]);
    expect(confirmResult.status).toBe("fulfilled");
    expect(releaseResult.status === "fulfilled" && (releaseResult as PromiseFulfilledResult<{ released: boolean }>).value.released).toBe(false);
    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    expect(log.status).toBe("COMPLETED");
    expect(Number(log.estimatedCost)).toBeCloseTo(4, 5);
    const pending = await prisma.aIPendingAction.findUniqueOrThrow({ where: { id: outcome.pendingActionId } });
    expect(pending.status).toBe("COMPLETED");
  });

  it("dois confirms concorrentes (Promise.all real) com o MESMO resultado: exatamente um confirma; o outro é idempotente OU rejeitado fechado - nunca dois COMPLETED conflitantes, nunca custo duplicado", async () => {
    const { organization, ledger } = await isolatedOrg("double-confirm");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    await markGatewayExecutionTransportStarted(outcome.executionLogId, outcome.pendingActionId);
    const usage = { inputUnits: 3, outputUnits: 3, observedCostUsdMicros: 6_000_000, latencyMs: 3 };
    const [a, b] = await Promise.allSettled([
      confirmGatewayExecution(outcome.executionLogId, outcome.pendingActionId, usage, "c1"),
      confirmGatewayExecution(outcome.executionLogId, outcome.pendingActionId, usage, "c2"),
    ]);
    // Sob concorrência real, a chamada perdedora pode observar o CAS já perdido antes de
    // ler o estado terminal (rejeição fechada, INVALID_RESPONSE) OU observar COMPLETED com
    // valores idênticos (retorno idempotente) - a ordem exata depende do timing do lock do
    // Postgres. Ambos são seguros; o único invariante exigido é: exatamente uma escrita real
    // aconteceu, nunca duas, nunca o custo duplicado/corrompido.
    const results = [a, b];
    const confirmed = results.filter((result) => result.status === "fulfilled" && result.value.outcome === "CONFIRMED");
    const idempotentOrRejected = results.filter((result) => result.status === "rejected" || (result.status === "fulfilled" && result.value.outcome === "ALREADY_CONFIRMED_IDENTICAL"));
    expect(confirmed.length).toBe(1);
    expect(idempotentOrRejected.length).toBe(1);
    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    expect(log.status).toBe("COMPLETED");
    expect(Number(log.estimatedCost)).toBeCloseTo(6, 5); // exatamente uma vez, nunca somado/duplicado
  });

  it("dois releases concorrentes sobre uma reserva QUEUED (Promise.all real, pré-transporte): exatamente um libera, nenhuma dupla liberação/erro", async () => {
    const { organization, ledger } = await isolatedOrg("double-release");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    // Correção crítica DEFINITIVA (achado CRÍTICO "liberação automática de execução
    // potencialmente cobrável"): `releaseGatewayExecution` agora só aceita QUEUED - a
    // linha NUNCA é promovida para RUNNING neste teste (nenhum `markGatewayExecutionTransportStarted`),
    // simulando o único cenário real em que `gateway.ts` chama esta função: uma falha
    // comprovadamente pré-transporte (`adapterInvoked === false`).
    const [a, b] = await Promise.all([
      releaseGatewayExecution(outcome.executionLogId, outcome.pendingActionId, "TIMEOUT"),
      releaseGatewayExecution(outcome.executionLogId, outcome.pendingActionId, "PROVIDER_UNAVAILABLE"),
    ]);
    const releasedCount = [a.released, b.released].filter(Boolean).length;
    expect(releasedCount).toBe(1);
    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    expect(log.status).toBe("FAILED");
    expect(Number(log.estimatedCost)).toBe(0);
  });

  it("releaseGatewayExecution NUNCA aceita RUNNING como origem (achado CRÍTICO fechado): dois releases concorrentes sobre RUNNING - ambos no-op, execução permanece RUNNING e contabilizada", async () => {
    const { organization, ledger } = await isolatedOrg("release-never-running");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    const mark = await markGatewayExecutionTransportStarted(outcome.executionLogId, outcome.pendingActionId);
    expect(mark.transitioned).toBe(true);
    const [a, b] = await Promise.all([
      releaseGatewayExecution(outcome.executionLogId, outcome.pendingActionId, "TIMEOUT"),
      releaseGatewayExecution(outcome.executionLogId, outcome.pendingActionId, "PROVIDER_UNAVAILABLE"),
    ]);
    expect(a.released).toBe(false);
    expect(b.released).toBe(false);
    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    expect(log.status).toBe("RUNNING"); // nunca liberado automaticamente, mesmo sob tentativa concorrente
    expect(Number(log.estimatedCost)).toBeCloseTo(10, 5); // continua contabilizado contra o orçamento
    const pending = await prisma.aIPendingAction.findUniqueOrThrow({ where: { id: outcome.pendingActionId } });
    expect(pending.status).toBe("EXECUTING");
  });

  it("falha em um lado da transação (pendingActionId inválido) reverte o outro lado - sem estado parcial", async () => {
    const { organization, ledger } = await isolatedOrg("partial-rollback");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    const bogusPendingActionId = "does-not-exist";
    const mark = await markGatewayExecutionTransportStarted(outcome.executionLogId, bogusPendingActionId);
    expect(mark.transitioned).toBe(false);
    // O log NÃO pode ter ficado "meio promovido" para RUNNING - a transação reverteu tudo.
    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    expect(log.status).toBe("QUEUED");
    // A reserva real ainda está íntegra e pode ser promovida normalmente pelo caminho correto.
    const realMark = await markGatewayExecutionTransportStarted(outcome.executionLogId, outcome.pendingActionId);
    expect(realMark.transitioned).toBe(true);
  });

  it("resultado ambíguo (RUNNING vencida) nunca libera orçamento - continua contando até reconciliação manual", async () => {
    const { organization, ledger } = await isolatedOrg("ambiguous-keeps-budget");
    disposed.push(organization.id);
    const outcome = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    await markGatewayExecutionTransportStarted(outcome.executionLogId, outcome.pendingActionId);
    await backdateStartedAt(outcome.executionLogId, new Date(Date.now() - 10 * 60_000));
    const reap = await reapExpiredGatewayReservations({ organizationId: organization.id, staleAfterMs: 5 * 60_000 });
    expect(reap.releasedExecutionLogIds).toEqual([]);
    const spend = await prisma.aIExecutionLog.aggregate({ where: { organizationId: organization.id, status: { notIn: ["FAILED", "CANCELLED"] } }, _sum: { estimatedCost: true } });
    expect(Number(spend._sum.estimatedCost ?? 0)).toBeCloseTo(10, 5);
  });
});
