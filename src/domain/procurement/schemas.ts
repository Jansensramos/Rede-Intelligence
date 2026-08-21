import { z } from "zod";

const decimal = z.union([z.string().trim().min(1), z.number().finite()]).transform(String)
  .refine((value) => Number.isFinite(Number(value)), "Informe um número válido.");
const positiveDecimal = decimal.refine((value) => Number(value) > 0, "O valor deve ser maior que zero.");
const nonNegativeDecimal = decimal.refine((value) => Number(value) >= 0, "O valor não pode ser negativo.");
const optionalId = z.string().min(1).nullable().optional();

export const createNeedSchema = z.object({
  projectId: z.string().min(1), companyId: optionalId, operatingUnitId: optionalId, costCenterId: optionalId,
  economicItemId: optionalId, budgetLineItemId: optionalId, scheduleActivityId: optionalId,
  code: z.string().trim().min(1).max(40), description: z.string().trim().min(1).max(300), specification: z.string().trim().min(1).max(10000),
  quantity: positiveDecimal, unit: z.string().trim().min(1).max(30), requiredAt: z.coerce.date(), expectedLeadDays: z.number().int().min(0).max(3650).default(30),
  bufferDays: z.number().int().min(0).max(365).default(7), priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).default("NORMAL"),
  origin: z.enum(["BUDGET", "ENGINEERING", "SCHEDULE", "BIM", "VALUE_ENGINEERING", "MANUAL", "OTHER"]).default("MANUAL"),
  originReference: z.string().trim().max(200).nullable().optional(), originMetadata: z.record(z.string(), z.unknown()).nullable().optional(), technicalOwnerId: optionalId,
});

export const createRequisitionSchema = z.object({
  projectId: z.string().min(1), companyId: optionalId, number: z.string().trim().min(1).max(40), title: z.string().trim().min(1).max(200),
  justification: z.string().trim().max(5000).nullable().optional(), buyerId: optionalId, technicalOwnerId: optionalId,
  needIds: z.array(z.string().min(1)).min(1).max(100),
});

export const createQuotationSchema = z.object({
  requisitionId: z.string().min(1), number: z.string().trim().min(1).max(40), title: z.string().trim().min(1).max(200),
  scope: z.string().trim().min(1).max(20000), requirements: z.record(z.string(), z.unknown()).default({}), deliveryLocation: z.string().trim().max(300).nullable().optional(),
  deliveryTerm: z.string().trim().max(300).nullable().optional(), responseDeadline: z.coerce.date().nullable().optional(), supplierIds: z.array(z.string().min(1)).min(1).max(50),
});

export const createProposalSchema = z.object({
  quotationProcessId: z.string().min(1), supplierId: z.string().min(1), previousProposalId: optionalId, version: z.number().int().positive().default(1),
  taxAmount: nonNegativeDecimal.default("0"), freightAmount: nonNegativeDecimal.default("0"), discountAmount: nonNegativeDecimal.default("0"),
  validityUntil: z.coerce.date().nullable().optional(), deliveryTermDays: z.number().int().min(0).nullable().optional(), paymentTerms: z.string().trim().max(1000).nullable().optional(),
  warrantyTerms: z.string().trim().max(1000).nullable().optional(), inclusions: z.array(z.string()).default([]), exclusions: z.array(z.string()).default([]), notes: z.string().trim().max(5000).nullable().optional(),
  items: z.array(z.object({ requisitionItemId: z.string().min(1), description: z.string().trim().min(1).max(500), quantity: positiveDecimal, unit: z.string().trim().min(1).max(30), unitPrice: nonNegativeDecimal,
    taxAmount: nonNegativeDecimal.default("0"), freightAmount: nonNegativeDecimal.default("0"), discountAmount: nonNegativeDecimal.default("0"),
    comparability: z.enum(["COMPARABLE", "COMPARABLE_WITH_ADJUSTMENTS", "NOT_COMPARABLE"]).default("COMPARABLE"), inclusions: z.array(z.string()).default([]), exclusions: z.array(z.string()).default([]), technicalNotes: z.string().trim().max(3000).nullable().optional() })).min(1),
});

const instrumentItem = z.object({
  economicItemId: optionalId, budgetLineItemId: optionalId, costCenterId: optionalId, operatingUnitId: optionalId, scheduleActivityId: optionalId,
  code: z.string().trim().min(1).max(40).optional(), description: z.string().trim().min(1).max(500), quantity: positiveDecimal, unit: z.string().trim().min(1).max(30), unitPrice: nonNegativeDecimal,
});

export const createPurchaseOrderSchema = z.object({
  projectId: z.string().min(1), companyId: z.string().min(1), supplierId: z.string().min(1), quotationProcessId: optionalId, selectedProposalId: optionalId,
  number: z.string().trim().min(1).max(40), title: z.string().trim().min(1).max(200), scope: z.string().trim().min(1).max(10000), deliveryAt: z.coerce.date().nullable().optional(),
  paymentTerms: z.string().trim().max(1000).nullable().optional(), items: z.array(instrumentItem).min(1),
});

export const createContractSchema = z.object({
  projectId: z.string().min(1), companyId: z.string().min(1), supplierId: z.string().min(1), quotationProcessId: optionalId, selectedProposalId: optionalId,
  number: z.string().trim().min(1).max(40), title: z.string().trim().min(1).max(200), type: z.enum(["SUPPLY", "SERVICE", "CONSTRUCTION", "DESIGN", "CONSULTING", "LEASE", "ACQUISITION", "OTHER"]),
  billingModel: z.enum(["MEASUREMENT", "FIXED_INSTALLMENT", "MONTHLY", "MILESTONE", "DELIVERY", "ADVANCE", "CUSTOM"]), scope: z.string().trim().min(1).max(20000),
  startsAt: z.coerce.date(), endsAt: z.coerce.date(), responsibleId: z.string().min(1), paymentTerms: z.string().trim().max(1000).nullable().optional(), readjustmentRuleId: optionalId,
  retentionRate: nonNegativeDecimal.default("0"), warrantyTerms: z.string().trim().max(1000).nullable().optional(), items: z.array(instrumentItem.extend({ code: z.string().trim().min(1).max(40) })).min(1),
});

export const createAmendmentSchema = z.object({
  contractId: z.string().min(1), number: z.number().int().positive(), type: z.enum(["INCREASE", "SUPPRESSION", "TERM", "SCOPE", "READJUSTMENT", "OTHER"]),
  reason: z.string().trim().min(1).max(10000), deviationCause: z.enum(["PRICE", "QUANTITY", "SCOPE", "TERM", "DESIGN", "BUDGET_ERROR", "MARKET", "SUPPLIER", "REWORK", "PRODUCTIVITY", "UNFORESEEN_CONDITION", "LEGAL_CHANGE", "OTHER"]),
  scopeDescription: z.string().trim().max(10000).nullable().optional(), value: nonNegativeDecimal.default("0"), termDays: z.number().int().default(0), effectiveAt: z.coerce.date().nullable().optional(),
});

export const createMeasurementSchema = z.object({
  contractId: z.string().min(1), number: z.number().int().positive(), version: z.number().int().positive().default(1), competenceDate: z.coerce.date(), periodStart: z.coerce.date(), periodEnd: z.coerce.date(), issuedAt: z.coerce.date(), dueDate: z.coerce.date(),
  physicalProgress: nonNegativeDecimal.nullable().optional(), retentionAmount: nonNegativeDecimal.default("0"), discountAmount: nonNegativeDecimal.default("0"), advanceAmortizationAmount: nonNegativeDecimal.default("0"),
  lines: z.array(z.object({ contractItemId: z.string().min(1), periodQuantity: positiveDecimal })).min(1),
});

export type CreateNeedInput = z.input<typeof createNeedSchema>;
export type CreateRequisitionInput = z.input<typeof createRequisitionSchema>;
export type CreateQuotationInput = z.input<typeof createQuotationSchema>;
export type CreateProposalInput = z.input<typeof createProposalSchema>;
export type CreateContractInput = z.input<typeof createContractSchema>;
export type CreatePurchaseOrderInput = z.input<typeof createPurchaseOrderSchema>;
export type CreateAmendmentInput = z.input<typeof createAmendmentSchema>;
export type CreateMeasurementInput = z.input<typeof createMeasurementSchema>;
