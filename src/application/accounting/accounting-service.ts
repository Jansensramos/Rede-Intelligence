import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import {
  assertAccountingCapability,
  assertBalancedEntry,
  assertEventReplay,
  assertPeriodAllowsPosting,
  calculateReconciliation,
  calculateTrialBalance,
  hasAccountingCapability,
  reversePostingLines,
  selectAccountingMapping,
  type AccountingCapability,
  type PostingLine,
} from "@/domain/accounting";

type AccountingContext = Pick<AuthContext, "organizationId" | "userId" | "role">;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const checksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const monthStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

function requireCapability(context: Pick<AccountingContext, "role">, capability: AccountingCapability) {
  assertAccountingCapability(context.role, capability);
}

async function assertTenantScope(context: Pick<AccountingContext, "organizationId">, companyId: string, projectId?: string | null) {
  const [company, project] = await Promise.all([
    prisma.company.findFirst({ where: { id: companyId, organizationId: context.organizationId } }),
    projectId ? prisma.project.findFirst({ where: { id: projectId, organizationId: context.organizationId } }) : null,
  ]);
  if (!company) throw new Error("Empresa não encontrada nesta organização.");
  if (projectId && !project) throw new Error("Empreendimento não encontrado nesta organização.");
  return { company, project };
}

const audit = (context: AccountingContext, projectId: string | null, action: string, entityType: string, entityId: string, before?: unknown, after?: unknown) => ({
  organizationId: context.organizationId,
  userId: context.userId,
  projectId,
  action,
  entityType,
  entityId,
  before: before === undefined ? undefined : json(before),
  after: after === undefined ? undefined : json(after),
});

export async function ingestAccountingEvent(context: AccountingContext, input: {
  companyId: string;
  projectId?: string | null;
  costCenterId?: string | null;
  economicItemId?: string | null;
  sourceModule: string;
  sourceType: string;
  sourceId: string;
  sourceVersion: string;
  economicIdentityKey: string;
  eventType: string;
  eventVersion?: number;
  occurredAt: Date;
  competenceDate: Date;
  documentIssuedAt?: Date | null;
  dueAt?: Date | null;
  settledAt?: Date | null;
  grossAmount: Prisma.Decimal.Value;
  withholdingAmount?: Prisma.Decimal.Value;
  discountAmount?: Prisma.Decimal.Value;
  netAmount: Prisma.Decimal.Value;
  payload: unknown;
  provenance: unknown;
}) {
  requireCapability(context, "ACCOUNTING_CLASSIFY");
  await assertTenantScope(context, input.companyId, input.projectId);
  const eventVersion = input.eventVersion ?? 1;
  const idempotencyKey = `${input.sourceModule}:${input.sourceType}:${input.sourceId}:${input.sourceVersion}:${input.eventType}:${eventVersion}`;
  const payloadChecksum = checksum(input.payload);
  const existing = await prisma.accountingEvent.findUnique({ where: { organizationId_idempotencyKey: { organizationId: context.organizationId, idempotencyKey } } });
  if (assertEventReplay(existing ? { payloadChecksum: existing.payloadChecksum, eventVersion: existing.eventVersion } : null, { payloadChecksum, eventVersion }) === "REPLAY") return existing!;
  const date = input.competenceDate;
  const candidates = await prisma.accountingMappingRule.findMany({
    where: {
      organizationId: context.organizationId,
      sourceModule: input.sourceModule,
      sourceType: input.sourceType,
      eventType: input.eventType,
      status: "ACTIVE",
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    },
  });
  const selected = selectAccountingMapping(candidates.filter((item) => (!item.companyId || item.companyId === input.companyId) && (!item.projectId || item.projectId === input.projectId)).map((item) => ({ id: item.id, priority: item.priority, specificity: Number(Boolean(item.companyId)) + Number(Boolean(item.projectId)), effectiveFrom: item.effectiveFrom, effectiveTo: item.effectiveTo })), date);
  const mapping = selected ? candidates.find((item) => item.id === selected.id)! : null;
  const period = await prisma.accountingPeriod.findUnique({ where: { organizationId_companyId_referenceMonth: { organizationId: context.organizationId, companyId: input.companyId, referenceMonth: monthStart(input.competenceDate) } } });
  const event = await prisma.accountingEvent.create({ data: {
    organizationId: context.organizationId,
    companyId: input.companyId,
    projectId: input.projectId ?? null,
    costCenterId: input.costCenterId ?? null,
    economicItemId: input.economicItemId ?? null,
    periodId: period?.id ?? null,
    policyId: mapping?.policyId ?? null,
    mappingRuleId: mapping?.id ?? null,
    sourceModule: input.sourceModule,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceVersion: input.sourceVersion,
    economicIdentityKey: input.economicIdentityKey,
    eventType: input.eventType,
    eventVersion,
    idempotencyKey,
    payloadChecksum,
    occurredAt: input.occurredAt,
    competenceDate: input.competenceDate,
    documentIssuedAt: input.documentIssuedAt ?? null,
    dueAt: input.dueAt ?? null,
    settledAt: input.settledAt ?? null,
    grossAmount: input.grossAmount,
    withholdingAmount: input.withholdingAmount ?? 0,
    discountAmount: input.discountAmount ?? 0,
    netAmount: input.netAmount,
    status: mapping ? "CLASSIFIED" : "PENDING_MAPPING",
    provenance: json(input.provenance),
    normalizedPayload: json(input.payload),
    classificationError: mapping ? null : "Nenhuma regra de mapeamento vigente foi encontrada.",
    createdById: context.userId,
  } });
  await prisma.auditLog.create({ data: audit(context, event.projectId, "ACCOUNTING_EVENT_INGESTED", "AccountingEvent", event.id, undefined, { sourceModule: event.sourceModule, sourceType: event.sourceType, sourceId: event.sourceId, status: event.status, policyId: event.policyId, mappingRuleId: event.mappingRuleId }) });
  return event;
}

export async function postAccountingEvent(context: AccountingContext, eventId: string, input?: { description?: string; accountingDate?: Date; reviewerId?: string | null }) {
  requireCapability(context, "ACCOUNTING_ENTRY_POST");
  const event = await prisma.accountingEvent.findFirst({ where: { id: eventId, organizationId: context.organizationId }, include: { mappingRule: true, period: true } });
  if (!event) throw new Error("Evento contábil não encontrado nesta organização.");
  if (event.status === "POSTED") return prisma.accountingEntry.findFirstOrThrow({ where: { eventId: event.id, bookType: "STATUTORY" }, include: { lines: true } });
  if (!event.mappingRule || !event.period || event.status !== "CLASSIFIED") throw new Error("O evento precisa estar classificado e associado a um período.");
  const accountingDate = input?.accountingDate ?? event.competenceDate;
  assertPeriodAllowsPosting(event.period.status, accountingDate, event.period.referenceMonth);
  if (event.grossAmount.abs().gte(100000) && (!input?.reviewerId || input.reviewerId === context.userId)) throw new Error("Lançamento material exige revisão segregada antes da contabilização.");
  const lines: PostingLine[] = [
    { accountId: event.mappingRule.debitAccountId, side: "DEBIT", amount: event.netAmount, history: input?.description },
    { accountId: event.mappingRule.creditAccountId, side: "CREDIT", amount: event.netAmount, history: input?.description },
  ];
  const totals = assertBalancedEntry(lines);
  const entryChecksum = checksum({ eventId: event.id, accountingDate: accountingDate.toISOString(), lines: lines.map((line) => ({ ...line, amount: line.amount.toString() })) });
  const entry = await prisma.$transaction(async (tx) => {
    const sequence = await tx.accountingEntry.count({ where: { organizationId: context.organizationId, companyId: event.companyId, periodId: event.periodId! } });
    const created = await tx.accountingEntry.create({ data: {
      organizationId: context.organizationId,
      companyId: event.companyId,
      projectId: event.projectId,
      periodId: event.periodId!,
      eventId: event.id,
      policyId: event.policyId,
      entryNumber: `${event.period!.referenceMonth.toISOString().slice(0, 7).replace("-", "")}-${String(sequence + 1).padStart(6, "0")}`,
      accountingDate,
      competenceDate: event.competenceDate,
      description: input?.description ?? event.mappingRule!.historyTemplate,
      status: "POSTED",
      totalDebit: totals.debit,
      totalCredit: totals.credit,
      checksum: entryChecksum,
      postedById: context.userId,
      postedAt: new Date(),
      createdById: event.createdById,
      lines: { create: lines.map((line, index) => ({ accountId: line.accountId, sequence: index + 1, side: line.side, amount: line.amount.toString(), history: line.history ?? event.mappingRule!.historyTemplate, projectId: event.projectId, costCenterId: event.costCenterId, economicItemId: event.economicItemId })) },
    }, include: { lines: true } });
    await tx.accountingEvent.update({ where: { id: event.id }, data: { status: "POSTED", proposedAccountingDate: accountingDate } });
    await tx.auditLog.create({ data: audit(context, event.projectId, "ACCOUNTING_ENTRY_POSTED", "AccountingEntry", created.id, undefined, { eventId: event.id, totalDebit: totals.debit, totalCredit: totals.credit, reviewerId: input?.reviewerId }) });
    return created;
  });
  return entry;
}

export async function reverseAccountingEntry(context: AccountingContext, entryId: string, input: { periodId: string; reason: string; approvedById: string }) {
  requireCapability(context, "ACCOUNTING_REVERSE");
  const [original, period] = await Promise.all([
    prisma.accountingEntry.findFirst({ where: { id: entryId, organizationId: context.organizationId, status: "POSTED" }, include: { lines: true } }),
    prisma.accountingPeriod.findFirst({ where: { id: input.periodId, organizationId: context.organizationId } }),
  ]);
  if (!original || !period) throw new Error("Lançamento ou período de estorno não encontrado nesta organização.");
  if (input.approvedById === context.userId) throw new Error("O estorno exige aprovação segregada.");
  assertPeriodAllowsPosting(period.status, period.referenceMonth, period.referenceMonth);
  const reversed = reversePostingLines(original.lines.map((line) => ({ accountId: line.accountId, side: line.side, amount: line.amount, history: `Estorno: ${input.reason}` })));
  const total = assertBalancedEntry(reversed);
  return prisma.$transaction(async (tx) => {
    const count = await tx.accountingEntry.count({ where: { organizationId: context.organizationId, companyId: original.companyId, periodId: period.id } });
    const reversalEntry = await tx.accountingEntry.create({ data: { organizationId: context.organizationId, companyId: original.companyId, projectId: original.projectId, periodId: period.id, policyId: original.policyId, bookType: original.bookType, entryNumber: `${period.referenceMonth.toISOString().slice(0, 7).replace("-", "")}-${String(count + 1).padStart(6, "0")}`, accountingDate: period.referenceMonth, competenceDate: original.competenceDate, description: `Estorno de ${original.entryNumber}: ${input.reason}`, status: "POSTED", totalDebit: total.debit, totalCredit: total.credit, checksum: checksum({ originalId: original.id, lines: reversed }), postedById: context.userId, postedAt: new Date(), createdById: context.userId, lines: { create: reversed.map((line, index) => ({ accountId: line.accountId, sequence: index + 1, side: line.side, amount: line.amount.toString(), history: line.history ?? input.reason, projectId: original.projectId })) } }, include: { lines: true } });
    await tx.accountingReversal.create({ data: { organizationId: context.organizationId, originalEntryId: original.id, reversalEntryId: reversalEntry.id, reason: input.reason, approvedById: input.approvedById, createdById: context.userId } });
    await tx.accountingEntry.update({ where: { id: original.id }, data: { status: "REVERSED" } });
    if (original.eventId) await tx.accountingEvent.update({ where: { id: original.eventId }, data: { status: "REVERSED" } });
    await tx.auditLog.create({ data: audit(context, original.projectId, "ACCOUNTING_ENTRY_REVERSED", "AccountingEntry", original.id, { status: original.status }, { status: "REVERSED", reversalEntryId: reversalEntry.id, approvedById: input.approvedById }) });
    return reversalEntry;
  });
}

async function buildPeriodBalances(periodId: string) {
  const lines = await prisma.accountingEntryLine.findMany({ where: { entry: { periodId, status: { in: ["POSTED", "REVERSED"] } } }, include: { account: true } });
  const grouped = new Map<string, { accountId: string; code: string; name: string; category: string; normalBalance: "DEBIT" | "CREDIT"; openingBalance: string; debit: Prisma.Decimal; credit: Prisma.Decimal }>();
  for (const line of lines) {
    const row = grouped.get(line.accountId) ?? { accountId: line.accountId, code: line.account.code, name: line.account.name, category: line.account.category, normalBalance: line.account.normalBalance, openingBalance: "0", debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
    if (line.side === "DEBIT") row.debit = row.debit.plus(line.amount); else row.credit = row.credit.plus(line.amount);
    grouped.set(line.accountId, row);
  }
  return calculateTrialBalance([...grouped.values()]);
}

export async function closeAccountingPeriod(context: AccountingContext, periodId: string, checklist: Record<string, boolean>) {
  requireCapability(context, "ACCOUNTING_CLOSE");
  const period = await prisma.accountingPeriod.findFirst({ where: { id: periodId, organizationId: context.organizationId } });
  if (!period || !["OPEN", "UNDER_REVIEW", "REOPENED", "ADJUSTMENT"].includes(period.status)) throw new Error("Período contábil indisponível para fechamento.");
  const [pendingEvents, materialDivergences, balances] = await Promise.all([
    prisma.accountingEvent.count({ where: { organizationId: context.organizationId, companyId: period.companyId, competenceDate: { gte: period.referenceMonth, lt: new Date(Date.UTC(period.referenceMonth.getUTCFullYear(), period.referenceMonth.getUTCMonth() + 1, 1)) }, status: "PENDING_MAPPING" } }),
    prisma.accountingReconciliation.count({ where: { periodId: period.id, material: true, status: "DIVERGENT" } }),
    buildPeriodBalances(period.id),
  ]);
  if (pendingEvents || materialDivergences) throw new Error(`Fechamento bloqueado: ${pendingEvents} evento(s) sem classificação e ${materialDivergences} divergência(s) material(is).`);
  const required = ["financial", "apAr", "measurements", "provisions", "tax", "intercompany", "inventory", "trialBalance"];
  const missing = required.filter((item) => !checklist[item]);
  if (missing.length) throw new Error(`Checklist de fechamento incompleto: ${missing.join(", ")}.`);
  const totalDebit = balances.reduce((sum, row) => sum.plus(row.debit), new Prisma.Decimal(0));
  const totalCredit = balances.reduce((sum, row) => sum.plus(row.credit), new Prisma.Decimal(0));
  if (!totalDebit.eq(totalCredit)) throw new Error("O balancete do período não fecha débitos e créditos.");
  const closeChecksum = checksum({ periodId, balances, checklist });
  return prisma.$transaction(async (tx) => {
    await tx.ledgerSnapshot.upsert({ where: { periodId_snapshotType: { periodId, snapshotType: "CLOSING_TRIAL_BALANCE" } }, update: { balances: json(balances), totalDebit, totalCredit, checksum: closeChecksum, createdById: context.userId }, create: { organizationId: context.organizationId, companyId: period.companyId, periodId, snapshotType: "CLOSING_TRIAL_BALANCE", balances: json(balances), totalDebit, totalCredit, checksum: closeChecksum, createdById: context.userId } });
    const closed = await tx.accountingPeriod.update({ where: { id: period.id }, data: { status: "CLOSED", checklistSnapshot: json(checklist), closeChecksum, closedById: context.userId, closedAt: new Date(), updatedById: context.userId } });
    await tx.auditLog.create({ data: audit(context, null, "ACCOUNTING_PERIOD_CLOSED", "AccountingPeriod", period.id, { status: period.status }, { status: closed.status, closeChecksum }) });
    return closed;
  });
}

export async function reopenAccountingPeriod(context: AccountingContext, periodId: string, reason: string, authorizedById: string) {
  requireCapability(context, "ACCOUNTING_REOPEN");
  const period = await prisma.accountingPeriod.findFirst({ where: { id: periodId, organizationId: context.organizationId, status: "CLOSED" } });
  if (!period) throw new Error("Período fechado não encontrado nesta organização.");
  if (!reason.trim() || authorizedById === context.userId || authorizedById === period.closedById) throw new Error("Reabertura exige motivo e autorização segregada.");
  const reopened = await prisma.accountingPeriod.update({ where: { id: period.id }, data: { status: "REOPENED", reopenedById: authorizedById, reopenedAt: new Date(), reopeningReason: reason.trim(), updatedById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, null, "ACCOUNTING_PERIOD_REOPENED", "AccountingPeriod", period.id, { status: period.status }, { status: reopened.status, authorizedById, reason }) });
  return reopened;
}

export async function createAccountingReconciliation(context: AccountingContext, input: { periodId: string; projectId?: string | null; type: string; sourceType: string; sourceId: string; sourceAmount: Prisma.Decimal.Value; ledgerAmount: Prisma.Decimal.Value; materiality: Prisma.Decimal.Value; evidence: unknown }) {
  requireCapability(context, "ACCOUNTING_ENTRY_REVIEW");
  const period = await prisma.accountingPeriod.findFirst({ where: { id: input.periodId, organizationId: context.organizationId } });
  if (!period) throw new Error("Período contábil não encontrado nesta organização.");
  const result = calculateReconciliation(input.sourceAmount, input.ledgerAmount, input.materiality);
  const existing = await prisma.accountingReconciliation.findFirst({ where: { periodId: period.id, reconciliationType: input.type, projectId: input.projectId ?? null } });
  if (existing) return prisma.accountingReconciliation.update({ where: { id: existing.id }, data: { status: result.status, sourceAmount: result.source, ledgerAmount: result.ledger, differenceAmount: result.difference, material: result.material, evidence: json(input.evidence), items: { deleteMany: {}, create: [{ sourceType: input.sourceType, sourceId: input.sourceId, sourceAmount: result.source, ledgerAmount: result.ledger, differenceAmount: result.difference }] } }, include: { items: true } });
  return prisma.accountingReconciliation.create({ data: { organizationId: context.organizationId, companyId: period.companyId, projectId: input.projectId ?? null, periodId: period.id, reconciliationType: input.type, status: result.status, sourceAmount: result.source, ledgerAmount: result.ledger, differenceAmount: result.difference, material: result.material, evidence: json(input.evidence), createdById: context.userId, items: { create: [{ sourceType: input.sourceType, sourceId: input.sourceId, sourceAmount: result.source, ledgerAmount: result.ledger, differenceAmount: result.difference }] } }, include: { items: true } });
}

export async function getAccountingWorkspace(context: Pick<AccountingContext, "organizationId" | "role">, projectId: string) {
  requireCapability(context, "ACCOUNTING_VIEW");
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: context.organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  const [charts, periods, events, entries, pools, allocationRuns, revenueRuns, regimes, assessments, reconciliations, consolidationRuns, budget, contracts, measurements, payables] = await Promise.all([
    prisma.chartOfAccounts.findMany({ where: { organizationId: context.organizationId }, include: { versions: { include: { accounts: true, assignments: true }, orderBy: { version: "desc" } } }, take: 20 }),
    prisma.accountingPeriod.findMany({ where: { organizationId: context.organizationId }, include: { snapshots: true }, orderBy: { referenceMonth: "desc" }, take: 60 }),
    prisma.accountingEvent.findMany({ where: { organizationId: context.organizationId, OR: [{ projectId }, { projectId: null }] }, orderBy: { occurredAt: "desc" }, take: 100 }),
    prisma.accountingEntry.findMany({ where: { organizationId: context.organizationId, OR: [{ projectId }, { projectId: null }] }, include: { lines: { include: { account: true } }, event: true, period: true }, orderBy: [{ accountingDate: "desc" }, { entryNumber: "desc" }], take: 200 }),
    prisma.inventoryCostPool.findMany({ where: { organizationId: context.organizationId, projectId }, include: { movements: true }, orderBy: { code: "asc" } }),
    prisma.unitCostAllocationRun.findMany({ where: { organizationId: context.organizationId, projectId }, include: { lines: true, pool: true }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.revenueRecognitionRun.findMany({ where: { organizationId: context.organizationId, projectId }, include: { lines: true }, orderBy: { cutoffDate: "desc" }, take: 30 }),
    prisma.taxRegimeAssignment.findMany({ where: { organizationId: context.organizationId, OR: [{ projectId }, { projectId: null }] }, include: { policies: true }, orderBy: { effectiveFrom: "desc" }, take: 30 }),
    prisma.taxAssessment.findMany({ where: { organizationId: context.organizationId, OR: [{ projectId }, { projectId: null }] }, include: { lines: true, obligation: true }, orderBy: { referenceMonth: "desc" }, take: 50 }),
    prisma.accountingReconciliation.findMany({ where: { organizationId: context.organizationId, OR: [{ projectId }, { projectId: null }] }, include: { items: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.consolidationRun.findMany({ where: { organizationId: context.organizationId }, include: { packages: true, eliminations: true }, orderBy: { referenceMonth: "desc" }, take: 30 }),
    prisma.budget.findFirst({ where: { organizationId: context.organizationId, projectId, status: { in: ["OFFICIAL", "APPROVED"] } }, orderBy: { version: "desc" } }),
    prisma.operationalContract.findMany({ where: { organizationId: context.organizationId, projectId, status: "ACTIVE" } }),
    prisma.measurementCertificate.findMany({ where: { organizationId: context.organizationId, projectId, status: { in: ["APPROVED", "SENT_TO_FINANCE"] } } }),
    prisma.payableAccount.findMany({ where: { organizationId: context.organizationId, projectId }, include: { installments: { include: { payments: true } } } }),
  ]);
  const posted = entries.filter((entry) => ["POSTED", "REVERSED"].includes(entry.status));
  const accounted = posted.reduce((sum, entry) => sum + Number(entry.totalDebit), 0);
  const paid = payables.flatMap((account) => account.installments).flatMap((installment) => installment.payments).reduce((sum, payment) => sum + Number(payment.amount), 0);
  const recognizedRevenue = revenueRuns[0] ? Number(revenueRuns[0].recognizedRevenue) : 0;
  const recognizedCost = revenueRuns[0] ? Number(revenueRuns[0].recognizedCost) : accounted;
  const inventory = pools.reduce((sum, pool) => sum + Number(pool.totalAmount), 0);
  const taxesDue = assessments.filter((item) => !["CLOSED"].includes(item.status)).reduce((sum, item) => sum + Number(item.assessedAmount), 0);
  return {
    projectId,
    generatedAt: new Date().toISOString(),
    permissions: { canPost: hasAccountingCapability(context.role, "ACCOUNTING_ENTRY_POST"), canClose: hasAccountingCapability(context.role, "ACCOUNTING_CLOSE"), canManageTax: hasAccountingCapability(context.role, "TAX_MANAGE"), canConsolidate: hasAccountingCapability(context.role, "CONSOLIDATION_MANAGE") },
    summary: { recognizedRevenue, managerialRevenue: recognizedRevenue, accountedCost: recognizedCost, grossMargin: recognizedRevenue - recognizedCost, operatingResult: recognizedRevenue - recognizedCost, inventory, taxesDue, provisions: await prisma.accountingProvision.count({ where: { organizationId: context.organizationId, OR: [{ projectId }, { projectId: null }], status: "ACTIVE" } }), openPeriods: periods.filter((item) => item.status !== "CLOSED").length, divergences: reconciliations.filter((item) => item.status === "DIVERGENT").length, unclassifiedEvents: events.filter((item) => item.status === "PENDING_MAPPING").length },
    chart: charts.flatMap((chart) => chart.versions.map((version) => ({ id: version.id, chart: chart.name, version: version.version, status: version.status, accounts: version.accounts.map((account) => ({ id: account.id, code: account.code, name: account.name, category: account.category, normalBalance: account.normalBalance, posting: account.isPosting })) }))),
    periods: periods.map((period) => ({ id: period.id, companyId: period.companyId, referenceMonth: period.referenceMonth.toISOString(), status: period.status, closedAt: period.closedAt?.toISOString() ?? null, snapshot: period.snapshots.length > 0 })),
    events: events.map((event) => ({ id: event.id, sourceModule: event.sourceModule, sourceType: event.sourceType, sourceId: event.sourceId, eventType: event.eventType, status: event.status, competenceDate: event.competenceDate.toISOString(), grossAmount: Number(event.grossAmount), netAmount: Number(event.netAmount), economicIdentityKey: event.economicIdentityKey })),
    entries: entries.map((entry) => ({ id: entry.id, entryNumber: entry.entryNumber, description: entry.description, accountingDate: entry.accountingDate.toISOString(), competenceDate: entry.competenceDate.toISOString(), status: entry.status, totalDebit: Number(entry.totalDebit), totalCredit: Number(entry.totalCredit), source: entry.event ? `${entry.event.sourceModule} · ${entry.event.sourceType} · ${entry.event.sourceId}` : "Lançamento manual", lines: entry.lines.map((line) => ({ id: line.id, accountCode: line.account.code, accountName: line.account.name, side: line.side, amount: Number(line.amount), history: line.history })) })),
    trialBalance: calculateTrialBalance(charts.flatMap((chart) => chart.versions[0]?.accounts ?? []).filter((account) => account.isPosting).map((account) => { const lines = entries.flatMap((entry) => entry.lines).filter((line) => line.accountId === account.id); return { accountId: account.id, code: account.code, name: account.name, normalBalance: account.normalBalance, openingBalance: 0, debit: lines.filter((line) => line.side === "DEBIT").reduce((sum, line) => sum + Number(line.amount), 0), credit: lines.filter((line) => line.side === "CREDIT").reduce((sum, line) => sum + Number(line.amount), 0) }; })),
    inventory: { pools: pools.map((pool) => ({ id: pool.id, code: pool.code, name: pool.name, category: pool.category, totalAmount: Number(pool.totalAmount), movements: pool.movements.length })), allocations: allocationRuns.map((run) => ({ id: run.id, pool: run.pool.name, criterion: run.criterion, sourceAmount: Number(run.sourceAmount), allocatedAmount: Number(run.allocatedAmount), residualAmount: Number(run.residualAmount), proofZero: run.proofZero, units: run.lines.length })) },
    revenue: revenueRuns.map((run) => ({ id: run.id, cutoffDate: run.cutoffDate.toISOString(), policyId: run.policyId, vgv: Number(run.totalVgv), receivable: Number(run.totalReceivable), cash: Number(run.totalCash), revenue: Number(run.recognizedRevenue), cost: Number(run.recognizedCost), margin: Number(run.recognizedRevenue) - Number(run.recognizedCost) })),
    fiscal: { regimes: regimes.map((item) => ({ id: item.id, companyId: item.companyId, regime: item.regime, effectiveFrom: item.effectiveFrom.toISOString(), policies: item.policies.map((policy) => `${policy.taxCode} v${policy.version}`) })), assessments: assessments.map((item) => ({ id: item.id, taxCode: item.taxCode, referenceMonth: item.referenceMonth.toISOString(), taxableBase: Number(item.taxableBase), amount: Number(item.assessedAmount), dueAt: item.dueAt?.toISOString() ?? null, status: item.status, obligationLinked: Boolean(item.obligation) })) },
    consolidations: consolidationRuns.map((run) => ({ id: run.id, referenceMonth: run.referenceMonth.toISOString(), status: run.status, individualAmount: Number(run.individualAmount), adjustmentAmount: Number(run.adjustmentAmount), eliminationAmount: Number(run.eliminationAmount), consolidatedAmount: Number(run.consolidatedAmount), proofZero: run.proofZero, packages: run.packages.length, eliminations: run.eliminations.length })),
    reconciliations: reconciliations.map((item) => ({ id: item.id, type: item.reconciliationType, status: item.status, sourceAmount: Number(item.sourceAmount), ledgerAmount: Number(item.ledgerAmount), differenceAmount: Number(item.differenceAmount), material: item.material })),
    controllership: { approvedBase: budget ? Number(budget.totalBudget) : 0, budget: budget ? Number(budget.totalBudget) : 0, committed: contracts.reduce((sum, item) => sum + Number(item.originalAmount), 0), measured: measurements.reduce((sum, item) => sum + Number(item.grossAmount), 0), accounted, paid },
  };
}

export type AccountingWorkspaceView = Awaited<ReturnType<typeof getAccountingWorkspace>>;
export const accountingServiceInternals = { requireCapability, assertTenantScope, monthStart, buildPeriodBalances };
