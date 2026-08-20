import { prisma } from "@/infrastructure/database/prisma";
import type { BankingAdapter, BankingAdapterAccountIdentity, BankingAdapterAccountSnapshot, BankingAdapterSyncResult } from "@/domain/financial-ops/banking-adapter";

/**
 * Única implementação real desta fase: nenhum provedor externo, apenas o que já foi
 * importado manualmente/via CSV para BankTransaction. Prova que o contrato BankingAdapter
 * é utilizável hoje e substituível por um provedor real (Open Finance, API do banco)
 * sem alterar PayableAccount/ReceivableAccount/BankTransaction.
 */
export class ManualBankingAdapter implements BankingAdapter {
  readonly provider = "MANUAL";

  async getAccountBalance(externalAccountId: string): Promise<BankingAdapterAccountSnapshot> {
    const account = await prisma.bankAccount.findUnique({ where: { id: externalAccountId } });
    if (!account) throw new Error("Conta bancária não encontrada para cálculo de saldo manual.");
    const [credit, debit] = await Promise.all([
      prisma.bankTransaction.aggregate({ where: { bankAccountId: externalAccountId, direction: "CREDIT" }, _sum: { amount: true } }),
      prisma.bankTransaction.aggregate({ where: { bankAccountId: externalAccountId, direction: "DEBIT" }, _sum: { amount: true } }),
    ]);
    const balance = account.openingBalance.add(credit._sum.amount ?? 0).sub(debit._sum.amount ?? 0);
    return { externalAccountId, balance: Number(balance), asOf: new Date() };
  }

  async syncTransactions(): Promise<BankingAdapterSyncResult> {
    // Sem provedor externo conectado: sincronização automática não é possível nesta fase.
    // Transações chegam via importBankTransactions (manual ou CSV estruturado).
    return { transactions: [] };
  }

  async identifyAccount(externalAccountId: string): Promise<BankingAdapterAccountIdentity | null> {
    const account = await prisma.bankAccount.findUnique({ where: { id: externalAccountId } });
    if (!account) return null;
    return { externalAccountId, agency: account.agency, accountNumber: account.accountNumber };
  }
}

export const manualBankingAdapter = new ManualBankingAdapter();
