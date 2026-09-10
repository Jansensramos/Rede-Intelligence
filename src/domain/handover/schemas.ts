import { z } from "zod";

const decimal = z.union([z.string().trim().min(1), z.number().finite()]).transform(String)
  .refine((value) => Number.isFinite(Number(value)), "Informe um número válido.");
const nonNegativeDecimal = decimal.refine((value) => Number(value) >= 0, "O valor não pode ser negativo.");
const positiveDecimal = decimal.refine((value) => Number(value) > 0, "O valor deve ser maior que zero.");
const optionalId = z.string().min(1).nullable().optional();

// ---------------------------------------------------------------------------
// Repasse bancário (BankFinancingDisbursement)
// ---------------------------------------------------------------------------

export const createBankFinancingDisbursementSchema = z.object({
  saleId: z.string().min(1),
  financialInstitutionId: z.string().min(1),
  disbursementType: z.enum(["FINANCING", "FGTS", "SUBSIDY", "OTHER"]),
  expectedAmount: positiveDecimal,
  bankReference: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const requestBankFinancingDisbursementSchema = z.object({
  disbursementId: z.string().min(1),
  requestedAt: z.coerce.date(),
});

export const recordBankFinancingDisbursementReceivedSchema = z.object({
  disbursementId: z.string().min(1),
  disbursedAmount: positiveDecimal,
  disbursedAt: z.coerce.date(),
  bankReference: z.string().trim().max(200).nullable().optional(),
});

export const reconcileBankFinancingDisbursementSchema = z.object({
  disbursementId: z.string().min(1),
  installmentId: z.string().min(1),
  // Reaproveita `registerReceivablePayment` (9B/9E) — a conta bancária de destino e a
  // referência ficam no `ReceivablePayment` reaproveitado, nunca duplicadas aqui.
  bankAccountId: z.string().min(1),
  referenceNumber: z.string().trim().max(80).nullable().optional(),
});

export const cancelBankFinancingDisbursementSchema = z.object({
  disbursementId: z.string().min(1),
  reason: z.string().trim().min(1).max(2000),
});

// ---------------------------------------------------------------------------
// Chaves — implantação do condomínio (CondominiumSetup)
// ---------------------------------------------------------------------------

export const createCondominiumSetupSchema = z.object({
  projectId: z.string().min(1),
  responsibleId: z.string().min(1),
  administratorSupplierId: optionalId,
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const transitionCondominiumSetupSchema = z.object({
  condominiumSetupId: z.string().min(1),
  status: z.enum(["PLANNED", "IN_PROGRESS", "IMPLEMENTED", "CANCELLED"]),
  administratorSupplierId: optionalId,
  constitutedAt: z.coerce.date().nullable().optional(),
  transferredAt: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Assistência técnica — extensão de PostSaleRequest/PostSaleUpdate (9E)
// ---------------------------------------------------------------------------

export const assignPostSaleSupplierSchema = z.object({
  requestId: z.string().min(1),
  supplierId: z.string().min(1).nullable(),
});

export const setPostSaleCostSchema = z.object({
  requestId: z.string().min(1),
  estimatedCost: nonNegativeDecimal.nullable().optional(),
  actualCost: nonNegativeDecimal.nullable().optional(),
});

export const markPostSaleRecurrenceSchema = z.object({
  requestId: z.string().min(1),
  recurrenceOfId: z.string().min(1),
});

export const addPostSaleEvidenceSchema = z.object({
  requestId: z.string().min(1),
  evidenceKind: z.enum(["BEFORE", "AFTER"]),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  note: z.string().trim().max(2000).nullable().optional(),
});

export type CreateBankFinancingDisbursementInput = z.input<typeof createBankFinancingDisbursementSchema>;
export type RequestBankFinancingDisbursementInput = z.input<typeof requestBankFinancingDisbursementSchema>;
export type RecordBankFinancingDisbursementReceivedInput = z.input<typeof recordBankFinancingDisbursementReceivedSchema>;
export type ReconcileBankFinancingDisbursementInput = z.input<typeof reconcileBankFinancingDisbursementSchema>;
export type CancelBankFinancingDisbursementInput = z.input<typeof cancelBankFinancingDisbursementSchema>;
export type CreateCondominiumSetupInput = z.input<typeof createCondominiumSetupSchema>;
export type TransitionCondominiumSetupInput = z.input<typeof transitionCondominiumSetupSchema>;
export type AssignPostSaleSupplierInput = z.input<typeof assignPostSaleSupplierSchema>;
export type SetPostSaleCostInput = z.input<typeof setPostSaleCostSchema>;
export type MarkPostSaleRecurrenceInput = z.input<typeof markPostSaleRecurrenceSchema>;
export type AddPostSaleEvidenceInput = z.input<typeof addPostSaleEvidenceSchema>;
