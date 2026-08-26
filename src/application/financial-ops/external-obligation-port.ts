import { Prisma } from "@prisma/client";

export const EXTERNAL_OBLIGATION_CONTRACT_VERSION = 1;

export interface ExternalPayableCommand {
  organizationId: string;
  companyId: string;
  projectId: string;
  supplierId: string | null;
  costCenterId?: string | null;
  economicItemId?: string | null;
  budgetLineItemId?: string | null;
  scheduleActivityId?: string | null;
  sourceType: string;
  sourceId: string;
  sourceVersion: number;
  competenceDate: Date;
  dueDate: Date;
  grossAmount: Prisma.Decimal;
  withholdings: Prisma.Decimal;
  discounts: Prisma.Decimal;
  advancesApplied: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  currency: string;
  description: string;
  responsibleId: string;
  createdById: string;
  origin?: "MEASUREMENT" | "CONTRACT" | "LEGAL" | "MANUAL" | "FUNDING";
}

export async function createExternalPayableObligation(tx: Prisma.TransactionClient, command: ExternalPayableCommand) {
  if (!command.grossAmount.sub(command.withholdings).sub(command.discounts).sub(command.advancesApplied).equals(command.netAmount)) {
    throw new Error("O payload financeiro não fecha: bruto - retenções - descontos - adiantamentos deve ser igual ao líquido.");
  }
  const obligation = await tx.financialObligation.create({
    data: {
      organizationId: command.organizationId,
      companyId: command.companyId,
      projectId: command.projectId,
      costCenterId: command.costCenterId ?? null,
      economicItemId: command.economicItemId ?? null,
      budgetLineItemId: command.budgetLineItemId ?? null,
      scheduleActivityId: command.scheduleActivityId ?? null,
      nature: "PAYABLE",
      origin: command.origin ?? "MEASUREMENT",
      documentRef: `${command.sourceType}:${command.sourceId}:v${command.sourceVersion}`,
      description: command.description,
      competenceDate: command.competenceDate,
      dueDate: command.dueDate,
      amount: command.netAmount,
      responsibleId: command.responsibleId,
      status: "CONVERTED",
      createdById: command.createdById,
    },
  });
  const payable = await tx.payableAccount.create({
    data: {
      organizationId: command.organizationId,
      companyId: command.companyId,
      projectId: command.projectId,
      costCenterId: command.costCenterId ?? null,
      economicItemId: command.economicItemId ?? null,
      budgetLineItemId: command.budgetLineItemId ?? null,
      scheduleActivityId: command.scheduleActivityId ?? null,
      obligationId: obligation.id,
      supplierId: command.supplierId,
      description: command.description,
      origin: command.origin ?? "MEASUREMENT",
      competenceMonth: command.competenceDate,
      originalAmount: command.netAmount,
      responsibleId: command.responsibleId,
      notes: `Origem externa ${command.sourceType}:${command.sourceId}; contrato v${EXTERNAL_OBLIGATION_CONTRACT_VERSION}.`,
      createdById: command.createdById,
      approvedById: command.createdById,
      approvedAt: new Date(),
      installments: {
        create: [{ number: 1, dueDate: command.dueDate, originalAmount: command.netAmount, currentAmount: command.netAmount, withholdingAmount: command.withholdings, status: "APROVADA" }],
      },
    },
  });
  return { obligationId: obligation.id, payableAccountId: payable.id, status: obligation.status };
}

export async function reverseExternalPayableObligation(tx: Prisma.TransactionClient, input: { organizationId: string; obligationId: string; reason: string }) {
  const obligation = await tx.financialObligation.findFirst({ where: { id: input.obligationId, organizationId: input.organizationId }, include: { payableAccount: { include: { installments: { include: { payments: true } } } } } });
  if (!obligation?.payableAccount) throw new Error("Obrigação externa não encontrada nesta organização.");
  const hasEffectivePayment = obligation.payableAccount.installments.some((item) => item.payments.some((payment) => ["PROCESSED", "CLEARED"].includes(payment.status)));
  if (hasEffectivePayment) throw new Error("A obrigação já possui pagamento; reverta o pagamento no Financeiro antes de anular a medição.");
  await tx.payableInstallment.updateMany({ where: { payableAccountId: obligation.payableAccount.id }, data: { status: "CANCELADA", cancelledAt: new Date(), cancelledReason: input.reason } });
  await tx.payableAccount.update({ where: { id: obligation.payableAccount.id }, data: { cancelledAt: new Date(), cancelledReason: input.reason } });
  await tx.financialObligation.update({ where: { id: obligation.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledReason: input.reason } });
}

// ---------------------------------------------------------------------------
// Espelho do lado recebível — usado pela 9E (vendas) para levar uma parcela
// comercial aprovada até um ReceivableAccount, com a mesma disciplina de
// idempotência (idempotencyKey + payloadChecksum + replay) comprovada acima.
// ---------------------------------------------------------------------------

export interface ExternalReceivableCommand {
  organizationId: string;
  companyId: string;
  projectId: string;
  customerId: string;
  costCenterId?: string | null;
  economicItemId?: string | null;
  saleId: string;
  sourceType: string;
  sourceId: string;
  sourceVersion: number;
  competenceDate: Date;
  dueDate: Date;
  netAmount: Prisma.Decimal;
  description: string;
  responsibleId?: string | null;
  createdById: string;
  unitReference?: string | null;
  contractReference?: string | null;
  origin?: "SALE" | "MANUAL";
}

export async function createExternalReceivableObligation(tx: Prisma.TransactionClient, command: ExternalReceivableCommand) {
  const obligation = await tx.financialObligation.create({
    data: {
      organizationId: command.organizationId,
      companyId: command.companyId,
      projectId: command.projectId,
      costCenterId: command.costCenterId ?? null,
      economicItemId: command.economicItemId ?? null,
      nature: "RECEIVABLE",
      origin: command.origin ?? "SALE",
      documentRef: `${command.sourceType}:${command.sourceId}:v${command.sourceVersion}`,
      description: command.description,
      competenceDate: command.competenceDate,
      dueDate: command.dueDate,
      amount: command.netAmount,
      responsibleId: command.responsibleId ?? null,
      status: "CONVERTED",
      createdById: command.createdById,
    },
  });
  const receivable = await tx.receivableAccount.create({
    data: {
      organizationId: command.organizationId,
      companyId: command.companyId,
      projectId: command.projectId,
      costCenterId: command.costCenterId ?? null,
      economicItemId: command.economicItemId ?? null,
      obligationId: obligation.id,
      customerId: command.customerId,
      saleId: command.saleId,
      unitReference: command.unitReference ?? null,
      contractReference: command.contractReference ?? null,
      description: command.description,
      origin: command.origin ?? "SALE",
      competenceMonth: command.competenceDate,
      originalAmount: command.netAmount,
      responsibleId: command.responsibleId ?? null,
      notes: `Origem externa ${command.sourceType}:${command.sourceId}; contrato v${EXTERNAL_OBLIGATION_CONTRACT_VERSION}.`,
      createdById: command.createdById,
      installments: {
        create: [{ number: 1, dueDate: command.dueDate, originalAmount: command.netAmount, currentAmount: command.netAmount, status: "EMITIDA", issuedAt: new Date() }],
      },
    },
    include: { installments: true },
  });
  return { obligationId: obligation.id, receivableAccountId: receivable.id, receivableInstallmentId: receivable.installments[0].id, status: obligation.status };
}

export async function reverseExternalReceivableObligation(tx: Prisma.TransactionClient, input: { organizationId: string; obligationId: string; reason: string }) {
  const obligation = await tx.financialObligation.findFirst({ where: { id: input.obligationId, organizationId: input.organizationId }, include: { receivableAccount: { include: { installments: { include: { payments: true } } } } } });
  if (!obligation?.receivableAccount) throw new Error("Obrigação externa não encontrada nesta organização.");
  const hasEffectivePayment = obligation.receivableAccount.installments.some((item) => item.payments.some((payment) => ["PROCESSED", "CLEARED"].includes(payment.status)));
  if (hasEffectivePayment) throw new Error("O recebível já possui recebimento; reverta o recebimento no Financeiro antes de cancelar a parcela comercial.");
  await tx.receivableInstallment.updateMany({ where: { receivableAccountId: obligation.receivableAccount.id }, data: { status: "CANCELADA", cancelledAt: new Date(), cancelledReason: input.reason } });
  await tx.receivableAccount.update({ where: { id: obligation.receivableAccount.id }, data: { cancelledAt: new Date(), cancelledReason: input.reason } });
  await tx.financialObligation.update({ where: { id: obligation.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledReason: input.reason } });
}
