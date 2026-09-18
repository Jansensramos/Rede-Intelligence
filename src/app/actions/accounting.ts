"use server";

import { revalidatePath } from "next/cache";
import { requireDomainApprovalContext, requireDomainWriteContext } from "./authorization";
import { closeAccountingPeriod, createAccountingReconciliation, postAccountingEvent, reopenAccountingPeriod, reverseAccountingEntry } from "@/application/accounting/accounting-service";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
async function run<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try { const data = JSON.parse(JSON.stringify(await operation())) as T; revalidatePath("/contabilidade-controladoria"); return { ok: true, data }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Não foi possível concluir a operação contábil." }; }
}

export async function postAccountingEventAction(eventId: string, description?: string) {
  const context = await requireDomainWriteContext("ACCOUNTING_READ", "ACCOUNTING_WRITE");
  return run(() => postAccountingEvent(context, eventId, { description }));
}

export async function closeAccountingPeriodAction(periodId: string) {
  const context = await requireDomainApprovalContext("ACCOUNTING_READ", "ACCOUNTING_APPROVE");
  return run(() => closeAccountingPeriod(context, periodId, { financial: true, apAr: true, measurements: true, provisions: true, tax: true, intercompany: true, inventory: true, trialBalance: true }));
}

export async function reverseAccountingEntryAction(input: { entryId: string; periodId: string; reason: string; approvedById: string }) {
  const context = await requireDomainApprovalContext("ACCOUNTING_READ", "ACCOUNTING_APPROVE");
  return run(() => reverseAccountingEntry(context, input.entryId, { periodId: input.periodId, reason: input.reason, approvedById: input.approvedById }));
}

export async function reopenAccountingPeriodAction(input: { periodId: string; reason: string; authorizedById: string }) {
  const context = await requireDomainApprovalContext("ACCOUNTING_READ", "ACCOUNTING_APPROVE");
  return run(() => reopenAccountingPeriod(context, input.periodId, input.reason, input.authorizedById));
}

export async function createAccountingReconciliationAction(input: {
  periodId: string;
  projectId: string;
  type: string;
  sourceType: string;
  sourceId: string;
  sourceAmount: number;
  ledgerAmount: number;
  materiality: number;
  evidence: { note: string };
}) {
  const context = await requireDomainWriteContext("ACCOUNTING_READ", "ACCOUNTING_WRITE");
  return run(() => createAccountingReconciliation(context, input));
}
