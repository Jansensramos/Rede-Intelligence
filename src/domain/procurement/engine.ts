import Decimal from "decimal.js";

export type DecimalLike = Decimal.Value;

const money = (value: DecimalLike) => new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function requiredContractingDate(requiredAt: Date, expectedLeadDays: number, bufferDays: number) {
  const result = new Date(requiredAt);
  result.setUTCDate(result.getUTCDate() - expectedLeadDays - bufferDays);
  return result;
}

export function isCriticalPurchase(input: { requiredAt: Date; expectedLeadDays: number; bufferDays: number; referenceDate: Date; contracted: boolean }) {
  if (input.contracted) return false;
  return requiredContractingDate(input.requiredAt, input.expectedLeadDays, input.bufferDays).getTime() <= input.referenceDate.getTime();
}

export function proposalTotal(input: { itemsSubtotal: DecimalLike; taxAmount?: DecimalLike; freightAmount?: DecimalLike; discountAmount?: DecimalLike }) {
  return money(new Decimal(input.itemsSubtotal).add(input.taxAmount ?? 0).add(input.freightAmount ?? 0).sub(input.discountAmount ?? 0));
}

export function classifyComparability(input: { sameUnit: boolean; sameQuantity: boolean; materialExclusions: boolean; explicitAdjustments: boolean }) {
  if (input.materialExclusions && !input.explicitAdjustments) return "NOT_COMPARABLE" as const;
  if (!input.sameUnit || !input.sameQuantity || input.materialExclusions || input.explicitAdjustments) return "COMPARABLE_WITH_ADJUSTMENTS" as const;
  return "COMPARABLE" as const;
}

export function calculateSaving(referenceAmount: DecimalLike, contractedComparableAmount: DecimalLike, scopeComparable: boolean) {
  const reference = money(referenceAmount);
  const contracted = money(contractedComparableAmount);
  const nominal = money(reference.sub(contracted));
  return {
    referenceAmount: reference,
    contractedComparableAmount: contracted,
    nominalAmount: nominal,
    percentage: reference.isZero() ? new Decimal(0) : nominal.div(reference).toDecimalPlaces(6),
    canValidate: scopeComparable && nominal.greaterThanOrEqualTo(0),
  };
}

export function currentContractValue(originalAmount: DecimalLike, amendments: { type: string; status: string; value: DecimalLike }[]) {
  return money(amendments.reduce((total, amendment) => {
    if (amendment.status !== "APPROVED") return total;
    if (amendment.type === "SUPPRESSION") return total.sub(amendment.value);
    if (amendment.type === "INCREASE" || amendment.type === "READJUSTMENT") return total.add(amendment.value);
    return total;
  }, new Decimal(originalAmount)));
}

export function validateMeasurement(input: {
  contractCurrentAmount: DecimalLike;
  previouslyMeasuredAmount: DecimalLike;
  lines: { contractedQuantity: DecimalLike; previousQuantity: DecimalLike; periodQuantity: DecimalLike; unitPrice: DecimalLike }[];
  retentionAmount?: DecimalLike;
  discountAmount?: DecimalLike;
  advanceAmortizationAmount?: DecimalLike;
  extraordinaryToleranceAmount?: DecimalLike;
}) {
  const tolerance = money(input.extraordinaryToleranceAmount ?? 0);
  let gross = new Decimal(0);
  const normalizedLines = input.lines.map((line) => {
    const contracted = new Decimal(line.contractedQuantity);
    const previous = new Decimal(line.previousQuantity);
    const period = new Decimal(line.periodQuantity);
    const cumulative = previous.add(period);
    if (period.isNegative()) throw new Error("A quantidade medida no período não pode ser negativa.");
    if (cumulative.greaterThan(contracted)) throw new Error("A quantidade acumulada excede a quantidade contratada; formalize aditivo ou exceção.");
    const amount = money(period.mul(line.unitPrice));
    gross = gross.add(amount);
    return { cumulativeQuantity: cumulative, remainingQuantity: contracted.sub(cumulative), amount };
  });
  gross = money(gross);
  const accumulated = money(new Decimal(input.previouslyMeasuredAmount).add(gross));
  if (accumulated.greaterThan(money(new Decimal(input.contractCurrentAmount).add(tolerance)))) {
    throw new Error("A medição acumulada excede o valor contratual disponível; formalize aditivo ou aprovação extraordinária.");
  }
  const retention = money(input.retentionAmount ?? 0);
  const discount = money(input.discountAmount ?? 0);
  const advance = money(input.advanceAmortizationAmount ?? 0);
  const net = money(gross.sub(retention).sub(discount).sub(advance));
  if (net.isNegative()) throw new Error("O valor líquido da medição não pode ser negativo.");
  return { grossAmount: gross, netAmount: net, accumulatedAmount: accumulated, lines: normalizedLines };
}

export function stageLedger(input: { budget: DecimalLike; contracted: DecimalLike; measured: DecimalLike; obligated: DecimalLike; paid: DecimalLike }) {
  const budget = money(input.budget);
  const contracted = money(input.contracted);
  const measured = money(input.measured);
  const obligated = money(input.obligated);
  const paid = money(input.paid);
  return {
    budget,
    contracted,
    balanceToContract: money(budget.sub(contracted)),
    measured,
    contractualBalance: money(contracted.sub(measured)),
    obligated,
    paid,
    measuredPayableBalance: money(obligated.sub(paid)),
    updatedProjection: Decimal.max(budget, contracted).toDecimalPlaces(2),
  };
}

const transitions = {
  requisition: {
    DRAFT: ["REQUESTED", "CANCELLED"], REQUESTED: ["IN_APPROVAL", "CANCELLED"], IN_APPROVAL: ["APPROVED_FOR_QUOTATION", "RETURNED", "CANCELLED"], RETURNED: ["DRAFT", "CANCELLED"], APPROVED_FOR_QUOTATION: ["IN_QUOTATION", "CANCELLED"], IN_QUOTATION: ["FULFILLED", "CANCELLED"], FULFILLED: [], CANCELLED: [],
  },
  contract: {
    DRAFT: ["UNDER_REVIEW", "CANCELLED"], UNDER_REVIEW: ["IN_APPROVAL", "DRAFT", "CANCELLED"], IN_APPROVAL: ["APPROVED", "UNDER_REVIEW", "CANCELLED"], APPROVED: ["ACTIVE", "CANCELLED"], ACTIVE: ["SUSPENDED", "CLOSED", "TERMINATED"], SUSPENDED: ["ACTIVE", "TERMINATED"], CLOSED: [], CANCELLED: [], TERMINATED: [],
  },
  measurement: {
    DRAFT: ["SUBMITTED", "CANCELLED"], SUBMITTED: ["IN_TECHNICAL_REVIEW", "RETURNED"], IN_TECHNICAL_REVIEW: ["TECHNICALLY_APPROVED", "RETURNED"], TECHNICALLY_APPROVED: ["IN_APPROVAL"], IN_APPROVAL: ["APPROVED", "RETURNED"], APPROVED: ["SENT_TO_FINANCE", "REVERSED"], SENT_TO_FINANCE: ["REVERSED"], RETURNED: ["DRAFT"], REVERSED: [], CANCELLED: [],
  },
} as const;

export function assertTransition(kind: keyof typeof transitions, from: string, to: string) {
  const allowed = (transitions[kind] as Record<string, readonly string[]>)[from] ?? [];
  if (!allowed.includes(to)) throw new Error(`Transição inválida de ${from} para ${to}.`);
}
