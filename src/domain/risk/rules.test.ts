import { describe, expect, it } from "vitest";
import { DEMO_PROJECT } from "../financial/demo";
import { calculateProject } from "../financial/engine";
import { analyzeRisk } from "./rules";

describe("deterministic risk rules", () => {
  it("never emits an unexplained finding", () => {
    const recommendation = analyzeRisk(calculateProject(DEMO_PROJECT));
    expect(recommendation.findings.length).toBeGreaterThan(0);
    expect(recommendation.findings.every((finding) => finding.evidence && finding.action && finding.classification)).toBe(true);
  });

  it("blocks a project that violates its maximum exposure policy", () => {
    const project = { ...DEMO_PROJECT, policy: { ...DEMO_PROJECT.policy, maximumExposure: "1" } };
    const recommendation = analyzeRisk(calculateProject(project));
    expect(recommendation.status).toBe("NAO_AVANCAR");
    expect(recommendation.findings.some((finding) => finding.id === "policy-exposure" && finding.severity === "critical")).toBe(true);
  });
});
