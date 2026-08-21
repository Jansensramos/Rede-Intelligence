import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { createExternalPayableObligation, reverseExternalPayableObligation } from "@/application/financial-ops/external-obligation-port";
import { prisma } from "@/infrastructure/database/prisma";
import * as engine from "@/domain/procurement/engine";
import {
  createAmendmentSchema, createContractSchema, createMeasurementSchema, createNeedSchema, createProposalSchema, createPurchaseOrderSchema, createQuotationSchema, createRequisitionSchema,
  type CreateAmendmentInput, type CreateContractInput, type CreateMeasurementInput, type CreateNeedInput, type CreateProposalInput, type CreatePurchaseOrderInput, type CreateQuotationInput, type CreateRequisitionInput,
} from "@/domain/procurement/schemas";

const mutableRoles = new Set(["OWNER", "ADMIN", "ANALYST"]);
const approvalRoles = new Set(["OWNER", "ADMIN"]);
const json = (value: unknown) => value as Prisma.InputJsonValue;
const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

function assertMutable(context: Pick<AuthContext, "role">) {
  if (!mutableRoles.has(context.role)) throw new Error("Seu perfil não pode alterar dados de suprimentos.");
}

function assertApprover(context: Pick<AuthContext, "role">) {
  if (!approvalRoles.has(context.role)) throw new Error("Somente Administrador ou Owner pode aprovar este ato.");
}

const audit = (context: AuthContext, projectId: string | null, action: string, entityType: string, entityId: string, after?: unknown) => ({
  organizationId: context.organizationId, userId: context.userId, projectId, action, entityType, entityId, after: after === undefined ? undefined : json(after),
});

async function projectForTenant(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  return project;
}

async function supplierForTenant(organizationId: string, supplierId: string) {
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, organizationId } });
  if (!supplier) throw new Error("Fornecedor não encontrado nesta organização.");
  return supplier;
}

async function validateProjectReferences(organizationId: string, projectId: string, refs: { companyId?: string | null; economicItemId?: string | null; budgetLineItemId?: string | null; costCenterId?: string | null; operatingUnitId?: string | null; scheduleActivityId?: string | null }) {
  const project = await projectForTenant(organizationId, projectId);
  if (refs.companyId && !(await prisma.company.findFirst({ where: { id: refs.companyId, organizationId } }))) throw new Error("Empresa/SPE não pertence à organização.");
  if (refs.economicItemId && !(await prisma.economicItem.findFirst({ where: { id: refs.economicItemId, organizationId, projectId } }))) throw new Error("Item econômico não pertence ao empreendimento.");
  if (refs.budgetLineItemId && !(await prisma.budgetLineItem.findFirst({ where: { id: refs.budgetLineItemId, budget: { organizationId, projectId } } }))) throw new Error("Verba orçamentária não pertence ao empreendimento.");
  if (refs.costCenterId && !(await prisma.costCenter.findFirst({ where: { id: refs.costCenterId, organizationId, OR: [{ projectId }, { projectId: null }] } }))) throw new Error("Centro de custo não pertence ao empreendimento.");
  if (refs.operatingUnitId && !(await prisma.projectOperatingUnit.findFirst({ where: { id: refs.operatingUnitId, projectId } }))) throw new Error("Unidade operacional não pertence ao empreendimento.");
  if (refs.scheduleActivityId && !(await prisma.scheduleActivity.findFirst({ where: { id: refs.scheduleActivityId, schedule: { organizationId, projectId } } }))) throw new Error("Atividade não pertence ao empreendimento.");
  return project;
}

export async function qualifySupplier(context: AuthContext, input: { supplierId: string; category: string; status: "PENDING" | "QUALIFIED" | "QUALIFIED_WITH_RESTRICTIONS" | "EXPIRED" | "REJECTED"; validUntil?: Date | null; evidence?: Record<string, unknown> }) {
  assertMutable(context);
  await supplierForTenant(context.organizationId, input.supplierId);
  const record = await prisma.supplierQualification.upsert({
    where: { supplierId_category: { supplierId: input.supplierId, category: input.category.trim() } },
    update: { status: input.status, validUntil: input.validUntil ?? null, evidence: input.evidence ? json(input.evidence) : undefined, reviewedById: context.userId, reviewedAt: new Date() },
    create: { organizationId: context.organizationId, supplierId: input.supplierId, category: input.category.trim(), status: input.status, validUntil: input.validUntil ?? null, evidence: input.evidence ? json(input.evidence) : undefined, reviewedById: context.userId, reviewedAt: new Date(), createdById: context.userId },
  });
  await prisma.auditLog.create({ data: audit(context, null, "SUPPLIER_QUALIFICATION_RECORDED", "SupplierQualification", record.id, { status: record.status, category: record.category }) });
  return record;
}

export async function createProcurementNeed(context: AuthContext, raw: CreateNeedInput) {
  assertMutable(context);
  const input = createNeedSchema.parse(raw);
  const project = await validateProjectReferences(context.organizationId, input.projectId, input);
  const need = await prisma.procurementNeed.create({ data: {
    organizationId: context.organizationId, companyId: input.companyId ?? project.companyId ?? null, projectId: input.projectId, operatingUnitId: input.operatingUnitId ?? null,
    costCenterId: input.costCenterId ?? null, economicItemId: input.economicItemId ?? null, budgetLineItemId: input.budgetLineItemId ?? null, scheduleActivityId: input.scheduleActivityId ?? null,
    code: input.code, description: input.description, specification: input.specification, quantity: input.quantity, unit: input.unit, requiredAt: input.requiredAt,
    expectedLeadDays: input.expectedLeadDays, bufferDays: input.bufferDays, priority: input.priority, origin: input.origin, originReference: input.originReference ?? null,
    originMetadata: input.originMetadata ? json(input.originMetadata) : undefined, requesterId: context.userId, technicalOwnerId: input.technicalOwnerId ?? null, createdById: context.userId, updatedById: context.userId,
  } });
  await prisma.auditLog.create({ data: audit(context, input.projectId, "PROCUREMENT_NEED_CREATED", "ProcurementNeed", need.id, { code: need.code, origin: need.origin }) });
  return need;
}

export async function validateProcurementNeed(context: AuthContext, needId: string) {
  assertMutable(context);
  const need = await prisma.procurementNeed.findFirst({ where: { id: needId, organizationId: context.organizationId } });
  if (!need || need.status !== "IDENTIFIED") throw new Error("Necessidade não encontrada ou indisponível para validação.");
  const updated = await prisma.procurementNeed.update({ where: { id: need.id }, data: { status: "VALIDATED", updatedById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, need.projectId, "PROCUREMENT_NEED_VALIDATED", "ProcurementNeed", need.id, { status: updated.status }) });
  return updated;
}

export async function createPurchaseRequisition(context: AuthContext, raw: CreateRequisitionInput) {
  assertMutable(context);
  const input = createRequisitionSchema.parse(raw);
  const project = await projectForTenant(context.organizationId, input.projectId);
  const needs = await prisma.procurementNeed.findMany({ where: { id: { in: input.needIds }, organizationId: context.organizationId, projectId: input.projectId, status: "VALIDATED" } });
  if (needs.length !== new Set(input.needIds).size) throw new Error("Todas as necessidades devem estar validadas e pertencer ao empreendimento.");
  return prisma.$transaction(async (tx) => {
    const requisition = await tx.purchaseRequisition.create({ data: {
      organizationId: context.organizationId, companyId: input.companyId ?? project.companyId ?? null, projectId: input.projectId, number: input.number, title: input.title,
      justification: input.justification ?? null, requesterId: context.userId, buyerId: input.buyerId ?? null, technicalOwnerId: input.technicalOwnerId ?? null, createdById: context.userId, updatedById: context.userId,
      items: { create: needs.map((need, index) => ({ needId: need.id, economicItemId: need.economicItemId, budgetLineItemId: need.budgetLineItemId, costCenterId: need.costCenterId, description: need.description, quantity: need.quantity, unit: need.unit, requiredAt: need.requiredAt, sortOrder: index })) },
    }, include: { items: true } });
    await tx.procurementNeed.updateMany({ where: { id: { in: needs.map((item) => item.id) } }, data: { status: "CONVERTED_TO_REQUISITION", updatedById: context.userId } });
    await tx.auditLog.create({ data: audit(context, input.projectId, "PURCHASE_REQUISITION_CREATED", "PurchaseRequisition", requisition.id, { number: requisition.number, items: requisition.items.length }) });
    return requisition;
  });
}

export async function transitionPurchaseRequisition(context: AuthContext, requisitionId: string, to: "REQUESTED" | "IN_APPROVAL" | "APPROVED_FOR_QUOTATION" | "RETURNED" | "IN_QUOTATION" | "FULFILLED" | "CANCELLED" | "DRAFT", reason?: string) {
  assertMutable(context);
  const requisition = await prisma.purchaseRequisition.findFirst({ where: { id: requisitionId, organizationId: context.organizationId } });
  if (!requisition) throw new Error("Requisição não encontrada nesta organização.");
  engine.assertTransition("requisition", requisition.status, to);
  if (to === "APPROVED_FOR_QUOTATION") assertApprover(context);
  if (to === "CANCELLED" && !reason?.trim()) throw new Error("Informe o motivo do cancelamento.");
  const updated = await prisma.purchaseRequisition.update({ where: { id: requisition.id }, data: { status: to, requestedAt: to === "REQUESTED" ? new Date() : requisition.requestedAt, approvedAt: to === "APPROVED_FOR_QUOTATION" ? new Date() : requisition.approvedAt, approvedById: to === "APPROVED_FOR_QUOTATION" ? context.userId : requisition.approvedById, cancelledAt: to === "CANCELLED" ? new Date() : null, cancellationReason: to === "CANCELLED" ? reason : null, updatedById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, requisition.projectId, "PURCHASE_REQUISITION_TRANSITIONED", "PurchaseRequisition", requisition.id, { from: requisition.status, to, reason }) });
  return updated;
}

export async function createQuotationProcess(context: AuthContext, raw: CreateQuotationInput) {
  assertMutable(context);
  const input = createQuotationSchema.parse(raw);
  const requisition = await prisma.purchaseRequisition.findFirst({ where: { id: input.requisitionId, organizationId: context.organizationId }, include: { items: true } });
  if (!requisition || !["APPROVED_FOR_QUOTATION", "IN_QUOTATION"].includes(requisition.status)) throw new Error("Requisição não aprovada para cotação.");
  const suppliers = await prisma.supplier.findMany({ where: { id: { in: input.supplierIds }, organizationId: context.organizationId, status: "ACTIVE" } });
  if (suppliers.length !== new Set(input.supplierIds).size) throw new Error("Um ou mais fornecedores não estão ativos nesta organização.");
  const checksum = createHash("sha256").update(JSON.stringify({ scope: input.scope, requirements: input.requirements, items: requisition.items.map((item) => [item.id, item.quantity.toString(), item.unit]) })).digest("hex");
  return prisma.$transaction(async (tx) => {
    const specification = await tx.procurementSpecification.create({ data: { requisitionId: requisition.id, version: 1, title: input.title, scope: input.scope, requirements: json(input.requirements), deliveryLocation: input.deliveryLocation ?? null, deliveryTerm: input.deliveryTerm ?? null, checksum, isFrozen: true, createdById: context.userId } });
    const quotation = await tx.quotationProcess.create({ data: { organizationId: context.organizationId, projectId: requisition.projectId, requisitionId: requisition.id, specificationId: specification.id, number: input.number, title: input.title, status: "OPEN", responseDeadline: input.responseDeadline ?? null, buyerId: context.userId, openedAt: new Date(), createdById: context.userId, updatedById: context.userId, invitations: { create: suppliers.map((supplier) => ({ supplierId: supplier.id, invitedById: context.userId })) } }, include: { invitations: true, specification: true } });
    await tx.purchaseRequisition.update({ where: { id: requisition.id }, data: { status: "IN_QUOTATION", updatedById: context.userId } });
    await tx.auditLog.create({ data: audit(context, requisition.projectId, "QUOTATION_PROCESS_OPENED", "QuotationProcess", quotation.id, { number: quotation.number, specificationVersion: 1, suppliers: suppliers.length }) });
    return quotation;
  });
}

export async function submitSupplierProposal(context: AuthContext, raw: CreateProposalInput) {
  assertMutable(context);
  const input = createProposalSchema.parse(raw);
  const quotation = await prisma.quotationProcess.findFirst({ where: { id: input.quotationProcessId, organizationId: context.organizationId, status: "OPEN" }, include: { requisition: { include: { items: true } }, invitations: true } });
  if (!quotation || !quotation.invitations.some((item) => item.supplierId === input.supplierId)) throw new Error("Processo aberto ou convite do fornecedor não encontrado.");
  await supplierForTenant(context.organizationId, input.supplierId);
  const allowedItems = new Set(quotation.requisition.items.map((item) => item.id));
  if (input.items.some((item) => !allowedItems.has(item.requisitionItemId))) throw new Error("A proposta contém item alheio à requisição.");
  const itemTotals = input.items.map((item) => engine.proposalTotal({ itemsSubtotal: decimal(item.quantity).mul(item.unitPrice), taxAmount: item.taxAmount, freightAmount: item.freightAmount, discountAmount: item.discountAmount }));
  const subtotal = itemTotals.reduce((sum, value) => sum.add(value), new Prisma.Decimal(0));
  const total = engine.proposalTotal({ itemsSubtotal: subtotal, taxAmount: input.taxAmount, freightAmount: input.freightAmount, discountAmount: input.discountAmount });
  const checksum = createHash("sha256").update(JSON.stringify({ quotationId: quotation.id, supplierId: input.supplierId, version: input.version, total: total.toString(), items: input.items })).digest("hex");
  return prisma.$transaction(async (tx) => {
    if (input.previousProposalId) await tx.supplierProposal.updateMany({ where: { id: input.previousProposalId, quotationProcessId: quotation.id, supplierId: input.supplierId }, data: { status: "REPLACED" } });
    const proposal = await tx.supplierProposal.create({ data: { quotationProcessId: quotation.id, supplierId: input.supplierId, previousProposalId: input.previousProposalId ?? null, version: input.version, status: "SUBMITTED", itemsSubtotal: subtotal, taxAmount: input.taxAmount, freightAmount: input.freightAmount, discountAmount: input.discountAmount, totalAmount: total, validityUntil: input.validityUntil ?? null, deliveryTermDays: input.deliveryTermDays ?? null, paymentTerms: input.paymentTerms ?? null, warrantyTerms: input.warrantyTerms ?? null, inclusions: json(input.inclusions), exclusions: json(input.exclusions), notes: input.notes ?? null, checksum, submittedAt: new Date(), createdById: context.userId, items: { create: input.items.map((item, index) => ({ requisitionItemId: item.requisitionItemId, description: item.description, quantity: item.quantity, unit: item.unit, unitPrice: item.unitPrice, taxAmount: item.taxAmount, freightAmount: item.freightAmount, discountAmount: item.discountAmount, totalAmount: itemTotals[index], normalizedTotalAmount: item.comparability === "NOT_COMPARABLE" ? null : itemTotals[index], comparability: item.comparability, inclusions: json(item.inclusions), exclusions: json(item.exclusions), technicalNotes: item.technicalNotes ?? null, sortOrder: index })) } }, include: { items: true, supplier: true } });
    await tx.quotationInvitation.update({ where: { quotationProcessId_supplierId: { quotationProcessId: quotation.id, supplierId: input.supplierId } }, data: { status: "PROPOSAL_RECEIVED", respondedAt: new Date() } });
    await tx.auditLog.create({ data: audit(context, quotation.projectId, "SUPPLIER_PROPOSAL_SUBMITTED", "SupplierProposal", proposal.id, { supplierId: input.supplierId, version: input.version, total: total.toString() }) });
    return proposal;
  });
}

export async function decideQuotation(context: AuthContext, input: { quotationProcessId: string; selectedProposalId: string; technicalOpinion: string; commercialRationale: string; referenceAmount: Prisma.Decimal.Value; scopeComparable: boolean }) {
  assertApprover(context);
  const quotation = await prisma.quotationProcess.findFirst({ where: { id: input.quotationProcessId, organizationId: context.organizationId, status: { in: ["OPEN", "UNDER_ANALYSIS"] } }, include: { proposals: { include: { items: true } }, requisition: { include: { items: true } } } });
  const selected = quotation?.proposals.find((item) => item.id === input.selectedProposalId && item.status === "SUBMITTED");
  if (!quotation || !selected) throw new Error("Proposta submetida não encontrada neste processo.");
  if (selected.items.some((item) => item.comparability === "NOT_COMPARABLE") && input.scopeComparable) throw new Error("A proposta possui item não comparável; registre os ajustes antes de validar economia.");
  const saving = engine.calculateSaving(input.referenceAmount, selected.totalAmount, input.scopeComparable);
  return prisma.$transaction(async (tx) => {
    const decision = await tx.procurementDecision.create({ data: { quotationProcessId: quotation.id, selectedProposalId: selected.id, technicalOpinion: input.technicalOpinion, commercialRationale: input.commercialRationale, decidedById: context.userId, approvedById: context.userId, approvedAt: new Date(), savings: { create: [{ classification: saving.canValidate ? "VALIDATED_SAVING" : "UNCLASSIFIED_DIFFERENCE", referenceType: "OFFICIAL_BUDGET", referenceDescription: "Orçamento Oficial / referência congelada", referenceAmount: saving.referenceAmount, contractedComparableAmount: saving.contractedComparableAmount, nominalAmount: saving.nominalAmount, percentage: saving.percentage, scopeComparable: input.scopeComparable, technicalValidation: input.technicalOpinion, validatedById: saving.canValidate ? context.userId : null, validatedAt: saving.canValidate ? new Date() : null, createdById: context.userId }] } }, include: { savings: true } });
    await tx.quotationProcess.update({ where: { id: quotation.id }, data: { status: "DECIDED", decidedAt: new Date(), updatedById: context.userId } });
    await tx.supplierProposal.updateMany({ where: { quotationProcessId: quotation.id, status: "SUBMITTED" }, data: { status: "REJECTED" } });
    await tx.supplierProposal.update({ where: { id: selected.id }, data: { status: "SELECTED" } });
    await tx.purchaseRequisition.update({ where: { id: quotation.requisitionId }, data: { status: "FULFILLED", updatedById: context.userId } });
    await tx.auditLog.create({ data: audit(context, quotation.projectId, "PROCUREMENT_DECISION_APPROVED", "ProcurementDecision", decision.id, { selectedProposalId: selected.id, saving: saving.nominalAmount.toString(), validated: saving.canValidate }) });
    return decision;
  });
}

export async function createPurchaseOrder(context: AuthContext, raw: CreatePurchaseOrderInput) {
  assertMutable(context);
  const input = createPurchaseOrderSchema.parse(raw);
  await validateProjectReferences(context.organizationId, input.projectId, { companyId: input.companyId });
  await supplierForTenant(context.organizationId, input.supplierId);
  for (const item of input.items) await validateProjectReferences(context.organizationId, input.projectId, item);
  const amounts = input.items.map((item) => decimal(item.quantity).mul(item.unitPrice).toDecimalPlaces(2));
  const originalAmount = amounts.reduce((sum, value) => sum.add(value), new Prisma.Decimal(0));
  const order = await prisma.purchaseOrder.create({ data: { organizationId: context.organizationId, companyId: input.companyId, projectId: input.projectId, supplierId: input.supplierId, quotationProcessId: input.quotationProcessId ?? null, selectedProposalId: input.selectedProposalId ?? null, number: input.number, title: input.title, scope: input.scope, originalAmount, deliveryAt: input.deliveryAt ?? null, paymentTerms: input.paymentTerms ?? null, createdById: context.userId, updatedById: context.userId, items: { create: input.items.map((item, index) => ({ economicItemId: item.economicItemId ?? null, budgetLineItemId: item.budgetLineItemId ?? null, costCenterId: item.costCenterId ?? null, operatingUnitId: item.operatingUnitId ?? null, scheduleActivityId: item.scheduleActivityId ?? null, description: item.description, quantity: item.quantity, unit: item.unit, unitPrice: item.unitPrice, totalAmount: amounts[index], sortOrder: index })) } }, include: { items: true, supplier: true } });
  await prisma.auditLog.create({ data: audit(context, input.projectId, "PURCHASE_ORDER_CREATED", "PurchaseOrder", order.id, { number: order.number, originalAmount: originalAmount.toString() }) });
  return order;
}

export async function approvePurchaseOrder(context: AuthContext, orderId: string) {
  assertApprover(context);
  const order = await prisma.purchaseOrder.findFirst({ where: { id: orderId, organizationId: context.organizationId, status: { in: ["DRAFT", "IN_APPROVAL"] } } });
  if (!order) throw new Error("Pedido não encontrado ou indisponível para aprovação.");
  const updated = await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: "APPROVED", approvedById: context.userId, approvedAt: new Date(), updatedById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, order.projectId, "PURCHASE_ORDER_APPROVED", "PurchaseOrder", order.id, { amount: order.originalAmount.toString() }) });
  return updated;
}

export async function createOperationalContract(context: AuthContext, raw: CreateContractInput) {
  assertMutable(context);
  const input = createContractSchema.parse(raw);
  await validateProjectReferences(context.organizationId, input.projectId, { companyId: input.companyId });
  await supplierForTenant(context.organizationId, input.supplierId);
  if (input.endsAt < input.startsAt) throw new Error("A vigência final deve ser posterior à inicial.");
  for (const item of input.items) await validateProjectReferences(context.organizationId, input.projectId, item);
  if (input.quotationProcessId) {
    const process = await prisma.quotationProcess.findFirst({ where: { id: input.quotationProcessId, organizationId: context.organizationId, projectId: input.projectId, status: "DECIDED" } });
    if (!process) throw new Error("Processo de compra decidido não encontrado.");
  }
  const itemAmounts = input.items.map((item) => decimal(item.quantity).mul(item.unitPrice).toDecimalPlaces(2));
  const originalAmount = itemAmounts.reduce((sum, value) => sum.add(value), new Prisma.Decimal(0));
  const contract = await prisma.operationalContract.create({ data: {
    organizationId: context.organizationId, companyId: input.companyId, projectId: input.projectId, supplierId: input.supplierId, quotationProcessId: input.quotationProcessId ?? null, selectedProposalId: input.selectedProposalId ?? null,
    number: input.number, title: input.title, type: input.type, billingModel: input.billingModel, scope: input.scope, originalAmount, startsAt: input.startsAt, endsAt: input.endsAt, responsibleId: input.responsibleId,
    paymentTerms: input.paymentTerms ?? null, readjustmentRuleId: input.readjustmentRuleId ?? null, retentionRate: input.retentionRate, warrantyTerms: input.warrantyTerms ?? null, createdById: context.userId, updatedById: context.userId,
    items: { create: input.items.map((item, index) => ({ economicItemId: item.economicItemId ?? null, budgetLineItemId: item.budgetLineItemId ?? null, costCenterId: item.costCenterId ?? null, operatingUnitId: item.operatingUnitId ?? null, scheduleActivityId: item.scheduleActivityId ?? null, code: item.code, description: item.description, quantity: item.quantity, unit: item.unit, unitPrice: item.unitPrice, originalAmount: itemAmounts[index], sortOrder: index })) },
  }, include: { items: true, supplier: true } });
  await prisma.auditLog.create({ data: audit(context, input.projectId, "OPERATIONAL_CONTRACT_CREATED", "OperationalContract", contract.id, { number: contract.number, originalAmount: originalAmount.toString() }) });
  return contract;
}

export async function transitionOperationalContract(context: AuthContext, contractId: string, to: "UNDER_REVIEW" | "IN_APPROVAL" | "APPROVED" | "ACTIVE" | "SUSPENDED" | "CLOSED" | "CANCELLED" | "TERMINATED" | "DRAFT", reason?: string) {
  assertMutable(context);
  const contract = await prisma.operationalContract.findFirst({ where: { id: contractId, organizationId: context.organizationId } });
  if (!contract) throw new Error("Contrato não encontrado nesta organização.");
  engine.assertTransition("contract", contract.status, to);
  if (to === "APPROVED") assertApprover(context);
  if (["CANCELLED", "TERMINATED"].includes(to) && !reason?.trim()) throw new Error("Informe o motivo do cancelamento/rescisão.");
  const updated = await prisma.operationalContract.update({ where: { id: contract.id }, data: { status: to, approvedById: to === "APPROVED" ? context.userId : contract.approvedById, approvedAt: to === "APPROVED" ? new Date() : contract.approvedAt, activatedAt: to === "ACTIVE" ? new Date() : contract.activatedAt, cancelledAt: ["CANCELLED", "TERMINATED"].includes(to) ? new Date() : null, cancellationReason: ["CANCELLED", "TERMINATED"].includes(to) ? reason : null, updatedById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, contract.projectId, "OPERATIONAL_CONTRACT_TRANSITIONED", "OperationalContract", contract.id, { from: contract.status, to, reason }) });
  return updated;
}

export async function createContractAmendment(context: AuthContext, raw: CreateAmendmentInput) {
  assertMutable(context);
  const input = createAmendmentSchema.parse(raw);
  const contract = await prisma.operationalContract.findFirst({ where: { id: input.contractId, organizationId: context.organizationId, status: { in: ["APPROVED", "ACTIVE", "SUSPENDED"] } } });
  if (!contract) throw new Error("Contrato vigente não encontrado nesta organização.");
  if (["INCREASE", "SUPPRESSION", "READJUSTMENT"].includes(input.type) && Number(input.value) <= 0) throw new Error("Aditivo financeiro deve possuir valor maior que zero.");
  const amendment = await prisma.contractAmendment.create({ data: { contractId: contract.id, number: input.number, type: input.type, reason: input.reason, deviationCause: input.deviationCause, scopeDescription: input.scopeDescription ?? null, value: input.value, termDays: input.termDays, effectiveAt: input.effectiveAt ?? null, createdById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, contract.projectId, "CONTRACT_AMENDMENT_CREATED", "ContractAmendment", amendment.id, { type: amendment.type, value: amendment.value.toString() }) });
  return amendment;
}

export async function approveContractAmendment(context: AuthContext, amendmentId: string) {
  assertApprover(context);
  const amendment = await prisma.contractAmendment.findFirst({ where: { id: amendmentId, contract: { organizationId: context.organizationId } }, include: { contract: { include: { amendments: true } } } });
  if (!amendment || amendment.status === "APPROVED") throw new Error("Aditivo não encontrado ou já aprovado.");
  if (amendment.type === "SUPPRESSION") {
    const projected = engine.currentContractValue(amendment.contract.originalAmount, [...amendment.contract.amendments.filter((item) => item.id !== amendment.id), { type: amendment.type, status: "APPROVED", value: amendment.value }]);
    if (projected.isNegative()) throw new Error("A supressão não pode tornar o valor atual do contrato negativo.");
  }
  const updated = await prisma.contractAmendment.update({ where: { id: amendment.id }, data: { status: "APPROVED", approvedById: context.userId, approvedAt: new Date() } });
  await prisma.auditLog.create({ data: audit(context, amendment.contract.projectId, "CONTRACT_AMENDMENT_APPROVED", "ContractAmendment", amendment.id, { type: updated.type, value: updated.value.toString() }) });
  return updated;
}

export async function createMeasurement(context: AuthContext, raw: CreateMeasurementInput) {
  assertMutable(context);
  const input = createMeasurementSchema.parse(raw);
  const contract = await prisma.operationalContract.findFirst({ where: { id: input.contractId, organizationId: context.organizationId, status: { in: ["APPROVED", "ACTIVE"] } }, include: { items: true, amendments: true, measurements: { where: { status: { in: ["APPROVED", "SENT_TO_FINANCE"] } }, include: { lines: true } } } });
  if (!contract) throw new Error("Contrato aprovado/ativo não encontrado nesta organização.");
  if (input.periodEnd < input.periodStart) throw new Error("O fim do período deve ser posterior ao início.");
  const itemMap = new Map(contract.items.map((item) => [item.id, item]));
  const previousByItem = new Map<string, Prisma.Decimal>();
  let previouslyMeasured = new Prisma.Decimal(0);
  for (const measurement of contract.measurements) {
    previouslyMeasured = previouslyMeasured.add(measurement.grossAmount);
    for (const line of measurement.lines) previousByItem.set(line.contractItemId, (previousByItem.get(line.contractItemId) ?? new Prisma.Decimal(0)).add(line.periodQuantity));
  }
  const lineInputs = input.lines.map((line) => {
    const item = itemMap.get(line.contractItemId);
    if (!item) throw new Error("Item de medição não pertence ao contrato.");
    return { item, contractedQuantity: item.quantity, previousQuantity: previousByItem.get(item.id) ?? new Prisma.Decimal(0), periodQuantity: line.periodQuantity, unitPrice: item.unitPrice };
  });
  const currentAmount = engine.currentContractValue(contract.originalAmount, contract.amendments);
  const proof = engine.validateMeasurement({ contractCurrentAmount: currentAmount, previouslyMeasuredAmount: previouslyMeasured, lines: lineInputs, retentionAmount: input.retentionAmount, discountAmount: input.discountAmount, advanceAmortizationAmount: input.advanceAmortizationAmount });
  const measurement = await prisma.measurementCertificate.create({ data: {
    organizationId: context.organizationId, projectId: contract.projectId, contractId: contract.id, number: input.number, version: input.version, competenceDate: input.competenceDate, periodStart: input.periodStart, periodEnd: input.periodEnd, issuedAt: input.issuedAt, dueDate: input.dueDate,
    responsibleId: context.userId, grossAmount: proof.grossAmount, retentionAmount: input.retentionAmount, discountAmount: input.discountAmount, advanceAmortizationAmount: input.advanceAmortizationAmount, netAmount: proof.netAmount, physicalProgress: input.physicalProgress ?? null, createdById: context.userId, updatedById: context.userId,
    lines: { create: lineInputs.map((line, index) => ({ contractItemId: line.item.id, economicItemId: line.item.economicItemId, budgetLineItemId: line.item.budgetLineItemId, scheduleActivityId: line.item.scheduleActivityId, description: line.item.description, unit: line.item.unit, contractedQuantity: line.item.quantity, previousQuantity: line.previousQuantity, periodQuantity: line.periodQuantity, cumulativeQuantity: proof.lines[index].cumulativeQuantity, remainingQuantity: proof.lines[index].remainingQuantity, unitPrice: line.item.unitPrice, amount: proof.lines[index].amount, sortOrder: index })) },
    adjustments: { create: [
      ...(Number(input.retentionAmount) > 0 ? [{ type: "CONTRACT_RETENTION" as const, description: "Retenção contratual", baseAmount: proof.grossAmount, amount: decimal(input.retentionAmount), createdById: context.userId }] : []),
      ...(Number(input.discountAmount) > 0 ? [{ type: "DISCOUNT" as const, description: "Desconto/glosa aprovada", baseAmount: proof.grossAmount, amount: decimal(input.discountAmount), createdById: context.userId }] : []),
    ] },
  }, include: { lines: true, adjustments: true } });
  await prisma.auditLog.create({ data: audit(context, contract.projectId, "MEASUREMENT_CREATED", "MeasurementCertificate", measurement.id, { number: measurement.number, grossAmount: measurement.grossAmount.toString(), netAmount: measurement.netAmount.toString() }) });
  return measurement;
}

export async function transitionMeasurement(context: AuthContext, measurementId: string, to: "SUBMITTED" | "IN_TECHNICAL_REVIEW" | "TECHNICALLY_APPROVED" | "IN_APPROVAL" | "RETURNED" | "DRAFT" | "CANCELLED", reason?: string) {
  assertMutable(context);
  const measurement = await prisma.measurementCertificate.findFirst({ where: { id: measurementId, organizationId: context.organizationId } });
  if (!measurement) throw new Error("Medição não encontrada nesta organização.");
  engine.assertTransition("measurement", measurement.status, to);
  if (to === "TECHNICALLY_APPROVED" && !context.userId) throw new Error("Responsável técnico inválido.");
  if (["RETURNED", "CANCELLED"].includes(to) && !reason?.trim()) throw new Error("Informe o motivo desta decisão.");
  const updated = await prisma.measurementCertificate.update({ where: { id: measurement.id }, data: { status: to, technicalApprovedById: to === "TECHNICALLY_APPROVED" ? context.userId : measurement.technicalApprovedById, technicalApprovedAt: to === "TECHNICALLY_APPROVED" ? new Date() : measurement.technicalApprovedAt, updatedById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, measurement.projectId, "MEASUREMENT_TRANSITIONED", "MeasurementCertificate", measurement.id, { from: measurement.status, to, reason }) });
  return updated;
}

function financialEventIdentity(measurement: { organizationId: string; id: string; version: number; netAmount: Prisma.Decimal; dueDate: Date }) {
  const sourceType = "MEASUREMENT";
  const eventType = "MEASUREMENT_APPROVED" as const;
  const idempotencyKey = createHash("sha256").update(`${measurement.organizationId}:${sourceType}:${measurement.id}:${measurement.version}:${eventType}`).digest("hex");
  const payloadChecksum = createHash("sha256").update(JSON.stringify({ sourceType, sourceId: measurement.id, sourceVersion: measurement.version, netAmount: measurement.netAmount.toString(), dueDate: measurement.dueDate.toISOString() })).digest("hex");
  return { sourceType, eventType, idempotencyKey, eventId: idempotencyKey, payloadChecksum };
}

export async function approveMeasurementAndGenerateObligation(context: AuthContext, measurementId: string) {
  assertApprover(context);
  const measurement = await prisma.measurementCertificate.findFirst({ where: { id: measurementId, organizationId: context.organizationId }, include: { contract: true, lines: true, financialEvents: true } });
  if (!measurement) throw new Error("Medição não encontrada nesta organização.");
  const identity = financialEventIdentity(measurement);
  const replay = measurement.financialEvents.find((event) => event.idempotencyKey === identity.idempotencyKey && event.status === "PROCESSED");
  if (replay) return replay;
  if (measurement.status !== "IN_APPROVAL") throw new Error("Somente medição em aprovação pode gerar obrigação financeira.");
  const principalLine = measurement.lines[0];
  if (!principalLine) throw new Error("A medição deve possuir ao menos uma linha.");
  const payload = { schemaVersion: 1, organizationId: measurement.organizationId, companyId: measurement.contract.companyId, projectId: measurement.projectId, economicItemId: principalLine.economicItemId, budgetLineItemId: principalLine.budgetLineItemId, scheduleActivityId: principalLine.scheduleActivityId, competenceDate: measurement.competenceDate.toISOString(), dueDate: measurement.dueDate.toISOString(), grossAmount: measurement.grossAmount.toString(), withholdings: measurement.retentionAmount.toString(), discounts: measurement.discountAmount.toString(), advancesApplied: measurement.advanceAmortizationAmount.toString(), netAmount: measurement.netAmount.toString(), counterpartyId: measurement.contract.supplierId };
  return prisma.$transaction(async (tx) => {
    const event = await tx.financialIntegrationEvent.create({ data: { organizationId: measurement.organizationId, projectId: measurement.projectId, measurementId: measurement.id, eventType: identity.eventType, sourceType: identity.sourceType, sourceId: measurement.id, sourceVersion: measurement.version, schemaVersion: 1, eventId: identity.eventId, idempotencyKey: identity.idempotencyKey, payloadChecksum: identity.payloadChecksum, payload: json(payload), status: "PROCESSING", attemptCount: 1 } });
    const result = await createExternalPayableObligation(tx, { organizationId: measurement.organizationId, companyId: measurement.contract.companyId, projectId: measurement.projectId, supplierId: measurement.contract.supplierId, costCenterId: principalLine.contractItemId ? (await tx.operationalContractItem.findUnique({ where: { id: principalLine.contractItemId } }))?.costCenterId : null, economicItemId: principalLine.economicItemId, budgetLineItemId: principalLine.budgetLineItemId, scheduleActivityId: principalLine.scheduleActivityId, sourceType: identity.sourceType, sourceId: measurement.id, sourceVersion: measurement.version, competenceDate: measurement.competenceDate, dueDate: measurement.dueDate, grossAmount: measurement.grossAmount, withholdings: measurement.retentionAmount, discounts: measurement.discountAmount, advancesApplied: measurement.advanceAmortizationAmount, netAmount: measurement.netAmount, currency: measurement.contract.currency, description: `Medição ${measurement.number} — ${measurement.contract.title}`, responsibleId: measurement.responsibleId, createdById: context.userId });
    const processed = await tx.financialIntegrationEvent.update({ where: { id: event.id }, data: { status: "PROCESSED", financialObligationId: result.obligationId, payableAccountId: result.payableAccountId, processedAt: new Date() } });
    await tx.measurementCertificate.update({ where: { id: measurement.id }, data: { status: "SENT_TO_FINANCE", approvedById: context.userId, approvedAt: new Date(), updatedById: context.userId } });
    await tx.auditLog.create({ data: audit(context, measurement.projectId, "MEASUREMENT_APPROVED_AND_SENT_TO_FINANCE", "MeasurementCertificate", measurement.id, { financialObligationId: result.obligationId, idempotencyKey: identity.idempotencyKey }) });
    return processed;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reverseMeasurement(context: AuthContext, measurementId: string, reason: string) {
  assertApprover(context);
  if (!reason.trim()) throw new Error("Informe o motivo da reversão.");
  const measurement = await prisma.measurementCertificate.findFirst({ where: { id: measurementId, organizationId: context.organizationId, status: { in: ["APPROVED", "SENT_TO_FINANCE"] } }, include: { financialEvents: { where: { status: "PROCESSED", eventType: "MEASUREMENT_APPROVED" } } } });
  if (!measurement) throw new Error("Medição aprovada não encontrada nesta organização.");
  return prisma.$transaction(async (tx) => {
    const sourceEvent = measurement.financialEvents[0];
    if (sourceEvent?.financialObligationId) await reverseExternalPayableObligation(tx, { organizationId: context.organizationId, obligationId: sourceEvent.financialObligationId, reason });
    if (sourceEvent) await tx.financialIntegrationEvent.update({ where: { id: sourceEvent.id }, data: { status: "REVERSED" } });
    const reversed = await tx.measurementCertificate.update({ where: { id: measurement.id }, data: { status: "REVERSED", reversedAt: new Date(), reversalReason: reason, updatedById: context.userId } });
    await tx.auditLog.create({ data: audit(context, measurement.projectId, "MEASUREMENT_REVERSED", "MeasurementCertificate", measurement.id, { reason, financialEventId: sourceEvent?.id }) });
    return reversed;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function getProcurementWorkspace(context: Pick<AuthContext, "organizationId">, projectId: string, referenceDate: Date = new Date()) {
  await projectForTenant(context.organizationId, projectId);
  const [budget, needs, requisitions, quotations, suppliers, orders, contracts, measurements] = await Promise.all([
    prisma.budget.findFirst({ where: { organizationId: context.organizationId, projectId, status: "OFFICIAL" }, orderBy: { version: "desc" }, include: { lineItems: true } }),
    prisma.procurementNeed.findMany({ where: { organizationId: context.organizationId, projectId }, orderBy: [{ requiredAt: "asc" }, { createdAt: "desc" }], take: 100 }),
    prisma.purchaseRequisition.findMany({ where: { organizationId: context.organizationId, projectId }, include: { items: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.quotationProcess.findMany({ where: { organizationId: context.organizationId, projectId }, include: { invitations: true, proposals: { include: { supplier: true, items: true } }, decision: { include: { savings: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.supplier.findMany({ where: { organizationId: context.organizationId }, include: { qualifications: true, contracts: { where: { projectId, status: { in: ["APPROVED", "ACTIVE"] } } } }, orderBy: { name: "asc" }, take: 100 }),
    prisma.purchaseOrder.findMany({ where: { organizationId: context.organizationId, projectId }, include: { supplier: true, items: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.operationalContract.findMany({ where: { organizationId: context.organizationId, projectId }, include: { supplier: true, items: true, amendments: true, measurements: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.measurementCertificate.findMany({ where: { organizationId: context.organizationId, projectId }, include: { contract: { include: { supplier: true } }, financialEvents: { include: { payableAccount: { include: { installments: { include: { payments: true } } } } } } }, orderBy: [{ competenceDate: "desc" }, { number: "desc" }], take: 100 }),
  ]);
  const budgetAmount = budget?.lineItems.reduce((sum, item) => sum.add(item.totalCost), new Prisma.Decimal(0)) ?? new Prisma.Decimal(0);
  const approvedOrders = orders.filter((item) => ["APPROVED", "ISSUED", "PARTIALLY_DELIVERED", "DELIVERED"].includes(item.status)).reduce((sum, item) => sum.add(item.originalAmount), new Prisma.Decimal(0));
  const contractRows = contracts.map((contract) => ({ contract, currentAmount: engine.currentContractValue(contract.originalAmount, contract.amendments), measured: contract.measurements.filter((item) => ["APPROVED", "SENT_TO_FINANCE"].includes(item.status)).reduce((sum, item) => sum.add(item.grossAmount), new Prisma.Decimal(0)) }));
  const contractedAmount = contractRows.filter(({ contract }) => ["APPROVED", "ACTIVE", "SUSPENDED", "CLOSED"].includes(contract.status)).reduce((sum, row) => sum.add(row.currentAmount), approvedOrders);
  const measuredAmount = contractRows.reduce((sum, row) => sum.add(row.measured), new Prisma.Decimal(0));
  let obligatedAmount = new Prisma.Decimal(0);
  let paidAmount = new Prisma.Decimal(0);
  for (const measurement of measurements) for (const event of measurement.financialEvents) {
    if (event.status === "PROCESSED" && event.payableAccount) {
      obligatedAmount = obligatedAmount.add(event.payableAccount.originalAmount);
      for (const installment of event.payableAccount.installments) for (const payment of installment.payments) if (["PROCESSED", "CLEARED"].includes(payment.status)) paidAmount = paidAmount.add(payment.amount);
    }
  }
  const ledger = engine.stageLedger({ budget: budgetAmount, contracted: contractedAmount, measured: measuredAmount, obligated: obligatedAmount, paid: paidAmount });
  const criticalNeeds = needs.filter((need) => engine.isCriticalPurchase({ requiredAt: need.requiredAt, expectedLeadDays: need.expectedLeadDays, bufferDays: need.bufferDays, referenceDate, contracted: false }) && !["DISCARDED"].includes(need.status));
  const validatedSaving = quotations.flatMap((quotation) => quotation.decision?.savings ?? []).filter((item) => item.classification === "VALIDATED_SAVING").reduce((sum, item) => sum.add(item.nominalAmount), new Prisma.Decimal(0));
  return {
    projectId, generatedAt: referenceDate.toISOString(),
    summary: { budget: Number(ledger.budget), contracted: Number(ledger.contracted), balanceToContract: Number(ledger.balanceToContract), measured: Number(ledger.measured), obligated: Number(ledger.obligated), paid: Number(ledger.paid), updatedProjection: Number(ledger.updatedProjection), amendments: contracts.flatMap((item) => item.amendments).filter((item) => item.status === "APPROVED").reduce((sum, item) => sum + Number(item.value), 0), validatedSaving: Number(validatedSaving), openProcesses: quotations.filter((item) => ["PREPARING", "OPEN", "UNDER_ANALYSIS"].includes(item.status)).length, criticalPurchases: criticalNeeds.length, pendingMeasurements: measurements.filter((item) => ["SUBMITTED", "IN_TECHNICAL_REVIEW", "TECHNICALLY_APPROVED", "IN_APPROVAL"].includes(item.status)).length },
    suppliers: suppliers.map((item) => ({ id: item.id, name: item.name, legalName: item.legalName, taxId: item.taxId, status: item.status, qualifications: item.qualifications.map((q) => ({ category: q.category, status: q.status, validUntil: q.validUntil?.toISOString() ?? null })), activeContractValue: item.contracts.reduce((sum, contract) => sum + Number(contract.originalAmount), 0) })),
    needs: needs.map((item) => ({ id: item.id, code: item.code, description: item.description, quantity: Number(item.quantity), unit: item.unit, requiredAt: item.requiredAt.toISOString(), contractingDeadline: engine.requiredContractingDate(item.requiredAt, item.expectedLeadDays, item.bufferDays).toISOString(), priority: item.priority, origin: item.origin, status: item.status, critical: criticalNeeds.some((critical) => critical.id === item.id) })),
    requisitions: requisitions.map((item) => ({ id: item.id, number: item.number, title: item.title, status: item.status, itemCount: item.items.length, createdAt: item.createdAt.toISOString() })),
    quotations: quotations.map((item) => ({ id: item.id, number: item.number, title: item.title, status: item.status, invitedCount: item.invitations.length, proposals: item.proposals.map((proposal) => ({ id: proposal.id, supplier: proposal.supplier.name, total: Number(proposal.totalAmount), status: proposal.status, comparable: proposal.items.every((line) => line.comparability !== "NOT_COMPARABLE") })), selectedProposalId: item.decision?.selectedProposalId ?? null })),
    orders: orders.map((item) => ({ id: item.id, number: item.number, title: item.title, supplier: item.supplier.name, amount: Number(item.originalAmount), status: item.status })),
    contracts: contractRows.map(({ contract, currentAmount, measured }) => ({ id: contract.id, number: contract.number, title: contract.title, supplier: contract.supplier.name, type: contract.type, billingModel: contract.billingModel, status: contract.status, originalAmount: Number(contract.originalAmount), currentAmount: Number(currentAmount), measured: Number(measured), balance: Number(currentAmount.sub(measured)), amendments: contract.amendments.map((item) => ({ id: item.id, number: item.number, type: item.type, value: Number(item.value), status: item.status, cause: item.deviationCause })), endsAt: contract.endsAt.toISOString() })),
    measurements: measurements.map((item) => ({ id: item.id, number: item.number, contract: item.contract.title, supplier: item.contract.supplier.name, competenceDate: item.competenceDate.toISOString(), grossAmount: Number(item.grossAmount), retentionAmount: Number(item.retentionAmount), netAmount: Number(item.netAmount), status: item.status, obligationId: item.financialEvents.find((event) => event.status === "PROCESSED")?.financialObligationId ?? null })),
  };
}

export type ProcurementWorkspaceView = Awaited<ReturnType<typeof getProcurementWorkspace>>;
