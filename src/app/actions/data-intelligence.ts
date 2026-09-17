"use server";

import { revalidatePath } from "next/cache";
import { requireDomainActionContext } from "./authorization";
import {
  ensureAnalyticsContracts,
  ensureComparabilityPolicy,
  ensureMetricCatalog,
  refreshAnalyticsFacts,
  refreshDataIntelligence,
} from "@/application/data-intelligence/data-intelligence-service";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
async function run<T>(op: () => Promise<T>): Promise<Result<T>> {
  try { const data = await op(); revalidatePath("/inteligencia-dados"); return { ok: true, data }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Não foi possível concluir a operação de Inteligência de Dados." }; }
}

export async function initializeDataIntelligenceAction() {
  const context = await requireDomainActionContext("DATA_INTELLIGENCE_READ");
  return run(async () => {
    const contracts = await ensureAnalyticsContracts(context);
    const metrics = await ensureMetricCatalog(context);
    const policy = await ensureComparabilityPolicy(context);
    return { contracts: contracts.length, metrics: metrics.length, policyId: policy.id };
  });
}

export async function refreshAnalyticsFactsAction(projectId: string) {
  const context = await requireDomainActionContext("DATA_INTELLIGENCE_READ");
  return run(() => refreshAnalyticsFacts(context, projectId));
}

export async function refreshDataIntelligenceAction(projectId: string) {
  const context = await requireDomainActionContext("DATA_INTELLIGENCE_READ");
  return run(() => refreshDataIntelligence(context, projectId));
}
