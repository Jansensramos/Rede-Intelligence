import Decimal from "decimal.js";
import { calculateProject } from "@/domain/financial/engine";
import type { FinancialResult, ProjectAssumptions, ScenarioKey } from "@/domain/financial/types";
import type { InvestmentSnapshotBundle, TransformationEconomicImpact } from "./types";

export interface DelayStressPoint {
  delayMonths: number;
  result: FinancialResult;
  deltaNpv: number;
  deltaExposure: number;
}

export interface LandValueCeilingResult {
  maximumLandPrice: number;
  bindingConstraint: "MARGIN" | "ROI" | "IRR" | "EXPOSURE" | "SEARCH_LIMIT";
  result: FinancialResult;
  iterations: number;
}

export interface ZoningValuePoint {
  far: number;
  units: number;
  vgv: number;
  npv: number;
  margin: number;
  incrementalNpv: number;
  diminishingReturn: boolean;
}

export interface DecisionTreeBranch {
  id: string;
  label: string;
  probability: number | null;
  npv: number;
  costToReach: number;
  evidenceRefs: string[];
}

export interface DecisionTreeResult {
  complete: boolean;
  expectedNpv: number | null;
  expectedNetValue: number | null;
  branches: DecisionTreeBranch[];
  warning: string | null;
}

export interface CriticalPathItem {
  id: string;
  title: string;
  durationMonths: number | null;
  dependencyIds: string[];
}

export interface CriticalPathResult {
  complete: boolean;
  durationMonths: number | null;
  pathIds: string[];
  missingDurationIds: string[];
  cycleDetected: boolean;
}

export function calculateTransformationEconomicImpact(
  bundle: InvestmentSnapshotBundle,
  includedCosts: number,
  evidenceRefs: string[],
): TransformationEconomicImpact {
  if (!Number.isFinite(includedCosts) || includedCosts < 0) throw new Error("Custos de transformação devem ser um valor não negativo.");
  const assumptions: ProjectAssumptions = {
    ...bundle.assumptions,
    landPrice: new Decimal(bundle.assumptions.landPrice).plus(includedCosts).toFixed(2),
  };
  return {
    includedCost: includedCosts,
    classification: "URBAN_TRANSFORMATION_COST",
    base: bundle.engineResults[bundle.scenario],
    adjusted: calculateProject(assumptions, bundle.scenario, bundle.frozenAt),
    evidenceRefs,
  };
}

export function calculateDelayStress(
  assumptions: ProjectAssumptions,
  scenario: ScenarioKey,
  delays: number[],
  calculatedAt: string,
): DelayStressPoint[] {
  const base = calculateProject(assumptions, scenario, calculatedAt);
  return [...new Set(delays)].sort((a, b) => a - b).map((delayMonths) => {
    if (!Number.isInteger(delayMonths) || delayMonths < 0) throw new Error("O atraso deve ser expresso em meses inteiros não negativos.");
    const result = calculateProject({ ...assumptions, approvalMonths: assumptions.approvalMonths + delayMonths }, scenario, calculatedAt);
    return {
      delayMonths,
      result,
      deltaNpv: Number(result.metrics.npv) - Number(base.metrics.npv),
      deltaExposure: Number(result.metrics.maximumCashExposure) - Number(base.metrics.maximumCashExposure),
    };
  });
}

export function calculateLandValueCeiling(
  assumptions: ProjectAssumptions,
  scenario: ScenarioKey,
  calculatedAt: string,
): LandValueCeilingResult {
  const policy = assumptions.policy;
  let low = 0;
  let high = Math.max(Number(assumptions.landPrice) * 4, Number(assumptions.landPrice) + Number(assumptions.unitPrice) * assumptions.units);
  let accepted = calculateProject({ ...assumptions, landPrice: "0" }, scenario, calculatedAt);
  let iterations = 0;
  for (; iterations < 64; iterations += 1) {
    const middle = (low + high) / 2;
    const result = calculateProject({ ...assumptions, landPrice: middle.toFixed(2) }, scenario, calculatedAt);
    if (passesPolicy(result, policy)) {
      low = middle;
      accepted = result;
    } else {
      high = middle;
    }
    if (high - low < 1) break;
  }
  return {
    maximumLandPrice: Math.floor(low),
    bindingConstraint: bindingConstraint(calculateProject({ ...assumptions, landPrice: high.toFixed(2) }, scenario, calculatedAt), policy),
    result: accepted,
    iterations: iterations + 1,
  };
}

export function buildZoningValueCurve(
  assumptions: ProjectAssumptions,
  scenario: ScenarioKey,
  landArea: number,
  farValues: number[],
  calculatedAt: string,
): ZoningValuePoint[] {
  if (landArea <= 0) throw new Error("Área do terreno deve ser positiva.");
  let previousNpv = Number.NEGATIVE_INFINITY;
  let previousIncrement = Number.POSITIVE_INFINITY;
  return [...new Set(farValues)].sort((a, b) => a - b).map((far) => {
    if (far <= 0) throw new Error("Coeficientes de aproveitamento devem ser positivos.");
    const computable = landArea * far;
    const units = Math.max(1, Math.floor((computable * Number(assumptions.efficiencyRate)) / Number(assumptions.privateAreaPerUnitM2)));
    const result = calculateProject({ ...assumptions, units, grossBuiltAreaM2: computable.toFixed(2) }, scenario, calculatedAt);
    const npv = Number(result.metrics.npv);
    const incrementalNpv = Number.isFinite(previousNpv) ? npv - previousNpv : 0;
    const point = {
      far,
      units,
      vgv: Number(result.metrics.vgv),
      npv,
      margin: Number(result.metrics.marginOnVgv),
      incrementalNpv,
      diminishingReturn: Number.isFinite(previousIncrement) && incrementalNpv < previousIncrement,
    };
    previousNpv = npv;
    previousIncrement = incrementalNpv;
    return point;
  });
}

export function calculateDecisionTree(branches: DecisionTreeBranch[]): DecisionTreeResult {
  const missing = branches.some((branch) => branch.probability === null);
  if (missing) return { complete: false, expectedNpv: null, expectedNetValue: null, branches, warning: "Probabilidades não informadas. Nenhuma probabilidade foi presumida." };
  const probabilityTotal = branches.reduce((total, branch) => total + (branch.probability ?? 0), 0);
  if (Math.abs(probabilityTotal - 1) > 0.000001) {
    return { complete: false, expectedNpv: null, expectedNetValue: null, branches, warning: "As probabilidades manuais devem totalizar 100%." };
  }
  return {
    complete: true,
    expectedNpv: branches.reduce((total, branch) => total + branch.npv * (branch.probability ?? 0), 0),
    expectedNetValue: branches.reduce((total, branch) => total + (branch.npv - branch.costToReach) * (branch.probability ?? 0), 0),
    branches,
    warning: null,
  };
}

export function calculateCriticalPath(items: CriticalPathItem[]): CriticalPathResult {
  const missingDurationIds = items.filter((item) => item.durationMonths === null).map((item) => item.id);
  if (missingDurationIds.length) return { complete: false, durationMonths: null, pathIds: [], missingDurationIds, cycleDetected: false };
  const byId = new Map(items.map((item) => [item.id, item]));
  const visiting = new Set<string>();
  const visited = new Map<string, { duration: number; path: string[] }>();
  let cycleDetected = false;
  const visit = (id: string): { duration: number; path: string[] } => {
    const cached = visited.get(id);
    if (cached) return cached;
    if (visiting.has(id)) {
      cycleDetected = true;
      return { duration: 0, path: [] };
    }
    visiting.add(id);
    const item = byId.get(id);
    if (!item) return { duration: 0, path: [] };
    const dependencyPaths = item.dependencyIds.map(visit);
    const longest = dependencyPaths.sort((a, b) => b.duration - a.duration)[0] ?? { duration: 0, path: [] };
    const value = { duration: longest.duration + (item.durationMonths ?? 0), path: [...longest.path, id] };
    visiting.delete(id);
    visited.set(id, value);
    return value;
  };
  const longest = items.map((item) => visit(item.id)).sort((a, b) => b.duration - a.duration)[0] ?? { duration: 0, path: [] };
  return { complete: !cycleDetected, durationMonths: cycleDetected ? null : longest.duration, pathIds: cycleDetected ? [] : longest.path, missingDurationIds: [], cycleDetected };
}

function passesPolicy(result: FinancialResult, policy: ProjectAssumptions["policy"]): boolean {
  return Number(result.metrics.marginOnVgv) * 100 >= Number(policy.minimumMarginRate)
    && result.metrics.roi !== null && Number(result.metrics.roi) * 100 >= Number(policy.minimumRoiRate)
    && result.metrics.annualIrr !== null && Number(result.metrics.annualIrr) * 100 >= Number(policy.minimumIrrRate)
    && Number(result.metrics.maximumCashExposure) <= Number(policy.maximumExposure);
}

function bindingConstraint(result: FinancialResult, policy: ProjectAssumptions["policy"]): LandValueCeilingResult["bindingConstraint"] {
  if (Number(result.metrics.marginOnVgv) * 100 < Number(policy.minimumMarginRate)) return "MARGIN";
  if (result.metrics.roi === null || Number(result.metrics.roi) * 100 < Number(policy.minimumRoiRate)) return "ROI";
  if (result.metrics.annualIrr === null || Number(result.metrics.annualIrr) * 100 < Number(policy.minimumIrrRate)) return "IRR";
  if (Number(result.metrics.maximumCashExposure) > Number(policy.maximumExposure)) return "EXPOSURE";
  return "SEARCH_LIMIT";
}
