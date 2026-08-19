import type { MembershipRole } from "@prisma/client";
import type { InvestmentCaseWorkspace } from "@/domain/investment";
import type { DesignWorkspaceView } from "@/domain/design";

export const AI_PROMPT_VERSION = "REDE_AI_SYSTEM_V1.0.0";
export const AI_TOOLS_VERSION = "REDE_AI_TOOLS_V1.0.0";
export const AI_CONTEXT_BUILDER_VERSION = "REDE_AI_CONTEXT_V1.0.0";

export type AIProviderStatus = "AVAILABLE" | "LIMITED" | "UNAVAILABLE";
export type AIResponseMode = "EXECUTIVE" | "DETAILED" | "TECHNICAL";
export type AITask = "CHAT" | "ANALYSIS" | "SYNTHESIS" | "DOCUMENT_SUMMARY" | "COMPARE" | "TOOL_ORCHESTRATION" | "EXTRACTION" | "RED_TEAM_ASSIST" | "REPORT_NARRATIVE";
export type AISourceType = "ENGINE" | "SCORE" | "RED_TEAM" | "DESIGN" | "LAND" | "ZONING" | "DOCUMENT" | "COMMITTEE" | "DATA_ROOM" | "USER_INPUT" | "SIMULATION" | "POLICY" | "MARKET_DATA" | "OTHER";
export type AIConfidence = "HIGH" | "MEDIUM" | "LOW" | "NOT_AVAILABLE";
export type AIUncertainty = "CONFIRMADO" | "PREMISSA" | "SIMULAÇÃO" | "ESTIMATIVA" | "NÃO VERIFICADO" | "EVIDÊNCIA AUSENTE";
export type AIToolMode = "READ_ONLY" | "SIMULATION" | "MUTATION";

export interface AIContextSelection {
  projectId: string;
  studyId: string;
  studyVersionId: string;
  studyVersionNumber: number;
  investmentCaseId: string;
  snapshotBundleId: string;
  financialScenario: "conservative" | "base" | "aggressive";
  urbanScenarioId: string | null;
  urbanScenarioType: string | null;
  currentModule: string;
}

export interface RelevantContextPackage {
  conversationId: string;
  organizationId: string;
  userId: string;
  role: MembershipRole;
  audience: string;
  responseMode: AIResponseMode;
  question: string;
  selection: AIContextSelection;
  workspace: InvestmentCaseWorkspace;
  design: DesignWorkspaceView | null;
  staleConversation: boolean;
  permissions: { canRead: boolean; canSimulate: boolean; canMutate: boolean; canViewConfidential: boolean };
}

export interface AIResponseEvidenceInput {
  statementId: string;
  sourceType: AISourceType;
  entityType: string;
  entityId: string;
  field?: string;
  version?: string;
  scenario?: string;
  documentId?: string;
  evidenceRef: string;
  confidence: AIConfidence;
  label: string;
  value?: string;
  location?: string;
  metadata?: Record<string, unknown>;
}

export type AIStructuredBlock =
  | { type: "metric"; title: string; value: string; delta?: string; tone?: "positive" | "warning" | "critical" | "neutral"; evidenceStatementId?: string }
  | { type: "comparison"; title: string; columns: string[]; rows: string[][] }
  | { type: "warning"; title: string; content: string; severity: "INFO" | "WARNING" | "CRITICAL" }
  | { type: "risk"; title: string; severity: string; status: string; action: string }
  | { type: "action"; title: string; status: string; priority: string; description: string }
  | { type: "simulation"; title: string; changes: string[]; metrics: { label: string; base: string; simulated: string; delta: string }[]; disclaimer: string }
  | { type: "tool_progress"; tool: string; label: string; status: "RUNNING" | "COMPLETED" | "FAILED" }
  | { type: "deep_link"; label: string; module: string };

export interface AIAnswer {
  content: string;
  structuredContent: AIStructuredBlock[];
  evidence: AIResponseEvidenceInput[];
  tools: AIToolCallResult[];
  task: AITask;
  providerStatus: AIProviderStatus;
  pendingAction?: { id: string; actionType: string; preview: Record<string, unknown> };
  contextChange?: Partial<AIContextSelection>;
}

export interface AIToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export interface AIToolCallResult {
  name: string;
  mode: AIToolMode;
  status: "COMPLETED" | "FAILED" | "PENDING_CONFIRMATION";
  data?: unknown;
  evidence?: AIResponseEvidenceInput[];
  error?: string;
  durationMs?: number;
}

export interface AIToolDefinition {
  name: string;
  description: string;
  mode: AIToolMode;
  minimumRole: MembershipRole;
  validate: (arguments_: Record<string, unknown>) => Record<string, unknown>;
  execute: (context: RelevantContextPackage, arguments_: Record<string, unknown>) => Promise<AIToolCallResult>;
}

export interface AIModelPolicy {
  task: AITask;
  provider: string;
  model: string;
  maxTokens: number;
  temperature: number;
  enabled: boolean;
}

export interface AIProviderRequest {
  task: AITask;
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  groundedContext: string;
  maxTokens: number;
  temperature: number;
}

export interface AIProviderResult {
  text: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export interface AIProvider {
  readonly name: string;
  readonly defaultModel: string;
  readonly status: AIProviderStatus;
  generateText(request: AIProviderRequest): Promise<AIProviderResult>;
  generateStructured<T>(request: AIProviderRequest, validate: (value: unknown) => T): Promise<T>;
  stream(request: AIProviderRequest): AsyncIterable<string>;
  embed(texts: string[]): Promise<number[][]>;
  classify(text: string, labels: string[]): Promise<string>;
  summarize(text: string, maxCharacters?: number): Promise<string>;
}

export interface AIIntentPlan {
  task: AITask;
  calls: AIToolCallRequest[];
  responseMode?: AIResponseMode;
  contextChange?: Partial<AIContextSelection>;
  mutationIntent?: { actionType: string; arguments: Record<string, unknown> };
}

export interface AIConversationView {
  id: string;
  title: string;
  scope: string;
  responseMode: AIResponseMode;
  audience: string;
  context: AIContextSelection;
  stale: boolean;
  createdAt: string;
  updatedAt: string;
  messages: AIMessageView[];
  pendingActions: { id: string; actionType: string; status: string; preview: Record<string, unknown>; createdAt: string }[];
}

export interface AIMessageView {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
  content: string;
  structuredContent: AIStructuredBlock[];
  evidence: AIResponseEvidenceInput[];
  toolCalls: AIToolCallResult[];
  createdAt: string;
}

export interface AIBootstrapView {
  status: AIProviderStatus;
  conversations: AIConversationView[];
  activeConversation: AIConversationView;
  suggestions: { category: string; prompt: string }[];
  usage: { calls: number; inputTokens: number; outputTokens: number; estimatedCost: number };
  contextLabels: { projectName: string; investmentCaseTitle: string };
}
