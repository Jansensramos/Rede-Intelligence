import { z } from "zod";

const money = z.union([z.string().trim().min(1), z.number().finite()]).transform(String)
  .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, "O valor deve ser numérico e não negativo.");

const positiveMoney = money.refine((value) => Number(value) > 0, "O valor deve ser maior que zero.");

const installmentInputSchema = z.object({
  number: z.number().int().positive().optional(),
  dueDate: z.coerce.date(),
  amount: positiveMoney,
});

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1).max(200),
  legalName: z.string().trim().max(200).nullable().optional(),
  taxId: z.string().trim().max(32).nullable().optional(),
  personType: z.enum(["INDIVIDUAL", "LEGAL_ENTITY"]).default("LEGAL_ENTITY"),
  email: z.string().trim().email().max(200).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  bankData: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  personType: z.enum(["INDIVIDUAL", "LEGAL_ENTITY"]).default("INDIVIDUAL"),
  taxId: z.string().trim().max(32).nullable().optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
});

export const createBankAccountSchema = z.object({
  companyId: z.string().min(1),
  projectId: z.string().min(1).nullable().optional(),
  institutionName: z.string().trim().min(1).max(120),
  agency: z.string().trim().min(1).max(20),
  accountNumber: z.string().trim().min(1).max(30),
  holderName: z.string().trim().min(1).max(200),
  type: z.enum(["OPERATIONAL", "COLLECTIONS", "PAYMENTS", "FUNDING", "LINKED", "ESCROW", "RESERVE", "INVESTMENT", "OTHER"]).default("OPERATIONAL"),
  restriction: z.enum(["FREE", "RESTRICTED"]).default("FREE"),
  currency: z.string().trim().length(3).default("BRL"),
  openingBalance: money.default("0"),
});

export const createPayableAccountSchema = z.object({
  projectId: z.string().min(1),
  companyId: z.string().min(1).nullable().optional(),
  costCenterId: z.string().min(1).nullable().optional(),
  economicItemId: z.string().min(1).nullable().optional(),
  budgetLineItemId: z.string().min(1).nullable().optional(),
  scheduleActivityId: z.string().min(1).nullable().optional(),
  supplierId: z.string().min(1).nullable().optional(),
  documentNumber: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().min(1).max(300),
  origin: z.enum(["MANUAL", "BUDGET", "CONTRACT", "MEASUREMENT", "PURCHASE", "SALE", "TAX", "FUNDING", "LEGAL", "INTERCOMPANY", "INTEGRATION", "OTHER"]).default("MANUAL"),
  competenceMonth: z.coerce.date(),
  responsibleId: z.string().min(1).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  installments: z.array(installmentInputSchema).min(1),
});

export const createReceivableAccountSchema = z.object({
  projectId: z.string().min(1),
  companyId: z.string().min(1).nullable().optional(),
  costCenterId: z.string().min(1).nullable().optional(),
  economicItemId: z.string().min(1).nullable().optional(),
  customerId: z.string().min(1).nullable().optional(),
  unitReference: z.string().trim().max(120).nullable().optional(),
  contractReference: z.string().trim().max(120).nullable().optional(),
  documentNumber: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().min(1).max(300),
  origin: z.enum(["MANUAL", "BUDGET", "CONTRACT", "MEASUREMENT", "PURCHASE", "SALE", "TAX", "FUNDING", "LEGAL", "INTERCOMPANY", "INTEGRATION", "OTHER"]).default("SALE"),
  competenceMonth: z.coerce.date(),
  responsibleId: z.string().min(1).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  installments: z.array(installmentInputSchema).min(1),
});

export const registerPayablePaymentSchema = z.object({
  installmentId: z.string().min(1),
  bankAccountId: z.string().min(1),
  amount: positiveMoney,
  method: z.enum(["TRANSFER", "BOLETO", "CHEQUE", "CASH", "CARD", "PIX", "OTHER"]).default("TRANSFER"),
  referenceNumber: z.string().trim().max(80).nullable().optional(),
  paidAt: z.coerce.date(),
});

export const registerReceivablePaymentSchema = z.object({
  installmentId: z.string().min(1),
  bankAccountId: z.string().min(1),
  amount: positiveMoney,
  method: z.enum(["TRANSFER", "BOLETO", "CHEQUE", "CASH", "CARD", "PIX", "OTHER"]).default("PIX"),
  referenceNumber: z.string().trim().max(80).nullable().optional(),
  receivedAt: z.coerce.date(),
});

export const importBankTransactionSchema = z.object({
  occurredAt: z.coerce.date(),
  amount: positiveMoney,
  direction: z.enum(["DEBIT", "CREDIT"]),
  description: z.string().trim().min(1).max(300),
  counterparty: z.string().trim().max(200).nullable().optional(),
  documentRef: z.string().trim().max(120).nullable().optional(),
  externalId: z.string().trim().max(120).nullable().optional(),
});

export const importBankTransactionsSchema = z.object({
  bankAccountId: z.string().min(1),
  origin: z.enum(["MANUAL", "IMPORT_OFX", "IMPORT_CSV", "API"]).default("MANUAL"),
  importBatchId: z.string().trim().max(80).nullable().optional(),
  transactions: z.array(importBankTransactionSchema).min(1).max(5000),
});

export const createFinancialTransferSchema = z.object({
  fromBankAccountId: z.string().min(1),
  toBankAccountId: z.string().min(1),
  amount: positiveMoney,
  transferredAt: z.coerce.date(),
  description: z.string().trim().max(300).nullable().optional(),
});

export const createIntercompanyTransactionSchema = z.object({
  fromCompanyId: z.string().min(1),
  toCompanyId: z.string().min(1),
  fromProjectId: z.string().min(1).nullable().optional(),
  toProjectId: z.string().min(1).nullable().optional(),
  amount: positiveMoney,
  occurredAt: z.coerce.date(),
  nature: z.enum(["APORTE", "MUTUO", "ADIANTAMENTO", "RATEIO", "REEMBOLSO", "TRANSFERENCIA", "OUTRA"]).default("APORTE"),
  referenceNumber: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(300).nullable().optional(),
});

export const applyCorrectionSchema = z.object({
  installmentId: z.string().min(1),
  indexPercentage: z.number().finite().default(0),
  interestRatePerMonth: z.number().finite().min(0).default(0),
  monthsLate: z.number().finite().min(0).default(0),
  fineRate: z.number().finite().min(0).default(0),
  discountAmount: z.number().finite().min(0).default(0),
  referencePeriod: z.string().trim().min(1).max(20),
  indexName: z.enum(["IPCA", "INCC", "IGP_M", "CUSTOM"]).nullable().optional(),
});

export type CreateSupplierInput = z.input<typeof createSupplierSchema>;
export type CreateCustomerInput = z.input<typeof createCustomerSchema>;
export type CreateBankAccountInput = z.input<typeof createBankAccountSchema>;
export type CreatePayableAccountInput = z.input<typeof createPayableAccountSchema>;
export type CreateReceivableAccountInput = z.input<typeof createReceivableAccountSchema>;
export type RegisterPayablePaymentInput = z.input<typeof registerPayablePaymentSchema>;
export type RegisterReceivablePaymentInput = z.input<typeof registerReceivablePaymentSchema>;
export type ImportBankTransactionsInput = z.input<typeof importBankTransactionsSchema>;
export type CreateFinancialTransferInput = z.input<typeof createFinancialTransferSchema>;
export type CreateIntercompanyTransactionInput = z.input<typeof createIntercompanyTransactionSchema>;
export type ApplyCorrectionInput = z.input<typeof applyCorrectionSchema>;
