import type { FinancialResult, ProjectAssumptions, ScenarioKey } from "@/domain/financial/types";
import type { RiskFinding } from "@/domain/risk/rules";
import type { RedeScoreResult } from "@/domain/score";
import type { SensitivityResult } from "@/domain/sensitivity";

export const RED_TEAM_VERSION = "REDE_RED_TEAM_V1.0.0";
export const RED_TEAM_PROMPT_VERSION = "REDE_RED_TEAM_PROMPTS_V1.0.0";

export type RedTeamAgentKey = "FINANCE_FUNDING" | "ENGINEERING_COST" | "COMMERCIAL_MARKET" | "LEGAL_STRUCTURING" | "INVESTOR_CFO" | "DEVELOPER_OPERATOR";
export type RedTeamSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type RedTeamConfidence = "LOW" | "MEDIUM" | "HIGH";
export type RedTeamFindingStatus = "OPEN" | "ACKNOWLEDGED" | "MITIGATED" | "ACCEPTED" | "RESOLVED";
export type RedTeamFindingType = "RISK" | "INCONSISTENCY" | "MISSING_EVIDENCE" | "ASSUMPTION_CHALLENGE" | "OPPORTUNITY" | "POLICY_BREACH" | "DECISION_BLOCKER";
export type AssumptionSupport = "SUPPORTED" | "WEAKLY_SUPPORTED" | "UNSUPPORTED" | "AGGRESSIVE" | "INCONSISTENT";
export type CrossReviewDecision = "CONFIRM" | "REDUCE" | "ESCALATE" | "DISAGREE";
export type DisagreementStatus = "OPEN" | "RESOLVED";
export type RedTeamDecision = "ADVANCE" | "ADVANCE_WITH_CONDITIONS" | "RESTRUCTURE" | "DO_NOT_ADVANCE" | "INSUFFICIENT_EVIDENCE";
export type EvidenceTrust = "SYSTEM" | "USER_UNTRUSTED";

export interface UploadedEvidence {
  id: string;
  category: string;
  title: string;
  content: string;
  source?: string;
}

export interface RedTeamEvidenceItem {
  ref: string;
  kind: "ASSUMPTION" | "ENGINE" | "POLICY" | "ALERT" | "SCORE" | "SENSITIVITY" | "STRESS" | "BREAK_EVEN" | "TRACE" | "DOCUMENT" | "MISSING_EVIDENCE";
  label: string;
  value: unknown;
  source: string;
  trust: EvidenceTrust;
}

export interface MissingEvidenceItem {
  key: string;
  category: string;
  requestedDocument: string;
  reason: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  evidenceRef: string;
}

export interface RedTeamEvidencePack {
  version: string;
  generatedAt: string;
  organization: { id: string; name: string };
  project: { id: string; name: string; city: string; state: string };
  study: { id: string; name: string };
  studyVersion: { id: string; versionNumber: number; status: string; inputHash: string };
  scenario: ScenarioKey;
  assumptions: ProjectAssumptions;
  assumptionSources: Record<string, string>;
  engineResult: FinancialResult;
  score: RedeScoreResult;
  sensitivity: SensitivityResult;
  alerts: RiskFinding[];
  uploadedEvidence: UploadedEvidence[];
  missingEvidence: MissingEvidenceItem[];
  items: RedTeamEvidenceItem[];
}

export interface RedTeamEvidenceInput {
  generatedAt: string;
  organization: RedTeamEvidencePack["organization"];
  project: RedTeamEvidencePack["project"];
  study: RedTeamEvidencePack["study"];
  studyVersion: RedTeamEvidencePack["studyVersion"];
  scenario: ScenarioKey;
  assumptions: ProjectAssumptions;
  assumptionSources: Record<string, string>;
  engineResult: FinancialResult;
  score: RedeScoreResult;
  sensitivity: SensitivityResult;
  alerts: RiskFinding[];
  uploadedEvidence?: UploadedEvidence[];
}

export interface RedTeamFinding {
  id: string;
  agent: RedTeamAgentKey;
  category: string;
  type: RedTeamFindingType;
  severity: RedTeamSeverity;
  confidence: RedTeamConfidence;
  title: string;
  description: string;
  evidenceRefs: string[];
  implication: string;
  recommendedAction: string;
  status: RedTeamFindingStatus;
}

export interface AssumptionChallenge {
  id: string;
  assumptionKey: string;
  classification: AssumptionSupport;
  reason: string;
  evidenceRefs: string[];
}

export interface EvidenceRequest {
  id: string;
  category: string;
  requestedDocument: string;
  reason: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  relatedFindingId: string | null;
  evidenceRefs: string[];
  status: "OPEN" | "RECEIVED" | "WAIVED";
}

export interface RedTeamAgentResult {
  agent: RedTeamAgentKey;
  label: string;
  status: "COMPLETED" | "PARTIAL" | "FAILED";
  confidence: RedTeamConfidence;
  opinion: string;
  questions: string[];
  findingIds: string[];
  providerUsed: boolean;
}

export interface RedTeamCrossReview {
  id: string;
  findingId: string;
  originalAgent: RedTeamAgentKey;
  reviewerAgent: RedTeamAgentKey;
  decision: CrossReviewDecision;
  rationale: string;
}

export interface RedTeamDisagreement {
  id: string;
  findingAId: string;
  findingBId: string;
  agents: RedTeamAgentKey[];
  description: string;
  resolution: string;
  status: DisagreementStatus;
}

export interface WhatWouldChangeDecision {
  key: string;
  action: string;
  target: string;
  evidenceRefs: string[];
}

export interface ExecutiveRedTeamConclusion {
  decision: RedTeamDecision;
  confidence: RedTeamConfidence;
  dominantRisk: string;
  topFindingIds: string[];
  decisionBlockerIds: string[];
  requiredActions: string[];
  evidenceRequestIds: string[];
  disagreementIds: string[];
  strengths: string[];
  mitigations: string[];
  residualRisk: string;
  whatWouldChangeDecision: WhatWouldChangeDecision[];
  enginePosition: string;
  executiveSummary: string;
}

export interface RedTeamObservability {
  calls: number;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  retries: number;
  errors: string[];
}

export interface RedTeamReport {
  redTeamVersion: string;
  promptVersion: string;
  startedAt: string;
  finishedAt: string;
  scenario: ScenarioKey;
  provider: { configured: boolean; name: string; model: string | null };
  evidencePack: RedTeamEvidencePack;
  agents: RedTeamAgentResult[];
  findings: RedTeamFinding[];
  assumptionChallenges: AssumptionChallenge[];
  evidenceRequests: EvidenceRequest[];
  crossReviews: RedTeamCrossReview[];
  disagreements: RedTeamDisagreement[];
  conclusion: ExecutiveRedTeamConclusion;
  observability: RedTeamObservability;
}
