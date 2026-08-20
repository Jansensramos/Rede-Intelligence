const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const roundPercentage = (value: number) => Math.round((value + Number.EPSILON) * 10_000) / 10_000;
const dayMs = 24 * 60 * 60 * 1000;
const diffInDays = (from: Date, to: Date) => Math.round((from.getTime() - to.getTime()) / dayMs);
const normalizeText = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR").trim();

// ---------------------------------------------------------------------------
// Parcelas: saldo, vencimento e transições de estado
// ---------------------------------------------------------------------------

export interface InstallmentPaymentLike {
  amount: number;
  status: "PENDING" | "PROCESSED" | "CLEARED" | "FAILED" | "REVERSED";
}

const VOIDED_PAYMENT_STATUSES = new Set(["FAILED", "REVERSED"]);

export function computeInstallmentBalance(currentAmount: number, payments: InstallmentPaymentLike[]): number {
  const validPaid = payments.filter((payment) => !VOIDED_PAYMENT_STATUSES.has(payment.status)).reduce((sum, payment) => sum + payment.amount, 0);
  return roundMoney(currentAmount - validPaid);
}

export function isInstallmentOverdue(dueDate: Date, balance: number, status: string, referenceDate: Date, terminalStatuses: readonly string[]): boolean {
  return balance > 0.005 && dueDate.getTime() < referenceDate.getTime() && !terminalStatuses.includes(status);
}

export type PayableInstallmentStatus = "PREVISTA" | "PROGRAMADA" | "AGUARDANDO_APROVACAO" | "APROVADA" | "PARCIALMENTE_PAGA" | "PAGA" | "CANCELADA";
export type ReceivableInstallmentStatus = "PREVISTA" | "EMITIDA" | "PARCIALMENTE_RECEBIDA" | "RECEBIDA" | "RENEGOCIADA" | "CANCELADA";

export const PAYABLE_TERMINAL_STATUSES: readonly PayableInstallmentStatus[] = ["PAGA", "CANCELADA"];
export const RECEIVABLE_TERMINAL_STATUSES: readonly ReceivableInstallmentStatus[] = ["RECEBIDA", "CANCELADA", "RENEGOCIADA"];

const PAYABLE_TRANSITIONS: Record<PayableInstallmentStatus, PayableInstallmentStatus[]> = {
  PREVISTA: ["PROGRAMADA", "AGUARDANDO_APROVACAO", "CANCELADA"],
  PROGRAMADA: ["AGUARDANDO_APROVACAO", "APROVADA", "PREVISTA", "CANCELADA"],
  AGUARDANDO_APROVACAO: ["APROVADA", "PREVISTA", "CANCELADA"],
  APROVADA: ["PARCIALMENTE_PAGA", "PAGA", "CANCELADA"],
  PARCIALMENTE_PAGA: ["PARCIALMENTE_PAGA", "PAGA", "CANCELADA"],
  PAGA: [],
  CANCELADA: [],
};

const RECEIVABLE_TRANSITIONS: Record<ReceivableInstallmentStatus, ReceivableInstallmentStatus[]> = {
  PREVISTA: ["EMITIDA", "CANCELADA"],
  EMITIDA: ["PARCIALMENTE_RECEBIDA", "RECEBIDA", "RENEGOCIADA", "CANCELADA"],
  PARCIALMENTE_RECEBIDA: ["PARCIALMENTE_RECEBIDA", "RECEBIDA", "RENEGOCIADA", "CANCELADA"],
  RECEBIDA: [],
  RENEGOCIADA: [],
  CANCELADA: [],
};

export function assertPayableTransition(from: PayableInstallmentStatus, to: PayableInstallmentStatus) {
  if (from === to) return;
  if (!PAYABLE_TRANSITIONS[from]?.includes(to)) throw new Error(`Transição de status inválida em Conta a Pagar: ${from} → ${to}.`);
}

export function assertReceivableTransition(from: ReceivableInstallmentStatus, to: ReceivableInstallmentStatus) {
  if (from === to) return;
  if (!RECEIVABLE_TRANSITIONS[from]?.includes(to)) throw new Error(`Transição de status inválida em Conta a Receber: ${from} → ${to}.`);
}

export function nextPayableStatusAfterPayment(currentAmount: number, balance: number): PayableInstallmentStatus {
  if (balance <= 0.005) return "PAGA";
  if (roundMoney(currentAmount - balance) > 0.005) return "PARCIALMENTE_PAGA";
  return "APROVADA";
}

export function nextReceivableStatusAfterPayment(currentAmount: number, balance: number): ReceivableInstallmentStatus {
  if (balance <= 0.005) return "RECEBIDA";
  if (roundMoney(currentAmount - balance) > 0.005) return "PARCIALMENTE_RECEBIDA";
  return "EMITIDA";
}

// ---------------------------------------------------------------------------
// Correção contratual (índice + juros + multa - desconto), com memória de cálculo
// ---------------------------------------------------------------------------

export interface CorrectionInput {
  baseAmount: number;
  indexPercentage?: number;
  interestRatePerMonth?: number;
  monthsLate?: number;
  fineRate?: number;
  discountAmount?: number;
}

export interface CorrectionResult {
  indexedAmount: number;
  interestAmount: number;
  fineAmount: number;
  discountAmount: number;
  resultingAmount: number;
}

export function applyInstallmentCorrection(input: CorrectionInput): CorrectionResult {
  if (input.baseAmount < 0) throw new Error("O valor base da correção não pode ser negativo.");
  const monthsLate = Math.max(0, input.monthsLate ?? 0);
  const indexedAmount = roundMoney(input.baseAmount * (1 + (input.indexPercentage ?? 0) / 100));
  const interestAmount = roundMoney(indexedAmount * ((input.interestRatePerMonth ?? 0) / 100) * monthsLate);
  const fineAmount = monthsLate > 0 ? roundMoney(indexedAmount * ((input.fineRate ?? 0) / 100)) : 0;
  const discountAmount = roundMoney(Math.max(0, input.discountAmount ?? 0));
  const resultingAmount = roundMoney(indexedAmount + interestAmount + fineAmount - discountAmount);
  if (resultingAmount < 0) throw new Error("O valor corrigido da parcela não pode ficar negativo.");
  return { indexedAmount, interestAmount, fineAmount, discountAmount, resultingAmount };
}

// ---------------------------------------------------------------------------
// Régua de vencimentos / horizontes D+N
// ---------------------------------------------------------------------------

export interface AgingItem {
  dueDate: Date;
  balance: number;
}

export interface DueHorizons {
  overdue: number;
  byHorizon: Record<number, number>;
}

export function buildDueHorizons(items: AgingItem[], referenceDate: Date, horizonsDays: number[] = [21, 14, 7, 3, 0]): DueHorizons {
  const result: DueHorizons = { overdue: 0, byHorizon: Object.fromEntries(horizonsDays.map((h) => [h, 0])) };
  for (const item of items) {
    if (item.balance <= 0.005) continue;
    const days = diffInDays(item.dueDate, referenceDate);
    if (days < 0) {
      result.overdue = roundMoney(result.overdue + item.balance);
      continue;
    }
    for (const horizon of horizonsDays) if (days <= horizon) result.byHorizon[horizon] = roundMoney(result.byHorizon[horizon] + item.balance);
  }
  return result;
}

export function classifyDueSeverity(days: number): "VERDE" | "AMARELO" | "VERMELHO" {
  if (days < 0) return "VERMELHO";
  if (days <= 3) return "AMARELO";
  return "VERDE";
}

// ---------------------------------------------------------------------------
// Conciliação bancária: heurísticas de matching
// ---------------------------------------------------------------------------

export interface ReconciliationCandidateInput {
  transactionAmount: number;
  transactionDate: Date;
  transactionDescription: string;
  candidateAmount: number;
  candidateDueDate: Date;
  candidateDocumentRef?: string | null;
  candidateCounterpartyName?: string | null;
}

export interface ReconciliationScore {
  score: number;
  confidence: "ALTA" | "MEDIA" | "BAIXA" | null;
  breakdown: { amountExact: boolean; amountClose: boolean; dateExact: boolean; dateClose: boolean; documentMatch: boolean; counterpartyMatch: boolean };
}

export function scoreReconciliationCandidate(input: ReconciliationCandidateInput): ReconciliationScore {
  const amountDiff = Math.abs(input.transactionAmount - input.candidateAmount);
  const amountDiffPct = input.candidateAmount === 0 ? Number.POSITIVE_INFINITY : amountDiff / Math.abs(input.candidateAmount);
  const amountExact = amountDiff <= 0.01;
  const amountClose = !amountExact && amountDiffPct <= 0.02;
  const daysDiff = Math.abs(diffInDays(input.transactionDate, input.candidateDueDate));
  const dateExact = daysDiff === 0;
  const dateClose = !dateExact && daysDiff <= 3;
  const description = normalizeText(input.transactionDescription);
  const documentMatch = !!input.candidateDocumentRef && description.includes(normalizeText(input.candidateDocumentRef));
  const counterpartyMatch = !documentMatch && !!input.candidateCounterpartyName && description.includes(normalizeText(input.candidateCounterpartyName));
  let score = 0;
  if (amountExact) score += 50;
  else if (amountClose) score += 30;
  if (dateExact) score += 25;
  else if (dateClose) score += 12;
  if (documentMatch) score += 25;
  else if (counterpartyMatch) score += 15;
  const confidence = score >= 75 ? "ALTA" : score >= 45 ? "MEDIA" : score > 0 ? "BAIXA" : null;
  return { score, confidence, breakdown: { amountExact, amountClose, dateExact, dateClose, documentMatch, counterpartyMatch } };
}

export function rankReconciliationCandidates<T>(candidates: { item: T; input: ReconciliationCandidateInput }[]): { item: T; result: ReconciliationScore }[] {
  return candidates
    .map((candidate) => ({ item: candidate.item, result: scoreReconciliationCandidate(candidate.input) }))
    .filter((candidate) => candidate.result.score > 0)
    .sort((a, b) => b.result.score - a.result.score);
}

// ---------------------------------------------------------------------------
// Fluxo: previsão residual x compromisso concreto x realizado (sem dupla contagem)
// ---------------------------------------------------------------------------

export function consumePlannedWithCommitted(scheduledAmount: number, committedAmount: number): { residual: number; consumed: number } {
  if (scheduledAmount < 0 || committedAmount < 0) throw new Error("Valores de consumo da previsão não podem ser negativos.");
  const consumed = Math.min(scheduledAmount, committedAmount);
  return { residual: roundMoney(scheduledAmount - consumed), consumed: roundMoney(consumed) };
}

export interface PeriodFlowInput {
  period: string;
  plannedScheduled: number;
  committedTotal: number;
  committedRealized: number;
}

export interface PeriodFlowRow {
  period: string;
  realized: number;
  committed: number;
  residual: number;
  total: number;
}

export function buildUpdatedProjectionRow(input: PeriodFlowInput): PeriodFlowRow {
  if ([input.plannedScheduled, input.committedTotal, input.committedRealized].some((value) => value < 0)) throw new Error(`Fluxo do período ${input.period} contém valor negativo.`);
  if (input.committedRealized > input.committedTotal + 0.01) throw new Error(`Período ${input.period}: realizado do compromisso não pode exceder o compromisso.`);
  const committedPending = roundMoney(input.committedTotal - input.committedRealized);
  const { residual } = consumePlannedWithCommitted(input.plannedScheduled, input.committedTotal);
  const total = roundMoney(input.committedRealized + committedPending + residual);
  return { period: input.period, realized: roundMoney(input.committedRealized), committed: committedPending, residual, total };
}

export function buildUpdatedProjection(rows: PeriodFlowInput[]): PeriodFlowRow[] {
  return rows.map(buildUpdatedProjectionRow);
}

// ---------------------------------------------------------------------------
// Posição de caixa e necessidade de capital
// ---------------------------------------------------------------------------

export interface BankAccountBalanceInput {
  restriction: "FREE" | "RESTRICTED";
  balance: number;
}

export function summarizeCashPosition(accounts: BankAccountBalanceInput[]) {
  const total = roundMoney(accounts.reduce((sum, account) => sum + account.balance, 0));
  const free = roundMoney(accounts.filter((account) => account.restriction === "FREE").reduce((sum, account) => sum + account.balance, 0));
  return { total, free, restricted: roundMoney(total - free) };
}

export interface CashProjectionRow {
  period: string;
  inflow: number;
  outflow: number;
}

export function projectCashBalances(startingBalance: number, rows: CashProjectionRow[]) {
  let balance = startingBalance;
  return rows.map((row) => {
    balance = roundMoney(balance + row.inflow - row.outflow);
    return { period: row.period, inflow: roundMoney(row.inflow), outflow: roundMoney(row.outflow), closingBalance: balance };
  });
}

export function capitalNeedIndicators(rows: { period: string; closingBalance: number }[]) {
  const worst = rows.reduce<{ period: string; closingBalance: number } | null>((min, row) => (!min || row.closingBalance < min.closingBalance ? row : min), null);
  const capitalNeed = worst && worst.closingBalance < 0 ? roundMoney(Math.abs(worst.closingBalance)) : 0;
  return { lowestBalance: worst?.closingBalance ?? 0, lowestBalancePeriod: worst?.period ?? null, capitalNeed };
}

// ---------------------------------------------------------------------------
// Intercompany: reciprocidade e eliminação na consolidação
// ---------------------------------------------------------------------------

export interface IntercompanyLegInput {
  fromCompanyId: string;
  toCompanyId: string;
  amount: number;
}

export function assertIntercompanyReciprocity(transaction: IntercompanyLegInput) {
  if (transaction.amount <= 0) throw new Error("O valor da movimentação intercompany deve ser positivo.");
  if (transaction.fromCompanyId === transaction.toCompanyId) throw new Error("Origem e destino intercompany não podem ser a mesma empresa.");
}

export function summarizeConsolidationElimination(transactions: IntercompanyLegInput[]) {
  return roundMoney(transactions.reduce((sum, transaction) => sum + transaction.amount, 0));
}

// ---------------------------------------------------------------------------
// Prova-zero financeira
// ---------------------------------------------------------------------------

export function verifyAccountProofZero(currentAmount: number, paymentsSum: number, balance: number, tolerance = 0.01) {
  return Math.abs(roundMoney(currentAmount - paymentsSum) - balance) <= tolerance;
}

export function verifyReciprocity(fromAmount: number, toAmount: number, tolerance = 0.01) {
  return Math.abs(fromAmount - toAmount) <= tolerance;
}

export function verifyNoDoubleCounting(plannedTotal: number, committedTotal: number, residual: number, tolerance = 0.01) {
  return Math.abs(roundMoney(committedTotal + residual) - roundMoney(Math.max(plannedTotal, committedTotal))) <= tolerance;
}

export { roundMoney, roundPercentage, diffInDays };
