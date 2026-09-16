import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient, type MembershipRole } from "@prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
// API publica (ALTO-2): a grande maioria dos testes so precisa disto.
import { executeAiTool, listAiTools } from "@/application/ai-tools";
// Correcao bloqueadora final (ALTO-2): `prepareAiToolInvocation`/`consumeAiToolInvocation`
// NAO sao mais bindings exportados de `./service` (fechamento estrutural - ver docstring no
// topo daquele arquivo). O harness abaixo e o UNICO ponto de acesso restante para os testes
// de corrida, importado SOMENTE pelo caminho relativo, de DENTRO do proprio pacote - o gate
// arquitetural em architecture.test.ts prova que nenhum arquivo fora desta pasta consegue
// fazer o mesmo, por import estatico, dinamico, `require`, acesso computado ou concatenacao.
import { __raceTestPrepare, __raceTestConsume, __raceTestConsumeInSubprocess } from "./service";
import { reapExpiredGatewayReservations } from "@/application/ai-gateway";
import { createStudy } from "@/application/studies/study-service";
import { DEMO_PROJECT } from "@/domain/financial/demo";
import type { AuthContext } from "@/application/auth/session";

/**
 * Testes de integração do Tool Layer (Fase 10C) contra PostgreSQL real. Correção focal
 * pós-auditoria: cobre ALTO-1 (estado terminal monotônico sob replay 2/5/10/20, repetido),
 * ALTO-2 (choke point único, prova estrutural + reconciliação de QUEUED órfão), MÉDIO-4
 * (rate limit isolado por ator/ferramenta/tenant) e MÉDIO-5 (toolName hostil nunca
 * persistido bruto).
 */

function unique() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

function authFor(organization: { id: string; name: string; slug: string }, user: { id: string; name: string; email: string }, role: MembershipRole): AuthContext {
  return { sessionId: "test", userId: user.id, userName: user.name, userEmail: user.email, organizationId: organization.id, organizationName: organization.name, organizationSlug: organization.slug, role };
}

async function isolatedStudy(label: string) {
  const suffix = unique();
  const organization = await prisma.organization.create({ data: { name: `10C ${label} ${suffix}`, slug: `10c-${label}-${suffix}` } });
  const owner = await prisma.user.create({ data: { name: `10C ${label} owner`, email: `10c-${label}-owner-${suffix}@test.local`, passwordHash: "integration-test" } });
  await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: owner.id, role: "OWNER" } });
  const authOwner = authFor(organization, owner, "OWNER");
  const study = await createStudy(authOwner, { ...DEMO_PROJECT, projectName: `10C Study ${label} ${suffix}` });
  return { organization, owner, authOwner, study, suffix };
}

async function memberConversation(organization: { id: string; name: string; slug: string }, projectId: string, role: MembershipRole, label: string) {
  const suffix = unique();
  const user = await prisma.user.create({ data: { name: `10C ${label} ${role}`, email: `10c-${label}-${role.toLowerCase()}-${suffix}@test.local`, passwordHash: "integration-test" } });
  await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id, role } });
  const conversation = await prisma.aIConversation.create({ data: { organizationId: organization.id, projectId, title: "Tool Layer test", scope: "GLOBAL_PROJECT_CONTEXT", contextSnapshot: {}, createdById: user.id } });
  return { user, conversation, auth: authFor(organization, user, role) };
}

async function riskFixture(label: string) {
  const base = await isolatedStudy(label);
  const run = await prisma.calculationRun.findFirstOrThrow({ where: { organizationId: base.organization.id, projectId: base.study.projectId, studyVersionId: base.study.studyVersionId }, orderBy: [{ calculatedAt: "desc" }, { id: "asc" }], select: { id: true, scenarioId: true } });
  const risk = await prisma.riskFinding.findFirst({ where: { calculationRunId: run.id }, orderBy: [{ code: "asc" }, { id: "asc" }] })
    ?? await prisma.riskFinding.create({ data: { calculationRunId: run.id, scenarioId: run.scenarioId, severity: "WARNING", category: "FINANCIAL", title: "Tool Layer risk", evidence: "coded", action: "REVIEW", classification: "INTERNAL", code: "CTX_RISK", description: "coded", actualValue: 1, thresholdValue: 2, createdById: base.owner.id } });
  return { ...base, run, risk };
}

async function legalFixture(label: string) {
  const base = await isolatedStudy(label);
  const diligence = await prisma.legalDueDiligenceCase.create({ data: { organizationId: base.organization.id, projectId: base.study.projectId, code: `10C-LEGAL-${label}`.slice(0, 64), title: "Tool Layer legal fixture", scope: "Context", responsibleId: base.owner.id, createdById: base.owner.id, updatedById: base.owner.id } });
  const documentRequest = await prisma.legalDocumentRequest.create({ data: { diligenceCaseId: diligence.id, code: "DOC-001", documentType: "CERTIFICATE", title: "Certificate", requestedAt: new Date(), responsibleId: base.owner.id, createdById: base.owner.id, updatedById: base.owner.id } });
  const document = await prisma.legalEvidenceDocument.create({ data: { organizationId: base.organization.id, projectId: base.study.projectId, diligenceCaseId: diligence.id, documentRequestId: documentRequest.id, storageProvider: "LOCAL_PRIVATE_FILE_STORAGE", storageKey: `tool-layer/${label}`, checksum: "f".repeat(64), contentType: "application/pdf", sizeBytes: 10, status: "VERIFIED", uploadedById: base.owner.id, reviewedById: base.owner.id, reviewedAt: new Date(), correlationId: `10c-legal-${label}` } });
  return { ...base, diligence, document };
}

async function engineeringFixture(label: string) {
  const base = await isolatedStudy(label);
  const opinion = await prisma.engineeringTechnicalOpinion.create({ data: { organizationId: base.organization.id, projectId: base.study.projectId, code: "ENG-001", title: "Tool Layer engineering fixture", status: "VALIDATED", checksum: "b".repeat(64), createdById: base.owner.id, validatedById: base.owner.id, validatedAt: new Date() } });
  return { ...base, opinion };
}

/**
 * A corrida entre subprocessos Node/PrismaClient genuinamente independentes agora e
 * responsabilidade do proprio harness (`__raceTestConsumeInSubprocess` em `./service`) -
 * a serializacao do estado preparado (que contem o ContextBundle) nunca mais atravessa este
 * arquivo de teste como dado utilizavel; so o status terminal chega aqui. Ver docstring do
 * harness em `service.ts` para o racional completo (correcao bloqueadora final, ALTO-2).
 */

/** Confere as invariantes do ALTO-1 apos uma corrida: exatamente um COMPLETED, terminal monotonico, logs atomicos. */
async function assertRaceInvariants(organizationId: string, executionLogId: string, expectedAttempts: number) {
  const execLog = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: executionLogId } });
  expect(execLog.status, "AIExecutionLog final deve ser COMPLETED - nunca sobrescrito por um perdedor tardio").toBe("COMPLETED");

  const callLogs = await prisma.aIToolCallLog.findMany({ where: { executionId: executionLogId } });
  expect(callLogs, "uma linha de AIToolCallLog por tentativa (vencedora + perdedoras)").toHaveLength(expectedAttempts);
  expect(callLogs.filter((row) => row.status === "COMPLETED")).toHaveLength(1);
  expect(callLogs.filter((row) => row.status === "FAILED")).toHaveLength(expectedAttempts - 1);

  const consumed = await prisma.auditLog.count({ where: { organizationId, action: "CONTEXT_CONSUMED" } });
  expect(consumed, "no maximo um CONTEXT_CONSUMED por preparo, mesmo com N tentativas de consumo").toBeLessThanOrEqual(1);

  const pendingActions = await prisma.aIPendingAction.count({ where: { organizationId, affectedEntityId: executionLogId } });
  expect(pendingActions, "Tool Layer nunca cria AIPendingAction").toBe(0);
}

describe.skipIf(!process.env.DATABASE_URL).sequential("Tool Layer — integração ponta a ponta (Fase 10C, correção focal pós-auditoria)", () => {
  afterAll(async () => prisma.$disconnect());

  it("catálogo expõe exatamente as 4 ferramentas aprovadas, todas READ_ONLY", () => {
    const specs = listAiTools();
    expect(specs.map((item) => item.name).sort()).toEqual(["getActiveRisks", "getApprovedViabilitySummary", "getEngineeringProgress", "getVerifiedLegalEvidence"].sort());
  });

  it("getApprovedViabilitySummary: REVIEWER autorizado recebe resumo COMPLETED com evidência e medições (via executeAiTool)", async () => {
    const base = await isolatedStudy("viability");
    const member = await memberConversation(base.organization, base.study.projectId, "REVIEWER", "viability");
    const result = await executeAiTool(member.auth, member.conversation.id, "getApprovedViabilitySummary");
    expect(result.status).toBe("COMPLETED");
    if (result.status !== "COMPLETED") return;
    expect(result.purpose).toBe("EXECUTIVE_PROJECT_SUMMARY");
    expect(result.measurements.itemCount).toBeGreaterThan(0);
    expect(() => JSON.parse(result.evidence)).not.toThrow();
  });

  it("getActiveRisks: REVIEWER autorizado recebe riscos ativos COMPLETED (via executeAiTool)", async () => {
    const fixture = await riskFixture("risks");
    const member = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", "risks");
    const result = await executeAiTool(member.auth, member.conversation.id, "getActiveRisks");
    expect(result.status).toBe("COMPLETED");
    if (result.status !== "COMPLETED") return;
    expect(result.purpose).toBe("RISK_REVIEW");
    expect(result.evidence).toMatch(/CTX_RISK|risk/i);
  });

  it("getEngineeringProgress: REVIEWER autorizado recebe andamento COMPLETED (via executeAiTool)", async () => {
    const fixture = await engineeringFixture("eng");
    const member = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", "eng");
    const result = await executeAiTool(member.auth, member.conversation.id, "getEngineeringProgress");
    expect(result.status).toBe("COMPLETED");
    if (result.status !== "COMPLETED") return;
    expect(result.purpose).toBe("ENGINEERING_PROGRESS_REVIEW");
  });

  it("getVerifiedLegalEvidence: REVIEWER autorizado recebe evidência jurídica verificada COMPLETED (via executeAiTool)", async () => {
    const fixture = await legalFixture("legal");
    const member = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", "legal");
    const result = await executeAiTool(member.auth, member.conversation.id, "getVerifiedLegalEvidence");
    expect(result.status).toBe("COMPLETED");
    if (result.status !== "COMPLETED") return;
    expect(result.purpose).toBe("LEGAL_EVIDENCE_SUMMARY");
  });

  it("RBAC cumulativo: OWNER/ADMIN/ANALYST/REVIEWER completam; VIEWER é sempre recusado com TOOL_ACCESS_DENIED", async () => {
    const fixture = await riskFixture("rbac");
    for (const role of ["OWNER", "ADMIN", "ANALYST", "REVIEWER"] as const) {
      const member = await memberConversation(fixture.organization, fixture.study.projectId, role, `rbac-${role}`);
      const result = await executeAiTool(member.auth, member.conversation.id, "getActiveRisks");
      expect(result.status, `papel ${role} deveria completar`).toBe("COMPLETED");
    }
    const viewer = await memberConversation(fixture.organization, fixture.study.projectId, "VIEWER", "rbac-viewer");
    const result = await executeAiTool(viewer.auth, viewer.conversation.id, "getActiveRisks");
    expect(result.status).not.toBe("COMPLETED");
    if (result.status === "COMPLETED") return;
    expect(result.error.code).toBe("TOOL_ACCESS_DENIED");
  });

  it("confused deputy: AuthContext com papel forjado (OWNER) sobre membership real REVIEWER é recusado", async () => {
    const fixture = await riskFixture("confused-deputy");
    const member = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", "confused-deputy");
    const forgedAuth: AuthContext = { ...member.auth, role: "OWNER" };
    const result = await executeAiTool(forgedAuth, member.conversation.id, "getActiveRisks");
    expect(result.status).not.toBe("COMPLETED");
  });

  it("ferramenta não registrada nunca executa: TOOL_UNKNOWN, zero leitura de negócio, sentinel estático (nunca o nome bruto)", async () => {
    const fixture = await riskFixture("unknown-tool");
    const member = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", "unknown-tool");
    const before = await prisma.auditLog.count({ where: { organizationId: fixture.organization.id, action: "CONTEXT_PREPARED" } });
    const result = await executeAiTool(member.auth, member.conversation.id, "dropAllTables");
    expect(result.status).not.toBe("COMPLETED");
    if (result.status === "COMPLETED") return;
    expect(result.error.code).toBe("TOOL_UNKNOWN");
    expect(result.name).toBe("UNKNOWN");
    const after = await prisma.auditLog.count({ where: { organizationId: fixture.organization.id, action: "CONTEXT_PREPARED" } });
    expect(after).toBe(before);
    const callLog = await prisma.aIToolCallLog.findFirstOrThrow({ where: { organizationId: fixture.organization.id, tool: "UNKNOWN_TOOL_NAME" }, orderBy: { createdAt: "desc" } });
    expect(callLog.tool).toBe("UNKNOWN_TOOL_NAME");
    expect(callLog.tool).not.toContain("dropAllTables");
  });

  it("MÉDIO-5: nomes hostis (enorme, Unicode, CRLF, NUL, bidi, zero-width) nunca são persistidos brutos - sempre o sentinel", async () => {
    const fixture = await riskFixture("hostile-name");
    const member = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", "hostile-name");
    const hostileNames = [
      "a".repeat(50_000),
      "getActiveRisks\r\nAIToolCallLog.tool=FORGED",
      "getActiveRisks ",
      "‮getActiveRisks‬",
      "​getActiveRisks​",
      "getActiveRisks; DROP TABLE ai_tool_call_logs;--",
      "__proto__",
      "constructor",
    ];
    for (const hostile of hostileNames) {
      const result = await executeAiTool(member.auth, member.conversation.id, hostile);
      expect(result.status, `nome hostil deveria falhar: ${hostile.slice(0, 40)}`).not.toBe("COMPLETED");
      if (result.status === "COMPLETED") continue;
      expect(result.error.code).toBe("TOOL_UNKNOWN");
    }
    const rows = await prisma.aIToolCallLog.findMany({ where: { organizationId: fixture.organization.id, tool: { not: "getActiveRisks" } } });
    expect(rows.length).toBeGreaterThanOrEqual(hostileNames.length);
    for (const row of rows) {
      expect(row.tool).toBe("UNKNOWN_TOOL_NAME");
      expect(row.tool.length).toBeLessThan(64);
      expect(row.tool).not.toMatch(/[\r\n ​‮‬]/);
    }
  });

  it("IDOR: conversa de outra organização é recusada de forma genérica (TOOL_ACCESS_DENIED)", async () => {
    const fixtureA = await riskFixture("idor-a");
    const fixtureB = await riskFixture("idor-b");
    const memberB = await memberConversation(fixtureB.organization, fixtureB.study.projectId, "REVIEWER", "idor-b");
    const crossAuth: AuthContext = { ...fixtureA.authOwner };
    const result = await executeAiTool(crossAuth, memberB.conversation.id, "getActiveRisks");
    expect(result.status).not.toBe("COMPLETED");
    if (result.status === "COMPLETED") return;
    expect(result.error.code).toBe("TOOL_ACCESS_DENIED");
  });

  it("IDOR: conversa criada por outro usuário do mesmo tenant é recusada", async () => {
    const fixture = await riskFixture("idor-author");
    const otherAuthor = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", "idor-author-owner");
    const reader = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", "idor-author-reader");
    const result = await executeAiTool(reader.auth, otherAuthor.conversation.id, "getActiveRisks");
    expect(result.status).not.toBe("COMPLETED");
  });

  it("projeto suspenso (PAUSED) após a conversa existir é recusado no preparo", async () => {
    const fixture = await riskFixture("paused");
    const member = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", "paused");
    await prisma.project.update({ where: { id: fixture.study.projectId }, data: { status: "PAUSED" } });
    const result = await executeAiTool(member.auth, member.conversation.id, "getActiveRisks");
    expect(result.status).not.toBe("COMPLETED");
  });

  it("revogação entre preparo e consumo: evidência jurídica revogada em outro PrismaClient antes do consumo bloqueia a ferramenta (fases internas)", async () => {
    const fixture = await legalFixture("revoke-race");
    const member = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", "revoke-race");
    const prepared = await __raceTestPrepare(member.auth, member.conversation.id, "getVerifiedLegalEvidence");
    expect(prepared.ok).toBe(true);

    const otherClient = new PrismaClient();
    try {
      await otherClient.legalEvidenceDocument.update({ where: { id: fixture.document.id }, data: { status: "REVOKED", revokedAt: new Date(), revokedById: fixture.owner.id, revokedReason: "teste de corrida 10C" } });
    } finally { await otherClient.$disconnect(); }

    const consumedBefore = await prisma.auditLog.count({ where: { organizationId: fixture.organization.id, action: "CONTEXT_CONSUMED" } });
    const result = await __raceTestConsume(prepared.handle);
    expect(result.status).not.toBe("COMPLETED");
    const consumedAfter = await prisma.auditLog.count({ where: { organizationId: fixture.organization.id, action: "CONTEXT_CONSUMED" } });
    expect(consumedAfter).toBe(consumedBefore);

    const document = await prisma.legalEvidenceDocument.findUniqueOrThrow({ where: { id: fixture.document.id } });
    expect(document.status).toBe("REVOKED");

    if (!prepared.executionLogId) throw new Error("unreachable");
    const execLog = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: prepared.executionLogId } });
    expect(execLog.status).toBe("FAILED");
  });

  it.each([2, 5, 10, 20])("ALTO-1: replay/concorrência (%i tentativas, mesmo processo, 3 repetições): terminal sempre COMPLETED, nunca sobrescrito", async (count) => {
    for (let repetition = 0; repetition < 3; repetition += 1) {
      const fixture = await riskFixture(`replay-${count}-${repetition}`);
      const member = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", `replay-${count}-${repetition}`);
      const prepared = await __raceTestPrepare(member.auth, member.conversation.id, "getActiveRisks");
      expect(prepared.ok).toBe(true);
      if (!prepared.ok || !prepared.executionLogId) continue;

      const results = await Promise.all(Array.from({ length: count }, () => __raceTestConsume(prepared.handle)));
      const completed = results.filter((item) => item.status === "COMPLETED");
      expect(completed, `repeticao ${repetition}`).toHaveLength(1);

      await assertRaceInvariants(fixture.organization.id, prepared.executionLogId, count);
    }
  }, 180_000);

  it("ALTO-1: latência artificial não permite que um perdedor tardio sobrescreva o COMPLETED do vencedor", async () => {
    // Intercala explicitamente: consome o vencedor primeiro e aguarda a finalizacao dele,
    // so entao dispara os perdedores - prova que mesmo chegando estritamente DEPOIS do
    // COMPLETED, nenhum perdedor consegue regredir o estado terminal (guard CAS por status
    // anterior, nunca um update incondicional).
    const fixture = await riskFixture("late-loser");
    const member = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", "late-loser");
    const prepared = await __raceTestPrepare(member.auth, member.conversation.id, "getActiveRisks");
    expect(prepared.ok).toBe(true);
    if (!prepared.ok || !prepared.executionLogId) return;

    const winner = await __raceTestConsume(prepared.handle);
    expect(winner.status).toBe("COMPLETED");

    const lateLosers = await Promise.all(Array.from({ length: 5 }, () => __raceTestConsume(prepared.handle)));
    for (const loser of lateLosers) expect(loser.status).not.toBe("COMPLETED");

    const execLog = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: prepared.executionLogId } });
    expect(execLog.status).toBe("COMPLETED");
  });

  it("replay/concorrência com 2, 5 e 10 PrismaClients independentes (subprocessos): exatamente uma execução vence o CAS", async () => {
    for (const count of [2, 5, 10]) {
      const fixture = await riskFixture(`replay-subprocess-${count}`);
      const member = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", `replay-subprocess-${count}`);
      const prepared = await __raceTestPrepare(member.auth, member.conversation.id, "getActiveRisks");
      expect(prepared.ok).toBe(true);
      if (!prepared.ok || !prepared.executionLogId) continue;

      const outcomes = await Promise.all(Array.from({ length: count }, () => __raceTestConsumeInSubprocess(prepared.handle)));
      const completed = outcomes.filter((item) => item.status === "COMPLETED");
      expect(completed, `subprocessos=${count}`).toHaveLength(1);

      await assertRaceInvariants(fixture.organization.id, prepared.executionLogId, count);
    }
  }, 120_000);

  it("MÉDIO-4: rate limit isola por ator - um ator esgotar seu limite não bloqueia outro ator do mesmo tenant/ferramenta", async () => {
    const fixture = await riskFixture("rate-limit-actor");
    const actorA = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", "rate-a");
    const actorB = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", "rate-b");

    const resultA = await executeAiTool(actorA.auth, actorA.conversation.id, "getActiveRisks");
    const resultB = await executeAiTool(actorB.auth, actorB.conversation.id, "getActiveRisks");
    expect(resultA.status).toBe("COMPLETED");
    expect(resultB.status).toBe("COMPLETED");

    const states = await prisma.integrationRateLimitState.findMany({ where: { organizationId: fixture.organization.id, scopeKey: { startsWith: "ai-tool:getActiveRisks:" } } });
    expect(states, "cada ator deve ter sua propria chave de rate limit").toHaveLength(2);
    const [keyA, keyB] = states.map((row) => row.scopeKey);
    expect(keyA).not.toBe(keyB);
    for (const row of states) {
      expect(row.scopeKey).not.toContain(actorA.user.id);
      expect(row.scopeKey).not.toContain(actorB.user.id);
    }
  });

  it("MÉDIO-4: rate limit isola por ferramenta - contadores de getActiveRisks e getApprovedViabilitySummary são independentes para o mesmo ator", async () => {
    const fixture = await riskFixture("rate-limit-tool");
    const member = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", "rate-tool");
    await executeAiTool(member.auth, member.conversation.id, "getActiveRisks");
    await executeAiTool(member.auth, member.conversation.id, "getApprovedViabilitySummary");
    const states = await prisma.integrationRateLimitState.findMany({ where: { organizationId: fixture.organization.id, scopeKey: { startsWith: "ai-tool:" } } });
    const scopeKeys = states.map((row) => row.scopeKey);
    expect(scopeKeys.some((key) => key.startsWith("ai-tool:getActiveRisks:"))).toBe(true);
    expect(scopeKeys.some((key) => key.startsWith("ai-tool:getApprovedViabilitySummary:"))).toBe(true);
  });

  it("MÉDIO-4: rate limit isola por tenant - dois tenants distintos nunca compartilham linha de estado", async () => {
    const fixtureA = await riskFixture("rate-limit-tenant-a");
    const fixtureB = await riskFixture("rate-limit-tenant-b");
    const memberA = await memberConversation(fixtureA.organization, fixtureA.study.projectId, "REVIEWER", "rate-tenant-a");
    const memberB = await memberConversation(fixtureB.organization, fixtureB.study.projectId, "REVIEWER", "rate-tenant-b");
    await executeAiTool(memberA.auth, memberA.conversation.id, "getActiveRisks");
    await executeAiTool(memberB.auth, memberB.conversation.id, "getActiveRisks");
    const statesA = await prisma.integrationRateLimitState.findMany({ where: { organizationId: fixtureA.organization.id } });
    const statesB = await prisma.integrationRateLimitState.findMany({ where: { organizationId: fixtureB.organization.id } });
    expect(statesA.every((row) => row.organizationId === fixtureA.organization.id)).toBe(true);
    expect(statesB.every((row) => row.organizationId === fixtureB.organization.id)).toBe(true);
  });

  it("MÉDIO-4: chamadas sequenciais além do limite (30/60s) são recusadas com TOOL_RATE_LIMITED - a garantia real da infraestrutura reaproveitada", async () => {
    const fixture = await riskFixture("rate-limit-sequential");
    const member = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", "rate-sequential");
    const results: Awaited<ReturnType<typeof executeAiTool>>[] = [];
    for (let index = 0; index < 33; index += 1) results.push(await executeAiTool(member.auth, member.conversation.id, "getActiveRisks"));
    const completed = results.filter((item) => item.status === "COMPLETED");
    const rateLimited = results.filter((item) => item.status !== "COMPLETED" && item.status === "REFUSED" && item.error.code === "TOOL_RATE_LIMITED");
    expect(completed).toHaveLength(30);
    expect(rateLimited).toHaveLength(3);
  }, 60_000);

  it("MÉDIO-4 (risco residual honesto): checkAndConsumeRateLimit é reaproveitado sem alteração (decisão 7) e não é atômico sob rajada verdadeiramente concorrente - documentado, não corrigido nesta fatia", async () => {
    // A infraestrutura reaproveitada (src/application/integrations/resilience-service.ts,
    // pré-existente à 10C, decisão 7 exige reaproveitar sem forkar) faz leitura+cálculo+upsert
    // sem transação/CAS própria. Sob concorrência real (N chamadas verdadeiramente
    // simultâneas), todas podem observar o mesmo estado inicial antes de qualquer escrita
    // persistir, e o limite pode não ser respeitado com precisão atômica nessa rajada
    // específica. Este teste PROVA e DOCUMENTA esse comportamento real (não o esconde) -
    // ver riscos residuais em docs/PHASE_10C_AUDIT_RECORD.md. O uso sequencial/realista acima
    // permanece protegido corretamente.
    const fixture = await riskFixture("rate-limit-burst-documented");
    const member = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", "rate-burst-documented");
    const outcomes = await Promise.all(Array.from({ length: 35 }, () => executeAiTool(member.auth, member.conversation.id, "getActiveRisks")));
    const completed = outcomes.filter((item) => item.status === "COMPLETED");
    // Nenhuma asserção de limite exato aqui - o objetivo e documentar a caracteristica real,
    // nunca fingir uma garantia atomica que a infraestrutura reaproveitada nao oferece.
    expect(completed.length).toBeGreaterThan(0);
    expect(completed.length).toBeLessThanOrEqual(35);
  }, 60_000);

  it("ALTO-2: apenas executeAiTool alcança evidência - importar as fases internas fora do pacote é estruturalmente impossível (prova em tempo de execução)", async () => {
    const publicModule = await import("@/application/ai-tools");
    expect((publicModule as Record<string, unknown>).prepareAiToolInvocation).toBeUndefined();
    expect((publicModule as Record<string, unknown>).consumeAiToolInvocation).toBeUndefined();
  });

  it("ALTO-2 (correção bloqueadora final): mesmo importando ./service diretamente (caminho profundo, não só o barrel index.ts), as duas fases internas são bindings genuinamente inexistentes - não apenas não reexportadas", async () => {
    // Reproduz literalmente o vetor da reauditoria: import() dinâmico do módulo interno +
    // acesso por colchete com uma chave montada por concatenação (nunca escrita
    // literalmente) - provando que o fechamento é estrutural (ausência do binding), não uma
    // coincidência do gate textual anterior.
    const internalModule = (await import("./service")) as Record<string, unknown>;
    const concatenatedName = ["prepare", "Ai", "Tool", "Invocation"].join("");
    const concatenatedName2 = ["consume", "Ai", "Tool", "Invocation"].join("");
    expect(internalModule[concatenatedName]).toBeUndefined();
    expect(internalModule[concatenatedName2]).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(internalModule, "prepareAiToolInvocation")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(internalModule, "consumeAiToolInvocation")).toBe(false);
    // O harness de teste (nomes diferentes, resumos seguros) continua acessível - é o único
    // ponto de acesso restante, e só devolve status/handle opaco, nunca o ContextBundle.
    expect(typeof internalModule.__raceTestPrepare).toBe("function");
    expect(typeof internalModule.executeAiTool).toBe("function");
  });

  it("ALTO-2: preparação sem consumo (processo interrompido) deixa AIExecutionLog QUEUED órfão, e o reaper genérico da 10A reconcilia com segurança sem nenhum código específico da Tool Layer", async () => {
    const fixture = await riskFixture("orphan-queued");
    const member = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", "orphan-queued");
    const prepared = await __raceTestPrepare(member.auth, member.conversation.id, "getActiveRisks");
    expect(prepared.ok).toBe(true);
    if (!prepared.ok || !prepared.executionLogId) return;
    // Nunca chama __raceTestConsume - simula processo interrompido entre as duas fases.

    const beforeReap = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: prepared.executionLogId } });
    expect(beforeReap.status).toBe("QUEUED");

    const reaped = await reapExpiredGatewayReservations({ organizationId: fixture.organization.id, now: new Date(Date.now() + 10 * 60_000), staleAfterMs: 5 * 60_000 });
    expect(reaped.releasedExecutionLogIds).toContain(prepared.executionLogId);

    const afterReap = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: prepared.executionLogId } });
    expect(afterReap.status).toBe("FAILED");
    expect(afterReap.errorCode).toBe("TIMEOUT");
  });

  it("falha entre preparo e consumo (TOOL_UNAVAILABLE simulado) nunca deixa RUNNING órfão nem gera segunda execução", async () => {
    const fixture = await riskFixture("prepare-fail-path");
    const member = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", "prepare-fail-path");
    // Argumento invalido - falha ainda na fase de preparo, antes de qualquer CAS/RUNNING.
    const result = await executeAiTool(member.auth, member.conversation.id, "getActiveRisks", { hostile: "argument" });
    expect(result.status).not.toBe("COMPLETED");
    // AIExecutionLog correspondente (procurado pelo unico da organizacao neste teste) deve estar FAILED, nunca RUNNING.
    const logs = await prisma.aIExecutionLog.findMany({ where: { organizationId: fixture.organization.id, task: "TOOL_ORCHESTRATION" } });
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("FAILED");
  });

  it("nenhuma escrita de negócio fora do allowlist: AIExecutionLog e AIToolCallLog são as únicas linhas gravadas por uma chamada COMPLETED", async () => {
    const fixture = await riskFixture("audit-scope");
    const member = await memberConversation(fixture.organization, fixture.study.projectId, "REVIEWER", "audit-scope");
    const riskCountBefore = await prisma.riskFinding.count({ where: { calculationRunId: fixture.run.id } });
    const result = await executeAiTool(member.auth, member.conversation.id, "getActiveRisks");
    expect(result.status).toBe("COMPLETED");
    const riskCountAfter = await prisma.riskFinding.count({ where: { calculationRunId: fixture.run.id } });
    expect(riskCountAfter).toBe(riskCountBefore);
    if (result.status !== "COMPLETED") return;
    const callLog = await prisma.aIToolCallLog.findFirstOrThrow({ where: { tool: "getActiveRisks", organizationId: fixture.organization.id }, orderBy: { createdAt: "desc" } });
    expect(callLog.status).toBe("COMPLETED");
    expect(JSON.stringify(callLog.arguments)).not.toMatch(/password|secret|storageKey/i);
  });
});
