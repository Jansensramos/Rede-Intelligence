import type { ConfidenceLevel, LaunchRecommendation, LaunchTriggerOperator } from "@prisma/client";
import { macroIndicator } from "./registry";

export const LAUNCH_ENGINE_VERSION = "9O.1.0";
export type FreshnessStatus = "UPDATED" | "AGING" | "STALE" | "NO_EVIDENCE";

export interface FreshnessInput { referenceDate?: Date | string | null; expectedFreshnessDays: number; asOf?: Date | string; }
export function evaluateFreshness(input: FreshnessInput): { status: FreshnessStatus; ageDays: number | null } {
  if (!input.referenceDate) return { status: "NO_EVIDENCE", ageDays: null };
  const asOf = input.asOf ? new Date(input.asOf) : new Date();
  const ageDays = Math.max(0, Math.floor((asOf.getTime() - new Date(input.referenceDate).getTime()) / 86_400_000));
  if (ageDays <= input.expectedFreshnessDays) return { status: "UPDATED", ageDays };
  if (ageDays <= input.expectedFreshnessDays * 1.5) return { status: "AGING", ageDays };
  return { status: "STALE", ageDays };
}

export function normalizeMacroValue(input: { code: string; rawValue: number; rawUnit: string; normalizationKey: string }) {
  const definition = macroIndicator(input.code);
  if (!definition) throw new Error(`Indicador macroeconômico não cadastrado no catálogo: ${input.code}.`);
  if (!Number.isFinite(input.rawValue)) throw new Error("O valor do indicador precisa ser finito.");
  if (input.normalizationKey === "IDENTITY") {
    if (input.rawUnit !== definition.unit) throw new Error(`Unidade incompatível. ${definition.label} exige ${definition.unit}.`);
    return { normalizedValue: input.rawValue, canonicalUnit: definition.unit, metadata: { method: "IDENTITY" } };
  }
  if (input.normalizationKey === "MONTHLY_EFFECTIVE_TO_ANNUAL_EFFECTIVE" && definition.type === "RATE" && input.rawUnit === "% a.m.") {
    return { normalizedValue: (Math.pow(1 + input.rawValue / 100, 12) - 1) * 100, canonicalUnit: definition.unit, metadata: { method: input.normalizationKey } };
  }
  throw new Error(`Normalização não suportada para ${input.code}: ${input.normalizationKey}.`);
}

export interface PreferredObservation<T> {
  observation: T | null;
  reason: "ORGANIZATION" | "GLOBAL" | "NO_EVIDENCE";
}

export function selectPreferredObservation<T extends { organizationId?: string | null; freshness: FreshnessStatus; regionCompatible: boolean }>(observations: T[]): PreferredObservation<T> {
  const eligible = observations.filter((item) => item.regionCompatible && (item.freshness === "UPDATED" || item.freshness === "AGING"));
  return { observation: eligible.find((item) => Boolean(item.organizationId)) ?? eligible.find((item) => !item.organizationId) ?? null, reason: eligible.some((item) => Boolean(item.organizationId)) ? "ORGANIZATION" : eligible.some((item) => !item.organizationId) ? "GLOBAL" : "NO_EVIDENCE" };
}

export interface LaunchDecisionFactors {
  marginPercentage: number | null;
  minimumMarginPercentage: number | null;
  affordabilityRatioPercentage: number | null;
  vsoPercentage: number | null;
  monthsOfStock: number | null;
  constructionInflationPercentage: number | null;
  criticalEvidenceMissing: string[];
}

export interface LaunchRecommendationResult {
  recommendation: LaunchRecommendation;
  confidenceLevel: ConfidenceLevel;
  confidenceScore: number;
  favorableFactors: string[];
  unfavorableFactors: string[];
  criticalFactors: string[];
  missingEvidence: string[];
  conditionsForChange: string[];
}

export function recommendLaunch(input: LaunchDecisionFactors): LaunchRecommendationResult {
  const favorable: string[] = [];
  const unfavorable: string[] = [];
  const critical: string[] = [];
  const missing = [...new Set(input.criticalEvidenceMissing)];
  const conditions: string[] = [];

  if (input.marginPercentage == null || input.minimumMarginPercentage == null) missing.push("Margem oficial do empreendimento");
  else if (input.marginPercentage >= input.minimumMarginPercentage + 5) favorable.push(`Margem de ${input.marginPercentage.toFixed(1)}% acima da política.`);
  else if (input.marginPercentage >= input.minimumMarginPercentage) unfavorable.push(`Margem de ${input.marginPercentage.toFixed(1)}% próxima do limite.`);
  else { critical.push(`Margem de ${input.marginPercentage.toFixed(1)}% abaixo do mínimo de ${input.minimumMarginPercentage.toFixed(1)}%.`); conditions.push(`Margem voltar a pelo menos ${input.minimumMarginPercentage.toFixed(1)}%.`); }

  if (input.affordabilityRatioPercentage == null) missing.push("Compatibilidade do ticket com a renda");
  else if (input.affordabilityRatioPercentage <= 100) favorable.push("Ticket compatível com a capacidade aproximada de compra local.");
  else if (input.affordabilityRatioPercentage <= 115) unfavorable.push("Capacidade de compra local pressionada.");
  else { critical.push("Ticket muito acima da capacidade aproximada de compra local."); conditions.push("Revisar produto/preço ou recuperar compatibilidade com a renda."); }

  if (input.vsoPercentage == null) missing.push("VSO local");
  else if (input.vsoPercentage >= 6) favorable.push(`VSO local de ${input.vsoPercentage.toFixed(1)}% favorece absorção.`);
  else if (input.vsoPercentage >= 3) unfavorable.push(`VSO local de ${input.vsoPercentage.toFixed(1)}% exige cautela.`);
  else { critical.push(`VSO local de ${input.vsoPercentage.toFixed(1)}% indica absorção fraca.`); conditions.push("VSO local superar 3,0%."); }

  if (input.monthsOfStock != null && input.monthsOfStock > 24) { critical.push(`Estoque equivalente a ${input.monthsOfStock.toFixed(1)} meses.`); conditions.push("Estoque regional cair abaixo de 24 meses."); }
  else if (input.monthsOfStock != null && input.monthsOfStock <= 12) favorable.push("Estoque regional baixo.");
  if (input.constructionInflationPercentage != null && input.constructionInflationPercentage > 10) unfavorable.push("Inflação de construção elevada pressiona custo e margem.");

  const uniqueMissing = [...new Set(missing)];
  const confidenceScore = Math.max(0, Math.min(1, (4 - uniqueMissing.length) / 4));
  const confidenceLevel: ConfidenceLevel = confidenceScore >= 0.75 ? "HIGH" : confidenceScore >= 0.5 ? "MEDIUM" : "LOW";
  let recommendation: LaunchRecommendation;
  if (uniqueMissing.length > 0) recommendation = "INSUFFICIENT_EVIDENCE";
  else if (critical.some((factor) => factor.includes("Ticket muito"))) recommendation = "REVIEW_PRODUCT_PRICE";
  else if (critical.length >= 2) recommendation = "WAIT";
  else if (critical.length === 1) recommendation = "PHASE";
  else if (unfavorable.length > 0) recommendation = "LAUNCH_WITH_CONDITIONS";
  else recommendation = "FAVORABLE_TO_LAUNCH";
  if (conditions.length === 0 && recommendation !== "FAVORABLE_TO_LAUNCH") conditions.push("Atualizar os dados críticos e recalcular o cenário.");
  return { recommendation, confidenceLevel, confidenceScore, favorableFactors: favorable, unfavorableFactors: unfavorable, criticalFactors: critical, missingEvidence: uniqueMissing, conditionsForChange: conditions };
}

const confidenceRank: Record<ConfidenceLevel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
export function evaluateLaunchTrigger(input: { operator: LaunchTriggerOperator; value: number | null; threshold: number; thresholdEnd?: number | null; unit: string; actualUnit?: string | null; freshness: FreshnessStatus; confidenceLevel?: ConfidenceLevel | null; minimumConfidence?: ConfidenceLevel | null }) {
  if (input.value == null || input.freshness === "STALE" || input.freshness === "NO_EVIDENCE") return { matched: false, eligible: false, reason: "SEM EVIDÊNCIA ATUALIZADA" };
  if (input.actualUnit !== input.unit) return { matched: false, eligible: false, reason: "UNIDADE INCOMPATÍVEL" };
  if (input.minimumConfidence && (!input.confidenceLevel || confidenceRank[input.confidenceLevel] < confidenceRank[input.minimumConfidence])) return { matched: false, eligible: false, reason: "CONFIANÇA INSUFICIENTE" };
  const end = input.thresholdEnd ?? input.threshold;
  const matched = input.operator === "LT" ? input.value < input.threshold : input.operator === "LTE" ? input.value <= input.threshold : input.operator === "GT" ? input.value > input.threshold : input.operator === "GTE" ? input.value >= input.threshold : input.value >= input.threshold && input.value <= end;
  return { matched, eligible: true, reason: matched ? "LIMITE ATINGIDO" : "LIMITE NÃO ATINGIDO" };
}

export function macroScenarioAdjustments(kind: "BASE" | "FAVORABLE" | "STRESSED") {
  if (kind === "FAVORABLE") return { priceRate: 1.03, salesVelocityRate: 1.2, constructionCostRate: 0.97, fundingRateDeltaPercentagePoints: -1 };
  if (kind === "STRESSED") return { priceRate: 0.95, salesVelocityRate: 0.6, constructionCostRate: 1.1, fundingRateDeltaPercentagePoints: 2 };
  return { priceRate: 1, salesVelocityRate: 1, constructionCostRate: 1, fundingRateDeltaPercentagePoints: 0 };
}
