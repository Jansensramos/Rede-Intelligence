import { describe, expect, it } from "vitest";
import { renderDocumentPdf } from "@/domain/investment";
import { buildDesignReviewDocument, createDesignDemoReviewInput, reviewDesign, SUPPORTED_DESIGN_FORMATS, type DesignWorkspaceView } from "./index";

function demoWorkspace(): DesignWorkspaceView {
  const result = reviewDesign(createDesignDemoReviewInput("revision-1"));
  return {
    package: { id: "package-1", projectId: "project-1", name: "Projeto Arquitetônico", description: "", status: "READY", template: "RESIDENTIAL_VERTICAL", reviewMode: "FULL_REVIEW", preflightStatus: result.preflight.status, limitations: [...result.preflight.limitations, ...result.preflight.missingInformation] },
    revision: { id: "revision-1", label: "PROJECT V1 · Rev 04", versionNumber: 1, status: "READY" },
    revisions: [{ id: "revision-1", label: "PROJECT V1 · Rev 04", versionNumber: 1, status: "READY", createdAt: "2026-08-18T02:00:00.000Z" }],
    revisionDiff: [],
    files: [],
    metrics: result.calculatedMetrics.map((metric, index) => ({ id: `metric-${index}`, name: metric.name, value: metric.value, unit: metric.unit, origin: metric.origin, confidence: metric.confidence, evidenceRefs: metric.evidence.map((item) => item.ref) })),
    findings: result.findings.map((finding, index) => ({ ...finding, id: `finding-${index}` })),
    opportunities: result.opportunities.map((opportunity, index) => ({ ...opportunity, id: `opportunity-${index}`, status: "IDENTIFIED" })),
    alternatives: [], scorecard: result.scorecard, summary: result.summary, insights: result.insights, supportedFormats: SUPPORTED_DESIGN_FORMATS,
  };
}

describe("Design Review Report", () => {
  it("renders a real institutional PDF with the prescribed review sections", async () => {
    const model = buildDesignReviewDocument(demoWorkspace(), { projectName: "Residencial Horizonte", city: "Barueri", state: "SP", generatedAt: "2026-08-18T02:00:00.000Z" });
    expect(model.artifactType).toBe("DESIGN_REVIEW_REPORT");
    expect(model.sections.map((section) => section.title)).toContain("Value Engineering");
    expect(model.sections.map((section) => section.title)).toContain("Findings críticos");
    expect(model.disclaimers.join(" ")).toMatch(/Não substitui arquiteto/);
    const rendered = await renderDocumentPdf(model, { organizationName: "REDE", monogram: "RE", primaryColor: "#102733", secondaryColor: "#193b49", accentColor: "#b98a43", fontHeading: "Georgia", fontBody: "Inter", footer: "REDE Intelligence", disclaimer: "Confidencial", contactInfo: "" }, { reportId: "DR-TEST", watermark: "CONFIDENTIAL" });
    expect(Buffer.from(rendered.bytes).subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(rendered.pageCount).toBeGreaterThan(20);
    expect(rendered.checksum).toHaveLength(64);
  }, 30_000);
});
