"use server";

import { revalidatePath } from "next/cache";
import { requireDomainApprovalContext, requireDomainWriteContext } from "./authorization";
import { createCustomer } from "@/application/financial-ops/financial-service";
import {
  approveSale,
  confirmSalesReservation,
  convertSalesLead,
  createSale,
  createSalesLead,
  createSalesProposal,
  createSalesCommission,
  approveSalesCommission,
  createSalesReservation,
  releaseSalesReservation,
  renegotiateSalesPaymentPlan,
  rescindSale,
  scheduleInspection,
  recordInspectionOutcome,
  markUnitDelivered,
  createPostSaleRequest,
  addPostSaleUpdate,
  transitionPostSaleRequest,
} from "@/application/sales/sales-service";
import { ensureDefaultContractTemplate, generateContractDocument } from "@/application/sales/contract-service";
import { completeMockSignatureRequest, prepareSignatureRequest, sendSignatureRequest } from "@/application/sales/signature-service";

type Result = { ok: true } | { ok: false; error: string };
const message = (error: unknown) => error instanceof Error ? error.message : "Não foi possível concluir a operação comercial.";
async function run(op: () => Promise<unknown>): Promise<Result> {
  try {
    await op();
    revalidatePath("/comercial");
    revalidatePath("/financeiro");
    revalidatePath("/executivo");
    return { ok: true };
  }
  catch (error) { return { ok: false, error: message(error) }; }
}
const write = () => requireDomainWriteContext("COMMERCIAL_READ", "COMMERCIAL_WRITE");
const approve = () => requireDomainApprovalContext("COMMERCIAL_READ", "COMMERCIAL_APPROVE");

export async function createCommercialCustomerAction(input: Parameters<typeof createCustomer>[1]) { const ctx = await write(); return run(() => createCustomer(ctx, input)); }
export async function createSalesLeadAction(input: Parameters<typeof createSalesLead>[1]) { const ctx = await write(); return run(() => createSalesLead(ctx, input)); }
export async function convertSalesLeadAction(input: Parameters<typeof convertSalesLead>[1]) { const ctx = await write(); return run(() => convertSalesLead(ctx, input)); }
export async function createSalesProposalAction(input: Parameters<typeof createSalesProposal>[1]) { const ctx = await write(); return run(() => createSalesProposal(ctx, input)); }
export async function createSalesReservationAction(input: Omit<Parameters<typeof createSalesReservation>[1], "responsibleId">) { const ctx = await write(); return run(() => createSalesReservation(ctx, { ...input, responsibleId: ctx.userId })); }
export async function confirmSalesReservationAction(id: string) { const ctx = await write(); return run(() => confirmSalesReservation(ctx, id)); }
export async function releaseSalesReservationAction(id: string, reason: string) { const ctx = await write(); return run(() => releaseSalesReservation(ctx, id, reason)); }
export async function createSaleAction(input: Parameters<typeof createSale>[1]) { const ctx = await write(); return run(() => createSale(ctx, input)); }
export async function approveSaleAction(input: Parameters<typeof approveSale>[1]) { const ctx = await approve(); return run(() => approveSale(ctx, input)); }
export async function renegotiateSalesPaymentPlanAction(input: Parameters<typeof renegotiateSalesPaymentPlan>[1]) { const ctx = await approve(); return run(() => renegotiateSalesPaymentPlan(ctx, input)); }
export async function rescindSaleAction(input: Parameters<typeof rescindSale>[1]) { const ctx = await approve(); return run(() => rescindSale(ctx, input)); }

export async function ensureDefaultContractTemplateAction(projectId: string) {
  const ctx = await approve();
  return run(() => ensureDefaultContractTemplate(ctx, projectId));
}
export async function generateContractDocumentAction(contractId: string, templateVersionId: string) {
  const ctx = await write();
  return run(() => generateContractDocument(ctx, { contractId, templateVersionId }));
}
export async function startLocalSignatureAction(input: {
  contractId: string;
  documentId: string;
  parties: { customerId?: string; displayName: string; email?: string; role: string }[];
}) {
  const ctx = await write();
  return run(async () => {
    if (process.env.NODE_ENV === "production") throw new Error("Assinatura simulada é permitida apenas no ambiente local.");
    const request = await prepareSignatureRequest(ctx, { ...input, provider: "MOCK" });
    await sendSignatureRequest(ctx, request.id);
  });
}
export async function completeLocalSignatureAction(requestId: string) {
  const ctx = await write();
  return run(() => completeMockSignatureRequest(ctx, requestId));
}

export async function createSalesCommissionAction(input: Parameters<typeof createSalesCommission>[1]) {
  const ctx = await write();
  return run(() => createSalesCommission(ctx, input));
}
export async function approveSalesCommissionAction(commissionId: string) {
  const ctx = await approve();
  return run(() => approveSalesCommission(ctx, commissionId));
}

export async function scheduleInspectionAction(input: Omit<Parameters<typeof scheduleInspection>[1], "responsibleId">) {
  const ctx = await write();
  return run(() => scheduleInspection(ctx, { ...input, responsibleId: ctx.userId }));
}
export async function recordInspectionOutcomeAction(input: Parameters<typeof recordInspectionOutcome>[1]) {
  const ctx = await write();
  return run(() => recordInspectionOutcome(ctx, input));
}
export async function markUnitDeliveredAction(salesUnitId: string) {
  const ctx = await approve();
  return run(() => markUnitDelivered(ctx, salesUnitId));
}
export async function createPostSaleRequestAction(input: Parameters<typeof createPostSaleRequest>[1]) {
  const ctx = await write();
  return run(() => createPostSaleRequest(ctx, input));
}
export async function addPostSaleUpdateAction(input: Parameters<typeof addPostSaleUpdate>[1]) {
  const ctx = await write();
  return run(() => addPostSaleUpdate(ctx, input));
}
export async function transitionPostSaleRequestAction(input: Parameters<typeof transitionPostSaleRequest>[1]) {
  const ctx = await write();
  return run(() => transitionPostSaleRequest(ctx, input));
}
