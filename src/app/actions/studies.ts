"use server";

import { requireDomainWriteContext } from "./authorization";
const requireAuthContext = () => requireDomainWriteContext("VIABILITY_READ", "VIABILITY_WRITE");
import type { StudyActionResult } from "@/application/studies/contracts";
import { createStudy, createStudyForProject, createStudyVersion } from "@/application/studies/study-service";
import { projectAssumptionsSchema } from "@/domain/financial/schema";
import type { ProjectAssumptions } from "@/domain/financial/types";

function message(error: unknown) {
  if (error instanceof Error && error.message.includes("Unique constraint")) return "Já existe um empreendimento com este nome nesta organização.";
  if (error instanceof Error && error.message.includes("não encontrado")) return error.message;
  return error instanceof Error ? error.message : "Não foi possível persistir o estudo. Tente novamente.";
}

export async function createStudyForProjectAction(projectId: string, rawInput: ProjectAssumptions): Promise<StudyActionResult> {
  try {
    const context = await requireAuthContext();
    const parsed = projectAssumptionsSchema.safeParse(rawInput);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Premissas inválidas." };
    const data = await createStudyForProject(context, projectId, parsed.data as ProjectAssumptions);
    return { ok: true, data };
  } catch (error) { return { ok: false, error: message(error) }; }
}

export async function createStudyAction(rawInput: ProjectAssumptions): Promise<StudyActionResult> {
  try {
    const context = await requireAuthContext();
    const parsed = projectAssumptionsSchema.safeParse(rawInput);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Premissas inválidas." };
    const data = await createStudy(context, parsed.data as ProjectAssumptions);
    return { ok: true, data };
  } catch (error) { return { ok: false, error: message(error) }; }
}

export async function createStudyVersionAction(projectId: string, studyId: string, rawInput: ProjectAssumptions): Promise<StudyActionResult> {
  try {
    const context = await requireAuthContext();
    const parsed = projectAssumptionsSchema.safeParse(rawInput);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Premissas inválidas." };
    const data = await createStudyVersion(context, projectId, studyId, parsed.data as ProjectAssumptions);
    return { ok: true, data };
  } catch (error) { return { ok: false, error: message(error) }; }
}
