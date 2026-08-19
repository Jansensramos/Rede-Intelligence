"use server";

import { requireAuthContext } from "@/application/auth/session";
import { confirmAIAction, createAIConversation, exportAIConversationPdf, getAIBootstrap, requestMessagePromotion, saveAIFeedback, saveAIInsight, updateAIConversationResponseMode } from "@/application/ai/ai-service";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Não foi possível concluir esta ação.";

export async function refreshAIBootstrapAction(currentModule = "ai") {
  try { return { ok: true as const, data: await getAIBootstrap(await requireAuthContext(), currentModule) }; }
  catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}

export async function createAIConversationAction(currentModule = "ai") {
  try { const context = await requireAuthContext(); const row = await createAIConversation(context, currentModule); return { ok: true as const, data: { id: row.id } }; }
  catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}

export async function updateAIResponseModeAction(conversationId: string, mode: "EXECUTIVE" | "DETAILED" | "TECHNICAL") {
  try { await updateAIConversationResponseMode(await requireAuthContext(), conversationId, mode); return { ok: true as const }; }
  catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}

export async function confirmAIActionAction(actionId: string, decision: "CONFIRM" | "CANCEL") {
  try { return { ok: true as const, data: await confirmAIAction(await requireAuthContext(), { actionId, decision }) }; }
  catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}

export async function saveAIInsightAction(messageId: string, title: string) {
  try { return { ok: true as const, data: await saveAIInsight(await requireAuthContext(), { messageId, title }) }; }
  catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}

export async function saveAIFeedbackAction(messageId: string, rating: "POSITIVE" | "NEGATIVE", reason?: string) {
  try { return { ok: true as const, data: await saveAIFeedback(await requireAuthContext(), { messageId, rating, reason }) }; }
  catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}

export async function requestMessagePromotionAction(messageId: string, type: "ACTION" | "RISK" | "CONDITION" | "COMMITTEE_QUESTION") {
  try { return { ok: true as const, data: await requestMessagePromotion(await requireAuthContext(), messageId, type) }; }
  catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}

export async function exportAIConversationAction(conversationId: string) {
  try { const result = await exportAIConversationPdf(await requireAuthContext(), conversationId); return { ok: true as const, data: { ...result, content: Buffer.from(result.content).toString("base64") } }; }
  catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}
