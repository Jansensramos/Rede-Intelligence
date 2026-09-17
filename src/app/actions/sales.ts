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
} from "@/application/sales/sales-service";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const message = (error: unknown) => error instanceof Error ? error.message : "Não foi possível concluir a operação comercial.";
async function run<T>(op: () => Promise<T>): Promise<Result<T>> {
  try { const data = await op(); revalidatePath("/comercial"); revalidatePath("/financeiro"); revalidatePath("/executivo"); return { ok: true, data }; }
  catch (error) { return { ok: false, error: message(error) }; }
}
const write = () => requireDomainWriteContext("COMMERCIAL_READ", "COMMERCIAL_WRITE");

export async function createCommercialCustomerAction(input: Parameters<typeof createCustomer>[1]) { const ctx = await write(); return run(() => createCustomer(ctx, input)); }
export async function createSalesLeadAction(input: Parameters<typeof createSalesLead>[1]) { const ctx = await write(); return run(() => createSalesLead(ctx, input)); }
export async function convertSalesLeadAction(input: Parameters<typeof convertSalesLead>[1]) { const ctx = await write(); return run(() => convertSalesLead(ctx, input)); }
export async function createSalesProposalAction(input: Parameters<typeof createSalesProposal>[1]) { const ctx = await write(); return run(() => createSalesProposal(ctx, input)); }
export async function createSalesReservationAction(input: Omit<Parameters<typeof createSalesReservation>[1], "responsibleId">) { const ctx = await write(); return run(() => createSalesReservation(ctx, { ...input, responsibleId: ctx.userId })); }
export async function confirmSalesReservationAction(id: string) { const ctx = await write(); return run(() => confirmSalesReservation(ctx, id)); }
export async function releaseSalesReservationAction(id: string, reason: string) { const ctx = await write(); return run(() => releaseSalesReservation(ctx, id, reason)); }
export async function createSaleAction(input: Parameters<typeof createSale>[1]) { const ctx = await write(); return run(() => createSale(ctx, input)); }
export async function approveSaleAction(input: Parameters<typeof approveSale>[1]) { const ctx = await requireDomainApprovalContext("COMMERCIAL_READ", "COMMERCIAL_APPROVE"); return run(() => approveSale(ctx, input)); }
