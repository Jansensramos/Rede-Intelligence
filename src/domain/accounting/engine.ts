import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = Decimal.Value;
export type EntrySide = "DEBIT" | "CREDIT";

export type PostingLine = {
  accountId: string;
  side: EntrySide;
  amount: MoneyInput;
  history?: string;
};

const money = (value: MoneyInput) => new Decimal(value).toDecimalPlaces(2);

export function assertBalancedEntry(lines: PostingLine[]) {
  if (lines.length < 2) throw new Error("O lançamento exige pelo menos duas linhas.");
  if (lines.some((line) => money(line.amount).lte(0))) throw new Error("Toda linha contábil deve possuir valor positivo.");
  const debit = lines.filter((line) => line.side === "DEBIT").reduce((sum, line) => sum.plus(money(line.amount)), new Decimal(0));
  const credit = lines.filter((line) => line.side === "CREDIT").reduce((sum, line) => sum.plus(money(line.amount)), new Decimal(0));
  if (!debit.eq(credit)) throw new Error(`Lançamento desequilibrado: débitos ${debit.toFixed(2)} e créditos ${credit.toFixed(2)}.`);
  return { debit: debit.toFixed(2), credit: credit.toFixed(2) };
}

export function reversePostingLines(lines: PostingLine[]): PostingLine[] {
  assertBalancedEntry(lines);
  return lines.map((line) => ({ ...line, side: line.side === "DEBIT" ? "CREDIT" : "DEBIT" }));
}

export function buildEconomicIdentity(parts: { organizationId: string; companyId: string; sourceDomain: string; rootSourceId: string }) {
  return [parts.organizationId, parts.companyId, parts.sourceDomain, parts.rootSourceId].map((part) => part.trim().toLowerCase()).join(":");
}

export function assertEventReplay(existing: { payloadChecksum: string; eventVersion: number } | null, incoming: { payloadChecksum: string; eventVersion: number }) {
  if (!existing) return "CREATE" as const;
  if (existing.payloadChecksum === incoming.payloadChecksum && existing.eventVersion === incoming.eventVersion) return "REPLAY" as const;
  throw new Error("A identidade idempotente já existe com payload ou versão divergente.");
}

export type MappingCandidate = { id: string; priority: number; specificity: number; effectiveFrom: Date; effectiveTo?: Date | null };

export function selectAccountingMapping(candidates: MappingCandidate[], date: Date) {
  const valid = candidates
    .filter((candidate) => candidate.effectiveFrom <= date && (!candidate.effectiveTo || candidate.effectiveTo >= date))
    .sort((left, right) => right.specificity - left.specificity || right.priority - left.priority || right.effectiveFrom.getTime() - left.effectiveFrom.getTime());
  if (!valid.length) return null;
  const winner = valid[0];
  const ambiguous = valid[1] && valid[1].specificity === winner.specificity && valid[1].priority === winner.priority && valid[1].effectiveFrom.getTime() === winner.effectiveFrom.getTime();
  if (ambiguous) throw new Error("Mapeamento contábil ambíguo para o fato informado.");
  return winner;
}

export function allocateExact(sourceAmount: MoneyInput, targets: Array<{ id: string; driver: MoneyInput }>) {
  const source = money(sourceAmount);
  if (source.lt(0)) throw new Error("O valor de origem do rateio não pode ser negativo.");
  if (!targets.length) throw new Error("O rateio exige ao menos um destino.");
  const drivers = targets.map((target) => ({ ...target, driver: new Decimal(target.driver) }));
  if (drivers.some((target) => target.driver.lt(0))) throw new Error("Drivers de rateio não podem ser negativos.");
  const totalDriver = drivers.reduce((sum, target) => sum.plus(target.driver), new Decimal(0));
  if (totalDriver.lte(0)) throw new Error("A soma dos drivers de rateio deve ser positiva.");
  let allocated = new Decimal(0);
  return drivers.map((target, index) => {
    const rate = target.driver.div(totalDriver);
    const amount = index === drivers.length - 1 ? source.minus(allocated) : source.mul(rate).toDecimalPlaces(2);
    allocated = allocated.plus(amount);
    return { id: target.id, driver: target.driver.toString(), rate: rate.toDecimalPlaces(9).toString(), amount: amount.toFixed(2) };
  });
}

export function assertAllocationProof(sourceAmount: MoneyInput, allocatedAmounts: MoneyInput[], residualAmount: MoneyInput = 0) {
  const source = money(sourceAmount);
  const allocated = allocatedAmounts.reduce<Decimal>((sum, value) => sum.plus(money(value)), new Decimal(0));
  const residual = money(residualAmount);
  if (!allocated.plus(residual).eq(source)) throw new Error("Apropriação sem prova-zero: destinos e residual não fecham com a origem.");
  return { source: source.toFixed(2), allocated: allocated.toFixed(2), residual: residual.toFixed(2), proofZero: true };
}

export function calculateTrialBalance<T extends { accountId: string; normalBalance: "DEBIT" | "CREDIT"; openingBalance: MoneyInput; debit: MoneyInput; credit: MoneyInput }>(input: T[]) {
  return input.map((row) => {
    const opening = money(row.openingBalance);
    const debit = money(row.debit);
    const credit = money(row.credit);
    const movement = row.normalBalance === "DEBIT" ? debit.minus(credit) : credit.minus(debit);
    return { ...row, openingBalance: opening.toFixed(2), debit: debit.toFixed(2), credit: credit.toFixed(2), closingBalance: opening.plus(movement).toFixed(2) };
  });
}

export function calculateConsolidation(input: { individualAmount: MoneyInput; adjustmentAmount?: MoneyInput; eliminationAmount: MoneyInput }) {
  const individual = money(input.individualAmount);
  const adjustment = money(input.adjustmentAmount ?? 0);
  const elimination = money(input.eliminationAmount);
  const consolidated = individual.plus(adjustment).minus(elimination);
  return { individual: individual.toFixed(2), adjustment: adjustment.toFixed(2), elimination: elimination.toFixed(2), consolidated: consolidated.toFixed(2), proofZero: individual.plus(adjustment).minus(elimination).eq(consolidated) };
}

export function calculateReconciliation(sourceAmount: MoneyInput, ledgerAmount: MoneyInput, materiality: MoneyInput) {
  const source = money(sourceAmount);
  const ledger = money(ledgerAmount);
  const difference = source.minus(ledger);
  return { source: source.toFixed(2), ledger: ledger.toFixed(2), difference: difference.toFixed(2), material: difference.abs().gte(money(materiality)), status: difference.isZero() ? "MATCHED" as const : "DIVERGENT" as const };
}

export function calculateConfiguredTax(input: { taxableBase: MoneyInput; rate: MoneyInput; adjustment?: MoneyInput }) {
  const taxableBase = money(input.taxableBase);
  const rate = new Decimal(input.rate);
  const adjustment = money(input.adjustment ?? 0);
  if (rate.lt(0) || rate.gt(1)) throw new Error("A alíquota configurada deve estar entre zero e um.");
  return taxableBase.mul(rate).plus(adjustment).toDecimalPlaces(2).toFixed(2);
}

export function calculateRevenueRecognition(input: { vgv: MoneyInput; receivable: MoneyInput; cashReceived: MoneyInput; recognitionRate: MoneyInput; allocatedUnitCost: MoneyInput }) {
  const recognitionRate = new Decimal(input.recognitionRate);
  if (recognitionRate.lt(0) || recognitionRate.gt(1)) throw new Error("O percentual de reconhecimento deve estar entre zero e um.");
  const vgv = money(input.vgv);
  const revenue = vgv.mul(recognitionRate).toDecimalPlaces(2);
  const cost = money(input.allocatedUnitCost).mul(recognitionRate).toDecimalPlaces(2);
  return { vgv: vgv.toFixed(2), receivable: money(input.receivable).toFixed(2), cashReceived: money(input.cashReceived).toFixed(2), recognizedRevenue: revenue.toFixed(2), recognizedCost: cost.toFixed(2), margin: revenue.minus(cost).toFixed(2) };
}

export function assertPeriodAllowsPosting(status: string, accountingDate: Date, referenceMonth: Date) {
  if (!["OPEN", "REOPENED", "ADJUSTMENT"].includes(status)) throw new Error("O período contábil não permite lançamentos.");
  if (accountingDate.getUTCFullYear() !== referenceMonth.getUTCFullYear() || accountingDate.getUTCMonth() !== referenceMonth.getUTCMonth()) throw new Error("A data contábil não pertence ao período informado.");
}

export const accountingEngineInternals = { money };
