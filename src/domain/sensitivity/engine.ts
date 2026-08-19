import Decimal from "decimal.js";
import { calculateProject } from "@/domain/financial/engine";
import type { FinancialMetrics, FinancialResult, ProjectAssumptions, ScenarioKey } from "@/domain/financial/types";
import { analyzeRisk } from "@/domain/risk/rules";
import { calculateRedeScore, type ResilienceEvidence } from "@/domain/score";
import { SENSITIVITY_CONFIG_VERSION, SENSITIVITY_VARIABLES, STRESS_TESTS } from "./config";
import type {
  BreakEvenResult,
  SensitivityAdjustment,
  SensitivityCase,
  SensitivityMetrics,
  SensitivityRanking,
  SensitivityResult,
  SensitivityVariable,
  StressTestResult,
} from "./types";

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const percentPoints = (value: string | null) => value === null ? 0 : Number(value) * 100;

function multiply(value: string, rate: number) {
  return new Decimal(value).times(new Decimal(1).plus(rate)).toFixed(8);
}

function applyAdjustment(input: ProjectAssumptions, adjustment: SensitivityAdjustment): ProjectAssumptions {
  const next = structuredClone(input);
  switch (adjustment.variable) {
    case "SALE_PRICE":
      next.unitPrice = multiply(next.unitPrice, adjustment.variation);
      break;
    case "CONSTRUCTION_COST":
      next.constructionCostPerM2 = multiply(next.constructionCostPerM2, adjustment.variation);
      break;
    case "SALES_VELOCITY":
      next.salesVelocityUnitsMonth = Decimal.max("0.01", multiply(next.salesVelocityUnitsMonth, adjustment.variation)).toFixed(8);
      break;
    case "CONSTRUCTION_DURATION":
      next.constructionMonths = Math.max(1, next.constructionMonths + Math.round(adjustment.variation));
      break;
    case "FINANCING_COST":
      next.annualFinancingRate = Decimal.max(0, new Decimal(next.annualFinancingRate).plus(adjustment.variation)).toFixed(8);
      break;
    case "LAND_COST":
      next.landPrice = multiply(next.landPrice, adjustment.variation);
      break;
    case "COMMERCIAL_EXPENSES":
      next.commissionRate = multiply(next.commissionRate, adjustment.variation);
      next.marketingRate = multiply(next.marketingRate, adjustment.variation);
      break;
    case "SALES_START_DELAY":
      next.salesStartDelayMonths = Math.max(0, next.salesStartDelayMonths + Math.round(adjustment.variation));
      break;
  }
  return next;
}

function applyAdjustments(input: ProjectAssumptions, adjustments: SensitivityAdjustment[]) {
  return adjustments.reduce(applyAdjustment, structuredClone(input));
}

function baseValue(input: ProjectAssumptions, variable: SensitivityVariable): string | number {
  switch (variable) {
    case "SALE_PRICE": return input.unitPrice;
    case "CONSTRUCTION_COST": return input.constructionCostPerM2;
    case "SALES_VELOCITY": return input.salesVelocityUnitsMonth;
    case "CONSTRUCTION_DURATION": return input.constructionMonths;
    case "FINANCING_COST": return input.annualFinancingRate;
    case "LAND_COST": return input.landPrice;
    case "COMMERCIAL_EXPENSES": return new Decimal(input.commissionRate).plus(input.marketingRate).toFixed(8);
    case "SALES_START_DELAY": return input.salesStartDelayMonths;
  }
}

function relevantMetrics(metrics: FinancialMetrics): SensitivityMetrics {
  return {
    vgv: metrics.vgv,
    marginOnVgv: metrics.marginOnVgv,
    profit: metrics.profit,
    roi: metrics.roi,
    annualIrr: metrics.annualIrr,
    npv: metrics.npv,
    maximumCashExposure: metrics.maximumCashExposure,
    equityCapitalRequired: metrics.equityCapitalRequired,
    fundingNeed: metrics.fundingNeed,
  };
}

function policyViolations(result: FinancialResult) {
  const violations: string[] = [];
  const { metrics, assumptions } = result;
  if (percentPoints(metrics.marginOnVgv) < Number(assumptions.policy.minimumMarginRate)) violations.push("Margem abaixo da política");
  if (metrics.roi === null || percentPoints(metrics.roi) < Number(assumptions.policy.minimumRoiRate)) violations.push("ROI abaixo da política");
  if (metrics.annualIrr === null || percentPoints(metrics.annualIrr) < Number(assumptions.policy.minimumIrrRate)) violations.push("TIR abaixo da política");
  if (new Decimal(metrics.maximumCashExposure).gt(assumptions.policy.maximumExposure)) violations.push("Exposição acima da política");
  if (new Decimal(assumptions.contingencyRate).lt(assumptions.policy.minimumContingencyRate)) violations.push("Contingência abaixo da política");
  if (new Decimal(metrics.npv).lt(0)) violations.push("VPL negativo");
  if (new Decimal(metrics.profit).lt(0)) violations.push("Lucro negativo");
  return violations;
}

function resilienceEvidence(base: FinancialResult, stressResults: FinancialResult[]): ResilienceEvidence {
  const margin = percentPoints(base.metrics.marginOnVgv);
  const roi = percentPoints(base.metrics.roi);
  const irr = percentPoints(base.metrics.annualIrr);
  const exposure = Math.max(Number(base.metrics.maximumCashExposure), 1);
  const losses = stressResults.map((result) => ({
    margin: Math.max(0, margin - percentPoints(result.metrics.marginOnVgv)),
    roi: Math.max(0, roi - percentPoints(result.metrics.roi)),
    irr: Math.max(0, irr - percentPoints(result.metrics.annualIrr)),
    exposure: Math.max(0, Number(result.metrics.maximumCashExposure) / exposure - 1),
    violations: policyViolations(result),
  }));
  const moderate = stressResults[0];
  const criticalFactors = losses
    .flatMap((loss, index) => loss.violations.map((violation) => `${STRESS_TESTS[index].label}: ${violation}.`))
    .slice(0, 4);
  return {
    worstMarginLossPoints: round(Math.max(...losses.map((item) => item.margin), 0)),
    worstRoiLossPoints: round(Math.max(...losses.map((item) => item.roi), 0)),
    worstIrrLossPoints: round(Math.max(...losses.map((item) => item.irr), 0)),
    worstExposureIncreaseRate: round(Math.max(...losses.map((item) => item.exposure), 0), 4),
    stressPolicyBreaks: losses.filter((item) => item.violations.length > 0).length,
    totalStressCases: stressResults.length,
    criticalStressCount: stressResults.filter((result) => Number(result.metrics.npv) < 0 || Number(result.metrics.profit) < 0).length,
    basicStressInsolvent: Number(moderate.metrics.npv) < 0 || Number(moderate.metrics.profit) < 0,
    criticalFactors,
  };
}

function breakEvenByRate(
  input: ProjectAssumptions,
  scenario: ScenarioKey,
  variable: "SALE_PRICE" | "CONSTRUCTION_COST" | "SALES_VELOCITY",
  label: string,
  maximum: number,
  passes: (result: FinancialResult) => boolean,
  calculatedAt: string,
): BreakEvenResult {
  const base = calculateProject(input, scenario, calculatedAt);
  if (!passes(base)) return { key: variable, label, variable, value: 0, unit: "RATE", status: "BASE_FAILS_POLICY", iterations: 0 };
  const sign = variable === "CONSTRUCTION_COST" ? 1 : -1;
  const extreme = calculateProject(applyAdjustment(input, { variable, label, variation: maximum * sign, variationUnit: "RATE" }), scenario, calculatedAt);
  if (passes(extreme)) return { key: variable, label, variable, value: maximum, unit: "RATE", status: "NOT_REACHED", iterations: 1 };
  let low = 0;
  let high = maximum;
  const iterations = 28;
  for (let index = 0; index < iterations; index += 1) {
    const middle = (low + high) / 2;
    const stressed = calculateProject(applyAdjustment(input, { variable, label, variation: middle * sign, variationUnit: "RATE" }), scenario, calculatedAt);
    if (passes(stressed)) low = middle;
    else high = middle;
  }
  return { key: variable, label, variable, value: round(low, 6), unit: "RATE", status: "FOUND", iterations };
}

function delayBreakEven(input: ProjectAssumptions, scenario: ScenarioKey, calculatedAt: string): BreakEvenResult {
  const label = "Atraso máximo no início das vendas com VPL não negativo";
  const passes = (months: number) => Number(calculateProject(applyAdjustment(input, { variable: "SALES_START_DELAY", label, variation: months, variationUnit: "MONTHS" }), scenario, calculatedAt).metrics.npv) >= 0;
  if (!passes(0)) return { key: "SALES_START_DELAY", label, variable: "SALES_START_DELAY", value: 0, unit: "MONTHS", status: "BASE_FAILS_POLICY", iterations: 0 };
  if (passes(36)) return { key: "SALES_START_DELAY", label, variable: "SALES_START_DELAY", value: 36, unit: "MONTHS", status: "NOT_REACHED", iterations: 1 };
  let low = 0;
  let high = 36;
  let iterations = 0;
  while (low + 1 < high) {
    iterations += 1;
    const middle = Math.floor((low + high) / 2);
    if (passes(middle)) low = middle;
    else high = middle;
  }
  return { key: "SALES_START_DELAY", label, variable: "SALES_START_DELAY", value: low, unit: "MONTHS", status: "FOUND", iterations };
}

function breakEvens(input: ProjectAssumptions, scenario: ScenarioKey, calculatedAt: string): BreakEvenResult[] {
  const marginPasses = (result: FinancialResult) => percentPoints(result.metrics.marginOnVgv) >= Number(result.assumptions.policy.minimumMarginRate);
  const exposurePasses = (result: FinancialResult) => new Decimal(result.metrics.maximumCashExposure).lte(result.assumptions.policy.maximumExposure);
  return [
    breakEvenByRate(input, scenario, "SALE_PRICE", "Redução máxima de preço mantendo a margem mínima", 0.50, marginPasses, calculatedAt),
    breakEvenByRate(input, scenario, "CONSTRUCTION_COST", "Aumento máximo de obra mantendo a margem mínima", 1, marginPasses, calculatedAt),
    delayBreakEven(input, scenario, calculatedAt),
    breakEvenByRate(input, scenario, "SALES_VELOCITY", "Redução máxima da velocidade respeitando a exposição", 0.90, exposurePasses, calculatedAt),
  ];
}

export function calculateSensitivity(
  input: ProjectAssumptions,
  scenario: ScenarioKey = "base",
  calculatedAt = new Date().toISOString(),
): SensitivityResult {
  const base = calculateProject(input, scenario, calculatedAt);
  const stressFinancials = STRESS_TESTS.map((stress) => calculateProject(applyAdjustments(input, stress.adjustments), scenario, calculatedAt));
  const resilience = resilienceEvidence(base, stressFinancials);
  const baseScore = calculateRedeScore({ result: base, resilience });

  const cases: SensitivityCase[] = SENSITIVITY_VARIABLES.flatMap((config) => config.variations.map((variation) => {
    const adjustment = { variable: config.variable, label: config.label, variation, variationUnit: config.unit };
    const changedInput = applyAdjustment(input, adjustment);
    const result = calculateProject(changedInput, scenario, calculatedAt);
    const score = calculateRedeScore({ result, resilience });
    return {
      ...adjustment,
      baseValue: baseValue(input, config.variable),
      stressedValue: baseValue(changedInput, config.variable),
      metrics: relevantMetrics(result.metrics),
      policyViolations: policyViolations(result),
      score: score.totalScore,
      classification: score.classification,
      scoreDelta: score.totalScore - baseScore.totalScore,
    };
  }));

  const stresses: StressTestResult[] = STRESS_TESTS.map((stress, index) => {
    const result = stressFinancials[index];
    const score = calculateRedeScore({ result, resilience });
    const recommendation = analyzeRisk(result);
    return {
      key: stress.key,
      label: stress.label,
      adjustments: stress.adjustments,
      metrics: relevantMetrics(result.metrics),
      violatedPolicies: policyViolations(result),
      score: score.totalScore,
      classification: score.classification,
      scoreDelta: score.totalScore - baseScore.totalScore,
      recommendationStatus: recommendation.status,
      recommendationLabel: recommendation.label,
    };
  });

  const ranking: SensitivityRanking[] = SENSITIVITY_VARIABLES.map((config) => {
    const variableCases = cases.filter((item) => item.variable === config.variable);
    const worstScore = Math.min(...variableCases.map((item) => item.score));
    const worstNpv = Math.min(...variableCases.map((item) => Number(item.metrics.npv)));
    return {
      variable: config.variable,
      label: config.label,
      scoreImpact: baseScore.totalScore - worstScore,
      npvImpact: round(Number(base.metrics.npv) - worstNpv),
    };
  }).sort((left, right) => right.scoreImpact - left.scoreImpact || right.npvImpact - left.npvImpact || left.label.localeCompare(right.label));

  return {
    configVersion: SENSITIVITY_CONFIG_VERSION,
    scenario,
    calculatedAt,
    baseScore,
    cases,
    stresses,
    breakEvens: breakEvens(input, scenario, calculatedAt),
    ranking,
    resilience,
  };
}
