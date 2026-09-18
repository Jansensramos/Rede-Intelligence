"use server";

import { revalidatePath } from "next/cache";
import { requireDomainActionContext } from "./authorization";
import {
  createAccountingReconciliation,
  reopenAccountingPeriod,
  reverseAccountingEntry,
} from "@/application/accounting/accounting-service";
import {
  assertProtectedApprovalCapability,
  assertProtectedWriteCapability,
} from "@/domain/auth/write-capabilities";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = JSON.parse(JSON.stringify(await operation())) as T;
    revalidatePath("/contabilidade-controladoria");
    revalidatePath("/executivo");
    revalidatePath("/acoes");
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Não foi possível concluir a operação contábil.",
    };
  }
}

export async function createAccountingReconciliationAction(
  input: Parameters<typeof createAccountingReconciliation>[1],
) {
  const context = await requireDomainActionContext("ACCOUNTING_READ");
  assertProtectedWriteCapability(context.role, "ACCOUNTING_WRITE");
  return run(() => createAccountingReconciliation(context, input));
}

export async function reverseAccountingEntryAction(
  entryId: string,
  input: Parameters<typeof reverseAccountingEntry>[2],
) {
  const context = await requireDomainActionContext("ACCOUNTING_READ");
  assertProtectedApprovalCapability(context.role, "ACCOUNTING_APPROVE");
  return run(() => reverseAccountingEntry(context, entryId, input));
}

export async function reopenAccountingPeriodAction(
  periodId: string,
  reason: string,
  authorizedById: string,
) {
  const context = await requireDomainActionContext("ACCOUNTING_READ");
  assertProtectedApprovalCapability(context.role, "ACCOUNTING_APPROVE");
  return run(() => reopenAccountingPeriod(context, periodId, reason, authorizedById));
}
