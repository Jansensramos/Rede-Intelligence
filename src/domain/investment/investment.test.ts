import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { DEMO_PROJECT } from "@/domain/financial/demo";
import { calculateAllScenarios } from "@/domain/financial/engine";
import { createDemoLandSnapshot } from "@/domain/land";
import { calculateRedeScore } from "@/domain/score";
import { calculateSensitivity } from "@/domain/sensitivity";
import {
  DEFAULT_DATA_ROOM_CHECKLIST,
  INVESTMENT_BUNDLE_VERSION,
  artifactSections,
  buildApprovalPath,
  buildIntermediateDocumentModel,
  buildMasterReportModel,
  calculateCriticalPath,
  calculateDataRoomCompleteness,
  calculateDecisionTree,
  calculateDelayStress,
  calculateInvestmentReadiness,
  calculateLandValueCeiling,
  calculateTransformationEconomicImpact,
  createMasterReportConfig,
  createReportId,
  renderDocumentPdf,
  renderDocumentPptx,
  runMasterReportPreflight,
  validateDocumentTraceability,
  type InvestmentCaseWorkspace,
  type InvestmentSnapshotBundle,
  type UrbanTransformationView,
} from "@/domain/investment";

function fixture(): InvestmentCaseWorkspace {
  const sensitivity = calculateSensitivity(DEMO_PROJECT, "base", new Date("2026-08-17T12:00:00.000Z").toISOString());
  const results = calculateAllScenarios(DEMO_PROJECT, sensitivity.calculatedAt);
  const scores = {
    conservative: calculateRedeScore({ result: results.conservative, resilience: sensitivity.resilience }),
    base: sensitivity.baseScore,
    aggressive: calculateRedeScore({ result: results.aggressive, resilience: sensitivity.resilience }),
  };
  const land = createDemoLandSnapshot("org-test", 4);
  const bundle: InvestmentSnapshotBundle = {
    bundleVersion: INVESTMENT_BUNDLE_VERSION,
    frozenAt: "2026-08-17T12:00:00.000Z",
    organizationId: "org-test",
    projectId: "project-test",
    studyId: "study-test",
    studyVersionId: "study-version-test",
    studyVersionNumber: 12,
    landStudyVersionId: "land-version-test",
    landVersionNumber: 4,
    redTeamRunId: null,
    scenario: "base",
    project: { name: DEMO_PROJECT.projectName, city: DEMO_PROJECT.city, state: DEMO_PROJECT.state },
    assumptions: DEMO_PROJECT,
    engineResults: results,
    cashFlow: results.base.cashFlow,
    scores,
    sensitivity,
    redTeam: null,
    land,
    documents: [],
    missingEvidence: [],
    transformationEconomics: null,
  };
  const checklist = DEFAULT_DATA_ROOM_CHECKLIST.map((item) => ({ id: item.code, category: item.category, title: item.title, required: true, critical: item.critical, source: "DEFAULT" as const, status: "VERIFIED" as const, documentId: `doc-${item.code}` }));
  const readiness = calculateInvestmentReadiness(bundle, checklist, []);
  const selected = land.options.find((item) => item.id === land.selectedOptionId)!;
  const urban: UrbanTransformationView = { inhabitantsPerUnit: 2.5, estimatedPopulation: Math.round(selected.areaSchedule.units * 2.5), readiness: land.regulatoryConfidence.score, readinessLabel: land.regulatoryConfidence.label, infrastructure: [], impacts: [], contributions: [], costs: [], milestones: [], stageGates: [], risks: [] };
  return {
    id: "case-test", organizationId: "org-test", title: "Investment Case Teste", description: "Teste", status: "DRAFT", createdAt: bundle.frozenAt, updatedAt: bundle.frozenAt,
    bundleId: "bundle-test", bundleChecksum: createHash("sha256").update(JSON.stringify(bundle)).digest("hex"), bundle, bundleHistory: [{ id: "bundle-test", version: 1, checksum: "fixture", studyVersionNumber: 12, landVersionNumber: 4, frozenAt: bundle.frozenAt }], changeReport: [], readiness, dataRoomCompleteness: calculateDataRoomCompleteness(checklist), approvalPath: buildApprovalPath(bundle, []),
    rounds: [{ id: "round-1", roundNumber: 1, status: "SUBMITTED", submittedAt: bundle.frozenAt, decidedAt: null, bundleId: "bundle-test" }], decisions: [], conditions: [], checklist, documents: [], artifacts: [],
    brand: { organizationName: "REDE", monogram: "RE", primaryColor: "#173D4F", secondaryColor: "#789194", accentColor: "#B98A43", fontHeading: "Aptos Display", fontBody: "Aptos", footer: "REDE Intelligence", disclaimer: "Análise preliminar", contactInfo: "admin@rede.local" },
    urbanTransformation: urban, assumptionsRegister: [], claims: [], decisionLedger: [], issues: [], sandboxes: [],
  };
}

describe("investment governance and transformation", () => {
  it("keeps document completeness separate from investment readiness", () => {
    const workspace = fixture();
    expect(workspace.dataRoomCompleteness.overall).toBe(100);
    expect(workspace.readiness.dimensions).toHaveLength(8);
    expect(workspace.readiness.score).toBeGreaterThan(0);
  });

  it("feeds classified urban transformation costs back through the existing Engine", () => {
    const workspace = fixture();
    const impact = calculateTransformationEconomicImpact(workspace.bundle, 8_000_000, ["contribution:test"]);
    expect(impact.classification).toBe("URBAN_TRANSFORMATION_COST");
    expect(Number(impact.adjusted.metrics.totalCost)).toBeGreaterThan(Number(impact.base.metrics.totalCost));
    expect(Number(impact.adjusted.metrics.npv)).toBeLessThan(Number(impact.base.metrics.npv));
  });

  it("calculates delay, land ceiling and critical path without hidden assumptions", () => {
    const workspace = fixture();
    const stress = calculateDelayStress(workspace.bundle.assumptions, "base", [3, 6, 12], workspace.bundle.frozenAt);
    expect(stress.map((item) => item.delayMonths)).toEqual([3, 6, 12]);
    const ceiling = calculateLandValueCeiling(workspace.bundle.assumptions, "base", workspace.bundle.frozenAt);
    expect(ceiling.maximumLandPrice).toBeGreaterThanOrEqual(0);
    const path = calculateCriticalPath([{ id: "a", title: "A", durationMonths: 2, dependencyIds: [] }, { id: "b", title: "B", durationMonths: 4, dependencyIds: ["a"] }, { id: "c", title: "C", durationMonths: 1, dependencyIds: ["a"] }]);
    expect(path).toMatchObject({ complete: true, durationMonths: 6, pathIds: ["a", "b"] });
    expect(calculateCriticalPath([{ id: "x", title: "X", durationMonths: null, dependencyIds: [] }]).durationMonths).toBeNull();
  });

  it("does not invent probabilities for the decision tree", () => {
    const incomplete = calculateDecisionTree([{ id: "approval", label: "Aprovação", probability: null, npv: 100, costToReach: 10, evidenceRefs: [] }]);
    expect(incomplete).toMatchObject({ complete: false, expectedNpv: null });
    const complete = calculateDecisionTree([{ id: "yes", label: "Sim", probability: 0.6, npv: 100, costToReach: 10, evidenceRefs: [] }, { id: "no", label: "Não", probability: 0.4, npv: -20, costToReach: 10, evidenceRefs: [] }]);
    expect(complete.expectedNetValue).toBe(42);
  });
});

describe("REDE Studio and Master Report", () => {
  it("uses the exact mandatory section registries", () => {
    expect(artifactSections("INVESTMENT_BOOK")).toHaveLength(36);
    expect(artifactSections("URBAN_CASE")).toHaveLength(35);
    expect(artifactSections("MASTER_REPORT").length).toBeGreaterThan(60);
  });

  it("locks metrics, records provenance and filters confidential sections by audience", () => {
    const workspace = fixture();
    const internal = buildIntermediateDocumentModel({ artifactType: "INVESTMENT_BOOK", audience: "INTERNAL", bundle: workspace.bundle, readiness: workspace.readiness, approvalPath: workspace.approvalPath, urban: workspace.urbanTransformation, generatedAt: workspace.bundle.frozenAt });
    const municipality = buildIntermediateDocumentModel({ artifactType: "INVESTMENT_BOOK", audience: "MUNICIPALITY", bundle: workspace.bundle, readiness: workspace.readiness, approvalPath: workspace.approvalPath, urban: workspace.urbanTransformation, generatedAt: workspace.bundle.frozenAt });
    expect(validateDocumentTraceability(internal)).toEqual([]);
    expect(internal.sections.some((section) => section.title === "ROI")).toBe(true);
    expect(municipality.sections.some((section) => section.title === "ROI")).toBe(false);
    const metrics = internal.sections.flatMap((section) => section.blocks).filter((block) => block.type === "METRICS").flatMap((block) => block.type === "METRICS" ? block.metrics : []);
    expect(metrics.every((metric) => metric.locked && metric.sourceVersion)).toBe(true);
  });

  it("supports presets, preflight, report ID and immutable snapshot binding", () => {
    const workspace = fixture();
    const executive = createMasterReportConfig(workspace, "EXECUTIVE", "INVESTOR");
    const complete = createMasterReportConfig(workspace, "COMPLETE", "INTERNAL");
    const full = createMasterReportConfig(workspace, "FULL_DOSSIER", "INTERNAL");
    expect(executive.selectedSections.length).toBeLessThan(complete.selectedSections.length);
    expect(full.selectedSections.length).toBeGreaterThan(complete.selectedSections.length);
    const preflight = runMasterReportPreflight(workspace, complete);
    expect(preflight.canGenerateFinal).toBe(true);
    expect(createReportId("Residencial Horizonte", 128, 1)).toBe("RI-RES-000128-V01-MR");
    expect(() => runMasterReportPreflight(workspace, { ...complete, snapshotBundleId: "foreign" })).not.toThrow();
    expect(runMasterReportPreflight(workspace, { ...complete, snapshotBundleId: "foreign" }).status).toBe("NOT_READY");
  });

  it("builds one report model and renders a valid PDF with real page count, TOC and bookmarks", async () => {
    const workspace = fixture();
    const config = createMasterReportConfig(workspace, "EXECUTIVE", "INTERNAL");
    const model = buildMasterReportModel(workspace, config, "RI-RES-000001-V01-MR", 1, workspace.bundle.frozenAt);
    expect(model.toc).toHaveLength(model.sections.length);
    const rendered = await renderDocumentPdf(model, workspace.brand, { reportId: model.reportId, watermark: "DRAFT" });
    const parsed = await PDFDocument.load(rendered.bytes);
    expect(rendered.bytes.slice(0, 4).toString()).not.toBe("");
    expect(parsed.getPageCount()).toBe(rendered.pageCount);
    expect(rendered.pageCount).toBeGreaterThan(20);
    expect(rendered.checksum).toHaveLength(64);
    expect(parsed.catalog.get(PDFName.of("Outlines"))).toBeDefined();
  }, 30_000);

  it("renders a real PPTX package from the same intermediate model", async () => {
    const workspace = fixture();
    const model = buildIntermediateDocumentModel({ artifactType: "INVESTOR_DECK", audience: "INVESTOR", bundle: workspace.bundle, readiness: workspace.readiness, approvalPath: workspace.approvalPath, urban: workspace.urbanTransformation, generatedAt: workspace.bundle.frozenAt });
    const rendered = await renderDocumentPptx(model, workspace.brand);
    expect(String.fromCharCode(...rendered.bytes.slice(0, 2))).toBe("PK");
    expect(rendered.slideCount).toBe(21);
    expect(rendered.checksum).toHaveLength(64);
  }, 30_000);
});
