"use server";

import { revalidatePath } from "next/cache";
import { requireDomainActionContext } from "./authorization";
import { prisma } from "@/infrastructure/database/prisma";
const requireAuthContext = () => requireDomainActionContext("OPERATIONS_READ");
import {
  approveOperationalBaseline,
  approveSchedule,
  createBudgetRevision,
  createOfficialBudgetFromBaseline,
  createScheduleFromBudget,
  justifyBudgetVariance,
  prepareOperationalBaseline,
  requestBaselineApproval,
} from "@/application/operations/operations-service";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "A operação não pôde ser concluída.";

async function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await operation();
    revalidatePath("/");
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function prepareOperationalBaselineAction(input: Parameters<typeof prepareOperationalBaseline>[1]) {
  const context = await requireAuthContext();
  return run(() => prepareOperationalBaseline(context, input));
}

export async function prepareLatestOperationalBaselineAction(projectId: string) {
  const context = await requireAuthContext();
  return run(async () => {
    const latestVersion = await prisma.studyVersion.findFirst({
      where: { study: { projectId, project: { organizationId: context.organizationId } } },
      orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    if (!latestVersion) throw new Error("Este empreendimento ainda não possui uma versão de estudo disponível para congelar como Base Aprovada.");
    return prepareOperationalBaseline(context, { projectId, studyVersionId: latestVersion.id, confirmed: true });
  });
}

export async function requestBaselineApprovalAction(baselineId: string) {
  const context = await requireAuthContext();
  return run(() => requestBaselineApproval(context, baselineId));
}

export async function approveOperationalBaselineAction(baselineId: string) {
  const context = await requireAuthContext();
  return run(() => approveOperationalBaseline(context, baselineId));
}

export async function createOfficialBudgetAction(baselineId: string) {
  const context = await requireAuthContext();
  return run(() => createOfficialBudgetFromBaseline(context, baselineId));
}

export async function createBudgetRevisionAction(budgetId: string, reason: string) {
  const context = await requireAuthContext();
  return run(() => createBudgetRevision(context, budgetId, reason));
}

export async function justifyBudgetVarianceAction(input: Parameters<typeof justifyBudgetVariance>[1]) {
  const context = await requireAuthContext();
  return run(() => justifyBudgetVariance(context, input));
}

export async function createOperationalScheduleAction(input: Parameters<typeof createScheduleFromBudget>[1]) {
  const context = await requireAuthContext();
  return run(() => createScheduleFromBudget(context, input));
}

export async function approveOperationalScheduleAction(scheduleId: string) {
  const context = await requireAuthContext();
  return run(() => approveSchedule(context, scheduleId));
}
