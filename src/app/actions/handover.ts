"use server";

/**
 * Fase 9R — Server Actions de Repasse, Chaves e Assistência técnica. Fina camada sobre
 * `application/handover/*` e as extensões de `application/sales/sales-service.ts`
 * (mesmo padrão de `app/actions/capital.ts`): RBAC e regras de negócio ficam 100% no
 * serviço, aqui só se resolve o `AuthContext` e se propaga o resultado/erro para a UI.
 */
import { revalidatePath } from "next/cache";
import { requireDomainActionContext } from "./authorization";
import {
  createBankFinancingDisbursement,
  requestBankFinancingDisbursement,
  recordBankFinancingDisbursementReceived,
  reconcileBankFinancingDisbursement,
  cancelBankFinancingDisbursement,
  listBankFinancingDisbursementsForSale,
} from "@/application/handover/repasse-service";
import {
  createCondominiumSetup,
  transitionCondominiumSetup,
  getCondominiumSetupForProject,
} from "@/application/handover/condominium-service";
import {
  assignPostSaleSupplier,
  setPostSaleCost,
  markPostSaleRecurrence,
  addPostSaleEvidence,
  evaluatePostSaleSlaBreaches,
  markUnitDelivered,
  getUnitDeliveryReadiness,
} from "@/application/sales/sales-service";


type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "A operação não pôde ser concluída.");

async function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await operation();
    revalidatePath("/comercial");
    revalidatePath("/executivo");
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Repasse bancário
// ---------------------------------------------------------------------------

export async function createBankFinancingDisbursementAction(input: Parameters<typeof createBankFinancingDisbursement>[1]) {
  const context = await requireDomainActionContext("COMMERCIAL_READ");
  return run(() => createBankFinancingDisbursement(context, input));
}
export async function requestBankFinancingDisbursementAction(input: Parameters<typeof requestBankFinancingDisbursement>[1]) {
  const context = await requireDomainActionContext("COMMERCIAL_READ");
  return run(() => requestBankFinancingDisbursement(context, input));
}
export async function recordBankFinancingDisbursementReceivedAction(input: Parameters<typeof recordBankFinancingDisbursementReceived>[1]) {
  const context = await requireDomainActionContext("COMMERCIAL_READ");
  return run(() => recordBankFinancingDisbursementReceived(context, input));
}
export async function reconcileBankFinancingDisbursementAction(input: Parameters<typeof reconcileBankFinancingDisbursement>[1]) {
  const context = await requireDomainActionContext("COMMERCIAL_READ");
  return run(() => reconcileBankFinancingDisbursement(context, input));
}
export async function cancelBankFinancingDisbursementAction(input: Parameters<typeof cancelBankFinancingDisbursement>[1]) {
  const context = await requireDomainActionContext("COMMERCIAL_READ");
  return run(() => cancelBankFinancingDisbursement(context, input));
}
export async function listBankFinancingDisbursementsForSaleAction(saleId: string) {
  const context = await requireDomainActionContext("COMMERCIAL_READ");
  return run(() => listBankFinancingDisbursementsForSale(context, saleId));
}

// ---------------------------------------------------------------------------
// Chaves — condomínio e gate de entrega
// ---------------------------------------------------------------------------

export async function createCondominiumSetupAction(input: Parameters<typeof createCondominiumSetup>[1]) {
  const context = await requireDomainActionContext("COMMERCIAL_READ");
  return run(() => createCondominiumSetup(context, input));
}
export async function transitionCondominiumSetupAction(input: Parameters<typeof transitionCondominiumSetup>[1]) {
  const context = await requireDomainActionContext("COMMERCIAL_READ");
  return run(() => transitionCondominiumSetup(context, input));
}
export async function getCondominiumSetupForProjectAction(projectId: string) {
  const context = await requireDomainActionContext("COMMERCIAL_READ");
  return run(() => getCondominiumSetupForProject(context, projectId));
}
export async function markUnitDeliveredAction(salesUnitId: string) {
  const context = await requireDomainActionContext("COMMERCIAL_READ");
  return run(() => markUnitDelivered(context, salesUnitId));
}
export async function getUnitDeliveryReadinessAction(salesUnitId: string) {
  const context = await requireDomainActionContext("COMMERCIAL_READ");
  return run(() => getUnitDeliveryReadiness(context, salesUnitId));
}

// ---------------------------------------------------------------------------
// Assistência técnica
// ---------------------------------------------------------------------------

export async function assignPostSaleSupplierAction(input: Parameters<typeof assignPostSaleSupplier>[1]) {
  const context = await requireDomainActionContext("COMMERCIAL_READ");
  return run(() => assignPostSaleSupplier(context, input));
}
export async function setPostSaleCostAction(input: Parameters<typeof setPostSaleCost>[1]) {
  const context = await requireDomainActionContext("COMMERCIAL_READ");
  return run(() => setPostSaleCost(context, input));
}
export async function markPostSaleRecurrenceAction(input: Parameters<typeof markPostSaleRecurrence>[1]) {
  const context = await requireDomainActionContext("COMMERCIAL_READ");
  return run(() => markPostSaleRecurrence(context, input));
}
export async function addPostSaleEvidenceAction(input: Parameters<typeof addPostSaleEvidence>[1]) {
  const context = await requireDomainActionContext("COMMERCIAL_READ");
  return run(() => addPostSaleEvidence(context, input));
}
export async function evaluatePostSaleSlaBreachesAction() {
  const context = await requireDomainActionContext("COMMERCIAL_READ");
  return run(() => evaluatePostSaleSlaBreaches(context));
}
