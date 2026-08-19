import { z } from "zod";

const safeId = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const scenario = z.enum(["conservative", "base", "aggressive"]);

export const aiQuestionSchema = z.object({
  conversationId: safeId,
  question: z.string().trim().min(2).max(4000),
  currentModule: z.string().trim().min(1).max(80).default("ai"),
});

export const emptyArgumentsSchema = z.object({}).strict();
export const scenarioArgumentsSchema = z.object({ scenario: scenario.optional() }).strict();
export const compareScenarioArgumentsSchema = z.object({ scenarios: z.array(scenario).min(2).max(3).default(["conservative", "base", "aggressive"]) }).strict();
export const delayArgumentsSchema = z.object({ months: z.number().int().min(0).max(120) }).strict();
export const searchArgumentsSchema = z.object({ query: z.string().trim().min(2).max(240), limit: z.number().int().min(1).max(30).default(12) }).strict();
export const reverseZoningArgumentsSchema = z.object({
  units: z.number().int().positive().max(100000),
  averageUnitArea: z.number().positive().max(10000).optional(),
  numberOfTowers: z.number().int().positive().max(100).optional(),
  efficiency: z.number().positive().max(100).optional(),
  unitsPerFloor: z.number().int().positive().max(100).optional(),
}).strict();

export const simulationArgumentsSchema = z.object({
  scenario: scenario.optional(),
  changes: z.object({
    unitPricePercent: z.number().min(-90).max(500).optional(),
    constructionCostPercent: z.number().min(-90).max(500).optional(),
    landPriceDelta: z.number().min(-100000000000).max(100000000000).optional(),
    approvalMonthsDelta: z.number().int().min(-120).max(240).optional(),
    salesVelocityPercent: z.number().min(-90).max(500).optional(),
    financingRateDeltaPp: z.number().min(-100).max(100).optional(),
    units: z.number().int().positive().max(100000).optional(),
  }).refine((value) => Object.keys(value).length > 0, "Informe ao menos uma alteração."),
}).strict();

export const contextChangeSchema = z.object({
  financialScenario: scenario.optional(),
  studyVersionNumber: z.number().int().positive().optional(),
  latestVersion: z.boolean().optional(),
  urbanScenarioType: z.enum(["CURRENT_LEGAL", "CONSERVATIVE_CHANGE", "PROPOSED", "TARGET", "OPTIMIZED", "MAXIMUM_POTENTIAL", "CUSTOM"]).optional(),
}).strict();

export const feedbackSchema = z.object({ messageId: safeId, rating: z.enum(["POSITIVE", "NEGATIVE"]), reason: z.string().max(120).optional(), comment: z.string().max(1000).optional() });
export const insightSchema = z.object({ messageId: safeId, title: z.string().trim().min(2).max(160) });
export const confirmationSchema = z.object({ actionId: safeId, decision: z.enum(["CONFIRM", "CANCEL"]) });
export const responseModeSchema = z.enum(["EXECUTIVE", "DETAILED", "TECHNICAL"]);
