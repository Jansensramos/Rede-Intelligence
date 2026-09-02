"use server";

import { requireAuthContext } from "@/application/auth/session";
import { confirmAIAction, createAIConversation, exportAIConversationPdf, getAIBootstrap, requestMessagePromotion, saveAIFeedback, saveAIInsight, updateAIConversationResponseMode } from "@/application/ai/ai-service";
import { assertProtectedReadCapability, isReadAccessDeniedError } from "@/domain/auth/read-capabilities";

const errorMessage = (error: unknown) => isReadAccessDeniedError(error)
  ? "Seu perfil não possui acesso aos recursos da REDE AI."
  : error instanceof Error ? error.message : "Não foi possível concluir esta ação.";

async function authorizedAIContext() {
  const context = await requireAuthContext();
  assertProtectedReadCapability(context.role, "AI_READ");
  return context;
}

// Fase 9K.0 (fechamento, gate 3): projectId é obrigatório e vem sempre do OperationalContext já
// resolvido pela tela — nunca de uma segunda resolução independente dentro do REDE AI.
export async function refreshAIBootstrapAction(projectId: string, currentModule = "ai") {
  try { const context = await authorizedAIContext(); return { ok: true as const, data: await getAIBootstrap(context, projectId, currentModule) }; }
  catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}

export async function createAIConversationAction(projectId: string, currentModule = "ai") {
  try { const context = await authorizedAIContext(); const row = await createAIConversation(context, projectId, currentModule); return { ok: true as const, data: { id: row.id } }; }
  catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}

export async function updateAIResponseModeAction(conversationId: string, mode: "EXECUTIVE" | "DETAILED" | "TECHNICAL") {
  try { await updateAIConversationResponseMode(await authorizedAIContext(), conversationId, mode); return { ok: true as const }; }
  catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}

export async function confirmAIActionAction(actionId: string, decision: "CONFIRM" | "CANCEL") {
  try { return { ok: true as const, data: await confirmAIAction(await authorizedAIContext(), { actionId, decision }) }; }
  catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}

export async function saveAIInsightAction(messageId: string, title: string) {
  try { return { ok: true as const, data: await saveAIInsight(await authorizedAIContext(), { messageId, title }) }; }
  catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}

export async function saveAIFeedbackAction(messageId: string, rating: "POSITIVE" | "NEGATIVE", reason?: string) {
  try { return { ok: true as const, data: await saveAIFeedback(await authorizedAIContext(), { messageId, rating, reason }) }; }
  catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}

export async function requestMessagePromotionAction(messageId: string, type: "ACTION" | "RISK" | "CONDITION" | "COMMITTEE_QUESTION") {
  try { return { ok: true as const, data: await requestMessagePromotion(await authorizedAIContext(), messageId, type) }; }
  catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}

export async function exportAIConversationAction(conversationId: string) {
  try { const result = await exportAIConversationPdf(await authorizedAIContext(), conversationId); return { ok: true as const, data: { ...result, content: Buffer.from(result.content).toString("base64") } }; }
  catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}
