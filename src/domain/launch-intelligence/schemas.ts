import { z } from "zod";
import { LAUNCH_METRIC_REGISTRY, MACRO_INDICATOR_REGISTRY } from "./registry";

const confidence = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const registerMacroObservationSchema = z.object({
  code: z.enum(Object.keys(MACRO_INDICATOR_REGISTRY) as [keyof typeof MACRO_INDICATOR_REGISTRY, ...(keyof typeof MACRO_INDICATOR_REGISTRY)[]]),
  referenceDate: z.coerce.date(), collectedAt: z.coerce.date().default(() => new Date()),
  regionLevel: z.enum(["NATIONAL", "STATE", "MUNICIPALITY", "MARKET_AREA", "CUSTOM"]),
  regionCode: z.string().trim().min(2).max(100), rawValue: z.coerce.number().finite(), rawUnit: z.string().trim().min(1).max(40),
  normalizationKey: z.enum(["IDENTITY", "MONTHLY_EFFECTIVE_TO_ANNUAL_EFFECTIVE"]).default("IDENTITY"),
  sourceProvider: z.string().trim().min(2).max(120), sourceUrl: z.string().url().optional(), sourceMethod: z.string().trim().min(2).max(80),
  confidenceLevel: confidence, confidenceScore: z.coerce.number().min(0).max(1).optional(), provenance: z.record(z.string(), z.unknown()).default({}),
});
export type RegisterMacroObservationInput = z.input<typeof registerMacroObservationSchema>;

export const generateLaunchScenariosSchema = z.object({ projectId: z.string().cuid(), rationale: z.string().trim().min(8).max(2000).default("Atualização determinística dos cenários de lançamento.") });
export type GenerateLaunchScenariosInput = z.input<typeof generateLaunchScenariosSchema>;

export const createCustomLaunchScenarioSchema = z.object({ projectId: z.string().cuid(), name: z.string().trim().min(3).max(120), rationale: z.string().trim().min(8).max(2000), adjustments: z.object({ priceRate: z.number().min(0.5).max(1.5).default(1), salesVelocityRate: z.number().min(0.1).max(2).default(1), constructionCostRate: z.number().min(0.5).max(2).default(1), fundingRateDeltaPercentagePoints: z.number().min(-10).max(20).default(0) }) });
export type CreateCustomLaunchScenarioInput = z.input<typeof createCustomLaunchScenarioSchema>;

export const createLaunchTriggerSchema = z.object({ projectId: z.string().cuid(), code: z.string().trim().min(2).max(80), metricKey: z.enum(Object.keys(LAUNCH_METRIC_REGISTRY) as [keyof typeof LAUNCH_METRIC_REGISTRY, ...(keyof typeof LAUNCH_METRIC_REGISTRY)[]]), operator: z.enum(["LT", "LTE", "GT", "GTE", "BETWEEN"]), thresholdValue: z.coerce.number().finite(), thresholdValueEnd: z.coerce.number().finite().optional(), minimumConfidence: confidence.optional(), recommendationOnMatch: z.enum(["FAVORABLE_TO_LAUNCH", "LAUNCH_WITH_CONDITIONS", "PHASE", "REVIEW_PRODUCT_PRICE", "WAIT", "INSUFFICIENT_EVIDENCE"]).optional(), rationale: z.string().trim().min(8).max(2000) }).superRefine((value, ctx) => { if (value.operator === "BETWEEN" && (value.thresholdValueEnd == null || value.thresholdValueEnd < value.thresholdValue)) ctx.addIssue({ code: "custom", path: ["thresholdValueEnd"], message: "O limite final deve ser maior ou igual ao limite inicial." }); });
export type CreateLaunchTriggerInput = z.input<typeof createLaunchTriggerSchema>;

export const decideLaunchSchema = z.object({ evaluationId: z.string().cuid(), humanDecision: z.enum(["LAUNCH", "LAUNCH_WITH_CONDITIONS", "PHASE", "REVIEW_PRODUCT_PRICE", "WAIT", "REJECT"]), rationale: z.string().trim().min(8).max(3000), evidenceRefs: z.array(z.string().trim().min(1)).max(30).default([]) });
export type DecideLaunchInput = z.input<typeof decideLaunchSchema>;
