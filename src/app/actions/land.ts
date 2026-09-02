"use server";

import { requireDomainActionContext } from "./authorization";
const requireAuthContext = () => requireDomainActionContext("VIABILITY_READ");
import type { LandActionResult } from "@/application/land/contracts";
import { saveUrbanScenarioSnapshot } from "@/application/land/land-service";
import { urbanScenarioUpdateSchema, type UrbanScenarioUpdateInput } from "@/domain/land";

function canEdit(role: string) {
  return role === "OWNER" || role === "ADMIN" || role === "ANALYST";
}

export async function saveUrbanScenarioAction(raw: UrbanScenarioUpdateInput): Promise<LandActionResult> {
  const context = await requireAuthContext();
  if (!canEdit(context.role)) return { ok: false, error: "Seu perfil possui acesso somente para leitura." };
  const parsed = urbanScenarioUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Parâmetros urbanísticos inválidos." };
  try {
    return { ok: true, data: await saveUrbanScenarioSnapshot(context, parsed.data) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível salvar o snapshot urbanístico." };
  }
}
