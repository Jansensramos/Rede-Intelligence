import Decimal from "decimal.js";

const money = (value: Decimal.Value) => new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const rate = (value: Decimal.Value) => new Decimal(value).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);

export type AllocationInput = {
  criterion: "PERCENTAGE" | "HOURS" | "FIXED_AMOUNT";
  allocationRate?: Decimal.Value | null;
  allocatedHours?: Decimal.Value | null;
  justification?: string | null;
};

export function assertValidDateRange(startDate: Date, endDate?: Date | null) {
  if (endDate && endDate < startDate) throw new Error("A data final não pode ser anterior à data inicial.");
}

export function assertNoHierarchyCycle(nodes: Array<{ id: string; parentId: string | null }>, id: string, parentId: string | null) {
  if (!parentId) return;
  if (id === parentId) throw new Error("Um departamento não pode ser pai de si próprio.");
  const parents = new Map(nodes.map((node) => [node.id, node.parentId]));
  let cursor: string | null | undefined = parentId;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor === id) throw new Error("A alteração criaria um ciclo na estrutura organizacional.");
    if (visited.has(cursor)) throw new Error("A estrutura organizacional existente contém um ciclo.");
    visited.add(cursor);
    cursor = parents.get(cursor);
  }
}

export function assertAllocationCapacity(existing: AllocationInput[], candidate: AllocationInput) {
  const all = [...existing, candidate];
  const rateTotal = all.filter((item) => item.criterion === "PERCENTAGE").reduce((sum, item) => sum.add(item.allocationRate ?? 0), new Decimal(0));
  const hoursTotal = all.filter((item) => item.criterion === "HOURS").reduce((sum, item) => sum.add(item.allocatedHours ?? 0), new Decimal(0));
  const overAllocated = rateTotal.gt(1) || hoursTotal.gt(220);
  if (overAllocated && (candidate.justification?.trim().length ?? 0) < 20) {
    throw new Error("Superalocação exige justificativa explícita com ao menos 20 caracteres.");
  }
  return { rateTotal: rate(rateTotal), hoursTotal: hoursTotal.toDecimalPlaces(2), overAllocated };
}

export function calculateRelationshipCost(input: {
  baseCost: Decimal.Value;
  burdenCost?: Decimal.Value;
  benefitsCost?: Decimal.Value;
  otherCost?: Decimal.Value;
}) {
  const components = [input.baseCost, input.burdenCost ?? 0, input.benefitsCost ?? 0, input.otherCost ?? 0].map(money);
  if (components.some((value) => value.isNegative())) throw new Error("Componentes de custo não podem ser negativos.");
  return { baseCost: components[0], burdenCost: components[1], benefitsCost: components[2], otherCost: components[3], totalCost: money(components.reduce((sum, value) => sum.add(value), new Decimal(0))) };
}

export function allocateAdministrativeCost(sourceAmount: Decimal.Value, drivers: Array<{ targetId: string; value: Decimal.Value }>) {
  const sourceCents = money(sourceAmount).mul(100).toDecimalPlaces(0).toNumber();
  if (sourceCents < 0) throw new Error("O valor a ratear não pode ser negativo.");
  if (!drivers.length) throw new Error("Informe ao menos um destino para o rateio.");
  const normalized = drivers.map((item) => ({ ...item, decimal: new Decimal(item.value) }));
  if (normalized.some((item) => item.decimal.isNegative())) throw new Error("Direcionadores de rateio não podem ser negativos.");
  const totalDriver = normalized.reduce((sum, item) => sum.add(item.decimal), new Decimal(0));
  if (totalDriver.lte(0)) throw new Error("A soma dos direcionadores deve ser maior que zero.");
  const provisional = normalized.map((item) => {
    const exact = new Decimal(sourceCents).mul(item.decimal).div(totalDriver);
    const floor = exact.floor();
    return { targetId: item.targetId, driverValue: item.decimal, rate: rate(item.decimal.div(totalDriver)), cents: floor.toNumber(), remainder: exact.minus(floor) };
  });
  const remaining = sourceCents - provisional.reduce((sum, item) => sum + item.cents, 0);
  provisional.sort((a, b) => b.remainder.comparedTo(a.remainder) || a.targetId.localeCompare(b.targetId));
  for (let index = 0; index < remaining; index += 1) provisional[index % provisional.length].cents += 1;
  const lines = provisional.sort((a, b) => a.targetId.localeCompare(b.targetId)).map((item) => ({ targetId: item.targetId, driverValue: item.driverValue, allocationRate: item.rate, allocatedAmount: money(new Decimal(item.cents).div(100)) }));
  const allocatedAmount = money(lines.reduce((sum, item) => sum.add(item.allocatedAmount), new Decimal(0)));
  const residualAmount = money(new Decimal(sourceAmount).minus(allocatedAmount));
  return { lines, sourceAmount: money(sourceAmount), allocatedAmount, residualAmount, proofZero: residualAmount.isZero() };
}

export type EfficiencyInput = {
  plannedAmount: Decimal.Value;
  committedAmount: Decimal.Value;
  measuredAmount: Decimal.Value;
  actualAmount: Decimal.Value;
  forecastAmount: Decimal.Value;
  plannedProgress: Decimal.Value;
  actualProgress: Decimal.Value;
  validatedSavingAmount?: Decimal.Value;
  validatedSavingConfirmed?: boolean;
};

export function calculateEfficiencyVariance(input: EfficiencyInput) {
  const planned = money(input.plannedAmount);
  const committed = money(input.committedAmount);
  const measured = money(input.measuredAmount);
  const actual = money(input.actualAmount);
  const forecast = money(input.forecastAmount);
  const plannedProgress = rate(input.plannedProgress);
  const actualProgress = rate(input.actualProgress);
  const cashVariance = money(planned.minus(actual));
  const commitmentVariance = money(planned.minus(actual.add(committed)));
  const physicalVariance = rate(actualProgress.minus(plannedProgress));
  const expectedCostAtProgress = money(planned.mul(actualProgress));
  const productivityVariance = money(expectedCostAtProgress.minus(actual));
  const validatedSavingAmount = input.validatedSavingConfirmed ? money(input.validatedSavingAmount ?? 0) : money(0);
  return {
    plannedAmount: planned,
    committedAmount: committed,
    measuredAmount: measured,
    actualAmount: actual,
    forecastAmount: forecast,
    plannedProgress,
    actualProgress,
    cashVariance,
    commitmentVariance,
    physicalVariance,
    expectedCostAtProgress,
    productivityVariance,
    forecastVariance: money(planned.minus(forecast)),
    savingEligible: validatedSavingAmount.gt(0),
    validatedSavingAmount,
    delayedExecution: actualProgress.lt(plannedProgress),
  };
}

export function assertRootCauseAllocation(allocations: Array<Decimal.Value>, closing = false) {
  const total = rate(allocations.reduce<Decimal>((sum, value) => sum.add(value), new Decimal(0)));
  if (allocations.some((value) => new Decimal(value).lte(0))) throw new Error("Cada causa deve ter contribuição maior que zero.");
  if (total.gt(1)) throw new Error("A contribuição das causas não pode superar 100%.");
  if (closing && !total.eq(1)) throw new Error("Para concluir a análise, as causas devem explicar exatamente 100% do desvio.");
  return total;
}

const actionTransitions: Record<string, string[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["BLOCKED", "COMPLETED", "CANCELLED"],
  BLOCKED: ["ACTIVE", "CANCELLED"],
  COMPLETED: ["VERIFIED", "ACTIVE"],
  VERIFIED: [],
  CANCELLED: [],
};

export function assertCorrectiveActionTransition(from: string, to: string) {
  if (!(actionTransitions[from] ?? []).includes(to)) throw new Error(`Transição de ação corretiva inválida: ${from} → ${to}.`);
}

const varianceTransitions: Record<string, string[]> = {
  UNCLASSIFIED: ["UNDER_ANALYSIS"],
  UNDER_ANALYSIS: ["CLASSIFIED"],
  CLASSIFIED: ["UNDER_ANALYSIS", "VALIDATED"],
  VALIDATED: ["UNDER_ANALYSIS", "CLOSED"],
  CLOSED: [],
};

export function assertPerformanceVarianceTransition(from: string, to: string) {
  if (!(varianceTransitions[from] ?? []).includes(to)) throw new Error(`Transição de caso de desvio inválida: ${from} → ${to}.`);
}

export function simulateIncentivePool(input: {
  validatedSavingAmount: Decimal.Value;
  validatedSavingConfirmed: boolean;
  implementationCost?: Decimal.Value;
  reversalAmount?: Decimal.Value;
  poolRate: Decimal.Value;
  reserveRate?: Decimal.Value;
  minimumPool?: Decimal.Value | null;
  maximumPool?: Decimal.Value | null;
}) {
  const poolRate = rate(input.poolRate);
  const reserveRate = rate(input.reserveRate ?? 0);
  if (poolRate.lt(0) || poolRate.gt(1) || reserveRate.lt(0) || reserveRate.gt(1)) throw new Error("Taxas da política devem estar entre 0% e 100%.");
  const saving = input.validatedSavingConfirmed ? money(input.validatedSavingAmount) : money(0);
  const eligibleBase = Decimal.max(0, saving.minus(input.implementationCost ?? 0).minus(input.reversalAmount ?? 0)).toDecimalPlaces(2);
  let pool = money(eligibleBase.mul(new Decimal(1).minus(reserveRate)).mul(poolRate));
  if (input.minimumPool != null && pool.gt(0)) pool = Decimal.max(pool, money(input.minimumPool)).toDecimalPlaces(2);
  if (input.maximumPool != null) pool = Decimal.min(pool, money(input.maximumPool)).toDecimalPlaces(2);
  return { validatedSavingAmount: saving, eligibleBase, simulatedPool: money(pool), payableAmount: money(0), isSimulationOnly: true };
}
