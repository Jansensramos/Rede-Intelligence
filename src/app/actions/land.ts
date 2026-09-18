"use server";

import { requireDomainWriteContext } from "./authorization";
const requireAuthContext = () => requireDomainWriteContext("VIABILITY_READ", "VIABILITY_WRITE");
import type { LandActionResult } from "@/application/land/contracts";
import { createLandStudyForProject, saveUrbanScenarioSnapshot, type CreateLandStudyForProjectInput } from "@/application/land/land-service";
import { urbanScenarioUpdateSchema, type UrbanScenarioUpdateInput } from "@/domain/land";

export async function saveUrbanScenarioAction(raw: UrbanScenarioUpdateInput): Promise<LandActionResult> {
  try {
    const context = await requireAuthContext();
    const parsed = urbanScenarioUpdateSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Parâmetros urbanísticos inválidos." };
    return { ok: true, data: await saveUrbanScenarioSnapshot(context, parsed.data) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível salvar o snapshot urbanístico." };
  }
}


export async function createLandStudyForProjectAction(input: CreateLandStudyForProjectInput): Promise<LandActionResult> {
  try {
    const context = await requireAuthContext();
    return { ok: true, data: await createLandStudyForProject(context, input) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível cadastrar o terreno." };
  }
}
