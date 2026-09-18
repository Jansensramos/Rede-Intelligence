"use server";

import { revalidatePath } from "next/cache";
import { requireDomainApprovalContext, requireDomainWriteContext } from "./authorization";
import {
  acknowledgeLegalAlert,
  createDueDiligenceCase,
  createLegalAuthorityProcess,
  createLegalDocumentRequest,
  createLegalFinding,
  createLegalLicense,
  createLegalObligation,
  recordLegalDecision,
  resolveLegalAlert,
  reverseLegalFinancialEvent,
  sendLegalObligationToFinance,
  updateLegalAuthorityProcessStatus,
  updateLegalDocumentRequestStatus,
  updateLegalFindingStatus,
  updateLegalLicenseStatus,
  updateLegalObligationStatus,
} from "@/application/legal/legal-service";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const message = (error: unknown) => error instanceof Error ? error.message : "Não foi possível concluir a operação jurídica.";

async function run<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = JSON.parse(JSON.stringify(await operation())) as T;
    revalidatePath("/juridico");
    revalidatePath("/executivo");
    revalidatePath("/acoes");
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function createDueDiligenceCaseAction(input: Parameters<typeof createDueDiligenceCase>[1]) {
  const context = await requireDomainWriteContext("LEGAL_READ", "LEGAL_WRITE");
  return run(() => createDueDiligenceCase(context, input));
}

export async function recordLegalDecisionAction(diligenceCaseId: string, input: Parameters<typeof recordLegalDecision>[2]) {
  const context = await requireDomainApprovalContext("LEGAL_READ", "LEGAL_APPROVE");
  return run(() => recordLegalDecision(context, diligenceCaseId, input));
}

export async function sendLegalObligationToFinanceAction(legalObligationId: string) {
  const context = await requireDomainApprovalContext("LEGAL_READ", "LEGAL_APPROVE");
  return run(() => sendLegalObligationToFinance(context, legalObligationId));
}

export async function reverseLegalFinancialEventAction(legalObligationId: string, reason: string) {
  const context = await requireDomainApprovalContext("LEGAL_READ", "LEGAL_APPROVE");
  return run(() => reverseLegalFinancialEvent(context, legalObligationId, reason));
}

export async function createLegalDocumentRequestAction(diligenceCaseId: string, input: Parameters<typeof createLegalDocumentRequest>[2]) {
  const context = await requireDomainWriteContext("LEGAL_READ", "LEGAL_WRITE");
  return run(() => createLegalDocumentRequest(context, diligenceCaseId, input));
}

export async function updateLegalDocumentRequestStatusAction(requestId: string, status: Parameters<typeof updateLegalDocumentRequestStatus>[2]) {
  const context = await requireDomainWriteContext("LEGAL_READ", "LEGAL_WRITE");
  return run(() => updateLegalDocumentRequestStatus(context, requestId, status));
}

export async function createLegalFindingAction(diligenceCaseId: string, input: Parameters<typeof createLegalFinding>[2]) {
  const context = await requireDomainWriteContext("LEGAL_READ", "LEGAL_WRITE");
  return run(() => createLegalFinding(context, diligenceCaseId, input));
}

export async function updateLegalFindingStatusAction(findingId: string, status: Parameters<typeof updateLegalFindingStatus>[2]) {
  const context = await requireDomainWriteContext("LEGAL_READ", "LEGAL_WRITE");
  return run(() => updateLegalFindingStatus(context, findingId, status));
}

export async function createLegalLicenseAction(input: Parameters<typeof createLegalLicense>[1]) {
  const context = await requireDomainWriteContext("LEGAL_READ", "LEGAL_WRITE");
  return run(() => createLegalLicense(context, input));
}

export async function updateLegalLicenseStatusAction(licenseId: string, status: Parameters<typeof updateLegalLicenseStatus>[2]) {
  const context = await requireDomainWriteContext("LEGAL_READ", "LEGAL_WRITE");
  return run(() => updateLegalLicenseStatus(context, licenseId, status));
}

export async function createLegalAuthorityProcessAction(input: Parameters<typeof createLegalAuthorityProcess>[1]) {
  const context = await requireDomainWriteContext("LEGAL_READ", "LEGAL_WRITE");
  return run(() => createLegalAuthorityProcess(context, input));
}

export async function updateLegalAuthorityProcessStatusAction(processId: string, status: Parameters<typeof updateLegalAuthorityProcessStatus>[2]) {
  const context = await requireDomainWriteContext("LEGAL_READ", "LEGAL_WRITE");
  return run(() => updateLegalAuthorityProcessStatus(context, processId, status));
}

export async function createLegalObligationAction(input: Parameters<typeof createLegalObligation>[1]) {
  const context = await requireDomainWriteContext("LEGAL_READ", "LEGAL_WRITE");
  return run(() => createLegalObligation(context, input));
}

export async function updateLegalObligationStatusAction(obligationId: string, status: Parameters<typeof updateLegalObligationStatus>[2]) {
  const context = ["WAIVED", "CANCELLED"].includes(status)
    ? await requireDomainApprovalContext("LEGAL_READ", "LEGAL_APPROVE")
    : await requireDomainWriteContext("LEGAL_READ", "LEGAL_WRITE");
  return run(() => updateLegalObligationStatus(context, obligationId, status));
}

export async function acknowledgeLegalAlertAction(alertId: string) {
  const context = await requireDomainWriteContext("LEGAL_READ", "LEGAL_WRITE");
  return run(() => acknowledgeLegalAlert(context, alertId));
}

export async function resolveLegalAlertAction(alertId: string) {
  const context = await requireDomainWriteContext("LEGAL_READ", "LEGAL_WRITE");
  return run(() => resolveLegalAlert(context, alertId));
}
