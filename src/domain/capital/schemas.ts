/**
 * Fase 9N §3 — validação de entrada para propostas de funding, cenários de simulação e o ciclo de
 * vida de desembolso/covenant/condição. Mesma convenção de `domain/financial-ops/schemas.ts`
 * (valores monetários/percentuais como string/number finito, sempre coagidos para string).
 */
import { z } from "zod";

const money = z.union([z.string().trim().min(1), z.number().finite()]).transform(String)
  .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, "O valor deve ser numérico e não negativo.");

const positiveMoney = money.refine((value) => Number(value) > 0, "O valor deve ser maior que zero.");

const percentage = z.union([z.string().trim().min(1), z.number().finite()]).transform(String)
  .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100, "Informe um percentual entre 0 e 100.");

export const fundingProposalKindSchema = z.enum([
  "EQUITY_PROPRIO", "INVESTIDOR", "MUTUO", "BANCO", "FINANCIAMENTO_PRODUCAO", "SBPE", "FGTS",
  "CRI", "SECURITIZACAO", "FUNDO", "MEZANINO", "PERMUTA_FINANCEIRA", "PERMUTA_ECONOMICA", "HIBRIDO", "OUTRO",
]);

export const fundingIndexerSchema = z.enum(["CDI", "IPCA", "IGPM", "TR", "SELIC", "PRE_FIXADO", "OUTRO"]);

export const amortizationSystemSchema = z.enum(["PRICE", "SAC", "BULLET"]);

/** Hoje só MONTHLY é suportado por `buildDebtServiceSchedule` — ver comentário em `schema.prisma`. */
export const paymentFrequencySchema = z.literal("MONTHLY");

const disbursementScheduleEntrySchema = z.object({
  month: z.number().int().min(0),
  amount: positiveMoney,
});

const fundingGuaranteeSchema = z.object({
  type: z.enum(["GARANTIA_REAL", "CESSAO_FIDUCIARIA", "RECEBIVEIS", "QUOTAS_ACOES", "AVAL_FIANCA", "CONTA_VINCULADA", "OUTRA"]),
  description: z.string().trim().min(1).max(500),
  amount: money.nullable().optional(),
  beneficiary: z.string().trim().max(200).nullable().optional(),
  evidenceDocumentIds: z.array(z.string().min(1)).default([]),
});

const fundingCovenantSchema = z.object({
  code: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(500),
  metric: z.string().trim().min(1).max(120),
  thresholdOperator: z.enum([">=", "<=", ">", "<", "="]),
  thresholdValue: z.string().trim().min(1).max(60),
  periodicity: z.string().trim().min(1).max(60),
  nextTestDate: z.coerce.date().nullable().optional(),
});

const fundingConditionSchema = z.object({
  code: z.string().trim().min(1).max(60),
  category: z.enum(["DOCUMENTO", "LICENCA", "REGISTRO", "GARANTIA", "SEGURO", "APORTE", "VENDA_MINIMA", "OBRA_MINIMA", "OUTRO"]),
  description: z.string().trim().min(1).max(500),
  dueAt: z.coerce.date().nullable().optional(),
  responsibleId: z.string().min(1).nullable().optional(),
  sourceType: z.string().trim().max(60).nullable().optional(),
  sourceId: z.string().trim().min(1).nullable().optional(),
});

const fundingProposalCoreSchema = z.object({
  projectId: z.string().min(1),
  code: z.string().trim().min(1).max(60),
  providerName: z.string().trim().min(1).max(200),
  kind: fundingProposalKindSchema,
  amount: positiveMoney,
  currency: z.string().trim().length(3).default("BRL"),
  indexer: fundingIndexerSchema,
  spreadRate: percentage,
  indexerRateSnapshot: percentage.nullable().optional(),
  termMonths: z.number().int().positive().max(600),
  graceMonths: z.number().int().min(0),
  amortizationSystem: amortizationSystemSchema,
  paymentFrequency: paymentFrequencySchema.default("MONTHLY"),
  upfrontFeeRate: percentage.default("0"),
  recurringFeeRateAnnual: percentage.default("0"),
  iofRate: percentage.nullable().optional(),
  disbursementSchedule: z.array(disbursementScheduleEntrySchema).min(1).optional(),
  validUntil: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  guarantees: z.array(fundingGuaranteeSchema).default([]),
  covenants: z.array(fundingCovenantSchema).default([]),
  conditions: z.array(fundingConditionSchema).default([]),
});

export const registerFundingProposalSchema = fundingProposalCoreSchema.refine((input) => input.graceMonths < input.termMonths, {
  message: "A carência deve ser menor que o prazo total.",
  path: ["graceMonths"],
}).refine((input) => input.indexer === "PRE_FIXADO" || input.indexerRateSnapshot !== null, {
  message: "Informe a taxa do indexador capturada no registro (indexerRateSnapshot), exceto para PRE_FIXADO.",
  path: ["indexerRateSnapshot"],
});

/** Só os campos econômicos/registráveis mudam numa nova versão — `code`/`projectId` são herdados da versão anterior. */
export const reviseFundingProposalSchema = fundingProposalCoreSchema.omit({ projectId: true, code: true }).partial({
  guarantees: true, covenants: true, conditions: true,
});

export const fundingScenarioKindSchema = z.enum(["NO_FUNDING", "EQUITY", "DEBT", "HYBRID", "PROPOSAL_COMPARISON"]);

export const simulateFundingScenarioSchema = z.object({
  projectId: z.string().min(1),
  kind: fundingScenarioKindSchema,
  proposalIds: z.array(z.string().min(1)).default([]),
});

export const scheduleFundingDisbursementSchema = z.object({
  proposalId: z.string().min(1),
  sequence: z.number().int().positive(),
  expectedDate: z.coerce.date(),
  expectedAmount: positiveMoney,
});

export const confirmFundingDisbursementSchema = z.object({
  disbursementId: z.string().min(1),
  bankTransactionId: z.string().min(1),
});

export const evaluateFundingCovenantSchema = z.object({
  covenantId: z.string().min(1),
  testedAt: z.coerce.date(),
  observedValue: z.string().trim().min(1).max(60),
  result: z.enum(["OK", "WARNING", "BREACHED", "WAIVED"]),
  evidence: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const updateFundingConditionStatusSchema = z.object({
  conditionId: z.string().min(1),
  status: z.enum(["SATISFIED", "WAIVED", "REJECTED"]),
  evidence: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type RegisterFundingProposalInput = z.input<typeof registerFundingProposalSchema>;
export type ReviseFundingProposalInput = z.input<typeof reviseFundingProposalSchema>;
export type SimulateFundingScenarioInput = z.input<typeof simulateFundingScenarioSchema>;
export type ScheduleFundingDisbursementInput = z.input<typeof scheduleFundingDisbursementSchema>;
export type ConfirmFundingDisbursementInput = z.input<typeof confirmFundingDisbursementSchema>;
export type EvaluateFundingCovenantInput = z.input<typeof evaluateFundingCovenantSchema>;
export type UpdateFundingConditionStatusInput = z.input<typeof updateFundingConditionStatusSchema>;
