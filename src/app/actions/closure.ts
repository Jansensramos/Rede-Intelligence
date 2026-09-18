"use server";

import { revalidatePath } from "next/cache";
import { requireDomainActionContext, requireDomainApprovalContext, requireDomainWriteContext } from "./authorization";
import { prepareProjectClosureResult, approveProjectClosureResult, reopenProjectClosureResult, getProjectClosureOverview } from "@/application/closure/closure-service";
import { createProjectClosureDistribution, approveProjectClosureDistribution, listProjectClosureDistributions } from "@/application/closure/distribution-service";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "A operação não pôde ser concluída.");

async function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = JSON.parse(JSON.stringify(await operation())) as T;
    revalidatePath("/executivo");
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function prepareProjectClosureResultAction(input: Parameters<typeof prepareProjectClosureResult>[1]) {
  const context = await requireDomainWriteContext("CLOSURE_READ", "CLOSURE_WRITE");
  return run(() => prepareProjectClosureResult(context, input));
}
export async function approveProjectClosureResultAction(input: Parameters<typeof approveProjectClosureResult>[1]) {
  const context = await requireDomainApprovalContext("CLOSURE_READ", "CLOSURE_APPROVE");
  return run(() => approveProjectClosureResult(context, input));
}
export async function reopenProjectClosureResultAction(input: Parameters<typeof reopenProjectClosureResult>[1]) {
  const context = await requireDomainWriteContext("CLOSURE_READ", "CLOSURE_WRITE");
  return run(() => reopenProjectClosureResult(context, input));
}
export async function getProjectClosureOverviewAction(projectId: string) {
  const context = await requireDomainActionContext("CLOSURE_READ");
  return run(() => getProjectClosureOverview(context, projectId));
}
export async function createProjectClosureDistributionAction(input: Parameters<typeof createProjectClosureDistribution>[1]) {
  const context = await requireDomainWriteContext("CLOSURE_READ", "CLOSURE_WRITE");
  return run(() => createProjectClosureDistribution(context, input));
}
export async function approveProjectClosureDistributionAction(input: Parameters<typeof approveProjectClosureDistribution>[1]) {
  const context = await requireDomainApprovalContext("CLOSURE_READ", "CLOSURE_APPROVE");
  return run(() => approveProjectClosureDistribution(context, input));
}
export async function listProjectClosureDistributionsAction(closureResultId: string) {
  const context = await requireDomainActionContext("CLOSURE_READ");
  return run(async () => {
    const rows = await listProjectClosureDistributions(context, closureResultId);
    return rows.map((row) => ({ id: row.id, beneficiaryName: row.beneficiaryName, status: row.status, amount: Number(row.amount), nature: row.nature }));
  });
}
