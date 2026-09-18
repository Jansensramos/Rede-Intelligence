"use server";

import { revalidatePath } from "next/cache";
import { requireDomainActionContext } from "./authorization";
const requireAuthContext = () => requireDomainActionContext("ENGINEERING_READ");
import {
  appendSmartBudgetLineReview,
  approveSmartBudgetProposal,
  createEngineeringOpinion,
  createEngineeringOpinionVersion,
  createSmartBudgetProposal,
  decideEngineeringOpinion,
  decideEngineeringOpinionItem,
  rejectSmartBudgetProposal,
  submitEngineeringOpinion,
  submitSmartBudgetProposal,
  updateEngineeringOpinionDraft,
} from "@/application/engineering/engineering-service";

type Result = { ok: true } | { ok: false; error: string };
const message = (error: unknown) => error instanceof Error ? error.message : "A operação não pôde ser concluída.";
async function run(operation: () => Promise<unknown>): Promise<Result> {
  try {
    await operation();
    revalidatePath("/engenharia-obra");
    revalidatePath("/gestao-executiva");
    revalidatePath("/central-acoes");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function createEngineeringOpinionAction(input: Parameters<typeof createEngineeringOpinion>[1]) { const context = await requireAuthContext(); return run(() => createEngineeringOpinion(context, input)); }
export async function updateEngineeringOpinionDraftAction(id: string, input: Parameters<typeof updateEngineeringOpinionDraft>[2]) { const context = await requireAuthContext(); return run(() => updateEngineeringOpinionDraft(context, id, input)); }
export async function submitEngineeringOpinionAction(id: string) { const context = await requireAuthContext(); return run(() => submitEngineeringOpinion(context, id)); }
export async function decideEngineeringOpinionItemAction(id: string, decision: Parameters<typeof decideEngineeringOpinionItem>[2]) { const context = await requireAuthContext(); return run(() => decideEngineeringOpinionItem(context, id, decision)); }
export async function decideEngineeringOpinionAction(id: string, decision: Parameters<typeof decideEngineeringOpinion>[2]) { const context = await requireAuthContext(); return run(() => decideEngineeringOpinion(context, id, decision)); }
export async function createEngineeringOpinionVersionAction(id: string) { const context = await requireAuthContext(); return run(() => createEngineeringOpinionVersion(context, id)); }
export async function createSmartBudgetProposalAction(input: Parameters<typeof createSmartBudgetProposal>[1]) { const context = await requireAuthContext(); return run(() => createSmartBudgetProposal(context, input)); }
export async function submitSmartBudgetProposalAction(id: string) { const context = await requireAuthContext(); return run(() => submitSmartBudgetProposal(context, id)); }
export async function appendSmartBudgetLineReviewAction(input: Parameters<typeof appendSmartBudgetLineReview>[1]) { const context = await requireAuthContext(); return run(() => appendSmartBudgetLineReview(context, input)); }
export async function approveSmartBudgetProposalAction(id: string) { const context = await requireAuthContext(); return run(() => approveSmartBudgetProposal(context, id)); }
export async function rejectSmartBudgetProposalAction(id: string, reason: string) { const context = await requireAuthContext(); return run(() => rejectSmartBudgetProposal(context, id, reason)); }
