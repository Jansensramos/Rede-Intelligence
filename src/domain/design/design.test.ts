import { describe, expect, it } from "vitest";
import { compareDesignMetrics, createDesignDemoReviewInput, manualScaleCalibration, reviewDesign } from "./index";
import type { DesignMetricInput } from "./types";

const metric = (name: string, value: number, unit = "m2", confidence: DesignMetricInput["confidence"] = "HIGH"): DesignMetricInput => ({ name, value, unit, origin: "USER_PROVIDED", confidence, evidence: [{ ref: `TEST:${name}`, label: name, value: String(value), origin: "USER_PROVIDED", confidence, method: "UNIT_TEST" }] });

describe("REDE Design Review Engine", () => {
  it("derives findings and quantified VE from evidence instead of hardcoded issues", () => {
    const result = reviewDesign(createDesignDemoReviewInput());
    expect(result.schemaVersion).toBe("REDE_DESIGN_REVIEW_V1");
    expect(result.findings.find((finding) => finding.type === "AREA_MISMATCH")?.potentialImpact?.areaDeltaM2).toBe(650);
    expect(result.findings.some((finding) => finding.type === "URBAN_CONFLICT" && finding.evidence.some((item) => item.ref.includes("URBAN_SCENARIO")))).toBe(true);
    expect(result.opportunities.some((item) => item.costImpact !== null && item.costImpact! > 0)).toBe(true);
    expect(result.opportunities.every((item) => item.requiresProfessionalValidation)).toBe(true);
    expect(result.scorecard).toHaveLength(7);
  });

  it("never fabricates areas when a PDF has no confirmed scale", () => {
    const result = reviewDesign({ revisionId: "r1", projectName: "Teste", reviewMode: "EXECUTIVE_REVIEW", documents: [{ id: "f1", name: "sem-escala.pdf", extension: "pdf", discipline: "ARCHITECTURE", scaleConfidence: "UNKNOWN", support: "SUPPORTED" }], metrics: [] });
    expect(result.preflight.status).toBe("READY_WITH_LIMITATIONS");
    expect(result.findings.some((finding) => finding.key === "SCALE:UNKNOWN")).toBe(true);
    expect(result.calculatedMetrics.some((item) => /AREA|RATE/.test(item.name))).toBe(false);
    expect(result.summary.efficiencyRate).toBeNull();
  });

  it("respects centralized area tolerances", () => {
    const result = reviewDesign({ revisionId: "r1", projectName: "Teste", reviewMode: "EXECUTIVE_REVIEW", documents: [{ id: "f1", name: "areas.pdf", extension: "pdf", discipline: "ARCHITECTURE", scaleConfidence: "CONFIRMED", support: "SUPPORTED" }], metrics: [metric("DECLARED_TOTAL_AREA_M2", 10_000), metric("GEOMETRY_TOTAL_AREA_M2", 10_009)], areaToleranceM2: 20, areaToleranceRate: .01 });
    expect(result.findings.some((finding) => finding.type === "AREA_MISMATCH")).toBe(false);
  });

  it("does not quantify VE without a cost assumption", () => {
    const input = createDesignDemoReviewInput();
    input.economics = { ...input.economics, constructionCostPerM2: undefined };
    const result = reviewDesign(input);
    expect(result.opportunities.filter((item) => ["AREA_EFFICIENCY", "CIRCULATION", "CORE"].includes(item.category)).every((item) => item.costImpact === null)).toBe(true);
  });

  it("calculates two-point calibration without claiming a drawing denominator", () => {
    expect(manualScaleCalibration({ pixelDistance: 500, realDistance: 10, unit: "m" })).toEqual({ metresPerPixel: .02, confidence: "CONFIRMED", method: "USER_TWO_POINT_CALIBRATION" });
    expect(() => manualScaleCalibration({ pixelDistance: 0, realDistance: 10, unit: "m" })).toThrow(/positivas/);
  });

  it("creates a stable metric diff with added, removed and modified states", () => {
    const diff = compareDesignMetrics([metric("UNIT_COUNT", 300, "units"), metric("PRIVATE_AREA_M2", 10_000)], [metric("UNIT_COUNT", 306, "units"), metric("PARKING_SPACES", 210, "spaces")]);
    expect(diff.find((item) => item.name === "UNIT_COUNT")).toMatchObject({ kind: "MODIFIED", delta: 6, deltaRate: .02 });
    expect(diff.find((item) => item.name === "PRIVATE_AREA_M2")?.kind).toBe("REMOVED");
    expect(diff.find((item) => item.name === "PARKING_SPACES")?.kind).toBe("ADDED");
  });
});
