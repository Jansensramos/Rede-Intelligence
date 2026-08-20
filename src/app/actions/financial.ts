"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/application/auth/session";
import {
  applyPayableInstallmentCorrection,
  approveIntercompanyTransaction,
  closeFinancialPeriod,
  confirmReconciliation,
  createBankAccount,
  createCustomer,
  createFinancialTransfer,
  createIntercompanyTransaction,
  createPayableAccount,
  createReceivableAccount,
  createSupplier,
  importBankStatementCsv,
  importBankTransactions,
  registerPayablePayment,
  registerReceivablePayment,
  rejectReconciliation,
  reopenFinancialPeriod,
  suggestReconciliationsForTransaction,
  transitionPayableInstallment,
  transitionReceivableInstallment,
} from "@/application/financial-ops/financial-service";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "A operação financeira não pôde ser concluída.");

async function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await operation();
    revalidatePath("/");
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function createSupplierAction(input: Parameters<typeof createSupplier>[1]) {
  const context = await requireAuthContext();
  return run(() => createSupplier(context, input));
}

export async function createCustomerAction(input: Parameters<typeof createCustomer>[1]) {
  const context = await requireAuthContext();
  return run(() => createCustomer(context, input));
}

export async function createBankAccountAction(input: Parameters<typeof createBankAccount>[1]) {
  const context = await requireAuthContext();
  return run(() => createBankAccount(context, input));
}

export async function createPayableAccountAction(input: Parameters<typeof createPayableAccount>[1]) {
  const context = await requireAuthContext();
  return run(() => createPayableAccount(context, input));
}

export async function transitionPayableInstallmentAction(installmentId: string, to: Parameters<typeof transitionPayableInstallment>[2], reason?: string) {
  const context = await requireAuthContext();
  return run(() => transitionPayableInstallment(context, installmentId, to, reason));
}

export async function registerPayablePaymentAction(input: Parameters<typeof registerPayablePayment>[1]) {
  const context = await requireAuthContext();
  return run(() => registerPayablePayment(context, input));
}

export async function applyPayableInstallmentCorrectionAction(input: Parameters<typeof applyPayableInstallmentCorrection>[1]) {
  const context = await requireAuthContext();
  return run(() => applyPayableInstallmentCorrection(context, input));
}

export async function createReceivableAccountAction(input: Parameters<typeof createReceivableAccount>[1]) {
  const context = await requireAuthContext();
  return run(() => createReceivableAccount(context, input));
}

export async function transitionReceivableInstallmentAction(installmentId: string, to: Parameters<typeof transitionReceivableInstallment>[2], reason?: string) {
  const context = await requireAuthContext();
  return run(() => transitionReceivableInstallment(context, installmentId, to, reason));
}

export async function registerReceivablePaymentAction(input: Parameters<typeof registerReceivablePayment>[1]) {
  const context = await requireAuthContext();
  return run(() => registerReceivablePayment(context, input));
}

export async function importBankTransactionsAction(input: Parameters<typeof importBankTransactions>[1]) {
  const context = await requireAuthContext();
  return run(() => importBankTransactions(context, input));
}

export async function importBankStatementCsvAction(bankAccountId: string, csvContent: string) {
  const context = await requireAuthContext();
  return run(() => importBankStatementCsv(context, bankAccountId, csvContent));
}

export async function suggestReconciliationsAction(bankTransactionId: string) {
  const context = await requireAuthContext();
  return run(() => suggestReconciliationsForTransaction(context, bankTransactionId));
}

export async function confirmReconciliationAction(matchId: string) {
  const context = await requireAuthContext();
  return run(() => confirmReconciliation(context, matchId));
}

export async function rejectReconciliationAction(matchId: string, reason: string) {
  const context = await requireAuthContext();
  return run(() => rejectReconciliation(context, matchId, reason));
}

export async function createFinancialTransferAction(input: Parameters<typeof createFinancialTransfer>[1]) {
  const context = await requireAuthContext();
  return run(() => createFinancialTransfer(context, input));
}

export async function createIntercompanyTransactionAction(input: Parameters<typeof createIntercompanyTransaction>[1]) {
  const context = await requireAuthContext();
  return run(() => createIntercompanyTransaction(context, input));
}

export async function approveIntercompanyTransactionAction(transactionId: string) {
  const context = await requireAuthContext();
  return run(() => approveIntercompanyTransaction(context, transactionId));
}

export async function closeFinancialPeriodAction(companyId: string, referenceMonth: Date) {
  const context = await requireAuthContext();
  return run(() => closeFinancialPeriod(context, companyId, referenceMonth));
}

export async function reopenFinancialPeriodAction(closureId: string, reason: string) {
  const context = await requireAuthContext();
  return run(() => reopenFinancialPeriod(context, closureId, reason));
}
