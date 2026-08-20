export type MaterialityLevel = "INFORMATIVO" | "ATENCAO" | "RELEVANTE" | "CRITICO";

export interface EconomicValue {
  economicItemId: string;
  category: string;
  value: number;
}

export interface MaterialityBand {
  level: MaterialityLevel;
  minPercentage: number;
  maxPercentage?: number;
}

export interface BudgetBridgeRow {
  category: string;
  baseline: number;
  budget: number;
  difference: number;
  percentage: number | null;
  level: MaterialityLevel;
}

export interface PeriodAllocation {
  period: string;
  physicalPercentage: number;
  financialValue: number;
}

export interface ScheduleActivityInput {
  id: string;
  name: string;
  plannedCost: number;
  allocations: PeriodAllocation[];
}

export interface ScheduleDependencyInput {
  predecessorId: string;
  successorId: string;
  type: "FINISH_TO_START" | "START_TO_START" | "FINISH_TO_FINISH";
}

export interface CashFlowRow {
  period: string;
  inflow: number;
  outflow: number;
  net: number;
  accumulated: number;
}

export interface BudgetTreeItem { id: string; parentId: string | null; value: number }

export function calculateLaborCost(input: { headcount: number; monthlyCost: number; burdenRate: number; monthlyBenefits: number; months: number }) {
  if (Object.values(input).some((value) => !Number.isFinite(value) || value < 0)) throw new Error("A composição profissional contém valor inválido.");
  return roundMoney(input.headcount * input.months * (input.monthlyCost * (1 + input.burdenRate) + input.monthlyBenefits));
}

export function validateBudgetHierarchy(items: BudgetTreeItem[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  if (items.some((item) => item.value < 0)) return { valid: false, errors: ["A EAP contém valor negativo."] };
  const errors: string[] = [];
  for (const item of items) {
    if (item.parentId && !byId.has(item.parentId)) errors.push(`O item ${item.id} referencia pai inexistente.`);
    const visited = new Set([item.id]);
    let parentId = item.parentId;
    while (parentId) {
      if (visited.has(parentId)) { errors.push(`A hierarquia do item ${item.id} possui ciclo.`); break; }
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }
  const parents = new Set(items.flatMap((item) => item.parentId ? [item.parentId] : []));
  return { valid: errors.length === 0, errors, leafTotal: roundMoney(items.filter((item) => !parents.has(item.id)).reduce((sum, item) => sum + item.value, 0)) };
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const roundPercentage = (value: number) => Math.round((value + Number.EPSILON) * 10_000) / 10_000;

export const DEFAULT_MATERIALITY_BANDS: MaterialityBand[] = [
  { level: "INFORMATIVO", minPercentage: 0, maxPercentage: 2 },
  { level: "ATENCAO", minPercentage: 2, maxPercentage: 5 },
  { level: "RELEVANTE", minPercentage: 5, maxPercentage: 10 },
  { level: "CRITICO", minPercentage: 10 },
];

function groupValues(values: EconomicValue[]) {
  return values.reduce<Map<string, number>>((grouped, item) => {
    grouped.set(item.category, roundMoney((grouped.get(item.category) ?? 0) + item.value));
    return grouped;
  }, new Map());
}

export function materialityFor(percentage: number | null, bands = DEFAULT_MATERIALITY_BANDS): MaterialityLevel {
  if (percentage === null) return "CRITICO";
  const absolute = Math.abs(percentage);
  const ordered = [...bands].sort((a, b) => b.minPercentage - a.minPercentage);
  return ordered.find((band) => absolute >= band.minPercentage && (band.maxPercentage === undefined || absolute < band.maxPercentage))?.level ?? "INFORMATIVO";
}

export function buildBudgetBridge(baseline: EconomicValue[], budget: EconomicValue[], bands = DEFAULT_MATERIALITY_BANDS): BudgetBridgeRow[] {
  const baselineByCategory = groupValues(baseline);
  const budgetByCategory = groupValues(budget);
  return [...new Set([...baselineByCategory.keys(), ...budgetByCategory.keys()])]
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map((category) => {
      const base = baselineByCategory.get(category) ?? 0;
      const current = budgetByCategory.get(category) ?? 0;
      const difference = roundMoney(current - base);
      const percentage = base === 0 ? (current === 0 ? 0 : null) : roundPercentage((difference / base) * 100);
      return { category, baseline: base, budget: current, difference, percentage, level: materialityFor(percentage, bands) };
    });
}

export function distributeLinear(total: number, periods: string[]): PeriodAllocation[] {
  if (total < 0) throw new Error("O valor a distribuir não pode ser negativo.");
  if (periods.length === 0) throw new Error("Informe ao menos um período.");
  const baseValue = roundMoney(total / periods.length);
  const basePhysical = roundPercentage(100 / periods.length);
  let allocated = 0;
  let physical = 0;
  return periods.map((period, index) => {
    const last = index === periods.length - 1;
    const financialValue = last ? roundMoney(total - allocated) : baseValue;
    const physicalPercentage = last ? roundPercentage(100 - physical) : basePhysical;
    allocated = roundMoney(allocated + financialValue);
    physical = roundPercentage(physical + physicalPercentage);
    return { period, financialValue, physicalPercentage };
  });
}

export function distributeSCurve(total: number, periods: string[]): PeriodAllocation[] {
  if (total < 0) throw new Error("O valor a distribuir não pode ser negativo.");
  if (periods.length === 0) throw new Error("Informe ao menos um período.");
  const weights = periods.map((_, index) => {
    const position = (index + 0.5) / periods.length;
    return Math.exp(-Math.pow((position - 0.5) / 0.22, 2) / 2);
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let allocated = 0;
  let physical = 0;
  return periods.map((period, index) => {
    const last = index === periods.length - 1;
    const ratio = weights[index] / totalWeight;
    const financialValue = last ? roundMoney(total - allocated) : roundMoney(total * ratio);
    const physicalPercentage = last ? roundPercentage(100 - physical) : roundPercentage(100 * ratio);
    allocated = roundMoney(allocated + financialValue);
    physical = roundPercentage(physical + physicalPercentage);
    return { period, financialValue, physicalPercentage };
  });
}

export function validateScheduleIntegrity(activities: ScheduleActivityInput[], tolerance = 0.01) {
  const errors: string[] = [];
  for (const activity of activities) {
    if (activity.plannedCost < 0) errors.push(`${activity.name}: custo planejado negativo.`);
    const financial = roundMoney(activity.allocations.reduce((sum, item) => sum + item.financialValue, 0));
    const physical = roundPercentage(activity.allocations.reduce((sum, item) => sum + item.physicalPercentage, 0));
    if (Math.abs(financial - activity.plannedCost) > tolerance) errors.push(`${activity.name}: distribuição financeira difere do valor planejado.`);
    if (Math.abs(physical - 100) > 0.0001) errors.push(`${activity.name}: distribuição física deve totalizar 100%.`);
    if (activity.allocations.some((item) => item.financialValue < 0 || item.physicalPercentage < 0)) errors.push(`${activity.name}: distribuição contém valor negativo.`);
  }
  return { valid: errors.length === 0, errors };
}

export function validateDependencies(activityIds: string[], dependencies: ScheduleDependencyInput[]) {
  const known = new Set(activityIds);
  const graph = new Map(activityIds.map((id) => [id, [] as string[]]));
  for (const dependency of dependencies) {
    if (!known.has(dependency.predecessorId) || !known.has(dependency.successorId)) throw new Error("Dependência referencia atividade inexistente.");
    if (dependency.predecessorId === dependency.successorId) throw new Error("Uma atividade não pode depender de si mesma.");
    graph.get(dependency.predecessorId)?.push(dependency.successorId);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const successor of graph.get(id) ?? []) if (!visit(successor)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  return activityIds.every(visit);
}

export function buildProjectedCashFlow(activities: ScheduleActivityInput[], inflows: Record<string, number> = {}): CashFlowRow[] {
  const outflows = new Map<string, number>();
  for (const activity of activities) {
    for (const allocation of activity.allocations) outflows.set(allocation.period, roundMoney((outflows.get(allocation.period) ?? 0) + allocation.financialValue));
  }
  const periods = [...new Set([...outflows.keys(), ...Object.keys(inflows)])].sort();
  let accumulated = 0;
  return periods.map((period) => {
    const inflow = roundMoney(inflows[period] ?? 0);
    const outflow = roundMoney(outflows.get(period) ?? 0);
    const net = roundMoney(inflow - outflow);
    accumulated = roundMoney(accumulated + net);
    return { period, inflow, outflow, net, accumulated };
  });
}

export function scheduleIndicators(rows: CashFlowRow[], referencePeriod?: string) {
  const nextPeriods = referencePeriod ? rows.filter((row) => row.period >= referencePeriod).slice(0, 3) : rows.slice(0, 3);
  const peak = rows.reduce<CashFlowRow | null>((current, row) => (!current || row.outflow > current.outflow ? row : current), null);
  const total = roundMoney(rows.reduce((sum, row) => sum + row.outflow, 0));
  return {
    totalCost: total,
    next90Days: roundMoney(nextPeriods.reduce((sum, row) => sum + row.outflow, 0)),
    peakOutflow: peak?.outflow ?? 0,
    peakPeriod: peak?.period ?? null,
    durationMonths: rows.length,
    peakConcentrationPercentage: total === 0 ? 0 : roundPercentage(((peak?.outflow ?? 0) / total) * 100),
  };
}
