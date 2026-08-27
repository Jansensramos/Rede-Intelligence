"use server";

/** Fase 9N.1 — Server Actions de Capital & Funding. Fina camada sobre `application/capital/capital-service.ts`
 * (mesmo padrão de `app/actions/financial.ts`): RBAC e regras de negócio ficam 100% no serviço, aqui só se
 * resolve o `AuthContext` e se propaga o resultado/erro para a UI. Nenhuma regra nova nasce aqui. */
import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/application/auth/session";
import {
  approveFundingDisbursementRelease,
  approveFundingProposal,
  confirmFundingDisbursement,
  createFundingProposal,
  evaluateFundingCovenant,
  moveFundingProposalToReview,
  rejectFundingProposal,
  requestFundingDisbursement,
  rescheduleFundingDebtService,
  reviseFundingProposal,
  scheduleFundingDisbursement,
  submitFundingProposal,
  updateFundingConditionStatus,
} from "@/application/capital/capital-service";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "A operação de Capital & Funding não pôde ser concluída.");

async function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await operation();
    revalidatePath("/capital-funding");
    revalidatePath("/executivo");
    revalidatePath("/acoes");
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function createFundingProposalAction(input: Parameters<typeof createFundingProposal>[1]) {
  const context = await requireAuthContext();
  return run(() => createFundingProposal(context, input));
}

export async function reviseFundingProposalAction(proposalId: string, input: Parameters<typeof reviseFundingProposal>[2]) {
  const context = await requireAuthContext();
  return run(() => reviseFundingProposal(context, proposalId, input));
}

export async function submitFundingProposalAction(proposalId: string) {
  const context = await requireAuthContext();
  return run(() => submitFundingProposal(context, proposalId));
}

export async function moveFundingProposalToReviewAction(proposalId: string) {
  const context = await requireAuthContext();
  return run(() => moveFundingProposalToReview(context, proposalId));
}

export async function rejectFundingProposalAction(proposalId: string, reason: string) {
  const context = await requireAuthContext();
  return run(() => rejectFundingProposal(context, proposalId, reason));
}

export async function approveFundingProposalAction(proposalId: string) {
  const context = await requireAuthContext();
  return run(() => approveFundingProposal(context, proposalId));
}

export async function rescheduleFundingDebtServiceAction(proposalId: string) {
  const context = await requireAuthContext();
  return run(() => rescheduleFundingDebtService(context, proposalId));
}

export async function scheduleFundingDisbursementAction(input: Parameters<typeof scheduleFundingDisbursement>[1]) {
  const context = await requireAuthContext();
  return run(() => scheduleFundingDisbursement(context, input));
}

export async function requestFundingDisbursementAction(disbursementId: string) {
  const context = await requireAuthContext();
  return run(() => requestFundingDisbursement(context, disbursementId));
}

export async function approveFundingDisbursementReleaseAction(disbursementId: string) {
  const context = await requireAuthContext();
  return run(() => approveFundingDisbursementRelease(context, disbursementId));
}

export async function confirmFundingDisbursementAction(input: Parameters<typeof confirmFundingDisbursement>[1]) {
  const context = await requireAuthContext();
  return run(() => confirmFundingDisbursement(context, input));
}

export async function evaluateFundingCovenantAction(input: Parameters<typeof evaluateFundingCovenant>[1]) {
  const context = await requireAuthContext();
  return run(() => evaluateFundingCovenant(context, input));
}

export async function updateFundingConditionStatusAction(input: Parameters<typeof updateFundingConditionStatus>[1]) {
  const context = await requireAuthContext();
  return run(() => updateFundingConditionStatus(context, input));
}
