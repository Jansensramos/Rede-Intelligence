import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import type { AiRequest } from "@/domain/ai-gateway";
import { AiGatewayError } from "@/domain/ai-gateway";
import { confirmGatewayExecution, markGatewayExecutionTransportStarted, releaseGatewayExecution, reserveGatewayExecution, type GatewayLedgerContext } from "./ledger-service";

/**
 * Testes adversariais reais do ledger do AI Gateway (docs Fase 10A §9/§12/§15): corrida de
 * orçamento com `Promise.all` real (não simulada), idempotência com payload igual/diferente,
 * ausência de orçamento, isolamento cross-tenant. Usa banco real de teste — nunca mocka o
 * Postgres, porque é exatamente a garantia de concorrência real (Serializable) que este
 * módulo existe para provar.
 */

async function isolatedOrg(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organization = await prisma.organization.create({ data: { name: `10A ${label} ${suffix}`, slug: `10a-${label}-${suffix}` } });
  const user = await prisma.user.create({ data: { name: `10A ${label}`, email: `10a-${label}-${suffix}@test.local`, passwordHash: "integration-test" } });
  const conversation = await prisma.aIConversation.create({ data: { organizationId: organization.id, title: "10A ledger test", scope: "ORGANIZATION", contextSnapshot: {}, createdById: user.id } });
  const ledger: GatewayLedgerContext = { organizationId: organization.id, userId: user.id, conversationId: conversation.id };
  return { organization, user, conversation, ledger };
}

function request(overrides: Partial<AiRequest> = {}): AiRequest {
  return {
    correlationId: "corr-1",
    organizationId: "org",
    actorRef: "user",
    task: "CHAT",
    requiredCapabilities: ["TEXT_GENERATION"],
    dataClassification: "INTERNAL",
    criticality: "STANDARD",
    content: { systemInstructions: "sys", trustedContext: "ctx" },
    ...overrides,
  };
}

describe.skipIf(!process.env.DATABASE_URL).sequential("ledger-service — orçamento, idempotência e isolamento reais (Fase 10A)", () => {
  afterAll(async () => prisma.$disconnect());

  it("sem AIUsageBudget configurado, a reserva falha fechado (BUDGET_EXCEEDED / BUDGET_MISSING)", async () => {
    const { ledger } = await isolatedOrg("no-budget");
    await expect(reserveGatewayExecution(ledger, request({ correlationId: "c1" }), 100, "v1", "disabled", "m")).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
  });

  it("com orçamento configurado, chamada cobravel sem priceVersion falha fechado", async () => {
    const { organization, user, ledger } = await isolatedOrg("no-price");
    await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 100, createdById: user.id } });
    await expect(reserveGatewayExecution(ledger, request({ correlationId: "c1" }), 100, null, "disabled", "m")).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
  });

  it("reserva bem-sucedida cria AIExecutionLog QUEUED (transporte ainda não iniciado) e AIPendingAction EXECUTING, com custo refletido no gasto do mês", async () => {
    const { organization, user, ledger } = await isolatedOrg("reserve-ok");
    await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 100, createdById: user.id } });
    const outcome = await reserveGatewayExecution(ledger, request({ correlationId: "c1", idempotencyKey: "key-1" }), 10_000_000, "v1", "disabled", "m");
    expect(outcome.kind).toBe("RESERVED");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    const executionLog = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    // Correção focal (achado MÉDIO "reserva órfã RUNNING"): a reserva nasce QUEUED: o
    // orçamento já está contado, mas o transporte só é marcado RUNNING em gateway.ts,
    // imediatamente antes de chamar o adapter (ver markGatewayExecutionTransportStarted).
    expect(executionLog.status).toBe("QUEUED");
    expect(Number(executionLog.estimatedCost)).toBeCloseTo(10, 5);
    const pendingAction = await prisma.aIPendingAction.findUniqueOrThrow({ where: { id: outcome.pendingActionId } });
    expect(pendingAction.status).toBe("EXECUTING");
    expect(pendingAction.actionType).toBe("AI_GATEWAY_EXECUTION");
  });

  it("bloqueia quando o gasto do mes + custo excede o limite mensal", async () => {
    const { organization, user, ledger } = await isolatedOrg("over-budget");
    await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 20, createdById: user.id } });
    await reserveGatewayExecution(ledger, request({ correlationId: "c1", idempotencyKey: "key-1" }), 15_000_000, "v1", "disabled", "m");
    await expect(reserveGatewayExecution(ledger, request({ correlationId: "c2", idempotencyKey: "key-2" }), 15_000_000, "v1", "disabled", "m")).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
  });

  it("corrida de orçamento real: 5 reservas concorrentes (Promise.all) contra um orçamento que só cabe 3 nunca deixam o gasto total exceder o limite", async () => {
    const { organization, user, ledger } = await isolatedOrg("race-budget");
    await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 30, createdById: user.id } }); // limite: 30 USD, cada chamada custa 10 USD → no máximo 3 podem passar
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) => reserveGatewayExecution(ledger, request({ correlationId: `race-${index}`, idempotencyKey: `race-key-${index}` }), 10_000_000, "v1", "disabled", "m")),
    );
    const succeeded = results.filter((result) => result.status === "fulfilled");
    const failed = results.filter((result) => result.status === "rejected");
    expect(succeeded.length).toBeLessThanOrEqual(3);
    for (const failure of failed) {
      expect((failure as PromiseRejectedResult).reason).toMatchObject({ code: "BUDGET_EXCEEDED" });
    }
    const totalSpend = await prisma.aIExecutionLog.aggregate({ where: { organizationId: organization.id, status: { notIn: ["FAILED", "CANCELLED"] } }, _sum: { estimatedCost: true } });
    expect(Number(totalSpend._sum.estimatedCost ?? 0)).toBeLessThanOrEqual(30);
  }, 30_000);

  it("idempotencyKey repetida com o MESMO payload retorna replay idempotente, sem criar uma segunda reserva", async () => {
    const { organization, user, ledger } = await isolatedOrg("idem-same");
    await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 100, createdById: user.id } });
    const req = request({ correlationId: "c1", idempotencyKey: "shared-key" });
    const first = await reserveGatewayExecution(ledger, req, 5_000_000, "v1", "disabled", "m");
    expect(first.kind).toBe("RESERVED");
    const second = await reserveGatewayExecution(ledger, { ...req, correlationId: "c2" }, 5_000_000, "v1", "disabled", "m");
    expect(second.kind).toBe("IDEMPOTENT_REPLAY");
    const count = await prisma.aIPendingAction.count({ where: { organizationId: organization.id, actionType: "AI_GATEWAY_EXECUTION" } });
    expect(count).toBe(1);
  });

  it("idempotencyKey repetida com payload DIFERENTE lança conflito (POLICY_BLOCKED), nunca reexecuta silenciosamente", async () => {
    const { organization, user, ledger } = await isolatedOrg("idem-diff");
    await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 100, createdById: user.id } });
    const key = "shared-key-2";
    await reserveGatewayExecution(ledger, request({ correlationId: "c1", idempotencyKey: key, task: "CHAT" }), 5_000_000, "v1", "disabled", "m");
    await expect(reserveGatewayExecution(ledger, request({ correlationId: "c2", idempotencyKey: key, task: "ANALYSIS" }), 5_000_000, "v1", "disabled", "m")).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
  });

  it("5 reservas concorrentes com a MESMA idempotencyKey e payload resultam em exatamente 1 reserva real", async () => {
    const { organization, user, ledger } = await isolatedOrg("idem-race");
    await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 1000, createdById: user.id } });
    const req = request({ correlationId: "race", idempotencyKey: "race-shared-key" });
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => reserveGatewayExecution(ledger, req, 1_000_000, "v1", "disabled", "m")));
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const count = await prisma.aIPendingAction.count({ where: { organizationId: organization.id, actionType: "AI_GATEWAY_EXECUTION" } });
    expect(count).toBe(1);
  }, 30_000);

  it("tenant diferente com a MESMA idempotencyKey nunca colide", async () => {
    const orgA = await isolatedOrg("tenant-a");
    const orgB = await isolatedOrg("tenant-b");
    await prisma.aIUsageBudget.create({ data: { organizationId: orgA.organization.id, monthlyLimit: 100, createdById: orgA.user.id } });
    await prisma.aIUsageBudget.create({ data: { organizationId: orgB.organization.id, monthlyLimit: 100, createdById: orgB.user.id } });
    const req = request({ correlationId: "c1", idempotencyKey: "same-key-both-tenants" });
    const a = await reserveGatewayExecution(orgA.ledger, req, 1_000_000, "v1", "disabled", "m");
    const b = await reserveGatewayExecution(orgB.ledger, req, 1_000_000, "v1", "disabled", "m");
    expect(a.kind).toBe("RESERVED");
    expect(b.kind).toBe("RESERVED");
  });

  it("release em falha zera o custo reservado (não cobra por chamada que não foi entregue) e grava reasonCode estático", async () => {
    const { organization, user, ledger } = await isolatedOrg("release");
    await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 100, createdById: user.id } });
    const outcome = await reserveGatewayExecution(ledger, request({ correlationId: "c1", idempotencyKey: "key-release" }), 50_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    await releaseGatewayExecution(outcome.executionLogId, outcome.pendingActionId, "PROVIDER_UNAVAILABLE");
    const executionLog = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    expect(executionLog.status).toBe("FAILED");
    expect(Number(executionLog.estimatedCost)).toBe(0);
    expect(executionLog.errorCode).toBe("PROVIDER_UNAVAILABLE");
    const pendingAction = await prisma.aIPendingAction.findUniqueOrThrow({ where: { id: outcome.pendingActionId } });
    expect(pendingAction.status).toBe("FAILED");
  });

  it("confirmação registra o custo observado real (não o estimado) e nunca grava conteúdo de prompt/resposta", async () => {
    const { organization, user, ledger } = await isolatedOrg("confirm");
    await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 100, createdById: user.id } });
    const outcome = await reserveGatewayExecution(ledger, request({ correlationId: "c1", idempotencyKey: "key-confirm" }), 10_000_000, "v1", "disabled", "m");
    if (outcome.kind !== "RESERVED") throw new Error("unreachable");
    // confirmGatewayExecution só aceita a transição a partir de RUNNING (correção crítica
    // pós-reauditoria) - precisa promover QUEUED->RUNNING primeiro, como o gateway real faz.
    const transportStart = await markGatewayExecutionTransportStarted(outcome.executionLogId, outcome.pendingActionId);
    expect(transportStart.transitioned).toBe(true);
    await confirmGatewayExecution(outcome.executionLogId, outcome.pendingActionId, { inputUnits: 10, outputUnits: 20, observedCostUsdMicros: 8_000_000, latencyMs: 120 }, "c1");
    const executionLog = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: outcome.executionLogId } });
    expect(executionLog.status).toBe("COMPLETED");
    expect(Number(executionLog.estimatedCost)).toBeCloseTo(8, 5);
    expect(executionLog.inputTokens).toBe(10);
    expect(executionLog.outputTokens).toBe(20);
    const allValues = JSON.stringify(executionLog);
    expect(allValues).not.toContain("sys");
    expect(allValues).not.toContain("ctx");
  });

  it("AiGatewayError é sempre a classe lançada em falhas de negócio (nunca um erro Prisma cru escapa)", async () => {
    const { ledger } = await isolatedOrg("error-class");
    try {
      await reserveGatewayExecution(ledger, request({ correlationId: "c1" }), 100, "v1", "disabled", "m");
      throw new Error("deveria ter lançado");
    } catch (error) {
      expect(error).toBeInstanceOf(AiGatewayError);
    }
  });

  describe("correção focal — idempotencyKey hostil (achado MÉDIO)", () => {
    it.each([
      ["string vazia", ""],
      ["só espaços", "   "],
      ["NUL", `abc${String.fromCharCode(0)}def`],
      ["CR/LF", "abc\r\ndef"],
      ["controle", `abc${String.fromCharCode(7)}def`],
      ["longa demais (201 chars)", "a".repeat(201)],
      ["Unicode bidi", "abc‮def"],
    ])("%s -> AiGatewayError classificado, zero acesso ao Prisma (nenhuma linha criada)", async (_label, hostileKey) => {
      const { organization, ledger } = await isolatedOrg(`idem-hostile-${Math.random().toString(36).slice(2, 6)}`);
      await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 100, createdById: ledger.userId } });
      await expect(reserveGatewayExecution(ledger, request({ correlationId: "c1", idempotencyKey: hostileKey }), 1_000_000, "v1", "disabled", "m")).rejects.toBeInstanceOf(AiGatewayError);
      const execCount = await prisma.aIExecutionLog.count({ where: { organizationId: organization.id } });
      const pendingCount = await prisma.aIPendingAction.count({ where: { organizationId: organization.id } });
      expect(execCount).toBe(0);
      expect(pendingCount).toBe(0);
    });

    it("a chave válida real (`${userMessage.id}:generate`) nunca é rejeitada por este validador", async () => {
      const { organization, ledger } = await isolatedOrg("idem-valid-shape");
      await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 100, createdById: ledger.userId } });
      const outcome = await reserveGatewayExecution(ledger, request({ correlationId: "c1", idempotencyKey: "cly1a2b3c4d5e6f7g8h9:generate" }), 1_000_000, "v1", "disabled", "m");
      expect(outcome.kind).toBe("RESERVED");
    });

    it("segunda chamada com chave hostil nunca vira PrismaClientKnownRequestError bruto, mesmo após uma primeira reserva válida", async () => {
      const { organization, ledger } = await isolatedOrg("idem-hostile-second-call");
      await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 100, createdById: ledger.userId } });
      await reserveGatewayExecution(ledger, request({ correlationId: "c1", idempotencyKey: "valid-key" }), 1_000_000, "v1", "disabled", "m");
      let caught: unknown;
      try { await reserveGatewayExecution(ledger, request({ correlationId: "c2", idempotencyKey: "" }), 1_000_000, "v1", "disabled", "m"); }
      catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(AiGatewayError);
    });
  });

  describe("correção focal — custo negativo/não finito (achado MÉDIO)", () => {
    it.each([
      ["-1", -1],
      ["mínimo negativo", Number.MIN_SAFE_INTEGER],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["decimal fracionário", 1.5],
      ["acima do limite máximo seguro", 1_000_000_000_001],
    ])("custo %s -> AiGatewayError classificado, zero acesso ao Prisma", async (_label, hostileCost) => {
      const { organization, ledger } = await isolatedOrg(`cost-hostile-${Math.random().toString(36).slice(2, 6)}`);
      await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 100, createdById: ledger.userId } });
      await expect(reserveGatewayExecution(ledger, request({ correlationId: "c1", idempotencyKey: "cost-key" }), hostileCost, "v1", "disabled", "m")).rejects.toBeInstanceOf(AiGatewayError);
      const execCount = await prisma.aIExecutionLog.count({ where: { organizationId: organization.id } });
      expect(execCount).toBe(0);
    });

    it("zero é aceito normalmente (custo legítimo)", async () => {
      const { organization, ledger } = await isolatedOrg("cost-zero");
      await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 100, createdById: ledger.userId } });
      const outcome = await reserveGatewayExecution(ledger, request({ correlationId: "c1", idempotencyKey: "zero-key" }), 0, null, "disabled", "m");
      expect(outcome.kind).toBe("RESERVED");
    });

    it("custo negativo nunca aumenta o orçamento disponível — bloqueado antes de qualquer persistência, gasto rastreado permanece 0", async () => {
      const { organization, ledger } = await isolatedOrg("cost-negative-no-credit");
      await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 100, createdById: ledger.userId } });
      await expect(reserveGatewayExecution(ledger, request({ correlationId: "c1", idempotencyKey: "neg-key" }), -50_000_000, "v1", "disabled", "m")).rejects.toBeInstanceOf(AiGatewayError);
      const spend = await prisma.aIExecutionLog.aggregate({ where: { organizationId: organization.id }, _sum: { estimatedCost: true } });
      expect(Number(spend._sum.estimatedCost ?? 0)).toBe(0);
    });
  });
});
