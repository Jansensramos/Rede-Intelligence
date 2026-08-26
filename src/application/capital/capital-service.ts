/**
 * Fase 9N — mutações de Capital & Funding. Regras centrais (aprovadas na revisão do schema):
 *  - `FundingProposal` só é mutável em DRAFT/SUBMITTED/UNDER_REVIEW; uma vez APPROVED, qualquer
 *    alteração relevante cria uma NOVA versão (`reviseFundingProposal`) — nunca overwrite.
 *  - Aprovação materializa o serviço da dívida como `FundingFinancialEvent` (idempotente, chave
 *    `proposalId+eventType+scheduleVersion+installmentNumber`) que chama o MESMO port
 *    (`createExternalPayableObligation`) já usado por 9C/9D/9E — nunca uma segunda contas-a-pagar.
 *  - `FundingDisbursement` só conta como realizado quando `bankTransactionId` aponta para um
 *    `BankTransaction` real com `direction=CREDIT` e `status=RECONCILED` — mesma tesouraria do 9B.
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { createExternalPayableObligation, reverseExternalPayableObligation } from "@/application/financial-ops/external-obligation-port";
import { assertCapitalCapability } from "@/domain/capital/capabilities";
import { buildDebtServiceSchedule } from "@/domain/capital/amortization";
import type { DisbursementScheduleEntry } from "@/domain/capital/types";
import {
  registerFundingProposalSchema,
  reviseFundingProposalSchema,
  scheduleFundingDisbursementSchema,
  confirmFundingDisbursementSchema,
  evaluateFundingCovenantSchema,
  updateFundingConditionStatusSchema,
  type RegisterFundingProposalInput,
  type ReviseFundingProposalInput,
  type ScheduleFundingDisbursementInput,
  type ConfirmFundingDisbursementInput,
  type EvaluateFundingCovenantInput,
  type UpdateFundingConditionStatusInput,
} from "@/domain/capital/schemas";
import { compareFundingProposal } from "@/domain/capital/comparator-engine";
import { getBaseProjectEconomicsForProject, getCapitalNeedForProject } from "./capital-queries";

type Client = Prisma.TransactionClient | typeof prisma;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const MUTABLE_STATUSES = new Set(["DRAFT", "SUBMITTED", "UNDER_REVIEW"]);
const DEBT_SERVICE_EVENT_TYPE = "DEBT_SERVICE_INSTALLMENT_SCHEDULED";

function auditData(context: AuthContext, projectId: string | null, action: string, entityType: string, entityId: string, after?: unknown, before?: unknown) {
  return { organizationId: context.organizationId, userId: context.userId, projectId, action, entityType, entityId, before: before === undefined ? undefined : json(before), after: after === undefined ? undefined : json(after) };
}

async function projectForTenant(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  return project;
}

async function proposalForTenant(organizationId: string, proposalId: string, client: Client = prisma) {
  const proposal = await client.fundingProposal.findFirst({ where: { id: proposalId, organizationId } });
  if (!proposal) throw new Error("Proposta de funding não encontrada nesta organização.");
  return proposal;
}

function assertProposalMutable(proposal: { status: string }) {
  if (!MUTABLE_STATUSES.has(proposal.status)) throw new Error(`Proposta em status ${proposal.status} não pode ser alterada diretamente — use reviseFundingProposal para criar uma nova versão.`);
}

function addMonthsUtc(base: Date, months: number) {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, base.getUTCDate()));
}

// ---------------------------------------------------------------------------
// Proposta: registro, submissão, decisão, versionamento
// ---------------------------------------------------------------------------

async function createProposalRecord(tx: Prisma.TransactionClient, context: AuthContext, project: { id: string; companyId: string | null }, input: RegisterFundingProposalInput, extra: { version: number; previousVersionId: string | null }) {
  const parsed = registerFundingProposalSchema.parse(input);
  const annualNominalRate = new Prisma.Decimal(parsed.spreadRate).plus(parsed.indexerRateSnapshot ?? 0);
  return tx.fundingProposal.create({
    data: {
      organizationId: context.organizationId,
      projectId: project.id,
      code: parsed.code,
      version: extra.version,
      previousVersionId: extra.previousVersionId,
      providerName: parsed.providerName,
      kind: parsed.kind,
      amount: parsed.amount,
      currency: parsed.currency,
      indexer: parsed.indexer,
      spreadRate: parsed.spreadRate,
      indexerRateSnapshot: parsed.indexerRateSnapshot ?? null,
      annualNominalRate,
      termMonths: parsed.termMonths,
      graceMonths: parsed.graceMonths,
      amortizationSystem: parsed.amortizationSystem,
      paymentFrequency: parsed.paymentFrequency,
      upfrontFeeRate: parsed.upfrontFeeRate,
      recurringFeeRateAnnual: parsed.recurringFeeRateAnnual,
      iofRate: parsed.iofRate ?? null,
      disbursementSchedule: parsed.disbursementSchedule ? json(parsed.disbursementSchedule) : undefined,
      validUntil: parsed.validUntil ?? null,
      notes: parsed.notes ?? null,
      status: "DRAFT",
      createdById: context.userId,
      guarantees: { create: parsed.guarantees.map((g) => ({ type: g.type, description: g.description, amount: g.amount ?? null, beneficiary: g.beneficiary ?? null, evidenceDocumentIds: json(g.evidenceDocumentIds), createdById: context.userId })) },
      covenants: { create: parsed.covenants.map((c) => ({ code: c.code, description: c.description, metric: c.metric, thresholdOperator: c.thresholdOperator, thresholdValue: c.thresholdValue, periodicity: c.periodicity, nextTestDate: c.nextTestDate ?? null, createdById: context.userId })) },
      conditions: { create: parsed.conditions.map((c) => ({ code: c.code, category: c.category, description: c.description, dueAt: c.dueAt ?? null, responsibleId: c.responsibleId ?? null, sourceType: c.sourceType ?? null, sourceId: c.sourceId ?? null, createdById: context.userId, updatedById: context.userId })) },
    },
  });
}

export async function createFundingProposal(context: AuthContext, raw: RegisterFundingProposalInput) {
  assertCapitalCapability(context.role, "CAPITAL_PROPOSAL_MANAGE");
  const parsed = registerFundingProposalSchema.parse(raw);
  const project = await projectForTenant(context.organizationId, parsed.projectId);
  const proposal = await prisma.$transaction(async (tx) => {
    const created = await createProposalRecord(tx, context, project, raw, { version: 1, previousVersionId: null });
    await tx.auditLog.create({ data: auditData(context, project.id, "FUNDING_PROPOSAL_CREATED", "FundingProposal", created.id, { code: created.code, amount: created.amount.toString() }) });
    return created;
  });
  return proposal;
}

export async function submitFundingProposal(context: AuthContext, proposalId: string) {
  assertCapitalCapability(context.role, "CAPITAL_PROPOSAL_MANAGE");
  const proposal = await proposalForTenant(context.organizationId, proposalId);
  if (proposal.status !== "DRAFT") throw new Error("Somente uma proposta em rascunho pode ser submetida.");
  const updated = await prisma.fundingProposal.update({ where: { id: proposal.id }, data: { status: "SUBMITTED", submittedAt: new Date() } });
  await prisma.auditLog.create({ data: auditData(context, proposal.projectId, "FUNDING_PROPOSAL_SUBMITTED", "FundingProposal", proposal.id, { status: updated.status }) });
  return updated;
}

export async function moveFundingProposalToReview(context: AuthContext, proposalId: string) {
  assertCapitalCapability(context.role, "CAPITAL_PROPOSAL_MANAGE");
  const proposal = await proposalForTenant(context.organizationId, proposalId);
  if (proposal.status !== "SUBMITTED") throw new Error("Somente uma proposta submetida pode entrar em análise.");
  const updated = await prisma.fundingProposal.update({ where: { id: proposal.id }, data: { status: "UNDER_REVIEW" } });
  await prisma.auditLog.create({ data: auditData(context, proposal.projectId, "FUNDING_PROPOSAL_UNDER_REVIEW", "FundingProposal", proposal.id, { status: updated.status }) });
  return updated;
}

export async function rejectFundingProposal(context: AuthContext, proposalId: string, reason: string) {
  assertCapitalCapability(context.role, "CAPITAL_APPROVE");
  if (!reason.trim()) throw new Error("Informe o motivo da rejeição.");
  const proposal = await proposalForTenant(context.organizationId, proposalId);
  assertProposalMutable(proposal);
  const updated = await prisma.fundingProposal.update({ where: { id: proposal.id }, data: { status: "REJECTED", decidedById: context.userId, decidedAt: new Date(), rejectionReason: reason.trim() } });
  await prisma.auditLog.create({ data: auditData(context, proposal.projectId, "FUNDING_PROPOSAL_REJECTED", "FundingProposal", proposal.id, { reason: reason.trim() }) });
  return updated;
}

/**
 * Materializa o cronograma de serviço da dívida como `FundingFinancialEvent` idempotentes,
 * chamando o port compartilhado do 9B. Usada tanto na aprovação (scheduleVersion=1) quanto no
 * reschedule (scheduleVersion=N+1, ver `rescheduleFundingDebtService`).
 */
async function materializeDebtService(
  tx: Prisma.TransactionClient,
  context: AuthContext,
  proposal: { id: string; projectId: string; amount: Prisma.Decimal; annualNominalRate: Prisma.Decimal; termMonths: number; graceMonths: number; amortizationSystem: "PRICE" | "SAC" | "BULLET"; upfrontFeeRate: Prisma.Decimal; recurringFeeRateAnnual: Prisma.Decimal; iofRate: Prisma.Decimal | null; providerName: string },
  scheduleVersion: number,
  disbursementSchedule: DisbursementScheduleEntry[] | undefined,
  baseDate: Date,
) {
  const project = await tx.project.findUniqueOrThrow({ where: { id: proposal.projectId } });
  if (!project.companyId) throw new Error("Empreendimento sem empresa/SPE vinculada — não é possível gerar obrigação financeira de funding.");

  const schedule = buildDebtServiceSchedule({
    amount: proposal.amount.toString(),
    annualNominalRate: proposal.annualNominalRate.toString(),
    termMonths: proposal.termMonths,
    graceMonths: proposal.graceMonths,
    amortizationSystem: proposal.amortizationSystem,
    fees: { upfrontFeeRate: proposal.upfrontFeeRate.toString(), recurringFeeRateAnnual: proposal.recurringFeeRateAnnual.toString(), iofRate: proposal.iofRate?.toString() },
    disbursementSchedule,
  });

  const materialized: { installmentNumber: number; eventId: string }[] = [];
  for (const row of schedule) {
    const amount = new Prisma.Decimal(row.installment);
    if (amount.lte(0)) continue;
    const installmentNumber = row.month;
    const idempotencyKey = createHash("sha256").update(`funding:${proposal.id}:${DEBT_SERVICE_EVENT_TYPE}:${scheduleVersion}:${installmentNumber}`).digest("hex");
    const existing = await tx.fundingFinancialEvent.findUnique({ where: { idempotencyKey } });
    if (existing) { materialized.push({ installmentNumber, eventId: existing.id }); continue; }

    const dueDate = addMonthsUtc(baseDate, installmentNumber);
    const event = await tx.fundingFinancialEvent.create({
      data: {
        organizationId: context.organizationId,
        projectId: proposal.projectId,
        proposalId: proposal.id,
        scheduleVersion,
        installmentNumber,
        eventType: DEBT_SERVICE_EVENT_TYPE,
        idempotencyKey,
        payloadChecksum: createHash("sha256").update(JSON.stringify(row)).digest("hex"),
        payload: json(row),
        status: "PENDING",
        createdById: context.userId,
      },
    });
    const result = await createExternalPayableObligation(tx, {
      organizationId: context.organizationId,
      companyId: project.companyId,
      projectId: proposal.projectId,
      supplierId: null,
      sourceType: "FUNDING_PROPOSAL",
      sourceId: `${proposal.id}:${installmentNumber}`,
      sourceVersion: scheduleVersion,
      competenceDate: dueDate,
      dueDate,
      grossAmount: amount,
      withholdings: new Prisma.Decimal(0),
      discounts: new Prisma.Decimal(0),
      advancesApplied: new Prisma.Decimal(0),
      netAmount: amount,
      currency: "BRL",
      description: `Serviço da dívida — ${proposal.providerName} (parcela ${installmentNumber})`,
      responsibleId: context.userId,
      createdById: context.userId,
      origin: "FUNDING",
    });
    await tx.fundingFinancialEvent.update({ where: { id: event.id }, data: { status: "PROCESSED", financialObligationId: result.obligationId, payableAccountId: result.payableAccountId, processedAt: new Date() } });
    materialized.push({ installmentNumber, eventId: event.id });
  }
  return materialized;
}

export async function approveFundingProposal(context: AuthContext, proposalId: string) {
  assertCapitalCapability(context.role, "CAPITAL_APPROVE");
  const proposal = await proposalForTenant(context.organizationId, proposalId);
  assertProposalMutable(proposal);

  const base = await getBaseProjectEconomicsForProject(context, proposal.projectId);
  if (!base) throw new Error("Não há Base Aprovada (viabilidade) calculada para este empreendimento — calcule/aprove a viabilidade antes de aprovar funding.");
  const capitalNeed = await getCapitalNeedForProject(context, proposal.projectId);

  const disbursementSchedule = (proposal.disbursementSchedule as DisbursementScheduleEntry[] | null) ?? undefined;
  const comparison = compareFundingProposal(
    {
      id: proposal.id,
      providerName: proposal.providerName,
      kind: proposal.kind,
      amount: proposal.amount.toString(),
      indexer: proposal.indexer,
      annualNominalRate: proposal.annualNominalRate.toString(),
      termMonths: proposal.termMonths,
      graceMonths: proposal.graceMonths,
      amortizationSystem: proposal.amortizationSystem,
      fees: { upfrontFeeRate: proposal.upfrontFeeRate.toString(), recurringFeeRateAnnual: proposal.recurringFeeRateAnnual.toString(), iofRate: proposal.iofRate?.toString() },
      disbursementSchedule,
    },
    capitalNeed.monthlyCurve,
    base,
  );

  const decidedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.fundingProposal.update({ where: { id: proposal.id }, data: { status: "APPROVED", decidedById: context.userId, decidedAt, decisionSnapshot: json(comparison) } });

    const schedule = disbursementSchedule ?? [{ month: 0, amount: proposal.amount.toString() }];
    for (const [index, entry] of schedule.entries()) {
      await tx.fundingDisbursement.upsert({
        where: { proposalId_sequence: { proposalId: proposal.id, sequence: index + 1 } },
        update: {},
        create: { proposalId: proposal.id, sequence: index + 1, expectedDate: addMonthsUtc(decidedAt, entry.month), expectedAmount: entry.amount, status: "PLANNED", createdById: context.userId },
      });
    }

    await materializeDebtService(tx, context, updated, 1, disbursementSchedule, decidedAt);
    await tx.auditLog.create({ data: auditData(context, proposal.projectId, "FUNDING_PROPOSAL_APPROVED", "FundingProposal", proposal.id, { decisionSnapshot: comparison }) });
    return updated;
  });
}

/**
 * Regra do fechamento: `APPROVED` (ou qualquer status terminal) é imutável — uma alteração
 * relevante SEMPRE cria uma nova versão (`version+1`, `previousVersionId`), nunca sobrescreve.
 * Enquanto ainda mutável (DRAFT/SUBMITTED/UNDER_REVIEW), atualiza em linha.
 */
export async function reviseFundingProposal(context: AuthContext, proposalId: string, raw: ReviseFundingProposalInput) {
  assertCapitalCapability(context.role, "CAPITAL_PROPOSAL_MANAGE");
  const proposal = await proposalForTenant(context.organizationId, proposalId);
  const parsed = reviseFundingProposalSchema.parse(raw);
  const annualNominalRate = new Prisma.Decimal(parsed.spreadRate).plus(parsed.indexerRateSnapshot ?? 0);

  if (MUTABLE_STATUSES.has(proposal.status)) {
    const updated = await prisma.fundingProposal.update({
      where: { id: proposal.id },
      data: {
        providerName: parsed.providerName, kind: parsed.kind, amount: parsed.amount, currency: parsed.currency,
        indexer: parsed.indexer, spreadRate: parsed.spreadRate, indexerRateSnapshot: parsed.indexerRateSnapshot ?? null, annualNominalRate,
        termMonths: parsed.termMonths, graceMonths: parsed.graceMonths, amortizationSystem: parsed.amortizationSystem, paymentFrequency: parsed.paymentFrequency,
        upfrontFeeRate: parsed.upfrontFeeRate, recurringFeeRateAnnual: parsed.recurringFeeRateAnnual, iofRate: parsed.iofRate ?? null,
        disbursementSchedule: parsed.disbursementSchedule ? json(parsed.disbursementSchedule) : Prisma.JsonNull,
        validUntil: parsed.validUntil ?? null, notes: parsed.notes ?? null,
      },
    });
    await prisma.auditLog.create({ data: auditData(context, proposal.projectId, "FUNDING_PROPOSAL_UPDATED", "FundingProposal", proposal.id, parsed) });
    return updated;
  }

  const project = await projectForTenant(context.organizationId, proposal.projectId);
  const nextVersion = proposal.version + 1;
  const created = await prisma.$transaction(async (tx) => {
    const record = await createProposalRecord(tx, context, project, { ...parsed, projectId: proposal.projectId, code: proposal.code }, { version: nextVersion, previousVersionId: proposal.id });
    await tx.auditLog.create({ data: auditData(context, proposal.projectId, "FUNDING_PROPOSAL_NEW_VERSION", "FundingProposal", record.id, { previousVersionId: proposal.id, version: nextVersion }) });
    return record;
  });
  return created;
}

// ---------------------------------------------------------------------------
// Reschedule do serviço da dívida (item 4): re-deriva o cronograma com os desembolsos REAIS já
// confirmados (nunca os termos econômicos, que ficam congelados) e substitui só as parcelas ainda
// em aberto — parcelas já pagas permanecem como fato histórico da versão anterior.
// ---------------------------------------------------------------------------

export async function rescheduleFundingDebtService(context: AuthContext, proposalId: string) {
  assertCapitalCapability(context.role, "CAPITAL_APPROVE");
  const proposal = await proposalForTenant(context.organizationId, proposalId);
  if (proposal.status !== "APPROVED") throw new Error("Só é possível reagendar o serviço da dívida de uma proposta aprovada.");

  const disbursements = await prisma.fundingDisbursement.findMany({ where: { proposalId: proposal.id }, orderBy: { sequence: "asc" } });
  const decidedAt = proposal.decidedAt ?? new Date();
  const revisedSchedule: DisbursementScheduleEntry[] = disbursements.map((d) => {
    const useActual = d.status === "DISBURSED" && d.actualAmount && d.actualDate;
    const amount = useActual ? d.actualAmount!.toString() : d.expectedAmount.toString();
    const referenceDate = useActual ? d.actualDate! : d.expectedDate;
    const month = Math.max(0, Math.round((referenceDate.getTime() - decidedAt.getTime()) / (30 * 86_400_000)));
    return { month, amount };
  });

  const existingEvents = await prisma.fundingFinancialEvent.findMany({ where: { proposalId: proposal.id, eventType: DEBT_SERVICE_EVENT_TYPE, status: "PROCESSED" } });
  const currentVersion = existingEvents.reduce((max, event) => Math.max(max, event.scheduleVersion), 1);
  const newVersion = currentVersion + 1;

  return prisma.$transaction(async (tx) => {
    const carriedForwardAsPaid: number[] = [];
    const reversed: number[] = [];
    for (const event of existingEvents.filter((e) => e.scheduleVersion === currentVersion)) {
      if (!event.financialObligationId) continue;
      try {
        await reverseExternalPayableObligation(tx, { organizationId: context.organizationId, obligationId: event.financialObligationId, reason: `Reagendamento do serviço da dívida — proposta ${proposal.code}, nova versão de cronograma ${newVersion}.` });
        await tx.fundingFinancialEvent.update({ where: { id: event.id }, data: { status: "REVERSED", reversedAt: new Date() } });
        reversed.push(event.installmentNumber);
      } catch {
        // Parcela já paga (`hasEffectivePayment` no port) — fica como fato histórico da versão anterior, nunca revertida.
        carriedForwardAsPaid.push(event.installmentNumber);
      }
    }

    const proposalForSchedule = { ...proposal, providerName: proposal.providerName };
    const materialized = await materializeDebtServiceSkipping(tx, context, proposalForSchedule, newVersion, revisedSchedule, decidedAt, new Set(carriedForwardAsPaid));

    await tx.auditLog.create({ data: auditData(context, proposal.projectId, "FUNDING_DEBT_SERVICE_RESCHEDULED", "FundingProposal", proposal.id, { newVersion, reversed, carriedForwardAsPaid, materialized: materialized.length }) });
    return { scheduleVersion: newVersion, reversedInstallments: reversed, keptAsPaid: carriedForwardAsPaid, materializedInstallments: materialized.map((m) => m.installmentNumber) };
  });
}

/** Mesma lógica de `materializeDebtService`, mas pula os `installmentNumber` já pagos (mantidos na versão anterior). */
async function materializeDebtServiceSkipping(
  tx: Prisma.TransactionClient,
  context: AuthContext,
  proposal: Parameters<typeof materializeDebtService>[2],
  scheduleVersion: number,
  disbursementSchedule: DisbursementScheduleEntry[] | undefined,
  baseDate: Date,
  skip: Set<number>,
) {
  if (skip.size === 0) return materializeDebtService(tx, context, proposal, scheduleVersion, disbursementSchedule, baseDate);
  const schedule = buildDebtServiceSchedule({
    amount: proposal.amount.toString(), annualNominalRate: proposal.annualNominalRate.toString(), termMonths: proposal.termMonths, graceMonths: proposal.graceMonths,
    amortizationSystem: proposal.amortizationSystem, fees: { upfrontFeeRate: proposal.upfrontFeeRate.toString(), recurringFeeRateAnnual: proposal.recurringFeeRateAnnual.toString(), iofRate: proposal.iofRate?.toString() }, disbursementSchedule,
  });
  const filteredSchedule = schedule.filter((row) => !skip.has(row.month));
  const project = await tx.project.findUniqueOrThrow({ where: { id: proposal.projectId } });
  if (!project.companyId) throw new Error("Empreendimento sem empresa/SPE vinculada — não é possível gerar obrigação financeira de funding.");
  const materialized: { installmentNumber: number; eventId: string }[] = [];
  for (const row of filteredSchedule) {
    const amount = new Prisma.Decimal(row.installment);
    if (amount.lte(0)) continue;
    const installmentNumber = row.month;
    const idempotencyKey = createHash("sha256").update(`funding:${proposal.id}:${DEBT_SERVICE_EVENT_TYPE}:${scheduleVersion}:${installmentNumber}`).digest("hex");
    const existing = await tx.fundingFinancialEvent.findUnique({ where: { idempotencyKey } });
    if (existing) { materialized.push({ installmentNumber, eventId: existing.id }); continue; }
    const dueDate = addMonthsUtc(baseDate, installmentNumber);
    const event = await tx.fundingFinancialEvent.create({ data: { organizationId: context.organizationId, projectId: proposal.projectId, proposalId: proposal.id, scheduleVersion, installmentNumber, eventType: DEBT_SERVICE_EVENT_TYPE, idempotencyKey, payloadChecksum: createHash("sha256").update(JSON.stringify(row)).digest("hex"), payload: json(row), status: "PENDING", createdById: context.userId } });
    const result = await createExternalPayableObligation(tx, { organizationId: context.organizationId, companyId: project.companyId, projectId: proposal.projectId, supplierId: null, sourceType: "FUNDING_PROPOSAL", sourceId: `${proposal.id}:${installmentNumber}`, sourceVersion: scheduleVersion, competenceDate: dueDate, dueDate, grossAmount: amount, withholdings: new Prisma.Decimal(0), discounts: new Prisma.Decimal(0), advancesApplied: new Prisma.Decimal(0), netAmount: amount, currency: "BRL", description: `Serviço da dívida — ${proposal.providerName} (parcela ${installmentNumber}, reagendada)`, responsibleId: context.userId, createdById: context.userId, origin: "FUNDING" });
    await tx.fundingFinancialEvent.update({ where: { id: event.id }, data: { status: "PROCESSED", financialObligationId: result.obligationId, payableAccountId: result.payableAccountId, processedAt: new Date() } });
    materialized.push({ installmentNumber, eventId: event.id });
  }
  return materialized;
}

// ---------------------------------------------------------------------------
// Desembolso: só DISBURSED + BankTransaction CREDIT/RECONCILED conta como realizado
// ---------------------------------------------------------------------------

export async function scheduleFundingDisbursement(context: AuthContext, raw: ScheduleFundingDisbursementInput) {
  assertCapitalCapability(context.role, "CAPITAL_PROPOSAL_MANAGE");
  const input = scheduleFundingDisbursementSchema.parse(raw);
  const proposal = await proposalForTenant(context.organizationId, input.proposalId);
  const created = await prisma.fundingDisbursement.create({ data: { proposalId: proposal.id, sequence: input.sequence, expectedDate: input.expectedDate, expectedAmount: input.expectedAmount, status: "PLANNED", createdById: context.userId } });
  await prisma.auditLog.create({ data: auditData(context, proposal.projectId, "FUNDING_DISBURSEMENT_SCHEDULED", "FundingDisbursement", created.id, { sequence: created.sequence, expectedAmount: created.expectedAmount.toString() }) });
  return created;
}

export async function requestFundingDisbursement(context: AuthContext, disbursementId: string) {
  assertCapitalCapability(context.role, "CAPITAL_PROPOSAL_MANAGE");
  const disbursement = await prisma.fundingDisbursement.findFirst({ where: { id: disbursementId, proposal: { organizationId: context.organizationId } }, include: { proposal: true } });
  if (!disbursement || disbursement.status !== "PLANNED") throw new Error("Só um desembolso planejado pode ser solicitado.");
  const updated = await prisma.fundingDisbursement.update({ where: { id: disbursement.id }, data: { status: "REQUESTED", requestedAt: new Date() } });
  await prisma.auditLog.create({ data: auditData(context, disbursement.proposal.projectId, "FUNDING_DISBURSEMENT_REQUESTED", "FundingDisbursement", disbursement.id, { status: updated.status }) });
  return updated;
}

export async function approveFundingDisbursementRelease(context: AuthContext, disbursementId: string) {
  assertCapitalCapability(context.role, "CAPITAL_APPROVE");
  const disbursement = await prisma.fundingDisbursement.findFirst({ where: { id: disbursementId, proposal: { organizationId: context.organizationId } }, include: { proposal: true } });
  if (!disbursement || disbursement.status !== "REQUESTED") throw new Error("Só um desembolso solicitado pode ser aprovado para liberação.");
  const updated = await prisma.fundingDisbursement.update({ where: { id: disbursement.id }, data: { status: "APPROVED", approvedAt: new Date() } });
  await prisma.auditLog.create({ data: auditData(context, disbursement.proposal.projectId, "FUNDING_DISBURSEMENT_APPROVED", "FundingDisbursement", disbursement.id, { status: updated.status }) });
  return updated;
}

/**
 * ÚNICA forma de um desembolso virar `DISBURSED`: vinculando um `BankTransaction` real,
 * `direction=CREDIT`, `status=RECONCILED`, ainda não usado por outro desembolso (`@@unique`
 * garante isso no banco). `actualAmount`/`actualDate` são copiados da transação — nunca digitados.
 */
export async function confirmFundingDisbursement(context: AuthContext, raw: ConfirmFundingDisbursementInput) {
  assertCapitalCapability(context.role, "CAPITAL_APPROVE");
  const input = confirmFundingDisbursementSchema.parse(raw);
  const disbursement = await prisma.fundingDisbursement.findFirst({ where: { id: input.disbursementId, proposal: { organizationId: context.organizationId } }, include: { proposal: true } });
  if (!disbursement) throw new Error("Desembolso não encontrado nesta organização.");
  if (!(["APPROVED", "REQUESTED"] as const).includes(disbursement.status as "APPROVED" | "REQUESTED")) throw new Error("Só um desembolso aprovado (ou solicitado) pode ser confirmado.");

  const transaction = await prisma.bankTransaction.findFirst({ where: { id: input.bankTransactionId, organizationId: context.organizationId } });
  if (!transaction) throw new Error("Transação bancária não encontrada nesta organização.");
  if (transaction.direction !== "CREDIT") throw new Error("O desembolso só pode ser confirmado por uma transação de CRÉDITO (entrada de caixa).");
  if (transaction.status !== "RECONCILED") throw new Error("A transação bancária precisa estar CONCILIADA antes de confirmar o desembolso.");

  const updated = await prisma.fundingDisbursement.update({
    where: { id: disbursement.id },
    data: { status: "DISBURSED", bankTransactionId: transaction.id, actualDate: transaction.occurredAt, actualAmount: transaction.amount },
  });
  await prisma.auditLog.create({ data: auditData(context, disbursement.proposal.projectId, "FUNDING_DISBURSEMENT_CONFIRMED", "FundingDisbursement", disbursement.id, { bankTransactionId: transaction.id, actualAmount: transaction.amount.toString() }) });
  return updated;
}

// ---------------------------------------------------------------------------
// Covenants: avaliação append-only (nunca sobrescreve histórico)
// ---------------------------------------------------------------------------

export async function evaluateFundingCovenant(context: AuthContext, raw: EvaluateFundingCovenantInput) {
  assertCapitalCapability(context.role, "CAPITAL_COVENANT_MANAGE");
  const input = evaluateFundingCovenantSchema.parse(raw);
  const covenant = await prisma.fundingCovenant.findFirst({ where: { id: input.covenantId, proposal: { organizationId: context.organizationId } }, include: { proposal: true } });
  if (!covenant) throw new Error("Covenant não encontrado nesta organização.");

  return prisma.$transaction(async (tx) => {
    const evaluation = await tx.fundingCovenantEvaluation.create({ data: { covenantId: covenant.id, testedAt: input.testedAt, observedValue: input.observedValue, result: input.result, evidence: input.evidence ? json(input.evidence) : undefined, testedById: context.userId } });
    const updated = await tx.fundingCovenant.update({ where: { id: covenant.id }, data: { status: input.result, lastCheckedAt: input.testedAt, lastValue: input.observedValue } });
    await tx.auditLog.create({ data: auditData(context, covenant.proposal.projectId, "FUNDING_COVENANT_EVALUATED", "FundingCovenant", covenant.id, { result: input.result, observedValue: input.observedValue }) });
    return { covenant: updated, evaluation };
  });
}

// ---------------------------------------------------------------------------
// Condições precedentes
// ---------------------------------------------------------------------------

export async function updateFundingConditionStatus(context: AuthContext, raw: UpdateFundingConditionStatusInput) {
  assertCapitalCapability(context.role, "CAPITAL_CONDITION_MANAGE");
  const input = updateFundingConditionStatusSchema.parse(raw);
  const condition = await prisma.fundingCondition.findFirst({ where: { id: input.conditionId, proposal: { organizationId: context.organizationId } }, include: { proposal: true } });
  if (!condition) throw new Error("Condição precedente não encontrada nesta organização.");
  const updated = await prisma.fundingCondition.update({
    where: { id: condition.id },
    data: { status: input.status, evidence: input.evidence ? json(input.evidence) : undefined, satisfiedAt: input.status === "SATISFIED" ? new Date() : condition.satisfiedAt, updatedById: context.userId },
  });
  await prisma.auditLog.create({ data: auditData(context, condition.proposal.projectId, "FUNDING_CONDITION_UPDATED", "FundingCondition", condition.id, { status: input.status }) });
  return updated;
}
