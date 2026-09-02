"use server";

import { requireDomainActionContext } from "./authorization";
const requireAuthContext = () => requireDomainActionContext("VIABILITY_READ");
import type { StudyActionResult } from "@/application/studies/contracts";
import { createStudy, createStudyVersion } from "@/application/studies/study-service";
import { projectAssumptionsSchema } from "@/domain/financial/schema";
import type { ProjectAssumptions } from "@/domain/financial/types";

function canEdit(role: string) {
  return role === "OWNER" || role === "ADMIN" || role === "ANALYST";
}

function message(error: unknown) {
  if (error instanceof Error && error.message.includes("Unique constraint")) {
    return "Já existe um empreendimento com este nome nesta organização.";
  }
  if (error instanceof Error && error.message.includes("não encontrado")) return error.message;
  return "Não foi possível persistir o estudo. Tente novamente.";
}

export async function createStudyAction(rawInput: ProjectAssumptions): Promise<StudyActionResult> {
  const context = await requireAuthContext();
  if (!canEdit(context.role)) return { ok: false, error: "Seu perfil possui acesso somente para leitura." };
  const parsed = projectAssumptionsSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Premissas inválidas." };
  try {
    const data = await createStudy(context, parsed.data as ProjectAssumptions);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function createStudyVersionAction(
  projectId: string,
  studyId: string,
  rawInput: ProjectAssumptions,
): Promise<StudyActionResult> {
  const context = await requireAuthContext();
  if (!canEdit(context.role)) return { ok: false, error: "Seu perfil possui acesso somente para leitura." };
  const parsed = projectAssumptionsSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Premissas inválidas." };
  try {
    const data = await createStudyVersion(context, projectId, studyId, parsed.data as ProjectAssumptions);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}
