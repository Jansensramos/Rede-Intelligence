"use server";

import { revalidatePath } from "next/cache";
import { requireDomainActionContext } from "./authorization";
const requireAuthContext = () => requireDomainActionContext("PROCUREMENT_READ");
import * as service from "@/application/procurement/procurement-service";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const message = (error: unknown) => error instanceof Error ? error.message : "Não foi possível concluir a operação de suprimentos.";
async function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try { const data = await operation(); revalidatePath("/"); return { ok: true, data }; }
  catch (error) { return { ok: false, error: message(error) }; }
}

export async function createProcurementNeedAction(input: Parameters<typeof service.createProcurementNeed>[1]) { const context = await requireAuthContext(); return run(() => service.createProcurementNeed(context, input)); }
export async function validateProcurementNeedAction(id: string) { const context = await requireAuthContext(); return run(() => service.validateProcurementNeed(context, id)); }
export async function createPurchaseRequisitionAction(input: Parameters<typeof service.createPurchaseRequisition>[1]) { const context = await requireAuthContext(); return run(() => service.createPurchaseRequisition(context, input)); }
export async function transitionPurchaseRequisitionAction(id: string, to: Parameters<typeof service.transitionPurchaseRequisition>[2], reason?: string) { const context = await requireAuthContext(); return run(() => service.transitionPurchaseRequisition(context, id, to, reason)); }
export async function createQuotationProcessAction(input: Parameters<typeof service.createQuotationProcess>[1]) { const context = await requireAuthContext(); return run(() => service.createQuotationProcess(context, input)); }
export async function submitSupplierProposalAction(input: Parameters<typeof service.submitSupplierProposal>[1]) { const context = await requireAuthContext(); return run(() => service.submitSupplierProposal(context, input)); }
export async function decideQuotationAction(input: Parameters<typeof service.decideQuotation>[1]) { const context = await requireAuthContext(); return run(() => service.decideQuotation(context, input)); }
export async function createPurchaseOrderAction(input: Parameters<typeof service.createPurchaseOrder>[1]) { const context = await requireAuthContext(); return run(() => service.createPurchaseOrder(context, input)); }
export async function approvePurchaseOrderAction(id: string) { const context = await requireAuthContext(); return run(() => service.approvePurchaseOrder(context, id)); }
export async function createOperationalContractAction(input: Parameters<typeof service.createOperationalContract>[1]) { const context = await requireAuthContext(); return run(() => service.createOperationalContract(context, input)); }
export async function transitionOperationalContractAction(id: string, to: Parameters<typeof service.transitionOperationalContract>[2], reason?: string) { const context = await requireAuthContext(); return run(() => service.transitionOperationalContract(context, id, to, reason)); }
export async function createContractAmendmentAction(input: Parameters<typeof service.createContractAmendment>[1]) { const context = await requireAuthContext(); return run(() => service.createContractAmendment(context, input)); }
export async function approveContractAmendmentAction(id: string) { const context = await requireAuthContext(); return run(() => service.approveContractAmendment(context, id)); }
export async function createMeasurementAction(input: Parameters<typeof service.createMeasurement>[1]) { const context = await requireAuthContext(); return run(() => service.createMeasurement(context, input)); }
export async function transitionMeasurementAction(id: string, to: Parameters<typeof service.transitionMeasurement>[2], reason?: string) { const context = await requireAuthContext(); return run(() => service.transitionMeasurement(context, id, to, reason)); }
export async function approveMeasurementAction(id: string) { const context = await requireAuthContext(); return run(() => service.approveMeasurementAndGenerateObligation(context, id)); }
export async function reverseMeasurementAction(id: string, reason: string) { const context = await requireAuthContext(); return run(() => service.reverseMeasurement(context, id, reason)); }
