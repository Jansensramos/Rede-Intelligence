import type { ProjectAssumptions } from "@/domain/financial/types";
import type { ScoreDimensionKey } from "./types";

export const SCORE_POLICY_VERSION = "REDE_SCORE_V1.0.0";

export const DIMENSION_WEIGHTS: Record<ScoreDimensionKey, number> = {
  RETURN: 0.25,
  CAPITAL: 0.20,
  COMMERCIAL: 0.15,
  COST: 0.15,
  RESILIENCE: 0.15,
  EXECUTION: 0.10,
};

export interface HigherIsBetterBands {
  critical: number;
  minimum: number;
  target: number;
  excellent: number;
}

export interface LowerIsBetterBands {
  excellent: number;
  target: number;
  minimum: number;
  critical: number;
}

export function returnBenchmarks(input: ProjectAssumptions) {
  const marginMinimum = Number(input.policy.minimumMarginRate);
  const roiMinimum = Number(input.policy.minimumRoiRate);
  const irrMinimum = Number(input.policy.minimumIrrRate);
  return {
    margin: { critical: Math.max(0, marginMinimum * 0.5), minimum: marginMinimum, target: marginMinimum + 8, excellent: marginMinimum + 15 },
    roi: { critical: 0, minimum: roiMinimum, target: roiMinimum + 20, excellent: roiMinimum + 50 },
    irr: { critical: 0, minimum: irrMinimum, target: irrMinimum + 8, excellent: irrMinimum + 18 },
    npvToVgv: { critical: -0.05, minimum: 0, target: 0.05, excellent: 0.10 },
  } satisfies Record<string, HigherIsBetterBands>;
}

export const CAPITAL_BENCHMARKS = {
  exposurePolicyUse: { excellent: 0.60, target: 0.85, minimum: 1.00, critical: 1.50 },
  equityToVgv: { excellent: 0.12, target: 0.22, minimum: 0.35, critical: 0.50 },
  fundingLimitUse: { excellent: 0.60, target: 0.80, minimum: 0.95, critical: 1.00 },
  exposureDurationMonths: { excellent: 12, target: 18, minimum: 24, critical: 36 },
  exposureToVgv: { excellent: 0.20, target: 0.35, minimum: 0.45, critical: 0.65 },
} satisfies Record<string, LowerIsBetterBands>;

export const COMMERCIAL_BENCHMARKS = {
  salesDurationMonths: { excellent: 10, target: 18, minimum: 30, critical: 48 },
  soldBeforeDelivery: { critical: 0.20, minimum: 0.50, target: 0.75, excellent: 0.95 },
  inventoryAtDelivery: { excellent: 0.05, target: 0.20, minimum: 0.40, critical: 0.70 },
  postDeliveryReceipts: { excellent: 0.15, target: 0.35, minimum: 0.55, critical: 0.75 },
  receiptsBeforeDelivery: { critical: 0.20, minimum: 0.40, target: 0.60, excellent: 0.80 },
};

export const COST_BENCHMARKS = {
  totalCostToVgv: { excellent: 0.60, target: 0.70, minimum: 0.80, critical: 0.95 },
  constructionToVgv: { excellent: 0.30, target: 0.40, minimum: 0.50, critical: 0.65 },
  landToVgv: { excellent: 0.10, target: 0.18, minimum: 0.25, critical: 0.35 },
  indirectRate: { excellent: 5, target: 8, minimum: 12, critical: 18 },
  commercialBurden: { excellent: 0.05, target: 0.08, minimum: 0.12, critical: 0.18 },
};

export const EXECUTION_BENCHMARKS = {
  totalDurationMonths: { excellent: 20, target: 28, minimum: 36, critical: 48 },
  approvalMonths: { excellent: 4, target: 8, minimum: 12, critical: 18 },
  constructionMonths: { excellent: 15, target: 24, minimum: 36, critical: 48 },
  relevantCashMonth: { excellent: 6, target: 12, minimum: 18, critical: 30 },
  outflowConcentration: { excellent: 0.08, target: 0.12, minimum: 0.18, critical: 0.28 },
};

export const RESILIENCE_BENCHMARKS = {
  marginLossPoints: { excellent: 3, target: 6, minimum: 10, critical: 18 },
  roiLossPoints: { excellent: 10, target: 25, minimum: 50, critical: 100 },
  irrLossPoints: { excellent: 5, target: 15, minimum: 30, critical: 60 },
  exposureIncreaseRate: { excellent: 0.05, target: 0.15, minimum: 0.30, critical: 0.60 },
  stressPolicyBreakRate: { excellent: 0, target: 0.34, minimum: 0.67, critical: 1 },
};

// V1 documentation: critical bands represent structural failure; minimum bands
// mirror the organization's policy; target/excellent bands measure explicit
// headroom above policy rather than introducing hidden UI thresholds.
