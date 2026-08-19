import { describe, expect, it } from "vitest";
import { DEMO_PROJECT } from "@/domain/financial/demo";
import { calculateProject } from "@/domain/financial/engine";
import { calculateRedeScore, classifyScore } from "./calculate-score";
import { DIMENSION_WEIGHTS, SCORE_POLICY_VERSION } from "./policy";
import type { ResilienceEvidence } from "./types";

const stableResilience: ResilienceEvidence = {
  worstMarginLossPoints: 8,
  worstRoiLossPoints: 24,
  worstIrrLossPoints: 15,
  worstExposureIncreaseRate: 0.2,
  stressPolicyBreaks: 1,
  totalStressCases: 3,
  criticalStressCount: 0,
  basicStressInsolvent: false,
  criticalFactors: ["Stress severo: margem abaixo da política."],
};

describe("REDE Score v1", () => {
  it("uses explicit dimensions whose weights total 100%", () => {
    const result = calculateRedeScore({ result: calculateProject(DEMO_PROJECT), resilience: stableResilience });
    expect(Object.values(DIMENSION_WEIGHTS).reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(result.dimensions).toHaveLength(6);
    expect(result.policyVersion).toBe(SCORE_POLICY_VERSION);
    expect(result.rawScore).toBeCloseTo(result.dimensions.reduce((sum, dimension) => sum + dimension.weightedScore, 0), 1);
    expect({ total: result.totalScore, raw: result.rawScore, afterPenalties: result.scoreAfterPenalties, classification: result.classification }).toEqual({
      total: 55,
      raw: 67.9,
      afterPenalties: 54.9,
      classification: "ATTENTION",
    });
    expect(Object.fromEntries(result.dimensions.map((dimension) => [dimension.key, dimension.score]))).toEqual({
      RETURN: 79.4,
      CAPITAL: 41.6,
      COMMERCIAL: 78,
      COST: 65.5,
      RESILIENCE: 70.6,
      EXECUTION: 76.1,
    });
    expect(result.penalties.map((penalty) => penalty.key)).toEqual(["PENALTY_POST_KEYS", "PENALTY_LONG_EXPOSURE", "PENALTY_FUNDING_HEADROOM"]);
  });

  it("is deterministic and returns auditable reasons for every rule", () => {
    const financial = calculateProject(DEMO_PROJECT, "base", "2026-08-17T12:00:00.000Z");
    const first = calculateRedeScore({ result: financial, resilience: stableResilience });
    const second = calculateRedeScore({ result: financial, resilience: stableResilience });
    expect(second).toEqual(first);
    expect(first.dimensions.every((dimension) => dimension.reasons.every((reason) => reason.ruleKey && reason.actualValue && reason.benchmark && reason.message))).toBe(true);
  });

  it("caps projects with negative value rather than hiding failure in an average", () => {
    const financial = calculateProject({ ...DEMO_PROJECT, unitPrice: "150000" });
    const score = calculateRedeScore({ result: financial, resilience: stableResilience });
    expect(score.gates.map((gate) => gate.key)).toContain("GATE_NEGATIVE_NPV");
    expect(score.totalScore).toBeLessThanOrEqual(39);
  });

  it("keeps classification boundaries explicit", () => {
    expect(classifyScore(85)).toBe("EXCELLENT");
    expect(classifyScore(70)).toBe("ATTRACTIVE");
    expect(classifyScore(55)).toBe("ATTENTION");
    expect(classifyScore(40)).toBe("FRAGILE");
    expect(classifyScore(39.9)).toBe("CRITICAL");
  });
});
