/**
 * Cliente 360 (Fase 9K.4B, plano §2 "Visão financeira do cliente") — funções puras, sem I/O.
 * Reaproveita 100% do motor de saldo/vencimento já existente (`domain/financial-ops/engine.ts`,
 * usado por Financeiro e pela Gestão Executiva) em vez de inventar uma segunda régua de saldo —
 * "quanto pagou/deve/venceu" aqui é sempre `computeInstallmentBalance`/`isInstallmentOverdue`.
 */
import { computeInstallmentBalance, isInstallmentOverdue, RECEIVABLE_TERMINAL_STATUSES, type InstallmentPaymentLike, type ReceivableInstallmentStatus } from "@/domain/financial-ops/engine";

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export interface ClientInstallmentInput {
  id: string;
  number: number;
  dueDate: Date;
  currentAmount: number;
  status: ReceivableInstallmentStatus;
  payments: InstallmentPaymentLike[];
}

export interface ClientInstallmentPosition {
  id: string;
  number: number;
  dueDate: string;
  amount: number;
  balance: number;
  status: ReceivableInstallmentStatus;
  overdue: boolean;
}

/** Uma linha por parcela — mesma classificação de vencido usada em Financeiro/Gestão Executiva, nunca uma segunda régua. */
export function buildInstallmentPositions(installments: ClientInstallmentInput[], referenceDate: Date): ClientInstallmentPosition[] {
  return [...installments]
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
    .map((item) => {
      const balance = computeInstallmentBalance(item.currentAmount, item.payments);
      return {
        id: item.id,
        number: item.number,
        dueDate: item.dueDate.toISOString(),
        amount: item.currentAmount,
        balance,
        status: item.status,
        overdue: isInstallmentOverdue(item.dueDate, balance, item.status, referenceDate, RECEIVABLE_TERMINAL_STATUSES),
      };
    });
}

export interface ClientFinancialPosition {
  contracted: number;
  paid: number;
  open: number;
  overdue: number;
  overdueCount: number;
  nextDueDate: string | null;
  nextDueAmount: number | null;
}

/**
 * "Quanto contratou/pagou/deve/venceu" (plano §2) a partir das posições de parcela já calculadas.
 * `contracted` vem de fora (soma do `soldPrice` das vendas aprovadas) — nunca recalculado a partir
 * de parcelas, que podem mudar de valor numa renegociação sem alterar o preço vendido do contrato.
 */
export function summarizeClientFinancialPosition(positions: ClientInstallmentPosition[], contracted: number): ClientFinancialPosition {
  const paid = roundMoney(positions.reduce((sum, item) => sum + (item.amount - item.balance), 0));
  const openItems = positions.filter((item) => !RECEIVABLE_TERMINAL_STATUSES.includes(item.status) && item.balance > 0.005);
  const overdueItems = openItems.filter((item) => item.overdue);
  const upcoming = openItems
    .filter((item) => !item.overdue)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0] ?? null;
  return {
    contracted: roundMoney(contracted),
    paid,
    open: roundMoney(openItems.reduce((sum, item) => sum + item.balance, 0)),
    overdue: roundMoney(overdueItems.reduce((sum, item) => sum + item.balance, 0)),
    overdueCount: overdueItems.length,
    nextDueDate: upcoming?.dueDate ?? null,
    nextDueAmount: upcoming?.balance ?? null,
  };
}

/** Soma posições financeiras de várias vendas/contratos num total do cliente (plano §2) — próximo vencimento é o mais próximo entre todas. */
export function sumClientFinancialPositions(positions: ClientFinancialPosition[]): ClientFinancialPosition {
  const withNextDue = positions.filter((item): item is ClientFinancialPosition & { nextDueDate: string } => item.nextDueDate !== null);
  const nextDue = withNextDue.sort((a, b) => new Date(a.nextDueDate).getTime() - new Date(b.nextDueDate).getTime())[0] ?? null;
  return {
    contracted: roundMoney(positions.reduce((sum, item) => sum + item.contracted, 0)),
    paid: roundMoney(positions.reduce((sum, item) => sum + item.paid, 0)),
    open: roundMoney(positions.reduce((sum, item) => sum + item.open, 0)),
    overdue: roundMoney(positions.reduce((sum, item) => sum + item.overdue, 0)),
    overdueCount: positions.reduce((sum, item) => sum + item.overdueCount, 0),
    nextDueDate: nextDue?.nextDueDate ?? null,
    nextDueAmount: nextDue?.nextDueAmount ?? null,
  };
}
