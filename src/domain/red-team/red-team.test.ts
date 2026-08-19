import { describe, expect, it } from "vitest";
import { DEMO_PROJECT } from "@/domain/financial/demo";
import { calculateProject } from "@/domain/financial/engine";
import { analyzeRisk } from "@/domain/risk/rules";
import { calculateSensitivity } from "@/domain/sensitivity";
import { buildEvidencePack, validateEvidenceReferences } from "./evidence";
import { runRedTeam } from "./orchestrator";
import { redTeamFindingSchema } from "./schemas";
import type { ProjectAssumptions } from "@/domain/financial/types";

const timestamp = "2026-08-17T12:00:00.000Z";
const horizon78: ProjectAssumptions = { ...DEMO_PROJECT, units: 78 };

function evidence(input = horizon78, uploadedEvidence: { id: string; category: string; title: string; content: string }[] = []) {
  const sensitivity = calculateSensitivity(input, "base", timestamp);
  const engineResult = calculateProject(input, "base", timestamp);
  return buildEvidencePack({
    generatedAt: timestamp,
    organization: { id: "org-rede", name: "REDE" },
    project: { id: "project-horizonte", name: input.projectName, city: input.city, state: input.state },
    study: { id: "study-horizonte", name: "Estudo de viabilidade" },
    studyVersion: { id: "version-1", versionNumber: 1, status: "SNAPSHOT", inputHash: "hash" },
    scenario: "base",
    assumptions: input,
    assumptionSources: Object.fromEntries(Object.keys(input).map((key) => [key, "USER_INPUT"])),
    engineResult,
    score: sensitivity.baseScore,
    sensitivity,
    alerts: analyzeRisk(engineResult).findings,
    uploadedEvidence,
  });
}

describe("Red Team Evidence Pack", () => {
  it("creates stable provenance for assumptions, Engine, Score, stress and evidence gaps", () => {
    const pack = evidence();
    const refs = new Set(pack.items.map((item) => item.ref));
    expect(refs.has("ASSUMPTION.unitPrice")).toBe(true);
    expect(refs.has("ENGINE.maximumCashExposure")).toBe(true);
    expect(refs.has("SCORE.CAPITAL")).toBe(true);
    expect(refs.has("STRESS.SEVERE")).toBe(true);
    expect(refs.has("MISSING_EVIDENCE.land_title")).toBe(true);
    expect(pack.missingEvidence).toHaveLength(9);
    expect(() => validateEvidenceReferences(pack, ["ENGINE.npv", "STRESS.EXTREME"])).not.toThrow();
    expect(() => validateEvidenceReferences(pack, ["ENGINE.invented"])).toThrow(/inexistentes/);
  });

  it("requires evidenceRefs for every factual finding", () => {
    expect(() => redTeamFindingSchema.parse({
      id: "invalid",
      agent: "FINANCE_FUNDING",
      category: "FINANCE",
      type: "RISK",
      severity: "HIGH",
      confidence: "HIGH",
      title: "Finding sem prova",
      description: "Não deve ser aceito.",
      evidenceRefs: [],
      implication: "Inválida.",
      recommendedAction: "Nenhuma.",
      status: "OPEN",
    })).toThrow();
  });
});

describe("RedTeamOrchestrator", () => {
  it("runs six isolated specialists, cross review, disagreement and final synthesis", async () => {
    const report = await runRedTeam(evidence());
    expect(report.agents).toHaveLength(6);
    expect(report.agents.every((agent) => agent.findingIds.every((id) => report.findings.find((finding) => finding.id === id)?.agent === agent.agent))).toBe(true);
    expect(report.findings.length).toBeGreaterThanOrEqual(15);
    expect(report.findings.every((finding) => finding.evidenceRefs.length > 0)).toBe(true);
    expect(report.crossReviews.length).toBe(report.findings.filter((finding) => ["HIGH", "CRITICAL"].includes(finding.severity)).length);
    expect(report.disagreements).toHaveLength(1);
    expect(report.conclusion.decision).toBe("RESTRUCTURE");
    expect(report.conclusion.confidence).toBe("HIGH");
    expect(report.conclusion.whatWouldChangeDecision.length).toBeGreaterThanOrEqual(4);
    expect(report.observability.calls).toBe(0);
  });

  it("classifies unsupported assumptions and emits actionable evidence requests", async () => {
    const report = await runRedTeam(evidence());
    expect(report.assumptionChallenges).toHaveLength(6);
    expect(report.assumptionChallenges.every((challenge) => challenge.classification === "UNSUPPORTED")).toBe(true);
    expect(report.evidenceRequests.map((request) => request.requestedDocument)).toEqual(expect.arrayContaining(["Orçamento detalhado de obra", "Matrícula atualizada do imóvel", "Estudo de mercado e absorção", "Term sheet ou proposta de funding"]));
    expect(report.conclusion.requiredActions.every((action) => action.length > 20)).toBe(true);
  });
});
