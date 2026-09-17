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
  createSalesReservation,
  releaseSalesReservation,
  renegotiateSalesPaymentPlan,
  rescindSale,
} from "@/application/sales/sales-service";

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
