import { createHash } from "node:crypto";
import { Prisma, type MembershipRole } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { addInvestmentCondition, createDecisionSandbox, getLatestInvestmentCaseForOrganization, promoteDecisionSandbox } from "@/application/investment/investment-service";
import { generateMasterReport, generateStudioArtifact, preflightMasterReport } from "@/application/investment/studio-service";
import { AI_CONTEXT_BUILDER_VERSION, AI_PROMPT_VERSION, AI_TOOLS_VERSION, AIModelRouter, DEFAULT_AI_SUGGESTIONS, REDE_AI_SYSTEM_PROMPT, aiQuestionSchema, confirmationSchema, createAIProvider, feedbackSchema, insightSchema, planAIIntent, responseModeSchema, type AIAnswer, type AIBootstrapView, type AIConversationView, type AIMessageView, type AIModelPolicy, type AIResponseEvidenceInput, type AIStructuredBlock, type AITask, type AIToolCallResult } from "@/domain/ai";
import { renderDocumentPdf, type IntermediateDocumentModel } from "@/domain/investment";
import { prisma } from "@/infrastructure/database/prisma";
import { buildAIContext, contextSelectionFromWorkspace } from "./context-builder";
import { composeGroundedAnswer } from "./composer";
import { aiToolRegistry } from "./tool-registry";

const roleCanMutate = (role: MembershipRole) => role === "OWNER" || role === "ADMIN";
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const safeError = (error: unknown) => error instanceof Error && /não encontrado|não possui|não pode|não está disponível|limite|permissão/i.test(error.message) ? error.message : "Não foi possível concluir esta análise.";
const truncate = (value: string, length: number) => value.length <= length ? value : `${value.slice(0, length - 1).trim()}…`;

function automaticTitle(question: string) {
  const clean = question.replace(/[?!.]+$/g, "").trim();
  if (/funding|exposi/i.test(clean)) return "Funding e exposição";
  if (/compar/i.test(clean) && /v\d|vers/i.test(clean)) return truncate(clean, 58);
  if (/comit[eê]/i.test(clean)) return "Preparação do Comitê";
  if (/urban|zoneamento|\bca\b/i.test(clean)) return "Análise urbanística";
  if (/risco|red team/i.test(clean)) return "Riscos e Red Team";
  return truncate(clean.charAt(0).toUpperCase() + clean.slice(1), 58);
}

function conversationView(row: {
  id: string; title: string; scope: string; responseMode: string; audience: string; contextSnapshot: unknown; sourceStudyVersionNumber: number | null; createdAt: Date; updatedAt: Date;
  messages: { id: string; role: string; content: string; structuredContent: unknown; toolCalls: unknown; createdAt: Date; evidence: { statementId: string; sourceType: string; entityType: string; entityId: string; field: string | null; version: string | null; scenario: string | null; documentId: string | null; evidenceRef: string; confidence: string; label: string; value: string | null; location: string | null; metadata: unknown }[] }[];
  pendingActions: { id: string; actionType: string; status: string; preview: unknown; createdAt: Date }[];
}, latestVersion: number): AIConversationView {
  return { id: row.id, title: row.title, scope: row.scope, responseMode: row.responseMode as AIConversationView["responseMode"], audience: row.audience, context: row.contextSnapshot as AIConversationView["context"], stale: row.sourceStudyVersionNumber !== null && row.sourceStudyVersionNumber !== latestVersion, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), messages: row.messages.map((message): AIMessageView => ({ id: message.id, role: message.role as AIMessageView["role"], content: message.content, structuredContent: (message.structuredContent ?? []) as unknown as AIStructuredBlock[], toolCalls: (message.toolCalls ?? []) as unknown as AIToolCallResult[], evidence: message.evidence.map((item) => ({ statementId: item.statementId, sourceType: item.sourceType as AIResponseEvidenceInput["sourceType"], entityType: item.entityType, entityId: item.entityId, field: item.field ?? undefined, version: item.version ?? undefined, scenario: item.scenario ?? undefined, documentId: item.documentId ?? undefined, evidenceRef: item.evidenceRef, confidence: item.confidence as AIResponseEvidenceInput["confidence"], label: item.label, value: item.value ?? undefined, location: item.location ?? undefined, metadata: (item.metadata ?? undefined) as Record<string, unknown> | undefined })), createdAt: message.createdAt.toISOString() })), pendingActions: row.pendingActions.map((item) => ({ id: item.id, actionType: item.actionType, status: item.status, preview: item.preview as Record<string, unknown>, createdAt: item.createdAt.toISOString() })) };
}

const conversationInclude = { messages: { orderBy: { createdAt: "asc" as const }, include: { evidence: { orderBy: { createdAt: "asc" as const } } } }, pendingActions: { orderBy: { createdAt: "desc" as const }, take: 20 } };

export async function createAIConversation(context: Pick<AuthContext, "organizationId" | "userId">, currentModule = "ai") {
  const workspace = await getLatestInvestmentCaseForOrganization(context.organizationId);
  if (!workspace) throw new Error("Investment Case não encontrado nesta organização.");
  const selection = { ...contextSelectionFromWorkspace(workspace), currentModule };
  return prisma.aIConversation.create({ data: { organizationId: context.organizationId, projectId: selection.projectId, studyId: selection.studyId, studyVersionId: selection.studyVersionId, investmentCaseId: selection.investmentCaseId, title: "Nova análise", scope: "GLOBAL_PROJECT_CONTEXT", activeScenario: selection.financialScenario, activeUrbanScenario: selection.urbanScenarioId, contextSnapshot: json(selection), sourceStudyVersionNumber: selection.studyVersionNumber, createdById: context.userId }, include: conversationInclude });
}

export async function getAIBootstrap(context: AuthContext, currentModule = "ai"): Promise<AIBootstrapView> {
  const workspace = await getLatestInvestmentCaseForOrganization(context.organizationId);
  if (!workspace) throw new Error("Investment Case não encontrado nesta organização.");
  let rows = await prisma.aIConversation.findMany({ where: { organizationId: context.organizationId, createdById: context.userId, investmentCaseId: workspace.id }, orderBy: { updatedAt: "desc" }, take: 20, include: conversationInclude });
  if (!rows.length) rows = [await createAIConversation(context, currentModule)];
  const month = new Date(); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
  const usage = await prisma.aIExecutionLog.aggregate({ where: { organizationId: context.organizationId, createdAt: { gte: month } }, _count: { id: true }, _sum: { inputTokens: true, outputTokens: true, estimatedCost: true } });
  const provider = createAIProvider();
  return { status: provider.status, conversations: rows.map((row) => conversationView(row, workspace.bundle.studyVersionNumber)), activeConversation: conversationView(rows[0], workspace.bundle.studyVersionNumber), suggestions: DEFAULT_AI_SUGGESTIONS, usage: { calls: usage._count.id, inputTokens: usage._sum.inputTokens ?? 0, outputTokens: usage._sum.outputTokens ?? 0, estimatedCost: Number(usage._sum.estimatedCost ?? 0) }, contextLabels: { projectName: workspace.bundle.project.name, investmentCaseTitle: workspace.title } };
}

export async function updateAIConversationResponseMode(context: Pick<AuthContext, "organizationId" | "userId">, conversationId: string, mode: "EXECUTIVE" | "DETAILED" | "TECHNICAL") {
  const parsedMode = responseModeSchema.parse(mode);
  const result = await prisma.aIConversation.updateMany({ where: { id: conversationId, organizationId: context.organizationId, createdById: context.userId }, data: { responseMode: parsedMode } });
  if (!result.count) throw new Error("Conversa não encontrada nesta organização.");
}

async function enforceUsageLimits(context: AuthContext) {
  const budget = await prisma.aIUsageBudget.findUnique({ where: { organizationId: context.organizationId } });
  const since = new Date(Date.now() - 60_000);
  const requests = await prisma.aIExecutionLog.count({ where: { organizationId: context.organizationId, userId: context.userId, createdAt: { gte: since } } });
  if (requests >= (budget?.maxRequestsPerMinute ?? 20)) throw new Error("Limite temporário de uso do REDE AI atingido. Tente novamente em um minuto.");
  if (budget && Number(budget.monthlyLimit) > 0) {
    const month = new Date(); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
    const usage = await prisma.aIExecutionLog.aggregate({ where: { organizationId: context.organizationId, createdAt: { gte: month } }, _sum: { estimatedCost: true } });
    if (Number(usage._sum.estimatedCost ?? 0) >= Number(budget.monthlyLimit)) throw new Error("O orçamento mensal do REDE AI foi atingido.");
  }
  return budget?.maxToolSteps ?? 8;
}

async function policiesForOrganization(organizationId: string): Promise<AIModelPolicy[]> {
  const rows = await prisma.aITaskPolicy.findMany({ where: { organizationId, enabled: true } });
  return rows.map((item) => ({ task: item.task as AITask, provider: item.provider, model: item.model, maxTokens: item.maxTokens, temperature: Number(item.temperature), enabled: item.enabled }));
}

function compactToolCalls(tools: AIToolCallResult[]): AIToolCallResult[] {
  return tools.map((item) => { const serialized = JSON.stringify(item.data ?? null); return serialized.length <= 16_000 ? item : { ...item, data: { summary: truncate(serialized, 4000), truncated: true } }; });
}

async function pendingAction(context: AuthContext, conversationId: string, sourceMessageId: string, actionType: string, arguments_: Record<string, unknown>, preview: Record<string, unknown>) {
  const idempotencyKey = createHash("sha256").update(`${conversationId}:${sourceMessageId}:${actionType}:${JSON.stringify(arguments_)}`).digest("hex");
  return prisma.aIPendingAction.upsert({ where: { organizationId_idempotencyKey: { organizationId: context.organizationId, idempotencyKey } }, update: {}, create: { organizationId: context.organizationId, userId: context.userId, conversationId, sourceMessageId, actionType, arguments: json(arguments_), preview: json(preview), idempotencyKey, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
}

function actionPreview(actionType: string, args: Record<string, unknown>, answer: AIAnswer, version: number) {
  if (actionType === "GENERATE_MASTER_REPORT") return { title: "Gerar Dossiê Completo", type: "Master Report FINAL", origin: `Snapshot v${version}`, warnings: answer.content, requiresConfirmation: true };
  if (actionType === "GENERATE_DESIGN_REVIEW_REPORT") return { title: "Gerar Design Review Report", type: "PDF institucional no Studio e Data Room", origin: `Snapshot v${version}`, warnings: answer.content, requiresConfirmation: true };
  if (actionType === "GENERATE_STUDIO_DRAFT") return { title: "Gerar material Studio", type: args.type, format: args.format, origin: `Snapshot v${version}`, requiresConfirmation: true };
  if (actionType === "PROMOTE_SIMULATION") return { title: "Criar nova versão com esta hipótese", type: "StudyVersion", origin: `v${version}`, changes: args.changes, requiresConfirmation: true };
  return { title: "Ação proposta", type: actionType, origin: `v${version}`, requiresConfirmation: true };
}

export async function askRedeAI(context: AuthContext, input: { conversationId: string; question: string; currentModule: string }): Promise<{ answer: AIAnswer; message: AIMessageView }> {
  const parsed = aiQuestionSchema.parse(input);
  const maxToolSteps = await enforceUsageLimits(context);
  const relevant = await buildAIContext(context, parsed.conversationId, parsed.question, parsed.currentModule);
  const userMessage = await prisma.aIMessage.create({ data: { conversationId: parsed.conversationId, role: "USER", content: parsed.question, contextSnapshot: json(relevant.selection) } });
  const provider = createAIProvider();
  const plan = planAIIntent(parsed.question);
  const router = new AIModelRouter(provider, await policiesForOrganization(context.organizationId));
  const routed = router.route(plan.task);
  const execution = await prisma.aIExecutionLog.create({ data: { organizationId: context.organizationId, userId: context.userId, conversationId: parsed.conversationId, messageId: userMessage.id, task: plan.task, model: routed.policy.model, provider: provider.name, status: "RUNNING", promptVersion: AI_PROMPT_VERSION, toolsVersion: AI_TOOLS_VERSION, contextBuilderVersion: AI_CONTEXT_BUILDER_VERSION, startedAt: new Date() } });
  const started = Date.now();
  const results: AIToolCallResult[] = [];
  try {
    for (const call of plan.calls.slice(0, maxToolSteps)) {
      const toolStarted = Date.now();
      let item: AIToolCallResult;
      try { item = await aiToolRegistry.execute(relevant, call.name, call.arguments); item.durationMs = Date.now() - toolStarted; }
      catch (error) { item = { name: call.name, mode: aiToolRegistry.get(call.name)?.mode ?? "READ_ONLY", status: "FAILED", error: safeError(error), durationMs: Date.now() - toolStarted }; }
      results.push(item);
      await prisma.aIToolCallLog.create({ data: { executionId: execution.id, organizationId: context.organizationId, userId: context.userId, tool: call.name, mode: item.mode, arguments: json(call.arguments), resultSummary: json(compactToolCalls([item])[0]), durationMs: item.durationMs, status: item.status === "FAILED" ? "FAILED" : "COMPLETED", errorCode: item.status === "FAILED" ? "TOOL_FAILED" : null } });
    }
    const answer = composeGroundedAnswer(relevant, results, plan.task);
    answer.providerStatus = provider.status;
    let providerUsage = { inputTokens: Math.ceil(parsed.question.length / 4), outputTokens: Math.ceil(answer.content.length / 4), estimatedCost: 0, model: routed.policy.model, provider: provider.name };
    if (provider.status === "AVAILABLE") {
      try {
        const generated = await provider.generateText({ task: plan.task, model: routed.policy.model, systemPrompt: REDE_AI_SYSTEM_PROMPT, userPrompt: parsed.question, groundedContext: answer.content, maxTokens: routed.policy.maxTokens, temperature: routed.policy.temperature });
        if (numericGroundingSafe(generated.text, answer.content)) answer.content = generated.text;
        providerUsage = generated;
      } catch { answer.providerStatus = "LIMITED"; }
    }
    const mutation = plan.mutationIntent ?? (results.some((item) => item.name === "runEngineSimulation" && item.status === "COMPLETED") ? { actionType: "PROMOTE_SIMULATION", arguments: (plan.calls.find((item) => item.name === "runEngineSimulation")?.arguments ?? {}) as Record<string, unknown> } : undefined);
    if (mutation) {
      const action = await pendingAction(context, parsed.conversationId, userMessage.id, mutation.actionType, mutation.arguments, actionPreview(mutation.actionType, mutation.arguments, answer, relevant.selection.studyVersionNumber));
      answer.pendingAction = { id: action.id, actionType: action.actionType, preview: action.preview as Record<string, unknown> };
    }
    const storedTools = compactToolCalls(results);
    const assistant = await prisma.aIMessage.create({ data: { conversationId: parsed.conversationId, role: "ASSISTANT", content: answer.content, structuredContent: json(answer.structuredContent), evidenceRefs: json(answer.evidence.map((item) => item.evidenceRef)), toolCalls: json(storedTools), model: providerUsage.model, provider: providerUsage.provider, promptVersion: AI_PROMPT_VERSION, contextSnapshot: json(relevant.selection), evidence: { create: answer.evidence.map((item) => ({ statementId: item.statementId, sourceType: item.sourceType, entityType: item.entityType, entityId: item.entityId, field: item.field, version: item.version, scenario: item.scenario, documentId: item.documentId, evidenceRef: item.evidenceRef, confidence: item.confidence, label: item.label, value: item.value, location: item.location, metadata: item.metadata ? json(item.metadata) : undefined })) } }, include: { evidence: true } });
    const priorCount = await prisma.aIMessage.count({ where: { conversationId: parsed.conversationId, role: "USER" } });
    await prisma.aIConversation.update({ where: { id: parsed.conversationId }, data: { ...(priorCount === 1 ? { title: automaticTitle(parsed.question) } : {}), responseMode: plan.responseMode ?? relevant.responseMode, summary: truncate(answer.content, 900) } });
    await prisma.aIExecutionLog.update({ where: { id: execution.id }, data: { messageId: assistant.id, model: providerUsage.model, provider: providerUsage.provider, status: answer.providerStatus === "LIMITED" ? "LIMITED" : "COMPLETED", durationMs: Date.now() - started, inputTokens: providerUsage.inputTokens, outputTokens: providerUsage.outputTokens, estimatedCost: providerUsage.estimatedCost, completedAt: new Date() } });
    return { answer, message: { id: assistant.id, role: "ASSISTANT", content: assistant.content, structuredContent: assistant.structuredContent as unknown as AIStructuredBlock[], toolCalls: storedTools, evidence: assistant.evidence.map((item) => ({ statementId: item.statementId, sourceType: item.sourceType, entityType: item.entityType, entityId: item.entityId, field: item.field ?? undefined, version: item.version ?? undefined, scenario: item.scenario ?? undefined, documentId: item.documentId ?? undefined, evidenceRef: item.evidenceRef, confidence: item.confidence, label: item.label, value: item.value ?? undefined, location: item.location ?? undefined, metadata: item.metadata as Record<string, unknown> | undefined })), createdAt: assistant.createdAt.toISOString() } };
  } catch (error) {
    await prisma.aIExecutionLog.update({ where: { id: execution.id }, data: { status: "FAILED", durationMs: Date.now() - started, errorCode: "EXECUTION_FAILED", errorMessage: safeError(error), completedAt: new Date() } });
    throw new Error(safeError(error));
  }
}

function numericGroundingSafe(generated: string, grounded: string) {
  const normalizeNumbers = (text: string) => new Set(text.match(/-?\d+(?:[.,]\d+)?/g)?.map((value) => value.replace(",", ".")) ?? []);
  const allowed = normalizeNumbers(grounded);
  return [...normalizeNumbers(generated)].every((value) => allowed.has(value));
}

export async function confirmAIAction(context: AuthContext, input: { actionId: string; decision: "CONFIRM" | "CANCEL" }) {
  const parsed = confirmationSchema.parse(input);
  const action = await prisma.aIPendingAction.findFirst({ where: { id: parsed.actionId, organizationId: context.organizationId }, include: { conversation: true } });
  if (!action) throw new Error("Ação não encontrada nesta organização.");
  if (action.status === "COMPLETED") return action;
  if (action.status !== "PENDING_CONFIRMATION" || action.expiresAt <= new Date()) throw new Error("Esta ação não está mais disponível para confirmação.");
  if (parsed.decision === "CANCEL") return prisma.aIPendingAction.update({ where: { id: action.id }, data: { status: "CANCELLED" } });
  if (!roleCanMutate(context.role)) throw new Error("Somente Owner ou Admin pode confirmar esta ação.");
  await prisma.aIPendingAction.update({ where: { id: action.id }, data: { status: "EXECUTING", confirmedAt: new Date() } });
  const args = action.arguments as Record<string, unknown>;
  try {
    let result: unknown;
    let entityType: string | undefined;
    let entityId: string | undefined;
    if (action.actionType === "GENERATE_MASTER_REPORT") {
      const preflight = await preflightMasterReport(context, action.conversation.investmentCaseId!, (args.level as "EXECUTIVE" | "COMPLETE" | "FULL_DOSSIER" | "CUSTOM") ?? "FULL_DOSSIER", "INTERNAL");
      result = await generateMasterReport(context, action.conversation.investmentCaseId!, preflight.config, args.final !== false); entityType = "StudioArtifact"; entityId = (result as { artifactId: string }).artifactId;
    } else if (action.actionType === "GENERATE_DESIGN_REVIEW_REPORT") {
      const designPackage = await prisma.designProjectPackage.findFirst({ where: { organizationId: context.organizationId, investmentCaseId: action.conversation.investmentCaseId!, projectId: action.conversation.projectId! }, orderBy: { updatedAt: "desc" } });
      if (!designPackage) throw new Error("Project Package de Design não encontrado nesta organização.");
      const { generateDesignReviewReport } = await import("@/application/design/design-report-service");
      result = await generateDesignReviewReport(context, designPackage.id); entityType = "StudioArtifact"; entityId = (result as { artifactId: string }).artifactId;
    } else if (action.actionType === "GENERATE_STUDIO_DRAFT") {
      result = await generateStudioArtifact(context, { investmentCaseId: action.conversation.investmentCaseId!, type: args.type as "INVESTMENT_BOOK" | "INVESTMENT_MEMO" | "INVESTOR_DECK" | "ONE_PAGE" | "COMMITTEE_MEMO" | "URBAN_CASE" | "EXECUTIVE_REPORT" | "RED_TEAM_REPORT" | "DATA_ROOM_INDEX" | "INVESTOR_QA_PACK" | "MANAGEMENT_SUMMARY" | "BOARD_SUMMARY" | "MUNICIPALITY_PRESENTATION" | "LANDOWNER_PRESENTATION" | "FINANCIER_PACK", audience: "INTERNAL", format: args.format as "PDF" | "PPTX" }); entityType = "StudioArtifact"; entityId = (result as { artifactId: string }).artifactId;
    } else if (action.actionType === "PROMOTE_SIMULATION") {
      const relevant = await buildAIContext(context, action.conversationId, "Promover simulação confirmada", "ai");
      const parsedSimulation = args as { changes?: Record<string, number> };
      const { applySimulationChanges } = await import("./tool-registry").then((module) => module.aiToolInternals);
      const assumptions = applySimulationChanges(relevant.workspace.bundle.assumptions, parsedSimulation.changes ?? {});
      const changed = Object.fromEntries(Object.entries(assumptions).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(relevant.workspace.bundle.assumptions[key as keyof typeof assumptions])));
      const sandboxWorkspace = await createDecisionSandbox(context, relevant.workspace.id, `REDE AI · confirmação ${action.id.slice(-6)}`, changed);
      const sandbox = sandboxWorkspace.sandboxes[0];
      result = await promoteDecisionSandbox(context, relevant.workspace.id, sandbox.id); entityType = "StudyVersion"; entityId = (result as { bundle: { studyVersionId: string } }).bundle.studyVersionId;
    } else if (["PROMOTE_TO_ACTION", "PROMOTE_TO_RISK", "PROMOTE_TO_CONDITION", "PROMOTE_TO_COMMITTEE_QUESTION"].includes(action.actionType)) {
      const message = await prisma.aIMessage.findFirstOrThrow({ where: { id: action.sourceMessageId!, conversation: { organizationId: context.organizationId } } });
      const investmentCaseId = action.conversation.investmentCaseId!;
      if (action.actionType === "PROMOTE_TO_ACTION") { const row = await prisma.investmentIssue.create({ data: { investmentCaseId, title: truncate(message.content, 140), status: "ACTIVE", priority: "HIGH", ownerId: context.userId, nextAction: message.content, source: `ai-message:${message.id}`, createdById: context.userId, updatedById: context.userId } }); result = row; entityType = "InvestmentIssue"; entityId = row.id; }
      if (action.actionType === "PROMOTE_TO_RISK") { const row = await prisma.urbanRiskItem.create({ data: { investmentCaseId, title: truncate(message.content, 140), severity: "HIGH", status: "ACTIVE", source: "REDE_AI", ownerId: context.userId, mitigation: "Revisar e atribuir plano de mitigação.", evidenceRef: `ai-message:${message.id}`, createdById: context.userId } }); result = row; entityType = "UrbanRiskItem"; entityId = row.id; }
      if (action.actionType === "PROMOTE_TO_CONDITION") { result = await addInvestmentCondition(context, { investmentCaseId, title: truncate(message.content, 120), description: message.content, category: "AI_RECOMMENDATION", priority: "HIGH", isBlocker: false, evidenceRequired: `Validar recomendação originada da mensagem ${message.id}` }); entityType = "InvestmentCondition"; }
      if (action.actionType === "PROMOTE_TO_COMMITTEE_QUESTION") { const row = await prisma.committeeQuestion.create({ data: { investmentCaseId, question: message.content, evidenceRefs: json([`ai-message:${message.id}`]), createdById: context.userId } }); result = row; entityType = "CommitteeQuestion"; entityId = row.id; }
    } else throw new Error("Tipo de ação não suportado.");
    await prisma.aIPendingAction.update({ where: { id: action.id }, data: { status: "COMPLETED", result: json(compactMutationResult(result)), affectedEntityType: entityType, affectedEntityId: entityId, executedAt: new Date() } });
    await prisma.investmentAuditLog.create({ data: { investmentCaseId: action.conversation.investmentCaseId!, userId: context.userId, action: `REDE_AI_${action.actionType}`, entityType: entityType ?? "AIAction", entityId: entityId ?? action.id, after: json({ conversationId: action.conversationId, actionId: action.id, confirmed: true }) } });
    return prisma.aIPendingAction.findUniqueOrThrow({ where: { id: action.id } });
  } catch (error) {
    await prisma.aIPendingAction.update({ where: { id: action.id }, data: { status: "FAILED", result: json({ error: safeError(error) }), executedAt: new Date() } });
    throw new Error(safeError(error));
  }
}

const compactMutationResult = (value: unknown) => { const serialized = JSON.stringify(value); return serialized.length < 8000 ? value : { completed: true, summary: truncate(serialized, 4000) }; };

export async function requestMessagePromotion(context: AuthContext, messageId: string, type: "ACTION" | "RISK" | "CONDITION" | "COMMITTEE_QUESTION") {
  const message = await prisma.aIMessage.findFirst({ where: { id: messageId, role: "ASSISTANT", conversation: { organizationId: context.organizationId } }, include: { conversation: true } });
  if (!message) throw new Error("Mensagem não encontrada nesta organização.");
  const actionType = `PROMOTE_TO_${type}`;
  return pendingAction(context, message.conversationId, message.id, actionType, { messageId }, { title: `Promover resposta para ${type}`, content: truncate(message.content, 600), requiresConfirmation: true });
}

export async function saveAIInsight(context: AuthContext, input: { messageId: string; title: string }) {
  const parsed = insightSchema.parse(input);
  const message = await prisma.aIMessage.findFirst({ where: { id: parsed.messageId, role: "ASSISTANT", conversation: { organizationId: context.organizationId } }, include: { conversation: true, evidence: true } });
  if (!message) throw new Error("Mensagem não encontrada nesta organização.");
  return prisma.aIInsight.create({ data: { organizationId: context.organizationId, conversationId: message.conversationId, sourceMessageId: message.id, projectId: message.conversation.projectId, studyVersionId: message.conversation.studyVersionId, title: parsed.title, content: message.content, evidence: json(message.evidence.map((item) => item.evidenceRef)), createdById: context.userId } });
}

export async function saveAIFeedback(context: AuthContext, input: { messageId: string; rating: "POSITIVE" | "NEGATIVE"; reason?: string; comment?: string }) {
  const parsed = feedbackSchema.parse(input);
  const message = await prisma.aIMessage.findFirst({ where: { id: parsed.messageId, conversation: { organizationId: context.organizationId } } });
  if (!message) throw new Error("Mensagem não encontrada nesta organização.");
  return prisma.aIFeedback.upsert({ where: { messageId_userId: { messageId: message.id, userId: context.userId } }, update: { rating: parsed.rating, reason: parsed.reason, comment: parsed.comment }, create: { organizationId: context.organizationId, messageId: message.id, userId: context.userId, rating: parsed.rating, reason: parsed.reason, comment: parsed.comment } });
}

export async function exportAIConversationPdf(context: AuthContext, conversationId: string) {
  const conversation = await prisma.aIConversation.findFirst({ where: { id: conversationId, organizationId: context.organizationId }, include: { messages: { orderBy: { createdAt: "asc" }, include: { evidence: true } } } });
  if (!conversation?.investmentCaseId) throw new Error("Conversa não encontrada nesta organização.");
  const workspace = await getLatestInvestmentCaseForOrganization(context.organizationId);
  if (!workspace || workspace.id !== conversation.investmentCaseId) throw new Error("Investment Case não encontrado nesta organização.");
  const model: IntermediateDocumentModel = { schemaVersion: "REDE_AI_CONVERSATION_V1", artifactType: "MANAGEMENT_SUMMARY", title: conversation.title, subtitle: `${workspace.bundle.project.name} · Snapshot v${conversation.sourceStudyVersionNumber ?? workspace.bundle.studyVersionNumber}`, metadata: { conversationId: conversation.id, generatedBy: context.userName }, sections: conversation.messages.map((message, index) => ({ key: `message-${message.id}`, title: `${message.role === "USER" ? "Pergunta" : "REDE AI"} ${index + 1}`, order: index + 1, blocks: [{ type: "NARRATIVE", narrative: { id: message.id, text: message.content, origin: "SYSTEM_GENERATED", evidenceRefs: message.evidence.map((item) => ({ ref: item.evidenceRef, label: item.label, sourceVersion: item.version ?? "contexto persistido" })) } }] })), disclaimers: ["Conversa de apoio à decisão. Não constitui documento oficial nem garantia de resultado."], sources: [], generatedAt: new Date().toISOString(), audience: "INTERNAL", confidentialityBySection: Object.fromEntries(conversation.messages.map((message) => [`message-${message.id}`, "STRICTLY_CONFIDENTIAL"])) };
  const rendered = await renderDocumentPdf(model, workspace.brand, { watermark: "CONFIDENTIAL" });
  return { fileName: `REDE_AI_${conversation.id}.pdf`, mimeType: "application/pdf", content: rendered.bytes, checksum: rendered.checksum, pageCount: rendered.pageCount };
}

export async function getAIUsageDashboard(context: Pick<AuthContext, "organizationId">) {
  const month = new Date(); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
  const rows = await prisma.aIExecutionLog.groupBy({ by: ["task", "provider", "model"], where: { organizationId: context.organizationId, createdAt: { gte: month } }, _count: { id: true }, _sum: { inputTokens: true, outputTokens: true, estimatedCost: true, durationMs: true } });
  return rows.map((row) => ({ task: row.task, provider: row.provider, model: row.model, calls: row._count.id, inputTokens: row._sum.inputTokens ?? 0, outputTokens: row._sum.outputTokens ?? 0, cost: Number(row._sum.estimatedCost ?? 0), durationMs: row._sum.durationMs ?? 0 }));
}
