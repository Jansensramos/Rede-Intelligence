"use server";

import { revalidatePath } from "next/cache";
import { requireDomainWriteContext } from "./authorization";
import {
  ensureAnalyticsContracts,
  ensureComparabilityPolicy,
  ensureMetricCatalog,
  refreshAnalyticsFacts,
  refreshDataIntelligence,
} from "@/application/data-intelligence/data-intelligence-service";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
async function run<T>(op: () => Promise<T>): Promise<Result<T>> {
  try { const data = JSON.parse(JSON.stringify(await op())) as T; revalidatePath("/inteligencia-dados"); return { ok: true, data }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Não foi possível concluir a operação de Inteligência de Dados." }; }
}
const write = () => requireDomainWriteContext("DATA_INTELLIGENCE_READ", "DATA_INTELLIGENCE_WRITE");

export async function initializeDataIntelligenceAction() {
  const context = await write();
  return run(async () => {
    const contracts = await ensureAnalyticsContracts(context);
    const metrics = await ensureMetricCatalog(context);
    const policy = await ensureComparabilityPolicy(context);
    return { contracts: contracts.length, metrics: metrics.length, policyId: policy.id };
  });
}

export async function refreshAnalyticsFactsAction(projectId: string) { const context = await write(); return run(() => refreshAnalyticsFacts(context, projectId)); }
export async function refreshDataIntelligenceAction(projectId: string) { const context = await write(); return run(() => refreshDataIntelligence(context, projectId)); }
