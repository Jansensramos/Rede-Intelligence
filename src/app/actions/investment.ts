"use server";

import { requireAuthContext } from "@/application/auth/session";
import {
  addInvestmentCondition,
  createDecisionSandbox,
  getArtifactDownload,
  recordCommitteeDecision,
  reassessInvestmentCase,
  registerProjectDocument,
  promoteDecisionSandbox,
  submitReviewRound,
  verifyInvestmentCondition,
} from "@/application/investment/investment-service";
import { generateMasterReport, generateStudioArtifact, preflightMasterReport } from "@/application/investment/studio-service";
import type { AudienceProfile, DataRoomCategory, MasterReportConfig, MasterReportLevel, StudioArtifactType } from "@/domain/investment";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function canEdit(role: string) {
  return ["OWNER", "ADMIN", "ANALYST"].includes(role);
}

function canReview(role: string) {
  return ["OWNER", "ADMIN", "REVIEWER"].includes(role);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "A operação não pôde ser concluída.";
}

export async function submitReviewRoundAction(investmentCaseId: string): Promise<ActionResult<Awaited<ReturnType<typeof submitReviewRound>>>> {
  const context = await requireAuthContext();
  if (!canEdit(context.role)) return { ok: false, error: "Seu perfil não pode submeter uma rodada." };
  try { return { ok: true, data: await submitReviewRound(context, investmentCaseId) }; } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function reassessInvestmentCaseAction(investmentCaseId: string, studyVersionId: string, landStudyVersionId: string | null): Promise<ActionResult<Awaited<ReturnType<typeof reassessInvestmentCase>>>> {
  const context = await requireAuthContext();
  if (!canEdit(context.role)) return { ok: false, error: "Seu perfil não pode reavaliar o caso." };
  try { return { ok: true, data: await reassessInvestmentCase(context, investmentCaseId, studyVersionId, landStudyVersionId) }; } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function recordCommitteeDecisionAction(input: Parameters<typeof recordCommitteeDecision>[1]): Promise<ActionResult<Awaited<ReturnType<typeof recordCommitteeDecision>>>> {
  const context = await requireAuthContext();
  if (!canReview(context.role)) return { ok: false, error: "Seu perfil não pode registrar a decisão do comitê." };
  try { return { ok: true, data: await recordCommitteeDecision(context, input) }; } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function addInvestmentConditionAction(input: Parameters<typeof addInvestmentCondition>[1]): Promise<ActionResult<Awaited<ReturnType<typeof addInvestmentCondition>>>> {
  const context = await requireAuthContext();
  if (!canReview(context.role)) return { ok: false, error: "Seu perfil não pode criar condicionantes." };
  try { return { ok: true, data: await addInvestmentCondition(context, input) }; } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function verifyInvestmentConditionAction(investmentCaseId: string, conditionId: string): Promise<ActionResult<Awaited<ReturnType<typeof verifyInvestmentCondition>>>> {
  const context = await requireAuthContext();
  try { return { ok: true, data: await verifyInvestmentCondition(context, investmentCaseId, conditionId) }; } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function registerProjectDocumentAction(input: { investmentCaseId: string; checklistItemId: string | null; category: DataRoomCategory; title: string; fileName: string; mimeType: string; contentBase64: string; confidentiality: "PUBLIC_INTERNAL" | "CONFIDENTIAL" | "STRICTLY_CONFIDENTIAL"; source?: string }): Promise<ActionResult<Awaited<ReturnType<typeof registerProjectDocument>>>> {
  const context = await requireAuthContext();
  if (!canEdit(context.role)) return { ok: false, error: "Seu perfil não pode registrar documentos." };
  if (input.contentBase64.length > 14_000_000) return { ok: false, error: "O arquivo excede o limite de 10 MB desta versão." };
  try {
    const { contentBase64, ...metadata } = input;
    return { ok: true, data: await registerProjectDocument(context, { ...metadata, content: Uint8Array.from(Buffer.from(contentBase64, "base64")) }) };
  } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function createDecisionSandboxAction(investmentCaseId: string, name: string, changes: Parameters<typeof createDecisionSandbox>[3]): Promise<ActionResult<Awaited<ReturnType<typeof createDecisionSandbox>>>> {
  const context = await requireAuthContext();
  if (!canEdit(context.role)) return { ok: false, error: "Seu perfil não pode simular decisões." };
  try { return { ok: true, data: await createDecisionSandbox(context, investmentCaseId, name, changes) }; } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function promoteDecisionSandboxAction(investmentCaseId: string, sandboxId: string): Promise<ActionResult<Awaited<ReturnType<typeof promoteDecisionSandbox>>>> {
  const context = await requireAuthContext();
  if (!canEdit(context.role)) return { ok: false, error: "Seu perfil não pode promover simulações." };
  try { return { ok: true, data: await promoteDecisionSandbox(context, investmentCaseId, sandboxId) }; } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function preflightMasterReportAction(investmentCaseId: string, level: MasterReportLevel, audience: AudienceProfile) {
  const context = await requireAuthContext();
  try { return { ok: true as const, data: await preflightMasterReport(context, investmentCaseId, level, audience) }; } catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}

export async function generateMasterReportAction(investmentCaseId: string, config: MasterReportConfig, final: boolean) {
  const context = await requireAuthContext();
  if (!canEdit(context.role)) return { ok: false as const, error: "Seu perfil não pode gerar artefatos." };
  try { return { ok: true as const, data: await generateMasterReport(context, investmentCaseId, config, final) }; } catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}

export async function generateStudioArtifactAction(input: { investmentCaseId: string; type: Exclude<StudioArtifactType, "MASTER_REPORT">; audience: AudienceProfile; format: "PDF" | "PPTX" }) {
  const context = await requireAuthContext();
  if (!canEdit(context.role)) return { ok: false as const, error: "Seu perfil não pode gerar artefatos." };
  try { return { ok: true as const, data: await generateStudioArtifact(context, input) }; } catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}

export async function downloadArtifactAction(artifactId: string) {
  const context = await requireAuthContext();
  try {
    const file = await getArtifactDownload(context, artifactId);
    return { ok: true as const, data: { fileName: file.fileName, mimeType: file.mimeType, contentBase64: Buffer.from(file.content).toString("base64") } };
  } catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}
