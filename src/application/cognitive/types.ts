import type { MembershipRole } from "@prisma/client";

export const COGNITIVE_STACK_VERSION = "REDE_COGNITIVE_STACK_V1.0.0";

export type CognitiveAgentId =
  | "CFO"
  | "ENGINEERING"
  | "COMMERCIAL"
  | "LEGAL"
  | "MARKET"
  | "INVESTOR"
  | "INCORPORATOR";

export type CognitiveToolName =
  | "getApprovedViabilitySummary"
  | "getActiveRisks"
  | "getEngineeringProgress"
  | "getVerifiedLegalEvidence";

export type CognitiveConfidence = "HIGH" | "MEDIUM" | "LOW";
export type CognitiveSeverity = "INFO" | "WARNING" | "CRITICAL";

export interface CognitiveContext {
  organizationId: string;
  userId: string;
  role: MembershipRole;
  conversationId: string;
  projectId: string;
  objective: string;
}

export interface CognitiveEvidence {
  id: string;
  tool: CognitiveToolName;
  summary: string;
  rawEvidence?: string;
  confidence: CognitiveConfidence;
}

export interface AgentFinding {
  id: string;
  agentId: CognitiveAgentId;
  statement: string;
  evidenceRefs: string[];
  confidence: CognitiveConfidence;
  severity: CognitiveSeverity;
  proposedAction?: string;
}

export interface AgentRun {
  agentId: CognitiveAgentId;
  focus: string;
  evidence: CognitiveEvidence[];
  findings: AgentFinding[];
  refusedTools: CognitiveToolName[];
}

export interface CognitiveToolResult {
  tool: CognitiveToolName;
  status: "COMPLETED" | "REFUSED" | "FAILED";
  evidence?: string;
  errorCode?: string;
}

export interface CognitiveToolPort {
  execute(agentId: CognitiveAgentId, tool: CognitiveToolName): Promise<CognitiveToolResult>;
}

export interface CognitiveReasoner {
  analyze(input: {
    agentId: CognitiveAgentId;
    focus: string;
    objective: string;
    evidence: readonly CognitiveEvidence[];
  }): Promise<AgentFinding[]>;
}

export interface RedTeamChallenge {
  id: string;
  targetAgentId: CognitiveAgentId;
  findingId: string;
  severity: CognitiveSeverity;
  reason:
    | "NO_EVIDENCE"
    | "LOW_CONFIDENCE"
    | "SINGLE_SOURCE"
    | "UNSUPPORTED_ACTION"
    | "CONTRADICTORY_FINDINGS";
  message: string;
}

export type DecisionDisposition =
  | "PROCEED_WITH_CONTROLS"
  | "HOLD_FOR_EVIDENCE"
  | "REWORK_ANALYSIS";

export interface DecisionAlternative {
  id: string;
  label: string;
  rationale: string;
  requiredControls: string[];
}

export interface DecisionProposal {
  disposition: DecisionDisposition;
  executiveSummary: string;
  alternatives: DecisionAlternative[];
  evidenceRefs: string[];
  unresolvedChallenges: RedTeamChallenge[];
  requiresHumanDecision: true;
}

export interface InvestmentCommitteeReport {
  objective: string;
  agents: AgentRun[];
  challenges: RedTeamChallenge[];
  proposal: DecisionProposal;
  status: "PENDING_HUMAN_DECISION";
  stackVersion: typeof COGNITIVE_STACK_VERSION;
}

export type OperatorActionMode = "READ_ONLY" | "MUTATION";

export interface OperatorAction {
  id: string;
  capability: string;
  mode: OperatorActionMode;
  payload: Record<string, unknown>;
  reason: string;
  humanApprovalId?: string;
}

export interface OperatorActionResult {
  actionId: string;
  status: "COMPLETED" | "REFUSED" | "FAILED";
  output?: Record<string, unknown>;
  reason?: string;
}

export interface OperatorPort {
  execute(action: OperatorAction): Promise<OperatorActionResult>;
}

export interface AutopilotSignal {
  id: string;
  category: "RISK" | "FINANCIAL" | "ENGINEERING" | "COMMERCIAL" | "LEGAL" | "MARKET";
  severity: CognitiveSeverity;
  title: string;
  evidenceRefs: string[];
  suggestedCapability?: string;
}

export interface AutopilotRecommendation {
  id: string;
  signalId: string;
  title: string;
  rationale: string;
  evidenceRefs: string[];
  proposedAction?: OperatorAction;
  requiresHumanApproval: boolean;
}

export interface LearningObservation {
  id: string;
  decisionId: string;
  predicted: {
    metric: string;
    value: number;
  };
  actual: {
    value: number;
  };
  recordedAt: string;
}

export interface LearningMetric {
  metric: string;
  sampleSize: number;
  meanAbsoluteError: number;
  meanBias: number;
}

export interface LearningReport {
  metrics: LearningMetric[];
  recommendations: string[];
  policyMutationAllowed: false;
}
