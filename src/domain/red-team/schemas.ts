import { z } from "zod";

const agentSchema = z.enum(["FINANCE_FUNDING", "ENGINEERING_COST", "COMMERCIAL_MARKET", "LEGAL_STRUCTURING", "INVESTOR_CFO", "DEVELOPER_OPERATOR"]);
const severitySchema = z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const confidenceSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
const findingTypeSchema = z.enum(["RISK", "INCONSISTENCY", "MISSING_EVIDENCE", "ASSUMPTION_CHALLENGE", "OPPORTUNITY", "POLICY_BREACH", "DECISION_BLOCKER"]);

export const redTeamFindingSchema = z.object({
  id: z.string().min(1),
  agent: agentSchema,
  category: z.string().min(1),
  type: findingTypeSchema,
  severity: severitySchema,
  confidence: confidenceSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).min(1),
  implication: z.string().min(1),
  recommendedAction: z.string().min(1),
  status: z.enum(["OPEN", "ACKNOWLEDGED", "MITIGATED", "ACCEPTED", "RESOLVED"]),
});

export const specialistStructuredOutputSchema = z.object({
  opinion: z.string().min(1),
  questions: z.array(z.string().min(1)).max(8),
  findings: z.array(z.object({
    category: z.string().min(1),
    type: findingTypeSchema,
    severity: severitySchema,
    confidence: confidenceSchema,
    title: z.string().min(1),
    description: z.string().min(1),
    evidenceRefs: z.array(z.string().min(1)).min(1),
    implication: z.string().min(1),
    recommendedAction: z.string().min(1),
  })).max(8),
});

export const chairStructuredOutputSchema = z.object({
  executiveSummary: z.string().min(1).max(3000),
});

export type SpecialistStructuredOutput = z.infer<typeof specialistStructuredOutputSchema>;
export type ChairStructuredOutput = z.infer<typeof chairStructuredOutputSchema>;
