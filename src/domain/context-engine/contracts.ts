import { types as utilTypes } from "node:util";
import { z } from "zod";

export const CONTEXT_SCHEMA_VERSION = "CONTEXT_BUNDLE_V1" as const;
export const CONTEXT_POLICY_VERSION = "CONTEXT_POLICY_V1.0.0" as const;

const MAX_DATA_DEPTH = 16;
const MAX_DATA_NODES = 5_000;
const MAX_ARRAY_LENGTH = 128;
const MAX_OBJECT_KEYS = 64;
const INVALID_DATA = Object.freeze({ invalidContextData: true });

/** Rejects executable object shapes before Zod can read any property. */
export function isPlainContextData(input: unknown): boolean {
  let nodes = 0;
  const seen = new Set<object>();
  const visit = (value: unknown, depth: number): boolean => {
    if (value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) return true;
    if (typeof value !== "object" || depth > MAX_DATA_DEPTH || utilTypes.isProxy(value)) return false;
    const object = value as object;
    if (seen.has(object)) return false;
    seen.add(object);
    nodes += 1;
    if (nodes > MAX_DATA_NODES) return false;
    const prototype = Object.getPrototypeOf(object);
    const isArray = Array.isArray(object);
    if (prototype !== (isArray ? Array.prototype : Object.prototype)) return false;
    const descriptors = Object.getOwnPropertyDescriptors(object);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key === "symbol")) return false;
    if (isArray && object.length > MAX_ARRAY_LENGTH) return false;
    if (!isArray && keys.length > MAX_OBJECT_KEYS) return false;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor.get || descriptor.set) return false;
      if (isArray) {
        if (key === "length") {
          if (descriptor.enumerable || descriptor.configurable) return false;
          continue;
        }
        if (!/^(0|[1-9]\d*)$/.test(key) || !descriptor.enumerable) return false;
      } else if (!descriptor.enumerable) return false;
      if ("value" in descriptor && !visit(descriptor.value, depth + 1)) return false;
    }
    return true;
  };
  try { return visit(input, 0); } catch { return false; }
}

function plainDataSchema<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((input) => isPlainContextData(input) ? input : INVALID_DATA, schema);
}

const FORBIDDEN_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
export const safeText = (max: number) => z.string().min(1).max(max).refine((value) => value === value.normalize("NFC") && !FORBIDDEN_TEXT.test(value), "unsafe text");
export const safeRefSchema = safeText(96).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
/** Canonical wire time: UTC, exactly millisecond precision, and no equivalent spellings. */
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}, "non-canonical timestamp");
const boundedNumberSchema = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER);
const safeVersionSchema = safeText(64).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

function uniqueArray<T extends z.ZodTypeAny>(item: T, max: number, key: (value: z.output<T>) => string = (value) => JSON.stringify(value)) {
  return z.array(item).max(max).superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      const identity = key(value);
      if (seen.has(identity)) context.addIssue({ code: "custom", message: "duplicate value", path: [index] });
      seen.add(identity);
    });
  });
}

export const ContextPurposeSchema = z.enum([
  "EXECUTIVE_PROJECT_SUMMARY", "FINANCIAL_VARIANCE_EXPLANATION", "RISK_REVIEW",
  "LEGAL_EVIDENCE_SUMMARY", "ENGINEERING_PROGRESS_REVIEW",
]);
export type ContextPurpose = z.infer<typeof ContextPurposeSchema>;

export const ContextSourceTypeSchema = z.enum([
  "STUDY_VERSION", "ASSUMPTION_SNAPSHOT", "FINANCIAL_RESULT", "RISK_FINDING",
  "FORECAST_EVALUATION", "PROJECT_CLOSURE_RESULT", "LEGAL_EVIDENCE_DOCUMENT",
  "ENGINEERING_TECHNICAL_OPINION", "LEDGER_SNAPSHOT", "REVENUE_RECOGNITION_RUN",
  "DECISION_LEDGER_ENTRY",
]);
export type ContextSourceType = z.infer<typeof ContextSourceTypeSchema>;

export const ContextClassificationSchema = z.enum(["INTERNAL", "CONFIDENTIAL", "LEGAL", "FINANCIAL"]);
export type ContextClassification = z.infer<typeof ContextClassificationSchema>;
export const ContextFreshnessSchema = z.enum(["FRESH", "STALE", "HISTORICAL", "UNKNOWN"]);
export const ContextEvidenceStateSchema = z.enum(["TERMINAL", "VERIFIED", "CONFIRMED", "DERIVED", "ASSUMPTION", "PROVISIONAL", "CONFLICT", "REVOKED", "SUPERSEDED", "MISSING"]);
export const ContextInclusionReasonSchema = z.enum(["REQUIRED_FOR_PURPOSE", "AUTHORIZED_SUPPORTING_EVIDENCE", "EQUIVALENT_SOURCES_CONFLICT"]);
export const ContextExclusionReasonSchema = z.enum([
  "SOURCE_MISSING", "SOURCE_STALE", "SOURCE_REVOKED", "SOURCE_SUPERSEDED", "SOURCE_INVALID",
  "CLASSIFICATION_DENIED", "CAPABILITY_DENIED", "BUDGET_ITEM_LIMIT", "BUDGET_BYTE_LIMIT",
  "BUDGET_TOKEN_LIMIT", "BUDGET_DOMAIN_LIMIT", "BUDGET_CLASSIFICATION_LIMIT", "MEANING_UNSAFE",
]);

const contextRequestObject = z.object({
  schemaVersion: z.literal(CONTEXT_SCHEMA_VERSION), requestId: safeRefSchema, correlationId: safeRefSchema,
  organizationId: safeRefSchema, projectId: safeRefSchema, userId: safeRefSchema,
  conversationId: safeRefSchema, purpose: ContextPurposeSchema,
  policyVersion: z.literal(CONTEXT_POLICY_VERSION), requestedAt: isoDateSchema,
}).strict();
export const ContextRequestSchema = plainDataSchema(contextRequestObject);
export type ContextRequest = z.infer<typeof ContextRequestSchema>;

const contextSourceObject = z.object({
  sourceType: ContextSourceTypeSchema, sourceRef: safeRefSchema, version: safeVersionSchema,
  observedAt: isoDateSchema.nullable(), recordedAt: isoDateSchema, freshness: ContextFreshnessSchema,
  classification: ContextClassificationSchema, inclusionReasonCode: ContextInclusionReasonSchema,
  organizationRef: safeRefSchema, projectRef: safeRefSchema, evidenceState: ContextEvidenceStateSchema,
}).strict();
export const ContextSourceSchema = plainDataSchema(contextSourceObject);
export type ContextSource = z.infer<typeof ContextSourceSchema>;

const knownValueSchema = z.object({ kind: z.literal("KNOWN"), value: z.union([safeText(4_000), boundedNumberSchema, z.boolean()]) }).strict();
const unknownValueSchema = z.object({ kind: z.literal("UNKNOWN"), reasonCode: z.enum(["NOT_RECORDED", "NOT_APPLICABLE", "SOURCE_UNAVAILABLE"]) }).strict();
const conflictValueSchema = z.object({ kind: z.literal("CONFLICT"), reasonCode: z.literal("EQUIVALENT_SOURCES_CONFLICT") }).strict();
const signalSchema = z.enum(["INSTRUCTION_OVERRIDE", "MODEL_ROUTE_CHANGE", "TOOL_INVOCATION", "HIDDEN_UNICODE"]);

const contextItemObject = z.object({
  itemKey: safeRefSchema, selectionGroup: safeRefSchema, groupRequirement: z.enum(["REQUIRED", "OPTIONAL"]),
  domain: z.enum(["EXECUTIVE", "FINANCIAL", "RISK", "LEGAL", "ENGINEERING"]), label: safeText(160),
  value: z.discriminatedUnion("kind", [knownValueSchema, unknownValueSchema, conflictValueSchema]), unit: safeText(32).nullable(),
  priority: z.number().int().min(1).max(100), indivisible: z.literal(true), trustBoundary: z.literal("DATA_NOT_INSTRUCTION"),
  injectionSignals: uniqueArray(signalSchema, 4),
  sources: uniqueArray(ContextSourceSchema, 8, (source) => `${source.sourceType}:${source.sourceRef}` as string).min(1),
}).strict();
export const ContextItemSchema = plainDataSchema(contextItemObject);
export type ContextItem = z.infer<typeof ContextItemSchema>;

const contextPolicyObject = z.object({
  version: z.literal(CONTEXT_POLICY_VERSION), purpose: ContextPurposeSchema,
  domainCapability: z.enum(["EXECUTIVE_READ", "FINANCIAL_READ", "VIABILITY_READ", "LEGAL_READ", "ENGINEERING_READ"]),
  allowedSourceTypes: uniqueArray(ContextSourceTypeSchema, 11).min(1), requiredSourceTypes: uniqueArray(ContextSourceTypeSchema, 5).min(1),
  allowedClassifications: uniqueArray(ContextClassificationSchema, 4).min(1),
  freshnessMsBySource: z.record(z.string(), z.number().int().positive().max(10 * 365 * 86_400_000)).superRefine((value, context) => {
    for (const key of Object.keys(value)) if (!ContextSourceTypeSchema.safeParse(key).success) context.addIssue({ code: "custom", message: "unknown source type", path: [key] });
  }),
  budget: z.object({
    maxItems: z.number().int().positive().max(100), maxBytes: z.number().int().positive().max(120_000),
    maxEstimatedTokens: z.number().int().positive().max(30_000), maxItemBytes: z.number().int().positive().max(16_000),
    maxItemsPerDomain: z.number().int().positive().max(100), maxItemsPerClassification: z.number().int().positive().max(100),
  }).strict(),
}).strict().superRefine((policy, context) => {
  const allowed = new Set(policy.allowedSourceTypes);
  policy.requiredSourceTypes.forEach((source, index) => { if (!allowed.has(source)) context.addIssue({ code: "custom", message: "required source is not allowed", path: ["requiredSourceTypes", index] }); });
  policy.allowedSourceTypes.forEach((source) => { if (policy.freshnessMsBySource[source] === undefined) context.addIssue({ code: "custom", message: "missing explicit freshness policy", path: ["freshnessMsBySource", source] }); });
});
export const ContextPolicySchema = plainDataSchema(contextPolicyObject);
export type ContextPolicy = z.infer<typeof ContextPolicySchema>;

const contextExclusionObject = z.object({ sourceType: ContextSourceTypeSchema, reasonCode: ContextExclusionReasonSchema, count: z.number().int().positive().max(100_000) }).strict();
export const ContextExclusionSchema = plainDataSchema(contextExclusionObject);

const contextBundleObject = z.object({
  schemaVersion: z.literal(CONTEXT_SCHEMA_VERSION), policyVersion: z.literal(CONTEXT_POLICY_VERSION), purpose: ContextPurposeSchema,
  requestRef: safeRefSchema, correlationRef: safeRefSchema, actorRef: safeRefSchema, conversationRef: safeRefSchema,
  organizationRef: safeRefSchema, projectRef: safeRefSchema, preparedAt: isoDateSchema, validUntil: isoDateSchema,
  classification: ContextClassificationSchema, boundary: z.literal("DATA_NOT_INSTRUCTION"),
  items: uniqueArray(ContextItemSchema, 100, (item) => item.itemKey).min(1),
  exclusions: uniqueArray(ContextExclusionSchema, 32, (item) => `${item.sourceType}:${item.reasonCode}`),
  measurements: z.object({ itemCount: z.number().int().positive().max(100), byteCount: z.number().int().positive().max(120_000), estimatedTokens: z.number().int().positive().max(30_000) }).strict(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const ContextBundleSchema = plainDataSchema(contextBundleObject);
export type ContextBundle = z.infer<typeof ContextBundleSchema>;

const contextBindingObject = z.object({
  policyVersion: z.literal(CONTEXT_POLICY_VERSION), purpose: ContextPurposeSchema,
  preparedAt: isoDateSchema, validUntil: isoDateSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  actorUserId: safeRefSchema, conversationId: safeRefSchema, organizationId: safeRefSchema, projectId: safeRefSchema,
  idempotencyKey: safeRefSchema, executionLogId: safeRefSchema, pendingActionId: safeRefSchema,
  correlationId: safeRefSchema,
}).strict();
export const ContextConsumptionBindingSchema = plainDataSchema(contextBindingObject);
export type ContextConsumptionBinding = z.infer<typeof ContextConsumptionBindingSchema>;

export const ContextSelectionResultSchema = plainDataSchema(z.discriminatedUnion("status", [
  z.object({ status: z.literal("READY"), bundle: ContextBundleSchema }).strict(),
  z.object({ status: z.literal("REFUSED"), code: z.enum(["CONTEXT_SOURCE_MISSING", "CONTEXT_SOURCE_STALE", "CONTEXT_SOURCE_CONFLICT", "CONTEXT_BUDGET_EXCEEDED", "CONTEXT_ACCESS_DENIED", "CONTEXT_INTEGRITY_FAILED"]), correlationRef: safeRefSchema }).strict(),
]));
export type ContextSelectionResult = z.infer<typeof ContextSelectionResultSchema>;

export const CONTEXT_ERROR_CODES = [
  "CONTEXT_ACCESS_DENIED", "CONTEXT_PURPOSE_UNSUPPORTED", "CONTEXT_POLICY_UNAVAILABLE", "CONTEXT_SOURCE_MISSING",
  "CONTEXT_SOURCE_INVALID", "CONTEXT_SOURCE_STALE", "CONTEXT_SOURCE_REVOKED", "CONTEXT_SOURCE_CONFLICT",
  "CONTEXT_HISTORY_UNAVAILABLE", "CONTEXT_INTEGRITY_FAILED", "CONTEXT_CLASSIFICATION_DENIED", "CONTEXT_BUDGET_EXCEEDED",
  "CONTEXT_MEANING_UNSAFE", "CONTEXT_CONCURRENT_CHANGE", "CONTEXT_AUDIT_UNAVAILABLE", "CONTEXT_DEPENDENCY_UNAVAILABLE",
] as const;
export type ContextEngineErrorCode = typeof CONTEXT_ERROR_CODES[number];

const ERROR_MESSAGES: Record<ContextEngineErrorCode, string> = {
  CONTEXT_ACCESS_DENIED: "Recurso da REDE AI não encontrado.", CONTEXT_PURPOSE_UNSUPPORTED: "Finalidade de contexto não suportada.",
  CONTEXT_POLICY_UNAVAILABLE: "Política de contexto indisponível.", CONTEXT_SOURCE_MISSING: "Fonte obrigatória ausente.",
  CONTEXT_SOURCE_INVALID: "Fonte de contexto inválida.", CONTEXT_SOURCE_STALE: "Fonte obrigatória vencida.",
  CONTEXT_SOURCE_REVOKED: "Fonte de contexto revogada.", CONTEXT_SOURCE_CONFLICT: "Fontes equivalentes em conflito.",
  CONTEXT_HISTORY_UNAVAILABLE: "Histórico solicitado indisponível.", CONTEXT_INTEGRITY_FAILED: "Integridade do contexto não comprovada.",
  CONTEXT_CLASSIFICATION_DENIED: "Classificação de contexto não autorizada.", CONTEXT_BUDGET_EXCEEDED: "Orçamento de contexto excedido.",
  CONTEXT_MEANING_UNSAFE: "O conteúdo não pode ser reduzido com segurança.", CONTEXT_CONCURRENT_CHANGE: "Fonte alterada durante a seleção.",
  CONTEXT_AUDIT_UNAVAILABLE: "Auditoria do contexto indisponível.", CONTEXT_DEPENDENCY_UNAVAILABLE: "Dependência do contexto indisponível.",
};
const RETRYABLE = new Set<ContextEngineErrorCode>(["CONTEXT_CONCURRENT_CHANGE", "CONTEXT_AUDIT_UNAVAILABLE", "CONTEXT_DEPENDENCY_UNAVAILABLE"]);

export class ContextEngineError extends Error {
  readonly name = "ContextEngineError";
  readonly retryable: boolean;
  readonly correlationId: string;
  constructor(readonly code: ContextEngineErrorCode, correlationId: string, options?: { cause?: unknown }) {
    super(ERROR_MESSAGES[code], options);
    this.correlationId = safeRefSchema.parse(correlationId);
    this.retryable = RETRYABLE.has(code);
  }
}
