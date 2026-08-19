import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Organization, User } from "@prisma/client";
import { calculateProject } from "@/domain/financial/engine";
import { DEMO_PROJECT } from "@/domain/financial/demo";
import { prisma } from "@/infrastructure/database/prisma";
import { createStudy, createStudyVersion, getLatestStudyForOrganization, getRedTeamRunForOrganization, getStudyForOrganization } from "./study-service";
import type { PersistedStudyView } from "./contracts";

describe.skipIf(!process.env.DATABASE_URL).sequential("fundação persistente multiempresa", () => {
  let rede: Organization;
  let atlas: Organization;
  let atlasUser: User;
  let atlasStudy: PersistedStudyView;

  beforeAll(async () => {
    rede = await prisma.organization.findUniqueOrThrow({ where: { slug: "rede-nucleo-de-negocios" } });
    atlas = await prisma.organization.findUniqueOrThrow({ where: { slug: "grupo-atlas" } });
    atlasUser = await prisma.user.findUniqueOrThrow({ where: { email: "analista@atlas.local" } });
  });

  afterAll(async () => prisma.$disconnect());

  it("cria projeto, estudo e versões numeradas para uma organização", async () => {
    atlasStudy = await getLatestStudyForOrganization(atlas.id) ?? await createStudy(
      { userId: atlasUser.id, organizationId: atlas.id },
      { ...DEMO_PROJECT, projectName: "Residencial Atlas", city: "São Paulo" },
    );
    const analyticsCount = await prisma.studyVersion.findUniqueOrThrow({
      where: { id: atlasStudy.studyVersionId },
      select: { _count: { select: { scores: true, sensitivity: true, redTeamRuns: true } } },
    });
    if (atlasStudy.versionNumber < 2 || analyticsCount._count.scores !== 3 || analyticsCount._count.sensitivity !== 1 || analyticsCount._count.redTeamRuns !== 1) {
      atlasStudy = await createStudyVersion(
        { userId: atlasUser.id, organizationId: atlas.id },
        atlasStudy.projectId,
        atlasStudy.studyId,
        { ...atlasStudy.assumptions, unitPrice: "410000" },
      );
    }
    const project = await prisma.project.findUnique({ where: { id: atlasStudy.projectId }, include: { studies: { include: { versions: true } } } });
    expect(project?.organizationId).toBe(atlas.id);
    expect(project?.studies).toHaveLength(1);
    expect(project?.studies[0].versions.length).toBeGreaterThanOrEqual(2);
    expect(project?.studies[0].versions.every((version) => version.status === "SNAPSHOT" && version.lockedAt)).toBe(true);
  });

  it("impede IDOR entre organizações no acesso por ID", async () => {
    const redeStudy = await getLatestStudyForOrganization(rede.id);
    expect(redeStudy?.assumptions.projectName).toBe("Residencial Horizonte");
    expect(await getStudyForOrganization(rede.id, redeStudy!.studyId)).not.toBeNull();
    expect(await getStudyForOrganization(atlas.id, redeStudy!.studyId)).toBeNull();
  });

  it("persiste premissas estruturadas e somente deltas por cenário", async () => {
    const version = await prisma.studyVersion.findFirstOrThrow({
      where: { status: "SNAPSHOT", study: { project: { organizationId: rede.id } }, policyId: { not: null } },
      orderBy: { versionNumber: "desc" },
      include: {
        policy: true,
        assumptions: { include: { entries: true } },
        scenarios: { include: { overrides: true } },
      },
    });
    expect(version.policy).not.toBeNull();
    expect(version.assumptions?.entries.length).toBeGreaterThanOrEqual(30);
    expect(version.assumptions?.entries.every((entry) => entry.key && entry.category && entry.unit)).toBe(true);
    expect(version.scenarios).toHaveLength(3);
    expect(version.scenarios.find((scenario) => scenario.kind === "BASE")?.overrides).toHaveLength(0);
    expect(version.scenarios.find((scenario) => scenario.kind === "CONSERVATIVE")?.overrides.length).toBeGreaterThanOrEqual(5);
    expect(version.scenarios.find((scenario) => scenario.kind === "AGGRESSIVE")?.overrides.length).toBeGreaterThanOrEqual(5);
  });

  it("persiste resultados extensíveis, fluxo, alertas e trilha por cenário", async () => {
    const version = await prisma.studyVersion.findFirstOrThrow({
      where: { status: "SNAPSHOT", study: { project: { organizationId: rede.id } }, policyId: { not: null } },
      orderBy: { versionNumber: "desc" },
      include: {
        runs: {
          include: { result: true, metrics: true, cashFlow: true, findings: true, recommendations: true, traces: true },
        },
      },
    });
    expect(version.runs).toHaveLength(3);
    expect(version.runs.every((run) => run.result && run.cashFlow.length > 0 && run.findings.length > 0 && run.recommendations.length === 1 && run.traces.length > 0)).toBe(true);
    expect(version.runs.every((run) => run.metrics.some((metric) => metric.key === "fundingNeed") && run.metrics.some((metric) => metric.key === "vgv"))).toBe(true);
    expect(version.runs.flatMap((run) => run.findings).every((finding) => finding.code && finding.description && finding.scenarioId)).toBe(true);
  });

  it("mantém no banco os mesmos indicadores do cenário Base", async () => {
    const latest = await getLatestStudyForOrganization(rede.id);
    const expected = calculateProject(latest!.assumptions, "base", "2026-08-17T12:00:00.000Z");
    const run = await prisma.calculationRun.findFirstOrThrow({
      where: { studyVersionId: latest!.studyVersionId, scenario: { kind: "BASE" } },
      include: { result: true },
    });
    expect(run.result?.vgv.toNumber()).toBeCloseTo(Number(expected.metrics.vgv), 2);
    expect(run.result?.profit.toNumber()).toBeCloseTo(Number(expected.metrics.profit), 2);
    expect(run.result?.marginOnVgv.toNumber()).toBeCloseTo(Number(expected.metrics.marginOnVgv), 8);
    expect(run.result?.fundingNeed.toNumber()).toBeCloseTo(Number(expected.metrics.fundingNeed), 2);
  });

  it("persiste REDE Score explicável e a matriz de sensibilidade do snapshot", async () => {
    const latest = await getLatestStudyForOrganization(rede.id);
    const version = await prisma.studyVersion.findUniqueOrThrow({
      where: { id: latest!.studyVersionId },
      include: {
        scores: { include: { dimensions: true, rules: true, scenario: true } },
        sensitivity: { include: { cases: true, breakEvens: true, stressTests: true } },
      },
    });
    expect(version.scores).toHaveLength(3);
    expect(version.scores.every((score) => score.dimensions.length === 6 && score.rules.length === 30 && score.scenarioId)).toBe(true);
    expect(version.sensitivity).toHaveLength(1);
    expect(version.sensitivity[0].cases).toHaveLength(30);
    expect(version.sensitivity[0].breakEvens).toHaveLength(4);
    expect(version.sensitivity[0].stressTests).toHaveLength(3);
    expect(latest!.analytics.scores.base.totalScore).toBe(version.scores.find((score) => score.scenario.kind === "BASE")?.globalScore.toNumber());
    expect(latest!.analytics.sensitivity.ranking).toHaveLength(8);
  });

  it("persiste Evidence Pack, especialistas, provenance e síntese do Red Team", async () => {
    const latest = await getLatestStudyForOrganization(rede.id);
    const run = await prisma.redTeamRun.findFirstOrThrow({
      where: { studyVersionId: latest!.studyVersionId, status: "COMPLETED" },
      include: {
        agents: true,
        evidenceItems: true,
        findings: { include: { evidenceLinks: true } },
        assumptionChallenges: true,
        evidenceRequests: true,
        crossReviews: true,
        disagreements: true,
        executiveConclusion: true,
      },
    });
    expect(run.organizationId).toBe(rede.id);
    expect(run.agents).toHaveLength(6);
    expect(run.findings.length).toBeGreaterThanOrEqual(15);
    expect(run.findings.every((finding) => finding.evidenceLinks.length > 0)).toBe(true);
    expect(run.evidenceItems.some((item) => item.ref === "ENGINE.maximumCashExposure")).toBe(true);
    expect(run.assumptionChallenges).toHaveLength(6);
    expect(run.evidenceRequests).toHaveLength(9);
    expect(run.crossReviews.length).toBe(run.findings.filter((finding) => ["HIGH", "CRITICAL"].includes(finding.severity)).length);
    expect(run.executiveConclusion?.decision).toBe("RESTRUCTURE");
    expect(latest!.redTeam?.conclusion.decision).toBe("RESTRUCTURE");
  });

  it("isola RedTeamRun por Organization mesmo quando o ID é conhecido", async () => {
    const run = await prisma.redTeamRun.findFirstOrThrow({ where: { organizationId: rede.id } });
    expect(await getRedTeamRunForOrganization(rede.id, run.id)).not.toBeNull();
    expect(await getRedTeamRunForOrganization(atlas.id, run.id)).toBeNull();
  });

  it("rejeita mutação da versão, premissas e deltas de um SNAPSHOT", async () => {
    const version = await prisma.studyVersion.findFirstOrThrow({
      where: { status: "SNAPSHOT", policyId: { not: null } },
      include: { assumptions: { include: { entries: { take: 1 } } }, scenarios: { include: { overrides: { take: 1 } } } },
    });
    const entry = version.assumptions!.entries[0];
    const override = version.scenarios.flatMap((scenario) => scenario.overrides)[0];
    await expect(prisma.studyVersion.update({ where: { id: version.id }, data: { label: "mutação indevida" } })).rejects.toThrow(/immutable/i);
    await expect(prisma.assumptionEntry.update({ where: { id: entry.id }, data: { notes: "mutação indevida" } })).rejects.toThrow(/immutable/i);
    await expect(prisma.scenarioAssumptionOverride.update({ where: { id: override.id }, data: { notes: "mutação indevida" } })).rejects.toThrow(/immutable/i);
  });

  it("rejeita mutação dos detalhes de Score e sensibilidade publicados", async () => {
    const version = await prisma.studyVersion.findFirstOrThrow({
      where: { status: "SNAPSHOT", scores: { some: {} }, sensitivity: { some: {} } },
      include: {
        scores: { take: 1, include: { dimensions: { take: 1 } } },
        sensitivity: { take: 1, include: { cases: { take: 1 } } },
      },
    });
    await expect(prisma.scoreDimension.update({ where: { id: version.scores[0].dimensions[0].id }, data: { name: "mutação indevida" } })).rejects.toThrow(/immutable/i);
    await expect(prisma.sensitivityCase.update({ where: { id: version.sensitivity[0].cases[0].id }, data: { label: "mutação indevida" } })).rejects.toThrow(/immutable/i);
  });

  it("rejeita mutação de findings e provenance do Red Team publicado", async () => {
    const run = await prisma.redTeamRun.findFirstOrThrow({
      where: { studyVersion: { status: "SNAPSHOT" } },
      include: { findings: { take: 1, include: { evidenceLinks: { take: 1 } } } },
    });
    const finding = run.findings[0];
    await expect(prisma.redTeamFinding.update({ where: { id: finding.id }, data: { title: "mutação indevida" } })).rejects.toThrow(/immutable/i);
    await expect(prisma.redTeamFindingEvidence.update({ where: { id: finding.evidenceLinks[0].id }, data: { evidenceRef: "ENGINE.invented" } })).rejects.toThrow(/immutable/i);
  });

  it("registra autoria e eventos essenciais de auditoria", async () => {
    const actions = await prisma.auditLog.findMany({ where: { organizationId: atlas.id }, select: { action: true } });
    expect(actions.map(({ action }) => action)).toEqual(expect.arrayContaining([
      "PROJECT_CREATED",
      "STUDY_CREATED",
      "STUDY_VERSION_DRAFT_CREATED",
      "ASSUMPTIONS_SNAPSHOTTED",
      "STUDY_SNAPSHOT_CREATED",
      "SENSITIVITY_COMPLETED",
      "REDE_SCORE_CALCULATED",
      "RED_TEAM_COMPLETED",
    ]));
  });
});
