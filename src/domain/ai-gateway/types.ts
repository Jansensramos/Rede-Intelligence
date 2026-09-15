/**
 * Fase 10A — contratos provider-neutral do AI Gateway (docs/PHASE_10A_AI_GATEWAY_CONTRACT.md §4).
 * O cliente (domínio/aplicação) nunca controla provider, model, endpoint, system prompt,
 * política, orçamento, retenção, fallback, correlationId ou tenant — só o conteúdo de
 * negócio e a intenção (task/capabilities/classificação/critérios).
 */

import type { ContextBundle } from "@/domain/context-engine";

export type AiModelCapability = "TEXT_GENERATION" | "STRUCTURED_OUTPUT" | "EMBEDDINGS" | "VISION" | "TOOL_USE" | "STREAMING";

/** Reaproveita as categorias já usadas pela REDE AI (src/domain/ai/types.ts) e pelo Red Team. */
export type AiTaskCategory =
  | "CHAT" | "ANALYSIS" | "SYNTHESIS" | "DOCUMENT_SUMMARY" | "COMPARE"
  | "TOOL_ORCHESTRATION" | "EXTRACTION" | "RED_TEAM_ASSIST" | "REPORT_NARRATIVE";

/** Enum fechado — nenhuma outra classificação é aceita (docs §5). */
export type AiDataClassification =
  | "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "PERSONAL"
  | "SENSITIVE_PERSONAL" | "LEGAL" | "FINANCIAL" | "SECRET";

export type AiCriticality = "LOW" | "STANDARD" | "HIGH";

export interface AiModelProfile {
  provider: string;
  /**
   * Referencia canonica do modelo, escolhida pelo servidor (catalogo/politica de
   * roteamento) - NUNCA pelo cliente nem pela resposta do provider (correcao focal
   * pos-auditoria, achado ALTO "provider/model nao confiaveis no ledger"). E esta
   * referencia, e so ela, que o Gateway persiste em AIExecutionLog.model.
   */
  modelRef: string;
  capabilities: AiModelCapability[];
  contextWindowTokens: number;
  maxOutputTokens: number;
  supportsJsonSchema: boolean;
  safetyTier: "STANDARD" | "RESTRICTED";
  dataResidency?: string;
  retentionPolicy?: "NONE" | "PROVIDER_DEFAULT" | "ZERO_RETENTION_CONFIRMED";
}

/**
 * Envelope de prompt: separa estruturalmente instruções de sistema (nunca controladas
 * pelo cliente), contexto confiável (dados já validados pelo servidor) e conteúdo não
 * confiável do usuário (nunca em posição de instrução). Ver docs §6.
 */
export interface AiContentEnvelope {
  systemInstructions: string;
  trustedContext: string;
  untrustedUserContent?: string;
}

export interface AiOutputSchemaRef {
  name: string;
  version: string;
}

export interface AiRequest {
  correlationId: string;
  organizationId: string;
  projectId?: string;
  actorRef: string;
  task: AiTaskCategory;
  requiredCapabilities: AiModelCapability[];
  dataClassification: AiDataClassification;
  criticality: AiCriticality;
  maxLatencyMs?: number;
  maxCostUsdMicros?: number;
  content: AiContentEnvelope;
  /** Bundle criado e validado no servidor. Obrigatório na composição produtiva da 10B. */
  contextBundle?: ContextBundle;
  outputSchema?: AiOutputSchemaRef;
  idempotencyKey?: string;
}

export interface AiUsage {
  inputUnits: number;
  outputUnits: number;
  estimatedCostUsdMicros: number;
  observedCostUsdMicros?: number;
  latencyMs: number;
}

export interface AiResponse {
  correlationId: string;
  status: "OK" | "PARTIAL" | "BLOCKED";
  content?: unknown;
  evidenceRefs: string[];
  usage: AiUsage;
  routing: { provider: string; model: string; fallbackCount: number; retryCount: number };
  policyVersion: string;
  promptVersion: string;
  schemaVersion?: string;
}

export interface AiRoutingPolicy {
  organizationId: string;
  task: AiTaskCategory;
  allowedProviders: string[];
  allowedModelsByCapability: Record<AiModelCapability, string[]>;
  fallbackChain: string[];
  maxFallbackAttempts: number;
  requiresHumanApprovalAbove?: "HIGH";
}

export interface AiSafetyPolicy {
  blockedContentPatterns: string[];
  maxInputBytes: number;
  maxOutputBytes: number;
  maxJsonDepth: number;
  untrustedContentMustBeFenced: true;
}

export interface AiBudgetPolicy {
  organizationId: string;
  projectId?: string;
  role?: string;
  taskCategory?: AiTaskCategory;
  dailyLimitUsdMicros?: number;
  monthlyLimitUsdMicros: number;
  hardBlock: boolean;
}

/** Taxonomia fechada de erros do Gateway (docs §8). Nunca contém prompt/resposta/endpoint/token. */
export type AiGatewayErrorCode =
  | "CONFIGURATION" | "AUTHENTICATION" | "AUTHORIZATION" | "POLICY_BLOCKED"
  | "BUDGET_EXCEEDED" | "RATE_LIMIT" | "TIMEOUT" | "PROVIDER_UNAVAILABLE"
  | "INVALID_RESPONSE" | "SAFETY_BLOCKED" | "RETENTION_UNCONFIRMED"
  | "PROVIDER_IDENTITY_MISMATCH" | "PROVIDER_USAGE_INVALID" | "RESERVATION_EXPIRED"
  | "RECONCILIATION_REQUIRED" | "UNEXPECTED";

const PERMANENT_AI_GATEWAY_ERROR_CODES: ReadonlySet<AiGatewayErrorCode> = new Set([
  "CONFIGURATION", "AUTHENTICATION", "AUTHORIZATION", "POLICY_BLOCKED",
  "BUDGET_EXCEEDED", "INVALID_RESPONSE", "SAFETY_BLOCKED", "RETENTION_UNCONFIRMED",
  "PROVIDER_IDENTITY_MISMATCH", "PROVIDER_USAGE_INVALID", "RESERVATION_EXPIRED",
  "RECONCILIATION_REQUIRED",
]);

export function isRetryableAiGatewayErrorCode(code: AiGatewayErrorCode): boolean {
  return !PERMANENT_AI_GATEWAY_ERROR_CODES.has(code);
}

export class AiGatewayError extends Error {
  readonly name = "AiGatewayError";
  constructor(
    message: string,
    readonly code: AiGatewayErrorCode,
    readonly retryable: boolean,
    readonly correlationId: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export function isAiGatewayError(error: unknown): error is AiGatewayError {
  return error instanceof AiGatewayError;
}

/**
 * Contrato de transporte de um provider concreto. NUNCA é instanciado diretamente por
 * serviços de domínio/aplicação — só o AiGateway o chama (docs §1/§14).
 */
export interface AiProviderAdapter {
  readonly ref: string;
  readonly profile: AiModelProfile;
  execute(request: AiRequest, signal: AbortSignal): Promise<AiResponse>;
}

export interface AiGateway {
  execute(request: AiRequest): Promise<AiResponse>;
}
