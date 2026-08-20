import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import * as engine from "@/domain/financial-ops/engine";
import { parseBankStatementCsv } from "@/domain/financial-ops/csv-import";
import {
  applyCorrectionSchema,
  createBankAccountSchema,
  createCustomerSchema,
  createFinancialTransferSchema,
  createIntercompanyTransactionSchema,
  createPayableAccountSchema,
  createReceivableAccountSchema,
  createSupplierSchema,
  importBankTransactionsSchema,
  registerPayablePaymentSchema,
  registerReceivablePaymentSchema,
  type ApplyCorrectionInput,
  type CreateBankAccountInput,
  type CreateCustomerInput,
  type CreateFinancialTransferInput,
  type CreateIntercompanyTransactionInput,
  type CreatePayableAccountInput,
  type CreateReceivableAccountInput,
  type CreateSupplierInput,
  type ImportBankTransactionsInput,
  type RegisterPayablePaymentInput,
  type RegisterReceivablePaymentInput,
} from "@/domain/financial-ops/schemas";

type Client = Prisma.TransactionClient | typeof prisma;

const json = (value: unknown) => value as Prisma.InputJsonValue;
const mutableRoles = new Set(["OWNER", "ADMIN", "ANALYST"]);
const approvalRoles = new Set(["OWNER", "ADMIN"]);

function assertMutable(context: Pick<AuthContext, "role">) {
  if (!mutableRoles.has(context.role)) throw new Error("Seu perfil não pode alterar dados financeiros.");
}

function assertApprover(context: Pick<AuthContext, "role">) {
  if (!approvalRoles.has(context.role)) throw new Error("Somente Administrador ou Owner pode aprovar.");
}

function auditData(context: AuthContext, projectId: string | null, action: string, entityType: string, entityId: string, after?: unknown, before?: unknown) {
  return { organizationId: context.organizationId, userId: context.userId, projectId, action, entityType, entityId, before: before === undefined ? undefined : json(before), after: after === undefined ? undefined : json(after) };
}

async function projectForTenant(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  return project;
}

async function companyForTenant(organizationId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, organizationId } });
  if (!company) throw new Error("Empresa/SPE não encontrada nesta organização.");
  return company;
}

async function bankAccountForTenant(organizationId: string, bankAccountId: string) {
  const account = await prisma.bankAccount.findFirst({ where: { id: bankAccountId, organizationId } });
  if (!account) throw new Error("Conta bancária não encontrada nesta organização.");
  return account;
}

function paymentLike(payments: { amount: Prisma.Decimal | number; status: string }[]) {
  return payments.map((payment) => ({ amount: Number(payment.amount), status: payment.status as engine.InstallmentPaymentLike["status"] }));
}

// ---------------------------------------------------------------------------
// Cadastros: fornecedor, cliente, instituição, conta bancária
// ---------------------------------------------------------------------------

export async function createSupplier(context: AuthContext, raw: CreateSupplierInput) {
  assertMutable(context);
  const input = createSupplierSchema.parse(raw);
  const supplier = await prisma.supplier.create({ data: { organizationId: context.organizationId, name: input.name, legalName: input.legalName ?? null, taxId: input.taxId ?? null, personType: input.personType, email: input.email ?? null, phone: input.phone ?? null, bankData: input.bankData ? json(input.bankData) : undefined, createdById: context.userId } });
  await prisma.auditLog.create({ data: auditData(context, null, "SUPPLIER_CREATED", "Supplier", supplier.id, { name: supplier.name }) });
  return supplier;
}

export async function createCustomer(context: AuthContext, raw: CreateCustomerInput) {
  assertMutable(context);
  const input = createCustomerSchema.parse(raw);
  const customer = await prisma.customer.create({ data: { organizationId: context.organizationId, name: input.name, personType: input.personType, taxId: input.taxId ?? null, email: input.email ?? null, phone: input.phone ?? null, createdById: context.userId } });
  await prisma.auditLog.create({ data: auditData(context, null, "CUSTOMER_CREATED", "Customer", customer.id, { name: customer.name }) });
  return customer;
}

export async function createBankAccount(context: AuthContext, raw: CreateBankAccountInput) {
  assertMutable(context);
  const input = createBankAccountSchema.parse(raw);
  await companyForTenant(context.organizationId, input.companyId);
  if (input.projectId) await projectForTenant(context.organizationId, input.projectId);
  const institution = await prisma.financialInstitution.upsert({
    where: { organizationId_name: { organizationId: context.organizationId, name: input.institutionName } },
    update: {},
    create: { organizationId: context.organizationId, name: input.institutionName, createdById: context.userId },
  });
  const account = await prisma.bankAccount.create({ data: {
    organizationId: context.organizationId, companyId: input.companyId, projectId: input.projectId ?? null, institutionId: institution.id,
    agency: input.agency, accountNumber: input.accountNumber, holderName: input.holderName, type: input.type, restriction: input.restriction,
    currency: input.currency, openingBalance: input.openingBalance, createdById: context.userId,
  } });
  await prisma.auditLog.create({ data: auditData(context, input.projectId ?? null, "BANK_ACCOUNT_CREATED", "BankAccount", account.id, { institution: institution.name, type: account.type }) });
  return account;
}

// ---------------------------------------------------------------------------
// Contas a Pagar
// ---------------------------------------------------------------------------

function validateInstallmentNumbers(installments: { number?: number }[]) {
  const numbers = installments.map((item, index) => item.number ?? index + 1);
  if (new Set(numbers).size !== numbers.length) throw new Error("Os números de parcela não podem se repetir.");
  return numbers;
}

export async function createPayableAccount(context: AuthContext, raw: CreatePayableAccountInput) {
  assertMutable(context);
  const input = createPayableAccountSchema.parse(raw);
  const project = await projectForTenant(context.organizationId, input.projectId);
  const companyId = input.companyId ?? project.companyId ?? null;
  if (companyId) await companyForTenant(context.organizationId, companyId);
  const numbers = validateInstallmentNumbers(input.installments);
  const originalAmount = input.installments.reduce((sum, item) => sum.add(new Prisma.Decimal(item.amount)), new Prisma.Decimal(0));
  const account = await prisma.$transaction(async (tx) => {
    const created = await tx.payableAccount.create({
      data: {
        organizationId: context.organizationId, companyId, projectId: project.id,
        costCenterId: input.costCenterId ?? null, economicItemId: input.economicItemId ?? null,
        budgetLineItemId: input.budgetLineItemId ?? null, scheduleActivityId: input.scheduleActivityId ?? null,
        supplierId: input.supplierId ?? null, documentNumber: input.documentNumber ?? null, description: input.description,
        origin: input.origin, competenceMonth: input.competenceMonth, originalAmount, responsibleId: input.responsibleId ?? null,
        notes: input.notes ?? null, createdById: context.userId,
        installments: { create: input.installments.map((item, index) => ({ number: numbers[index], dueDate: item.dueDate, originalAmount: new Prisma.Decimal(item.amount), currentAmount: new Prisma.Decimal(item.amount) })) },
      },
      include: { installments: { orderBy: { number: "asc" } } },
    });
    await tx.auditLog.create({ data: auditData(context, project.id, "PAYABLE_ACCOUNT_CREATED", "PayableAccount", created.id, { originalAmount: originalAmount.toString(), installments: created.installments.length }) });
    return created;
  });
  return account;
}

export async function transitionPayableInstallment(context: AuthContext, installmentId: string, to: engine.PayableInstallmentStatus, reason?: string) {
  assertMutable(context);
  const installment = await prisma.payableInstallment.findFirst({ where: { id: installmentId, payableAccount: { organizationId: context.organizationId } }, include: { payableAccount: true } });
  if (!installment) throw new Error("Parcela de conta a pagar não encontrada nesta organização.");
  engine.assertPayableTransition(installment.status, to);
  if (to === "APROVADA") assertApprover(context);
  if (to === "CANCELADA" && !reason?.trim()) throw new Error("Informe o motivo do cancelamento.");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.payableInstallment.update({ where: { id: installment.id }, data: {
      status: to,
      approvedById: to === "APROVADA" ? context.userId : installment.approvedById,
      approvedAt: to === "APROVADA" ? new Date() : installment.approvedAt,
      cancelledAt: to === "CANCELADA" ? new Date() : null,
      cancelledReason: to === "CANCELADA" ? (reason?.trim() ?? null) : null,
    } });
    await tx.auditLog.create({ data: auditData(context, installment.payableAccount.projectId, "PAYABLE_INSTALLMENT_TRANSITIONED", "PayableInstallment", installment.id, { from: installment.status, to }) });
    return updated;
  });
}

async function registerPayablePaymentCore(client: Client, context: AuthContext, input: { installmentId: string; bankAccountId: string; amount: number; method: Prisma.PayablePaymentCreateInput["method"]; referenceNumber?: string | null; paidAt: Date }) {
  const installment = await client.payableInstallment.findFirst({ where: { id: input.installmentId, payableAccount: { organizationId: context.organizationId } }, include: { payableAccount: true, payments: true } });
  if (!installment) throw new Error("Parcela de conta a pagar não encontrada nesta organização.");
  // A checagem de idempotência precisa vir antes das checagens de status/saldo:
  // uma repetição legítima do mesmo pagamento (mesma chave) chega depois que a
  // parcela já foi marcada como PAGA pela primeira chamada, e deve retornar o
  // pagamento original em vez de ser rejeitada por "não estar mais aprovada".
  const idempotencyKey = createHash("sha256").update(`payable:${installment.id}:${input.paidAt.toISOString()}:${input.amount}:${input.bankAccountId}`).digest("hex");
  const existing = await client.payablePayment.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;
  if (!(["APROVADA", "PARCIALMENTE_PAGA"] as const).includes(installment.status as "APROVADA" | "PARCIALMENTE_PAGA")) throw new Error("Somente parcelas aprovadas podem receber pagamento.");
  const currentBalance = engine.computeInstallmentBalance(Number(installment.currentAmount), paymentLike(installment.payments));
  if (input.amount > currentBalance + 0.01) throw new Error("O valor do pagamento excede o saldo em aberto da parcela.");
  const payment = await client.payablePayment.create({ data: { installmentId: installment.id, bankAccountId: input.bankAccountId, amount: input.amount, method: input.method, referenceNumber: input.referenceNumber ?? null, paidAt: input.paidAt, status: "PROCESSED", approvedById: context.userId, createdById: context.userId, idempotencyKey } });
  const newBalance = engine.computeInstallmentBalance(Number(installment.currentAmount), [...paymentLike(installment.payments), { amount: input.amount, status: "PROCESSED" }]);
  const nextStatus = engine.nextPayableStatusAfterPayment(Number(installment.currentAmount), newBalance);
  await client.payableInstallment.update({ where: { id: installment.id }, data: { status: nextStatus } });
  await client.auditLog.create({ data: auditData(context, installment.payableAccount.projectId, "PAYABLE_PAYMENT_REGISTERED", "PayablePayment", payment.id, { amount: input.amount, balance: newBalance, nextStatus }) });
  return payment;
}

export async function registerPayablePayment(context: AuthContext, raw: RegisterPayablePaymentInput) {
  assertMutable(context);
  const input = registerPayablePaymentSchema.parse(raw);
  await bankAccountForTenant(context.organizationId, input.bankAccountId);
  return prisma.$transaction((tx) => registerPayablePaymentCore(tx, context, { installmentId: input.installmentId, bankAccountId: input.bankAccountId, amount: Number(input.amount), method: input.method, referenceNumber: input.referenceNumber, paidAt: input.paidAt }));
}

// ---------------------------------------------------------------------------
// Contas a Receber
// ---------------------------------------------------------------------------

export async function createReceivableAccount(context: AuthContext, raw: CreateReceivableAccountInput) {
  assertMutable(context);
  const input = createReceivableAccountSchema.parse(raw);
  const project = await projectForTenant(context.organizationId, input.projectId);
  const companyId = input.companyId ?? project.companyId ?? null;
  if (companyId) await companyForTenant(context.organizationId, companyId);
  const numbers = validateInstallmentNumbers(input.installments);
  const originalAmount = input.installments.reduce((sum, item) => sum.add(new Prisma.Decimal(item.amount)), new Prisma.Decimal(0));
  const account = await prisma.$transaction(async (tx) => {
    const created = await tx.receivableAccount.create({
      data: {
        organizationId: context.organizationId, companyId, projectId: project.id,
        costCenterId: input.costCenterId ?? null, economicItemId: input.economicItemId ?? null,
        customerId: input.customerId ?? null, unitReference: input.unitReference ?? null, contractReference: input.contractReference ?? null,
        documentNumber: input.documentNumber ?? null, description: input.description, origin: input.origin,
        competenceMonth: input.competenceMonth, originalAmount, responsibleId: input.responsibleId ?? null, notes: input.notes ?? null,
        createdById: context.userId,
        installments: { create: input.installments.map((item, index) => ({ number: numbers[index], dueDate: item.dueDate, originalAmount: new Prisma.Decimal(item.amount), currentAmount: new Prisma.Decimal(item.amount), status: "EMITIDA" as const, issuedAt: new Date() })) },
      },
      include: { installments: { orderBy: { number: "asc" } } },
    });
    await tx.auditLog.create({ data: auditData(context, project.id, "RECEIVABLE_ACCOUNT_CREATED", "ReceivableAccount", created.id, { originalAmount: originalAmount.toString(), installments: created.installments.length }) });
    return created;
  });
  return account;
}

export async function transitionReceivableInstallment(context: AuthContext, installmentId: string, to: engine.ReceivableInstallmentStatus, reason?: string) {
  assertMutable(context);
  const installment = await prisma.receivableInstallment.findFirst({ where: { id: installmentId, receivableAccount: { organizationId: context.organizationId } }, include: { receivableAccount: true } });
  if (!installment) throw new Error("Parcela de conta a receber não encontrada nesta organização.");
  engine.assertReceivableTransition(installment.status, to);
  if (to === "CANCELADA" && !reason?.trim()) throw new Error("Informe o motivo do cancelamento.");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.receivableInstallment.update({ where: { id: installment.id }, data: { status: to, cancelledAt: to === "CANCELADA" ? new Date() : null, cancelledReason: to === "CANCELADA" ? (reason?.trim() ?? null) : null } });
    await tx.auditLog.create({ data: auditData(context, installment.receivableAccount.projectId, "RECEIVABLE_INSTALLMENT_TRANSITIONED", "ReceivableInstallment", installment.id, { from: installment.status, to }) });
    return updated;
  });
}

async function registerReceivablePaymentCore(client: Client, context: AuthContext, input: { installmentId: string; bankAccountId: string; amount: number; method: Prisma.ReceivablePaymentCreateInput["method"]; referenceNumber?: string | null; receivedAt: Date }) {
  const installment = await client.receivableInstallment.findFirst({ where: { id: input.installmentId, receivableAccount: { organizationId: context.organizationId } }, include: { receivableAccount: true, payments: true } });
  if (!installment) throw new Error("Parcela de conta a receber não encontrada nesta organização.");
  // Mesma razão da versão a pagar: idempotência checada antes do status/saldo.
  const idempotencyKey = createHash("sha256").update(`receivable:${installment.id}:${input.receivedAt.toISOString()}:${input.amount}:${input.bankAccountId}`).digest("hex");
  const existing = await client.receivablePayment.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;
  if (!(["EMITIDA", "PARCIALMENTE_RECEBIDA"] as const).includes(installment.status as "EMITIDA" | "PARCIALMENTE_RECEBIDA")) throw new Error("Somente parcelas emitidas podem receber pagamento.");
  const currentBalance = engine.computeInstallmentBalance(Number(installment.currentAmount), paymentLike(installment.payments));
  if (input.amount > currentBalance + 0.01) throw new Error("O valor recebido excede o saldo em aberto da parcela.");
  const payment = await client.receivablePayment.create({ data: { installmentId: installment.id, bankAccountId: input.bankAccountId, amount: input.amount, method: input.method, referenceNumber: input.referenceNumber ?? null, receivedAt: input.receivedAt, status: "PROCESSED", createdById: context.userId, idempotencyKey } });
  const newBalance = engine.computeInstallmentBalance(Number(installment.currentAmount), [...paymentLike(installment.payments), { amount: input.amount, status: "PROCESSED" }]);
  const nextStatus = engine.nextReceivableStatusAfterPayment(Number(installment.currentAmount), newBalance);
  await client.receivableInstallment.update({ where: { id: installment.id }, data: { status: nextStatus } });
  await client.auditLog.create({ data: auditData(context, installment.receivableAccount.projectId, "RECEIVABLE_PAYMENT_REGISTERED", "ReceivablePayment", payment.id, { amount: input.amount, balance: newBalance, nextStatus }) });
  return payment;
}

export async function registerReceivablePayment(context: AuthContext, raw: RegisterReceivablePaymentInput) {
  assertMutable(context);
  const input = registerReceivablePaymentSchema.parse(raw);
  await bankAccountForTenant(context.organizationId, input.bankAccountId);
  return prisma.$transaction((tx) => registerReceivablePaymentCore(tx, context, { installmentId: input.installmentId, bankAccountId: input.bankAccountId, amount: Number(input.amount), method: input.method, referenceNumber: input.referenceNumber, receivedAt: input.receivedAt }));
}

// ---------------------------------------------------------------------------
// Correção contratual
// ---------------------------------------------------------------------------

export async function applyPayableInstallmentCorrection(context: AuthContext, raw: ApplyCorrectionInput) {
  assertMutable(context);
  const input = applyCorrectionSchema.parse(raw);
  const installment = await prisma.payableInstallment.findFirst({ where: { id: input.installmentId, payableAccount: { organizationId: context.organizationId } }, include: { payableAccount: true } });
  if (!installment) throw new Error("Parcela de conta a pagar não encontrada nesta organização.");
  const result = engine.applyInstallmentCorrection({ baseAmount: Number(installment.currentAmount), indexPercentage: input.indexPercentage, interestRatePerMonth: input.interestRatePerMonth, monthsLate: input.monthsLate, fineRate: input.fineRate, discountAmount: input.discountAmount });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.payableInstallment.update({ where: { id: installment.id }, data: { currentAmount: result.resultingAmount, interestAmount: result.interestAmount, fineAmount: result.fineAmount, discountAmount: result.discountAmount } });
    await tx.installmentAdjustment.create({ data: { payableInstallmentId: installment.id, previousAmount: Number(installment.currentAmount), resultingAmount: result.resultingAmount, indexName: input.indexName ?? null, indexPercentageApplied: input.indexPercentage, interestAmount: result.interestAmount, fineAmount: result.fineAmount, discountAmount: result.discountAmount, referencePeriod: input.referencePeriod, appliedById: context.userId } });
    await tx.auditLog.create({ data: auditData(context, installment.payableAccount.projectId, "PAYABLE_INSTALLMENT_ADJUSTED", "PayableInstallment", installment.id, result, { previousAmount: Number(installment.currentAmount) }) });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Transações bancárias e conciliação
// ---------------------------------------------------------------------------

export async function importBankTransactions(context: AuthContext, raw: ImportBankTransactionsInput) {
  assertMutable(context);
  const input = importBankTransactionsSchema.parse(raw);
  const account = await bankAccountForTenant(context.organizationId, input.bankAccountId);
  const results: { created: number; duplicates: number } = { created: 0, duplicates: 0 };
  const rows = [];
  for (const [index, txn] of input.transactions.entries()) {
    const checksum = createHash("sha256").update(`${input.bankAccountId}:${txn.occurredAt.toISOString()}:${txn.amount}:${txn.direction}:${txn.description}:${txn.externalId ?? index}`).digest("hex");
    const existing = await prisma.bankTransaction.findUnique({ where: { bankAccountId_checksum: { bankAccountId: input.bankAccountId, checksum } } });
    if (existing) { results.duplicates += 1; rows.push(existing); continue; }
    const created = await prisma.bankTransaction.create({ data: { organizationId: context.organizationId, bankAccountId: input.bankAccountId, occurredAt: txn.occurredAt, amount: txn.amount, direction: txn.direction, description: txn.description, counterparty: txn.counterparty ?? null, documentRef: txn.documentRef ?? null, origin: input.origin, externalId: txn.externalId ?? null, importBatchId: input.importBatchId ?? null, checksum, status: "RECEIVED" } });
    results.created += 1;
    rows.push(created);
  }
  await prisma.auditLog.create({ data: auditData(context, account.projectId, "BANK_TRANSACTIONS_IMPORTED", "BankAccount", account.id, results) });
  return { ...results, transactions: rows };
}

export async function importBankStatementCsv(context: AuthContext, bankAccountId: string, csvContent: string, importBatchId?: string) {
  assertMutable(context);
  await bankAccountForTenant(context.organizationId, bankAccountId);
  const report = parseBankStatementCsv(csvContent);
  if (report.accepted.length === 0) return { created: 0, duplicates: 0, transactions: [], accepted: 0, rejected: report.rejected };
  const imported = await importBankTransactions(context, {
    bankAccountId,
    origin: "IMPORT_CSV",
    importBatchId: importBatchId ?? null,
    transactions: report.accepted.map((row) => ({ occurredAt: row.occurredAt, amount: row.amount, direction: row.direction, description: row.description, counterparty: row.counterparty ?? null, documentRef: row.documentRef ?? null, externalId: row.externalId ?? null })),
  });
  return { ...imported, accepted: report.accepted.length, rejected: report.rejected };
}

export async function suggestReconciliationsForTransaction(context: AuthContext, bankTransactionId: string) {
  assertMutable(context);
  const txn = await prisma.bankTransaction.findFirst({ where: { id: bankTransactionId, organizationId: context.organizationId }, include: { bankAccount: true } });
  if (!txn) throw new Error("Transação bancária não encontrada nesta organização.");
  if (txn.status === "RECONCILED") throw new Error("Esta transação já está conciliada.");

  type Candidate = { id: string; input: engine.ReconciliationCandidateInput; candidateType: "PAYABLE_INSTALLMENT" | "RECEIVABLE_INSTALLMENT" };
  let candidates: Candidate[] = [];

  if (txn.direction === "DEBIT") {
    const installments = await prisma.payableInstallment.findMany({
      where: { status: { in: ["APROVADA", "PARCIALMENTE_PAGA"] }, payableAccount: { organizationId: context.organizationId, ...(txn.bankAccount.companyId ? { companyId: txn.bankAccount.companyId } : {}) } },
      include: { payableAccount: { include: { supplier: true } }, payments: true },
    });
    candidates = installments.map((installment) => ({
      id: installment.id,
      candidateType: "PAYABLE_INSTALLMENT" as const,
      input: { transactionAmount: Number(txn.amount), transactionDate: txn.occurredAt, transactionDescription: txn.description, candidateAmount: engine.computeInstallmentBalance(Number(installment.currentAmount), paymentLike(installment.payments)), candidateDueDate: installment.dueDate, candidateDocumentRef: installment.payableAccount.documentNumber, candidateCounterpartyName: installment.payableAccount.supplier?.name ?? null },
    }));
  } else {
    const installments = await prisma.receivableInstallment.findMany({
      where: { status: { in: ["EMITIDA", "PARCIALMENTE_RECEBIDA"] }, receivableAccount: { organizationId: context.organizationId, ...(txn.bankAccount.companyId ? { companyId: txn.bankAccount.companyId } : {}) } },
      include: { receivableAccount: { include: { customer: true } }, payments: true },
    });
    candidates = installments.map((installment) => ({
      id: installment.id,
      candidateType: "RECEIVABLE_INSTALLMENT" as const,
      input: { transactionAmount: Number(txn.amount), transactionDate: txn.occurredAt, transactionDescription: txn.description, candidateAmount: engine.computeInstallmentBalance(Number(installment.currentAmount), paymentLike(installment.payments)), candidateDueDate: installment.dueDate, candidateDocumentRef: installment.receivableAccount.documentNumber, candidateCounterpartyName: installment.receivableAccount.customer?.name ?? null },
    }));
  }

  const ranked = engine.rankReconciliationCandidates(candidates.map((candidate) => ({ item: candidate, input: candidate.input }))).slice(0, 5);

  return prisma.$transaction(async (tx) => {
    await tx.reconciliationMatch.deleteMany({ where: { bankTransactionId: txn.id, status: "SUGGESTED" } });
    const created = await Promise.all(ranked.map((candidate) => tx.reconciliationMatch.create({ data: {
      bankTransactionId: txn.id,
      matchType: candidate.item.candidateType === "PAYABLE_INSTALLMENT" ? "PAYABLE_PAYMENT" : "RECEIVABLE_PAYMENT",
      confidence: candidate.result.confidence ?? "BAIXA", score: candidate.result.score,
      criteria: json({ candidateType: candidate.item.candidateType, candidateId: candidate.item.id, breakdown: candidate.result.breakdown }),
      status: "SUGGESTED",
    } })));
    if (created.length && txn.status === "RECEIVED") await tx.bankTransaction.update({ where: { id: txn.id }, data: { status: "CANDIDATE" } });
    return created;
  });
}

export async function confirmReconciliation(context: AuthContext, matchId: string) {
  assertApprover(context);
  const match = await prisma.reconciliationMatch.findFirst({ where: { id: matchId, bankTransaction: { organizationId: context.organizationId } }, include: { bankTransaction: true } });
  if (!match || match.status !== "SUGGESTED") throw new Error("Sugestão de conciliação não encontrada ou já tratada.");
  const criteria = match.criteria as { candidateType: "PAYABLE_INSTALLMENT" | "RECEIVABLE_INSTALLMENT"; candidateId: string };

  return prisma.$transaction(async (tx) => {
    let paymentId: string;
    if (criteria.candidateType === "PAYABLE_INSTALLMENT") {
      const payment = await registerPayablePaymentCore(tx, context, { installmentId: criteria.candidateId, bankAccountId: match.bankTransaction.bankAccountId, amount: Number(match.bankTransaction.amount), method: "TRANSFER", paidAt: match.bankTransaction.occurredAt });
      paymentId = payment.id;
      await tx.reconciliationMatch.update({ where: { id: match.id }, data: { status: "CONFIRMED", payablePaymentId: payment.id, matchedById: context.userId, matchedAt: new Date() } });
    } else {
      const payment = await registerReceivablePaymentCore(tx, context, { installmentId: criteria.candidateId, bankAccountId: match.bankTransaction.bankAccountId, amount: Number(match.bankTransaction.amount), method: "PIX", receivedAt: match.bankTransaction.occurredAt });
      paymentId = payment.id;
      await tx.reconciliationMatch.update({ where: { id: match.id }, data: { status: "CONFIRMED", receivablePaymentId: payment.id, matchedById: context.userId, matchedAt: new Date() } });
    }
    await tx.bankTransaction.update({ where: { id: match.bankTransactionId }, data: { status: "RECONCILED", reconciledAt: new Date(), reconciledById: context.userId } });
    await tx.reconciliationMatch.updateMany({ where: { bankTransactionId: match.bankTransactionId, status: "SUGGESTED", id: { not: match.id } }, data: { status: "REJECTED", rejectedReason: "Outra sugestão foi confirmada para esta transação." } });
    await tx.auditLog.create({ data: auditData(context, null, "RECONCILIATION_CONFIRMED", "ReconciliationMatch", match.id, { bankTransactionId: match.bankTransactionId, paymentId }) });
    return tx.reconciliationMatch.findUniqueOrThrow({ where: { id: match.id } });
  });
}

export async function rejectReconciliation(context: AuthContext, matchId: string, reason: string) {
  assertApprover(context);
  if (!reason.trim()) throw new Error("Informe o motivo da rejeição.");
  const match = await prisma.reconciliationMatch.findFirst({ where: { id: matchId, bankTransaction: { organizationId: context.organizationId } } });
  if (!match || match.status !== "SUGGESTED") throw new Error("Sugestão de conciliação não encontrada ou já tratada.");
  const updated = await prisma.reconciliationMatch.update({ where: { id: match.id }, data: { status: "REJECTED", rejectedReason: reason.trim() } });
  await prisma.auditLog.create({ data: auditData(context, null, "RECONCILIATION_REJECTED", "ReconciliationMatch", match.id, { reason: reason.trim() }) });
  return updated;
}

// ---------------------------------------------------------------------------
// Transferências entre contas
// ---------------------------------------------------------------------------

export async function createFinancialTransfer(context: AuthContext, raw: CreateFinancialTransferInput) {
  assertMutable(context);
  const input = createFinancialTransferSchema.parse(raw);
  if (input.fromBankAccountId === input.toBankAccountId) throw new Error("A conta de origem e destino não podem ser a mesma.");
  const from = await bankAccountForTenant(context.organizationId, input.fromBankAccountId);
  await bankAccountForTenant(context.organizationId, input.toBankAccountId);
  const amount = Number(input.amount);
  return prisma.$transaction(async (tx) => {
    const checksumBase = `transfer:${input.fromBankAccountId}:${input.toBankAccountId}:${input.transferredAt.toISOString()}:${amount}`;
    const fromTransaction = await tx.bankTransaction.create({ data: { organizationId: context.organizationId, bankAccountId: input.fromBankAccountId, occurredAt: input.transferredAt, amount, direction: "DEBIT", description: input.description ?? "Transferência entre contas", origin: "MANUAL", status: "RECONCILED", reconciledAt: new Date(), reconciledById: context.userId, checksum: createHash("sha256").update(`${checksumBase}:out`).digest("hex") } });
    const toTransaction = await tx.bankTransaction.create({ data: { organizationId: context.organizationId, bankAccountId: input.toBankAccountId, occurredAt: input.transferredAt, amount, direction: "CREDIT", description: input.description ?? "Transferência entre contas", origin: "MANUAL", status: "RECONCILED", reconciledAt: new Date(), reconciledById: context.userId, checksum: createHash("sha256").update(`${checksumBase}:in`).digest("hex") } });
    const transfer = await tx.financialTransfer.create({ data: { organizationId: context.organizationId, fromBankAccountId: input.fromBankAccountId, toBankAccountId: input.toBankAccountId, amount, transferredAt: input.transferredAt, description: input.description ?? null, status: "COMPLETED", fromTransactionId: fromTransaction.id, toTransactionId: toTransaction.id, createdById: context.userId } });
    await tx.auditLog.create({ data: auditData(context, from.projectId, "FINANCIAL_TRANSFER_CREATED", "FinancialTransfer", transfer.id, { amount, fromBankAccountId: input.fromBankAccountId, toBankAccountId: input.toBankAccountId }) });
    return transfer;
  });
}

// ---------------------------------------------------------------------------
// Intercompany
// ---------------------------------------------------------------------------

export async function createIntercompanyTransaction(context: AuthContext, raw: CreateIntercompanyTransactionInput) {
  assertMutable(context);
  const input = createIntercompanyTransactionSchema.parse(raw);
  engine.assertIntercompanyReciprocity({ fromCompanyId: input.fromCompanyId, toCompanyId: input.toCompanyId, amount: Number(input.amount) });
  const fromCompany = await companyForTenant(context.organizationId, input.fromCompanyId);
  await companyForTenant(context.organizationId, input.toCompanyId);
  if (input.fromProjectId) await projectForTenant(context.organizationId, input.fromProjectId);
  if (input.toProjectId) await projectForTenant(context.organizationId, input.toProjectId);
  const amount = new Prisma.Decimal(input.amount);

  return prisma.$transaction(async (tx) => {
    const transaction = await tx.intercompanyTransaction.create({ data: { organizationId: context.organizationId, economicGroupId: fromCompany.economicGroupId, fromCompanyId: input.fromCompanyId, toCompanyId: input.toCompanyId, fromProjectId: input.fromProjectId ?? null, toProjectId: input.toProjectId ?? null, amount, occurredAt: input.occurredAt, nature: input.nature, referenceNumber: input.referenceNumber ?? null, description: input.description ?? null, createdById: context.userId } });

    if (input.fromProjectId) {
      await tx.payableAccount.create({ data: {
        organizationId: context.organizationId, companyId: input.fromCompanyId, projectId: input.fromProjectId,
        intercompanyTransactionId: transaction.id, description: input.description?.trim() || `Intercompany ${input.nature} para ${input.toCompanyId}`,
        origin: "INTERCOMPANY", competenceMonth: input.occurredAt, originalAmount: amount, createdById: context.userId,
        installments: { create: [{ number: 1, dueDate: input.occurredAt, originalAmount: amount, currentAmount: amount, status: "APROVADA" }] },
      } });
    }
    if (input.toProjectId) {
      await tx.receivableAccount.create({ data: {
        organizationId: context.organizationId, companyId: input.toCompanyId, projectId: input.toProjectId,
        intercompanyTransactionId: transaction.id, description: input.description?.trim() || `Intercompany ${input.nature} de ${input.fromCompanyId}`,
        origin: "INTERCOMPANY", competenceMonth: input.occurredAt, originalAmount: amount, createdById: context.userId,
        installments: { create: [{ number: 1, dueDate: input.occurredAt, originalAmount: amount, currentAmount: amount, status: "EMITIDA", issuedAt: new Date() }] },
      } });
    }

    await tx.auditLog.create({ data: auditData(context, input.fromProjectId ?? input.toProjectId ?? null, "INTERCOMPANY_TRANSACTION_CREATED", "IntercompanyTransaction", transaction.id, { amount: amount.toString(), nature: input.nature, fromCompanyId: input.fromCompanyId, toCompanyId: input.toCompanyId }) });
    return transaction;
  });
}

export async function approveIntercompanyTransaction(context: AuthContext, transactionId: string) {
  assertApprover(context);
  const transaction = await prisma.intercompanyTransaction.findFirst({ where: { id: transactionId, organizationId: context.organizationId } });
  if (!transaction || transaction.status !== "PENDING") throw new Error("Movimentação intercompany não disponível para aprovação.");
  const updated = await prisma.intercompanyTransaction.update({ where: { id: transaction.id }, data: { status: "APPROVED", approvedById: context.userId, approvedAt: new Date() } });
  await prisma.auditLog.create({ data: auditData(context, transaction.fromProjectId ?? transaction.toProjectId ?? null, "INTERCOMPANY_TRANSACTION_APPROVED", "IntercompanyTransaction", transaction.id, { status: updated.status }) });
  return updated;
}

// ---------------------------------------------------------------------------
// Fechamento mensal
// ---------------------------------------------------------------------------

async function pendingClosureIssues(organizationId: string, companyId: string) {
  const [unreconciled, awaitingApproval] = await Promise.all([
    prisma.bankTransaction.count({ where: { organizationId, status: { in: ["CANDIDATE", "UNRECONCILED", "RECEIVED"] }, bankAccount: { companyId } } }),
    prisma.payableInstallment.count({ where: { status: "AGUARDANDO_APROVACAO", payableAccount: { organizationId, companyId } } }),
  ]);
  const issues: string[] = [];
  if (unreconciled > 0) issues.push(`${unreconciled} transação(ões) bancária(s) sem conciliação.`);
  if (awaitingApproval > 0) issues.push(`${awaitingApproval} parcela(s) de conta a pagar aguardando aprovação.`);
  return issues;
}

export async function closeFinancialPeriod(context: AuthContext, companyId: string, referenceMonth: Date) {
  assertApprover(context);
  await companyForTenant(context.organizationId, companyId);
  const period = new Date(Date.UTC(referenceMonth.getUTCFullYear(), referenceMonth.getUTCMonth(), 1));
  const issues = await pendingClosureIssues(context.organizationId, companyId);
  const closure = await prisma.financialPeriodClosure.upsert({
    where: { organizationId_companyId_referenceMonth: { organizationId: context.organizationId, companyId, referenceMonth: period } },
    update: { status: "CLOSED", pendingIssues: json(issues), closedById: context.userId, closedAt: new Date() },
    create: { organizationId: context.organizationId, companyId, referenceMonth: period, status: "CLOSED", pendingIssues: json(issues), closedById: context.userId, closedAt: new Date(), createdById: context.userId },
  });
  await prisma.auditLog.create({ data: auditData(context, null, "FINANCIAL_PERIOD_CLOSED", "FinancialPeriodClosure", closure.id, { referenceMonth: period.toISOString(), issues }) });
  return closure;
}

export async function reopenFinancialPeriod(context: AuthContext, closureId: string, reason: string) {
  assertApprover(context);
  if (!reason.trim()) throw new Error("Informe o motivo da reabertura.");
  const closure = await prisma.financialPeriodClosure.findFirst({ where: { id: closureId, organizationId: context.organizationId } });
  if (!closure || closure.status !== "CLOSED") throw new Error("Somente um período fechado pode ser reaberto.");
  const updated = await prisma.financialPeriodClosure.update({ where: { id: closure.id }, data: { status: "REOPENED", reopenedById: context.userId, reopenedAt: new Date(), reopenReason: reason.trim() } });
  await prisma.auditLog.create({ data: auditData(context, null, "FINANCIAL_PERIOD_REOPENED", "FinancialPeriodClosure", closure.id, { reason: reason.trim() }) });
  return updated;
}

// ---------------------------------------------------------------------------
// Leitura: workspace financeiro consolidado
// ---------------------------------------------------------------------------

async function computeBankAccountBalance(bankAccountId: string, openingBalance: Prisma.Decimal) {
  const [credit, debit] = await Promise.all([
    prisma.bankTransaction.aggregate({ where: { bankAccountId, direction: "CREDIT" }, _sum: { amount: true } }),
    prisma.bankTransaction.aggregate({ where: { bankAccountId, direction: "DEBIT" }, _sum: { amount: true } }),
  ]);
  return openingBalance.add(credit._sum.amount ?? 0).sub(debit._sum.amount ?? 0);
}

function periodKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getFinancialWorkspace(context: Pick<AuthContext, "organizationId">, projectId: string, referenceDate: Date = new Date()) {
  const project = await projectForTenant(context.organizationId, projectId);
  const companyId = project.companyId;

  const [bankAccounts, payableInstallments, receivableInstallments, pendingReconciliations, pendingIntercompanyList, latestSchedule, suppliers, customers, companies, unreconciledTransactions] = await Promise.all([
    companyId ? prisma.bankAccount.findMany({ where: { organizationId: context.organizationId, companyId }, include: { institution: true } }) : Promise.resolve([]),
    prisma.payableInstallment.findMany({ where: { payableAccount: { organizationId: context.organizationId, projectId }, status: { notIn: ["CANCELADA"] } }, include: { payments: true, payableAccount: { include: { supplier: true } } }, orderBy: { dueDate: "asc" } }),
    prisma.receivableInstallment.findMany({ where: { receivableAccount: { organizationId: context.organizationId, projectId }, status: { notIn: ["CANCELADA", "RENEGOCIADA"] } }, include: { payments: true, receivableAccount: { include: { customer: true } } }, orderBy: { dueDate: "asc" } }),
    prisma.reconciliationMatch.count({ where: { status: "SUGGESTED", bankTransaction: { organizationId: context.organizationId, ...(companyId ? { bankAccount: { companyId } } : {}) } } }),
    companyId ? prisma.intercompanyTransaction.findMany({ where: { organizationId: context.organizationId, status: "PENDING", OR: [{ fromCompanyId: companyId }, { toCompanyId: companyId }] }, include: { fromCompany: true, toCompany: true }, orderBy: { occurredAt: "desc" } }) : Promise.resolve([]),
    prisma.operationalSchedule.findFirst({ where: { organizationId: context.organizationId, projectId, status: "APPROVED" }, orderBy: { version: "desc" }, include: { activities: { include: { allocations: true } } } }),
    prisma.supplier.findMany({ where: { organizationId: context.organizationId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.customer.findMany({ where: { organizationId: context.organizationId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.company.findMany({ where: { organizationId: context.organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
    companyId ? prisma.bankTransaction.findMany({ where: { organizationId: context.organizationId, status: { in: ["RECEIVED", "CANDIDATE", "UNRECONCILED"] }, bankAccount: { companyId } }, include: { reconciliationMatches: { where: { status: "SUGGESTED" }, orderBy: { score: "desc" } } }, orderBy: { occurredAt: "desc" }, take: 50 }) : Promise.resolve([]),
  ]);

  const balances = await Promise.all(bankAccounts.map(async (account) => ({ account, balance: Number(await computeBankAccountBalance(account.id, account.openingBalance)) })));
  const cashPosition = engine.summarizeCashPosition(balances.map(({ account, balance }) => ({ restriction: account.restriction, balance })));

  const payableOpenBalances = payableInstallments.map((installment) => ({ installment, balance: engine.computeInstallmentBalance(Number(installment.currentAmount), paymentLike(installment.payments)) }));
  const receivableOpenBalances = receivableInstallments.map((installment) => ({ installment, balance: engine.computeInstallmentBalance(Number(installment.currentAmount), paymentLike(installment.payments)) }));

  const payableHorizons = engine.buildDueHorizons(payableOpenBalances.map(({ installment, balance }) => ({ dueDate: installment.dueDate, balance })), referenceDate, [90, 30, 7]);
  const receivableHorizons = engine.buildDueHorizons(receivableOpenBalances.map(({ installment, balance }) => ({ dueDate: installment.dueDate, balance })), referenceDate, [90, 30, 7]);
  const paymentSchedule = engine.buildDueHorizons(payableOpenBalances.map(({ installment, balance }) => ({ dueDate: installment.dueDate, balance })), referenceDate, [21, 14, 7, 3, 0]);

  const scheduledByPeriod = new Map<string, number>();
  const activityIds = new Set<string>();
  for (const activity of latestSchedule?.activities ?? []) {
    activityIds.add(activity.id);
    for (const allocation of activity.allocations) scheduledByPeriod.set(periodKey(allocation.periodStart), (scheduledByPeriod.get(periodKey(allocation.periodStart)) ?? 0) + Number(allocation.plannedDisbursement));
  }
  const committedByPeriod = new Map<string, { total: number; realized: number }>();
  for (const { installment, balance } of payableOpenBalances) {
    const activityId = installment.payableAccount.scheduleActivityId;
    if (!activityId || !activityIds.has(activityId)) continue;
    const key = periodKey(installment.dueDate);
    const current = committedByPeriod.get(key) ?? { total: 0, realized: 0 };
    current.total += Number(installment.currentAmount);
    current.realized += Number(installment.currentAmount) - balance;
    committedByPeriod.set(key, current);
  }
  const periods = [...new Set([...scheduledByPeriod.keys(), ...committedByPeriod.keys()])].sort();
  const updatedProjection = engine.buildUpdatedProjection(periods.map((period) => ({ period, plannedScheduled: scheduledByPeriod.get(period) ?? 0, committedTotal: committedByPeriod.get(period)?.total ?? 0, committedRealized: committedByPeriod.get(period)?.realized ?? 0 })));

  const projectionRows = updatedProjection.map((row) => ({ period: row.period, inflow: 0, outflow: row.total }));
  const cashProjection = engine.projectCashBalances(cashPosition.free, projectionRows);
  const capitalNeed = engine.capitalNeedIndicators(cashProjection.map((row) => ({ period: row.period, closingBalance: row.closingBalance })));

  const candidateIds = { payable: new Set<string>(), receivable: new Set<string>() };
  for (const transaction of unreconciledTransactions) {
    for (const match of transaction.reconciliationMatches) {
      const criteria = match.criteria as { candidateType: "PAYABLE_INSTALLMENT" | "RECEIVABLE_INSTALLMENT"; candidateId: string };
      candidateIds[criteria.candidateType === "PAYABLE_INSTALLMENT" ? "payable" : "receivable"].add(criteria.candidateId);
    }
  }
  const [candidatePayables, candidateReceivables] = await Promise.all([
    candidateIds.payable.size ? prisma.payableInstallment.findMany({ where: { id: { in: [...candidateIds.payable] } }, include: { payableAccount: { include: { supplier: true } } } }) : Promise.resolve([]),
    candidateIds.receivable.size ? prisma.receivableInstallment.findMany({ where: { id: { in: [...candidateIds.receivable] } }, include: { receivableAccount: { include: { customer: true } } } }) : Promise.resolve([]),
  ]);
  const candidateLabel = new Map<string, string>();
  for (const installment of candidatePayables) candidateLabel.set(installment.id, `${installment.payableAccount.description}${installment.payableAccount.supplier ? ` · ${installment.payableAccount.supplier.name}` : ""}`);
  for (const installment of candidateReceivables) candidateLabel.set(installment.id, `${installment.receivableAccount.description}${installment.receivableAccount.customer ? ` · ${installment.receivableAccount.customer.name}` : ""}`);

  return {
    projectId: project.id,
    companyId,
    cashPosition,
    bankAccounts: balances.map(({ account, balance }) => ({ id: account.id, institution: account.institution?.name ?? null, agency: account.agency, accountNumber: account.accountNumber, type: account.type, restriction: account.restriction, balance })),
    suppliers,
    customers,
    companies,
    payables: {
      openCount: payableOpenBalances.length,
      totalOpen: engine.roundMoney(payableOpenBalances.reduce((sum, item) => sum + item.balance, 0)),
      horizons: payableHorizons,
      dueRuler: paymentSchedule,
      openItems: payableOpenBalances.map(({ installment, balance }) => ({ id: installment.id, description: installment.payableAccount.description, supplier: installment.payableAccount.supplier?.name ?? null, dueDate: installment.dueDate.toISOString(), balance, status: installment.status, overdue: engine.isInstallmentOverdue(installment.dueDate, balance, installment.status, referenceDate, engine.PAYABLE_TERMINAL_STATUSES) })),
      overdueItems: payableOpenBalances.filter(({ installment, balance }) => engine.isInstallmentOverdue(installment.dueDate, balance, installment.status, referenceDate, engine.PAYABLE_TERMINAL_STATUSES)).map(({ installment, balance }) => ({ id: installment.id, description: installment.payableAccount.description, supplier: installment.payableAccount.supplier?.name ?? null, dueDate: installment.dueDate.toISOString(), balance })),
    },
    receivables: {
      openCount: receivableOpenBalances.length,
      totalOpen: engine.roundMoney(receivableOpenBalances.reduce((sum, item) => sum + item.balance, 0)),
      horizons: receivableHorizons,
      openItems: receivableOpenBalances.map(({ installment, balance }) => ({ id: installment.id, description: installment.receivableAccount.description, customer: installment.receivableAccount.customer?.name ?? null, dueDate: installment.dueDate.toISOString(), balance, status: installment.status, overdue: engine.isInstallmentOverdue(installment.dueDate, balance, installment.status, referenceDate, engine.RECEIVABLE_TERMINAL_STATUSES) })),
      overdueItems: receivableOpenBalances.filter(({ installment, balance }) => engine.isInstallmentOverdue(installment.dueDate, balance, installment.status, referenceDate, engine.RECEIVABLE_TERMINAL_STATUSES)).map(({ installment, balance }) => ({ id: installment.id, description: installment.receivableAccount.description, customer: installment.receivableAccount.customer?.name ?? null, dueDate: installment.dueDate.toISOString(), balance })),
    },
    updatedProjection,
    capitalNeed,
    pendingReconciliations,
    pendingIntercompany: pendingIntercompanyList.length,
    pendingIntercompanyList: pendingIntercompanyList.map((item) => ({ id: item.id, fromCompany: item.fromCompany.name, toCompany: item.toCompany.name, amount: Number(item.amount), nature: item.nature, occurredAt: item.occurredAt.toISOString(), status: item.status })),
    unreconciledTransactions: unreconciledTransactions.map((transaction) => ({
      id: transaction.id,
      occurredAt: transaction.occurredAt.toISOString(),
      amount: Number(transaction.amount),
      direction: transaction.direction,
      description: transaction.description,
      status: transaction.status,
      suggestions: transaction.reconciliationMatches.map((match) => {
        const criteria = match.criteria as { candidateType: "PAYABLE_INSTALLMENT" | "RECEIVABLE_INSTALLMENT"; candidateId: string };
        return { matchId: match.id, score: match.score, confidence: match.confidence, candidateType: criteria.candidateType, candidateLabel: candidateLabel.get(criteria.candidateId) ?? "Parcela não encontrada" };
      }),
    })),
  };
}

export type FinancialWorkspaceView = Awaited<ReturnType<typeof getFinancialWorkspace>>;
