"use server";

import { revalidatePath } from "next/cache";
import { requireDomainApprovalContext, requireDomainWriteContext } from "./authorization";
import { closeAccountingPeriod, postAccountingEvent } from "@/application/accounting/accounting-service";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
async function run<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try { const data = await operation(); revalidatePath("/contabilidade-controladoria"); return { ok: true, data }; }
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
