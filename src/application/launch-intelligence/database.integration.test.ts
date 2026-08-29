import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MembershipRole } from "@prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import { createLaunchTrigger, decideLaunch, getLaunchIntelligenceWorkspace, registerMacroObservation, type LaunchIntelligenceContext } from "./launch-intelligence-service";

describe.sequential("Fase 9O no PostgreSQL real", () => {
  const suffix = randomUUID().slice(0, 8);
  let owner: LaunchIntelligenceContext;
  let analyst: LaunchIntelligenceContext;
  let reviewer: LaunchIntelligenceContext;
  let viewer: LaunchIntelligenceContext;
  let foreign: LaunchIntelligenceContext;
  let projectId = "";
  let initialObservationId = "";
  let evaluationId = "";
  let budgetCount = 0;
  let baselineCount = 0;
  let fundingCount = 0;

  async function member(organizationId: string, role: MembershipRole, label: string): Promise<LaunchIntelligenceContext> {
    const user = await prisma.user.create({ data: { email: `launch-${label}-${suffix}@test.local`, name: `Teste 9O ${label}`, passwordHash: "teste-sem-login" } });
    await prisma.organizationMembership.create({ data: { organizationId, userId: user.id, role } });
    return { organizationId, userId: user.id, role };
  }

  beforeAll(async () => {
    const organization = await prisma.organization.create({ data: { name: `Teste 9O ${suffix}`, slug: `teste-9o-${suffix}` } });
    owner = await member(organization.id, "OWNER", "owner");
    analyst = await member(organization.id, "ANALYST", "analyst");
    reviewer = await member(organization.id, "REVIEWER", "reviewer");
    viewer = await member(organization.id, "VIEWER", "viewer");
    const foreignOrganization = await prisma.organization.create({ data: { name: `Teste 9O Estrangeiro ${suffix}`, slug: `teste-9o-estrangeiro-${suffix}` } });
    foreign = await member(foreignOrganization.id, "OWNER", "foreign");
    const project = await prisma.project.create({ data: { organizationId: organization.id, name: `Empreendimento 9O ${suffix}`, city: "São Paulo", state: "SP", createdById: owner.userId, updatedById: owner.userId } });
    projectId = project.id;
    [budgetCount, baselineCount, fundingCount] = await Promise.all([
      prisma.budget.count({ where: { organizationId: organization.id } }),
      prisma.operationalBaseline.count({ where: { organizationId: organization.id } }),
      prisma.fundingProposal.count({ where: { organizationId: organization.id } }),
    ]);
  });

  afterAll(async () => prisma.$disconnect());

  it("aplica RBAC e registra correções macro append-only com replay idempotente", async () => {
    const input = { code: "SELIC" as const, referenceDate: new Date("2026-08-01"), collectedAt: new Date("2026-08-20T12:00:00Z"), regionLevel: "STATE" as const, regionCode: "BR-SP", rawValue: 10, rawUnit: "% a.a.", normalizationKey: "IDENTITY" as const, sourceProvider: "Fonte de teste", sourceMethod: "Importação estruturada", confidenceLevel: "HIGH" as const, provenance: { test: true } };
    await expect(registerMacroObservation(viewer, input)).rejects.toThrow(/autorização/i);
    const initial = await registerMacroObservation(analyst, input);
    const replay = await registerMacroObservation(analyst, input);
    expect(replay.id).toBe(initial.id);
    initialObservationId = initial.id;

    const correction = await registerMacroObservation(analyst, { ...input, rawValue: 10.25, collectedAt: new Date("2026-08-21T12:00:00Z") });
    expect(correction.previousObservationId).toBe(initial.id);
    expect(correction.revision).toBe(2);
    expect(correction.isCorrection).toBe(true);
    await expect(prisma.macroIndicatorObservation.update({ where: { id: initial.id }, data: { rawValue: 99 } })).rejects.toThrow(/append-only/i);
  });

  it("isola o workspace por organização", async () => {
    await expect(getLaunchIntelligenceWorkspace(foreign, projectId)).rejects.toThrow(/não encontrado/i);
    const workspace = await getLaunchIntelligenceWorkspace(owner, projectId);
    expect(workspace.project.id).toBe(projectId);
    expect(workspace.macro.find((item) => item.code === "SELIC")?.observation?.revision).toBe(2);
  });

  it("versiona configuração de gatilho e impede VIEWER de configurá-la", async () => {
    const input = { projectId, code: "MARGEM-MINIMA", metricKey: "MARGEM_VGV" as const, operator: "LT" as const, thresholdValue: 20, rationale: "Revisar o lançamento quando a margem ficar abaixo do limite." };
    await expect(createLaunchTrigger(viewer, input)).rejects.toThrow(/autorização/i);
    const first = await createLaunchTrigger(owner, input);
    const second = await createLaunchTrigger(owner, { ...input, thresholdValue: 22 });
    expect(second.previousTriggerId).toBe(first.id);
    expect(second.version).toBe(2);
    expect((await prisma.launchTrigger.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("SUPERSEDED");
  });

  it("preserva avaliação e decisão humana imutáveis", async () => {
    const scenario = await prisma.launchScenario.create({ data: { organizationId: owner.organizationId, projectId, seriesKey: `test:${suffix}`, name: "Cenário de teste", kind: "BASE", rationale: "Cenário isolado para validar a memória imutável.", referenceDate: new Date("2026-08-28"), createdById: owner.userId } });
    await prisma.launchScenario.update({ where: { id: scenario.id }, data: { status: "CALCULATED" } });
    const evaluation = await prisma.launchEvaluation.create({ data: { organizationId: owner.organizationId, projectId, scenarioId: scenario.id, recommendation: "LAUNCH_WITH_CONDITIONS", confidenceLevel: "MEDIUM", confidenceScore: 0.7, favorableFactors: ["Teste favorável"], unfavorableFactors: ["Teste desfavorável"], criticalFactors: [], missingEvidence: [], economicImpactSnapshot: { metrics: { marginOnVgv: "0.25" } }, indicatorSnapshot: {}, conditionsForChange: ["Atualizar evidência"], engineVersion: "9O.test", inputChecksum: randomUUID(), createdById: owner.userId } });
    evaluationId = evaluation.id;
    await prisma.launchScenario.update({ where: { id: scenario.id }, data: { status: "LOCKED", lockedAt: new Date() } });

    await expect(decideLaunch(viewer, { evaluationId, humanDecision: "WAIT", rationale: "Viewer não possui alçada para decidir.", evidenceRefs: [] })).rejects.toThrow(/autorização/i);
    const input = { evaluationId, humanDecision: "LAUNCH_WITH_CONDITIONS" as const, rationale: "Aprovado com condicionantes registradas pelo comitê.", evidenceRefs: [evaluationId] };
    const decision = await decideLaunch(reviewer, input);
    expect((await decideLaunch(reviewer, input)).id).toBe(decision.id);
    await expect(decideLaunch(reviewer, { ...input, humanDecision: "WAIT", rationale: "Tentativa de mudar a decisão existente." })).rejects.toThrow(/novo ciclo/i);
    await expect(prisma.launchEvaluation.update({ where: { id: evaluationId }, data: { confidenceScore: 0.1 } })).rejects.toThrow(/append-only/i);
    await expect(prisma.launchDecision.update({ where: { id: decision.id }, data: { rationale: "Alteração indevida" } })).rejects.toThrow(/append-only/i);
  });

  it("impede versão sem cenário anterior travado e protege conteúdo travado contra alteração ou exclusão", async () => {
    const draftScenario = await prisma.launchScenario.create({ data: { organizationId: owner.organizationId, projectId, seriesKey: `lineage-draft:${suffix}`, name: "Cenário rascunho", kind: "BASE", rationale: "Cenário para testar o guard de lineage.", referenceDate: new Date("2026-08-28"), createdById: owner.userId } });
    await expect(prisma.launchScenario.create({ data: { organizationId: owner.organizationId, projectId, seriesKey: `lineage-draft:${suffix}`, version: 2, previousScenarioId: draftScenario.id, name: "Versão 2 indevida", kind: "BASE", status: "DRAFT", rationale: "Não deveria ser permitido sem lock anterior.", referenceDate: new Date("2026-08-28"), createdById: owner.userId } })).rejects.toThrow(/locked/i);

    const scenarioA = await prisma.launchScenario.create({ data: { organizationId: owner.organizationId, projectId, seriesKey: `lineage-locked:${suffix}`, name: "Cenário A", kind: "BASE", rationale: "Cenário para testar imutabilidade após o lock.", referenceDate: new Date("2026-08-28"), createdById: owner.userId } });
    await prisma.launchScenario.update({ where: { id: scenarioA.id }, data: { status: "CALCULATED" } });
    await prisma.launchScenario.update({ where: { id: scenarioA.id }, data: { status: "LOCKED", lockedAt: new Date() } });

    await expect(prisma.launchScenario.update({ where: { id: scenarioA.id }, data: { name: "Nome alterado indevidamente" } })).rejects.toThrow(/immutable/i);
    await expect(prisma.launchScenario.delete({ where: { id: scenarioA.id } })).rejects.toThrow(/deleted/i);
  });

  it("não escreve automaticamente em Orçamento, Base Aprovada ou Funding", async () => {
    const counts = await Promise.all([
      prisma.budget.count({ where: { organizationId: owner.organizationId } }),
      prisma.operationalBaseline.count({ where: { organizationId: owner.organizationId } }),
      prisma.fundingProposal.count({ where: { organizationId: owner.organizationId } }),
    ]);
    expect(counts).toEqual([budgetCount, baselineCount, fundingCount]);
    expect(initialObservationId).not.toBe("");
    expect(evaluationId).not.toBe("");
  });
});
