import { createHash } from "node:crypto";
import { Prisma, type AutoBudgetLineReviewDecision, type DesignConfidence, type DesignDataOrigin, type DesignFindingSeverity, type EngineeringOpinionItemStatus, type EngineeringOpinionTopic } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { assertDataIntelligenceCapability, hasDataIntelligenceCapability } from "@/domain/data-intelligence/capabilities";
import { buildCostCycleRow, calculateSmartBudgetLine, compareValueEngineeringAlternatives, evaluateAutoBudgetApprovalGate } from "@/domain/engineering/engine";
import { prisma } from "@/infrastructure/database/prisma";

type Context = Pick<AuthContext, "organizationId" | "userId" | "role">;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const stable = (value: unknown): unknown => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
const checksum = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const opinionEditors = new Set(["OWNER", "ADMIN", "ANALYST"]);
const opinionReviewers = new Set(["OWNER", "ADMIN", "REVIEWER"]);

function assertOpinionEditor(context: Context) {
  if (!opinionEditors.has(context.role)) throw new Error("Seu perfil não pode alterar Parecer Técnico.");
}

function assertOpinionReviewer(context: Context) {
  if (!opinionReviewers.has(context.role)) throw new Error("Seu perfil não pode validar Parecer Técnico.");
}

async function projectForTenant(context: Pick<Context, "organizationId">, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: context.organizationId }, select: { id: true, organizationId: true, companyId: true, currency: true, name: true } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  return project;
}

async function assertMember(context: Context, userId: string | null | undefined) {
  if (!userId) return;
  const member = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: context.organizationId, userId } } });
  if (!member) throw new Error("Responsável não pertence à organização atual.");
}

async function assertDesignRevision(context: Context, projectId: string, revisionId: string | null | undefined) {
  if (!revisionId) return;
  const revision = await prisma.designRevision.findFirst({ where: { id: revisionId, package: { organizationId: context.organizationId, projectId } }, select: { id: true } });
  if (!revision) throw new Error("Revisão de projeto não pertence a este empreendimento.");
}

function audit(context: Context, projectId: string, action: string, entityType: string, entityId: string, after?: unknown) {
  return { organizationId: context.organizationId, userId: context.userId, projectId, action, entityType, entityId, after: after == null ? undefined : json(after) };
}

export interface OpinionEvidenceInput {
  reference: string;
  label: string;
  value?: string | null;
  sourceType: DesignDataOrigin;
  confidence: DesignConfidence;
  metadata?: unknown;
}

export interface OpinionItemInput {
  topic: EngineeringOpinionTopic;
  observedCondition: string;
  risk: string;
  severity: DesignFindingSeverity;
  impact: { cost?: string; schedule?: string; method?: string; risk?: string; viability?: string };
  recommendation: string;
  sourceType: DesignDataOrigin;
  confidence: DesignConfidence;
  sourceFindingId?: string | null;
  technicalResponsibleId?: string | null;
  referenceDate: Date;
  evidence?: OpinionEvidenceInput[];
}

export interface CreateEngineeringOpinionInput {
  projectId: string;
  designRevisionId?: string | null;
  code: string;
  title: string;
  summary?: string | null;
  items: OpinionItemInput[];
}

export async function createEngineeringOpinion(context: Context, input: CreateEngineeringOpinionInput) {
  assertOpinionEditor(context);
  await projectForTenant(context, input.projectId);
  await assertDesignRevision(context, input.projectId, input.designRevisionId);
  for (const item of input.items) await assertMember(context, item.technicalResponsibleId);
  const findingIds = input.items.map((item) => item.sourceFindingId).filter((id): id is string => Boolean(id));
  if (findingIds.length) {
    const found = await prisma.designFinding.count({ where: { id: { in: findingIds }, organizationId: context.organizationId, projectId: input.projectId } });
    if (found !== new Set(findingIds).size) throw new Error("Há evidência técnica fora do empreendimento atual.");
  }
  const payload = { designRevisionId: input.designRevisionId ?? null, code: input.code.trim(), title: input.title.trim(), summary: input.summary?.trim() ?? null, items: input.items };
  const inputChecksum = checksum(payload);
  const existing = await prisma.engineeringTechnicalOpinion.findFirst({ where: { organizationId: context.organizationId, projectId: input.projectId, checksum: inputChecksum }, include: { items: { include: { evidence: true }, orderBy: { sequence: "asc" } } } });
  if (existing) return existing;
  return prisma.$transaction(async (tx) => {
    const opinion = await tx.engineeringTechnicalOpinion.create({
      data: {
        organizationId: context.organizationId, projectId: input.projectId, designRevisionId: input.designRevisionId ?? null,
        code: input.code.trim(), title: input.title.trim(), summary: input.summary?.trim() || null, checksum: inputChecksum, createdById: context.userId,
        items: { create: input.items.map((item, sequence) => ({
          sequence, topic: item.topic,
          observedCondition: item.observedCondition.trim(), risk: item.risk.trim(), severity: item.severity, impact: json(item.impact), recommendation: item.recommendation.trim(),
          sourceType: item.sourceType, confidence: item.confidence, sourceFindingId: item.sourceFindingId ?? null,
          technicalResponsibleId: item.technicalResponsibleId ?? null, referenceDate: item.referenceDate,
          evidence: { create: (item.evidence ?? []).map((evidence) => ({ reference: evidence.reference, label: evidence.label, value: evidence.value ?? null, sourceType: evidence.sourceType, confidence: evidence.confidence, metadata: evidence.metadata == null ? undefined : json(evidence.metadata) })) },
        })) },
      }, include: { items: { include: { evidence: true }, orderBy: { sequence: "asc" } } },
    });
    await tx.auditLog.create({ data: audit(context, input.projectId, "ENGINEERING_OPINION_CREATED", "EngineeringTechnicalOpinion", opinion.id, { version: opinion.version, checksum: opinion.checksum }) });
    return opinion;
  });
}

export async function updateEngineeringOpinionDraft(context: Context, opinionId: string, input: { title?: string; summary?: string | null }) {
  assertOpinionEditor(context);
  const opinion = await prisma.engineeringTechnicalOpinion.findFirst({ where: { id: opinionId, organizationId: context.organizationId } });
  if (!opinion || opinion.status !== "DRAFT") throw new Error("Somente Parecer Técnico em rascunho pode ser editado.");
  const updated = await prisma.engineeringTechnicalOpinion.update({ where: { id: opinion.id }, data: { title: input.title?.trim() || undefined, summary: input.summary === undefined ? undefined : input.summary?.trim() || null } });
  await prisma.auditLog.create({ data: audit(context, opinion.projectId, "ENGINEERING_OPINION_DRAFT_UPDATED", "EngineeringTechnicalOpinion", opinion.id, input) });
  return updated;
}

export async function submitEngineeringOpinion(context: Context, opinionId: string) {
  assertOpinionEditor(context);
  const opinion = await prisma.engineeringTechnicalOpinion.findFirst({ where: { id: opinionId, organizationId: context.organizationId }, include: { items: true } });
  if (!opinion || opinion.status !== "DRAFT") throw new Error("Somente Parecer Técnico em rascunho pode ser enviado.");
  if (!opinion.items.length) throw new Error("Inclua ao menos um item técnico antes do envio.");
  return prisma.engineeringTechnicalOpinion.update({ where: { id: opinion.id }, data: { status: "UNDER_REVIEW", submittedById: context.userId, submittedAt: new Date() } });
}

export async function decideEngineeringOpinionItem(context: Context, itemId: string, decision: Exclude<EngineeringOpinionItemStatus, "PENDING">) {
  assertOpinionReviewer(context);
  const item = await prisma.engineeringTechnicalOpinionItem.findFirst({ where: { id: itemId, organizationId: context.organizationId }, include: { opinion: true } });
  if (!item || item.opinion.status !== "UNDER_REVIEW") throw new Error("Item técnico não está disponível para validação.");
  return prisma.engineeringTechnicalOpinionItem.update({ where: { id: item.id }, data: { validationStatus: decision, validatedById: context.userId, validatedAt: new Date() } });
}

export async function decideEngineeringOpinion(context: Context, opinionId: string, decision: "VALIDATED" | "REJECTED") {
  assertOpinionReviewer(context);
  const opinion = await prisma.engineeringTechnicalOpinion.findFirst({ where: { id: opinionId, organizationId: context.organizationId }, include: { items: true } });
  if (!opinion || opinion.status !== "UNDER_REVIEW") throw new Error("Parecer Técnico não está em revisão.");
  if (decision === "VALIDATED" && opinion.items.some((item) => item.validationStatus !== "VALIDATED")) throw new Error("Todos os itens precisam estar validados.");
  const updated = await prisma.engineeringTechnicalOpinion.update({ where: { id: opinion.id }, data: { status: decision, validatedById: context.userId, validatedAt: new Date() } });
  await prisma.auditLog.create({ data: audit(context, opinion.projectId, `ENGINEERING_OPINION_${decision}`, "EngineeringTechnicalOpinion", opinion.id, { status: decision }) });
  return updated;
}

export async function createEngineeringOpinionVersion(context: Context, opinionId: string) {
  assertOpinionEditor(context);
  const source = await prisma.engineeringTechnicalOpinion.findFirst({ where: { id: opinionId, organizationId: context.organizationId }, include: { items: { include: { evidence: true }, orderBy: { sequence: "asc" } } } });
  if (!source) throw new Error("Parecer Técnico não encontrado nesta organização.");
  const existing = await prisma.engineeringTechnicalOpinion.findFirst({ where: { previousOpinionId: source.id, organizationId: context.organizationId } });
  if (existing) return existing;
  if (!["VALIDATED", "REJECTED"].includes(source.status)) throw new Error("Somente parecer concluído pode gerar nova versão.");
  return prisma.$transaction(async (tx) => {
    const version = source.version + 1;
    const draft = await tx.engineeringTechnicalOpinion.create({ data: {
      organizationId: source.organizationId, projectId: source.projectId, seriesKey: source.seriesKey, version, previousOpinionId: source.id,
      designRevisionId: source.designRevisionId, code: source.code, title: source.title, summary: source.summary,
      checksum: checksum({ source: source.checksum, version }), createdById: context.userId,
      items: { create: source.items.map((item) => ({ sequence: item.sequence, topic: item.topic, observedCondition: item.observedCondition, risk: item.risk, severity: item.severity, impact: item.impact as Prisma.InputJsonValue, recommendation: item.recommendation, sourceType: item.sourceType, confidence: item.confidence, sourceFindingId: item.sourceFindingId, technicalResponsibleId: item.technicalResponsibleId, referenceDate: item.referenceDate, evidence: { create: item.evidence.map((evidence) => ({ reference: evidence.reference, label: evidence.label, value: evidence.value, sourceType: evidence.sourceType, confidence: evidence.confidence, metadata: evidence.metadata as Prisma.InputJsonValue | undefined })) } })) },
    }, include: { items: { include: { evidence: true }, orderBy: { sequence: "asc" } } } });
    await tx.engineeringTechnicalOpinion.update({ where: { id: source.id }, data: { status: "SUPERSEDED" } });
    await tx.auditLog.create({ data: audit(context, source.projectId, "ENGINEERING_OPINION_VERSION_CREATED", "EngineeringTechnicalOpinion", draft.id, { previousOpinionId: source.id, version }) });
    return draft;
  });
}

export interface SmartBudgetLineRequest {
  economicItemId: string;
  description?: string;
  quantity?: number;
  unit?: string;
  quantityOrigin?: "BIM_IFC" | "MANUAL" | "ESTIMATE" | "ASSUMPTION";
  bimQuantityMappingId?: string | null;
  compositionId?: string | null;
  priceObservationId?: string | null;
  benchmarkRunId?: string | null;
  evidenceRequired?: boolean;
}

export async function createSmartBudgetProposal(context: Context, input: { projectId: string; name: string; rationale: string; baseDate?: Date; technicalOpinionId?: string | null; sourceBudgetId?: string | null; lines: SmartBudgetLineRequest[] }) {
  assertDataIntelligenceCapability(context.role, "AUTOBUDGET_BUILD");
  if (!input.lines.length || input.lines.length > 500) throw new Error("Informe entre 1 e 500 linhas por proposta.");
  await projectForTenant(context, input.projectId);
  const policy = await prisma.comparabilityPolicy.findFirst({ where: { organizationId: context.organizationId, status: "ACTIVE" }, orderBy: { version: "desc" } });
  if (!policy) throw new Error("Não há política ativa de comparabilidade para o Orçamento Inteligente.");
  if (input.technicalOpinionId) {
    const opinion = await prisma.engineeringTechnicalOpinion.findFirst({ where: { id: input.technicalOpinionId, organizationId: context.organizationId, projectId: input.projectId, status: "VALIDATED" } });
    if (!opinion) throw new Error("Use um Parecer Técnico validado deste empreendimento.");
  }
  if (input.sourceBudgetId) {
    const source = await prisma.budget.findFirst({ where: { id: input.sourceBudgetId, organizationId: context.organizationId, projectId: input.projectId } });
    if (!source) throw new Error("Orçamento de origem não pertence ao empreendimento atual.");
  }
  const economicIds = [...new Set(input.lines.map((line) => line.economicItemId))];
  const mappingIds = input.lines.map((line) => line.bimQuantityMappingId).filter((id): id is string => Boolean(id));
  const compositionIds = input.lines.map((line) => line.compositionId).filter((id): id is string => Boolean(id));
  const priceIds = input.lines.map((line) => line.priceObservationId).filter((id): id is string => Boolean(id));
  const benchmarkIds = input.lines.map((line) => line.benchmarkRunId).filter((id): id is string => Boolean(id));
  const [economicItems, mappings, compositions, prices, benchmarks, conversions] = await Promise.all([
    prisma.economicItem.findMany({ where: { id: { in: economicIds }, organizationId: context.organizationId, projectId: input.projectId } }),
    prisma.bimQuantityMapping.findMany({ where: { id: { in: mappingIds }, organizationId: context.organizationId, projectId: input.projectId, status: "APPROVED" }, include: { bimElement: { select: { ifcType: true, ifcGuid: true, model: { select: { revisionId: true } } } } } }),
    prisma.costCompositionDefinition.findMany({ where: { id: { in: compositionIds }, organizationId: context.organizationId }, include: { items: true } }),
    prisma.externalPriceObservation.findMany({ where: { id: { in: priceIds }, organizationId: context.organizationId } }),
    prisma.benchmarkRun.findMany({ where: { id: { in: benchmarkIds }, organizationId: context.organizationId, OR: [{ projectId: null }, { projectId: input.projectId }] } }),
    prisma.analyticsUnitConversion.findMany({ where: { organizationId: context.organizationId }, orderBy: { version: "desc" } }),
  ]);
  if (economicItems.length !== economicIds.length || mappings.length !== new Set(mappingIds).size || compositions.length !== new Set(compositionIds).size || prices.length !== new Set(priceIds).size || benchmarks.length !== new Set(benchmarkIds).size) throw new Error("Uma ou mais referências não pertencem ao empreendimento/organização ou ainda não foram aprovadas.");
  const byId = <T extends { id: string }>(values: T[]) => new Map(values.map((value) => [value.id, value]));
  const economics = byId(economicItems), mappingMap = byId(mappings), compositionMap = byId(compositions), priceMap = byId(prices), benchmarkMap = byId(benchmarks);
  const prepared = input.lines.map((request, sortOrder) => {
    const economic = economics.get(request.economicItemId)!;
    const mapping = request.bimQuantityMappingId ? mappingMap.get(request.bimQuantityMappingId)! : null;
    const composition = request.compositionId ? compositionMap.get(request.compositionId)! : null;
    const observation = request.priceObservationId ? priceMap.get(request.priceObservationId)! : null;
    const benchmark = request.benchmarkRunId ? benchmarkMap.get(request.benchmarkRunId)! : null;
    const quantity = mapping ? Number(mapping.quantity) : request.quantity;
    const unit = mapping?.unit ?? request.unit ?? economic.unit;
    if (quantity == null) throw new Error(`Quantidade ausente para ${economic.code}.`);
    const benchmarkUnit = benchmark?.unit?.startsWith("R$/") ? benchmark.unit.slice(3) : benchmark?.unit;
    const sourceUnit = observation?.unit ?? benchmarkUnit ?? unit;
    const conversion = sourceUnit === unit ? null : conversions.find((candidate) => candidate.fromUnit === sourceUnit && candidate.toUnit === unit);
    if (sourceUnit !== unit && !conversion) throw new Error(`Não há normalização de ${sourceUnit} para ${unit}.`);
    const priceValue = observation ? Number(observation.price) : benchmark?.median ? Number(benchmark.median) : null;
    const observationEvidence: "VALIDATED_PRICE" | "ESTIMATED_PRICE" = observation?.evidenceChecksum ? "VALIDATED_PRICE" : "ESTIMATED_PRICE";
    const price = priceValue == null ? null : observation ? { value: priceValue, source: observation.sourceProvider, referenceId: observation.id, observedAt: observation.observedAt.toISOString(), region: observation.region, supplier: observation.supplierName, evidenceStatus: observationEvidence } : { value: priceValue, source: "Histórico comparável REDE Data", referenceId: benchmark!.id, observedAt: benchmark!.asOfDate.toISOString(), region: null, supplier: null, evidenceStatus: "COMPARABLE_HISTORICAL_PRICE" as const };
    const result = calculateSmartBudgetLine({ quantity, unit, quantityOrigin: mapping ? `BIM_IFC:${mapping.extractionMethod}` : request.quantityOrigin ?? "MANUAL", quantityReferenceId: mapping?.id, composition: composition ? { id: composition.id, key: composition.key, version: composition.version, checksum: composition.checksum } : null, price, confidence: mapping?.confidenceLevel ?? benchmark?.confidenceLevel ?? (observation?.confidence != null && observation.confidence >= .8 ? "HIGH" : observation?.confidence != null && observation.confidence >= .5 ? "MEDIUM" : "LOW"), baseDate: (input.baseDate ?? observation?.observedAt ?? benchmark?.asOfDate)?.toISOString() ?? null, normalization: { currency: observation?.currency ?? "BRL", sourceUnit, targetUnit: unit, factor: conversion ? Number(conversion.factor) : 1 } });
    const lineChecksum = checksum({ economicItemId: economic.id, ...result.snapshot });
    return { request, economic, mapping, composition, observation, benchmark, result, sortOrder, lineChecksum };
  });
  const inputChecksum = checksum({ projectId: input.projectId, name: input.name, rationale: input.rationale, policyId: policy.id, technicalOpinionId: input.technicalOpinionId ?? null, sourceBudgetId: input.sourceBudgetId ?? null, lines: prepared.map((line) => line.lineChecksum) });
  const existing = await prisma.autoBudgetProposal.findFirst({ where: { organizationId: context.organizationId, projectId: input.projectId, inputChecksum }, include: { lines: true } });
  if (existing) return existing;
  return prisma.$transaction(async (tx) => {
    const proposal = await tx.autoBudgetProposal.create({ data: {
      organizationId: context.organizationId, projectId: input.projectId, name: input.name.trim(), policyId: policy.id, technicalOpinionId: input.technicalOpinionId ?? null, sourceBudgetId: input.sourceBudgetId ?? null, baseDate: input.baseDate ?? new Date(), inputChecksum, rationale: input.rationale.trim(), createdById: context.userId,
      lines: { create: prepared.map(({ request, economic, mapping, composition, observation, benchmark, result, sortOrder, lineChecksum }) => ({ economicItemId: economic.id, benchmarkRunId: benchmark?.id ?? null, bimQuantityMappingId: mapping?.id ?? null, compositionId: composition?.id ?? null, priceObservationId: observation?.id ?? null, description: request.description?.trim() || economic.description, quantity: result.snapshot.quantity.value, unit: result.snapshot.quantity.unit, suggestedUnitCost: result.unitCost, suggestedTotalCost: result.totalCost, confidenceLevel: result.snapshot.confidence as "HIGH" | "MEDIUM" | "LOW", evidenceStatus: result.evidenceStatus, evidenceRequired: request.evidenceRequired ?? true, priceBaseDate: result.snapshot.baseDate ? new Date(result.snapshot.baseDate) : null, sourceSnapshot: json(result.snapshot), inputChecksum: lineChecksum, rationale: `Cálculo determinístico: quantidade × preço normalizado. Composição ${composition?.key ?? "não informada"}.`, exceptions: json(result.evidenceStatus === "NO_EVIDENCE" ? ["SEM_EVIDENCIA"] : []), sortOrder })) },
    }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
    await tx.auditLog.create({ data: audit(context, input.projectId, "SMART_BUDGET_PROPOSAL_CREATED", "AutoBudgetProposal", proposal.id, { inputChecksum, lineCount: proposal.lines.length }) });
    return proposal;
  });
}

export async function submitSmartBudgetProposal(context: Context, proposalId: string) {
  assertDataIntelligenceCapability(context.role, "AUTOBUDGET_BUILD");
  const proposal = await prisma.autoBudgetProposal.findFirst({ where: { id: proposalId, organizationId: context.organizationId }, include: { lines: true } });
  if (!proposal || proposal.status !== "DRAFT") throw new Error("Somente proposta em rascunho pode seguir para revisão.");
  if (!proposal.lines.length) throw new Error("A proposta não possui itens.");
  return prisma.autoBudgetProposal.update({ where: { id: proposal.id }, data: { status: "REVIEW", reviewedById: context.userId, reviewedAt: new Date() } });
}

export async function appendSmartBudgetLineReview(context: Context, input: { lineId: string; decision: AutoBudgetLineReviewDecision; revisedQuantity?: number | null; revisedCompositionId?: string | null; revisedUnitCost?: number | null; justification: string; evidence?: OpinionEvidenceInput[] }) {
  assertDataIntelligenceCapability(context.role, "AUTOBUDGET_REVIEW");
  if (!input.justification.trim()) throw new Error("A justificativa da revisão é obrigatória.");
  const line = await prisma.autoBudgetProposalLine.findFirst({ where: { id: input.lineId, organizationId: context.organizationId }, include: { proposal: true, reviews: { orderBy: { revisionNumber: "desc" }, take: 1 } } });
  if (!line || line.proposal.status !== "REVIEW") throw new Error("Linha não está em revisão nesta organização.");
  if (input.revisedCompositionId) {
    const composition = await prisma.costCompositionDefinition.findFirst({ where: { id: input.revisedCompositionId, organizationId: context.organizationId } });
    if (!composition) throw new Error("Composição revisada não pertence à organização atual.");
  }
  const latest = line.reviews[0];
  const signature = JSON.stringify([input.decision, input.revisedQuantity ?? null, input.revisedCompositionId ?? null, input.revisedUnitCost ?? null, input.justification.trim()]);
  if (latest && JSON.stringify([latest.decision, latest.revisedQuantity == null ? null : Number(latest.revisedQuantity), latest.revisedCompositionId, latest.revisedUnitCost == null ? null : Number(latest.revisedUnitCost), latest.justification]) === signature) return latest;
  return prisma.autoBudgetLineReview.create({ data: { organizationId: context.organizationId, projectId: line.projectId, lineId: line.id, revisionNumber: (latest?.revisionNumber ?? 0) + 1, decision: input.decision, originalQuantity: latest?.revisedQuantity ?? line.quantity, revisedQuantity: input.revisedQuantity ?? null, originalCompositionId: latest?.revisedCompositionId ?? line.compositionId, revisedCompositionId: input.revisedCompositionId ?? null, originalUnitCost: latest?.revisedUnitCost ?? line.suggestedUnitCost, revisedUnitCost: input.revisedUnitCost ?? null, justification: input.justification.trim(), reviewedById: context.userId, evidence: { create: (input.evidence ?? []).map((evidence) => ({ reference: evidence.reference, label: evidence.label, value: evidence.value ?? null, sourceType: evidence.sourceType, confidence: evidence.confidence, metadata: evidence.metadata == null ? undefined : json(evidence.metadata) })) } }, include: { evidence: true } });
}

export async function approveSmartBudgetProposal(context: Context, proposalId: string) {
  assertDataIntelligenceCapability(context.role, "AUTOBUDGET_APPROVE");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${proposalId}))::text AS locked`;
    const proposal = await tx.autoBudgetProposal.findFirst({ where: { id: proposalId, organizationId: context.organizationId }, include: { project: true, sourceBudget: true, lines: { include: { economicItem: true, reviews: { orderBy: { revisionNumber: "desc" } } }, orderBy: { sortOrder: "asc" } } } });
    if (!proposal) throw new Error("Proposta não encontrada nesta organização.");
    if (proposal.status === "APPROVED" && proposal.approvedBudgetId) return tx.budget.findUniqueOrThrow({ where: { id: proposal.approvedBudgetId }, include: { lineItems: true } });
    if (proposal.status !== "REVIEW") throw new Error("A proposta precisa estar em revisão.");
    const gate = evaluateAutoBudgetApprovalGate(proposal.lines.map((line) => ({ id: line.id, evidenceRequired: line.evidenceRequired, evidenceStatus: line.evidenceStatus, sourceSnapshot: line.sourceSnapshot, latestDecision: line.reviews[0]?.decision ?? null })));
    if (!gate.allowed) throw new Error(`Aprovação bloqueada: ${gate.blockers.map((blocker) => blocker.reason).join(" ")}`);
    const budgetName = proposal.sourceBudget?.name ?? "Orçamento Inteligente";
    const latest = await tx.budget.aggregate({ where: { projectId: proposal.projectId, name: budgetName }, _max: { version: true } });
    const effectiveLines = proposal.lines.map((line) => {
      const review = line.reviews[0]!;
      const quantity = review.decision === "ADJUSTED" && review.revisedQuantity != null ? review.revisedQuantity : line.quantity;
      const unitCost = review.decision === "ADJUSTED" && review.revisedUnitCost != null ? review.revisedUnitCost : line.suggestedUnitCost;
      return { line, review, quantity, unitCost, total: new Prisma.Decimal(quantity).mul(unitCost).toDecimalPlaces(2) };
    });
    const budget = await tx.budget.create({ data: { organizationId: proposal.organizationId, projectId: proposal.projectId, companyId: proposal.project.companyId, studyVersionId: proposal.sourceBudget?.studyVersionId ?? null, operationalBaselineId: proposal.sourceBudget?.operationalBaselineId ?? null, previousBudgetId: proposal.sourceBudgetId, name: budgetName, description: `Gerado pela proposta de Orçamento Inteligente ${proposal.name}.`, status: "APPROVED", kind: proposal.sourceBudget ? "REVISED" : "PRELIMINARY", currency: proposal.project.currency, baseDate: proposal.baseDate ?? new Date(), version: (latest._max.version ?? 0) + 1, totalBudget: effectiveLines.reduce((sum, item) => sum.add(item.total), new Prisma.Decimal(0)), revisionReason: proposal.rationale, checksum: proposal.inputChecksum, createdById: context.userId, updatedById: context.userId, approvedById: context.userId, approvedAt: new Date(), lineItems: { create: effectiveLines.map(({ line, review, quantity, unitCost, total }, sortOrder) => ({ economicItemId: line.economicItemId, code: line.economicItem?.code ?? `OI-${sortOrder + 1}`, description: line.description, category: line.economicItem?.category ?? "Engenharia", subcategory: line.economicItem?.subcategory ?? null, phase: "Engenharia e Obra", unit: line.unit, quantity, unitCost: new Prisma.Decimal(unitCost).toDecimalPlaces(2), totalCost: total, sortOrder, origin: `AUTO_BUDGET:${proposal.id}`, costOrigin: line.evidenceStatus === "COMPARABLE_HISTORICAL_PRICE" ? "REDE_HISTORY" : line.evidenceStatus === "VALIDATED_PRICE" ? "RECEIVED_QUOTE" : "ESTIMATE", status: "APPROVED", notes: `Revisão humana ${review.revisionNumber}: ${review.justification}` })) } }, include: { lineItems: true } });
    await tx.autoBudgetProposal.update({ where: { id: proposal.id }, data: { status: "APPROVED", approvedBudgetId: budget.id, approvedById: context.userId, approvedAt: new Date() } });
    await tx.auditLog.create({ data: audit(context, proposal.projectId, "SMART_BUDGET_APPROVED", "AutoBudgetProposal", proposal.id, { approvedBudgetId: budget.id, baselineUnchanged: true }) });
    return budget;
  });
}

export async function rejectSmartBudgetProposal(context: Context, proposalId: string, reason: string) {
  assertDataIntelligenceCapability(context.role, "AUTOBUDGET_APPROVE");
  if (!reason.trim()) throw new Error("Informe o motivo da rejeição.");
  const proposal = await prisma.autoBudgetProposal.findFirst({ where: { id: proposalId, organizationId: context.organizationId, status: "REVIEW" } });
  if (!proposal) throw new Error("Proposta não está disponível para decisão.");
  return prisma.autoBudgetProposal.update({ where: { id: proposal.id }, data: { status: "REJECTED", rejectionReason: reason.trim(), approvedById: context.userId, approvedAt: new Date() } });
}

export async function getEngineeringWorkspace(context: Context, projectId: string) {
  await projectForTenant(context, projectId);
  assertDataIntelligenceCapability(context.role, "AUTOBUDGET_VIEW");
  const [opinions, quantities, compositions, prices, proposals, budget, contracts, measurements, payables, packages, pendingNoEvidence] = await Promise.all([
    prisma.engineeringTechnicalOpinion.findMany({ where: { organizationId: context.organizationId, projectId }, orderBy: { createdAt: "desc" }, take: 30, include: { items: { orderBy: { sequence: "asc" }, include: { evidence: true, technicalResponsible: { select: { name: true } } } } } }),
    prisma.bimQuantityMapping.findMany({ where: { organizationId: context.organizationId, projectId }, orderBy: { createdAt: "desc" }, take: 100, include: { economicItem: true, bimElement: { select: { name: true, ifcType: true, storey: true, model: { select: { revisionId: true } } } } } }),
    prisma.costCompositionDefinition.findMany({ where: { organizationId: context.organizationId }, orderBy: [{ key: "asc" }, { version: "desc" }], take: 100, include: { items: { orderBy: { sortOrder: "asc" } } } }),
    prisma.externalPriceObservation.findMany({ where: { organizationId: context.organizationId }, orderBy: { observedAt: "desc" }, take: 100 }),
    prisma.autoBudgetProposal.findMany({ where: { organizationId: context.organizationId, projectId }, orderBy: { createdAt: "desc" }, take: 30, include: { approvedBudget: true, lines: { orderBy: { sortOrder: "asc" }, take: 500, include: { economicItem: true, composition: true, priceObservation: true, reviews: { orderBy: { revisionNumber: "desc" }, include: { evidence: true } } } } } }),
    prisma.budget.findFirst({ where: { organizationId: context.organizationId, projectId, status: { in: ["APPROVED", "OFFICIAL"] } }, orderBy: [{ version: "desc" }, { updatedAt: "desc" }], include: { lineItems: true } }),
    prisma.operationalContract.findMany({ where: { organizationId: context.organizationId, projectId, status: { in: ["APPROVED", "ACTIVE", "CLOSED"] } }, take: 100, include: { items: true, amendments: { where: { status: "APPROVED" } } } }),
    prisma.measurementCertificate.findMany({ where: { organizationId: context.organizationId, projectId, status: { in: ["TECHNICALLY_APPROVED", "APPROVED", "SENT_TO_FINANCE"] } }, take: 100, include: { lines: true } }),
    prisma.payableAccount.findMany({ where: { organizationId: context.organizationId, projectId, cancelledAt: null }, take: 200, include: { installments: { include: { payments: { where: { status: { in: ["PROCESSED", "CLEARED"] } } } } } } }),
    prisma.designProjectPackage.findMany({ where: { organizationId: context.organizationId, projectId }, take: 20, include: { revisions: { orderBy: { versionNumber: "desc" }, take: 1, include: { opportunities: true, alternatives: { include: { impacts: { orderBy: { createdAt: "desc" }, take: 1 } } } } } } }),
    findPendingNoEvidenceLines(context.organizationId, projectId),
  ]);
  const ids = new Set<string>();
  budget?.lineItems.forEach((item) => item.economicItemId && ids.add(item.economicItemId));
  contracts.forEach((contract) => contract.items.forEach((item) => item.economicItemId && ids.add(item.economicItemId)));
  measurements.forEach((certificate) => certificate.lines.forEach((item) => item.economicItemId && ids.add(item.economicItemId)));
  payables.forEach((account) => account.economicItemId && ids.add(account.economicItemId));
  const economics = await prisma.economicItem.findMany({ where: { organizationId: context.organizationId, projectId, id: { in: [...ids] } } });
  const byEconomic = new Map(economics.map((item) => [item.id, item]));
  const cycle = [...ids].map((economicItemId) => {
    const item = byEconomic.get(economicItemId)!;
    const budgeted = budget?.lineItems.filter((line) => line.economicItemId === economicItemId).reduce((sum, line) => sum + Number(line.totalCost), 0) ?? 0;
    const contracted = contracts.flatMap((contract) => contract.items).filter((line) => line.economicItemId === economicItemId).reduce((sum, line) => sum + Number(line.originalAmount), 0);
    const measured = measurements.flatMap((certificate) => certificate.lines).filter((line) => line.economicItemId === economicItemId).reduce((sum, line) => sum + Number(line.amount), 0);
    const realized = payables.filter((account) => account.economicItemId === economicItemId).flatMap((account) => account.installments).flatMap((installment) => installment.payments).reduce((sum, payment) => sum + Number(payment.amount), 0);
    // Não há fonte de dado para "estimativa restante" (ETC) na 9M: nunca presumir zero custo
    // adicional só porque parte do item já foi contratada — sem evidência, projeção fica nula.
    return buildCostCycleRow({ economicItemId, code: item.code, description: item.description, budgeted, contracted, measured, realized, remainingEstimate: null });
  });
  const sum = (key: "budgeted" | "contracted" | "measured" | "realized" | "openCommitment") => cycle.reduce((total, row) => total + row[key], 0);
  const projectedValues = cycle.map((row) => row.finalProjected).filter((value): value is number => value != null);
  const summary = { budgeted: sum("budgeted"), contracted: sum("contracted"), measured: sum("measured"), realized: sum("realized"), openCommitment: sum("openCommitment"), finalProjected: projectedValues.length === cycle.length && cycle.length ? projectedValues.reduce((a, b) => a + b, 0) : null, noEvidence: pendingNoEvidence.length, criticalRisks: opinions.flatMap((opinion) => opinion.items).filter((item) => item.severity === "CRITICAL" && item.validationStatus !== "VALIDATED").length, pendingReviews: proposals.filter((proposal) => proposal.status === "REVIEW").length };
  return plain({ projectId, capabilities: { editOpinion: opinionEditors.has(context.role), validateOpinion: opinionReviewers.has(context.role), buildBudget: hasDataIntelligenceCapability(context.role, "AUTOBUDGET_BUILD"), reviewBudget: hasDataIntelligenceCapability(context.role, "AUTOBUDGET_REVIEW"), approveBudget: hasDataIntelligenceCapability(context.role, "AUTOBUDGET_APPROVE") }, opinions, quantities, compositions, prices, proposals, approvedBudget: budget, cycle, summary, valueEngineering: packages.flatMap((pack) => pack.revisions).flatMap((revision) => ({ opportunities: revision.opportunities, alternatives: compareValueEngineeringAlternatives(revision.alternatives.map((alternative) => { const impact = alternative.impacts[0]?.delta as Record<string, unknown> | undefined; return { id: alternative.id, name: alternative.name, cost: typeof impact?.cost === "number" ? impact.cost : null, scheduleMonths: typeof impact?.scheduleMonths === "number" ? impact.scheduleMonths : null, risk: String(impact?.risk ?? "Não avaliado"), technicalImpact: alternative.description }; })) })) });
}

export type EngineeringWorkspaceView = Awaited<ReturnType<typeof getEngineeringWorkspace>>;

/**
 * Única fonte de verdade para "itens sem evidência pendentes": só linhas de propostas DRAFT/REVIEW
 * (ainda decidíveis) com evidência obrigatória — propostas históricas (APPROVED/REJECTED/
 * SUPERSEDED) nunca contaminam o indicador, pois já não bloqueiam nem exigem mais nenhuma decisão.
 * Reaproveitada por `getEngineeringWorkspace` (tela de Engenharia) e `getEngineeringExecutiveSignals`
 * (Gestão Executiva/Central de Ações) — as três superfícies sempre mostram o mesmo número.
 */
function findPendingNoEvidenceLines(organizationId: string, projectId: string) {
  return prisma.autoBudgetProposalLine.findMany({ where: { organizationId, projectId, evidenceRequired: true, evidenceStatus: "NO_EVIDENCE", proposal: { status: { in: ["DRAFT", "REVIEW"] } } }, take: 100, select: { id: true, description: true, suggestedTotalCost: true } });
}

/** Leitura compacta compartilhada pela Gestão Executiva e pela Central de Ações. */
export async function getEngineeringExecutiveSignals(organizationId: string, projectId: string) {
  await projectForTenant({ organizationId }, projectId);
  const [budget, contracts, measurements, payments, noEvidence, criticalItems, proposals] = await Promise.all([
    prisma.budget.findFirst({ where: { organizationId, projectId, status: { in: ["APPROVED", "OFFICIAL"] } }, orderBy: [{ version: "desc" }, { updatedAt: "desc" }], select: { id: true, totalBudget: true } }),
    prisma.operationalContract.findMany({ where: { organizationId, projectId, status: { in: ["APPROVED", "ACTIVE", "CLOSED"] } }, take: 200, select: { originalAmount: true, amendments: { where: { status: "APPROVED" }, select: { value: true } } } }),
    prisma.measurementCertificate.aggregate({ where: { organizationId, projectId, status: { in: ["TECHNICALLY_APPROVED", "APPROVED", "SENT_TO_FINANCE"] } }, _sum: { grossAmount: true } }),
    prisma.payablePayment.findMany({ where: { status: { in: ["PROCESSED", "CLEARED"] }, installment: { payableAccount: { organizationId, projectId, cancelledAt: null } } }, select: { amount: true } }),
    findPendingNoEvidenceLines(organizationId, projectId),
    prisma.engineeringTechnicalOpinionItem.findMany({ where: { organizationId, projectId, severity: "CRITICAL", validationStatus: { not: "VALIDATED" }, opinion: { status: "UNDER_REVIEW" } }, take: 100, select: { id: true, observedCondition: true, risk: true, technicalResponsibleId: true } }),
    prisma.autoBudgetProposal.findMany({ where: { organizationId, projectId, status: "REVIEW" }, take: 100, select: { id: true, name: true, reviewedAt: true, createdById: true } }),
  ]);
  const budgeted = Number(budget?.totalBudget ?? 0);
  const contracted = contracts.reduce((sum, contract) => sum + Number(contract.originalAmount) + contract.amendments.reduce((value, amendment) => value + Number(amendment.value), 0), 0);
  const measured = Number(measurements._sum.grossAmount ?? 0);
  const realized = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  // Idem: sem fonte de estimativa restante (ETC), a projeção final nunca é fabricada a partir do
  // contratado — fica indisponível até existir evidência real de custo remanescente.
  const finalProjected = null;
  return { budgeted, contracted, measured, realized, finalProjected, projectedDeviation: finalProjected == null ? null : finalProjected - budgeted, noEvidence: noEvidence.map((item) => ({ ...item, amount: Number(item.suggestedTotalCost) })), criticalItems, proposals };
}
