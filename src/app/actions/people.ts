"use server";

import { revalidatePath } from "next/cache";
import { requireDomainApprovalContext, requireDomainWriteContext } from "./authorization";
import {
  addCausalHypothesis,
  createCorrectiveAction,
  createDepartment,
  createPerformanceVariance,
  createPersonProfile,
  createPosition,
  startRootCauseInvestigation,
  transitionCorrectiveAction,
  transitionPerformanceVariance,
} from "@/application/people-performance/people-performance-service";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Não foi possível concluir a operação de Pessoas.";
async function run<T>(op: () => Promise<T>): Promise<Result<T>> {
  try { const data = JSON.parse(JSON.stringify(await op())) as T; revalidatePath("/pessoas"); revalidatePath("/acoes"); return { ok: true, data }; }
  catch (error) { return { ok: false, error: errorMessage(error) }; }
}
const write = () => requireDomainWriteContext("PEOPLE_READ", "PEOPLE_WRITE");

export async function createDepartmentAction(input: Parameters<typeof createDepartment>[1]) { const ctx = await write(); return run(() => createDepartment(ctx, input)); }
export async function createPositionAction(input: Parameters<typeof createPosition>[1]) { const ctx = await write(); return run(() => createPosition(ctx, input)); }
export async function createPersonProfileAction(input: Parameters<typeof createPersonProfile>[1]) { const ctx = await write(); return run(() => createPersonProfile(ctx, input)); }
export async function createPerformanceVarianceAction(input: Omit<Parameters<typeof createPerformanceVariance>[1], "ownerId">) { const ctx = await write(); return run(() => createPerformanceVariance(ctx, { ...input, ownerId: ctx.userId })); }
export async function startRootCauseInvestigationAction(varianceCaseId: string, problemStatement: string, scope?: string) { const ctx = await write(); return run(() => startRootCauseInvestigation(ctx, { varianceCaseId, problemStatement, scope: scope || null, responsibleId: ctx.userId })); }
export async function addCausalHypothesisAction(investigationId: string, category: Parameters<typeof addCausalHypothesis>[1]["category"], description: string) { const ctx = await write(); return run(() => addCausalHypothesis(ctx, { investigationId, category, description })); }
export async function createCorrectiveActionAction(investigationId: string, title: string, description: string, priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL", dueDate?: Date | null) { const ctx = await write(); return run(() => createCorrectiveAction(ctx, { investigationId, title, description, priority, responsibleId: ctx.userId, dueDate: dueDate ?? null })); }
export async function transitionCorrectiveActionAction(actionId: string, to: Parameters<typeof transitionCorrectiveAction>[2]) { const ctx = to === "ACTIVE" ? await requireDomainApprovalContext("PEOPLE_READ", "PEOPLE_APPROVE") : await write(); return run(() => transitionCorrectiveAction(ctx, actionId, to)); }
export async function transitionPerformanceVarianceAction(varianceCaseId: string, to: Parameters<typeof transitionPerformanceVariance>[2]) { const ctx = await write(); return run(() => transitionPerformanceVariance(ctx, varianceCaseId, to)); }
