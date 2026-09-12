import { z } from "zod";

const decimal = z.union([z.string().trim().min(1), z.number().finite()]).transform(String)
  .refine((value) => Number.isFinite(Number(value)), "Informe um número válido.");
const positiveDecimal = decimal.refine((value) => Number(value) > 0, "O valor deve ser maior que zero.");

// ---------------------------------------------------------------------------
// Resultado realizado final (ProjectClosureResult)
// ---------------------------------------------------------------------------

export const prepareProjectClosureResultSchema = z.object({
  projectId: z.string().min(1),
});

export const approveProjectClosureResultSchema = z.object({
  closureResultId: z.string().min(1),
});

/** Decisão 3: reabertura exige justificativa e evidência — nunca sobrescreve o snapshot FINAL. */
export const reopenProjectClosureResultSchema = z.object({
  closureResultId: z.string().min(1),
  reason: z.string().trim().min(1).max(2000),
  evidenceRefs: z.array(z.record(z.string(), z.unknown())).min(1),
});

// ---------------------------------------------------------------------------
// Distribuição final simples (ProjectClosureDistribution)
// ---------------------------------------------------------------------------

export const createProjectClosureDistributionSchema = z.object({
  closureResultId: z.string().min(1),
  beneficiaryName: z.string().trim().min(1).max(200),
  beneficiaryTaxId: z.string().trim().min(1).max(32),
  beneficiaryType: z.enum(["OWNER", "PARTNER", "INVESTOR"]),
  nature: z.enum(["CAPITAL_CONTRIBUTION", "CAPITAL_RETURN", "REMUNERATION", "RESULT_DISTRIBUTION", "RETENTION", "PROVISION"]),
  amount: positiveDecimal,
  eventDate: z.coerce.date(),
  // Decisão 6: origem nunca inferida — sempre uma referência explícita informada por quem registra.
  sourceType: z.string().trim().min(1).max(80),
  sourceId: z.string().trim().min(1).max(200),
  evidenceRefs: z.array(z.record(z.string(), z.unknown())).min(1),
});

export const approveProjectClosureDistributionSchema = z.object({
  distributionId: z.string().min(1),
});

export type PrepareProjectClosureResultInput = z.input<typeof prepareProjectClosureResultSchema>;
export type ApproveProjectClosureResultInput = z.input<typeof approveProjectClosureResultSchema>;
export type ReopenProjectClosureResultInput = z.input<typeof reopenProjectClosureResultSchema>;
export type CreateProjectClosureDistributionInput = z.input<typeof createProjectClosureDistributionSchema>;
export type ApproveProjectClosureDistributionInput = z.input<typeof approveProjectClosureDistributionSchema>;
