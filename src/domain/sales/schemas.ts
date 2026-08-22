import { z } from "zod";

const decimal = z.union([z.string().trim().min(1), z.number().finite()]).transform(String)
  .refine((value) => Number.isFinite(Number(value)), "Informe um número válido.");
const nonNegativeDecimal = decimal.refine((value) => Number(value) >= 0, "O valor não pode ser negativo.");
const positiveDecimal = decimal.refine((value) => Number(value) > 0, "O valor deve ser maior que zero.");
const optionalId = z.string().min(1).nullable().optional();

export const createSalesUnitSchema = z.object({
  projectId: z.string().min(1), companyId: z.string().min(1), operatingUnitId: optionalId, detectedUnitId: optionalId,
  code: z.string().trim().min(1).max(40), floor: z.string().trim().max(20).nullable().optional(), typology: z.string().trim().min(1).max(80),
  privateAreaM2: positiveDecimal, totalAreaM2: nonNegativeDecimal.nullable().optional(), parkingSpaces: z.number().int().min(0).default(0),
  storageUnits: z.number().int().min(0).default(0), position: z.string().trim().max(120).nullable().optional(), characteristics: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const createSalesUnitBlockSchema = z.object({
  salesUnitId: z.string().min(1), origin: z.enum(["PERMUTA", "JURIDICO", "DIRETORIA", "INCORPORACAO", "COMERCIAL", "TECNICA", "OUTRO"]),
  responsibleId: z.string().min(1), reason: z.string().trim().min(1).max(2000),
});

export const createSalesPriceTableSchema = z.object({
  projectId: z.string().min(1), companyId: z.string().min(1), validFrom: z.coerce.date(), validUntil: z.coerce.date().nullable().optional(),
  responsibleId: z.string().min(1), notes: z.string().trim().max(2000).nullable().optional(),
  lines: z.array(z.object({ salesUnitId: z.string().min(1), listPrice: positiveDecimal, minimumAuthorizedPrice: nonNegativeDecimal.nullable().optional() })).min(1),
});

export const createSalesLeadSchema = z.object({
  projectId: optionalId, name: z.string().trim().min(1).max(200), contact: z.string().trim().min(1).max(200), source: z.string().trim().min(1).max(80),
  channel: z.string().trim().max(80).nullable().optional(), brokerId: optionalId,
});

export const convertSalesLeadSchema = z.object({ leadId: z.string().min(1), customerId: z.string().min(1) });

export const createBrokerProfileSchema = z.object({
  supplierId: z.string().min(1), creci: z.string().trim().max(40).nullable().optional(), parentAgencyId: optionalId,
  defaultCommissionRate: nonNegativeDecimal.nullable().optional(), channel: z.string().trim().max(80).nullable().optional(),
});

export const createSalesProposalSchema = z.object({
  salesUnitId: z.string().min(1), customerId: z.string().min(1), brokerId: optionalId, priceTableId: z.string().min(1),
  proposedPrice: positiveDecimal, discountAmount: nonNegativeDecimal.default("0"), paymentConditionSummary: z.record(z.string(), z.unknown()).default({}),
  validUntil: z.coerce.date(),
});

export const createSalesReservationSchema = z.object({
  salesUnitId: z.string().min(1), customerId: z.string().min(1), proposalId: optionalId, expiresAt: z.coerce.date(),
  responsibleId: z.string().min(1), condition: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const saleInstallmentSchema = z.object({
  number: z.number().int().positive(), nature: z.enum(["DOWN_PAYMENT", "MONTHLY", "INTERMEDIATE", "ANNUAL", "KEYS", "FINANCING", "BALANCE", "REINFORCEMENT", "CUSTOM"]),
  dueDate: z.coerce.date(), amount: positiveDecimal, correctionRuleId: optionalId,
});

export const createSaleSchema = z.object({
  salesUnitId: z.string().min(1), priceTableId: z.string().min(1), proposalId: optionalId, reservationId: optionalId, brokerId: optionalId,
  soldPrice: positiveDecimal, incentiveAmount: nonNegativeDecimal.default("0"), tradeInValue: nonNegativeDecimal.nullable().optional(),
  commercialConditionSnapshot: z.record(z.string(), z.unknown()).default({}),
  parties: z.array(z.object({ customerId: z.string().min(1), role: z.enum(["BUYER", "CO_BUYER", "REPRESENTATIVE", "GUARANTOR"]), ownershipPercentage: nonNegativeDecimal.nullable().optional() })).min(1),
});

export const approveSaleSchema = z.object({
  saleId: z.string().min(1),
  contract: z.object({ number: z.string().trim().min(1).max(40), title: z.string().trim().min(1).max(200), commercialCondition: z.record(z.string(), z.unknown()).default({}), effectiveFrom: z.coerce.date().nullable().optional() }),
  installments: z.array(saleInstallmentSchema).min(1),
});

export const renegotiatePaymentPlanSchema = z.object({
  saleId: z.string().min(1), reason: z.string().trim().min(1).max(2000), installments: z.array(saleInstallmentSchema).min(1),
});

export const rescindSaleSchema = z.object({
  saleId: z.string().min(1), reason: z.string().trim().min(1).max(2000), retentionRate: nonNegativeDecimal.default("0"),
});

export const createSalesCommissionPolicySchema = z.object({
  projectId: optionalId, triggerEvent: z.enum(["SIGNATURE", "DOWN_PAYMENT_PAID", "RECEIPT", "MILESTONE", "OTHER"]).default("SIGNATURE"),
  percentage: nonNegativeDecimal, basis: z.enum(["SOLD_PRICE", "RECEIVED_AMOUNT"]).default("SOLD_PRICE"),
});

export const createSalesCommissionSchema = z.object({
  saleId: z.string().min(1), brokerId: z.string().min(1), policyId: optionalId, basis: z.enum(["SOLD_PRICE", "RECEIVED_AMOUNT"]).default("SOLD_PRICE"),
  percentage: nonNegativeDecimal, triggerEvent: z.enum(["SIGNATURE", "DOWN_PAYMENT_PAID", "RECEIPT", "MILESTONE", "OTHER"]).default("SIGNATURE"),
});

export const scheduleInspectionSchema = z.object({
  salesUnitId: z.string().min(1), saleId: z.string().min(1), scheduledAt: z.coerce.date(), responsibleId: z.string().min(1),
  checklist: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const recordInspectionOutcomeSchema = z.object({
  inspectionId: z.string().min(1), outcome: z.enum(["ACCEPTED", "ACCEPTED_WITH_PENDING", "REJECTED"]),
  pendingIssues: z.array(z.record(z.string(), z.unknown())).default([]), nextInspectionAt: z.coerce.date().nullable().optional(),
});

export const createPostSaleRequestSchema = z.object({
  salesUnitId: z.string().min(1), saleId: z.string().min(1), customerId: z.string().min(1),
  category: z.enum(["GARANTIA", "ASSISTENCIA", "OCORRENCIA", "OUTRO"]), description: z.string().trim().min(1).max(4000),
  responsibleId: optionalId, slaDueAt: z.coerce.date().nullable().optional(),
});

export const addPostSaleUpdateSchema = z.object({ requestId: z.string().min(1), note: z.string().trim().min(1).max(4000) });
export const transitionPostSaleRequestSchema = z.object({ requestId: z.string().min(1), status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"]) });

export type CreateSalesUnitInput = z.input<typeof createSalesUnitSchema>;
export type CreateSalesUnitBlockInput = z.input<typeof createSalesUnitBlockSchema>;
export type CreateSalesPriceTableInput = z.input<typeof createSalesPriceTableSchema>;
export type CreateSalesLeadInput = z.input<typeof createSalesLeadSchema>;
export type ConvertSalesLeadInput = z.input<typeof convertSalesLeadSchema>;
export type CreateBrokerProfileInput = z.input<typeof createBrokerProfileSchema>;
export type CreateSalesProposalInput = z.input<typeof createSalesProposalSchema>;
export type CreateSalesReservationInput = z.input<typeof createSalesReservationSchema>;
export type CreateSaleInput = z.input<typeof createSaleSchema>;
export type ApproveSaleInput = z.input<typeof approveSaleSchema>;
export type RenegotiatePaymentPlanInput = z.input<typeof renegotiatePaymentPlanSchema>;
export type RescindSaleInput = z.input<typeof rescindSaleSchema>;
export type CreateSalesCommissionPolicyInput = z.input<typeof createSalesCommissionPolicySchema>;
export type CreateSalesCommissionInput = z.input<typeof createSalesCommissionSchema>;
export type ScheduleInspectionInput = z.input<typeof scheduleInspectionSchema>;
export type RecordInspectionOutcomeInput = z.input<typeof recordInspectionOutcomeSchema>;
export type CreatePostSaleRequestInput = z.input<typeof createPostSaleRequestSchema>;
export type AddPostSaleUpdateInput = z.input<typeof addPostSaleUpdateSchema>;
export type TransitionPostSaleRequestInput = z.input<typeof transitionPostSaleRequestSchema>;
