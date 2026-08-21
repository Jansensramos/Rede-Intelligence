import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { createExternalPayableObligation, reverseExternalPayableObligation } from "@/application/financial-ops/external-obligation-port";
import { DEFAULT_LEGAL_MILESTONES, legalReadiness, milestonesReached, obligationStatus, type DeadlineMilestone } from "@/domain/legal/engine";
import { prisma } from "@/infrastructure/database/prisma";

const mutableRoles = new Set(["OWNER", "ADMIN", "ANALYST"]);
const approvalRoles = new Set(["OWNER", "ADMIN"]);
const json = (value: unknown) => value as Prisma.InputJsonValue;
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const assertMutable = (context: Pick<AuthContext, "role">) => { if (!mutableRoles.has(context.role)) throw new Error("Seu perfil não pode alterar dados jurídicos."); };
const assertApprover = (context: Pick<AuthContext, "role">) => { if (!approvalRoles.has(context.role)) throw new Error("Somente Administrador ou Owner pode aprovar decisões jurídicas e integrações financeiras."); };

async function projectForTenant(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  return project;
}

const audit = (context: AuthContext, projectId: string, action: string, entityType: string, entityId: string, after?: unknown) => ({ organizationId: context.organizationId, userId: context.userId, projectId, action, entityType, entityId, after: after === undefined ? undefined : json(after) });

export async function createDueDiligenceCase(context: AuthContext, input: { projectId: string; landAssetId?: string | null; code: string; title: string; scope: string; targetCompletionAt?: Date | null }) {
  assertMutable(context);
  await projectForTenant(context.organizationId, input.projectId);
  if (input.landAssetId && !(await prisma.landAsset.findFirst({ where: { id: input.landAssetId, organizationId: context.organizationId, OR: [{ projectId: input.projectId }, { projectId: null }] } }))) throw new Error("Imóvel não pertence ao contexto da organização.");
  const record = await prisma.legalDueDiligenceCase.create({ data: { organizationId: context.organizationId, projectId: input.projectId, landAssetId: input.landAssetId ?? null, code: input.code.trim(), title: input.title.trim(), scope: input.scope.trim(), status: "IN_PROGRESS", startedAt: new Date(), targetCompletionAt: input.targetCompletionAt ?? null, responsibleId: context.userId, createdById: context.userId, updatedById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, input.projectId, "LEGAL_DILIGENCE_CREATED", "LegalDueDiligenceCase", record.id, { code: record.code }) });
  return record;
}

export async function recordLegalDecision(context: AuthContext, diligenceCaseId: string, input: { decision: "PROCEED" | "PROCEED_WITH_CONDITIONS" | "HOLD" | "DO_NOT_PROCEED" | "INSUFFICIENT_EVIDENCE"; conclusion: string; conditions?: unknown[]; blockers?: unknown[] }) {
  assertApprover(context);
  const diligence = await prisma.legalDueDiligenceCase.findFirst({ where: { id: diligenceCaseId, organizationId: context.organizationId }, include: { findings: true, decisions: true } });
  if (!diligence) throw new Error("Diligência não encontrada nesta organização.");
  const decision = await prisma.$transaction(async (tx) => {
    const created = await tx.legalDecision.create({ data: { diligenceCaseId: diligence.id, version: (diligence.decisions.at(-1)?.version ?? 0) + 1, decision: input.decision, executiveConclusion: input.conclusion.trim(), conditions: json(input.conditions ?? []), blockers: json(input.blockers ?? []), findingSnapshot: json(diligence.findings.map((item) => ({ id: item.id, code: item.code, severity: item.severity, status: item.status }))), decidedById: context.userId, decidedAt: new Date() } });
    await tx.legalDueDiligenceCase.update({ where: { id: diligence.id }, data: { currentVersion: created.version, status: "COMPLETED", completedAt: new Date(), updatedById: context.userId } });
    await tx.auditLog.create({ data: audit(context, diligence.projectId, "LEGAL_DECISION_RECORDED", "LegalDecision", created.id, { decision: created.decision, version: created.version }) });
    return created;
  });
  return decision;
}

export async function refreshLegalDeadlines(context: Pick<AuthContext, "organizationId">, projectId: string, today = new Date()) {
  await projectForTenant(context.organizationId, projectId);
  const [policy, obligations, licenses] = await Promise.all([
    prisma.legalDeadlinePolicy.findFirst({ where: { organizationId: context.organizationId, isActive: true }, orderBy: { version: "desc" } }),
    prisma.legalObligation.findMany({ where: { organizationId: context.organizationId, projectId, status: { notIn: ["FULFILLED", "WAIVED", "CANCELLED"] } } }),
    prisma.legalLicense.findMany({ where: { organizationId: context.organizationId, projectId, expiresAt: { not: null }, status: { notIn: ["REJECTED", "SUSPENDED", "EXPIRED"] } } }),
  ]);
  const milestones = (Array.isArray(policy?.milestones) ? policy.milestones : DEFAULT_LEGAL_MILESTONES) as unknown as DeadlineMilestone[];
  for (const obligation of obligations) {
    const status = obligationStatus(obligation.dueAt, obligation.status, today) as "ACTIVE" | "DUE_SOON" | "OVERDUE";
    if (status !== obligation.status) await prisma.legalObligation.update({ where: { id: obligation.id }, data: { status } });
    for (const milestone of milestonesReached(obligation.dueAt, today, milestones)) await prisma.legalAlert.upsert({ where: { organizationId_sourceType_sourceId_milestoneCode: { organizationId: context.organizationId, sourceType: "LEGAL_OBLIGATION", sourceId: obligation.id, milestoneCode: milestone.code } }, update: { criticality: milestone.criticality, triggerAt: today }, create: { organizationId: context.organizationId, projectId, legalObligationId: obligation.id, sourceType: "LEGAL_OBLIGATION", sourceId: obligation.id, milestoneCode: milestone.code, criticality: milestone.criticality, triggerAt: today, title: `${milestone.code} · ${obligation.title}`, message: `Obrigação ${obligation.code} com vencimento em ${obligation.dueAt.toISOString().slice(0, 10)}.`, responsibleId: obligation.responsibleId } });
  }
  for (const license of licenses) for (const milestone of milestonesReached(license.expiresAt!, today, milestones)) await prisma.legalAlert.upsert({ where: { organizationId_sourceType_sourceId_milestoneCode: { organizationId: context.organizationId, sourceType: "LEGAL_LICENSE", sourceId: license.id, milestoneCode: milestone.code } }, update: { criticality: milestone.criticality, triggerAt: today }, create: { organizationId: context.organizationId, projectId, sourceType: "LEGAL_LICENSE", sourceId: license.id, milestoneCode: milestone.code, criticality: milestone.criticality, triggerAt: today, title: `${milestone.code} · ${license.title}`, message: `Licença ${license.code} requer acompanhamento de vigência.`, responsibleId: license.responsibleId } });
  return { obligations: obligations.length, licenses: licenses.length };
}

function financialIdentity(obligation: { organizationId: string; id: string; amount: Prisma.Decimal | null; dueAt: Date }) {
  const idempotencyKey = createHash("sha256").update(`${obligation.organizationId}:LEGAL_OBLIGATION:${obligation.id}:1`).digest("hex");
  const payloadChecksum = createHash("sha256").update(JSON.stringify({ amount: obligation.amount?.toString(), dueAt: obligation.dueAt.toISOString() })).digest("hex");
  return { idempotencyKey, payloadChecksum };
}

export async function sendLegalObligationToFinance(context: AuthContext, legalObligationId: string) {
  assertApprover(context);
  const obligation = await prisma.legalObligation.findFirst({ where: { id: legalObligationId, organizationId: context.organizationId } });
  if (!obligation?.amount || !obligation.companyId || !obligation.supplierId) throw new Error("Obrigação jurídica exige valor, empresa/SPE e favorecido antes do envio ao Financeiro.");
  const amount = obligation.amount;
  const companyId = obligation.companyId;
  const supplierId = obligation.supplierId;
  const identity = financialIdentity(obligation);
  const replay = await prisma.legalFinancialEvent.findUnique({ where: { idempotencyKey: identity.idempotencyKey } });
  if (replay?.status === "PROCESSED") return replay;
  return prisma.$transaction(async (tx) => {
    const event = replay ?? await tx.legalFinancialEvent.create({ data: { organizationId: context.organizationId, projectId: obligation.projectId, legalObligationId: obligation.id, eventType: "LEGAL_OBLIGATION_CREATED", idempotencyKey: identity.idempotencyKey, payloadChecksum: identity.payloadChecksum, payload: json({ code: obligation.code, amount: amount.toString(), dueAt: obligation.dueAt.toISOString() }), status: "PENDING", createdById: context.userId } });
    const result = await createExternalPayableObligation(tx, { organizationId: context.organizationId, companyId, projectId: obligation.projectId, supplierId, costCenterId: obligation.costCenterId, economicItemId: obligation.economicItemId, budgetLineItemId: obligation.budgetLineItemId, scheduleActivityId: obligation.scheduleActivityId, sourceType: "LEGAL_OBLIGATION", sourceId: obligation.id, sourceVersion: 1, competenceDate: new Date(), dueDate: obligation.dueAt, grossAmount: amount, withholdings: new Prisma.Decimal(0), discounts: new Prisma.Decimal(0), advancesApplied: new Prisma.Decimal(0), netAmount: amount, currency: "BRL", description: obligation.title, responsibleId: obligation.responsibleId, createdById: context.userId, origin: "LEGAL" });
    const processed = await tx.legalFinancialEvent.update({ where: { id: event.id }, data: { status: "PROCESSED", financialObligationId: result.obligationId, payableAccountId: result.payableAccountId, processedAt: new Date() } });
    await tx.auditLog.create({ data: audit(context, obligation.projectId, "LEGAL_OBLIGATION_SENT_TO_FINANCE", "LegalObligation", obligation.id, { idempotencyKey: identity.idempotencyKey, financialObligationId: result.obligationId }) });
    return processed;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reverseLegalFinancialEvent(context: AuthContext, legalObligationId: string, reason: string) {
  assertApprover(context);
  if (!reason.trim()) throw new Error("Informe o motivo da reversão.");
  const event = await prisma.legalFinancialEvent.findFirst({ where: { organizationId: context.organizationId, legalObligationId, status: "PROCESSED" } });
  if (!event?.financialObligationId) throw new Error("Evento financeiro jurídico processado não encontrado.");
  return prisma.$transaction(async (tx) => {
    await reverseExternalPayableObligation(tx, { organizationId: context.organizationId, obligationId: event.financialObligationId!, reason });
    return tx.legalFinancialEvent.update({ where: { id: event.id }, data: { status: "REVERSED", reversedAt: new Date() } });
  });
}

export async function getLegalWorkspace(context: Pick<AuthContext, "organizationId">, projectId: string, referenceDate = new Date()) {
  await projectForTenant(context.organizationId, projectId);
  await refreshLegalDeadlines(context, projectId, referenceDate);
  const [cases, registrations, municipalRecords, obligations, alerts, licenses, processes, timeline, contracts] = await Promise.all([
    prisma.legalDueDiligenceCase.findMany({ where: { organizationId: context.organizationId, projectId }, include: { checklistItems: true, documentRequests: true, findings: true, decisions: { orderBy: { version: "desc" }, take: 1 }, parties: true }, orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.legalAssetRegistration.findMany({ where: { organizationId: context.organizationId, landAsset: { projectId } }, orderBy: [{ registrationNumber: "asc" }, { version: "desc" }], take: 100 }),
    prisma.municipalPropertyRecord.findMany({ where: { organizationId: context.organizationId, landAsset: { projectId } }, orderBy: [{ fiscalYear: "desc" }, { version: "desc" }], take: 100 }),
    prisma.legalObligation.findMany({ where: { organizationId: context.organizationId, projectId }, include: { financialEvents: true }, orderBy: { dueAt: "asc" }, take: 200 }),
    prisma.legalAlert.findMany({ where: { organizationId: context.organizationId, projectId, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, orderBy: [{ criticality: "desc" }, { triggerAt: "asc" }], take: 200 }),
    prisma.legalLicense.findMany({ where: { organizationId: context.organizationId, projectId }, include: { conditions: true }, orderBy: { expiresAt: "asc" }, take: 100 }),
    prisma.legalAuthorityProcess.findMany({ where: { organizationId: context.organizationId, projectId }, orderBy: { updatedAt: "desc" }, take: 100 }),
    prisma.legalTimelineEvent.findMany({ where: { organizationId: context.organizationId, projectId }, orderBy: { plannedAt: "asc" }, take: 200 }),
    prisma.operationalContract.findMany({ where: { organizationId: context.organizationId, projectId, type: "ACQUISITION" }, include: { supplier: true, legalConditions: true, legalGuarantees: true }, take: 50 }),
  ]);
  const checklist = cases.flatMap((item) => item.checklistItems);
  const findings = cases.flatMap((item) => item.findings);
  const readiness = legalReadiness({ checklist, findings, obligations });
  return plain({ projectId, generatedAt: referenceDate.toISOString(), summary: { readiness, openAlerts: alerts.length, criticalFindings: findings.filter((item) => item.severity === "CRITICAL" && item.status !== "RESOLVED").length, pendingDocuments: cases.flatMap((item) => item.documentRequests).filter((item) => !["COMPLIANT", "WAIVED", "RESOLVED"].includes(item.status)).length, overdueObligations: obligations.filter((item) => item.status === "OVERDUE").length, scheduleBlockers: timeline.filter((item) => item.blocksSchedule && item.status !== "RESOLVED").length }, cases, registrations, municipalRecords, obligations, alerts, licenses, processes, timeline, contracts });
}

export type LegalWorkspaceView = Awaited<ReturnType<typeof getLegalWorkspace>>;
