import type { FinancialMetrics, ScenarioKey } from "@/domain/financial/types";
import type { RecommendationStatus } from "@/domain/risk/rules";
import type { RedeScoreResult, ResilienceEvidence, ScoreClassification } from "@/domain/score";

export type SensitivityVariable =
  | "SALE_PRICE"
  | "CONSTRUCTION_COST"
  | "SALES_VELOCITY"
  | "CONSTRUCTION_DURATION"
  | "FINANCING_COST"
  | "LAND_COST"
  | "COMMERCIAL_EXPENSES"
  | "SALES_START_DELAY";

export type VariationUnit = "RATE" | "PERCENTAGE_POINTS" | "MONTHS";
export type StressKey = "MODERATE" | "SEVERE" | "EXTREME";
export type BreakEvenStatus = "FOUND" | "NOT_REACHED" | "BASE_FAILS_POLICY";

export type SensitivityMetrics = Pick<
  FinancialMetrics,
  | "vgv"
  | "marginOnVgv"
  | "profit"
  | "roi"
  | "annualIrr"
  | "npv"
  | "maximumCashExposure"
  | "equityCapitalRequired"
  | "fundingNeed"
>;

export interface SensitivityAdjustment {
  variable: SensitivityVariable;
  label: string;
  variation: number;
  variationUnit: VariationUnit;
}

export interface SensitivityCase extends SensitivityAdjustment {
  baseValue: string | number;
  stressedValue: string | number;
  metrics: SensitivityMetrics;
  policyViolations: string[];
  score: number;
  classification: ScoreClassification;
  scoreDelta: number;
}

export interface StressTestResult {
  key: StressKey;
  label: string;
  adjustments: SensitivityAdjustment[];
  metrics: SensitivityMetrics;
  violatedPolicies: string[];
  score: number;
  classification: ScoreClassification;
  scoreDelta: number;
  recommendationStatus: RecommendationStatus;
  recommendationLabel: string;
}

export interface BreakEvenResult {
  key: "SALE_PRICE" | "CONSTRUCTION_COST" | "SALES_START_DELAY" | "SALES_VELOCITY";
  label: string;
  variable: SensitivityVariable;
  value: number;
  unit: VariationUnit;
  status: BreakEvenStatus;
  iterations: number;
}

export interface SensitivityRanking {
  variable: SensitivityVariable;
  label: string;
  scoreImpact: number;
  npvImpact: number;
}

export interface SensitivityResult {
  configVersion: string;
  scenario: ScenarioKey;
  calculatedAt: string;
  baseScore: RedeScoreResult;
  cases: SensitivityCase[];
  stresses: StressTestResult[];
  breakEvens: BreakEvenResult[];
  ranking: SensitivityRanking[];
  resilience: ResilienceEvidence;
}
