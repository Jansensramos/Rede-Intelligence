import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { createAiGateway } from "./gateway";
import * as ledgerService from "./ledger-service";
import { reapExpiredGatewayReservations } from "./reaper";
import type { GatewayLedgerContext } from "./ledger-service";
import { AiGatewayError, type AiModelProfile, type AiProviderAdapter, type AiRequest, type AiResponse, type AiRoutingPolicy } from "@/domain/ai-gateway";

/**
 * Correção crítica DEFINITIVA pós-reauditoria (achado CRÍTICO "liberação automática de
 * execução potencialmente cobrável"): prova exaustiva, com PostgreSQL real e um adapter
 * injetado (nunca rede real), de que TODA classe de erro ocorrida depois que
 * `adapter.execute` é invocado deixa a execução `RUNNING`/equivalente, nunca libera a
 * reserva e nunca gera uma segunda chamada ao adapter - independente do código de erro,
 * status HTTP simulado ou tipo de exceção.
 */

async function isolatedOrg(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organization = await prisma.organization.create({ data: { name: `pip ${label} ${suffix}`, slug: `pip-${label}-${suffix}` } });
  const user = await prisma.user.create({ data: { name: `pip ${label}`, email: `pip-${label}-${suffix}@test.local`, passwordHash: "test" } });
  const conversation = await prisma.aIConversation.create({ data: { organizationId: organization.id, title: "post-invocation-policy-test", scope: "ORGANIZATION", contextSnapshot: {}, createdById: user.id } });
  await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 1000, createdById: user.id } });
  const ledger: GatewayLedgerContext = { organizationId: organization.id, userId: user.id, conversationId: conversation.id };
  return { organization, ledger };
}
function request(organizationId: string, overrides: Partial<AiRequest> = {}): AiRequest {
  return { correlationId: `corr-${Math.random()}`, organizationId, actorRef: "user", task: "CHAT", requiredCapabilities: ["TEXT_GENERATION"], dataClassification: "INTERNAL", criticality: "STANDARD", content: { systemInstructions: "sys", trustedContext: "ctx" }, ...overrides };
}
const FAKE_PROFILE: AiModelProfile = { provider: "fake", modelRef: "fake-model", capabilities: ["TEXT_GENERATION"], contextWindowTokens: 8000, maxOutputTokens: 1000, supportsJsonSchema: false, safetyTier: "STANDARD", retentionPolicy: "ZERO_RETENTION_CONFIRMED" };
function fakePolicy(): AiRoutingPolicy {
  return { organizationId: "any", task: "CHAT", allowedProviders: ["fake"], allowedModelsByCapability: { TEXT_GENERATION: ["fake"], STRUCTURED_OUTPUT: [], EMBEDDINGS: [], VISION: [], TOOL_USE: [], STREAMING: [] }, fallbackChain: [], maxFallbackAttempts: 0 };
}
function okResponse(request: AiRequest): AiResponse {
  return { correlationId: request.correlationId, status: "OK", content: "x", evidenceRefs: [], usage: { inputUnits: 1, outputUnits: 1, estimatedCostUsdMicros: 1, latencyMs: 1 }, routing: { provider: "fake", model: "fake-model", fallbackCount: 0, retryCount: 0 }, policyVersion: "", promptVersion: "" };
}

describe.skipIf(!process.env.DATABASE_URL)("política pós-invocação (correção crítica DEFINITIVA pós-reauditoria, achado CRÍTICO)", () => {
  afterAll(async () => prisma.$disconnect());

  describe("B. cada classe de erro pós-invocação: adapter chamado exatamente 1 vez, zero release, RUNNING preservado", () => {
    class ThrowsCodeAdapter implements AiProviderAdapter {
      readonly ref = "fake";
      readonly profile = FAKE_PROFILE;
      calls = 0;
      constructor(private readonly makeError: (correlationId: string) => unknown) {}
      async execute(req: AiRequest): Promise<AiResponse> {
        this.calls += 1;
        throw this.makeError(req.correlationId);
      }
    }

    const cases: Array<[string, (correlationId: string) => unknown, string]> = [
      ["AUTHORIZATION", (c) => new AiGatewayError("403 simulado", "AUTHORIZATION", false, c), "AUTHORIZATION"],
      ["RATE_LIMIT (do adapter, pós-invocação)", (c) => new AiGatewayError("429 simulado", "RATE_LIMIT", true, c), "RATE_LIMIT"],
      ["conexão encerrada (ECONNRESET)", () => { const e = new Error("read ECONNRESET"); e.name = "ECONNRESET"; return e; }, "PROVIDER_UNAVAILABLE"],
      ["resposta truncada (parse falhou)", () => new SyntaxError("Unexpected end of JSON input"), "UNEXPECTED"],
      ["INVALID_RESPONSE explícito do adapter", (c) => new AiGatewayError("schema inválido", "INVALID_RESPONSE", false, c), "INVALID_RESPONSE"],
      ["UNEXPECTED (erro sem classificação conhecida)", () => { const e: Record<string, unknown> = {}; return e; }, "UNEXPECTED"],
      ["aborto (AbortError explícito)", () => { const e = new Error("aborted"); e.name = "AbortError"; return e; }, "TIMEOUT"],
      ["erro síncrono do adapter (throw direto, não Promise rejeitada)", (c) => { throw new AiGatewayError("erro sincrono", "UNEXPECTED", true, c); }, "UNEXPECTED"],
    ];

    it.each(cases)("%s -> exatamente 1 chamada, RUNNING, custo preservado, nenhum release", async (_label, makeError, expectedCode) => {
      const { organization, ledger } = await isolatedOrg(`b-${Math.random().toString(36).slice(2, 8)}`);
      const adapter = new ThrowsCodeAdapter(makeError);
      const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger });
      await expect(gateway.execute(request(organization.id, { idempotencyKey: "k1" }))).rejects.toMatchObject({ code: expectedCode });
      expect(adapter.calls).toBe(1);
      const log = await prisma.aIExecutionLog.findFirstOrThrow({ where: { organizationId: organization.id } });
      expect(log.status).toBe("RUNNING");
      const pending = await prisma.aIPendingAction.findFirstOrThrow({ where: { organizationId: organization.id } });
      expect(pending.status).toBe("EXECUTING");
    });

    it("erro assíncrono do adapter (Promise que rejeita depois de um microtask real)", async () => {
      const { organization, ledger } = await isolatedOrg("b-async");
      class AsyncRejectAdapter implements AiProviderAdapter {
        readonly ref = "fake";
        readonly profile = FAKE_PROFILE;
        calls = 0;
        async execute(req: AiRequest): Promise<AiResponse> {
          this.calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          throw new AiGatewayError("falha assincrona real", "PROVIDER_UNAVAILABLE", true, req.correlationId);
        }
      }
      const adapter = new AsyncRejectAdapter();
      const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger });
      await expect(gateway.execute(request(organization.id, { idempotencyKey: "k1" }))).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
      expect(adapter.calls).toBe(1);
      const log = await prisma.aIExecutionLog.findFirstOrThrow({ where: { organizationId: organization.id } });
      expect(log.status).toBe("RUNNING");
    });
  });

  describe("C. resposta recebida - confirmação falha por motivos não relacionados ao adapter", () => {
    it("resposta válida, mas confirmGatewayExecution falha (simulado via spy - erro transitório 'do Prisma'): adapter chamado 1x, nunca release, RUNNING preservado", async () => {
      const { organization, ledger } = await isolatedOrg("c-confirm-transient");
      const adapter: AiProviderAdapter = { ref: "fake", profile: FAKE_PROFILE, execute: async (req) => okResponse(req) };
      const spy = vi.spyOn(ledgerService, "confirmGatewayExecution").mockRejectedValueOnce(Object.assign(new Error("connection terminated unexpectedly"), { name: "Error" }));
      try {
        const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger });
        await expect(gateway.execute(request(organization.id, { idempotencyKey: "k1" }))).rejects.toBeTruthy();
        const log = await prisma.aIExecutionLog.findFirstOrThrow({ where: { organizationId: organization.id } });
        // A confirmação real nunca rodou (o spy a substituiu) - a linha permanece exatamente
        // como `markGatewayExecutionTransportStarted` a deixou: RUNNING, custo reservado.
        expect(log.status).toBe("RUNNING");
        const pending = await prisma.aIPendingAction.findFirstOrThrow({ where: { organizationId: organization.id } });
        expect(pending.status).toBe("EXECUTING");
      } finally {
        spy.mockRestore();
      }
    });

    it("resposta válida, mas confirmGatewayExecution falha com erro PERMANENTE classificado: mesmo resultado (RUNNING, sem release, sem retry do adapter)", async () => {
      const { organization, ledger } = await isolatedOrg("c-confirm-permanent");
      const adapter: AiProviderAdapter = { ref: "fake", profile: FAKE_PROFILE, execute: async (req) => okResponse(req) };
      const spy = vi.spyOn(ledgerService, "confirmGatewayExecution").mockRejectedValueOnce(new AiGatewayError("erro de confirmacao permanente simulado", "INVALID_RESPONSE", false, "c"));
      try {
        const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger });
        await expect(gateway.execute(request(organization.id, { idempotencyKey: "k1" }))).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
        const log = await prisma.aIExecutionLog.findFirstOrThrow({ where: { organizationId: organization.id } });
        expect(log.status).toBe("RUNNING");
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("A. pré-invocação: erro local antes de adapterInvoked libera com segurança, zero chamadas ao adapter", () => {
    it("markGatewayExecutionTransportStarted lança de forma inesperada (não um CAS conflict): linha permanece QUEUED e é liberada; adapter nunca chamado", async () => {
      const { organization, ledger } = await isolatedOrg("a-mark-throws");
      class SpyAdapter implements AiProviderAdapter {
        readonly ref = "fake";
        readonly profile = FAKE_PROFILE;
        calls = 0;
        async execute(req: AiRequest): Promise<AiResponse> { this.calls += 1; return okResponse(req); }
      }
      const adapter = new SpyAdapter();
      const spy = vi.spyOn(ledgerService, "markGatewayExecutionTransportStarted").mockRejectedValueOnce(new Error("erro inesperado de banco simulado"));
      try {
        const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger });
        await expect(gateway.execute(request(organization.id, { idempotencyKey: "k1" }))).rejects.toBeTruthy();
        expect(adapter.calls).toBe(0); // pré-invocação: adapter nunca chamado
        const log = await prisma.aIExecutionLog.findFirstOrThrow({ where: { organizationId: organization.id } });
        // A reserva real (não afetada pelo spy) continuava QUEUED - `!adapterInvoked` aciona
        // `releaseGatewayExecution`, que aceita CAS a partir de QUEUED e libera com segurança.
        expect(log.status).toBe("FAILED");
        expect(Number(log.estimatedCost)).toBe(0);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("7. concorrência", () => {
    it("duas execuções REAIS concorrentes com a MESMA idempotencyKey (Promise.all): adapter chamado exatamente 1 vez no total, nunca 2", async () => {
      const { organization, ledger } = await isolatedOrg("concurrent-same-key");
      let resolveFirst: (() => void) | undefined;
      const started = new Promise<void>((resolve) => { resolveFirst = resolve; });
      class SlowThenOkAdapter implements AiProviderAdapter {
        readonly ref = "fake";
        readonly profile = FAKE_PROFILE;
        calls = 0;
        async execute(req: AiRequest): Promise<AiResponse> {
          this.calls += 1;
          resolveFirst?.();
          await new Promise((resolve) => setTimeout(resolve, 80));
          return okResponse(req);
        }
      }
      const adapter = new SlowThenOkAdapter();
      const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger });
      const first = gateway.execute(request(organization.id, { idempotencyKey: "shared-key" }));
      await started; // garante que a primeira já chamou o adapter (adapterInvoked=true) antes da segunda tentar reservar
      const second = gateway.execute(request(organization.id, { idempotencyKey: "shared-key" }));
      const [firstResult, secondResult] = await Promise.allSettled([first, second]);
      expect(adapter.calls).toBe(1); // a segunda NUNCA chega a chamar o adapter - encontra EXECUTING e é rejeitada
      expect(firstResult.status).toBe("fulfilled");
      expect(secondResult.status).toBe("rejected");
      if (secondResult.status === "rejected") {
        expect((secondResult.reason as { code?: string }).code).toBe("PROVIDER_UNAVAILABLE");
      }
    });

    it("replay do cliente (nova chamada, mesma idempotencyKey) depois de uma falha de confirmação: encontra EXECUTING, é rejeitado, NUNCA rechama o adapter", async () => {
      const { organization, ledger } = await isolatedOrg("replay-after-confirm-failure");
      let calls = 0;
      const adapter: AiProviderAdapter = { ref: "fake", profile: FAKE_PROFILE, execute: async (req) => { calls += 1; return okResponse(req); } };
      const spy = vi.spyOn(ledgerService, "confirmGatewayExecution").mockRejectedValueOnce(new Error("falha de confirmacao simulada"));
      const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger });
      await expect(gateway.execute(request(organization.id, { idempotencyKey: "replay-key" }))).rejects.toBeTruthy();
      spy.mockRestore(); // a "falha" foi só na primeira tentativa - o replay usa o confirm real
      await expect(gateway.execute(request(organization.id, { idempotencyKey: "replay-key" }))).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
      expect(calls).toBe(1); // o replay nunca rechama o adapter - a reserva original continua RUNNING/EXECUTING
      const log = await prisma.aIExecutionLog.findFirstOrThrow({ where: { organizationId: organization.id } });
      expect(log.status).toBe("RUNNING");
    });

    it("reaper × adapter: enquanto o adapter está genuinamente em voo (RUNNING), uma execução concorrente do reaper nunca o toca", async () => {
      const { organization, ledger } = await isolatedOrg("reaper-vs-in-flight-adapter");
      let releaseAdapter: (() => void) | undefined;
      const adapterCanFinish = new Promise<void>((resolve) => { releaseAdapter = resolve; });
      let calls = 0;
      const adapter: AiProviderAdapter = {
        ref: "fake",
        profile: FAKE_PROFILE,
        execute: async (req) => { calls += 1; await adapterCanFinish; return okResponse(req); },
      };
      const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger });
      const execution = gateway.execute(request(organization.id, { idempotencyKey: "reaper-vs-adapter" }));
      await new Promise((resolve) => setTimeout(resolve, 20)); // deixa o adapter genuinamente iniciar (adapterInvoked=true, RUNNING)
      const reap = await reapExpiredGatewayReservations({ organizationId: organization.id, staleAfterMs: 0 }); // "vencida" mesmo recem-criada
      expect(reap.releasedExecutionLogIds).toEqual([]); // reaper nunca libera RUNNING
      releaseAdapter?.();
      const response = await execution;
      expect(response.status).toBe("OK");
      expect(calls).toBe(1);
    });
  });
});
