"use server";

import { revalidatePath } from "next/cache";
import { requireDomainActionContext } from "./authorization";
import {
  createDueDiligenceCase,
  recordLegalDecision,
  reverseLegalFinancialEvent,
  sendLegalObligationToFinance,
} from "@/application/legal/legal-service";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const message = (error: unknown) => error instanceof Error ? error.message : "Não foi possível concluir a operação jurídica.";

async function run<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await operation();
    revalidatePath("/juridico");
    revalidatePath("/executivo");
    revalidatePath("/acoes");
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function createDueDiligenceCaseAction(input: Parameters<typeof createDueDiligenceCase>[1]) {
  const context = await requireDomainActionContext("LEGAL_READ");
  return run(() => createDueDiligenceCase(context, input));
}

export async function recordLegalDecisionAction(diligenceCaseId: string, input: Parameters<typeof recordLegalDecision>[2]) {
  const context = await requireDomainActionContext("LEGAL_READ");
  return run(() => recordLegalDecision(context, diligenceCaseId, input));
}

export async function sendLegalObligationToFinanceAction(legalObligationId: string) {
  const context = await requireDomainActionContext("LEGAL_READ");
  return run(() => sendLegalObligationToFinance(context, legalObligationId));
}

export async function reverseLegalFinancialEventAction(legalObligationId: string, reason: string) {
  const context = await requireDomainActionContext("LEGAL_READ");
  return run(() => reverseLegalFinancialEvent(context, legalObligationId, reason));
}
