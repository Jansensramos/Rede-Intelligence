"use server";

/**
 * Fase 9S — Server Actions de encerramento do empreendimento. Fina camada sobre
 * `application/closure/*` (mesmo padrão de `app/actions/handover.ts`): RBAC e regras
 * de negócio ficam 100% no serviço, aqui só se resolve o `AuthContext` e se propaga o
 * resultado/erro para a UI. Decisão 2: VIEWER nunca tem `CLOSURE_READ`.
 */
import { revalidatePath } from "next/cache";
import { requireDomainActionContext } from "./authorization";
import { prepareProjectClosureResult, approveProjectClosureResult, reopenProjectClosureResult, getProjectClosureOverview } from "@/application/closure/closure-service";
import { createProjectClosureDistribution, approveProjectClosureDistribution, listProjectClosureDistributions } from "@/application/closure/distribution-service";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "A operação não pôde ser concluída.");

async function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await operation();
    revalidatePath("/executivo");
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function prepareProjectClosureResultAction(input: Parameters<typeof prepareProjectClosureResult>[1]) {
  const context = await requireDomainActionContext("CLOSURE_READ");
  return run(() => prepareProjectClosureResult(context, input));
}
export async function approveProjectClosureResultAction(input: Parameters<typeof approveProjectClosureResult>[1]) {
  const context = await requireDomainActionContext("CLOSURE_READ");
  return run(() => approveProjectClosureResult(context, input));
}
export async function reopenProjectClosureResultAction(input: Parameters<typeof reopenProjectClosureResult>[1]) {
  const context = await requireDomainActionContext("CLOSURE_READ");
  return run(() => reopenProjectClosureResult(context, input));
}
export async function getProjectClosureOverviewAction(projectId: string) {
  const context = await requireDomainActionContext("CLOSURE_READ");
  return run(() => getProjectClosureOverview(context, projectId));
}
export async function createProjectClosureDistributionAction(input: Parameters<typeof createProjectClosureDistribution>[1]) {
  const context = await requireDomainActionContext("CLOSURE_READ");
  return run(() => createProjectClosureDistribution(context, input));
}
export async function approveProjectClosureDistributionAction(input: Parameters<typeof approveProjectClosureDistribution>[1]) {
  const context = await requireDomainActionContext("CLOSURE_READ");
  return run(() => approveProjectClosureDistribution(context, input));
}
export async function listProjectClosureDistributionsAction(closureResultId: string) {
  const context = await requireDomainActionContext("CLOSURE_READ");
  return run(() => listProjectClosureDistributions(context, closureResultId));
}
