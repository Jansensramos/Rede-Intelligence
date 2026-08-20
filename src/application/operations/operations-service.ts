import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import {
  buildBudgetBridge,
  buildProjectedCashFlow,
  distributeLinear,
  distributeSCurve,
  scheduleIndicators,
  validateDependencies,
  validateScheduleIntegrity,
  type EconomicValue,
  type MaterialityBand,
  type ScheduleActivityInput,
} from "@/domain/operations/operations-engine";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const canonical = (value: unknown) => JSON.stringify(value, Object.keys(value as object).sort());
const checksum = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const mutableRoles = new Set(["OWNER", "ADMIN", "ANALYST"]);
const approvalRoles = new Set(["OWNER", "ADMIN"]);

function assertMutable(context: AuthContext) {
  if (!mutableRoles.has(context.role)) throw new Error("Seu perfil não pode alterar a estrutura operacional.");
}

function assertApprover(context: AuthContext) {
  if (!approvalRoles.has(context.role)) throw new Error("Somente Administrador ou Owner pode aprovar.");
}

async function projectForTenant(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  return project;
}

function auditData(context: AuthContext, projectId: string, action: string, entityType: string, entityId: string, after?: unknown, before?: unknown) {
  return { organizationId: context.organizationId, userId: context.userId, projectId, action, entityType, entityId, before: before === undefined ? undefined : json(before), after: after === undefined ? undefined : json(after) };
}

export async function prepareOperationalBaseline(context: AuthContext, input: { projectId: string; studyVersionId: string; name?: string; reason?: string; previousBaselineId?: string; confirmed: boolean }) {
  assertMutable(context);
  if (!input.confirmed) throw new Error("Confirme explicitamente o congelamento da Base Aprovada.");
  const project = await projectForTenant(context.organizationId, input.projectId);
  const version = await prisma.studyVersion.findFirst({
    where: { id: input.studyVersionId, study: { projectId: input.projectId, project: { organizationId: context.organizationId } } },
    include: { assumptions: true, runs: { orderBy: { createdAt: "desc" }, take: 1, include: { result: true } }, scores: { orderBy: { createdAt: "desc" }, take: 1 }, study: true },
  });
  if (!version?.assumptions) throw new Error("A versão selecionada não possui premissas congeladas.");
  if (input.previousBaselineId && !input.reason?.trim()) throw new Error("Informe o motivo da nova Base Aprovada.");
  const previous = input.previousBaselineId
    ? await prisma.operationalBaseline.findFirst({ where: { id: input.previousBaselineId, projectId: input.projectId, organizationId: context.organizationId } })
    : null;
  if (input.previousBaselineId && !previous) throw new Error("Base anterior não encontrada neste empreendimento.");
  const sourceBudget = await prisma.budget.findFirst({
    where: { projectId: input.projectId, organizationId: context.organizationId, OR: [{ studyVersionId: input.studyVersionId }, { studyVersionId: null }] },
    orderBy: [{ version: "desc" }, { updatedAt: "desc" }],
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  });
  const sourceLines = sourceBudget?.lineItems.map((line) => ({
    code: line.code ?? `BASE-${line.sortOrder + 1}`,
    category: line.category,
    description: line.description,
    value: Number(line.totalCost),
    origin: "APPROVED_BASE" as const,
    evidence: { source: "ORCAMENTO_DEMONSTRATIVO_DERIVADO", budgetId: sourceBudget.id, budgetLineItemId: line.id },
  })) ?? [];
  if (sourceLines.length === 0) throw new Error("Não há estrutura econômica determinística para gerar a Base Aprovada.");
  const latest = await prisma.operationalBaseline.aggregate({ where: { projectId: input.projectId }, _max: { version: true } });
  const versionNumber = (latest._max.version ?? 0) + 1;
  const assumptions = version.assumptions;
  const frozenContent = {
    source: { studyId: version.studyId, studyVersionId: version.id, studyVersionNumber: version.versionNumber, inputHash: version.inputHash, engineVersion: version.engineVersion },
    assumptions: {
      vgv: Number(assumptions.unitPrice) * assumptions.units,
      units: assumptions.units,
      unitPrice: Number(assumptions.unitPrice),
      landPrice: Number(assumptions.landPrice),
      constructionCostPerM2: Number(assumptions.constructionCostPerM2),
      grossBuiltAreaM2: assumptions.grossBuiltAreaM2 ? Number(assumptions.grossBuiltAreaM2) : null,
      approvalMonths: assumptions.approvalMonths,
      constructionMonths: assumptions.constructionMonths,
      taxRate: Number(assumptions.taxRate),
      commissionRate: Number(assumptions.commissionRate),
      marketingRate: Number(assumptions.marketingRate),
      paymentCurve: { downPaymentRate: Number(assumptions.downPaymentRate), duringConstructionRate: Number(assumptions.duringConstructionRate), onDeliveryRate: Number(assumptions.onDeliveryRate) },
    },
    calculationRun: version.runs[0]?.result?.payload ?? null,
    score: version.scores[0]?.globalScore ? Number(version.scores[0].globalScore) : null,
  };
  const totals = sourceLines.reduce<Record<string, number>>((result, line) => {
    result[line.category] = Math.round(((result[line.category] ?? 0) + line.value) * 100) / 100;
    return result;
  }, {});
  const hash = checksum({ frozenContent, sourceLines, versionNumber, previousBaselineId: previous?.id ?? null });
  return prisma.$transaction(async (tx) => {
    const baseline = await tx.operationalBaseline.create({
      data: {
        organizationId: context.organizationId,
        companyId: project.companyId,
        projectId: project.id,
        studyVersionId: version.id,
        previousBaselineId: previous?.id,
        version: versionNumber,
        name: input.name?.trim() || `Base Aprovada v${versionNumber}`,
        reason: input.reason?.trim() || null,
        content: json(frozenContent), totals: json(totals), checksum: hash, createdById: context.userId,
        lines: { create: sourceLines.map((line) => ({ ...line, value: new Prisma.Decimal(line.value), evidence: json(line.evidence) })) },
      }, include: { lines: true },
    });
    await tx.auditLog.create({ data: auditData(context, project.id, "OPERATIONAL_BASELINE_PREPARED", "OperationalBaseline", baseline.id, { version: baseline.version, checksum: baseline.checksum, studyVersionId: version.id }) });
    return baseline;
  });
}

export async function requestBaselineApproval(context: AuthContext, baselineId: string) {
  assertMutable(context);
  const baseline = await prisma.operationalBaseline.findFirst({ where: { id: baselineId, organizationId: context.organizationId }, include: { lines: true } });
  if (!baseline || baseline.status !== "PREPARING") throw new Error("Somente uma Base em preparação pode ser enviada para aprovação.");
  if (!baseline.lines.length) throw new Error("A Base Aprovada não possui itens econômicos.");
  const updated = await prisma.operationalBaseline.update({ where: { id: baseline.id }, data: { status: "UNDER_APPROVAL", requestedAt: new Date() } });
  await prisma.auditLog.create({ data: auditData(context, baseline.projectId, "OPERATIONAL_BASELINE_REQUESTED", "OperationalBaseline", baseline.id, { status: updated.status }) });
  return updated;
}

export async function approveOperationalBaseline(context: AuthContext, baselineId: string) {
  assertApprover(context);
  const baseline = await prisma.operationalBaseline.findFirst({ where: { id: baselineId, organizationId: context.organizationId } });
  if (!baseline || baseline.status !== "UNDER_APPROVAL") throw new Error("A Base precisa estar em aprovação.");
  return prisma.$transaction(async (tx) => {
    await tx.operationalBaseline.updateMany({ where: { projectId: baseline.projectId, status: "APPROVED", id: { not: baseline.id } }, data: { status: "SUPERSEDED" } });
    const approved = await tx.operationalBaseline.update({ where: { id: baseline.id }, data: { status: "APPROVED", approvedById: context.userId, approvedAt: new Date() }, include: { lines: true } });
    await tx.auditLog.create({ data: auditData(context, baseline.projectId, "OPERATIONAL_BASELINE_APPROVED", "OperationalBaseline", baseline.id, { status: approved.status, checksum: approved.checksum }) });
    return approved;
  });
}

export async function createOfficialBudgetFromBaseline(context: AuthContext, baselineId: string) {
  assertMutable(context);
  const baseline = await prisma.operationalBaseline.findFirst({ where: { id: baselineId, organizationId: context.organizationId, status: "APPROVED" }, include: { lines: true, project: true } });
  if (!baseline) throw new Error("Use uma Base Aprovada da organização atual.");
  const existing = await prisma.budget.findFirst({ where: { operationalBaselineId: baseline.id }, include: { lineItems: true } });
  if (existing) return existing;
  const economicItems = await prisma.$transaction(async (tx) => Promise.all(baseline.lines.map((line) => tx.economicItem.upsert({
    where: { projectId_code: { projectId: baseline.projectId, code: line.code } },
    update: {},
    create: { organizationId: context.organizationId, projectId: baseline.projectId, code: line.code, description: line.description, category: line.category, unit: "VB", createdById: context.userId },
  }))));
  const budget = await prisma.budget.create({
    data: {
      organizationId: context.organizationId, projectId: baseline.projectId, companyId: baseline.companyId,
      studyVersionId: baseline.studyVersionId, operationalBaselineId: baseline.id,
      name: "Orçamento Oficial", description: "Estrutura inicial derivada da Base Aprovada.", kind: "OFFICIAL", status: "DRAFT",
      currency: baseline.project.currency, baseDate: new Date(), version: 1,
      totalBudget: baseline.lines.reduce((sum, line) => sum.add(line.value), new Prisma.Decimal(0)),
      createdById: context.userId, updatedById: context.userId,
      lineItems: { create: baseline.lines.map((line, index) => ({
        economicItemId: economicItems[index].id, code: line.code, description: line.description, category: line.category,
        phase: "Empreendimento", unit: "VB", quantity: 1, unitCost: line.value, totalCost: line.value,
        sortOrder: index, origin: "APPROVED_BASE", costOrigin: "APPROVED_BASE",
      })) },
    }, include: { lineItems: true },
  });
  await prisma.auditLog.create({ data: auditData(context, baseline.projectId, "OFFICIAL_BUDGET_CREATED_FROM_BASELINE", "Budget", budget.id, { baselineId, totalBudget: budget.totalBudget.toString() }) });
  return budget;
}

export async function createBudgetRevision(context: AuthContext, budgetId: string, reason: string) {
  assertMutable(context);
  if (!reason.trim()) throw new Error("Informe o motivo da revisão.");
  const source = await prisma.budget.findFirst({ where: { id: budgetId, organizationId: context.organizationId }, include: { lineItems: { include: { laborComposition: true } } } });
  if (!source || !["APPROVED", "OFFICIAL"].includes(source.status)) throw new Error("Somente orçamento aprovado ou oficial pode gerar revisão.");
  return prisma.$transaction(async (tx) => {
    const revision = await tx.budget.create({ data: {
      organizationId: source.organizationId, projectId: source.projectId, companyId: source.companyId, studyVersionId: source.studyVersionId,
      operationalBaselineId: source.operationalBaselineId, previousBudgetId: source.id, name: source.name, description: source.description,
      kind: "REVISED", status: "DRAFT", currency: source.currency, baseDate: new Date(), version: source.version + 1,
      totalBudget: source.totalBudget, revisionReason: reason.trim(), createdById: context.userId, updatedById: context.userId,
    } });
    const idMap = new Map<string, string>();
    const pending = [...source.lineItems];
    while (pending.length) {
      const index = pending.findIndex((line) => !line.parentId || idMap.has(line.parentId));
      if (index < 0) throw new Error("A EAP original possui ciclo ou referência inválida.");
      const [line] = pending.splice(index, 1);
      const created = await tx.budgetLineItem.create({ data: {
        budgetId: revision.id, parentId: line.parentId ? idMap.get(line.parentId) : null,
        economicItemId: line.economicItemId, costCenterId: line.costCenterId, operatingUnitId: line.operatingUnitId,
        responsibleId: line.responsibleId, code: line.code, description: line.description, category: line.category,
        subcategory: line.subcategory, phase: line.phase, unit: line.unit, quantity: line.quantity, unitCost: line.unitCost,
        totalCost: line.totalCost, sortOrder: line.sortOrder, costCenter: line.costCenter, tower: line.tower,
        origin: line.origin, costOrigin: line.costOrigin, status: "PLANNED", startDate: line.startDate, endDate: line.endDate, notes: line.notes,
      } });
      idMap.set(line.id, created.id);
      if (line.laborComposition) await tx.budgetLaborComposition.create({ data: {
        budgetLineItemId: created.id, roleName: line.laborComposition.roleName, headcount: line.laborComposition.headcount,
        monthlyCost: line.laborComposition.monthlyCost, burdenRate: line.laborComposition.burdenRate,
        monthlyBenefits: line.laborComposition.monthlyBenefits, months: line.laborComposition.months, totalCost: line.laborComposition.totalCost,
      } });
    }
    await tx.auditLog.create({ data: auditData(context, source.projectId, "BUDGET_REVISION_CREATED", "Budget", revision.id, { previousBudgetId: source.id, version: revision.version, reason: reason.trim() }) });
    return tx.budget.findUniqueOrThrow({ where: { id: revision.id }, include: { lineItems: true } });
  });
}

export async function justifyBudgetVariance(context: AuthContext, input: { budgetId: string; category: string; reason: string; baselineValue: number; budgetValue: number; economicItemId?: string; baselineLineId?: string }) {
  assertMutable(context);
  if (!input.reason.trim()) throw new Error("Informe a justificativa do desvio.");
  const budget = await prisma.budget.findFirst({ where: { id: input.budgetId, organizationId: context.organizationId }, select: { id: true, projectId: true } });
  if (!budget) throw new Error("Orçamento não encontrado nesta organização.");
  const justification = await prisma.budgetVarianceJustification.create({ data: {
    budgetId: budget.id, category: input.category.trim(), reason: input.reason.trim(), baselineValue: input.baselineValue,
    budgetValue: input.budgetValue, economicItemId: input.economicItemId, baselineLineId: input.baselineLineId, createdById: context.userId,
  } });
  await prisma.auditLog.create({ data: auditData(context, budget.projectId, "BUDGET_VARIANCE_JUSTIFIED", "BudgetVarianceJustification", justification.id, input) });
  return justification;
}

function monthPeriods(start: Date, end: Date) {
  if (end < start) throw new Error("A data final não pode ser anterior à inicial.");
  const result: string[] = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const limit = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= limit) {
    result.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return result;
}

export async function createScheduleFromBudget(context: AuthContext, input: { budgetId: string; name?: string; startDate: Date; endDate: Date; method?: "LINEAR" | "S_CURVE" }) {
  assertMutable(context);
  const budget = await prisma.budget.findFirst({ where: { id: input.budgetId, organizationId: context.organizationId }, include: { lineItems: true } });
  if (!budget || !["APPROVED", "OFFICIAL"].includes(budget.status)) throw new Error("Aprove o Orçamento Oficial antes de criar o cronograma.");
  const periods = monthPeriods(input.startDate, input.endDate);
  const method = input.method ?? "S_CURVE";
  const latest = await prisma.operationalSchedule.aggregate({ where: { projectId: budget.projectId, name: input.name ?? "Cronograma Físico-Financeiro" }, _max: { version: true } });
  const schedule = await prisma.operationalSchedule.create({
    data: {
      organizationId: context.organizationId, companyId: budget.companyId, projectId: budget.projectId, budgetId: budget.id,
      name: input.name ?? "Cronograma Físico-Financeiro", version: (latest._max.version ?? 0) + 1, baseDate: input.startDate, createdById: context.userId,
      activities: { create: budget.lineItems.filter((line) => !budget.lineItems.some((candidate) => candidate.parentId === line.id)).map((line, index) => {
        const allocations = method === "LINEAR" ? distributeLinear(Number(line.totalCost), periods) : distributeSCurve(Number(line.totalCost), periods);
        return {
          economicItemId: line.economicItemId, budgetLineItemId: line.id, operatingUnitId: line.operatingUnitId,
          code: line.code ?? `ATV-${index + 1}`, name: line.description, startDate: input.startDate, endDate: input.endDate,
          plannedCost: line.totalCost, distributionMethod: method, sortOrder: index,
          allocations: { create: allocations.map((allocation) => ({
            periodStart: new Date(`${allocation.period}-01T00:00:00.000Z`), physicalPercent: new Prisma.Decimal(allocation.physicalPercentage).div(100),
            financialPercent: Number(line.totalCost) === 0 ? 0 : new Prisma.Decimal(allocation.financialValue).div(line.totalCost), plannedDisbursement: allocation.financialValue,
          })) },
        };
      }) },
    }, include: { activities: { include: { allocations: true } } },
  });
  await prisma.auditLog.create({ data: auditData(context, budget.projectId, "OPERATIONAL_SCHEDULE_CREATED", "OperationalSchedule", schedule.id, { budgetId: budget.id, version: schedule.version, periods: periods.length, method }) });
  return schedule;
}

export async function approveSchedule(context: AuthContext, scheduleId: string) {
  assertApprover(context);
  const schedule = await prisma.operationalSchedule.findFirst({ where: { id: scheduleId, organizationId: context.organizationId }, include: { activities: { include: { allocations: true, predecessors: true, successors: true } } } });
  if (!schedule || !["DRAFT", "UNDER_REVIEW"].includes(schedule.status)) throw new Error("Cronograma não disponível para aprovação.");
  const activities: ScheduleActivityInput[] = schedule.activities.map((activity) => ({ id: activity.id, name: activity.name, plannedCost: Number(activity.plannedCost), allocations: activity.allocations.map((allocation) => ({ period: allocation.periodStart.toISOString().slice(0, 7), physicalPercentage: Number(allocation.physicalPercent) * 100, financialValue: Number(allocation.plannedDisbursement) })) }));
  const proof = validateScheduleIntegrity(activities);
  if (!proof.valid) throw new Error(`Prova-zero inválida: ${proof.errors.join(" ")}`);
  const dependencies = schedule.activities.flatMap((activity) => activity.predecessors.map((dependency) => ({ predecessorId: dependency.predecessorId, successorId: dependency.successorId, type: dependency.type })));
  if (!validateDependencies(schedule.activities.map((activity) => activity.id), dependencies)) throw new Error("O cronograma possui dependência cíclica.");
  const approved = await prisma.operationalSchedule.update({ where: { id: schedule.id }, data: { status: "APPROVED", approvedById: context.userId, approvedAt: new Date() } });
  await prisma.auditLog.create({ data: auditData(context, schedule.projectId, "OPERATIONAL_SCHEDULE_APPROVED", "OperationalSchedule", schedule.id, { status: approved.status, proofZero: true }) });
  return approved;
}

export async function getOperationsWorkspace(context: Pick<AuthContext, "organizationId">, projectId: string) {
  await projectForTenant(context.organizationId, projectId);
  const [baseline, budget, schedule, policy, structure] = await Promise.all([
    prisma.operationalBaseline.findFirst({ where: { organizationId: context.organizationId, projectId }, orderBy: [{ version: "desc" }], include: { lines: true } }),
    prisma.budget.findFirst({ where: { organizationId: context.organizationId, projectId }, orderBy: [{ version: "desc" }, { updatedAt: "desc" }], include: { lineItems: true, varianceJustifications: true } }),
    prisma.operationalSchedule.findFirst({ where: { organizationId: context.organizationId, projectId }, orderBy: [{ version: "desc" }], include: { activities: { include: { allocations: true, predecessors: true } } } }),
    prisma.materialityPolicy.findFirst({ where: { organizationId: context.organizationId, isActive: true }, orderBy: { updatedAt: "desc" } }),
    prisma.project.findFirst({
      where: { id: projectId, organizationId: context.organizationId },
      include: {
        company: { include: { economicGroup: true } },
        operatingUnits: { orderBy: { sortOrder: "asc" } },
        costCenters: { orderBy: { code: "asc" } },
      },
    }),
  ]);
  const bands: MaterialityBand[] | undefined = policy ? [
    { level: "INFORMATIVO", minPercentage: 0, maxPercentage: Number(policy.informationRate) * 100 },
    { level: "ATENCAO", minPercentage: Number(policy.informationRate) * 100, maxPercentage: Number(policy.attentionRate) * 100 },
    { level: "RELEVANTE", minPercentage: Number(policy.attentionRate) * 100, maxPercentage: Number(policy.relevantRate) * 100 },
    { level: "CRITICO", minPercentage: Number(policy.relevantRate) * 100 },
  ] : undefined;
  const baselineValues: EconomicValue[] = baseline?.lines.map((line) => ({ economicItemId: line.economicItemId ?? line.id, category: line.category, value: Number(line.value) })) ?? [];
  const budgetValues: EconomicValue[] = budget?.lineItems.filter((line) => !budget.lineItems.some((candidate) => candidate.parentId === line.id)).map((line) => ({ economicItemId: line.economicItemId ?? line.id, category: line.category, value: Number(line.totalCost) })) ?? [];
  const bridge = buildBudgetBridge(baselineValues, budgetValues, bands);
  const scheduleActivities: ScheduleActivityInput[] = schedule?.activities.map((activity) => ({ id: activity.id, name: activity.name, plannedCost: Number(activity.plannedCost), allocations: activity.allocations.map((allocation) => ({ period: allocation.periodStart.toISOString().slice(0, 7), physicalPercentage: Number(allocation.physicalPercent) * 100, financialValue: Number(allocation.plannedDisbursement) })) })) ?? [];
  const flow = buildProjectedCashFlow(scheduleActivities);
  return {
    structure: structure ? {
      projectId: structure.id,
      projectName: structure.name,
      company: structure.company ? { id: structure.company.id, name: structure.company.name, type: structure.company.type, groupName: structure.company.economicGroup?.name ?? null } : null,
      operatingUnits: structure.operatingUnits.map((unit) => ({ id: unit.id, parentId: unit.parentId, code: unit.code, name: unit.name, type: unit.type })),
      costCenters: structure.costCenters.map((center) => ({ id: center.id, parentId: center.parentId, code: center.code, name: center.name, managerialAccount: center.managerialAccount })),
    } : null,
    baseline: baseline ? { id: baseline.id, name: baseline.name, version: baseline.version, status: baseline.status, approvedAt: baseline.approvedAt?.toISOString() ?? null, checksum: baseline.checksum, total: baselineValues.reduce((sum, line) => sum + line.value, 0), lines: baselineValues } : null,
    budget: budget ? { id: budget.id, name: budget.name, version: budget.version, status: budget.status, kind: budget.kind, total: Number(budget.totalBudget), lineCount: budget.lineItems.length } : null,
    bridge,
    schedule: schedule ? { id: schedule.id, name: schedule.name, version: schedule.version, status: schedule.status, activities: scheduleActivities.length } : null,
    cashFlow: flow,
    indicators: scheduleIndicators(flow),
  };
}

export type OperationsWorkspaceView = Awaited<ReturnType<typeof getOperationsWorkspace>>;
