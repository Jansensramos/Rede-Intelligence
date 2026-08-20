import { createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { AITaskType, MembershipRole } from "@prisma/client";
import { createStudy, createStudyVersion, getLatestStudyForOrganization, getStudyForOrganization } from "../src/application/studies/study-service";
import { ensureDemoLandStudy } from "../src/application/land/land-service";
import { ensureInvestmentCase } from "../src/application/investment/investment-service";
import { generateMasterReport } from "../src/application/investment/studio-service";
import { createMasterReportConfig } from "../src/domain/investment";
import { DEMO_PROJECT, START_BUTANTA_PROJECT } from "../src/domain/financial/demo";
import { prisma } from "../src/infrastructure/database/prisma";
import { AI_PROMPT_VERSION, REDE_AI_SYSTEM_PROMPT } from "../src/domain/ai";
import { ensureDesignWorkspace } from "../src/application/design/design-service";
import { approveBudget, createBudget } from "../src/application/budget/budget-service";
import { START_BUTANTA_BUDGET } from "../src/domain/budget/budget-engine";
import { approveOperationalBaseline, approveSchedule, createOfficialBudgetFromBaseline, createScheduleFromBudget, prepareOperationalBaseline, requestBaselineApproval } from "../src/application/operations/operations-service";

async function main() {
  const passwordHash = await hash("Rede@2026", 12);
  const organization = await prisma.organization.upsert({
    where: { slug: "rede-nucleo-de-negocios" },
    update: { name: "REDE — Núcleo de Negócios" },
    create: {
      name: "REDE — Núcleo de Negócios",
      slug: "rede-nucleo-de-negocios",
      legalName: "REDE Núcleo de Negócios",
    },
  });
  const user = await prisma.user.upsert({
    where: { email: "admin@rede.local" },
    update: { name: "Rafael Lima", passwordHash, isActive: true },
    create: { email: "admin@rede.local", name: "Rafael Lima", passwordHash },
  });
  await prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
    update: { role: MembershipRole.OWNER },
    create: { organizationId: organization.id, userId: user.id, role: MembershipRole.OWNER },
  });
  const context = {
    sessionId: "seed",
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    organizationId: organization.id,
    organizationName: organization.name,
    organizationSlug: organization.slug,
    role: MembershipRole.OWNER,
  };

  const aiTasks = Object.values(AITaskType);
  for (const task of aiTasks) {
    await prisma.aITaskPolicy.upsert({
      where: { organizationId_task: { organizationId: organization.id, task } },
      update: { provider: "rede-deterministic", model: "rede-grounded-v1", enabled: true },
      create: { organizationId: organization.id, task, provider: "rede-deterministic", model: "rede-grounded-v1", maxTokens: task === "REPORT_NARRATIVE" ? 2400 : 1800, temperature: task === "EXTRACTION" || task === "COMPARE" ? 0 : 0.1, enabled: true, createdById: user.id },
    });
  }
  await prisma.aIUsageBudget.upsert({
    where: { organizationId: organization.id },
    update: { monthlyLimit: 0, perUserMonthlyLimit: 0, warningThreshold: 80, maxRequestsPerMinute: 20, maxToolSteps: 8 },
    create: { organizationId: organization.id, monthlyLimit: 0, perUserMonthlyLimit: 0, warningThreshold: 80, currency: "USD", maxRequestsPerMinute: 20, maxToolSteps: 8, createdById: user.id },
  });
  await prisma.aISystemPromptVersion.upsert({
    where: { version: AI_PROMPT_VERSION },
    update: { contentHash: createHash("sha256").update(REDE_AI_SYSTEM_PROMPT).digest("hex"), content: REDE_AI_SYSTEM_PROMPT, active: true },
    create: { version: AI_PROMPT_VERSION, contentHash: createHash("sha256").update(REDE_AI_SYSTEM_PROMPT).digest("hex"), content: REDE_AI_SYSTEM_PROMPT, active: true, createdById: user.id },
  });
  for (const [key, enabled] of [["rede_ai", true], ["external_provider", false], ["document_intelligence", true], ["ai_mutations", true], ["design_intelligence", true]] as const) {
    await prisma.aIFeatureFlag.upsert({
      where: { organizationId_key: { organizationId: organization.id, key } },
      update: { enabled, updatedById: user.id },
      create: { organizationId: organization.id, key, enabled, config: { phase: key === "design_intelligence" ? 8 : 7 }, updatedById: user.id },
    });
  }
  await prisma.aIOrganizationPrompt.deleteMany({ where: { organizationId: organization.id, createdById: user.id } });
  await prisma.aIOrganizationPrompt.createMany({ data: [
    { organizationId: organization.id, category: "COMMITTEE", title: "Briefing para Comitê", prompt: "Prepare o Comitê: sintetize tese, riscos, blockers, condições e decisão pendente.", createdById: user.id },
    { organizationId: organization.id, category: "FINANCE", title: "Stress combinado", prompt: "Simule custo de obra +10%, preço de venda -5% e aprovação +6 meses.", createdById: user.id },
    { organizationId: organization.id, category: "DOCUMENTS", title: "Evidências pendentes", prompt: "Quais documentos faltam e quais conclusões ainda têm baixa confiança?", createdById: user.id },
  ] });

  let study = await getLatestStudyForOrganization(organization.id);
  if (!study) study = await createStudy({ userId: user.id, organizationId: organization.id }, DEMO_PROJECT);
  const latestVersion = await prisma.studyVersion.findUnique({
    where: { id: study.studyVersionId },
    include: {
      policy: true,
      assumptions: { include: { entries: true } },
      scores: true,
      sensitivity: { where: { status: "COMPLETED" } },
      redTeamRuns: { where: { status: "COMPLETED" } },
    },
  });
  if (!latestVersion?.policy || !latestVersion.assumptions?.entries.length || latestVersion.scores.length !== 3 || !latestVersion.sensitivity.length || !latestVersion.redTeamRuns.length) {
    study = await createStudyVersion({ userId: user.id, organizationId: organization.id }, study.projectId, study.studyId, study.assumptions);
  }

  const existingButantaProject = await prisma.project.findUnique({
    where: { organizationId_name: { organizationId: organization.id, name: START_BUTANTA_PROJECT.projectName } },
    include: { studies: { where: { status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, take: 1 } },
  });
  let butantaStudy = existingButantaProject?.studies[0]
    ? await getStudyForOrganization(organization.id, existingButantaProject.studies[0].id)
    : null;
  if (!butantaStudy) butantaStudy = await createStudy(context, START_BUTANTA_PROJECT);
  const butantaBudget = await prisma.budget.findFirst({
    where: { organizationId: organization.id, projectId: butantaStudy.projectId, name: "Orçamento-base START BUTANTÃ" },
  }) ?? await createBudget(context, {
    projectId: butantaStudy.projectId,
    studyVersionId: butantaStudy.studyVersionId,
    name: "Orçamento-base START BUTANTÃ",
    description: "Base demonstrativa compatível com as premissas MCMV do START BUTANTÃ.",
    baseDate: new Date("2026-08-01T00:00:00.000Z"),
    lineItems: START_BUTANTA_BUDGET,
  });

  const economicGroup = await prisma.economicGroup.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: "Grupo REDE — Demonstração" } },
    update: {},
    create: { organizationId: organization.id, name: "Grupo REDE — Demonstração", legalName: "Estrutura econômica demonstrativa", createdById: user.id },
  });
  const company = await prisma.company.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: "START BUTANTÃ SPE — Demonstração" } },
    update: { economicGroupId: economicGroup.id },
    create: { organizationId: organization.id, economicGroupId: economicGroup.id, legalName: "START BUTANTÃ SPE — Demonstração", name: "START BUTANTÃ SPE — Demonstração", type: "SPE", createdById: user.id },
  });
  await prisma.project.update({ where: { id: butantaStudy.projectId }, data: { companyId: company.id } });
  for (const [code, name, managerialAccount] of [
    ["01", "Terreno", "1.01"], ["02", "Projetos", "2.01"], ["03", "Aprovações e regularizações", "3.01"],
    ["04", "Obras", "4.01"], ["05", "Marketing e comercial", "5.01"], ["06", "Administrativo", "6.01"],
    ["07", "Financeiro", "7.01"], ["08", "Jurídico", "8.01"], ["09", "Pós-venda", "9.01"],
  ] as const) {
    const current = await prisma.costCenter.findFirst({ where: { organizationId: organization.id, projectId: butantaStudy.projectId, code } });
    if (!current) await prisma.costCenter.create({ data: { organizationId: organization.id, projectId: butantaStudy.projectId, code, name, managerialAccount, createdById: user.id } });
  }
  for (const unit of [
    { code: "EMP", name: "Empreendimento completo", type: "PHASE" as const, sortOrder: 0 },
    { code: "TOR-A", name: "Torre A", type: "TOWER" as const, sortOrder: 1 },
    { code: "AC", name: "Áreas comuns", type: "COMMON_AREA" as const, sortOrder: 2 },
    { code: "INF", name: "Infraestrutura", type: "INFRASTRUCTURE" as const, sortOrder: 3 },
  ]) await prisma.projectOperatingUnit.upsert({ where: { projectId_code: { projectId: butantaStudy.projectId, code: unit.code } }, update: { name: unit.name, type: unit.type, sortOrder: unit.sortOrder }, create: { projectId: butantaStudy.projectId, createdById: user.id, ...unit } });
  await prisma.materialityPolicy.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: "Política operacional padrão" } },
    update: { isActive: true },
    create: { organizationId: organization.id, name: "Política operacional padrão", informationRate: "0.02", attentionRate: "0.05", relevantRate: "0.10", isActive: true, createdById: user.id },
  });

  let operationalBaseline = await prisma.operationalBaseline.findFirst({ where: { organizationId: organization.id, projectId: butantaStudy.projectId }, orderBy: { version: "desc" } });
  if (!operationalBaseline) operationalBaseline = await prepareOperationalBaseline(context, { projectId: butantaStudy.projectId, studyVersionId: butantaStudy.studyVersionId, name: "Base Aprovada START BUTANTÃ — Demonstração", confirmed: true });
  if (operationalBaseline.status === "PREPARING") operationalBaseline = await requestBaselineApproval(context, operationalBaseline.id);
  if (operationalBaseline.status === "UNDER_APPROVAL") operationalBaseline = await approveOperationalBaseline(context, operationalBaseline.id);
  let officialBudget = await prisma.budget.findFirst({ where: { organizationId: organization.id, operationalBaselineId: operationalBaseline.id }, include: { lineItems: true } });
  if (!officialBudget) officialBudget = await createOfficialBudgetFromBaseline(context, operationalBaseline.id);
  if (officialBudget.status === "DRAFT" || officialBudget.status === "UNDER_REVIEW") officialBudget = await approveBudget(context, officialBudget.id);
  let operationalSchedule = await prisma.operationalSchedule.findFirst({ where: { organizationId: organization.id, projectId: butantaStudy.projectId }, orderBy: { version: "desc" } });
  if (!operationalSchedule) operationalSchedule = await createScheduleFromBudget(context, { budgetId: officialBudget.id, startDate: new Date("2026-09-01T00:00:00.000Z"), endDate: new Date("2029-08-01T00:00:00.000Z"), method: "S_CURVE" });
  if (operationalSchedule.status === "DRAFT" || operationalSchedule.status === "UNDER_REVIEW") operationalSchedule = await approveSchedule(context, operationalSchedule.id);

  await prisma.viabilityStudy.update({ where: { id: study.studyId }, data: { updatedById: user.id } });
  const landStudy = await ensureDemoLandStudy({ userId: user.id, organizationId: organization.id });
  const investmentCase = await ensureInvestmentCase({ userId: user.id, organizationId: organization.id });
  const designWorkspace = await ensureDesignWorkspace({ userId: user.id, organizationId: organization.id }, butantaStudy.projectId);
  const existingMasterReport = await prisma.studioArtifact.findFirst({ where: { investmentCaseId: investmentCase.id, type: "MASTER_REPORT" }, orderBy: { version: "desc" } });
  const demoMasterReport = existingMasterReport
    ? { pageCount: existingMasterReport.pageCount ?? 0, reportId: existingMasterReport.reportId ?? "n/a" }
    : await generateMasterReport({ userId: user.id, organizationId: organization.id }, investmentCase.id, createMasterReportConfig(investmentCase, "FULL_DOSSIER", "INTERNAL"), true);

  const isolatedOrganization = await prisma.organization.upsert({
    where: { slug: "grupo-atlas" },
    update: { name: "Grupo Atlas" },
    create: { name: "Grupo Atlas", slug: "grupo-atlas", legalName: "Grupo Atlas Desenvolvimento Imobiliário" },
  });
  const isolatedUser = await prisma.user.upsert({
    where: { email: "analista@atlas.local" },
    update: { name: "Ana Martins", passwordHash, isActive: true },
    create: { email: "analista@atlas.local", name: "Ana Martins", passwordHash },
  });
  await prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: isolatedOrganization.id, userId: isolatedUser.id } },
    update: { role: MembershipRole.ANALYST },
    create: { organizationId: isolatedOrganization.id, userId: isolatedUser.id, role: MembershipRole.ANALYST },
  });

  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  console.info(`Seed concluído: ${organization.name} · ${user.email} · viabilidade v${study.versionNumber} · START BUTANTÃ v${butantaStudy.versionNumber} · Orçamento ${butantaBudget.id} · Base Aprovada v${operationalBaseline.version} · Orçamento Oficial v${officialBudget.version} (${officialBudget.totalBudget}) · Cronograma v${operationalSchedule.version} · Land v${landStudy.versionNumber} · Investment Case ${investmentCase.id} · Design ${designWorkspace.revision.label} (${designWorkspace.findings.length} findings derivados) · Dossiê ${demoMasterReport.reportId} (${demoMasterReport.pageCount} páginas) · REDE AI ${AI_PROMPT_VERSION} (${aiTasks.length} políticas)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
