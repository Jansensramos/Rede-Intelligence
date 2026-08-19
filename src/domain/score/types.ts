import type { FinancialResult } from "@/domain/financial/types";

export type ScoreDimensionKey = "RETURN" | "CAPITAL" | "COMMERCIAL" | "COST" | "RESILIENCE" | "EXECUTION";
export type ScoreClassification = "EXCELLENT" | "ATTRACTIVE" | "ATTENTION" | "FRAGILE" | "CRITICAL";
export type ScoreReasonTone = "STRENGTH" | "NEUTRAL" | "WEAKNESS";

export interface ScoreReason {
  ruleKey: string;
  label: string;
  score: number;
  tone: ScoreReasonTone;
  message: string;
  actualValue: string;
  benchmark: string;
}

export interface ScoreDimensionResult {
  key: ScoreDimensionKey;
  score: number;
  weight: number;
  weightedScore: number;
  reasons: ScoreReason[];
}

export interface ScoreGate {
  key: string;
  reason: string;
  maximumScore: number;
}

export interface ScorePenalty {
  key: string;
  reason: string;
  points: number;
}

export interface ScoreExplanation {
  strengths: string[];
  weaknesses: string[];
  criticalFactors: string[];
}

export interface ResilienceEvidence {
  worstMarginLossPoints: number;
  worstRoiLossPoints: number;
  worstIrrLossPoints: number;
  worstExposureIncreaseRate: number;
  stressPolicyBreaks: number;
  totalStressCases: number;
  criticalStressCount: number;
  basicStressInsolvent: boolean;
  criticalFactors: string[];
}

export interface RedeScoreResult {
  policyVersion: string;
  totalScore: number;
  rawScore: number;
  scoreAfterPenalties: number;
  classification: ScoreClassification;
  dimensions: ScoreDimensionResult[];
  gates: ScoreGate[];
  penalties: ScorePenalty[];
  explanation: ScoreExplanation;
}

export interface ScoreInput {
  result: FinancialResult;
  resilience: ResilienceEvidence;
}
