import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { emitOperationalAlert } from "@/application/observability/operational-alerts";
import { registerReceivablePayment } from "@/application/financial-ops/financial-service";
import { evaluateDisbursementReconciliation } from "@/domain/handover/repasse";
import {
  createBankFinancingDisbursementSchema,
  requestBankFinancingDisbursementSchema,
  recordBankFinancingDisbursementReceivedSchema,
  reconcileBankFinancingDisbursementSchema,
  cancelBankFinancingDisbursementSchema,
  type CreateBankFinancingDisbursementInput,
  type RequestBankFinancingDisbursementInput,
  type RecordBankFinancingDisbursementReceivedInput,
  type ReconcileBankFinancingDisbursementInput,
  type CancelBankFinancingDisbursementInput,
} from "@/domain/handover/schemas";

/**
 * Fase 9R — Repasse bancário. Reaproveita `Sale`/`SalesContract` (9E),
 * `FinancialInstitution` (9B) e `registerReceivablePayment` (9B/9E) — a conciliação
 * bem-sucedida gera o `ReceivablePayment` oficial pela função já existente, nunca uma
 * segunda contabilidade de caixa. Divergência de valor nunca ajusta o recebível
 * silenciosamente: fica `DIVERGENT` até decisão humana.
 */

const mutableRoles = new Set(["OWNER", "ADMIN", "ANALYST"]);
const json = (value: unknown) => value as Prisma.InputJsonValue;

function assertMutable(context: Pick<AuthContext, "role">) {
  if (!mutableRoles.has(context.role)) throw new Error("Seu perfil não pode alterar dados de repasse bancário.");
}

/**
 * `correlationId` é sempre gerado no servidor (`randomUUID`) — nunca aceito de entrada
 * do cliente. `metadata` é allowlisted: só `correlationId`/`operationType` entram,
 * nunca payload bruto, PII, URL assinada ou ID de sistema externo. `before`/`after`
 * carregam só o estado da entidade (status, valores, referências internas), nunca
 * texto informado livremente pelo cliente.
 */
const audit = (
  context: Pick<AuthContext, "organizationId" | "userId">,
  projectId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  after: unknown,
  extra: { before?: unknown; correlationId: string },
) => ({
  organizationId: context.organizationId, userId: context.userId, projectId, action, entityType, entityId,
  after: after === undefined ? undefined : json(after),
  ...(extra.before !== undefined ? { before: json(extra.before) } : {}),
  metadata: json({ correlationId: extra.correlationId, operationType: action }),
});
const newCorrelationId = () => randomUUID();

/** IDs inexistentes ou de outro tenant falham com a mesma mensagem — nunca revela qual dos dois motivos ocorreu. */
async function saleForTenant(organizationId: string, saleId: string) {
  const sale = await prisma.sale.findFirst({ where: { id: saleId, organizationId } });
  if (!sale) throw new Error("Venda não encontrada nesta organização.");
  return sale;
}
async function institutionForTenant(organizationId: string, financialInstitutionId: string) {
  const institution = await prisma.financialInstitution.findFirst({ where: { id: financialInstitutionId, organizationId } });
  if (!institution) throw new Error("Instituição financeira não encontrada nesta organização.");
  return institution;
}
async function disbursementForTenant(organizationId: string, disbursementId: string) {
  const disbursement = await prisma.bankFinancingDisbursement.findFirst({ where: { id: disbursementId, organizationId } });
  if (!disbursement) throw new Error("Repasse bancário não encontrado nesta organização.");
  return disbursement;
}

export async function createBankFinancingDisbursement(context: AuthContext, raw: CreateBankFinancingDisbursementInput) {
  assertMutable(context);
  const input = createBankFinancingDisbursementSchema.parse(raw);
  const sale = await saleForTenant(context.organizationId, input.saleId);
  await institutionForTenant(context.organizationId, input.financialInstitutionId);
  const disbursement = await prisma.bankFinancingDisbursement.create({
    data: {
      organizationId: context.organizationId, saleId: sale.id, financialInstitutionId: input.financialInstitutionId,
      disbursementType: input.disbursementType, expectedAmount: input.expectedAmount, bankReference: input.bankReference ?? null,
      notes: input.notes ?? null, createdById: context.userId,
    },
  });
  await prisma.auditLog.create({
    data: audit(context, sale.projectId, "BANK_FINANCING_DISBURSEMENT_CREATED", "BankFinancingDisbursement", disbursement.id,
      { status: disbursement.status, saleId: sale.id, disbursementType: disbursement.disbursementType, expectedAmount: disbursement.expectedAmount.toString() },
      { correlationId: newCorrelationId() }),
  });
  return disbursement;
}

export async function requestBankFinancingDisbursement(context: AuthContext, raw: RequestBankFinancingDisbursementInput) {
  assertMutable(context);
  const input = requestBankFinancingDisbursementSchema.parse(raw);
  const disbursement = await disbursementForTenant(context.organizationId, input.disbursementId);
  if (disbursement.status !== "PENDING") throw new Error("Somente repasses pendentes podem ser marcados como solicitados.");
  const result = await prisma.bankFinancingDisbursement.updateMany({ where: { id: disbursement.id, status: "PENDING" }, data: { status: "REQUESTED", requestedAt: input.requestedAt } });
  if (result.count === 0) throw new Error("O repasse não está mais pendente — outra operação o alterou primeiro.");
  await prisma.auditLog.create({
    data: audit(context, null, "BANK_FINANCING_DISBURSEMENT_REQUESTED", "BankFinancingDisbursement", disbursement.id,
      { status: "REQUESTED" }, { before: { status: disbursement.status }, correlationId: newCorrelationId() }),
  });
  return prisma.bankFinancingDisbursement.findUniqueOrThrow({ where: { id: disbursement.id } });
}

export async function recordBankFinancingDisbursementReceived(context: AuthContext, raw: RecordBankFinancingDisbursementReceivedInput) {
  assertMutable(context);
  const input = recordBankFinancingDisbursementReceivedSchema.parse(raw);
  const disbursement = await disbursementForTenant(context.organizationId, input.disbursementId);
  if (!(["PENDING", "REQUESTED"] as const).includes(disbursement.status as "PENDING" | "REQUESTED")) {
    throw new Error("Este repasse já foi liberado, conciliado ou cancelado.");
  }
  const result = await prisma.bankFinancingDisbursement.updateMany({
    where: { id: disbursement.id, status: disbursement.status },
    data: { status: "DISBURSED", disbursedAmount: input.disbursedAmount, disbursedAt: input.disbursedAt, bankReference: input.bankReference ?? disbursement.bankReference },
  });
  if (result.count === 0) throw new Error("O repasse mudou de estado — outra operação o alterou primeiro.");
  await prisma.auditLog.create({
    data: audit(context, null, "BANK_FINANCING_DISBURSEMENT_RECEIVED", "BankFinancingDisbursement", disbursement.id,
      { status: "DISBURSED", disbursedAmount: input.disbursedAmount }, { before: { status: disbursement.status }, correlationId: newCorrelationId() }),
  });
  return prisma.bankFinancingDisbursement.findUniqueOrThrow({ where: { id: disbursement.id } });
}

/**
 * Achado Médio da reauditoria 9R (corrigido): antes, qualquer `P2002` era tratado como
 * "o pagamento concorrente já existe" — reconhecia genericamente qualquer violação de
 * unicidade, de qualquer constraint, e mascarava o erro real se fosse outra causa. Esta
 * função só reconhece a colisão exata esperada: a constraint única de
 * `receivable_payments.idempotency_key` (a única unique constraint da tabela —
 * confirmado por introspecção real do Postgres, `meta.target` inclui
 * "idempotency_key"). Qualquer outro P2002 (de outra constraint) ou qualquer outro
 * código de erro é propagado sem tratamento especial.
 */
export function isIdempotencyKeyConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  if (error.meta?.modelName !== "ReceivablePayment") return false;
  const target = error.meta?.target;
  const fields = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
  return fields.includes("idempotency_key") || fields.includes("idempotencyKey");
}

/**
 * Concilia o repasse com uma parcela do recebível. Sucesso gera o `ReceivablePayment`
 * oficial via `registerReceivablePayment` (9B/9E) — herda a idempotência dessa função
 * (hash de instalment+valor+data+conta), então uma segunda chamada com os mesmos dados
 * nunca duplica o pagamento. Divergência de valor marca `DIVERGENT` e emite alerta —
 * nunca ajusta o recebível.
 */
export async function reconcileBankFinancingDisbursement(context: AuthContext, raw: ReconcileBankFinancingDisbursementInput) {
  assertMutable(context);
  const input = reconcileBankFinancingDisbursementSchema.parse(raw);
  const correlationId = newCorrelationId();
  const disbursement = await disbursementForTenant(context.organizationId, input.disbursementId);
  if (disbursement.status === "RECONCILED") return disbursement;
  if (disbursement.status !== "DISBURSED" && disbursement.status !== "DIVERGENT") {
    throw new Error("Somente repasses já liberados pelo banco podem ser conciliados.");
  }
  if (!disbursement.disbursedAmount || !disbursement.disbursedAt) throw new Error("Repasse sem valor/data de liberação registrados.");

  const installment = await prisma.receivableInstallment.findFirst({
    where: { id: input.installmentId, receivableAccount: { saleId: disbursement.saleId, organizationId: context.organizationId } },
  });
  if (!installment) throw new Error("Parcela não encontrada nesta organização para esta venda.");

  const reconciliation = evaluateDisbursementReconciliation({ disbursedAmount: disbursement.disbursedAmount.toString(), installmentAmount: installment.currentAmount.toString() });
  if (!reconciliation.matches) {
    await prisma.bankFinancingDisbursement.update({ where: { id: disbursement.id }, data: { status: "DIVERGENT" } });
    await prisma.auditLog.create({
      data: audit(context, null, "BANK_FINANCING_DISBURSEMENT_DIVERGENT", "BankFinancingDisbursement", disbursement.id,
        { status: "DIVERGENT", differenceCents: reconciliation.differenceCents, installmentId: installment.id },
        { before: { status: disbursement.status }, correlationId }),
    });
    await emitOperationalAlert({ category: "REPASSE_DIVERGENTE", severity: "warning", code: `REPASSE:${disbursement.disbursementType}`, organizationId: context.organizationId, correlationId: disbursement.id });
    return prisma.bankFinancingDisbursement.findUniqueOrThrow({ where: { id: disbursement.id } });
  }

  // `registerReceivablePayment` já é idempotente por hash (installment+valor+data+conta),
  // mas duas chamadas verdadeiramente concorrentes podem colidir na criação do mesmo
  // `ReceivablePayment` antes de qualquer uma commitar — a colisão só aparece como
  // violação de unicidade (P2002 da constraint de idempotência), não como o retorno
  // idempotente normal. Uma única retentativa é suficiente e segura: o Postgres só
  // libera a exceção depois que a transação concorrente que "ganhou" já commitou,
  // então a nova tentativa sempre encontra o pagamento já existente pela mesma chave.
  const registerPayment = () => registerReceivablePayment(context, {
    installmentId: installment.id,
    bankAccountId: input.bankAccountId,
    amount: disbursement.disbursedAmount!.toString(),
    method: "TRANSFER",
    referenceNumber: input.referenceNumber ?? disbursement.bankReference ?? undefined,
    receivedAt: disbursement.disbursedAt!,
  });
  let payment;
  try {
    payment = await registerPayment();
  } catch (error) {
    if (!isIdempotencyKeyConflict(error)) throw error;
    payment = await registerPayment();
  }

  // Nunca confia cegamente no que a retentativa devolveu: releva o registro concorrente
  // e valida organização (via o próprio installment já tenant-escopado acima),
  // parcela e valor antes de marcar RECONCILED. Se por algum motivo o pagamento
  // encontrado não corresponder, falha fechado em vez de prosseguir.
  const rereadInstallment = await prisma.receivableInstallment.findFirst({
    where: { id: installment.id, receivableAccount: { saleId: disbursement.saleId, organizationId: context.organizationId } },
  });
  if (!rereadInstallment) throw new Error("Parcela não encontrada nesta organização para esta venda.");
  if (payment.installmentId !== installment.id) throw new Error("Referência de pagamento concorrente não corresponde à parcela esperada.");
  const revalidatedReconciliation = evaluateDisbursementReconciliation({ disbursedAmount: payment.amount.toString(), installmentAmount: rereadInstallment.currentAmount.toString() });
  if (!revalidatedReconciliation.matches) throw new Error("Divergência de valor detectada ao revalidar o pagamento concorrente — conciliação recusada.");

  const result = await prisma.bankFinancingDisbursement.updateMany({
    where: { id: disbursement.id, status: { in: ["DISBURSED", "DIVERGENT"] } },
    data: { status: "RECONCILED", reconciledAt: new Date(), reconciledInstallmentId: installment.id, reconciledPaymentId: payment.id },
  });
  if (result.count > 0) {
    await prisma.auditLog.create({
      data: audit(context, null, "BANK_FINANCING_DISBURSEMENT_RECONCILED", "BankFinancingDisbursement", disbursement.id,
        { status: "RECONCILED", installmentId: installment.id, paymentId: payment.id },
        { before: { status: disbursement.status }, correlationId }),
    });
  }
  return prisma.bankFinancingDisbursement.findUniqueOrThrow({ where: { id: disbursement.id } });
}

export async function cancelBankFinancingDisbursement(context: AuthContext, raw: CancelBankFinancingDisbursementInput) {
  assertMutable(context);
  const input = cancelBankFinancingDisbursementSchema.parse(raw);
  const disbursement = await disbursementForTenant(context.organizationId, input.disbursementId);
  if (disbursement.status === "RECONCILED") throw new Error("Um repasse já conciliado não pode ser cancelado — reverta o pagamento pelo Financeiro se necessário.");
  const result = await prisma.bankFinancingDisbursement.updateMany({ where: { id: disbursement.id, status: { not: "RECONCILED" } }, data: { status: "CANCELLED", notes: input.reason } });
  if (result.count === 0) throw new Error("O repasse mudou de estado — outra operação o alterou primeiro.");
  await prisma.auditLog.create({
    data: audit(context, null, "BANK_FINANCING_DISBURSEMENT_CANCELLED", "BankFinancingDisbursement", disbursement.id,
      { status: "CANCELLED" }, { before: { status: disbursement.status }, correlationId: newCorrelationId() }),
  });
  return prisma.bankFinancingDisbursement.findUniqueOrThrow({ where: { id: disbursement.id } });
}

export async function listBankFinancingDisbursementsForSale(context: Pick<AuthContext, "organizationId">, saleId: string) {
  await saleForTenant(context.organizationId, saleId);
  return prisma.bankFinancingDisbursement.findMany({ where: { organizationId: context.organizationId, saleId }, orderBy: { createdAt: "desc" } });
}
