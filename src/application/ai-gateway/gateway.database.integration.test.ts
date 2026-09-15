import { afterAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import { createAiGateway } from "./gateway";
import { contextTransportRetryDisposition, markGatewayExecutionTransportStarted, releaseGatewayExecution, reserveGatewayExecution, type GatewayLedgerContext } from "./ledger-service";
import { AiGatewayError, type AiModelProfile, type AiProviderAdapter, type AiRequest, type AiResponse, type AiRoutingPolicy } from "@/domain/ai-gateway";
import { DisabledAiProviderAdapter } from "@/infrastructure/ai-gateway/disabled-provider-adapter";
import { prepareContextBundle } from "@/application/context-engine";
import { canonicalContextJson, estimateContextTokens, type ContextBundle } from "@/domain/context-engine";
import { createStudy } from "@/application/studies/study-service";
import { DEMO_PROJECT } from "@/domain/financial/demo";

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
  await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id, role: "OWNER" } });
  const project = await prisma.project.create({ data: { organizationId: organization.id, name: `Gateway ${label}`, city: "São Paulo", state: "SP", createdById: user.id, updatedById: user.id } });
  const conversation = await prisma.aIConversation.create({ data: { organizationId: organization.id, projectId: project.id, title: "10A gateway test", scope: "GLOBAL_PROJECT_CONTEXT", contextSnapshot: {}, createdById: user.id } });
  await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 1000, createdById: user.id } });
  const ledger: GatewayLedgerContext = { organizationId: organization.id, userId: user.id, conversationId: conversation.id };
  return { organization, user, project, conversation, ledger };
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
  calls = 0;
  async execute(request: AiRequest): Promise<AiResponse> {
    this.calls += 1;
    return { correlationId: request.correlationId, status: "OK", content: "resposta", evidenceRefs: [], usage: { inputUnits: 10, outputUnits: 5, estimatedCostUsdMicros: 1000, latencyMs: 5 }, routing: { provider: "fake", model: "fake-model", fallbackCount: 0, retryCount: 0 }, policyVersion: "", promptVersion: "" };
  }
}

async function preparedGatewayFixture(label: string, times?: { validatedAt: Date; preparedAt: Date }) {
  const data = await isolatedOrg(label);
  const opinion = await prisma.engineeringTechnicalOpinion.create({ data: { organizationId: data.organization.id, projectId: data.project.id, code: "ENG-001", title: "Gateway fixture", status: "VALIDATED", checksum: "b".repeat(64), createdById: data.user.id, validatedById: data.user.id, validatedAt: times?.validatedAt ?? new Date() } });
  const auth = { sessionId: "test", userId: data.user.id, userName: data.user.name, userEmail: data.user.email, organizationId: data.organization.id, organizationName: data.organization.name, organizationSlug: data.organization.slug, role: "OWNER" as const };
  const prepared = await prepareContextBundle(auth, { conversationId: data.conversation.id, purpose: "ENGINEERING_PROGRESS_REVIEW" }, times ? { now: () => times.preparedAt } : undefined);
  const aiRequest = request(data.organization.id, { correlationId: prepared.correlationId, actorRef: data.user.id, projectId: data.project.id, dataClassification: "CONFIDENTIAL", contextBundle: prepared.bundle, idempotencyKey: prepared.bundle.requestRef });
  return { ...data, opinion, auth, prepared, aiRequest };
}

function remeasureBundle(bundle: ContextBundle): ContextBundle {
  const { measurements: _old, ...base } = bundle;
  void _old;
  const byteCount = Buffer.byteLength(canonicalContextJson(base), "utf8");
  return { ...bundle, measurements: { itemCount: bundle.items.length, byteCount, estimatedTokens: estimateContextTokens(byteCount) } };
}

async function consumeReservationInSubprocess(payload: {
  executionLogId: string;
  pendingActionId: string;
  authorization: { ledger: GatewayLedgerContext; request: AiRequest };
}) {
  const source = `
    import { markGatewayExecutionTransportStarted } from "./src/application/ai-gateway/ledger-service.ts";
    import { prisma } from "./src/infrastructure/database/prisma.ts";
    const payload = JSON.parse(process.env.CONTEXT_CAS_PAYLOAD);
    try {
      const outcome = await markGatewayExecutionTransportStarted(payload.executionLogId, payload.pendingActionId, payload.authorization);
      process.stdout.write(JSON.stringify({ outcome }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ errorCode: error?.code ?? "UNEXPECTED" }));
    } finally {
      await prisma.$disconnect();
    }
  `;
  return new Promise<{ outcome?: { transitioned: boolean }; errorCode?: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "./scripts/patch-node-os.mjs", "--import", "tsx", "--input-type=module", "--eval", source], {
      cwd: process.cwd(),
      env: { ...process.env, CONTEXT_CAS_PAYLOAD: JSON.stringify(payload) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) reject(new Error(`context CAS subprocess failed (${code}): ${stderr.slice(0, 500)}`));
      else {
        try { resolve(JSON.parse(stdout)); }
        catch { reject(new Error(`context CAS subprocess returned invalid JSON: ${stdout.slice(0, 500)}`)); }
      }
    });
  });
}

async function preparedLegalGatewayFixture(label: string) {
  const data = await isolatedOrg(label);
  const auth = { sessionId: "test", userId: data.user.id, userName: data.user.name, userEmail: data.user.email, organizationId: data.organization.id, organizationName: data.organization.name, organizationSlug: data.organization.slug, role: "OWNER" as const };
  const diligence = await prisma.legalDueDiligenceCase.create({ data: { organizationId: data.organization.id, projectId: data.project.id, code: `LEGAL-${label}`.slice(0, 64), title: "Legal fixture", scope: "Context", responsibleId: data.user.id, createdById: data.user.id, updatedById: data.user.id } });
  const documentRequest = await prisma.legalDocumentRequest.create({ data: { diligenceCaseId: diligence.id, code: "DOC-001", documentType: "CERTIFICATE", title: "Certificate", requestedAt: new Date(), responsibleId: data.user.id, createdById: data.user.id, updatedById: data.user.id } });
  const document = await prisma.legalEvidenceDocument.create({ data: { organizationId: data.organization.id, projectId: data.project.id, diligenceCaseId: diligence.id, documentRequestId: documentRequest.id, storageProvider: "LOCAL_PRIVATE_FILE_STORAGE", storageKey: `context/${label}`, checksum: "f".repeat(64), contentType: "application/pdf", sizeBytes: 10, status: "VERIFIED", uploadedById: data.user.id, reviewedById: data.user.id, reviewedAt: new Date(), correlationId: `legal-${label}` } });
  const prepared = await prepareContextBundle(auth, { conversationId: data.conversation.id, purpose: "LEGAL_EVIDENCE_SUMMARY" });
  const aiRequest = request(data.organization.id, { correlationId: prepared.correlationId, actorRef: data.user.id, projectId: data.project.id, dataClassification: "LEGAL", contextBundle: prepared.bundle, idempotencyKey: prepared.bundle.requestRef });
  return { ...data, auth, document, prepared, aiRequest };
}

async function preparedRiskGatewayFixture(label: string) {
  const base = await isolatedOrg(label);
  const auth = { sessionId: "test", userId: base.user.id, userName: base.user.name, userEmail: base.user.email, organizationId: base.organization.id, organizationName: base.organization.name, organizationSlug: base.organization.slug, role: "OWNER" as const };
  const study = await createStudy(auth, { ...DEMO_PROJECT, projectName: `Risk ${label}` });
  const conversation = await prisma.aIConversation.create({ data: { organizationId: base.organization.id, projectId: study.projectId, title: "Risk context", scope: "GLOBAL_PROJECT_CONTEXT", contextSnapshot: {}, createdById: base.user.id } });
  const run = await prisma.calculationRun.findFirstOrThrow({ where: { organizationId: base.organization.id, projectId: study.projectId, studyVersionId: study.studyVersionId }, orderBy: [{ calculatedAt: "desc" }, { id: "asc" }], select: { id: true, scenarioId: true } });
  const risk = await prisma.riskFinding.findFirst({ where: { calculationRunId: run.id }, orderBy: [{ code: "asc" }, { id: "asc" }] }) ?? await prisma.riskFinding.create({ data: { calculationRunId: run.id, scenarioId: run.scenarioId, severity: "WARNING", category: "FINANCIAL", title: "Context risk", evidence: "coded", action: "REVIEW", classification: "INTERNAL", code: "CTX_RISK", description: "coded", actualValue: 1, thresholdValue: 2, createdById: base.user.id } });
  const prepared = await prepareContextBundle(auth, { conversationId: conversation.id, purpose: "RISK_REVIEW" });
  const ledger = { organizationId: base.organization.id, userId: base.user.id, conversationId: conversation.id };
  const aiRequest = request(base.organization.id, { correlationId: prepared.correlationId, actorRef: base.user.id, projectId: study.projectId, dataClassification: "CONFIDENTIAL", contextBundle: prepared.bundle, idempotencyKey: prepared.bundle.requestRef });
  return { ...base, auth, study, conversation, run, risk, prepared, ledger, aiRequest };
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

  it("ContextBundle recusado gera zero chamadas; bundle válido gera exatamente uma e não chega ao adapter como objeto interno", async () => {
    const { organization, user, project, conversation, ledger } = await isolatedOrg("context-bundle");
    await prisma.engineeringTechnicalOpinion.create({ data: { organizationId: organization.id, projectId: project.id, code: "ENG-001", title: "Gateway fixture", status: "VALIDATED", checksum: "a".repeat(64), createdById: user.id, validatedById: user.id, validatedAt: new Date() } });
    const adapter = new AlwaysSucceedsAdapter();
    const execute = adapter.execute.bind(adapter); let calls = 0; let sawInternalBundle = false;
    adapter.execute = async (received) => { calls += 1; sawInternalBundle = Object.prototype.hasOwnProperty.call(received, "contextBundle"); return execute(received); };
    const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger, requireContextBundle: true });
    await expect(gateway.execute(request(organization.id, { projectId: "project-1" }))).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
    expect(calls).toBe(0);
    const prepared = await prepareContextBundle({ sessionId: "test", userId: user.id, userName: user.name, userEmail: user.email, organizationId: organization.id, organizationName: organization.name, organizationSlug: organization.slug, role: "OWNER" }, { conversationId: conversation.id, purpose: "ENGINEERING_PROGRESS_REVIEW" });
    await gateway.execute(request(organization.id, { correlationId: prepared.correlationId, actorRef: user.id, projectId: project.id, dataClassification: "CONFIDENTIAL", contextBundle: prepared.bundle, idempotencyKey: prepared.bundle.requestRef }));
    expect(calls).toBe(1); expect(sawInternalBundle).toBe(false);
  });

  it.each([
    ["membership revogada", async (data: Awaited<ReturnType<typeof preparedGatewayFixture>>) => { await prisma.organizationMembership.update({ where: { organizationId_userId: { organizationId: data.organization.id, userId: data.user.id } }, data: { isActive: false } }); }],
    ["capability removida pelo papel atual", async (data: Awaited<ReturnType<typeof preparedGatewayFixture>>) => { await prisma.organizationMembership.update({ where: { organizationId_userId: { organizationId: data.organization.id, userId: data.user.id } }, data: { role: "VIEWER" } }); }],
    ["fonte superseded", async (data: Awaited<ReturnType<typeof preparedGatewayFixture>>) => { await prisma.engineeringTechnicalOpinion.update({ where: { id: data.opinion.id }, data: { status: "SUPERSEDED" } }); }],
    ["nova versão da fonte", async (data: Awaited<ReturnType<typeof preparedGatewayFixture>>) => { await prisma.engineeringTechnicalOpinion.create({ data: { organizationId: data.organization.id, projectId: data.project.id, seriesKey: data.opinion.seriesKey, version: 2, previousOpinionId: data.opinion.id, code: "ENG-001", title: "Gateway fixture v2", status: "VALIDATED", checksum: "c".repeat(64), createdById: data.user.id, validatedById: data.user.id, validatedAt: new Date() } }); }],
    ["autoria da conversa alterada", async (data: Awaited<ReturnType<typeof preparedGatewayFixture>>) => { const other = await prisma.user.create({ data: { name: "Other owner", email: `other-${Date.now()}-${Math.random()}@test.local`, passwordHash: "test" } }); await prisma.aIConversation.update({ where: { id: data.conversation.id }, data: { createdById: other.id } }); }],
    ["projeto da conversa alterado", async (data: Awaited<ReturnType<typeof preparedGatewayFixture>>) => { const other = await prisma.project.create({ data: { organizationId: data.organization.id, name: "Other project", city: "São Paulo", state: "SP", createdById: data.user.id, updatedById: data.user.id } }); await prisma.aIConversation.update({ where: { id: data.conversation.id }, data: { projectId: other.id } }); }],
    ["projeto alterado para PAUSED", async (data: Awaited<ReturnType<typeof preparedGatewayFixture>>) => { await prisma.project.update({ where: { id: data.project.id }, data: { status: "PAUSED" } }); }],
    ["projeto alterado para ARCHIVED", async (data: Awaited<ReturnType<typeof preparedGatewayFixture>>) => { await prisma.project.update({ where: { id: data.project.id }, data: { status: "ARCHIVED" } }); }],
    ["projeto alterado para CLOSED", async (data: Awaited<ReturnType<typeof preparedGatewayFixture>>) => { await prisma.project.update({ where: { id: data.project.id }, data: { status: "CLOSED" } }); }],
  ] as const)("revalidação transacional bloqueia %s confirmada após preparo, sem adapter nem reserva ativa", async (_label, mutate) => {
    const data = await preparedGatewayFixture(`consume-${Math.random().toString(36).slice(2, 8)}`);
    await mutate(data);
    const adapter = new AlwaysSucceedsAdapter();
    const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger: data.ledger, requireContextBundle: true });
    await expect(gateway.execute(structuredClone(data.aiRequest))).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
    expect(adapter.calls).toBe(0);
    const log = await prisma.aIExecutionLog.findFirstOrThrow({ where: { organizationId: data.organization.id, provider: "fake" } });
    const pending = await prisma.aIPendingAction.findFirstOrThrow({ where: { organizationId: data.organization.id, actionType: "AI_GATEWAY_EXECUTION" } });
    expect(log).toMatchObject({ status: "FAILED", errorCode: "POLICY_BLOCKED" });
    expect(Number(log.estimatedCost)).toBe(0);
    expect(pending.status).toBe("FAILED");
    expect(await prisma.auditLog.count({ where: { organizationId: data.organization.id, action: "CONTEXT_CONSUMED" } })).toBe(0);
  });

  it.each([2, 5, 10])("bundle por JSON round-trip em %i instâncias lógicas tem um transporte e uma contabilização", async (concurrency) => {
    const data = await preparedGatewayFixture(`multi-instance-${concurrency}`);
    const adapters = Array.from({ length: concurrency }, () => new AlwaysSucceedsAdapter());
    const gateways = adapters.map((adapter) => createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger: data.ledger, requireContextBundle: true }));
    const outcomes = await Promise.allSettled(gateways.map((gateway) => gateway.execute(JSON.parse(JSON.stringify(data.aiRequest)))));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(adapters.reduce((sum, adapter) => sum + adapter.calls, 0)).toBe(1);
    expect(await prisma.aIExecutionLog.count({ where: { organizationId: data.organization.id, provider: "fake" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId: data.organization.id, action: "CONTEXT_CONSUMED" } })).toBe(1);
    const log = await prisma.aIExecutionLog.findFirstOrThrow({ where: { organizationId: data.organization.id, provider: "fake" } });
    expect(log.status).toBe("COMPLETED");
  });

  it.each([2, 5, 10])("%i processos Node com PrismaClients independentes promovem uma única reserva", async (concurrency) => {
    const data = await preparedGatewayFixture(`multi-process-${concurrency}`);
    const reservation = await reserveGatewayExecution(data.ledger, data.aiRequest, 0, null, "fake", "fake-model");
    expect(reservation.kind).toBe("RESERVED");
    if (reservation.kind !== "RESERVED") throw new Error("expected reservation");
    const payload = { executionLogId: reservation.executionLogId, pendingActionId: reservation.pendingActionId, authorization: { ledger: data.ledger, request: JSON.parse(JSON.stringify(data.aiRequest)) } };
    const outcomes = await Promise.all(Array.from({ length: concurrency }, () => consumeReservationInSubprocess(payload)));
    expect(outcomes.filter((entry) => entry.outcome?.transitioned === true)).toHaveLength(1);
    expect(outcomes.filter((entry) => entry.outcome?.transitioned === false)).toHaveLength(concurrency - 1);
    expect(await prisma.auditLog.count({ where: { organizationId: data.organization.id, action: "CONTEXT_CONSUMED" } })).toBe(1);
    expect(await prisma.aIExecutionLog.count({ where: { organizationId: data.organization.id, status: "RUNNING" } })).toBe(1);
  }, 60_000);

  it("revogação em outro PrismaClient, iniciada antes da autorização, vence a corrida e bloqueia o transporte", async () => {
    const data = await preparedGatewayFixture("two-clients-race");
    const secondClient = new PrismaClient();
    try {
      let mutationStarted!: () => void;
      let allowCommit!: () => void;
      const started = new Promise<void>((resolve) => { mutationStarted = resolve; });
      const release = new Promise<void>((resolve) => { allowCommit = resolve; });
      const mutation = secondClient.$transaction(async (tx) => {
        await tx.organizationMembership.update({ where: { organizationId_userId: { organizationId: data.organization.id, userId: data.user.id } }, data: { isActive: false } });
        mutationStarted();
        await release;
      });
      await started;
      const adapter = new AlwaysSucceedsAdapter();
      const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger: data.ledger, requireContextBundle: true });
      const consumption = gateway.execute(structuredClone(data.aiRequest));
      allowCommit();
      await mutation;
      await expect(consumption).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
      expect(adapter.calls).toBe(0);
    } finally { await secondClient.$disconnect(); }
  });

  it("mudança do projeto para PAUSED em outro PrismaClient confirma antes da autorização e bloqueia o transporte", async () => {
    const data = await preparedGatewayFixture("project-status-race");
    const secondClient = new PrismaClient();
    try {
      let mutationStarted!: () => void;
      let allowCommit!: () => void;
      const started = new Promise<void>((resolve) => { mutationStarted = resolve; });
      const release = new Promise<void>((resolve) => { allowCommit = resolve; });
      const mutation = secondClient.$transaction(async (tx) => {
        await tx.project.update({ where: { id: data.project.id }, data: { status: "PAUSED" } });
        mutationStarted();
        await release;
      });
      await started;
      const adapter = new AlwaysSucceedsAdapter();
      const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger: data.ledger, requireContextBundle: true });
      const consumption = gateway.execute(structuredClone(data.aiRequest));
      allowCommit();
      await mutation;
      await expect(consumption).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
      expect(adapter.calls).toBe(0);
      expect(await prisma.auditLog.count({ where: { organizationId: data.organization.id, action: "CONTEXT_CONSUMED" } })).toBe(0);
    } finally { await secondClient.$disconnect(); }
  });

  it("bundle que vence aguardando a barreira é recusado sem consumo, RUNNING ou adapter", async () => {
    const preparedAt = new Date(Date.now() - 50_000);
    const data = await preparedGatewayFixture("expiry-waiting-lock", { preparedAt, validatedAt: new Date(preparedAt.getTime() - 60_000) });
    const secondClient = new PrismaClient();
    try {
      let lockHeld!: () => void;
      let releaseLock!: () => void;
      const held = new Promise<void>((resolve) => { lockHeld = resolve; });
      const release = new Promise<void>((resolve) => { releaseLock = resolve; });
      const blocker = secondClient.$transaction(async (tx) => {
        await tx.project.update({ where: { id: data.project.id }, data: { status: "DRAFT" } });
        lockHeld();
        await release;
      }, { timeout: 20_000 });
      await held;
      const adapter = new AlwaysSucceedsAdapter();
      const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger: data.ledger, requireContextBundle: true });
      const consumption = gateway.execute(structuredClone(data.aiRequest));
      const waitMs = Math.max(0, new Date(data.prepared.bundle.validUntil).getTime() - Date.now() + 100);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      releaseLock();
      await blocker;
      await expect(consumption).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
      expect(adapter.calls).toBe(0);
      expect(await prisma.auditLog.count({ where: { organizationId: data.organization.id, action: "CONTEXT_CONSUMED" } })).toBe(0);
      expect(await prisma.aIExecutionLog.findFirstOrThrow({ where: { organizationId: data.organization.id, provider: "fake" } })).toMatchObject({ status: "FAILED" });
    } finally { await secondClient.$disconnect(); }
  }, 30_000);

  it("o mesmo fingerprint não autoriza ator diferente e falha antes de reservar", async () => {
    const data = await preparedGatewayFixture("actor-binding");
    const other = await prisma.user.create({ data: { name: "Other actor", email: `other-actor-${Date.now()}@test.local`, passwordHash: "test" } });
    await prisma.organizationMembership.create({ data: { organizationId: data.organization.id, userId: other.id, role: "OWNER" } });
    const adapter = new AlwaysSucceedsAdapter();
    const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger: { ...data.ledger, userId: other.id }, requireContextBundle: true });
    await expect(gateway.execute({ ...structuredClone(data.aiRequest), actorRef: other.id })).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
    expect(adapter.calls).toBe(0);
    expect(await prisma.aIExecutionLog.count({ where: { organizationId: data.organization.id, provider: "fake" } })).toBe(0);
  });

  it("bundle vencido é bloqueado antes de criar reserva", async () => {
    const preparedAt = new Date(Date.now() - 2 * 60_000);
    const data = await preparedGatewayFixture("expired-bundle", { preparedAt, validatedAt: new Date(preparedAt.getTime() - 60_000) });
    const adapter = new AlwaysSucceedsAdapter();
    const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger: data.ledger, requireContextBundle: true });
    await expect(gateway.execute(structuredClone(data.aiRequest))).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
    expect(adapter.calls).toBe(0);
    expect(await prisma.aIExecutionLog.count({ where: { organizationId: data.organization.id, provider: "fake" } })).toBe(0);
  });

  it("validUntil ampliado para 2027, com métricas recalculadas, falha no binding temporal antes do adapter", async () => {
    const preparedAt = new Date(Date.now() - 2 * 60_000);
    const data = await preparedGatewayFixture("tampered-expiry", { preparedAt, validatedAt: new Date(preparedAt.getTime() - 60_000) });
    const tampered = remeasureBundle({ ...data.prepared.bundle, validUntil: "2027-09-13T12:00:00.000Z" });
    const adapter = new AlwaysSucceedsAdapter();
    const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger: data.ledger, requireContextBundle: true });
    await expect(gateway.execute({ ...structuredClone(data.aiRequest), contextBundle: tampered })).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
    expect(adapter.calls).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: data.organization.id, action: "CONTEXT_CONSUMED" } })).toBe(0);
  });

  it("revogação jurídica confirmada depois do preparo é relida no consumo e bloqueia o adapter", async () => {
    const data = await preparedLegalGatewayFixture("legal-revocation");
    await prisma.legalEvidenceDocument.update({ where: { id: data.document.id }, data: { status: "REVOKED", revokedById: data.user.id, revokedAt: new Date(), revokedReason: "revoked by focal test" } });
    const adapter = new AlwaysSucceedsAdapter();
    const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger: data.ledger, requireContextBundle: true });
    await expect(gateway.execute(structuredClone(data.aiRequest))).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
    expect(adapter.calls).toBe(0);
    const log = await prisma.aIExecutionLog.findFirstOrThrow({ where: { organizationId: data.organization.id, provider: "fake" } });
    expect(log).toMatchObject({ status: "FAILED", errorCode: "POLICY_BLOCKED" });
    expect(await prisma.auditLog.count({ where: { organizationId: data.organization.id, action: "CONTEXT_CONSUMED" } })).toBe(0);
  });

  it.each([
    ["alteração do conjunto de riscos", async (data: Awaited<ReturnType<typeof preparedRiskGatewayFixture>>) => { await prisma.riskFinding.create({ data: { calculationRunId: data.run.id, scenarioId: data.run.scenarioId, severity: "CRITICAL", category: "GOVERNANCE", title: "New context risk", evidence: "coded new risk", action: "REVIEW", classification: "INTERNAL", code: `CTX_NEW_${Math.random().toString(36).slice(2, 8).toUpperCase()}`, description: "coded new risk", actualValue: 3, thresholdValue: 2, createdById: data.user.id } }); }],
    ["novo conflito de risco", async (data: Awaited<ReturnType<typeof preparedRiskGatewayFixture>>) => { await prisma.riskFinding.create({ data: { calculationRunId: data.run.id, scenarioId: data.run.scenarioId, severity: data.risk.severity, category: data.risk.category, title: "Conflicting context risk", evidence: "coded conflict", action: "REVIEW", classification: "INTERNAL", code: data.risk.code, description: "coded conflict", actualValue: 999, thresholdValue: data.risk.thresholdValue, createdById: data.user.id } }); }],
  ] as const)("%s confirmada depois do preparo invalida o fingerprint reconstruído", async (_label, mutate) => {
    const data = await preparedRiskGatewayFixture(`risk-${Math.random().toString(36).slice(2, 8)}`);
    await mutate(data);
    const adapter = new AlwaysSucceedsAdapter();
    const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger: data.ledger, requireContextBundle: true });
    await expect(gateway.execute(structuredClone(data.aiRequest))).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
    expect(adapter.calls).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: data.organization.id, action: "CONTEXT_CONSUMED" } })).toBe(0);
  }, 60_000);

  it("retry transacional é exclusivo de P2034, limitado a três; P2002 não é repetido", () => {
    const p2034 = new Prisma.PrismaClientKnownRequestError("serialization conflict", { code: "P2034", clientVersion: "test" });
    const p2002 = new Prisma.PrismaClientKnownRequestError("unrelated unique collision", { code: "P2002", clientVersion: "test" });
    expect(contextTransportRetryDisposition(p2034, 1)).toBe("RETRY");
    expect(contextTransportRetryDisposition(p2034, 2)).toBe("RETRY");
    expect(contextTransportRetryDisposition(p2034, 3)).toBe("EXHAUSTED");
    expect(contextTransportRetryDisposition(p2002, 1)).toBe("NOT_RETRYABLE");
  });

  it("binding persistido inválido faz rollback integral do consumo antes de RUNNING", async () => {
    const data = await preparedGatewayFixture("invalid-persisted-binding");
    const reservation = await reserveGatewayExecution(data.ledger, data.aiRequest, 0, null, "fake", "fake-model");
    expect(reservation.kind).toBe("RESERVED");
    if (reservation.kind !== "RESERVED") throw new Error("expected reservation");
    const fingerprint = (await prisma.aIPendingAction.findUniqueOrThrow({ where: { id: reservation.pendingActionId } })).arguments as { fingerprint: string };
    await prisma.aIPendingAction.update({ where: { id: reservation.pendingActionId }, data: { arguments: { fingerprint: fingerprint.fingerprint, context: { forged: true } } } });
    await expect(markGatewayExecutionTransportStarted(reservation.executionLogId, reservation.pendingActionId, { ledger: data.ledger, request: data.aiRequest })).rejects.toMatchObject({ code: "CONTEXT_INTEGRITY_FAILED" });
    expect(await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: reservation.executionLogId } })).toMatchObject({ status: "QUEUED" });
    expect(await prisma.auditLog.count({ where: { organizationId: data.organization.id, action: "CONTEXT_CONSUMED" } })).toBe(0);
    expect(await releaseGatewayExecution(reservation.executionLogId, reservation.pendingActionId, "POLICY_BLOCKED")).toEqual({ released: true });
  });

  it("binding persistido contém tempo e identidades reais e recusa alteração temporal posterior à reserva", async () => {
    const data = await preparedGatewayFixture("strict-temporal-ledger-binding");
    const reservation = await reserveGatewayExecution(data.ledger, data.aiRequest, 0, null, "fake", "fake-model");
    expect(reservation.kind).toBe("RESERVED");
    if (reservation.kind !== "RESERVED") throw new Error("expected reservation");
    const pending = await prisma.aIPendingAction.findUniqueOrThrow({ where: { id: reservation.pendingActionId } });
    const argumentsJson = pending.arguments as { fingerprint: string; context: Record<string, unknown> };
    expect(argumentsJson.context).toMatchObject({
      actorUserId: data.user.id, conversationId: data.conversation.id, organizationId: data.organization.id,
      projectId: data.project.id, idempotencyKey: data.aiRequest.idempotencyKey,
      executionLogId: reservation.executionLogId, pendingActionId: reservation.pendingActionId,
      correlationId: data.aiRequest.correlationId, preparedAt: data.prepared.bundle.preparedAt,
      validUntil: data.prepared.bundle.validUntil, fingerprint: data.prepared.bundle.fingerprint,
    });
    const alteredContext = { ...argumentsJson.context, validUntil: "2027-09-13T12:00:00.000Z" };
    await prisma.aIPendingAction.update({ where: { id: reservation.pendingActionId }, data: { arguments: { fingerprint: argumentsJson.fingerprint, context: alteredContext } } });
    await expect(markGatewayExecutionTransportStarted(reservation.executionLogId, reservation.pendingActionId, { ledger: data.ledger, request: data.aiRequest })).rejects.toMatchObject({ code: "CONTEXT_INTEGRITY_FAILED" });
    expect(await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: reservation.executionLogId } })).toMatchObject({ status: "QUEUED" });
    expect(await prisma.auditLog.count({ where: { organizationId: data.organization.id, action: "CONTEXT_CONSUMED" } })).toBe(0);
    expect(await releaseGatewayExecution(reservation.executionLogId, reservation.pendingActionId, "POLICY_BLOCKED")).toEqual({ released: true });
  });

  it("revogação confirmada depois de TRANSPORT_AUTHORIZED não recolhe uma chamada já iniciada", async () => {
    const data = await preparedGatewayFixture("post-authorization-revocation");
    let signalInvoked!: () => void;
    let finishAdapter!: () => void;
    const invoked = new Promise<void>((resolve) => { signalInvoked = resolve; });
    const finish = new Promise<void>((resolve) => { finishAdapter = resolve; });
    const adapter = new AlwaysSucceedsAdapter();
    adapter.execute = async (received) => {
      adapter.calls += 1;
      signalInvoked();
      await finish;
      return { correlationId: received.correlationId, status: "OK", content: "authorized", evidenceRefs: [], usage: { inputUnits: 1, outputUnits: 1, estimatedCostUsdMicros: 0, latencyMs: 1 }, routing: { provider: "fake", model: "fake-model", fallbackCount: 0, retryCount: 0 }, policyVersion: "", promptVersion: "" };
    };
    const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger: data.ledger, requireContextBundle: true });
    const execution = gateway.execute(structuredClone(data.aiRequest));
    await invoked;
    await prisma.organizationMembership.update({ where: { organizationId_userId: { organizationId: data.organization.id, userId: data.user.id } }, data: { isActive: false } });
    finishAdapter();
    await expect(execution).resolves.toMatchObject({ status: "OK", content: "authorized" });
    expect(adapter.calls).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId: data.organization.id, action: "CONTEXT_CONSUMED" } })).toBe(1);
  });

  it("mudança de status do projeto posterior a TRANSPORT_AUTHORIZED não recolhe o transporte já iniciado", async () => {
    const data = await preparedGatewayFixture("post-authorization-project-status");
    let signalInvoked!: () => void;
    let finishAdapter!: () => void;
    const invoked = new Promise<void>((resolve) => { signalInvoked = resolve; });
    const finish = new Promise<void>((resolve) => { finishAdapter = resolve; });
    const adapter = new AlwaysSucceedsAdapter();
    adapter.execute = async (received) => {
      adapter.calls += 1;
      signalInvoked();
      await finish;
      return { correlationId: received.correlationId, status: "OK", content: "authorized", evidenceRefs: [], usage: { inputUnits: 1, outputUnits: 1, estimatedCostUsdMicros: 0, latencyMs: 1 }, routing: { provider: "fake", model: "fake-model", fallbackCount: 0, retryCount: 0 }, policyVersion: "", promptVersion: "" };
    };
    const gateway = createAiGateway({ adapter, routingPolicy: fakePolicy(), ledger: data.ledger, requireContextBundle: true });
    const execution = gateway.execute(structuredClone(data.aiRequest));
    await invoked;
    const secondClient = new PrismaClient();
    try {
      await secondClient.project.update({ where: { id: data.project.id }, data: { status: "PAUSED" } });
    } finally { await secondClient.$disconnect(); }
    finishAdapter();
    await expect(execution).resolves.toMatchObject({ status: "OK", content: "authorized" });
    expect(adapter.calls).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId: data.organization.id, action: "CONTEXT_CONSUMED" } })).toBe(1);
  });

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
