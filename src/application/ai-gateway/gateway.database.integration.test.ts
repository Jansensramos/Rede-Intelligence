import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { createAiGateway } from "./gateway";
import type { GatewayLedgerContext } from "./ledger-service";
import { AiGatewayError, type AiModelProfile, type AiProviderAdapter, type AiRequest, type AiResponse, type AiRoutingPolicy } from "@/domain/ai-gateway";
import { DisabledAiProviderAdapter } from "@/infrastructure/ai-gateway/disabled-provider-adapter";

/**
 * Testes de integração do AiGateway (docs Fase 10A §4/§8/§9, endurecidos na correção
 * crítica DEFINITIVA pós-reauditoria): prova ponta a ponta que o fluxo envelope →
 * segurança → roteamento → orçamento/idempotência → promoção RUNNING → UMA ÚNICA chamada
 * ao adapter → confirmação/liberação funciona contra o banco real, com um adapter falso
 * injetado (sem rede real). Não existe mais retry automático ao redor de `adapter.execute`
 * nem liberação automática de uma reserva `RUNNING` — qualquer falha ocorrida depois que o
 * adapter foi invocado (`adapterInvoked`) deixa a execução `RUNNING`/`RECONCILIATION_REQUIRED`,
 * nunca `FAILED`/custo zerado, independente da classe de erro.
 */

async function isolatedOrg(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organization = await prisma.organization.create({ data: { name: `10A gw ${label} ${suffix}`, slug: `10a-gw-${label}-${suffix}` } });
  const user = await prisma.user.create({ data: { name: `10A gw ${label}`, email: `10a-gw-${label}-${suffix}@test.local`, passwordHash: "integration-test" } });
  const conversation = await prisma.aIConversation.create({ data: { organizationId: organization.id, title: "10A gateway test", scope: "ORGANIZATION", contextSnapshot: {}, createdById: user.id } });
  await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 1000, createdById: user.id } });
  const ledger: GatewayLedgerContext = { organizationId: organization.id, userId: user.id, conversationId: conversation.id };
  return { organization, user, conversation, ledger };
}

function request(organizationId: string, overrides: Partial<AiRequest> = {}): AiRequest {
  return {
    correlationId: `corr-${Math.random()}`,
    organizationId,
    actorRef: "user",
    task: "CHAT",
    requiredCapabilities: ["TEXT_GENERATION"],
    dataClassification: "INTERNAL",
    criticality: "STANDARD",
    content: { systemInstructions: "sys", trustedContext: "ctx" },
    ...overrides,
  };
}

const FAKE_PROFILE: AiModelProfile = { provider: "fake", modelRef: "fake-model", capabilities: ["TEXT_GENERATION"], contextWindowTokens: 8000, maxOutputTokens: 1000, supportsJsonSchema: false, safetyTier: "STANDARD", retentionPolicy: "ZERO_RETENTION_CONFIRMED" };
const FAKE_PROFILE_NO_RETENTION: AiModelProfile = { ...FAKE_PROFILE, retentionPolicy: undefined };

function fakePolicy(): AiRoutingPolicy {
  return { organizationId: "any", task: "CHAT", allowedProviders: ["fake"], allowedModelsByCapability: { TEXT_GENERATION: ["fake"], STRUCTURED_OUTPUT: [], EMBEDDINGS: [], VISION: [], TOOL_USE: [], STREAMING: [] }, fallbackChain: [], maxFallbackAttempts: 0 };
}

class AlwaysSucceedsAdapter implements AiProviderAdapter {
  readonly ref = "fake";
  readonly profile = FAKE_PROFILE;
  async execute(request: AiRequest): Promise<AiResponse> {
    return { correlationId: request.correlationId, status: "OK", content: "resposta", evidenceRefs: [], usage: { inputUnits: 10, outputUnits: 5, estimatedCostUsdMicros: 1000, latencyMs: 5 }, routing: { provider: "fake", model: "fake-model", fallbackCount: 0, retryCount: 0 }, policyVersion: "", promptVersion: "" };
  }
}

class AlwaysFailsPermanentlyAdapter implements AiProviderAdapter {
  readonly ref = "fake";
  readonly profile = FAKE_PROFILE;
  calls = 0;
  async execute(request: AiRequest): Promise<AiResponse> {
    this.calls += 1;
    throw new AiGatewayError("falha permanente simulada", "AUTHENTICATION", false, request.correlationId);
  }
}

/** Lança um erro classificado RETRYABLE (ex.: PROVIDER_UNAVAILABLE) - correção crítica DEFINITIVA: mesmo retryable, o Gateway nunca chama o adapter uma segunda vez pós-invocação. */
class AlwaysFailsTransientlyAdapter implements AiProviderAdapter {
  readonly ref = "fake";
  readonly profile = FAKE_PROFILE;
  calls = 0;
  async execute(request: AiRequest): Promise<AiResponse> {
    this.calls += 1;
    throw new AiGatewayError("falha transitoria simulada", "PROVIDER_UNAVAILABLE", true, request.correlationId);
  }
}

/** Lança um erro genérico (não AiGatewayError) - classificado via classifyTransportFailureAsGatewayError, tipicamente TIMEOUT/UNEXPECTED (ambos retryable=true hoje) - mesma garantia: uma única chamada, nunca liberado. */
class AlwaysThrowsGenericErrorAdapter implements AiProviderAdapter {
  readonly ref = "fake";
  readonly profile = FAKE_PROFILE;
  calls = 0;
  async execute(): Promise<AiResponse> {
    this.calls += 1;
    const error = new Error("socket hang up");
    error.name = "AbortError"; // classificado como TIMEOUT
    throw error;
  }
}

describe.skipIf(!process.env.DATABASE_URL).sequential("AiGateway — integração ponta a ponta (Fase 10A)", () => {
  afterAll(async () => prisma.$disconnect());

  it("provider disabled: bloqueia com PROVIDER_UNAVAILABLE e libera a reserva (custo final zero)", async () => {
    const { organization, ledger } = await isolatedOrg("disabled");
    const gateway = createAiGateway({ adapter: new DisabledAiProviderAdapter(), routingPolicy: { ...fakePolicy(), allowedProviders: ["disabled"], allowedModelsByCapability: { TEXT_GENERATION: [], STRUCTURED_OUTPUT: [], EMBEDDINGS: [], VISION: [], TOOL_USE: [], STREAMING: [] } }, ledger });
    await expect(gateway.execute(request(organization.id))).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    const logs = await prisma.aIExecutionLog.findMany({ where: { organizationId: organization.id } });
    expect(logs).toHaveLength(0); // sem candidato roteável, nunca chega a reservar orçamento
  });

  it("execução com sucesso confirma a reserva com o custo/uso reais retornados pelo adapter", async () => {
    const { organization, ledger } = await isolatedOrg("success");
    const gateway = createAiGateway({ adapter: new AlwaysSucceedsAdapter(), routingPolicy: fakePolicy(), ledger });
    const response = await gateway.execute(request(organization.id, { idempotencyKey: "k1" }));
    expect(response.status).toBe("OK");
    expect(response.routing.provider).toBe("fake");
    const log = await prisma.aIExecutionLog.findFirstOrThrow({ where: { organizationId: organization.id } });
    expect(log.status).toBe("COMPLETED");
    expect(log.inputTokens).toBe(10);
    expect(log.outputTokens).toBe(5);
  });

  describe("correção crítica DEFINITIVA — depois que o adapter é invocado, nenhuma classe de erro libera a reserva nem gera uma segunda chamada (achado CRÍTICO)", () => {
    it.each([
      ["AUTHENTICATION (AiGatewayError permanente)", () => new AlwaysFailsPermanentlyAdapter(), "AUTHENTICATION"],
      ["PROVIDER_UNAVAILABLE (AiGatewayError retryable)", () => new AlwaysFailsTransientlyAdapter(), "PROVIDER_UNAVAILABLE"],
      ["TIMEOUT (erro genérico classificado, retryable)", () => new AlwaysThrowsGenericErrorAdapter(), "TIMEOUT"],
    ] as const)("%s: adapter chamado exatamente 1 vez, reserva permanece RUNNING, custo reservado preservado", async (_label, makeAdapter, expectedCode) => {
      const { organization, ledger } = await isolatedOrg(`post-invocation-${Math.random().toString(36).slice(2, 8)}`);
      const adapter = makeAdapter();
      const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger });
      await expect(gateway.execute(request(organization.id, { idempotencyKey: "k1" }))).rejects.toMatchObject({ code: expectedCode });
      expect(adapter.calls).toBe(1); // exatamente uma invocação - nunca 1+3 tentativas
      const log = await prisma.aIExecutionLog.findFirstOrThrow({ where: { organizationId: organization.id } });
      expect(log.status).toBe("RUNNING"); // nunca FAILED - liberação automática pós-invocação é o achado CRÍTICO fechado agora
      expect(Number(log.estimatedCost)).toBeCloseTo(0, 5); // provider "fake" sem preço sintético - reservado permanece como estava, nunca truncado/zerado
      const pending = await prisma.aIPendingAction.findFirstOrThrow({ where: { organizationId: organization.id } });
      expect(pending.status).toBe("EXECUTING"); // também preservado - reconciliação manual, nunca automática
    });
  });

  it("bloqueio de segurança (SECRET) nunca chega a reservar orçamento nem a chamar o adapter", async () => {
    const { organization, ledger } = await isolatedOrg("safety-block");
    const adapter = new AlwaysSucceedsAdapter();
    const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger });
    await expect(gateway.execute(request(organization.id, { dataClassification: "SECRET" }))).rejects.toMatchObject({ code: "SAFETY_BLOCKED" });
    const logs = await prisma.aIExecutionLog.findMany({ where: { organizationId: organization.id } });
    expect(logs).toHaveLength(0);
  });

  it("aprovação humana exigida (criticidade HIGH) bloqueia sem reservar orçamento e sem decidir sozinho", async () => {
    const { organization, ledger } = await isolatedOrg("human-approval");
    const adapter = new AlwaysSucceedsAdapter();
    const gateway = createAiGateway({ adapter, routingPolicy: { ...fakePolicy(), requiresHumanApprovalAbove: "HIGH" }, ledger });
    await expect(gateway.execute(request(organization.id, { criticality: "HIGH" }))).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
    const logs = await prisma.aIExecutionLog.findMany({ where: { organizationId: organization.id } });
    expect(logs).toHaveLength(0);
  });

  it("orçamento excedido bloqueia antes de chamar o adapter", async () => {
    const { organization, ledger } = await isolatedOrg("budget-block");
    await prisma.aIUsageBudget.update({ where: { organizationId: organization.id }, data: { monthlyLimit: 0 } });
    const adapter = new AlwaysSucceedsAdapter();
    let called = false;
    const spyAdapter: AiProviderAdapter = { ref: adapter.ref, profile: adapter.profile, execute: async (r) => { called = true; return adapter.execute(r); } };
    const gateway = createAiGateway({ adapter: spyAdapter, routingPolicy: fakePolicy(), ledger });
    await expect(gateway.execute(request(organization.id))).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    expect(called).toBe(false);
  });

  it("provider sem retentionPolicy ZERO_RETENTION_CONFIRMED é sempre bloqueado (decisão 7), mesmo com roteamento e orçamento OK", async () => {
    const { organization, ledger } = await isolatedOrg("retention-block");
    const adapter: AiProviderAdapter = { ref: "fake", profile: FAKE_PROFILE_NO_RETENTION, execute: new AlwaysSucceedsAdapter().execute };
    const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger });
    await expect(gateway.execute(request(organization.id))).rejects.toMatchObject({ code: "RETENTION_UNCONFIRMED" });
    const logs = await prisma.aIExecutionLog.findMany({ where: { organizationId: organization.id } });
    expect(logs).toHaveLength(0);
  });

  it("idempotencyKey de uma chamada já concluída bloqueia repetição sem reexecutar (nunca reexpõe conteúdo antigo)", async () => {
    const { organization, ledger } = await isolatedOrg("idem-completed");
    const adapter = new AlwaysSucceedsAdapter();
    const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger });
    await gateway.execute(request(organization.id, { idempotencyKey: "same-key" }));
    await expect(gateway.execute(request(organization.id, { idempotencyKey: "same-key" }))).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
    const count = await prisma.aIExecutionLog.count({ where: { organizationId: organization.id } });
    expect(count).toBe(1);
  });

  describe("correção focal — adapter hostil não contamina provider/model do ledger (achado ALTO)", () => {
    function hostileAdapter(routing: { provider: unknown; model: unknown }): AiProviderAdapter {
      return {
        ref: "fake",
        profile: FAKE_PROFILE,
        async execute(req: AiRequest): Promise<AiResponse> {
          return { correlationId: req.correlationId, status: "OK", content: "x", evidenceRefs: [], usage: { inputUnits: 1, outputUnits: 1, estimatedCostUsdMicros: 1, latencyMs: 1 }, routing: routing as AiResponse["routing"], policyVersion: "", promptVersion: "" };
        },
      };
    }

    const CANARY_URL = "https://evil.example.test/exfiltrate";
    const CANARY_TOKEN = "sk-CANARY-LEDGER-TOKEN";

    it.each([
      ["provider contendo URL", { provider: CANARY_URL, model: "fake-model" }],
      ["model contendo token", { provider: "fake", model: `fake-model-${CANARY_TOKEN}` }],
      ["provider com CR/LF", { provider: "fake\r\nX-Injected: 1", model: "fake-model" }],
      ["model com NUL", { provider: "fake", model: `fake${String.fromCharCode(0)}model` }],
      ["provider string longa demais", { provider: "f".repeat(500), model: "fake-model" }],
      ["model com Unicode bidi", { provider: "fake", model: "fake-model‮evil" }],
      ["provider divergente da rota (mas com formato válido)", { provider: "other-provider", model: "fake-model" }],
      ["model divergente da rota (mas com formato válido)", { provider: "fake", model: "other-model" }],
      ["provider e model como objeto hostil (cast)", { provider: { toString: () => "fake" } as unknown, model: ["fake-model"] as unknown }],
    ])("%s -> PROVIDER_IDENTITY_MISMATCH, zero contaminação no ledger, nunca liberado (pós-invocação)", async (_label, hostileRouting) => {
      const { organization, ledger } = await isolatedOrg(`hostile-${Math.random().toString(36).slice(2, 8)}`);
      const adapter = hostileAdapter(hostileRouting);
      const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger });
      await expect(gateway.execute(request(organization.id, { idempotencyKey: `hostile-${Math.random()}` }))).rejects.toMatchObject({ code: "PROVIDER_IDENTITY_MISMATCH" });
      // Correção crítica DEFINITIVA: o adapter RESPONDEU (só com identidade hostil) - isto
      // é pós-invocação, então a reserva NUNCA é liberada automaticamente, mesmo sendo uma
      // identidade claramente hostil. Fica RUNNING para reconciliação manual.
      const log = await prisma.aIExecutionLog.findFirstOrThrow({ where: { organizationId: organization.id } });
      expect(log.status).toBe("RUNNING");
      expect(log.provider).toBe("fake"); // canonico, gravado na reserva - nunca sobrescrito pelo hostil
      expect(log.model).toBe("fake-model");
      const serialized = JSON.stringify(log);
      expect(serialized).not.toContain(CANARY_URL);
      expect(serialized).not.toContain(CANARY_TOKEN);
    });

    it("resposta válida com identidade EXATAMENTE esperada é aceita normalmente", async () => {
      const { organization, ledger } = await isolatedOrg("hostile-happy-path");
      const gateway = createAiGateway({ adapter: hostileAdapter({ provider: "fake", model: "fake-model" }), routingPolicy: fakePolicy(), ledger });
      const response = await gateway.execute(request(organization.id, { idempotencyKey: "hostile-happy" }));
      expect(response.status).toBe("OK");
      expect(response.routing.provider).toBe("fake");
      expect(response.routing.model).toBe("fake-model");
      const log = await prisma.aIExecutionLog.findFirstOrThrow({ where: { organizationId: organization.id } });
      expect(log.status).toBe("COMPLETED");
    });
  });

  describe("correção crítica pós-reauditoria — custo/uso observado hostil não contamina o ledger (achado ALTO)", () => {
    function hostileUsageAdapter(usage: Partial<AiResponse["usage"]>): AiProviderAdapter {
      return {
        ref: "fake",
        profile: FAKE_PROFILE,
        async execute(req: AiRequest): Promise<AiResponse> {
          return {
            correlationId: req.correlationId,
            status: "OK",
            content: "x",
            evidenceRefs: [],
            usage: { inputUnits: 1, outputUnits: 1, estimatedCostUsdMicros: 1, latencyMs: 1, ...usage },
            routing: { provider: "fake", model: "fake-model", fallbackCount: 0, retryCount: 0 },
            policyVersion: "",
            promptVersion: "",
          };
        },
      };
    }

    it.each([
      ["custo negativo", { observedCostUsdMicros: -500_000 }],
      ["custo NaN", { observedCostUsdMicros: NaN }],
      ["custo Infinity", { observedCostUsdMicros: Infinity }],
      ["custo fracionário", { observedCostUsdMicros: 1.5 }],
      ["custo como string", { observedCostUsdMicros: "1000" as unknown as number }],
      ["custo bigint excessivo", { observedCostUsdMicros: (10n ** 30n) as unknown as number }],
      ["custo acima do teto seguro", { observedCostUsdMicros: 2_000_000_000_000 }],
      ["inputUnits negativo", { inputUnits: -1 }],
      ["outputUnits fracionário", { outputUnits: 1.5 }],
      ["usage como objeto hostil (cast)", { observedCostUsdMicros: { valueOf: () => 1 } as unknown as number }],
      ["usage como array hostil (cast)", { observedCostUsdMicros: [1, 2, 3] as unknown as number }],
    ] as const)("%s -> PROVIDER_USAGE_INVALID, nenhuma linha negativa/hostil persistida, nunca liberado (pós-invocação)", async (_label, hostileUsage) => {
      const { organization, ledger } = await isolatedOrg(`hostile-usage-${Math.random().toString(36).slice(2, 8)}`);
      const gateway = createAiGateway({ adapter: hostileUsageAdapter(hostileUsage), routingPolicy: fakePolicy(), ledger });
      await expect(gateway.execute(request(organization.id, { idempotencyKey: `hostile-usage-${Math.random()}` }))).rejects.toMatchObject({ code: "PROVIDER_USAGE_INVALID" });
      // Correção crítica DEFINITIVA: o adapter RESPONDEU (só com uso/custo hostil) - isto é
      // pós-invocação, então a reserva NUNCA é liberada automaticamente. Fica RUNNING; o
      // custo permanece o valor RESERVADO original (nunca o hostil, que nunca é escrito).
      const log = await prisma.aIExecutionLog.findFirstOrThrow({ where: { organizationId: organization.id } });
      expect(log.status).toBe("RUNNING");
      expect(Number(log.estimatedCost)).toBeGreaterThanOrEqual(0); // nunca negativo/hostil - o valor reservado original é preservado
    });

    it("custo observado IGUAL ao reservado é aceito normalmente", async () => {
      const { organization, ledger } = await isolatedOrg("usage-cost-equal");
      const gateway = createAiGateway({ adapter: hostileUsageAdapter({ observedCostUsdMicros: 0 }), routingPolicy: fakePolicy(), ledger });
      const response = await gateway.execute(request(organization.id, { idempotencyKey: "cost-equal" }));
      expect(response.status).toBe("OK");
      const log = await prisma.aIExecutionLog.findFirstOrThrow({ where: { organizationId: organization.id } });
      expect(log.status).toBe("COMPLETED");
    });

    it("custo observado MENOR que o reservado é aceito normalmente", async () => {
      const { organization, user, ledger } = await isolatedOrg("usage-cost-less");
      await prisma.aIUsageBudget.update({ where: { organizationId: organization.id }, data: { monthlyLimit: 1000 } });
      const gateway = createAiGateway({ adapter: hostileUsageAdapter({ observedCostUsdMicros: 1 }), routingPolicy: fakePolicy(), ledger });
      const response = await gateway.execute(request(organization.id, { idempotencyKey: "cost-less", maxCostUsdMicros: 10_000_000 }));
      expect(response.status).toBe("OK");
      void user;
    });

    it("custo observado MAIOR que o reservado mas DENTRO do orçamento restante é aceito (reconciliação de excedente)", async () => {
      const { organization, ledger } = await isolatedOrg("usage-cost-more-within-budget");
      await prisma.aIUsageBudget.update({ where: { organizationId: organization.id }, data: { monthlyLimit: 1000 } });
      // Requisição pequena (poucos caracteres) gera estimativa baixa; o provider "fake" não
      // tem preço na tabela sintética, então a estimativa é 0 - qualquer custo observado > 0
      // já é "excedente" e precisa passar pela revalidação atômica de orçamento.
      const gateway = createAiGateway({ adapter: hostileUsageAdapter({ observedCostUsdMicros: 50_000_000 }), routingPolicy: fakePolicy(), ledger });
      const response = await gateway.execute(request(organization.id, { idempotencyKey: "cost-more-ok" }));
      expect(response.status).toBe("OK");
      const log = await prisma.aIExecutionLog.findFirstOrThrow({ where: { organizationId: organization.id } });
      expect(log.status).toBe("COMPLETED");
      expect(Number(log.estimatedCost)).toBeCloseTo(50, 5);
    });

    it("custo observado MAIOR que o orçamento disponível falha fechado (BUDGET_EXCEEDED), execução fica RUNNING para reconciliação manual - nunca trunca o custo", async () => {
      const { organization, ledger } = await isolatedOrg("usage-cost-exceeds-budget");
      await prisma.aIUsageBudget.update({ where: { organizationId: organization.id }, data: { monthlyLimit: 1 } }); // orçamento minúsculo (US$ 1)
      const gateway = createAiGateway({ adapter: hostileUsageAdapter({ observedCostUsdMicros: 5_000_000_000 }), routingPolicy: fakePolicy(), ledger }); // US$ 5000 observado
      await expect(gateway.execute(request(organization.id, { idempotencyKey: "cost-exceeds-budget" }))).rejects.toMatchObject({ code: "RECONCILIATION_REQUIRED" });
      const log = await prisma.aIExecutionLog.findFirstOrThrow({ where: { organizationId: organization.id } });
      // Fail-closed documentado: a execução permanece RUNNING (ambígua, mesma política de
      // qualquer RUNNING vencida) - nunca é truncada para caber no orçamento, nunca é
      // liberada automaticamente (o transporte realmente aconteceu, do ponto de vista do
      // adapter), exigindo reconciliação manual.
      expect(log.status).toBe("RUNNING");
      expect(Number(log.estimatedCost)).toBeCloseTo(0, 5); // custo reservado original (provider "fake" sem preço) - nunca sobrescrito nem truncado
      const pending = await prisma.aIPendingAction.findFirstOrThrow({ where: { organizationId: organization.id } });
      expect(pending.status).toBe("EXECUTING"); // sem mutação parcial - a rejeição aconteceu antes de qualquer CAS
    });

    it("sonda: nenhuma linha de AIExecutionLog com custo negativo existe no banco após todos os casos hostis acima", async () => {
      const negative = await prisma.aIExecutionLog.findFirst({ where: { estimatedCost: { lt: 0 } } });
      expect(negative).toBeNull();
    });
  });
});
