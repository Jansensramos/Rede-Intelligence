/**
 * Fase 9K.4A — consultas enxutas para as engines de `src/domain/executive-insights/engine.ts`.
 * Mesma disciplina de `src/application/executive/executive-queries.ts` (9K.2): nada aqui reaproveita
 * workspaces inteiros; cada consulta busca só os agregados/campos que a engine correspondente
 * precisa, sempre filtrados por `organizationId` (isolamento multi-tenant).
 */
import type { PaymentEventStatus } from "@prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import { buildDueHorizons, computeInstallmentBalance, PAYABLE_TERMINAL_STATUSES, summarizeCashPosition, type InstallmentPaymentLike } from "@/domain/financial-ops/engine";

const VOIDED_PAYMENT_STATUSES: PaymentEventStatus[] = ["FAILED", "REVERSED"];
const VALID_PAYMENT_STATUS_FILTER = { notIn: VOIDED_PAYMENT_STATUSES };
const HISTORY_WINDOW_MONTHS = 3;
const HISTORY_WINDOW_DAYS = HISTORY_WINDOW_MONTHS * 30;

// ---------------------------------------------------------------------------
// Pergunta 1 — contribuição/margem real das vendas
// ---------------------------------------------------------------------------

export async function querySalesContributionSignals(organizationId: string, projectId: string, referenceDate: Date) {
  const approvedSales = await prisma.sale.findMany({
    where: { organizationId, projectId, status: "APPROVED" },
    select: { id: true, soldPrice: true, discountAmount: true, incentiveAmount: true },
  });

  const saleIds = approvedSales.map((sale) => sale.id);
  const [commissionAggregate, commissionsBySale, commissionPolicy, paidAggregate] = await Promise.all([
    saleIds.length > 0 ? prisma.salesCommission.aggregate({ where: { saleId: { in: saleIds } }, _sum: { amount: true } }) : Promise.resolve({ _sum: { amount: null } }),
    saleIds.length > 0 ? prisma.salesCommission.findMany({ where: { saleId: { in: saleIds } }, select: { saleId: true } }) : Promise.resolve([]),
    prisma.salesCommissionPolicy.findFirst({
      where: { organizationId, isActive: true, OR: [{ projectId }, { projectId: null }] },
      orderBy: { projectId: "desc" },
      select: { percentage: true },
    }),
    prisma.payablePayment.aggregate({
      where: { status: VALID_PAYMENT_STATUS_FILTER, paidAt: { lte: referenceDate }, installment: { payableAccount: { organizationId, projectId } } },
      _sum: { amount: true },
    }),
  ]);

  const salesWithCommission = new Set(commissionsBySale.map((item) => item.saleId));
  const vgvWithoutRecordedCommission = approvedSales.filter((sale) => !salesWithCommission.has(sale.id)).reduce((sum, sale) => sum + Number(sale.soldPrice), 0);

  return {
    vgvVendido: approvedSales.reduce((sum, sale) => sum + Number(sale.soldPrice), 0),
    discountsGranted: approvedSales.reduce((sum, sale) => sum + Number(sale.discountAmount), 0),
    incentivesGranted: approvedSales.reduce((sum, sale) => sum + Number(sale.incentiveAmount), 0),
    salesCount: approvedSales.length,
    commissionsRecorded: Number(commissionAggregate._sum.amount ?? 0),
    vgvWithoutRecordedCommission,
    commissionPolicyRate: commissionPolicy ? Number(commissionPolicy.percentage) : null,
    costsIncurredToDate: Number(paidAggregate._sum?.amount ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Pergunta 2 — histórico real de caixa (runway) + posição de caixa livre
// ---------------------------------------------------------------------------

export async function queryFreeCashPosition(organizationId: string, companyId: string | null) {
  if (!companyId) return null;
  const accounts = await prisma.bankAccount.findMany({ where: { organizationId, companyId }, select: { id: true, restriction: true, openingBalance: true } });
  if (accounts.length === 0) return summarizeCashPosition([]);
  const accountIds = accounts.map((account) => account.id);
  const [creditByAccount, debitByAccount] = await Promise.all([
    prisma.bankTransaction.groupBy({ by: ["bankAccountId"], where: { bankAccountId: { in: accountIds }, direction: "CREDIT" }, _sum: { amount: true } }),
    prisma.bankTransaction.groupBy({ by: ["bankAccountId"], where: { bankAccountId: { in: accountIds }, direction: "DEBIT" }, _sum: { amount: true } }),
  ]);
  const creditByAccountId = new Map(creditByAccount.map((row) => [row.bankAccountId, Number(row._sum.amount ?? 0)]));
  const debitByAccountId = new Map(debitByAccount.map((row) => [row.bankAccountId, Number(row._sum.amount ?? 0)]));
  return summarizeCashPosition(
    accounts.map((account) => ({ restriction: account.restriction, balance: Number(account.openingBalance) + (creditByAccountId.get(account.id) ?? 0) - (debitByAccountId.get(account.id) ?? 0) })),
  );
}

export async function queryCashHistorySignals(organizationId: string, projectId: string, referenceDate: Date) {
  const windowStart = new Date(referenceDate.getTime() - HISTORY_WINDOW_DAYS * 86_400_000);
  const [outflowAggregate, salesInflowAggregate, otherInflowAggregate, anyPaymentCount] = await Promise.all([
    prisma.payablePayment.aggregate({
      where: { status: VALID_PAYMENT_STATUS_FILTER, paidAt: { gte: windowStart, lte: referenceDate }, installment: { payableAccount: { organizationId, projectId } } },
      _sum: { amount: true },
    }),
    prisma.receivablePayment.aggregate({
      where: { status: VALID_PAYMENT_STATUS_FILTER, receivedAt: { gte: windowStart, lte: referenceDate }, installment: { receivableAccount: { organizationId, projectId, saleId: { not: null } } } },
      _sum: { amount: true },
    }),
    prisma.receivablePayment.aggregate({
      where: { status: VALID_PAYMENT_STATUS_FILTER, receivedAt: { gte: windowStart, lte: referenceDate }, installment: { receivableAccount: { organizationId, projectId, saleId: null } } },
      _sum: { amount: true },
    }),
    prisma.payablePayment.count({ where: { status: VALID_PAYMENT_STATUS_FILTER, paidAt: { gte: windowStart, lte: referenceDate }, installment: { payableAccount: { organizationId, projectId } } } }),
  ]);

  const outflowTotal = Number(outflowAggregate._sum?.amount ?? 0);
  const salesInflowTotal = Number(salesInflowAggregate._sum?.amount ?? 0);
  const otherInflowTotal = Number(otherInflowAggregate._sum?.amount ?? 0);
  const hasHistory = anyPaymentCount > 0 || salesInflowTotal > 0 || otherInflowTotal > 0;

  return {
    historicalMonths: hasHistory ? HISTORY_WINDOW_MONTHS : 0,
    avgMonthlyOutflow: outflowTotal / HISTORY_WINDOW_MONTHS,
    avgMonthlySalesInflow: salesInflowTotal / HISTORY_WINDOW_MONTHS,
    avgMonthlyOtherInflow: otherInflowTotal / HISTORY_WINDOW_MONTHS,
  };
}

// ---------------------------------------------------------------------------
// Reserva mínima (compromissos ≤ 30 dias) e obrigações próximas (31-90 dias) — reaproveitadas pelas
// perguntas 4 (contratação) e 6 (caixa livre para investir).
// ---------------------------------------------------------------------------

export async function queryPayableHorizonAmounts(organizationId: string, projectId: string, referenceDate: Date) {
  const horizon = new Date(referenceDate.getTime() + 90 * 86_400_000);
  const payables = await prisma.payableInstallment.findMany({
    where: { payableAccount: { organizationId, projectId }, status: { notIn: [...PAYABLE_TERMINAL_STATUSES] }, dueDate: { lte: horizon } },
    select: { dueDate: true, currentAmount: true, payments: { select: { amount: true, status: true } } },
    take: 500,
  });
  const items = payables.map((item) => ({
    dueDate: item.dueDate,
    balance: computeInstallmentBalance(Number(item.currentAmount), item.payments.map((payment) => ({ amount: Number(payment.amount), status: payment.status as InstallmentPaymentLike["status"] }))),
  }));
  const horizons = buildDueHorizons(items, referenceDate, [30, 90]);
  const reserveMinimum = horizons.overdue + horizons.byHorizon[30];
  const obligationsNear = horizons.byHorizon[90] - horizons.byHorizon[30];
  return { reserveMinimum, obligationsNear };
}

// ---------------------------------------------------------------------------
// Pergunta 5 — desconto por unidade/proposta
// ---------------------------------------------------------------------------

export async function querySimulableSalesUnits(organizationId: string, projectId: string) {
  const units = await prisma.salesUnit.findMany({
    where: { organizationId, projectId, status: { in: ["DISPONIVEL", "RESERVADA", "EM_PROPOSTA"] } },
    select: {
      id: true,
      code: true,
      typology: true,
      priceLines: { select: { listPrice: true, minimumAuthorizedPrice: true, priceTable: { select: { status: true } } }, where: { priceTable: { status: "ACTIVE" } }, take: 1 },
    },
    orderBy: { code: "asc" },
    take: 50,
  });
  return units
    .filter((unit) => unit.priceLines.length > 0)
    .map((unit) => ({ id: unit.id, code: unit.code, typology: unit.typology, listPrice: Number(unit.priceLines[0].listPrice), minimumAuthorizedPrice: unit.priceLines[0].minimumAuthorizedPrice ? Number(unit.priceLines[0].minimumAuthorizedPrice) : null }));
}

/**
 * Reaproveita a MESMA lógica de `findApplicablePolicy` de `src/application/sales/sales-service.ts`
 * (faixa `[minimumAmount, maximumAmount]` por valor, projeto específico preferido sobre política
 * organizacional) — não um segundo conceito de alçada (plano §AN). Usada só para EXIBIÇÃO na
 * simulação de desconto (9K.4A): nunca decide, nunca aprova nada.
 */
export async function queryDiscountApprovalRole(organizationId: string, projectId: string, discountAmount: number) {
  const policies = await prisma.approvalPolicy.findMany({
    where: { organizationId, actType: "SALE_DISCOUNT", isActive: true, OR: [{ projectId }, { projectId: null }] },
    select: { projectId: true, minimumAmount: true, maximumAmount: true, requiredRole: true },
  });
  const inRange = policies.filter((policy) => discountAmount >= Number(policy.minimumAmount) && (policy.maximumAmount === null || discountAmount <= Number(policy.maximumAmount)));
  const applicable = inRange.sort((a, b) => (b.projectId ? 1 : 0) - (a.projectId ? 1 : 0))[0];
  return applicable ? applicable.requiredRole : null;
}

export async function queryMonthsOfStockSignal(organizationId: string, projectId: string, referenceDate: Date) {
  const windowStart = new Date(referenceDate.getTime() - HISTORY_WINDOW_DAYS * 86_400_000);
  const [availableCount, soldInWindow] = await Promise.all([
    prisma.salesUnit.count({ where: { organizationId, projectId, status: "DISPONIVEL" } }),
    prisma.sale.count({ where: { organizationId, projectId, status: "APPROVED", approvedAt: { gte: windowStart, lte: referenceDate } } }),
  ]);
  const averageMonthlyVelocity = soldInWindow / HISTORY_WINDOW_MONTHS;
  return { availableCount, averageMonthlyVelocity };
}
