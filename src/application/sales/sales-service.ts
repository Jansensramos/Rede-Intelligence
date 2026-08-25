import { createHash } from "node:crypto";
import { Prisma, type MembershipRole } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { createExternalPayableObligation, createExternalReceivableObligation } from "@/application/financial-ops/external-obligation-port";
import { transitionReceivableInstallment } from "@/application/financial-ops/financial-service";
import * as engine from "@/domain/sales/engine";
import type { SalesUnitStatus } from "@/domain/sales/engine";
import {
  addPostSaleUpdateSchema, approveSaleSchema, convertSalesLeadSchema, createBrokerProfileSchema, createPostSaleRequestSchema,
  createSalesCommissionPolicySchema, createSalesCommissionSchema, createSalesLeadSchema, createSalesPriceTableSchema, createSalesProposalSchema,
  createSalesReservationSchema, createSalesUnitBlockSchema, createSalesUnitSchema, createSaleSchema, recordInspectionOutcomeSchema,
  renegotiatePaymentPlanSchema, rescindSaleSchema, scheduleInspectionSchema, transitionPostSaleRequestSchema,
  type AddPostSaleUpdateInput, type ApproveSaleInput, type ConvertSalesLeadInput, type CreateBrokerProfileInput, type CreatePostSaleRequestInput,
  type CreateSalesCommissionInput, type CreateSalesCommissionPolicyInput, type CreateSalesLeadInput, type CreateSalesPriceTableInput,
  type CreateSalesProposalInput, type CreateSalesReservationInput, type CreateSalesUnitBlockInput, type CreateSalesUnitInput, type CreateSaleInput,
  type RecordInspectionOutcomeInput, type RenegotiatePaymentPlanInput, type RescindSaleInput, type ScheduleInspectionInput,
  type TransitionPostSaleRequestInput,
} from "@/domain/sales/schemas";

const mutableRoles = new Set(["OWNER", "ADMIN", "ANALYST"]);
const approvalRoles = new Set(["OWNER", "ADMIN"]);
const roleRank: Record<MembershipRole, number> = { VIEWER: 0, REVIEWER: 1, ANALYST: 2, ADMIN: 3, OWNER: 4 };
const json = (value: unknown) => value as Prisma.InputJsonValue;
/** Contexto mínimo suficiente para as operações de leitura+liberação do workspace comercial (REDE IA não carrega o `AuthContext` completo). */
type MutationContext = Pick<AuthContext, "organizationId" | "userId" | "role">;

function assertMutable(context: Pick<AuthContext, "role">) {
  if (!mutableRoles.has(context.role)) throw new Error("Seu perfil não pode alterar dados comerciais.");
}
function assertApprover(context: Pick<AuthContext, "role">) {
  if (!approvalRoles.has(context.role)) throw new Error("Somente Administrador ou Owner pode aprovar este ato comercial.");
}

const audit = (context: MutationContext, projectId: string | null, action: string, entityType: string, entityId: string, after?: unknown) => ({
  organizationId: context.organizationId, userId: context.userId, projectId, action, entityType, entityId, after: after === undefined ? undefined : json(after),
});

async function projectForTenant(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  return project;
}
async function customerForTenant(organizationId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, organizationId } });
  if (!customer) throw new Error("Cliente não encontrado nesta organização.");
  return customer;
}
async function salesUnitForTenant(organizationId: string, salesUnitId: string) {
  const unit = await prisma.salesUnit.findFirst({ where: { id: salesUnitId, organizationId } });
  if (!unit) throw new Error("Unidade comercial não encontrada nesta organização.");
  return unit;
}
async function priceTableForTenant(organizationId: string, priceTableId: string) {
  const table = await prisma.salesPriceTable.findFirst({ where: { id: priceTableId, organizationId } });
  if (!table) throw new Error("Tabela de preços não encontrada nesta organização.");
  return table;
}

/** Reutiliza `ApprovalPolicy`/`ApprovalRequest`/`ApprovalDecisionRecord` (9C) — nenhuma alçada comercial nova é criada. */
async function findApplicablePolicy(organizationId: string, actType: "SALE" | "SALE_DISCOUNT" | "SALE_RESCISSION" | "COMMISSION", companyId: string | null, projectId: string | null, amount: Prisma.Decimal) {
  const policies = await prisma.approvalPolicy.findMany({ where: { organizationId, actType, isActive: true, OR: [{ projectId }, { projectId: null }] } });
  const inRange = policies.filter((policy) => amount.greaterThanOrEqualTo(policy.minimumAmount) && (policy.maximumAmount === null || amount.lessThanOrEqualTo(policy.maximumAmount)));
  return inRange.sort((a, b) => (b.projectId ? 1 : 0) - (a.projectId ? 1 : 0))[0] ?? null;
}

async function recordApproval(tx: Prisma.TransactionClient, context: AuthContext, input: { actType: "SALE" | "SALE_DISCOUNT" | "SALE_RESCISSION" | "COMMISSION"; entityType: string; entityId: string; entityVersion: number; companyId: string | null; projectId: string | null; amount: Prisma.Decimal; category?: string | null; snapshot: unknown }) {
  const policy = await findApplicablePolicy(context.organizationId, input.actType, input.companyId, input.projectId, input.amount);
  const requiredRole = (policy?.requiredRole ?? "ADMIN") as MembershipRole;
  if (roleRank[context.role] < roleRank[requiredRole]) throw new Error(`Alçada insuficiente para ${input.actType}: requer papel ${requiredRole} ou superior.`);
  const request = await tx.approvalRequest.create({ data: { organizationId: context.organizationId, policyId: policy?.id ?? null, actType: input.actType, entityType: input.entityType, entityId: input.entityId, entityVersion: input.entityVersion, companyId: input.companyId, projectId: input.projectId, amount: input.amount, category: input.category ?? null, snapshot: json(input.snapshot), status: "APPROVED", requestedById: context.userId, completedAt: new Date(), decisions: { create: [{ decision: "APPROVE", decidedById: context.userId }] } } });
  return request;
}

// ---------------------------------------------------------------------------
// E/F/G — Unidades, status e bloqueios
// ---------------------------------------------------------------------------

export async function createSalesUnit(context: AuthContext, raw: CreateSalesUnitInput) {
  assertMutable(context);
  const input = createSalesUnitSchema.parse(raw);
  await projectForTenant(context.organizationId, input.projectId);
  if (input.detectedUnitId && !(await prisma.detectedUnit.findUnique({ where: { id: input.detectedUnitId } }))) throw new Error("Unidade detectada (BIM/Design) não encontrada.");
  const unit = await prisma.salesUnit.create({ data: { organizationId: context.organizationId, projectId: input.projectId, companyId: input.companyId, operatingUnitId: input.operatingUnitId ?? null, detectedUnitId: input.detectedUnitId ?? null, code: input.code, floor: input.floor ?? null, typology: input.typology, privateAreaM2: input.privateAreaM2, totalAreaM2: input.totalAreaM2 ?? null, parkingSpaces: input.parkingSpaces, storageUnits: input.storageUnits, position: input.position ?? null, characteristics: input.characteristics ? json(input.characteristics) : undefined, createdById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, input.projectId, "SALES_UNIT_CREATED", "SalesUnit", unit.id, { code: unit.code }) });
  return unit;
}

export async function blockSalesUnit(context: AuthContext, raw: CreateSalesUnitBlockInput) {
  assertMutable(context);
  const input = createSalesUnitBlockSchema.parse(raw);
  const unit = await salesUnitForTenant(context.organizationId, input.salesUnitId);
  if (!["DISPONIVEL", "EM_RESERVA", "EM_PROPOSTA"].includes(unit.status)) throw new Error("Somente unidades disponíveis, em reserva ou em proposta podem ser bloqueadas.");
  engine.assertUnitTransition(unit.status as SalesUnitStatus, "BLOQUEADA");
  return prisma.$transaction(async (tx) => {
    const result = await tx.salesUnit.updateMany({ where: { id: unit.id, status: unit.status }, data: { status: "BLOQUEADA" } });
    if (result.count === 0) throw new Error("A unidade não está mais no estado esperado — outra operação a alterou primeiro.");
    const block = await tx.salesUnitBlock.create({ data: { salesUnitId: unit.id, origin: input.origin, responsibleId: input.responsibleId, reason: input.reason, createdById: context.userId } });
    await tx.auditLog.create({ data: audit(context, unit.projectId, "SALES_UNIT_BLOCKED", "SalesUnitBlock", block.id, { origin: input.origin, reason: input.reason }) });
    return block;
  });
}

export async function unblockSalesUnit(context: AuthContext, blockId: string) {
  assertMutable(context);
  const block = await prisma.salesUnitBlock.findFirst({ where: { id: blockId, endedAt: null, salesUnit: { organizationId: context.organizationId } }, include: { salesUnit: true } });
  if (!block) throw new Error("Bloqueio ativo não encontrado nesta organização.");
  return prisma.$transaction(async (tx) => {
    await tx.salesUnitBlock.update({ where: { id: block.id }, data: { endedAt: new Date() } });
    const result = await tx.salesUnit.updateMany({ where: { id: block.salesUnitId, status: "BLOQUEADA" }, data: { status: "DISPONIVEL" } });
    if (result.count === 0) throw new Error("A unidade não está mais bloqueada — outra operação a alterou primeiro.");
    await tx.auditLog.create({ data: audit(context, block.salesUnit.projectId, "SALES_UNIT_UNBLOCKED", "SalesUnitBlock", block.id, {}) });
    return tx.salesUnit.findUniqueOrThrow({ where: { id: block.salesUnitId } });
  });
}

// ---------------------------------------------------------------------------
// H/I/J — Tabela de preços (versionada, nunca sobrescrita)
// ---------------------------------------------------------------------------

export async function createSalesPriceTable(context: AuthContext, raw: CreateSalesPriceTableInput) {
  assertMutable(context);
  const input = createSalesPriceTableSchema.parse(raw);
  await projectForTenant(context.organizationId, input.projectId);
  const units = await prisma.salesUnit.findMany({ where: { id: { in: input.lines.map((line) => line.salesUnitId) }, organizationId: context.organizationId, projectId: input.projectId } });
  if (units.length !== new Set(input.lines.map((line) => line.salesUnitId)).size) throw new Error("Uma ou mais unidades não pertencem a este empreendimento.");
  const last = await prisma.salesPriceTable.findFirst({ where: { projectId: input.projectId }, orderBy: { version: "desc" } });
  const version = (last?.version ?? 0) + 1;
  const table = await prisma.salesPriceTable.create({ data: { organizationId: context.organizationId, projectId: input.projectId, companyId: input.companyId, version, validFrom: input.validFrom, validUntil: input.validUntil ?? null, responsibleId: input.responsibleId, notes: input.notes ?? null, createdById: context.userId, lines: { create: input.lines.map((line) => ({ salesUnitId: line.salesUnitId, listPrice: line.listPrice, minimumAuthorizedPrice: line.minimumAuthorizedPrice ?? null })) } }, include: { lines: true } });
  await prisma.auditLog.create({ data: audit(context, input.projectId, "SALES_PRICE_TABLE_CREATED", "SalesPriceTable", table.id, { version: table.version, lines: table.lines.length }) });
  return table;
}

export async function activateSalesPriceTable(context: AuthContext, priceTableId: string) {
  assertApprover(context);
  const table = await priceTableForTenant(context.organizationId, priceTableId);
  if (table.status !== "DRAFT") throw new Error("Somente uma tabela em rascunho pode ser ativada.");
  return prisma.$transaction(async (tx) => {
    await tx.salesPriceTable.updateMany({ where: { projectId: table.projectId, status: "ACTIVE" }, data: { status: "SUPERSEDED" } });
    const activated = await tx.salesPriceTable.update({ where: { id: table.id }, data: { status: "ACTIVE" } });
    await tx.auditLog.create({ data: audit(context, table.projectId, "SALES_PRICE_TABLE_ACTIVATED", "SalesPriceTable", table.id, { version: table.version }) });
    return activated;
  });
}

// ---------------------------------------------------------------------------
// L/N/O — Cliente (reuso 9B), Lead mínimo, Corretor (reuso Supplier + satélite)
// ---------------------------------------------------------------------------

export async function createSalesLead(context: AuthContext, raw: CreateSalesLeadInput) {
  assertMutable(context);
  const input = createSalesLeadSchema.parse(raw);
  if (input.projectId) await projectForTenant(context.organizationId, input.projectId);
  const lead = await prisma.salesLead.create({ data: { organizationId: context.organizationId, projectId: input.projectId ?? null, name: input.name, contact: input.contact, source: input.source, channel: input.channel ?? null, brokerId: input.brokerId ?? null, createdById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, input.projectId ?? null, "SALES_LEAD_CREATED", "SalesLead", lead.id, { source: lead.source }) });
  return lead;
}

export async function convertSalesLead(context: AuthContext, raw: ConvertSalesLeadInput) {
  assertMutable(context);
  const input = convertSalesLeadSchema.parse(raw);
  const lead = await prisma.salesLead.findFirst({ where: { id: input.leadId, organizationId: context.organizationId } });
  if (!lead || lead.stage === "CONVERTIDO") throw new Error("Lead não encontrado ou já convertido.");
  await customerForTenant(context.organizationId, input.customerId);
  const updated = await prisma.salesLead.update({ where: { id: lead.id }, data: { stage: "CONVERTIDO", customerId: input.customerId } });
  await prisma.auditLog.create({ data: audit(context, lead.projectId, "SALES_LEAD_CONVERTED", "SalesLead", lead.id, { customerId: input.customerId }) });
  return updated;
}

export async function upsertBrokerProfile(context: AuthContext, raw: CreateBrokerProfileInput) {
  assertMutable(context);
  const input = createBrokerProfileSchema.parse(raw);
  const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, organizationId: context.organizationId } });
  if (!supplier) throw new Error("Fornecedor (corretor/imobiliária) não encontrado nesta organização.");
  const profile = await prisma.brokerProfile.upsert({
    where: { supplierId: input.supplierId },
    update: { creci: input.creci ?? null, parentAgencyId: input.parentAgencyId ?? null, defaultCommissionRate: input.defaultCommissionRate ?? null, channel: input.channel ?? null },
    create: { organizationId: context.organizationId, supplierId: input.supplierId, creci: input.creci ?? null, parentAgencyId: input.parentAgencyId ?? null, defaultCommissionRate: input.defaultCommissionRate ?? null, channel: input.channel ?? null, createdById: context.userId },
  });
  await prisma.auditLog.create({ data: audit(context, null, "BROKER_PROFILE_UPSERTED", "BrokerProfile", profile.id, { supplierId: input.supplierId }) });
  return profile;
}

// ---------------------------------------------------------------------------
// P/Q — Proposta e Reserva (nunca vendem a unidade sozinhas)
// ---------------------------------------------------------------------------

export async function createSalesProposal(context: AuthContext, raw: CreateSalesProposalInput) {
  assertMutable(context);
  const input = createSalesProposalSchema.parse(raw);
  const unit = await salesUnitForTenant(context.organizationId, input.salesUnitId);
  if (!["DISPONIVEL", "RESERVADA", "EM_RESERVA"].includes(unit.status)) throw new Error("Somente unidades disponíveis ou reservadas podem receber proposta.");
  await customerForTenant(context.organizationId, input.customerId);
  const table = await priceTableForTenant(context.organizationId, input.priceTableId);
  if (table.status !== "ACTIVE") throw new Error("A tabela de preços informada não está ativa.");
  const proposal = await prisma.$transaction(async (tx) => {
    if (unit.status === "DISPONIVEL") {
      engine.assertUnitTransition("DISPONIVEL", "EM_PROPOSTA");
      const result = await tx.salesUnit.updateMany({ where: { id: unit.id, status: "DISPONIVEL" }, data: { status: "EM_PROPOSTA" } });
      if (result.count === 0) throw new Error("A unidade não está mais disponível — outra operação a alterou primeiro.");
    }
    const created = await tx.salesProposal.create({ data: { organizationId: context.organizationId, projectId: unit.projectId, salesUnitId: unit.id, customerId: input.customerId, brokerId: input.brokerId ?? null, priceTableId: table.id, proposedPrice: input.proposedPrice, discountAmount: input.discountAmount, paymentConditionSummary: json(input.paymentConditionSummary), validUntil: input.validUntil, status: "SUBMITTED", createdById: context.userId } });
    await tx.auditLog.create({ data: audit(context, unit.projectId, "SALES_PROPOSAL_CREATED", "SalesProposal", created.id, { salesUnitId: unit.id, proposedPrice: created.proposedPrice.toString() }) });
    return created;
  });
  return proposal;
}

export async function createSalesReservation(context: AuthContext, raw: CreateSalesReservationInput) {
  assertMutable(context);
  const input = createSalesReservationSchema.parse(raw);
  const unit = await salesUnitForTenant(context.organizationId, input.salesUnitId);
  await customerForTenant(context.organizationId, input.customerId);
  const allowedFrom: SalesUnitStatus[] = ["DISPONIVEL", "EM_PROPOSTA"];
  if (!allowedFrom.includes(unit.status as SalesUnitStatus)) throw new Error("Somente unidades disponíveis ou em proposta podem ser reservadas.");
  return prisma.$transaction(async (tx) => {
    const result = await tx.salesUnit.updateMany({ where: { id: unit.id, status: { in: allowedFrom } }, data: { status: "EM_RESERVA" } });
    if (result.count === 0) throw new Error("A unidade não está mais disponível para reserva — outra operação a alterou primeiro.");
    const reservation = await tx.salesReservation.create({ data: { organizationId: context.organizationId, projectId: unit.projectId, salesUnitId: unit.id, customerId: input.customerId, proposalId: input.proposalId ?? null, expiresAt: input.expiresAt, responsibleId: input.responsibleId, condition: input.condition ? json(input.condition) : undefined, createdById: context.userId } });
    await tx.auditLog.create({ data: audit(context, unit.projectId, "SALES_RESERVATION_CREATED", "SalesReservation", reservation.id, { salesUnitId: unit.id, expiresAt: reservation.expiresAt.toISOString() }) });
    return reservation;
  });
}

export async function confirmSalesReservation(context: AuthContext, reservationId: string) {
  assertMutable(context);
  const reservation = await prisma.salesReservation.findFirst({ where: { id: reservationId, organizationId: context.organizationId, status: "ACTIVE" } });
  if (!reservation) throw new Error("Reserva ativa não encontrada nesta organização.");
  if (engine.isReservationExpired(reservation.expiresAt, reservation.status, new Date())) throw new Error("A reserva já expirou; libere e crie uma nova.");
  return prisma.$transaction(async (tx) => {
    const result = await tx.salesUnit.updateMany({ where: { id: reservation.salesUnitId, status: "EM_RESERVA" }, data: { status: "RESERVADA" } });
    if (result.count === 0) throw new Error("A unidade não está mais em reserva — outra operação a alterou primeiro.");
    const updated = await tx.salesReservation.update({ where: { id: reservation.id }, data: { status: "CONFIRMED" } });
    await tx.auditLog.create({ data: audit(context, reservation.projectId, "SALES_RESERVATION_CONFIRMED", "SalesReservation", reservation.id, {}) });
    return updated;
  });
}

export async function releaseSalesReservation(context: MutationContext, reservationId: string, reason: string) {
  assertMutable(context);
  const reservation = await prisma.salesReservation.findFirst({ where: { id: reservationId, organizationId: context.organizationId, status: { in: ["ACTIVE", "CONFIRMED"] } } });
  if (!reservation) throw new Error("Reserva ativa/confirmada não encontrada nesta organização.");
  const expired = engine.isReservationExpired(reservation.expiresAt, "ACTIVE", new Date());
  return prisma.$transaction(async (tx) => {
    const result = await tx.salesUnit.updateMany({ where: { id: reservation.salesUnitId, status: { in: ["EM_RESERVA", "RESERVADA"] } }, data: { status: "DISPONIVEL" } });
    if (result.count === 0) throw new Error("A unidade não está mais reservada — outra operação a alterou primeiro.");
    const updated = await tx.salesReservation.update({ where: { id: reservation.id }, data: { status: expired ? "EXPIRED" : "CANCELLED", cancelledAt: new Date(), cancelledReason: reason } });
    await tx.auditLog.create({ data: audit(context, reservation.projectId, "SALES_RESERVATION_RELEASED", "SalesReservation", reservation.id, { reason, expired }) });
    return updated;
  });
}

/** Libera reservas vencidas em leitura — chamada pelo próprio workspace comercial, mesmo padrão de vencido calculado em `getFinancialWorkspace`. */
async function releaseExpiredReservations(context: MutationContext, projectId: string, referenceDate: Date) {
  const expired = await prisma.salesReservation.findMany({ where: { organizationId: context.organizationId, projectId, status: "ACTIVE", expiresAt: { lt: referenceDate } } });
  for (const reservation of expired) {
    try { await releaseSalesReservation(context, reservation.id, "Expiração automática identificada em leitura do workspace comercial."); } catch { /* concorrência: outra operação já tratou esta reserva */ }
  }
}

// ---------------------------------------------------------------------------
// T/U/V — Venda, Contrato de Venda e Plano de Pagamento
// ---------------------------------------------------------------------------

export async function createSale(context: AuthContext, raw: CreateSaleInput) {
  assertMutable(context);
  const input = createSaleSchema.parse(raw);
  const unit = await salesUnitForTenant(context.organizationId, input.salesUnitId);
  if (!engine.SALEABLE_UNIT_STATUSES.includes(unit.status as SalesUnitStatus)) throw new Error("A unidade não está em um estado que permita registrar uma venda.");
  const table = await priceTableForTenant(context.organizationId, input.priceTableId);
  const line = await prisma.salesPriceTableLine.findFirst({ where: { priceTableId: table.id, salesUnitId: unit.id } });
  if (!line) throw new Error("A unidade não possui preço nesta tabela.");
  for (const party of input.parties) await customerForTenant(context.organizationId, party.customerId);
  if (input.proposalId) { const proposal = await prisma.salesProposal.findFirst({ where: { id: input.proposalId, organizationId: context.organizationId, salesUnitId: unit.id } }); if (!proposal) throw new Error("Proposta informada não pertence a esta unidade."); }
  if (input.reservationId) { const reservation = await prisma.salesReservation.findFirst({ where: { id: input.reservationId, organizationId: context.organizationId, salesUnitId: unit.id } }); if (!reservation) throw new Error("Reserva informada não pertence a esta unidade."); }
  const { discountAmount } = engine.computeDiscount(line.listPrice, input.soldPrice);
  const sale = await prisma.sale.create({ data: {
    organizationId: context.organizationId, projectId: unit.projectId, companyId: unit.companyId, salesUnitId: unit.id, priceTableId: table.id,
    proposalId: input.proposalId ?? null, reservationId: input.reservationId ?? null, brokerId: input.brokerId ?? null, soldPrice: input.soldPrice,
    discountAmount, incentiveAmount: input.incentiveAmount, tradeInValue: input.tradeInValue ?? null,
    commercialConditionSnapshot: json({ listPrice: line.listPrice.toString(), minimumAuthorizedPrice: line.minimumAuthorizedPrice?.toString() ?? null, priceTableVersion: table.version, ...input.commercialConditionSnapshot }),
    createdById: context.userId, parties: { create: input.parties.map((party) => ({ customerId: party.customerId, role: party.role, ownershipPercentage: party.ownershipPercentage ?? null })) },
  }, include: { parties: true } });
  if (input.proposalId) await prisma.salesProposal.update({ where: { id: input.proposalId }, data: { status: "CONVERTED" } });
  if (input.reservationId) await prisma.salesReservation.update({ where: { id: input.reservationId }, data: { status: "CONVERTED" } });
  await prisma.auditLog.create({ data: audit(context, unit.projectId, "SALE_CREATED", "Sale", sale.id, { salesUnitId: unit.id, soldPrice: sale.soldPrice.toString(), discountAmount: sale.discountAmount.toString() }) });
  return sale;
}

/** Núcleo da fase: aprova a venda, congela o contrato/plano e gera exatamente um recebível por parcela via `createExternalReceivableObligation` (idempotente, espelha 9C→9B). */
export async function approveSale(context: AuthContext, raw: ApproveSaleInput) {
  assertApprover(context);
  const input = approveSaleSchema.parse(raw);
  const sale = await prisma.sale.findFirst({ where: { id: input.saleId, organizationId: context.organizationId, status: "DRAFT" }, include: { salesUnit: true, priceTable: true } });
  if (!sale) throw new Error("Venda em rascunho não encontrada nesta organização.");
  const totalInstallments = input.installments.reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
  if (!totalInstallments.equals(sale.soldPrice)) throw new Error("A soma das parcelas do plano de pagamento deve ser igual ao preço vendido.");
  const line = await prisma.salesPriceTableLine.findFirst({ where: { priceTableId: sale.priceTableId, salesUnitId: sale.salesUnitId } });
  const needsDiscountApproval = engine.requiresDiscountApproval(sale.soldPrice, line?.minimumAuthorizedPrice ?? null);

  return prisma.$transaction(async (tx) => {
    await recordApproval(tx, context, { actType: "SALE", entityType: "Sale", entityId: sale.id, entityVersion: sale.version, companyId: sale.companyId, projectId: sale.projectId, amount: sale.soldPrice, snapshot: { soldPrice: sale.soldPrice.toString(), discountAmount: sale.discountAmount.toString() } });
    if (needsDiscountApproval) await recordApproval(tx, context, { actType: "SALE_DISCOUNT", entityType: "Sale", entityId: sale.id, entityVersion: sale.version, companyId: sale.companyId, projectId: sale.projectId, amount: sale.discountAmount, snapshot: { soldPrice: sale.soldPrice.toString(), minimumAuthorizedPrice: line?.minimumAuthorizedPrice?.toString() ?? null } });

    const unitResult = await tx.salesUnit.updateMany({ where: { id: sale.salesUnitId, status: { in: [...engine.SALEABLE_UNIT_STATUSES] } }, data: { status: "VENDIDA" } });
    if (unitResult.count === 0) throw new Error("A unidade não está mais disponível para venda — outra operação a alterou primeiro.");

    const buyer = await tx.saleParty.findFirstOrThrow({ where: { saleId: sale.id, role: "BUYER" } });
    const contract = await tx.salesContract.create({ data: { organizationId: context.organizationId, projectId: sale.projectId, companyId: sale.companyId, saleId: sale.id, number: input.contract.number, title: input.contract.title, soldPrice: sale.soldPrice, commercialCondition: json(input.contract.commercialCondition), effectiveFrom: input.contract.effectiveFrom ?? null, status: "ACTIVE", createdById: context.userId } });
    const plan = await tx.salesPaymentPlan.create({ data: { saleId: sale.id, version: 1, status: "ACTIVE", createdById: context.userId, activatedAt: new Date(), installments: { create: input.installments.map((item) => ({ number: item.number, nature: item.nature, dueDate: item.dueDate, amount: item.amount, correctionRuleId: item.correctionRuleId ?? null })) } }, include: { installments: true } });

    await generateReceivablesForInstallments(tx, context, { saleId: sale.id, projectId: sale.projectId, companyId: sale.companyId, salesUnitId: sale.salesUnitId, buyerCustomerId: buyer.customerId, contractTitle: contract.title, contractNumber: contract.number, competenceDate: input.contract.effectiveFrom ?? new Date(), eventType: "SALE_CONTRACT_SIGNED", installments: plan.installments, installmentLabel: "parcela" });

    const approved = await tx.sale.update({ where: { id: sale.id }, data: { status: "APPROVED", approvedById: context.userId, approvedAt: new Date() } });
    await tx.auditLog.create({ data: audit(context, sale.projectId, "SALE_APPROVED", "Sale", sale.id, { contractId: contract.id, planId: plan.id, installments: plan.installments.length }) });
    return { sale: approved, contract, plan };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
}

function createIdempotencyKey(organizationId: string, sourceType: string, sourceId: string, sourceVersion: number, eventType: string) {
  return createHash("sha256").update(`${organizationId}:${sourceType}:${sourceId}:${sourceVersion}:${eventType}`).digest("hex");
}
function createPayloadChecksum(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Gera exatamente um `ReceivableAccount`/`ReceivableInstallment` por parcela comercial, via o mesmo
 * caminho idempotente da 9C→9B (`idempotencyKey` + `payloadChecksum` + replay). Chamável múltiplas vezes
 * com o mesmo conjunto de parcelas sem duplicar — cada `sourceId` (id da `SalesPaymentPlanInstallment`,
 * já globalmente único) é verificado contra um evento `PROCESSED` existente antes de criar um novo.
 */
async function generateReceivablesForInstallments(tx: Prisma.TransactionClient, context: AuthContext, params: { saleId: string; projectId: string; companyId: string; salesUnitId: string; buyerCustomerId: string; contractTitle: string; contractNumber: string; competenceDate: Date; eventType: "SALE_CONTRACT_SIGNED" | "SALE_PLAN_REVISED"; installments: { id: string; number: number; nature: string; dueDate: Date; amount: Prisma.Decimal; receivableInstallmentId: string | null }[]; installmentLabel: string }) {
  const processed: { installmentId: string; receivableAccountId: string; receivableInstallmentId: string }[] = [];
  for (const installment of params.installments) {
    const idempotencyKey = createIdempotencyKey(context.organizationId, "SALE_PAYMENT_PLAN_INSTALLMENT", installment.id, 1, params.eventType);
    const existing = await tx.financialIntegrationEvent.findUnique({ where: { idempotencyKey } });
    if (existing?.status === "PROCESSED" && existing.receivableAccountId) {
      if (!installment.receivableInstallmentId) { const account = await tx.receivableAccount.findUniqueOrThrow({ where: { id: existing.receivableAccountId }, include: { installments: true } }); await tx.salesPaymentPlanInstallment.update({ where: { id: installment.id }, data: { receivableInstallmentId: account.installments[0].id } }); processed.push({ installmentId: installment.id, receivableAccountId: existing.receivableAccountId, receivableInstallmentId: account.installments[0].id }); }
      else processed.push({ installmentId: installment.id, receivableAccountId: existing.receivableAccountId, receivableInstallmentId: installment.receivableInstallmentId });
      continue;
    }
    const payloadChecksum = createPayloadChecksum({ installmentId: installment.id, amount: installment.amount.toString(), dueDate: installment.dueDate.toISOString() });
    const event = await tx.financialIntegrationEvent.create({ data: { organizationId: context.organizationId, projectId: params.projectId, eventType: params.eventType, sourceType: "SALE_PAYMENT_PLAN_INSTALLMENT", sourceId: installment.id, sourceVersion: 1, schemaVersion: 1, eventId: idempotencyKey, idempotencyKey, payloadChecksum, payload: json({ saleId: params.saleId, installmentNumber: installment.number, amount: installment.amount.toString(), dueDate: installment.dueDate.toISOString() }), status: "PROCESSING", attemptCount: 1 } });
    const result = await createExternalReceivableObligation(tx, { organizationId: context.organizationId, companyId: params.companyId, projectId: params.projectId, customerId: params.buyerCustomerId, saleId: params.saleId, sourceType: "SALE_PAYMENT_PLAN_INSTALLMENT", sourceId: installment.id, sourceVersion: 1, competenceDate: params.competenceDate, dueDate: installment.dueDate, netAmount: installment.amount, description: `${params.contractTitle} — ${params.installmentLabel} ${installment.number} (${installment.nature})`, responsibleId: context.userId, createdById: context.userId, unitReference: params.salesUnitId, contractReference: params.contractNumber });
    await tx.financialIntegrationEvent.update({ where: { id: event.id }, data: { status: "PROCESSED", financialObligationId: result.obligationId, receivableAccountId: result.receivableAccountId, processedAt: new Date() } });
    await tx.salesPaymentPlanInstallment.update({ where: { id: installment.id }, data: { receivableInstallmentId: result.receivableInstallmentId } });
    processed.push({ installmentId: installment.id, receivableAccountId: result.receivableAccountId, receivableInstallmentId: result.receivableInstallmentId });
  }
  return processed;
}

/** Ponto de entrada replay-safe: pode ser chamado repetidamente para o plano ativo de uma venda sem duplicar recebíveis (Cenário A/item 51). */
export async function generateSaleReceivables(context: AuthContext, saleId: string) {
  assertApprover(context);
  const sale = await prisma.sale.findFirst({ where: { id: saleId, organizationId: context.organizationId }, include: { contract: true, parties: true, paymentPlans: { where: { status: "ACTIVE" }, include: { installments: true } } } });
  if (!sale?.contract) throw new Error("Venda aprovada com contrato não encontrada nesta organização.");
  const plan = sale.paymentPlans[0];
  if (!plan) throw new Error("Nenhum plano de pagamento ativo para esta venda.");
  const buyer = sale.parties.find((party) => party.role === "BUYER") ?? sale.parties[0];
  return prisma.$transaction((tx) => generateReceivablesForInstallments(tx, context, { saleId: sale.id, projectId: sale.projectId, companyId: sale.companyId, salesUnitId: sale.salesUnitId, buyerCustomerId: buyer.customerId, contractTitle: sale.contract!.title, contractNumber: sale.contract!.number, competenceDate: new Date(), eventType: plan.version === 1 ? "SALE_CONTRACT_SIGNED" : "SALE_PLAN_REVISED", installments: plan.installments, installmentLabel: plan.version === 1 ? "parcela" : "parcela renegociada" }));
}

// ---------------------------------------------------------------------------
// AB — Renegociação (nova versão do plano, parcelas antigas não pagas canceladas)
// ---------------------------------------------------------------------------

export async function renegotiateSalesPaymentPlan(context: AuthContext, raw: RenegotiatePaymentPlanInput) {
  assertApprover(context);
  const input = renegotiatePaymentPlanSchema.parse(raw);
  const sale = await prisma.sale.findFirst({ where: { id: input.saleId, organizationId: context.organizationId, status: "APPROVED" }, include: { paymentPlans: { where: { status: "ACTIVE" }, include: { installments: { include: { receivableInstallment: { include: { payments: true } } } } } } } });
  if (!sale) throw new Error("Venda aprovada não encontrada nesta organização.");
  const currentPlan = sale.paymentPlans[0];
  if (!currentPlan) throw new Error("Nenhum plano de pagamento ativo para esta venda.");
  const totalInstallments = input.installments.reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));

  return prisma.$transaction(async (tx) => {
    for (const installment of currentPlan.installments) {
      const paid = installment.receivableInstallment?.status === "RECEBIDA" || (installment.receivableInstallment?.payments.some((payment) => ["PROCESSED", "CLEARED"].includes(payment.status)) ?? false);
      if (paid) continue;
      if (installment.receivableInstallmentId) await transitionReceivableInstallment(context, installment.receivableInstallmentId, "CANCELADA", `Renegociação: ${input.reason}`);
      await tx.salesPaymentPlanInstallment.update({ where: { id: installment.id }, data: { cancelledAt: new Date(), cancelledReason: input.reason } });
    }
    await tx.salesPaymentPlan.update({ where: { id: currentPlan.id }, data: { status: "SUPERSEDED", supersededAt: new Date() } });
    const newPlan = await tx.salesPaymentPlan.create({ data: { saleId: sale.id, version: currentPlan.version + 1, status: "ACTIVE", previousPlanId: currentPlan.id, createdById: context.userId, activatedAt: new Date(), installments: { create: input.installments.map((item) => ({ number: item.number, nature: item.nature, dueDate: item.dueDate, amount: item.amount, correctionRuleId: item.correctionRuleId ?? null })) } }, include: { installments: true } });
    const buyer = await tx.saleParty.findFirstOrThrow({ where: { saleId: sale.id, role: "BUYER" } });
    const contract = await tx.salesContract.findUniqueOrThrow({ where: { saleId: sale.id } });
    await generateReceivablesForInstallments(tx, context, { saleId: sale.id, projectId: sale.projectId, companyId: sale.companyId, salesUnitId: sale.salesUnitId, buyerCustomerId: buyer.customerId, contractTitle: contract.title, contractNumber: contract.number, competenceDate: new Date(), eventType: "SALE_PLAN_REVISED", installments: newPlan.installments, installmentLabel: "parcela renegociada" });
    await tx.auditLog.create({ data: audit(context, sale.projectId, "SALES_PAYMENT_PLAN_RENEGOTIATED", "SalesPaymentPlan", newPlan.id, { previousPlanId: currentPlan.id, reason: input.reason, total: totalInstallments.toString() }) });
    return newPlan;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// AC/AD — Distrato (evento comercial na 9E, efeito financeiro pela 9B)
// ---------------------------------------------------------------------------

export async function rescindSale(context: AuthContext, raw: RescindSaleInput) {
  assertApprover(context);
  const input = rescindSaleSchema.parse(raw);
  const sale = await prisma.sale.findFirst({ where: { id: input.saleId, organizationId: context.organizationId, status: "APPROVED" }, include: { paymentPlans: { where: { status: "ACTIVE" }, include: { installments: { include: { receivableInstallment: { include: { payments: true } } } } } }, parties: true } });
  if (!sale) throw new Error("Venda aprovada não encontrada nesta organização.");
  const buyer = sale.parties.find((party) => party.role === "BUYER") ?? sale.parties[0];

  return prisma.$transaction(async (tx) => {
    await recordApproval(tx, context, { actType: "SALE_RESCISSION", entityType: "Sale", entityId: sale.id, entityVersion: sale.version, companyId: sale.companyId, projectId: sale.projectId, amount: sale.soldPrice, snapshot: { reason: input.reason, retentionRate: input.retentionRate } });
    const unitResult = await tx.salesUnit.updateMany({ where: { id: sale.salesUnitId, status: "VENDIDA" }, data: { status: "DISTRATADA" } });
    if (unitResult.count === 0) throw new Error("A unidade não está mais vendida — outra operação a alterou primeiro.");

    let paidAmount = new Prisma.Decimal(0);
    for (const plan of sale.paymentPlans) for (const installment of plan.installments) {
      const paidOnInstallment = (installment.receivableInstallment?.payments ?? []).filter((payment) => ["PROCESSED", "CLEARED"].includes(payment.status)).reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0));
      if (paidOnInstallment.greaterThan(0)) { paidAmount = paidAmount.add(paidOnInstallment); continue; }
      if (installment.receivableInstallmentId && installment.receivableInstallment && !["RECEBIDA", "CANCELADA"].includes(installment.receivableInstallment.status)) await transitionReceivableInstallment(context, installment.receivableInstallmentId, "CANCELADA", `Distrato: ${input.reason}`);
    }
    for (const plan of sale.paymentPlans) await tx.salesPaymentPlan.update({ where: { id: plan.id }, data: { status: "CANCELLED" } });

    let refund: ReturnType<typeof engine.calculateRescissionRefund> | null = null;
    if (paidAmount.greaterThan(0)) {
      refund = engine.calculateRescissionRefund(paidAmount, input.retentionRate);
      if (refund.refundAmount.greaterThan(0)) {
        const idempotencyKey = createIdempotencyKey(context.organizationId, "SALE_RESCISSION", sale.id, sale.version, "SALE_RESCINDED");
        const payloadChecksum = createPayloadChecksum({ saleId: sale.id, refundAmount: refund.refundAmount.toString() });
        const event = await tx.financialIntegrationEvent.create({ data: { organizationId: context.organizationId, projectId: sale.projectId, eventType: "SALE_RESCINDED", sourceType: "SALE_RESCISSION", sourceId: sale.id, sourceVersion: sale.version, schemaVersion: 1, eventId: idempotencyKey, idempotencyKey, payloadChecksum, payload: json({ saleId: sale.id, paidAmount: paidAmount.toString(), retainedAmount: refund.retainedAmount.toString(), refundAmount: refund.refundAmount.toString() }), status: "PROCESSING", attemptCount: 1 } });
        const result = await createExternalPayableObligation(tx, { organizationId: context.organizationId, companyId: sale.companyId, projectId: sale.projectId, supplierId: null, sourceType: "SALE_RESCISSION", sourceId: sale.id, sourceVersion: sale.version, competenceDate: new Date(), dueDate: new Date(), grossAmount: refund.refundAmount, withholdings: new Prisma.Decimal(0), discounts: new Prisma.Decimal(0), advancesApplied: new Prisma.Decimal(0), netAmount: refund.refundAmount, currency: "BRL", description: `Devolução de distrato — venda ${sale.id}${buyer ? ` — comprador ${buyer.customerId}` : ""}`, responsibleId: context.userId, createdById: context.userId, origin: "MANUAL" });
        await tx.financialIntegrationEvent.update({ where: { id: event.id }, data: { status: "PROCESSED", financialObligationId: result.obligationId, payableAccountId: result.payableAccountId, processedAt: new Date() } });
      }
    }

    const updated = await tx.sale.update({ where: { id: sale.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledReason: input.reason } });
    await tx.auditLog.create({ data: audit(context, sale.projectId, "SALE_RESCINDED", "Sale", sale.id, { reason: input.reason, paidAmount: paidAmount.toString(), refundAmount: refund?.refundAmount.toString() ?? "0" }) });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
}

export async function reactivateRescindedUnit(context: AuthContext, salesUnitId: string) {
  assertApprover(context);
  const unit = await salesUnitForTenant(context.organizationId, salesUnitId);
  if (unit.status !== "DISTRATADA") throw new Error("Somente unidades distratadas podem voltar a ficar disponíveis.");
  const openInstallments = await prisma.receivableInstallment.count({ where: { receivableAccount: { sale: { salesUnitId: unit.id, status: "CANCELLED" } }, status: { notIn: ["CANCELADA", "RECEBIDA", "RENEGOCIADA"] } } });
  if (openInstallments > 0) throw new Error("Ainda há parcelas em aberto do distrato anterior; resolva-as no Financeiro antes de reativar a unidade.");
  return prisma.$transaction(async (tx) => {
    const result = await tx.salesUnit.updateMany({ where: { id: unit.id, status: "DISTRATADA" }, data: { status: "DISPONIVEL" } });
    if (result.count === 0) throw new Error("A unidade não está mais distratada — outra operação a alterou primeiro.");
    await tx.auditLog.create({ data: audit(context, unit.projectId, "SALES_UNIT_REACTIVATED", "SalesUnit", unit.id, {}) });
    return tx.salesUnit.findUniqueOrThrow({ where: { id: unit.id } });
  });
}

// ---------------------------------------------------------------------------
// AE/AF — Comissões (mesmo mecanismo idempotente, lado pagável já existente)
// ---------------------------------------------------------------------------

export async function createSalesCommissionPolicy(context: AuthContext, raw: CreateSalesCommissionPolicyInput) {
  assertMutable(context);
  const input = createSalesCommissionPolicySchema.parse(raw);
  if (input.projectId) await projectForTenant(context.organizationId, input.projectId);
  const policy = await prisma.salesCommissionPolicy.create({ data: { organizationId: context.organizationId, projectId: input.projectId ?? null, triggerEvent: input.triggerEvent, percentage: input.percentage, basis: input.basis, createdById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, input.projectId ?? null, "SALES_COMMISSION_POLICY_CREATED", "SalesCommissionPolicy", policy.id, { percentage: policy.percentage.toString() }) });
  return policy;
}

export async function createSalesCommission(context: AuthContext, raw: CreateSalesCommissionInput) {
  assertMutable(context);
  const input = createSalesCommissionSchema.parse(raw);
  const sale = await prisma.sale.findFirst({ where: { id: input.saleId, organizationId: context.organizationId, status: "APPROVED" } });
  if (!sale) throw new Error("Venda aprovada não encontrada nesta organização.");
  const broker = await prisma.supplier.findFirst({ where: { id: input.brokerId, organizationId: context.organizationId } });
  if (!broker) throw new Error("Corretor/imobiliária não encontrado nesta organização.");
  const amount = engine.calculateCommissionAmount(input.basis, input.percentage, sale.soldPrice);
  const commission = await prisma.salesCommission.create({ data: { saleId: sale.id, brokerId: broker.id, policyId: input.policyId ?? null, basis: input.basis, percentage: input.percentage, amount, triggerEvent: input.triggerEvent, createdById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, sale.projectId, "SALES_COMMISSION_CREATED", "SalesCommission", commission.id, { amount: amount.toString() }) });
  return commission;
}

export async function approveSalesCommission(context: AuthContext, commissionId: string) {
  assertApprover(context);
  const commission = await prisma.salesCommission.findFirst({ where: { id: commissionId, status: "PENDING", sale: { organizationId: context.organizationId } }, include: { sale: true } });
  if (!commission) throw new Error("Comissão pendente não encontrada nesta organização.");
  return prisma.$transaction(async (tx) => {
    await recordApproval(tx, context, { actType: "COMMISSION", entityType: "SalesCommission", entityId: commission.id, entityVersion: 1, companyId: commission.sale.companyId, projectId: commission.sale.projectId, amount: commission.amount, snapshot: { brokerId: commission.brokerId, basis: commission.basis } });
    const idempotencyKey = createIdempotencyKey(context.organizationId, "SALE_COMMISSION", commission.id, 1, "COMMISSION_APPROVED");
    const payloadChecksum = createPayloadChecksum({ commissionId: commission.id, amount: commission.amount.toString() });
    const event = await tx.financialIntegrationEvent.create({ data: { organizationId: context.organizationId, projectId: commission.sale.projectId, eventType: "COMMISSION_APPROVED", sourceType: "SALE_COMMISSION", sourceId: commission.id, sourceVersion: 1, schemaVersion: 1, eventId: idempotencyKey, idempotencyKey, payloadChecksum, payload: json({ saleId: commission.saleId, brokerId: commission.brokerId, amount: commission.amount.toString() }), status: "PROCESSING", attemptCount: 1 } });
    const result = await createExternalPayableObligation(tx, { organizationId: context.organizationId, companyId: commission.sale.companyId, projectId: commission.sale.projectId, supplierId: commission.brokerId, sourceType: "SALE_COMMISSION", sourceId: commission.id, sourceVersion: 1, competenceDate: new Date(), dueDate: new Date(), grossAmount: commission.amount, withholdings: new Prisma.Decimal(0), discounts: new Prisma.Decimal(0), advancesApplied: new Prisma.Decimal(0), netAmount: commission.amount, currency: "BRL", description: `Comissão — venda ${commission.saleId}`, responsibleId: context.userId, createdById: context.userId, origin: "MANUAL" });
    await tx.financialIntegrationEvent.update({ where: { id: event.id }, data: { status: "PROCESSED", financialObligationId: result.obligationId, payableAccountId: result.payableAccountId, processedAt: new Date() } });
    const updated = await tx.salesCommission.update({ where: { id: commission.id }, data: { status: "PAYABLE_GENERATED", approvedById: context.userId, approvedAt: new Date() } });
    await tx.auditLog.create({ data: audit(context, commission.sale.projectId, "SALES_COMMISSION_APPROVED", "SalesCommission", commission.id, { payableAccountId: result.payableAccountId }) });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

// ---------------------------------------------------------------------------
// AJ/AK — Entrega e Vistoria
// ---------------------------------------------------------------------------

export async function scheduleInspection(context: AuthContext, raw: ScheduleInspectionInput) {
  assertMutable(context);
  const input = scheduleInspectionSchema.parse(raw);
  const unit = await salesUnitForTenant(context.organizationId, input.salesUnitId);
  const sale = await prisma.sale.findFirst({ where: { id: input.saleId, organizationId: context.organizationId, salesUnitId: unit.id, status: "APPROVED" } });
  if (!sale) throw new Error("Venda aprovada não encontrada para esta unidade.");
  const inspection = await prisma.salesUnitInspection.create({ data: { salesUnitId: unit.id, saleId: sale.id, scheduledAt: input.scheduledAt, responsibleId: input.responsibleId, checklist: input.checklist ? json(input.checklist) : undefined, createdById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, unit.projectId, "SALES_UNIT_INSPECTION_SCHEDULED", "SalesUnitInspection", inspection.id, { scheduledAt: inspection.scheduledAt.toISOString() }) });
  return inspection;
}

export async function recordInspectionOutcome(context: AuthContext, raw: RecordInspectionOutcomeInput) {
  assertMutable(context);
  const input = recordInspectionOutcomeSchema.parse(raw);
  const inspection = await prisma.salesUnitInspection.findFirst({ where: { id: input.inspectionId, salesUnit: { organizationId: context.organizationId } }, include: { salesUnit: true } });
  if (!inspection) throw new Error("Vistoria não encontrada nesta organização.");
  const updated = await prisma.salesUnitInspection.update({ where: { id: inspection.id }, data: { outcome: input.outcome, pendingIssues: json(input.pendingIssues), nextInspectionAt: input.nextInspectionAt ?? null } });
  await prisma.auditLog.create({ data: audit(context, inspection.salesUnit.projectId, "SALES_UNIT_INSPECTION_RECORDED", "SalesUnitInspection", inspection.id, { outcome: input.outcome }) });
  return updated;
}

/** "Apta à entrega" combina três leituras (obra, financeiro, documentos) — nunca uma nova máquina de estados cross-domain. */
export async function markUnitDelivered(context: AuthContext, salesUnitId: string) {
  assertApprover(context);
  const unit = await salesUnitForTenant(context.organizationId, salesUnitId);
  if (unit.status !== "VENDIDA") throw new Error("Somente unidades vendidas podem ser marcadas como entregues.");
  const sale = await prisma.sale.findFirst({ where: { salesUnitId: unit.id, status: "APPROVED" } });
  if (!sale) throw new Error("Nenhuma venda aprovada encontrada para esta unidade.");
  const accepted = await prisma.salesUnitInspection.findFirst({ where: { salesUnitId: unit.id, saleId: sale.id, outcome: { in: ["ACCEPTED", "ACCEPTED_WITH_PENDING"] } } });
  if (!accepted) throw new Error("É necessário ao menos uma vistoria aceita (com ou sem pendências) antes da entrega.");
  const overdueOpen = await prisma.receivableInstallment.count({ where: { receivableAccount: { saleId: sale.id }, status: { in: ["PREVISTA", "EMITIDA", "PARCIALMENTE_RECEBIDA"] }, dueDate: { lt: new Date() } } });
  if (overdueOpen > 0) throw new Error("Há parcelas vencidas em aberto no Financeiro; regularize antes de liberar a entrega.");
  return prisma.$transaction(async (tx) => {
    const result = await tx.salesUnit.updateMany({ where: { id: unit.id, status: "VENDIDA" }, data: { status: "ENTREGUE" } });
    if (result.count === 0) throw new Error("A unidade não está mais vendida — outra operação a alterou primeiro.");
    await tx.auditLog.create({ data: audit(context, unit.projectId, "SALES_UNIT_DELIVERED", "SalesUnit", unit.id, { saleId: sale.id }) });
    return tx.salesUnit.findUniqueOrThrow({ where: { id: unit.id } });
  });
}

// ---------------------------------------------------------------------------
// AL — Pós-venda mínimo
// ---------------------------------------------------------------------------

export async function createPostSaleRequest(context: AuthContext, raw: CreatePostSaleRequestInput) {
  assertMutable(context);
  const input = createPostSaleRequestSchema.parse(raw);
  const unit = await salesUnitForTenant(context.organizationId, input.salesUnitId);
  const sale = await prisma.sale.findFirst({ where: { id: input.saleId, organizationId: context.organizationId, salesUnitId: unit.id } });
  if (!sale) throw new Error("Venda não encontrada para esta unidade.");
  await customerForTenant(context.organizationId, input.customerId);
  const request = await prisma.postSaleRequest.create({ data: { organizationId: context.organizationId, salesUnitId: unit.id, saleId: sale.id, customerId: input.customerId, category: input.category, description: input.description, responsibleId: input.responsibleId ?? null, slaDueAt: input.slaDueAt ?? null, createdById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, unit.projectId, "POST_SALE_REQUEST_CREATED", "PostSaleRequest", request.id, { category: request.category }) });
  return request;
}

export async function addPostSaleUpdate(context: AuthContext, raw: AddPostSaleUpdateInput) {
  assertMutable(context);
  const input = addPostSaleUpdateSchema.parse(raw);
  const request = await prisma.postSaleRequest.findFirst({ where: { id: input.requestId, organizationId: context.organizationId } });
  if (!request) throw new Error("Solicitação de pós-venda não encontrada nesta organização.");
  const update = await prisma.postSaleUpdate.create({ data: { requestId: request.id, authorId: context.userId, note: input.note } });
  return update;
}

export async function transitionPostSaleRequest(context: AuthContext, raw: TransitionPostSaleRequestInput) {
  assertMutable(context);
  const input = transitionPostSaleRequestSchema.parse(raw);
  const request = await prisma.postSaleRequest.findFirst({ where: { id: input.requestId, organizationId: context.organizationId } });
  if (!request) throw new Error("Solicitação de pós-venda não encontrada nesta organização.");
  const updated = await prisma.postSaleRequest.update({ where: { id: request.id }, data: { status: input.status } });
  await prisma.auditLog.create({ data: audit(context, null, "POST_SALE_REQUEST_TRANSITIONED", "PostSaleRequest", request.id, { from: request.status, to: input.status }) });
  return updated;
}

// ---------------------------------------------------------------------------
// Leitura: workspace comercial consolidado (Central Executiva + REDE IA)
// ---------------------------------------------------------------------------

export async function getSalesWorkspace(context: MutationContext, projectId: string, referenceDate: Date = new Date()) {
  await projectForTenant(context.organizationId, projectId);
  await releaseExpiredReservations(context, projectId, referenceDate);

  const [units, priceTables, proposals, reservations, sales, leads, commissionPolicies, inspections, postSaleRequests, brokerProfiles, contractTemplates] = await Promise.all([
    prisma.salesUnit.findMany({ where: { organizationId: context.organizationId, projectId }, include: { priceLines: { include: { priceTable: true } }, blocks: { where: { endedAt: null } } }, orderBy: { code: "asc" }, take: 2000 }),
    prisma.salesPriceTable.findMany({ where: { organizationId: context.organizationId, projectId }, include: { lines: true }, orderBy: { version: "desc" }, take: 50 }),
    prisma.salesProposal.findMany({ where: { organizationId: context.organizationId, projectId }, include: { customer: true, salesUnit: true, broker: true, creditBureauConsultations: { orderBy: { requestedAt: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.salesReservation.findMany({ where: { organizationId: context.organizationId, projectId }, include: { customer: true, salesUnit: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.sale.findMany({ where: { organizationId: context.organizationId, projectId }, include: { salesUnit: true, parties: { include: { customer: true } }, contract: { include: { documents: { orderBy: { createdAt: "desc" }, take: 5 }, signatureRequests: { orderBy: { createdAt: "desc" }, take: 1, include: { parties: true } } } }, paymentPlans: { include: { installments: { include: { receivableInstallment: { include: { payments: true } } } } } }, commissions: { include: { broker: true } }, broker: true, receivableAccounts: { include: { installments: { include: { payments: true } } } } }, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.salesLead.findMany({ where: { organizationId: context.organizationId, OR: [{ projectId }, { projectId: null }] }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.salesCommissionPolicy.findMany({ where: { organizationId: context.organizationId, OR: [{ projectId }, { projectId: null }], isActive: true } }),
    prisma.salesUnitInspection.findMany({ where: { salesUnit: { organizationId: context.organizationId, projectId } }, include: { salesUnit: true }, orderBy: { scheduledAt: "desc" }, take: 200 }),
    prisma.postSaleRequest.findMany({ where: { organizationId: context.organizationId, salesUnit: { projectId } }, include: { customer: true, salesUnit: true, updates: { orderBy: { createdAt: "desc" }, take: 5 } }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.brokerProfile.findMany({ where: { organizationId: context.organizationId }, include: { supplier: true } }),
    prisma.contractTemplate.findMany({ where: { organizationId: context.organizationId, projectId }, include: { versions: { orderBy: { version: "desc" }, take: 5 } }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  const activeLineByUnit = new Map(units.map((unit) => [unit.id, unit.priceLines.find((line) => line.priceTable.status === "ACTIVE") ?? null]));
  const vgv = engine.vgvBreakdown(units.map((unit) => ({ status: unit.status as SalesUnitStatus, listPrice: activeLineByUnit.get(unit.id)?.listPrice ?? 0 })), sales.map((sale) => ({ status: sale.status, soldPrice: sale.soldPrice, tradeInValue: sale.tradeInValue })));
  const receivedByReceivable = (installments: { payments: { amount: Prisma.Decimal; status: string }[] }[]) => installments.reduce((sum, installment) => sum.add(installment.payments.filter((payment) => ["PROCESSED", "CLEARED"].includes(payment.status)).reduce((s, p) => s.add(p.amount), new Prisma.Decimal(0))), new Prisma.Decimal(0));
  const vgvReceived = sales.reduce((sum, sale) => sum.add(receivedByReceivable(sale.receivableAccounts.flatMap((account) => account.installments))), new Prisma.Decimal(0));
  const vgvToReceive = engine.vgvToReceive(vgv.vendido, vgvReceived);

  const soldThisMonth = sales.filter((sale) => sale.status === "APPROVED" && sale.approvedAt && sale.approvedAt.getUTCFullYear() === referenceDate.getUTCFullYear() && sale.approvedAt.getUTCMonth() === referenceDate.getUTCMonth());
  const unitsAvailable = units.filter((unit) => unit.status === "DISPONIVEL").length;
  const soldCount = units.filter((unit) => unit.status === "VENDIDA" || unit.status === "ENTREGUE").length;
  const vsoValue = engine.vso(soldThisMonth.length, unitsAvailable + soldThisMonth.length);
  const averagePricePerM2 = units.length ? engine.pricePerM2(vgv.total, units.reduce((sum, unit) => sum + Number(unit.privateAreaM2), 0)) : new Prisma.Decimal(0);
  const averageDiscount = sales.filter((sale) => sale.status === "APPROVED").length ? engine.money(sales.filter((sale) => sale.status === "APPROVED").reduce((sum, sale) => sum.add(sale.discountAmount), new Prisma.Decimal(0)).div(Math.max(1, sales.filter((sale) => sale.status === "APPROVED").length))) : new Prisma.Decimal(0);
  const overdueReceivables = sales.flatMap((sale) => sale.receivableAccounts.flatMap((account) => account.installments)).filter((installment) => installment.dueDate < referenceDate && !["RECEBIDA", "CANCELADA", "RENEGOCIADA"].includes(installment.status));

  return {
    projectId, generatedAt: referenceDate.toISOString(),
    summary: {
      vgvTotal: Number(vgv.total), vgvDisponivel: Number(vgv.disponivel), vgvReservado: Number(vgv.reservado), vgvVendido: Number(vgv.vendido), vgvPermutado: Number(vgv.permutado), vgvDistratado: Number(vgv.distratado), vgvRecebido: Number(vgvReceived), vgvAReceber: Number(vgvToReceive),
      unitsTotal: units.length, unitsAvailable, unitsSold: soldCount, unitsReserved: units.filter((unit) => unit.status === "EM_RESERVA" || unit.status === "RESERVADA").length, unitsBlocked: units.filter((unit) => unit.status === "BLOQUEADA").length, unitsDelivered: units.filter((unit) => unit.status === "ENTREGUE").length, unitsRescinded: units.filter((unit) => unit.status === "DISTRATADA").length,
      salesThisMonth: soldThisMonth.length, vso: vsoValue, averagePricePerM2: Number(averagePricePerM2), averageDiscount: Number(averageDiscount),
      activeProposals: proposals.filter((proposal) => proposal.status === "SUBMITTED" || proposal.status === "UNDER_APPROVAL").length, activeReservations: reservations.filter((reservation) => reservation.status === "ACTIVE" || reservation.status === "CONFIRMED").length,
      pendingCommissions: sales.flatMap((sale) => sale.commissions).filter((commission) => commission.status === "PENDING").length, overdueReceivables: overdueReceivables.length, overdueReceivablesAmount: Number(engine.money(overdueReceivables.reduce((sum, item) => sum.add(item.currentAmount), new Prisma.Decimal(0)))),
      openPostSaleRequests: postSaleRequests.filter((item) => !["RESOLVED", "CLOSED"].includes(item.status)).length,
    },
    units: units.map((unit) => ({ id: unit.id, code: unit.code, floor: unit.floor, typology: unit.typology, privateAreaM2: Number(unit.privateAreaM2), status: unit.status, listPrice: activeLineByUnit.get(unit.id) ? Number(activeLineByUnit.get(unit.id)!.listPrice) : null, pricePerM2: activeLineByUnit.get(unit.id) ? Number(engine.pricePerM2(activeLineByUnit.get(unit.id)!.listPrice, unit.privateAreaM2)) : null, activeBlock: unit.blocks[0] ? { origin: unit.blocks[0].origin, reason: unit.blocks[0].reason } : null })),
    priceTables: priceTables.map((table) => ({ id: table.id, version: table.version, status: table.status, validFrom: table.validFrom.toISOString(), lines: table.lines.length })),
    proposals: proposals.map((proposal) => ({ id: proposal.id, unit: proposal.salesUnit.code, customer: proposal.customer.name, broker: proposal.broker?.name ?? null, proposedPrice: Number(proposal.proposedPrice), discountAmount: Number(proposal.discountAmount), validUntil: proposal.validUntil.toISOString(), status: proposal.status, creditConsultation: proposal.creditBureauConsultations[0] ? { status: proposal.creditBureauConsultations[0].status, result: proposal.creditBureauConsultations[0].result, cpfMasked: proposal.creditBureauConsultations[0].cpfMasked, requestedAt: proposal.creditBureauConsultations[0].requestedAt.toISOString() } : null })),
    reservations: reservations.map((reservation) => ({ id: reservation.id, unit: reservation.salesUnit.code, customer: reservation.customer.name, expiresAt: reservation.expiresAt.toISOString(), status: reservation.status, expired: engine.isReservationExpired(reservation.expiresAt, reservation.status, referenceDate) })),
    sales: sales.map((sale) => {
      const signatureRequest = sale.contract?.signatureRequests[0] ?? null;
      return {
        id: sale.id, unit: sale.salesUnit.code, buyers: sale.parties.map((party) => party.customer.name), broker: sale.broker?.name ?? null, soldPrice: Number(sale.soldPrice), discountAmount: Number(sale.discountAmount), status: sale.status,
        contractId: sale.contract?.id ?? null, contractNumber: sale.contract?.number ?? null, contractDocuments: sale.contract?.documents.map((doc) => ({ id: doc.id, kind: doc.kind, status: doc.status, version: doc.version, fileName: doc.fileName })) ?? [],
        signatureStatus: sale.contract?.signatureStatus ?? null,
        signatureRequest: signatureRequest ? { id: signatureRequest.id, status: signatureRequest.status, provider: signatureRequest.provider, signedCount: signatureRequest.parties.filter((party) => party.status === "SIGNED").length, totalParties: signatureRequest.parties.length } : null,
        installments: sale.paymentPlans.flatMap((plan) => plan.status === "ACTIVE" ? plan.installments : []).length, received: Number(receivedByReceivable(sale.receivableAccounts.flatMap((account) => account.installments))),
      };
    }),
    leads: leads.map((lead) => ({ id: lead.id, name: lead.name, source: lead.source, stage: lead.stage, brokerId: lead.brokerId })),
    commissionPolicies: commissionPolicies.map((policy) => ({ id: policy.id, triggerEvent: policy.triggerEvent, percentage: Number(policy.percentage), basis: policy.basis })),
    commissions: sales.flatMap((sale) => sale.commissions.map((commission) => ({ id: commission.id, sale: sale.id, broker: commission.broker.name, amount: Number(commission.amount), status: commission.status }))),
    inspections: inspections.map((inspection) => ({ id: inspection.id, unit: inspection.salesUnit.code, scheduledAt: inspection.scheduledAt.toISOString(), outcome: inspection.outcome })),
    postSaleRequests: postSaleRequests.map((request) => ({ id: request.id, unit: request.salesUnit.code, customer: request.customer.name, category: request.category, status: request.status, updates: request.updates.length })),
    brokers: brokerProfiles.map((profile) => ({ id: profile.id, name: profile.supplier.name, creci: profile.creci, defaultCommissionRate: profile.defaultCommissionRate ? Number(profile.defaultCommissionRate) : null })),
    contractTemplates: contractTemplates.map((template) => ({ id: template.id, name: template.name, status: template.status, versions: template.versions.map((version) => ({ id: version.id, version: version.version, status: version.status })) })),
  };
}

export type SalesWorkspaceView = Awaited<ReturnType<typeof getSalesWorkspace>>;
