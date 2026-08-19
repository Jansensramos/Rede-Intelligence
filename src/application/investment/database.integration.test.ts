import { beforeAll, describe, expect, it } from "vitest";
import { MembershipRole } from "@prisma/client";
import { createStudy } from "@/application/studies/study-service";
import {
  addInvestmentCondition,
  createDecisionSandbox,
  createInvestmentCase,
  getArtifactDownload,
  getInvestmentCaseForOrganization,
  promoteDecisionSandbox,
  recordCommitteeDecision,
  registerProjectDocument,
  submitReviewRound,
  verifyInvestmentCondition,
} from "./investment-service";
import { generateMasterReport } from "./studio-service";
import { createMasterReportConfig, type InvestmentCaseWorkspace } from "@/domain/investment";
import { DEMO_PROJECT } from "@/domain/financial/demo";
import { prisma } from "@/infrastructure/database/prisma";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let workspace: InvestmentCaseWorkspace;
let context: { userId: string; organizationId: string; role: MembershipRole };
let foreignOrganizationId: string;

describe.sequential("Phase 6 database boundaries", () => {
  beforeAll(async () => {
    const organization = await prisma.organization.create({ data: { name: `Investment Test ${suffix}`, slug: `investment-test-${suffix}` } });
    const user = await prisma.user.create({ data: { name: "Investment Owner", email: `investment-${suffix}@test.local`, passwordHash: "integration-test" } });
    await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id, role: "OWNER" } });
    const foreign = await prisma.organization.create({ data: { name: `Foreign ${suffix}`, slug: `foreign-${suffix}` } });
    foreignOrganizationId = foreign.id;
    context = { userId: user.id, organizationId: organization.id, role: "OWNER" };
    const study = await createStudy(context, { ...DEMO_PROJECT, projectName: `Case ${suffix}` });
    workspace = await createInvestmentCase(context, study.studyVersionId, null);
  }, 60_000);

  it("binds exact persisted Engine, Score, sensitivity and Red Team versions into a frozen bundle", () => {
    expect(workspace.bundle.studyVersionId).toBeTruthy();
    expect(Object.keys(workspace.bundle.engineResults).sort()).toEqual(["aggressive", "base", "conservative"]);
    expect(Object.keys(workspace.bundle.scores).sort()).toEqual(["aggressive", "base", "conservative"]);
    expect(workspace.bundle.sensitivity.cases.length).toBeGreaterThan(0);
    expect(workspace.bundle.redTeam).not.toBeNull();
    expect(workspace.bundleChecksum).toHaveLength(64);
  });

  it("prevents cross-organization IDOR", async () => {
    expect(await getInvestmentCaseForOrganization(foreignOrganizationId, workspace.id)).toBeNull();
  });

  it("enforces snapshot bundle immutability in PostgreSQL", async () => {
    await expect(prisma.investmentSnapshotBundle.update({ where: { id: workspace.bundleId }, data: { scenario: "aggressive" } })).rejects.toThrow(/immutable/i);
  });

  it("keeps review rounds, decisions and the decision ledger as separate history", async () => {
    workspace = await submitReviewRound(context, workspace.id);
    workspace = await recordCommitteeDecision(context, { investmentCaseId: workspace.id, decision: "APPROVE_WITH_CONDITIONS", confidence: "MEDIUM", rationale: "Aprovar após comprovação documental.", dominantRisk: "Evidências pendentes", recommendedAction: "Cumprir condicionantes" });
    expect(workspace.rounds.at(-1)?.status).toBe("DECIDED");
    expect(workspace.decisions).toHaveLength(1);
    expect(workspace.decisionLedger).toHaveLength(1);
    expect(workspace.status).toBe("APPROVED_WITH_CONDITIONS");
  });

  it("links committee conditions to the checklist and restricts verification by role", async () => {
    workspace = await addInvestmentCondition(context, { investmentCaseId: workspace.id, title: "Validar orçamento", description: "Revisão técnica independente", category: "ENGINEERING", priority: "HIGH", isBlocker: true, evidenceRequired: "Parecer de orçamento" });
    const condition = workspace.conditions.find((item) => item.title === "Validar orçamento")!;
    expect(workspace.checklist.some((item) => item.title === "Parecer de orçamento" && item.source === "COMMITTEE")).toBe(true);
    await expect(verifyInvestmentCondition({ ...context, role: "ANALYST" }, workspace.id, condition.id)).rejects.toThrow(/Owner ou Admin/);
    workspace = await verifyInvestmentCondition(context, workspace.id, condition.id);
    expect(workspace.conditions.find((item) => item.id === condition.id)?.status).toBe("VERIFIED");
  });

  it("versions Data Room documents without deleting the previous file", async () => {
    const checklistItem = workspace.checklist[0];
    workspace = await registerProjectDocument(context, { investmentCaseId: workspace.id, checklistItemId: checklistItem.id, category: checklistItem.category, title: checklistItem.title, fileName: "evidence-v1.txt", mimeType: "text/plain", content: new TextEncoder().encode("version 1"), confidentiality: "CONFIDENTIAL" });
    workspace = await registerProjectDocument(context, { investmentCaseId: workspace.id, checklistItemId: checklistItem.id, category: checklistItem.category, title: checklistItem.title, fileName: "evidence-v2.txt", mimeType: "text/plain", content: new TextEncoder().encode("version 2"), confidentiality: "CONFIDENTIAL" });
    const versions = await prisma.projectDocument.findMany({ where: { investmentCaseId: workspace.id, title: checklistItem.title }, orderBy: { version: "asc" } });
    expect(versions.map((item) => [item.version, item.status])).toEqual([[1, "SUPERSEDED"], [2, "RECEIVED"]]);
    expect(versions[1].previousVersionId).toBe(versions[0].id);
  });

  it("promotes a sandbox into a new StudyVersion, immutable bundle and review round", async () => {
    const previousBundleId = workspace.bundleId;
    const previousStudyVersionId = workspace.bundle.studyVersionId;
    const previousRoundCount = workspace.rounds.length;
    workspace = await createDecisionSandbox(context, workspace.id, "IC downside", { unitPrice: String(Number(workspace.bundle.assumptions.unitPrice) * 0.95) });
    const sandbox = workspace.sandboxes.find((item) => item.name === "IC downside")!;
    expect(sandbox.status).toBe("CALCULATED");
    workspace = await promoteDecisionSandbox(context, workspace.id, sandbox.id);
    expect(workspace.bundleId).not.toBe(previousBundleId);
    expect(workspace.bundle.studyVersionId).not.toBe(previousStudyVersionId);
    expect(workspace.bundleHistory).toHaveLength(2);
    expect(workspace.changeReport.length).toBeGreaterThan(0);
    expect(workspace.rounds).toHaveLength(previousRoundCount + 1);
    expect(workspace.sandboxes.find((item) => item.id === sandbox.id)?.status).toBe("PROMOTED");
  }, 60_000);

  it("generates a FINAL Master Report, registers real page count/checksum and saves it to Data Room", async () => {
    const config = createMasterReportConfig(workspace, "EXECUTIVE", "INTERNAL");
    const generated = await generateMasterReport(context, workspace.id, config, true);
    expect(generated.pageCount).toBeGreaterThan(20);
    expect(generated.checksum).toHaveLength(64);
    const artifact = await prisma.studioArtifact.findUniqueOrThrow({ where: { id: generated.artifactId } });
    expect(artifact).toMatchObject({ status: "FINAL", generationStatus: "COMPLETED", pageCount: generated.pageCount, checksum: generated.checksum });
    expect(artifact.content ? Buffer.from(artifact.content).subarray(0, 4).toString("ascii") : "").toBe("%PDF");
    const dataRoomCopy = await prisma.projectDocument.findFirst({ where: { sourceArtifactId: artifact.id, category: "14_RELATORIOS", subcategory: "MASTER_REPORT" } });
    expect(dataRoomCopy?.status).toBe("VERIFIED");
    await expect(prisma.studioArtifact.update({ where: { id: artifact.id }, data: { fileName: "overwritten.pdf" } })).rejects.toThrow(/immutable/i);
    await expect(getArtifactDownload({ organizationId: foreignOrganizationId }, artifact.id)).rejects.toThrow(/não encontrado/i);
  }, 60_000);
});
