import { createHash } from "node:crypto";
import { Prisma, type CorrectiveActionStatus, type PerformanceVarianceType, type RootCauseCategory } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import {
  allocateAdministrativeCost,
  assertAllocationCapacity,
  assertCorrectiveActionTransition,
  assertNoHierarchyCycle,
  assertPerformanceVarianceTransition,
  assertPeopleCapability,
  assertRootCauseAllocation,
  assertValidDateRange,
  calculateEfficiencyVariance,
  calculateRelationshipCost,
  hasPeopleCapability,
  simulateIncentivePool,
  type PeopleCapability,
} from "@/domain/people-performance";

type PeopleContext = Pick<AuthContext, "organizationId" | "userId" | "role">;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const checksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const audit = (context: PeopleContext, projectId: string | null, action: string, entityType: string, entityId: string, before?: unknown, after?: unknown) => ({
  organizationId: context.organizationId,
  userId: context.userId,
  projectId,
  action,
  entityType,
  entityId,
  before: before === undefined ? undefined : json(before),
  after: after === undefined ? undefined : json(after),
});

async function projectForTenant(context: PeopleContext, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: context.organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  return project;
}

async function relationshipForTenant(context: PeopleContext, relationshipId: string) {
  const relationship = await prisma.employmentRelationship.findFirst({ where: { id: relationshipId, organizationId: context.organizationId }, include: { person: true } });
  if (!relationship) throw new Error("Vínculo profissional não encontrado nesta organização.");
  return relationship;
}

function requireCapability(context: PeopleContext, capability: PeopleCapability) {
  assertPeopleCapability(context.role, capability);
}

export async function createDepartment(context: PeopleContext, input: { companyId?: string | null; parentId?: string | null; code: string; name: string; description?: string | null }) {
  requireCapability(context, "PEOPLE_MANAGE");
  const nodes = await prisma.department.findMany({ where: { organizationId: context.organizationId }, select: { id: true, parentId: true } });
  if (input.parentId && !nodes.some((item) => item.id === input.parentId)) throw new Error("Departamento superior não encontrado nesta organização.");
  assertNoHierarchyCycle(nodes, `new:${input.code}`, input.parentId ?? null);
  const department = await prisma.department.create({ data: { organizationId: context.organizationId, companyId: input.companyId ?? null, parentId: input.parentId ?? null, code: input.code.trim(), name: input.name.trim(), description: input.description?.trim() || null, createdById: context.userId, updatedById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, null, "DEPARTMENT_CREATED", "Department", department.id, undefined, { code: department.code, name: department.name }) });
  return department;
}

export async function createPosition(context: PeopleContext, input: { departmentId?: string | null; code: string; title: string; level?: string | null }) {
  requireCapability(context, "PEOPLE_MANAGE");
  if (input.departmentId && !(await prisma.department.findFirst({ where: { id: input.departmentId, organizationId: context.organizationId } }))) throw new Error("Departamento não encontrado nesta organização.");
  const position = await prisma.position.create({ data: { organizationId: context.organizationId, departmentId: input.departmentId ?? null, code: input.code.trim(), title: input.title.trim(), level: input.level?.trim() || null, createdById: context.userId, updatedById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, null, "POSITION_CREATED", "Position", position.id, undefined, { code: position.code, title: position.title }) });
  return position;
}

export async function createPersonProfile(context: PeopleContext, input: { userId?: string | null; fullName: string; preferredName?: string | null; professionalId?: string | null; email?: string | null; phone?: string | null }) {
  requireCapability(context, "PEOPLE_MANAGE");
  const person = await prisma.personProfile.create({ data: { organizationId: context.organizationId, userId: input.userId ?? null, fullName: input.fullName.trim(), preferredName: input.preferredName?.trim() || null, professionalId: input.professionalId?.trim() || null, email: input.email?.trim() || null, phone: input.phone?.trim() || null, createdById: context.userId, updatedById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, null, "PERSON_PROFILE_CREATED", "PersonProfile", person.id, undefined, { fullName: person.fullName, linkedUser: Boolean(person.userId) }) });
  return person;
}

export async function createEmploymentRelationship(context: PeopleContext, input: { companyId: string; personId: string; positionId?: string | null; departmentId?: string | null; managerId?: string | null; type: "EMPLOYEE" | "CONTRACTOR" | "PARTNER" | "INTERN" | "TEMPORARY" | "OUTSOURCED"; startDate: Date; endDate?: Date | null; weeklyHours?: number | null }) {
  requireCapability(context, "PEOPLE_MANAGE");
  assertValidDateRange(input.startDate, input.endDate);
  const [company, person] = await Promise.all([
    prisma.company.findFirst({ where: { id: input.companyId, organizationId: context.organizationId } }),
    prisma.personProfile.findFirst({ where: { id: input.personId, organizationId: context.organizationId } }),
  ]);
  if (!company || !person) throw new Error("Empresa ou perfil profissional não pertence à organização.");
  if (input.managerId) await relationshipForTenant(context, input.managerId);
  const relationship = await prisma.employmentRelationship.create({ data: { organizationId: context.organizationId, companyId: input.companyId, personId: input.personId, positionId: input.positionId ?? null, departmentId: input.departmentId ?? null, managerId: input.managerId ?? null, type: input.type, startDate: input.startDate, endDate: input.endDate ?? null, weeklyHours: input.weeklyHours ?? null, createdById: context.userId, updatedById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, null, "EMPLOYMENT_RELATIONSHIP_CREATED", "EmploymentRelationship", relationship.id, undefined, { personId: person.id, companyId: company.id, type: relationship.type }) });
  return relationship;
}

export async function createWorkAllocation(context: PeopleContext, input: { projectId: string; relationshipId: string; teamId?: string | null; costCenterId?: string | null; economicItemId?: string | null; scheduleActivityId?: string | null; criterion: "PERCENTAGE" | "HOURS" | "FIXED_AMOUNT"; allocationRate?: number | null; allocatedHours?: number | null; allocatedAmount?: number | null; startDate: Date; endDate?: Date | null; overAllocationJustification?: string | null }) {
  requireCapability(context, "ALLOCATION_MANAGE");
  await Promise.all([projectForTenant(context, input.projectId), relationshipForTenant(context, input.relationshipId)]);
  assertValidDateRange(input.startDate, input.endDate);
  const existing = await prisma.workAllocation.findMany({ where: { organizationId: context.organizationId, relationshipId: input.relationshipId, startDate: { lte: input.endDate ?? new Date("9999-12-31") }, OR: [{ endDate: null }, { endDate: { gte: input.startDate } }] } });
  const capacity = assertAllocationCapacity(existing.map((item) => ({ criterion: item.criterion, allocationRate: item.allocationRate, allocatedHours: item.allocatedHours, justification: item.overAllocationJustification })), { criterion: input.criterion, allocationRate: input.allocationRate, allocatedHours: input.allocatedHours, justification: input.overAllocationJustification });
  const allocation = await prisma.workAllocation.create({ data: { organizationId: context.organizationId, projectId: input.projectId, relationshipId: input.relationshipId, teamId: input.teamId ?? null, costCenterId: input.costCenterId ?? null, economicItemId: input.economicItemId ?? null, scheduleActivityId: input.scheduleActivityId ?? null, criterion: input.criterion, allocationRate: input.allocationRate ?? null, allocatedHours: input.allocatedHours ?? null, allocatedAmount: input.allocatedAmount ?? null, startDate: input.startDate, endDate: input.endDate ?? null, overAllocationJustification: input.overAllocationJustification?.trim() || null, createdById: context.userId, updatedById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, input.projectId, "WORK_ALLOCATION_CREATED", "WorkAllocation", allocation.id, undefined, { criterion: allocation.criterion, capacity: { rateTotal: capacity.rateTotal.toString(), hoursTotal: capacity.hoursTotal.toString(), overAllocated: capacity.overAllocated } }) });
  return allocation;
}

export async function recordRelationshipCost(context: PeopleContext, input: { relationshipId: string; referenceMonth: Date; baseCost: number; burdenCost?: number; benefitsCost?: number; otherCost?: number; source: string; notes?: string | null }) {
  requireCapability(context, "COMPENSATION_MANAGE");
  await relationshipForTenant(context, input.relationshipId);
  const cost = calculateRelationshipCost(input);
  const snapshot = await prisma.relationshipCostSnapshot.upsert({ where: { relationshipId_referenceMonth: { relationshipId: input.relationshipId, referenceMonth: input.referenceMonth } }, update: { baseCost: cost.baseCost, burdenCost: cost.burdenCost, benefitsCost: cost.benefitsCost, otherCost: cost.otherCost, totalCost: cost.totalCost, source: input.source, notes: input.notes ?? null, createdById: context.userId }, create: { relationshipId: input.relationshipId, referenceMonth: input.referenceMonth, baseCost: cost.baseCost, burdenCost: cost.burdenCost, benefitsCost: cost.benefitsCost, otherCost: cost.otherCost, totalCost: cost.totalCost, source: input.source, notes: input.notes ?? null, createdById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, null, "RELATIONSHIP_COST_RECORDED", "RelationshipCostSnapshot", snapshot.id, undefined, { referenceMonth: snapshot.referenceMonth.toISOString(), totalCost: "[RESTRITO]" }) });
  return snapshot;
}

export async function executeAdministrativeAllocation(context: PeopleContext, input: { planId: string; ruleId: string; planLineId: string; referenceMonth: Date; sourceAmount: number; drivers: Array<{ targetProjectId: string; value: number }> }) {
  requireCapability(context, "COMPENSATION_MANAGE");
  const plan = await prisma.administrativeCostPlan.findFirst({ where: { id: input.planId, organizationId: context.organizationId }, include: { rules: true, lines: true } });
  if (!plan || !plan.rules.some((item) => item.id === input.ruleId) || !plan.lines.some((item) => item.id === input.planLineId)) throw new Error("Plano, regra ou linha administrativa não encontrada nesta organização.");
  for (const driver of input.drivers) await projectForTenant(context, driver.targetProjectId);
  const result = allocateAdministrativeCost(input.sourceAmount, input.drivers.map((item) => ({ targetId: item.targetProjectId, value: item.value })));
  const snapshot = await prisma.administrativeCostAllocationSnapshot.create({ data: { planId: input.planId, ruleId: input.ruleId, referenceMonth: input.referenceMonth, sourceAmount: result.sourceAmount, allocatedAmount: result.allocatedAmount, residualAmount: result.residualAmount, proofZero: result.proofZero, checksum: checksum(result.lines.map((item) => ({ targetId: item.targetId, amount: item.allocatedAmount.toString() }))), createdById: context.userId, lines: { create: result.lines.map((item) => ({ planLineId: input.planLineId, targetProjectId: item.targetId, driverValue: item.driverValue, allocationRate: item.allocationRate, allocatedAmount: item.allocatedAmount })) } }, include: { lines: true } });
  await prisma.auditLog.create({ data: audit(context, plan.projectId ?? null, "ADMINISTRATIVE_COST_ALLOCATED", "AdministrativeCostAllocationSnapshot", snapshot.id, undefined, { proofZero: snapshot.proofZero, sourceAmount: snapshot.sourceAmount.toString(), allocatedAmount: snapshot.allocatedAmount.toString() }) });
  return snapshot;
}

export async function createPerformanceVariance(context: PeopleContext, input: { projectId: string; code: string; title: string; type: PerformanceVarianceType; plannedAmount: number; committedAmount: number; measuredAmount: number; actualAmount: number; forecastAmount: number; plannedProgress: number; actualProgress: number; referenceFrom: Date; referenceTo: Date; costCenterId?: string | null; economicItemId?: string | null; scheduleActivityId?: string | null; ownerId?: string | null; dueDate?: Date | null }) {
  requireCapability(context, "EFFICIENCY_ANALYZE");
  await projectForTenant(context, input.projectId);
  assertValidDateRange(input.referenceFrom, input.referenceTo);
  const result = calculateEfficiencyVariance(input);
  const inputSnapshot = { ...input, referenceFrom: input.referenceFrom.toISOString(), referenceTo: input.referenceTo.toISOString() };
  return prisma.$transaction(async (tx) => {
    const run = await tx.efficiencyAnalysisRun.create({ data: { organizationId: context.organizationId, projectId: input.projectId, referenceFrom: input.referenceFrom, referenceTo: input.referenceTo, status: "COMPLETED", methodologyVersion: "9F.1", inputSnapshot: json(inputSnapshot), checksum: checksum(inputSnapshot), createdById: context.userId, completedAt: new Date() } });
    const metric = await tx.efficiencyMetricResult.create({ data: { runId: run.id, metricKey: "COST_PROGRESS_VARIANCE", subjectType: "PROJECT", subjectId: input.projectId, plannedValue: result.plannedAmount, committedValue: result.committedAmount, measuredValue: result.measuredAmount, actualValue: result.actualAmount, forecastValue: result.forecastAmount, resultValue: result.productivityVariance, unit: "BRL", confidence: "HIGH", evidenceRefs: json([`project:${input.projectId}`, `run:${run.id}`]) } });
    const variance = await tx.performanceVarianceCase.create({ data: { organizationId: context.organizationId, projectId: input.projectId, analysisRunId: run.id, metricResultId: metric.id, costCenterId: input.costCenterId ?? null, economicItemId: input.economicItemId ?? null, scheduleActivityId: input.scheduleActivityId ?? null, code: input.code, title: input.title, type: input.type, status: "UNCLASSIFIED", plannedAmount: result.plannedAmount, committedAmount: result.committedAmount, measuredAmount: result.measuredAmount, actualAmount: result.actualAmount, forecastAmount: result.forecastAmount, plannedProgress: result.plannedProgress, actualProgress: result.actualProgress, cashVariance: result.cashVariance, commitmentVariance: result.commitmentVariance, physicalVariance: result.physicalVariance, expectedCostAtProgress: result.expectedCostAtProgress, savingEligible: false, ownerId: input.ownerId ?? null, dueDate: input.dueDate ?? null, createdById: context.userId, updatedById: context.userId } });
    await tx.auditLog.create({ data: audit(context, input.projectId, "PERFORMANCE_VARIANCE_CREATED", "PerformanceVarianceCase", variance.id, undefined, { cashVariance: result.cashVariance.toString(), physicalVariance: result.physicalVariance.toString(), savingEligible: false, delayedExecution: result.delayedExecution }) });
    return variance;
  });
}

export async function startRootCauseInvestigation(context: PeopleContext, input: { varianceCaseId: string; problemStatement: string; scope?: string | null; responsibleId: string }) {
  requireCapability(context, "ROOT_CAUSE_MANAGE");
  const variance = await prisma.performanceVarianceCase.findFirst({ where: { id: input.varianceCaseId, organizationId: context.organizationId } });
  if (!variance) throw new Error("Caso de desvio não encontrado nesta organização.");
  const investigation = await prisma.$transaction(async (tx) => {
    const created = await tx.rootCauseInvestigation.create({ data: { varianceCaseId: variance.id, problemStatement: input.problemStatement.trim(), scope: input.scope?.trim() || null, responsibleId: input.responsibleId, createdById: context.userId, updatedById: context.userId } });
    await tx.performanceVarianceCase.update({ where: { id: variance.id }, data: { status: "UNDER_ANALYSIS", updatedById: context.userId } });
    await tx.auditLog.create({ data: audit(context, variance.projectId, "ROOT_CAUSE_INVESTIGATION_STARTED", "RootCauseInvestigation", created.id, undefined, { varianceCaseId: variance.id }) });
    return created;
  });
  return investigation;
}

export async function addCausalHypothesis(context: PeopleContext, input: { investigationId: string; category: RootCauseCategory; description: string }) {
  requireCapability(context, "ROOT_CAUSE_MANAGE");
  const investigation = await prisma.rootCauseInvestigation.findFirst({ where: { id: input.investigationId, varianceCase: { organizationId: context.organizationId } }, include: { varianceCase: true } });
  if (!investigation) throw new Error("Investigação não encontrada nesta organização.");
  const hypothesis = await prisma.causalHypothesis.create({ data: { investigationId: input.investigationId, category: input.category, description: input.description.trim(), createdById: context.userId, updatedById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, investigation.varianceCase.projectId, "CAUSAL_HYPOTHESIS_ADDED", "CausalHypothesis", hypothesis.id, undefined, { category: hypothesis.category }) });
  return hypothesis;
}

export async function addCausalEvidence(context: PeopleContext, input: { hypothesisId: string; evidenceType: string; title: string; sourceRef: string; sourceVersion?: string | null; description?: string | null; supports?: boolean }) {
  requireCapability(context, "ROOT_CAUSE_MANAGE");
  const hypothesis = await prisma.causalHypothesis.findFirst({ where: { id: input.hypothesisId, investigation: { varianceCase: { organizationId: context.organizationId } } }, include: { investigation: { include: { varianceCase: true } } } });
  if (!hypothesis) throw new Error("Hipótese não encontrada nesta organização.");
  const evidence = await prisma.causalEvidence.create({ data: { hypothesisId: input.hypothesisId, evidenceType: input.evidenceType, title: input.title.trim(), description: input.description?.trim() || null, sourceRef: input.sourceRef, sourceVersion: input.sourceVersion ?? null, supports: input.supports ?? true, createdById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, hypothesis.investigation.varianceCase.projectId, "CAUSAL_EVIDENCE_ADDED", "CausalEvidence", evidence.id, undefined, { hypothesisId: input.hypothesisId, sourceRef: input.sourceRef, supports: evidence.supports }) });
  return evidence;
}

export async function allocateRootCause(context: PeopleContext, input: { investigationId: string; hypothesisId: string; contributionRate: number; amountImpact?: number | null; rationale: string; validate?: boolean }) {
  requireCapability(context, "ROOT_CAUSE_MANAGE");
  const investigation = await prisma.rootCauseInvestigation.findFirst({ where: { id: input.investigationId, varianceCase: { organizationId: context.organizationId } }, include: { varianceCase: true, causeAllocations: true } });
  if (!investigation) throw new Error("Investigação não encontrada nesta organização.");
  assertRootCauseAllocation([...investigation.causeAllocations.filter((item) => item.hypothesisId !== input.hypothesisId).map((item) => item.contributionRate), input.contributionRate], input.validate ?? false);
  const allocation = await prisma.rootCauseAllocation.upsert({ where: { investigationId_hypothesisId: { investigationId: input.investigationId, hypothesisId: input.hypothesisId } }, update: { contributionRate: input.contributionRate, amountImpact: input.amountImpact ?? null, rationale: input.rationale, validatedById: input.validate ? context.userId : null, validatedAt: input.validate ? new Date() : null }, create: { investigationId: input.investigationId, hypothesisId: input.hypothesisId, contributionRate: input.contributionRate, amountImpact: input.amountImpact ?? null, rationale: input.rationale, validatedById: input.validate ? context.userId : null, validatedAt: input.validate ? new Date() : null, createdById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, investigation.varianceCase.projectId, "ROOT_CAUSE_ALLOCATED", "RootCauseAllocation", allocation.id, undefined, { contributionRate: allocation.contributionRate.toString(), validated: Boolean(allocation.validatedAt) }) });
  return allocation;
}

export async function addExternalDependency(context: PeopleContext, input: { investigationId: string; name: string; description: string; owner?: string | null; dueDate?: Date | null; evidenceRef?: string | null }) {
  requireCapability(context, "ROOT_CAUSE_MANAGE");
  const investigation = await prisma.rootCauseInvestigation.findFirst({ where: { id: input.investigationId, varianceCase: { organizationId: context.organizationId } }, include: { varianceCase: true } });
  if (!investigation) throw new Error("Investigação não encontrada nesta organização.");
  const dependency = await prisma.externalDependency.create({ data: { investigationId: input.investigationId, name: input.name.trim(), description: input.description.trim(), owner: input.owner?.trim() || null, dueDate: input.dueDate ?? null, evidenceRef: input.evidenceRef ?? null, createdById: context.userId, updatedById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, investigation.varianceCase.projectId, "EXTERNAL_DEPENDENCY_ADDED", "ExternalDependency", dependency.id, undefined, { name: dependency.name, dueDate: dependency.dueDate?.toISOString() ?? null }) });
  return dependency;
}

export async function transitionPerformanceVariance(context: PeopleContext, varianceCaseId: string, to: "UNDER_ANALYSIS" | "CLASSIFIED" | "VALIDATED" | "CLOSED") {
  requireCapability(context, "ROOT_CAUSE_MANAGE");
  const variance = await prisma.performanceVarianceCase.findFirst({ where: { id: varianceCaseId, organizationId: context.organizationId }, include: { investigation: { include: { hypotheses: { include: { evidence: true } }, causeAllocations: true, dependencies: true, actions: true } } } });
  if (!variance) throw new Error("Caso de desvio não encontrado nesta organização.");
  assertPerformanceVarianceTransition(variance.status, to);
  if (["CLASSIFIED", "VALIDATED", "CLOSED"].includes(to) && (!variance.investigation || !variance.investigation.hypotheses.some((item) => item.status === "ACCEPTED" && item.evidence.length > 0))) throw new Error("A classificação exige hipótese aceita com evidência vinculada.");
  if (["VALIDATED", "CLOSED"].includes(to)) {
    assertRootCauseAllocation(variance.investigation!.causeAllocations.map((item) => item.contributionRate), true);
    if (variance.investigation!.causeAllocations.some((item) => !item.validatedAt)) throw new Error("Todas as causas devem estar validadas antes desta transição.");
  }
  if (to === "CLOSED") {
    if (variance.investigation!.dependencies.some((item) => !["RESOLVED", "CANCELLED"].includes(item.status))) throw new Error("Dependências externas abertas impedem o encerramento.");
    if (!variance.investigation!.actions.length || variance.investigation!.actions.some((item) => !["VERIFIED", "CANCELLED"].includes(item.status))) throw new Error("O encerramento exige ações verificadas ou canceladas.");
  }
  const updated = await prisma.performanceVarianceCase.update({ where: { id: variance.id }, data: { status: to, updatedById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, variance.projectId, "PERFORMANCE_VARIANCE_TRANSITIONED", "PerformanceVarianceCase", variance.id, { status: variance.status }, { status: updated.status }) });
  return updated;
}

export async function createCorrectiveAction(context: PeopleContext, input: { investigationId: string; title: string; description: string; priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; responsibleId: string; dueDate?: Date | null; expectedImpact?: number | null; implementationCost?: number | null }) {
  requireCapability(context, "ROOT_CAUSE_MANAGE");
  const investigation = await prisma.rootCauseInvestigation.findFirst({ where: { id: input.investigationId, varianceCase: { organizationId: context.organizationId } }, include: { varianceCase: true } });
  if (!investigation) throw new Error("Investigação não encontrada nesta organização.");
  const action = await prisma.correctiveAction.create({ data: { investigationId: input.investigationId, title: input.title.trim(), description: input.description.trim(), priority: input.priority, responsibleId: input.responsibleId, dueDate: input.dueDate ?? null, expectedImpact: input.expectedImpact ?? null, implementationCost: input.implementationCost ?? null, createdById: context.userId, updatedById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, investigation.varianceCase.projectId, "CORRECTIVE_ACTION_CREATED", "CorrectiveAction", action.id, undefined, { priority: action.priority, responsibleId: action.responsibleId }) });
  return action;
}

export async function addCorrectiveActionEvidence(context: PeopleContext, input: { actionId: string; title: string; sourceRef: string; notes?: string | null }) {
  requireCapability(context, "ROOT_CAUSE_MANAGE");
  const action = await prisma.correctiveAction.findFirst({ where: { id: input.actionId, investigation: { varianceCase: { organizationId: context.organizationId } } }, include: { investigation: { include: { varianceCase: true } } } });
  if (!action) throw new Error("Ação corretiva não encontrada nesta organização.");
  const evidence = await prisma.correctiveActionEvidence.create({ data: { actionId: input.actionId, title: input.title.trim(), sourceRef: input.sourceRef, notes: input.notes?.trim() || null, createdById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, action.investigation.varianceCase.projectId, "CORRECTIVE_ACTION_EVIDENCE_ADDED", "CorrectiveActionEvidence", evidence.id, undefined, { actionId: action.id, sourceRef: evidence.sourceRef }) });
  return evidence;
}

export async function transitionCorrectiveAction(context: PeopleContext, actionId: string, to: CorrectiveActionStatus) {
  const action = await prisma.correctiveAction.findFirst({ where: { id: actionId, investigation: { varianceCase: { organizationId: context.organizationId } } }, include: { investigation: { include: { varianceCase: true } }, evidence: true } });
  if (!action) throw new Error("Ação corretiva não encontrada nesta organização.");
  if (to === "ACTIVE") requireCapability(context, "ACTION_APPROVE");
  else if (to === "VERIFIED") requireCapability(context, "ACTION_VERIFY");
  else requireCapability(context, "ROOT_CAUSE_MANAGE");
  assertCorrectiveActionTransition(action.status, to);
  if (to === "VERIFIED" && !action.evidence.length) throw new Error("A verificação exige ao menos uma evidência de conclusão.");
  const updated = await prisma.correctiveAction.update({ where: { id: action.id }, data: { status: to, approvedById: to === "ACTIVE" ? context.userId : action.approvedById, approvedAt: to === "ACTIVE" ? new Date() : action.approvedAt, completedAt: to === "COMPLETED" ? new Date() : action.completedAt, verifiedById: to === "VERIFIED" ? context.userId : action.verifiedById, verifiedAt: to === "VERIFIED" ? new Date() : action.verifiedAt, updatedById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, action.investigation.varianceCase.projectId, "CORRECTIVE_ACTION_TRANSITIONED", "CorrectiveAction", action.id, { status: action.status }, { status: updated.status }) });
  return updated;
}

export async function createIncentiveSimulation(context: PeopleContext, input: { projectId: string; policyId: string; validatedSavingId?: string | null; name: string; implementationCost?: number; reversalAmount?: number }) {
  requireCapability(context, "INCENTIVE_SIMULATE");
  await projectForTenant(context, input.projectId);
  const policy = await prisma.incentivePolicy.findFirst({ where: { id: input.policyId, organizationId: context.organizationId, status: "ACTIVE" } });
  if (!policy) throw new Error("Política de incentivo ativa não encontrada nesta organização.");
  const saving = input.validatedSavingId ? await prisma.validatedSaving.findFirst({ where: { id: input.validatedSavingId, decision: { quotationProcess: { organizationId: context.organizationId, projectId: input.projectId } } } }) : null;
  if (input.validatedSavingId && (!saving || !saving.validatedAt || !saving.scopeComparable)) throw new Error("A economia informada não está validada ou não é comparável.");
  const result = simulateIncentivePool({ validatedSavingAmount: saving?.nominalAmount ?? 0, validatedSavingConfirmed: Boolean(saving?.validatedAt), implementationCost: input.implementationCost ?? 0, reversalAmount: input.reversalAmount ?? 0, poolRate: policy.poolRate, reserveRate: policy.reserveRate, minimumPool: policy.minimumPool, maximumPool: policy.maximumPool });
  const snapshot = { validatedSavingId: saving?.id ?? null, policyId: policy.id, policyVersion: policy.version, poolRate: policy.poolRate.toString(), reserveRate: policy.reserveRate.toString(), implementationCost: input.implementationCost ?? 0, reversalAmount: input.reversalAmount ?? 0 };
  const simulation = await prisma.incentiveSimulation.create({ data: { organizationId: context.organizationId, projectId: input.projectId, policyId: policy.id, validatedSavingId: saving?.id ?? null, name: input.name.trim(), status: "CALCULATED", validatedSavingAmount: result.validatedSavingAmount, implementationCost: input.implementationCost ?? 0, reversalAmount: input.reversalAmount ?? 0, eligibleBase: result.eligibleBase, simulatedPool: result.simulatedPool, inputSnapshot: json(snapshot), checksum: checksum(snapshot), createdById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, input.projectId, "INCENTIVE_SIMULATION_CREATED", "IncentiveSimulation", simulation.id, undefined, { simulatedPool: simulation.simulatedPool.toString(), paymentCreated: false, validatedSavingId: simulation.validatedSavingId }) });
  return simulation;
}

export async function allocateIncentiveContribution(context: PeopleContext, input: { simulationId: string; relationshipId: string; contributionRate: number; evidenceRefs: string[]; rationale: string }) {
  requireCapability(context, "INCENTIVE_SIMULATE");
  const [simulation, relationship] = await Promise.all([
    prisma.incentiveSimulation.findFirst({ where: { id: input.simulationId, organizationId: context.organizationId } }),
    relationshipForTenant(context, input.relationshipId),
  ]);
  if (!simulation) throw new Error("Simulação de incentivo não encontrada nesta organização.");
  if (!input.evidenceRefs.length) throw new Error("A contribuição exige evidência objetiva.");
  const existing = await prisma.incentiveAllocation.findMany({ where: { simulationId: simulation.id } });
  const total = assertRootCauseAllocation([...existing.filter((item) => item.relationshipId !== relationship.id).map((item) => item.contributionRate), input.contributionRate]);
  const allocation = await prisma.incentiveAllocation.upsert({ where: { simulationId_relationshipId: { simulationId: simulation.id, relationshipId: relationship.id } }, update: { contributionRate: input.contributionRate, simulatedAmount: new Prisma.Decimal(simulation.simulatedPool).mul(input.contributionRate), evidenceRefs: json(input.evidenceRefs), rationale: input.rationale.trim() }, create: { simulationId: simulation.id, relationshipId: relationship.id, contributionRate: input.contributionRate, simulatedAmount: new Prisma.Decimal(simulation.simulatedPool).mul(input.contributionRate), evidenceRefs: json(input.evidenceRefs), rationale: input.rationale.trim() } });
  await prisma.auditLog.create({ data: audit(context, simulation.projectId, "INCENTIVE_CONTRIBUTION_ALLOCATED", "IncentiveAllocation", allocation.id, undefined, { contributionRate: allocation.contributionRate.toString(), totalContributionRate: total.toString(), paymentCreated: false }) });
  return allocation;
}

export async function approveIncentiveSimulationForReference(context: PeopleContext, simulationId: string) {
  requireCapability(context, "INCENTIVE_APPROVE");
  const simulation = await prisma.incentiveSimulation.findFirst({ where: { id: simulationId, organizationId: context.organizationId, status: "CALCULATED" }, include: { allocations: true } });
  if (!simulation) throw new Error("Simulação calculada não encontrada nesta organização.");
  if (simulation.simulatedPool.gt(0)) assertRootCauseAllocation(simulation.allocations.map((item) => item.contributionRate), true);
  const approved = await prisma.incentiveSimulation.update({ where: { id: simulation.id }, data: { status: "APPROVED_FOR_REFERENCE", approvedById: context.userId, approvedAt: new Date() } });
  await prisma.auditLog.create({ data: audit(context, simulation.projectId, "INCENTIVE_SIMULATION_APPROVED_FOR_REFERENCE", "IncentiveSimulation", simulation.id, { status: simulation.status }, { status: approved.status, paymentCreated: false }) });
  return approved;
}

export async function getPeoplePerformanceWorkspace(context: Pick<PeopleContext, "organizationId" | "role"> & { userId?: string }, projectId: string) {
  requireCapability({ ...context, userId: context.userId ?? "read-only" }, "PEOPLE_READ");
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: context.organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  const canViewCompensation = hasPeopleCapability(context.role, "COMPENSATION_READ");
  const [departments, positions, relationships, teams, allocations, adminPlans, runs, variances, policies, simulations] = await Promise.all([
    prisma.department.findMany({ where: { organizationId: context.organizationId, isActive: true }, orderBy: { code: "asc" } }),
    prisma.position.findMany({ where: { organizationId: context.organizationId, isActive: true }, include: { department: true }, orderBy: { code: "asc" } }),
    prisma.employmentRelationship.findMany({ where: { organizationId: context.organizationId, status: "ACTIVE" }, include: { person: true, position: true, department: true, company: true, costSnapshots: { orderBy: { referenceMonth: "desc" }, take: 1 } }, orderBy: { person: { fullName: "asc" } }, take: 500 }),
    prisma.team.findMany({ where: { organizationId: context.organizationId, OR: [{ projectId }, { projectId: null }], isActive: true }, include: { memberships: { include: { relationship: { include: { person: true } } } } }, orderBy: { code: "asc" } }),
    prisma.workAllocation.findMany({ where: { organizationId: context.organizationId, projectId }, include: { relationship: { include: { person: true } }, team: true, costCenter: true, scheduleActivity: true }, orderBy: { startDate: "desc" }, take: 500 }),
    prisma.administrativeCostPlan.findMany({ where: { organizationId: context.organizationId, OR: [{ projectId }, { projectId: null }] }, include: { lines: true, snapshots: { include: { lines: true }, orderBy: { referenceMonth: "desc" }, take: 6 } }, orderBy: { version: "desc" }, take: 20 }),
    prisma.efficiencyAnalysisRun.findMany({ where: { organizationId: context.organizationId, projectId }, include: { metrics: true }, orderBy: { referenceTo: "desc" }, take: 20 }),
    prisma.performanceVarianceCase.findMany({ where: { organizationId: context.organizationId, projectId }, include: { investigation: { include: { hypotheses: { include: { evidence: true } }, causeAllocations: true, dependencies: true, actions: { include: { evidence: true } } } } }, orderBy: { updatedAt: "desc" }, take: 100 }),
    prisma.incentivePolicy.findMany({ where: { organizationId: context.organizationId, status: "ACTIVE" }, orderBy: { version: "desc" }, take: 20 }),
    prisma.incentiveSimulation.findMany({ where: { organizationId: context.organizationId, projectId }, include: { validatedSaving: true, policy: true, allocations: true }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const people = relationships.map((item) => ({ id: item.person.id, relationshipId: item.id, name: item.person.preferredName ?? item.person.fullName, company: item.company.name, department: item.department?.name ?? "Sem departamento", position: item.position?.title ?? "Sem cargo", relationshipType: item.type, weeklyHours: item.weeklyHours ? Number(item.weeklyHours) : null, monthlyCost: canViewCompensation && item.costSnapshots[0] ? Number(item.costSnapshots[0].totalCost) : null, compensationRestricted: !canViewCompensation }));
  const activeActions = variances.flatMap((item) => item.investigation?.actions ?? []).filter((item) => !["VERIFIED", "CANCELLED"].includes(item.status));
  const totalMonthlyCost = canViewCompensation ? relationships.reduce((sum, item) => sum + Number(item.costSnapshots[0]?.totalCost ?? 0), 0) : null;
  return {
    projectId,
    generatedAt: new Date().toISOString(),
    permissions: { canViewCompensation, canManagePeople: hasPeopleCapability(context.role, "PEOPLE_MANAGE"), canAnalyze: hasPeopleCapability(context.role, "EFFICIENCY_ANALYZE"), canSimulateIncentive: hasPeopleCapability(context.role, "INCENTIVE_SIMULATE") },
    summary: { people: people.length, departments: departments.length, positions: positions.length, teams: teams.length, allocations: allocations.length, activeVarianceCases: variances.filter((item) => !["CLOSED"].includes(item.status)).length, activeActions: activeActions.length, totalMonthlyCost },
    people,
    departments: departments.map((item) => ({ id: item.id, code: item.code, name: item.name, parentId: item.parentId })),
    positions: positions.map((item) => ({ id: item.id, code: item.code, title: item.title, department: item.department?.name ?? null })),
    teams: teams.map((item) => ({ id: item.id, code: item.code, name: item.name, type: item.type, members: item.memberships.map((membership) => membership.relationship.person.preferredName ?? membership.relationship.person.fullName) })),
    allocations: allocations.map((item) => ({ id: item.id, person: item.relationship.person.preferredName ?? item.relationship.person.fullName, team: item.team?.name ?? null, costCenter: item.costCenter?.name ?? null, scheduleActivity: item.scheduleActivity?.name ?? null, criterion: item.criterion, rate: item.allocationRate ? Number(item.allocationRate) : null, hours: item.allocatedHours ? Number(item.allocatedHours) : null, overAllocated: Boolean(item.overAllocationJustification) })),
    administrativeCosts: adminPlans.map((plan) => ({ id: plan.id, name: plan.name, version: plan.version, status: plan.status, planned: plan.lines.reduce((sum, item) => sum + Number(item.plannedAmount), 0), actual: plan.lines.reduce((sum, item) => sum + Number(item.actualAmount), 0), latestProofZero: plan.snapshots[0]?.proofZero ?? null, latestResidual: plan.snapshots[0] ? Number(plan.snapshots[0].residualAmount) : null })),
    efficiencyRuns: runs.map((run) => ({ id: run.id, referenceFrom: run.referenceFrom.toISOString(), referenceTo: run.referenceTo.toISOString(), status: run.status, methodologyVersion: run.methodologyVersion, metrics: run.metrics.map((metric) => ({ key: metric.metricKey, value: Number(metric.resultValue), unit: metric.unit, confidence: metric.confidence, evidenceRefs: metric.evidenceRefs })) })),
    varianceCases: variances.map((item) => ({ id: item.id, code: item.code, title: item.title, type: item.type, status: item.status, plannedAmount: Number(item.plannedAmount), actualAmount: Number(item.actualAmount), cashVariance: Number(item.cashVariance), commitmentVariance: Number(item.commitmentVariance), plannedProgress: Number(item.plannedProgress), actualProgress: Number(item.actualProgress), savingEligible: item.savingEligible, investigation: item.investigation ? { id: item.investigation.id, problemStatement: item.investigation.problemStatement, hypotheses: item.investigation.hypotheses.map((hypothesis) => ({ id: hypothesis.id, category: hypothesis.category, description: hypothesis.description, status: hypothesis.status, confidence: hypothesis.confidence, evidence: hypothesis.evidence.length })), allocatedCauseRate: item.investigation.causeAllocations.reduce((sum, allocation) => sum + Number(allocation.contributionRate), 0), dependencies: item.investigation.dependencies.map((dependency) => ({ id: dependency.id, name: dependency.name, status: dependency.status })), actions: item.investigation.actions.map((action) => ({ id: action.id, title: action.title, priority: action.priority, status: action.status, dueDate: action.dueDate?.toISOString() ?? null, evidence: action.evidence.length })) } : null })),
    incentive: { policies: policies.map((policy) => ({ id: policy.id, name: policy.name, version: policy.version, poolRate: Number(policy.poolRate), reserveRate: Number(policy.reserveRate) })), simulations: simulations.map((simulation) => ({ id: simulation.id, name: simulation.name, status: simulation.status, validatedSavingId: simulation.validatedSavingId, validatedSavingAmount: Number(simulation.validatedSavingAmount), eligibleBase: Number(simulation.eligibleBase), simulatedPool: Number(simulation.simulatedPool), paymentCreated: false, policy: `${simulation.policy.name} v${simulation.policy.version}` })) },
  };
}

export type PeoplePerformanceWorkspaceView = Awaited<ReturnType<typeof getPeoplePerformanceWorkspace>>;

export const peoplePerformanceInternals = { requireCapability, projectForTenant, relationshipForTenant };
