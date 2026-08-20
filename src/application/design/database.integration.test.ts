import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { MembershipRole } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { createStudy } from "@/application/studies/study-service";
import { createInvestmentCase } from "@/application/investment/investment-service";
import { DEMO_PROJECT } from "@/domain/financial/demo";
import { prisma } from "@/infrastructure/database/prisma";
import { generateDesignReviewReport } from "./design-report-service";
import { createFindingFromClash, getBimWorkspace } from "./bim-service";
import { createAndCalculateAlternative, ensureDesignWorkspace, getDesignWorkspace, uploadAndProcessDesignFile } from "./design-service";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let context: AuthContext;
let foreignContext: AuthContext;
let workspace: Awaited<ReturnType<typeof ensureDesignWorkspace>>;

async function identity(name: string, role: MembershipRole) {
  const organization = await prisma.organization.create({ data: { name, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}` } });
  const user = await prisma.user.create({ data: { name, email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}@test.local`, passwordHash: "integration-test" } });
  await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id, role } });
  return { sessionId: `test-${user.id}`, userId: user.id, userName: user.name, userEmail: user.email, organizationId: organization.id, organizationName: organization.name, organizationSlug: organization.slug, role } satisfies AuthContext;
}

describe.sequential("Design Intelligence database boundaries and E2E", () => {
  beforeAll(async () => {
    context = await identity("Design Owner", "OWNER");
    foreignContext = await identity("Design Foreign", "OWNER");
    const study = await createStudy(context, { ...DEMO_PROJECT, projectName: `Design Case ${suffix}` });
    await createInvestmentCase(context, study.studyVersionId, null);
    workspace = await ensureDesignWorkspace(context, study.projectId);
  }, 60_000);

  it("persists a revision, provenance, derived findings and VE without hardcoded findings", async () => {
    expect(workspace.revision.label).toMatch(/Rev 04/);
    expect(workspace.metrics.some((metric) => metric.origin === "CALCULATED" && metric.evidenceRefs.length > 0)).toBe(true);
    expect(workspace.findings.some((finding) => finding.type === "AREA_MISMATCH" && finding.evidence.length >= 2)).toBe(true);
    expect(workspace.opportunities.some((opportunity) => opportunity.costImpact !== null)).toBe(true);
    expect(await prisma.designAuditLog.count({ where: { organizationId: context.organizationId, packageId: workspace.package.id } })).toBeGreaterThan(0);
  });

  it("blocks cross-tenant access even when the foreign tenant knows the package id", async () => {
    await expect(getDesignWorkspace(foreignContext.organizationId, workspace.package.id)).rejects.toThrow(/não encontrado nesta organização/i);
  });

  it("processes a real IFC, preserves its tree/properties and enforces BIM tenant and role boundaries", async () => {
    const fixture = fileURLToPath(new URL("../../domain/design/fixtures/parede-minima.ifc", import.meta.url));
    const bytes = await readFile(fixture);
    const processed = await uploadAndProcessDesignFile(context, { packageId: workspace.package.id, revisionId: workspace.revision.id, discipline: "BIM", revision: "R01", file: new File([bytes], "parede-minima.ifc", { type: "application/ifc" }) });
    expect(processed.bim?.model.status).toBe("PROCESSED");
    expect(processed.bim?.elements[0]).toMatchObject({ type: "IFCWALL", building: "Torre A", storey: "Pavimento Térreo" });
    expect(processed.bim?.elements[0]?.properties).toHaveProperty("propertySets");
    await expect(getBimWorkspace(foreignContext.organizationId, processed.bim!.model.id)).rejects.toThrow(/não encontrado nesta organização/i);

    const model = await prisma.bimModel.findUniqueOrThrow({ where: { id: processed.bim!.model.id }, include: { elements: true } });
    const element = model.elements[0];
    const clash = await prisma.designClash.create({ data: { modelId: model.id, revisionId: model.revisionId, elementAId: element.id, elementBId: element.id, clashType: "DUPLICATE", elementA: { expressId: element.expressId }, elementB: { expressId: element.expressId }, geometry: { method: "TEST" }, description: "Duplicidade de teste", severity: "MEDIUM", confidence: "HIGH", status: "OPEN", origin: "CALCULATED" } });
    const viewerUser = await prisma.user.create({ data: { name: "Design Viewer", email: `design-viewer-${suffix}@test.local`, passwordHash: "integration-test" } });
    await prisma.organizationMembership.create({ data: { organizationId: context.organizationId, userId: viewerUser.id, role: "VIEWER" } });
    const viewerContext = { ...context, userId: viewerUser.id, userName: viewerUser.name, userEmail: viewerUser.email, role: "VIEWER" as const };
    await expect(createFindingFromClash(viewerContext, clash.id)).rejects.toThrow(/não permite/);
    expect(await createFindingFromClash(context, clash.id)).toBeTruthy();
  }, 30_000);

  it("sends a structured design delta to the existing Engine and recalculates REDE Score", async () => {
    const result = await createAndCalculateAlternative(context, { packageId: workspace.package.id, revisionId: workspace.revision.id, name: `Alternativa A ${suffix}`, description: "Redução de área construída e incremento privativo", changes: { builtAreaM2: 17_690, privateAreaM2: 14_150, units: 314 } });
    const alternative = result.alternatives.find((item) => item.name.includes("Alternativa A"));
    expect(alternative?.status).toBe("CALCULATED");
    expect(alternative?.financialImpact).toHaveProperty("npv");
    expect(alternative?.scoreImpact).toMatchObject({ before: expect.any(Number), after: expect.any(Number), delta: expect.any(Number) });
    const impact = await prisma.designSimulationImpact.findFirst({ where: { alternativeId: alternative!.id } });
    expect(impact?.engineVersion).toMatch(/\d+\.\d+/);
    expect(impact?.studyVersionId).toBeTruthy();
  }, 60_000);

  it("generates and registers a real Design Review Report in Studio and Data Room", async () => {
    const report = await generateDesignReviewReport(context, workspace.package.id);
    expect(Buffer.from(report.content).subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(report.pageCount).toBeGreaterThan(20);
    expect(report.checksum).toHaveLength(64);
    const artifact = await prisma.studioArtifact.findFirst({ where: { id: report.artifactId, investmentCase: { organizationId: context.organizationId } } });
    expect(artifact).toMatchObject({ type: "DESIGN_REVIEW_REPORT", generationStatus: "COMPLETED" });
    const document = await prisma.projectDocument.findFirst({ where: { sourceArtifactId: report.artifactId } });
    expect(document).toMatchObject({ category: "DESIGN_REPORT", status: "VERIFIED" });
  }, 60_000);
});
