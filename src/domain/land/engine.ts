import { calculateProject } from "@/domain/financial/engine";
import type { ProjectAssumptions } from "@/domain/financial/types";
import { calculateRedeScore, type ResilienceEvidence } from "@/domain/score";
import { calculateBuildableEnvelope } from "./envelope";
import { calculateAreaSchedule, generateMassing, productUnits, validateProductAgainstEnvelope, weightedUnitPrice } from "./product";
import { markParetoFrontier, rankLandOptions } from "./solver";
import type { LandAsset, LandOption, OptimizationObjective, ProductStrategy, RegulatoryConfidence, UrbanParameters, UrbanScenario, UrbanSource } from "./types";

export interface LandFinancialTemplate {
  landPrice: number;
  constructionCostPerM2: number;
  indirectCostsRate: number;
  contingencyRate: number;
  taxRate: number;
  commissionRate: number;
  marketingRate: number;
  approvalMonths: number;
  constructionMonths: number;
  financingLimit: number;
  annualFinancingRate: number;
  annualDiscountRate: number;
  policy: ProjectAssumptions["policy"];
}

export interface UrbanScenarioOverrides {
  zoningCode?: string;
  zoningName?: string;
  permittedUses?: string[];
  maximumFAR?: number;
  occupancyRate?: number;
  permeabilityRate?: number;
  maximumHeight?: number;
  maximumFloors?: number;
  frontSetback?: number;
  rearSetback?: number;
  sideSetback?: number;
  betweenBuildings?: number;
  parkingRequirement?: number;
  residentialDensity?: number;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function manual<T>(value: T, notes = "Parâmetro do cenário urbanístico simulado.") {
  return { value, sourceId: "BARUERI_MANUAL_PARCEL", confidence: "MANUAL" as const, notes };
}

export function createSimulatedScenario(current: UrbanScenario, id: string, name: string, overrides: UrbanScenarioOverrides, type: UrbanScenario["type"] = "PROPOSED"): UrbanScenario {
  const scenario = clone(current);
  scenario.id = id;
  scenario.name = name;
  scenario.type = type;
  scenario.status = "PRELIMINARY";
  scenario.isHypothetical = true;
  scenario.disclaimer = "Os parâmetros deste cenário são hipotéticos e não representam direito construtivo adquirido, dependendo de alteração legislativa, aprovações e validações pelos órgãos competentes.";
  scenario.sourceIds = Array.from(new Set([...scenario.sourceIds, "BARUERI_MANUAL_PARCEL", "LAND_DERIVED"]));
  const parameters = scenario.parameters;
  if (overrides.zoningCode !== undefined) parameters.zoningCode = manual(overrides.zoningCode);
  if (overrides.zoningName !== undefined) parameters.zoningName = manual(overrides.zoningName);
  if (overrides.permittedUses !== undefined) parameters.permittedUses = manual(overrides.permittedUses);
  if (overrides.maximumFAR !== undefined) parameters.maximumFAR = manual(overrides.maximumFAR);
  if (overrides.occupancyRate !== undefined) parameters.occupancyRate = manual(overrides.occupancyRate);
  if (overrides.permeabilityRate !== undefined) parameters.permeabilityRate = manual(overrides.permeabilityRate);
  if (overrides.maximumHeight !== undefined) parameters.maximumHeight = manual(overrides.maximumHeight);
  if (overrides.maximumFloors !== undefined) parameters.maximumFloors = manual(overrides.maximumFloors);
  if (overrides.parkingRequirement !== undefined) parameters.parkingRequirement = manual(overrides.parkingRequirement);
  if (overrides.residentialDensity !== undefined) parameters.residentialDensity = manual(overrides.residentialDensity);
  parameters.setbacks = manual({
    front: overrides.frontSetback ?? parameters.setbacks.value.front,
    rear: overrides.rearSetback ?? parameters.setbacks.value.rear,
    side: overrides.sideSetback ?? parameters.setbacks.value.side,
    betweenBuildings: overrides.betweenBuildings ?? parameters.setbacks.value.betweenBuildings,
  });
  return scenario;
}

export function landOptionToAssumptions(asset: LandAsset, optionName: string, product: ProductStrategy, grossBuiltArea: number, template: LandFinancialTemplate): ProjectAssumptions {
  const units = productUnits(product);
  const unitPrice = weightedUnitPrice(product);
  return {
    projectName: optionName,
    city: asset.city,
    state: asset.state,
    landAreaM2: asset.area.toFixed(4),
    units,
    privateAreaPerUnitM2: product.averageUnitArea.toFixed(4),
    grossBuiltAreaM2: grossBuiltArea.toFixed(4),
    efficiencyRate: product.targetEfficiency.toFixed(4),
    unitPrice: unitPrice.toFixed(2),
    landPrice: template.landPrice.toFixed(2),
    constructionCostPerM2: template.constructionCostPerM2.toFixed(2),
    indirectCostsRate: template.indirectCostsRate.toFixed(4),
    contingencyRate: template.contingencyRate.toFixed(4),
    taxRate: template.taxRate.toFixed(4),
    commissionRate: template.commissionRate.toFixed(4),
    marketingRate: template.marketingRate.toFixed(4),
    approvalMonths: template.approvalMonths,
    constructionMonths: template.constructionMonths,
    salesVelocityUnitsMonth: Math.max(4, Math.ceil(units / 42)).toString(),
    salesStartDelayMonths: 0,
    downPaymentRate: "10",
    duringConstructionRate: "30",
    onDeliveryRate: "60",
    financingLimit: template.financingLimit.toFixed(2),
    annualFinancingRate: template.annualFinancingRate.toFixed(4),
    annualDiscountRate: template.annualDiscountRate.toFixed(4),
    policy: template.policy,
  };
}

function calculateLandResilience(assumptions: ProjectAssumptions, calculatedAt: string): ResilienceEvidence {
  const base = calculateProject(assumptions, "base", calculatedAt);
  const stressAssumptions: ProjectAssumptions = {
    ...assumptions,
    unitPrice: (Number(assumptions.unitPrice) * 0.9).toFixed(2),
    constructionCostPerM2: (Number(assumptions.constructionCostPerM2) * 1.1).toFixed(2),
    salesStartDelayMonths: assumptions.salesStartDelayMonths + 6,
  };
  const stress = calculateProject(stressAssumptions, "base", calculatedAt);
  const marginLoss = Math.max(0, (Number(base.metrics.marginOnVgv) - Number(stress.metrics.marginOnVgv)) * 100);
  const roiLoss = Math.max(0, (Number(base.metrics.roi ?? 0) - Number(stress.metrics.roi ?? 0)) * 100);
  const irrLoss = Math.max(0, (Number(base.metrics.annualIrr ?? 0) - Number(stress.metrics.annualIrr ?? 0)) * 100);
  const baseExposure = Math.max(1, Number(base.metrics.maximumCashExposure));
  const exposureIncrease = Math.max(0, (Number(stress.metrics.maximumCashExposure) - baseExposure) / baseExposure);
  const policyBreaks = Number(stress.metrics.marginOnVgv) * 100 < Number(assumptions.policy.minimumMarginRate)
    || Number(stress.metrics.maximumCashExposure) > Number(assumptions.policy.maximumExposure)
    || Number(stress.metrics.npv) < 0 ? 1 : 0;
  const insolvent = Number(stress.metrics.profit) < 0 || Number(stress.metrics.npv) < 0;
  return {
    worstMarginLossPoints: marginLoss,
    worstRoiLossPoints: roiLoss,
    worstIrrLossPoints: irrLoss,
    worstExposureIncreaseRate: exposureIncrease,
    stressPolicyBreaks: policyBreaks,
    totalStressCases: 1,
    criticalStressCount: insolvent ? 1 : 0,
    basicStressInsolvent: insolvent,
    criticalFactors: policyBreaks ? ["Stress Land padronizado: preço -10%, obra +10% e vendas +6 meses rompe ao menos uma política."] : [],
  };
}

export function evaluateLandOption(input: {
  id: string;
  name: string;
  asset: LandAsset;
  scenario: UrbanScenario;
  product: ProductStrategy;
  massingType: LandOption["massingType"];
  financialTemplate: LandFinancialTemplate;
  calculatedAt?: string;
}): LandOption {
  const envelope = calculateBuildableEnvelope(input.asset, input.scenario);
  const areaSchedule = calculateAreaSchedule(input.asset, envelope, input.product);
  const { massing, masterplan } = generateMassing(input.asset, envelope, input.product, input.massingType);
  const assumptions = landOptionToAssumptions(input.asset, input.name, input.product, areaSchedule.totalBuiltArea, input.financialTemplate);
  const calculatedAt = input.calculatedAt ?? new Date().toISOString();
  const financialResult = calculateProject(assumptions, "base", calculatedAt);
  const score = calculateRedeScore({ result: financialResult, resilience: calculateLandResilience(assumptions, calculatedAt) });
  const warnings = validateProductAgainstEnvelope(areaSchedule, input.product, envelope, input.scenario.parameters.parkingRequirement.value);
  return { id: input.id, name: input.name, scenarioId: input.scenario.id, massingType: input.massingType, product: input.product, masterplan, envelope, massing, areaSchedule, engineAssumptions: assumptions, financialResult, score, warnings, rank: 0, paretoEfficient: false };
}

export function finalizeLandOptions(options: LandOption[], objective: OptimizationObjective = "BALANCED") {
  return rankLandOptions(markParetoFrontier(options), objective);
}

function parameterValues(parameters: UrbanParameters) {
  return [parameters.minimumLotArea, parameters.minimumFrontage, parameters.basicFAR, parameters.maximumFAR, parameters.occupancyRate, parameters.permeabilityRate, parameters.maximumHeight, parameters.maximumFloors, parameters.parkingRequirement, parameters.residentialDensity];
}

export function calculateRegulatoryConfidence(scenario: UrbanScenario, sources: UrbanSource[]): RegulatoryConfidence {
  const values = parameterValues(scenario.parameters);
  const complete = values.filter((entry) => entry.value !== null).length;
  const completeness = complete / values.length * 100;
  const weights = { CONFIRMED: 100, HIGH: 85, MEDIUM: 65, LOW: 35, MANUAL: 45 } as const;
  const referenced = sources.filter((source) => scenario.sourceIds.includes(source.id));
  const sourceQuality = referenced.length ? referenced.reduce((sum, source) => sum + weights[source.confidence], 0) / referenced.length : 0;
  const score = Math.round(completeness * 0.45 + sourceQuality * 0.55);
  return {
    score,
    label: score >= 85 ? "ALTA CONFIANÇA" : score >= 55 ? "VERIFICAÇÃO COMPLEMENTAR NECESSÁRIA" : "BAIXA CONFIANÇA",
    completeness,
    sourceQuality,
    missing: values.map((entry, index) => entry.value === null ? ["Área mínima", "Frente mínima", "CA básico", "CA máximo", "TO", "Permeabilidade", "Altura", "Pavimentos", "Vagas", "Densidade"][index] : null).filter((value): value is string => value !== null),
  };
}
