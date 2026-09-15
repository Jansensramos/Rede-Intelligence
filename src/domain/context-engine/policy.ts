import { createHash } from "node:crypto";
import type { z } from "zod";
import {
  ContextBundleSchema, ContextConsumptionBindingSchema, ContextItemSchema, ContextPolicySchema,
  type ContextBundle, type ContextClassification, type ContextConsumptionBinding,
  type ContextExclusionSchema, type ContextItem, type ContextPolicy, type ContextPurpose,
  type ContextRequest, type ContextSourceType,
} from "./contracts";

const DAY = 86_400_000;
export const BUNDLE_MAX_LIFETIME_MS = 60_000;
const DEFAULT_BUDGET = { maxItems: 40, maxBytes: 48_000, maxEstimatedTokens: 12_000, maxItemBytes: 8_000, maxItemsPerDomain: 24, maxItemsPerClassification: 30 } as const;
const policies: Record<ContextPurpose, ContextPolicy> = {
  EXECUTIVE_PROJECT_SUMMARY: { version: "CONTEXT_POLICY_V1.0.0", purpose: "EXECUTIVE_PROJECT_SUMMARY", domainCapability: "EXECUTIVE_READ", allowedSourceTypes: ["STUDY_VERSION", "ASSUMPTION_SNAPSHOT", "FINANCIAL_RESULT", "RISK_FINDING", "PROJECT_CLOSURE_RESULT"], requiredSourceTypes: ["STUDY_VERSION"], allowedClassifications: ["INTERNAL", "CONFIDENTIAL", "FINANCIAL"], freshnessMsBySource: { STUDY_VERSION: 365 * DAY, ASSUMPTION_SNAPSHOT: 365 * DAY, FINANCIAL_RESULT: 90 * DAY, RISK_FINDING: 90 * DAY, PROJECT_CLOSURE_RESULT: 365 * DAY }, budget: DEFAULT_BUDGET },
  FINANCIAL_VARIANCE_EXPLANATION: { version: "CONTEXT_POLICY_V1.0.0", purpose: "FINANCIAL_VARIANCE_EXPLANATION", domainCapability: "FINANCIAL_READ", allowedSourceTypes: ["FINANCIAL_RESULT", "FORECAST_EVALUATION", "LEDGER_SNAPSHOT", "REVENUE_RECOGNITION_RUN"], requiredSourceTypes: ["FINANCIAL_RESULT"], allowedClassifications: ["FINANCIAL"], freshnessMsBySource: { FINANCIAL_RESULT: 90 * DAY, FORECAST_EVALUATION: 45 * DAY, LEDGER_SNAPSHOT: 45 * DAY, REVENUE_RECOGNITION_RUN: 45 * DAY }, budget: DEFAULT_BUDGET },
  RISK_REVIEW: { version: "CONTEXT_POLICY_V1.0.0", purpose: "RISK_REVIEW", domainCapability: "VIABILITY_READ", allowedSourceTypes: ["STUDY_VERSION", "RISK_FINDING"], requiredSourceTypes: ["RISK_FINDING"], allowedClassifications: ["INTERNAL", "CONFIDENTIAL"], freshnessMsBySource: { STUDY_VERSION: 365 * DAY, RISK_FINDING: 90 * DAY }, budget: DEFAULT_BUDGET },
  LEGAL_EVIDENCE_SUMMARY: { version: "CONTEXT_POLICY_V1.0.0", purpose: "LEGAL_EVIDENCE_SUMMARY", domainCapability: "LEGAL_READ", allowedSourceTypes: ["LEGAL_EVIDENCE_DOCUMENT"], requiredSourceTypes: ["LEGAL_EVIDENCE_DOCUMENT"], allowedClassifications: ["LEGAL"], freshnessMsBySource: { LEGAL_EVIDENCE_DOCUMENT: 365 * DAY }, budget: DEFAULT_BUDGET },
  ENGINEERING_PROGRESS_REVIEW: { version: "CONTEXT_POLICY_V1.0.0", purpose: "ENGINEERING_PROGRESS_REVIEW", domainCapability: "ENGINEERING_READ", allowedSourceTypes: ["ENGINEERING_TECHNICAL_OPINION"], requiredSourceTypes: ["ENGINEERING_TECHNICAL_OPINION"], allowedClassifications: ["CONFIDENTIAL"], freshnessMsBySource: { ENGINEERING_TECHNICAL_OPINION: 180 * DAY }, budget: DEFAULT_BUDGET },
};

function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
export function contextPolicyFor(purpose: ContextPurpose): ContextPolicy { return ContextPolicySchema.parse(policies[purpose]); }
export function safeContextRef(kind: string, raw: string): string { return `${kind}:${createHash("sha256").update(`rede-context:${kind}:${raw}`).digest("hex").slice(0, 24)}`; }

export function canonicalContextJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalContextJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => compareText(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalContextJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function contextFingerprint(value: unknown): string { return createHash("sha256").update(canonicalContextJson(value)).digest("hex"); }
export function estimateContextTokens(bytes: number): number { return Math.max(1, Math.ceil(bytes / 3)); }

function policyFingerprintConstraints(policy: ContextPolicy) {
  return {
    allowedSourceTypes: policy.allowedSourceTypes,
    requiredSourceTypes: policy.requiredSourceTypes,
    allowedClassifications: policy.allowedClassifications,
    freshnessMsBySource: policy.freshnessMsBySource,
    budget: policy.budget,
  };
}

function allowedValidUntil(preparedAt: string, items: ContextItem[], policy: ContextPolicy): string {
  const preparedAtMs = new Date(preparedAt).getTime();
  const sourceDeadlines = items.flatMap((item) => item.sources.map((source) => {
    const ttl = policy.freshnessMsBySource[source.sourceType];
    if (ttl === undefined) throw new Error("CONTEXT_POLICY_UNAVAILABLE");
    return new Date(source.recordedAt).getTime() + ttl;
  }));
  const deadline = Math.min(preparedAtMs + BUNDLE_MAX_LIFETIME_MS, ...sourceDeadlines);
  if (!Number.isFinite(deadline) || deadline <= preparedAtMs) throw new Error("CONTEXT_SOURCE_STALE");
  return new Date(deadline).toISOString();
}

function fingerprintCore(bundle: Omit<ContextBundle, "requestRef" | "correlationRef" | "measurements" | "fingerprint">, policy: ContextPolicy) {
  return { ...bundle, policyConstraints: policyFingerprintConstraints(policy) };
}

export function injectionSignals(text: string): ContextItem["injectionSignals"] {
  const result = new Set<ContextItem["injectionSignals"][number]>();
  if (/ignore\s+(all|any|previous)|system\s+(prompt|policy)|override\s+instructions/i.test(text)) result.add("INSTRUCTION_OVERRIDE");
  if (/change\s+(the\s+)?(model|provider|route|policy|budget)/i.test(text)) result.add("MODEL_ROUTE_CHANGE");
  if (/(call|invoke|execute|run)\s+(a\s+)?(tool|function|command)/i.test(text)) result.add("TOOL_INVOCATION");
  if (/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(text)) result.add("HIDDEN_UNICODE");
  return [...result].sort(compareText);
}

type Exclusion = z.infer<typeof ContextExclusionSchema>;

function classificationRank(value: ContextClassification) { return ({ INTERNAL: 0, CONFIDENTIAL: 1, FINANCIAL: 2, LEGAL: 3 } as const)[value]; }
function aggregateExclusions(items: Exclusion[]): Exclusion[] {
  const map = new Map<string, Exclusion>();
  for (const item of items) {
    const key = `${item.sourceType}:${item.reasonCode}`;
    const old = map.get(key);
    map.set(key, { ...item, count: item.count + (old?.count ?? 0) });
  }
  return [...map.values()].sort((a, b) => compareText(a.sourceType, b.sourceType) || compareText(a.reasonCode, b.reasonCode));
}

function budgetReason(policy: ContextPolicy, selected: ContextItem[], group: ContextItem[]): Exclusion["reasonCode"] | null {
  if (group.some((item) => Buffer.byteLength(canonicalContextJson(item), "utf8") > policy.budget.maxItemBytes)) return "MEANING_UNSAFE";
  if (selected.length + group.length > policy.budget.maxItems) return "BUDGET_ITEM_LIMIT";
  const byDomain = new Map<string, number>();
  const byClassification = new Map<string, number>();
  for (const item of [...selected, ...group]) {
    byDomain.set(item.domain, (byDomain.get(item.domain) ?? 0) + 1);
    const classification = item.sources.reduce<ContextClassification>((best, source) => classificationRank(source.classification) > classificationRank(best) ? source.classification : best, "INTERNAL");
    byClassification.set(classification, (byClassification.get(classification) ?? 0) + 1);
  }
  if ([...byDomain.values()].some((count) => count > policy.budget.maxItemsPerDomain)) return "BUDGET_DOMAIN_LIMIT";
  if ([...byClassification.values()].some((count) => count > policy.budget.maxItemsPerClassification)) return "BUDGET_CLASSIFICATION_LIMIT";
  const bytes = Buffer.byteLength(canonicalContextJson([...selected, ...group]), "utf8");
  if (bytes > policy.budget.maxBytes) return "BUDGET_BYTE_LIMIT";
  if (estimateContextTokens(bytes) > policy.budget.maxEstimatedTokens) return "BUDGET_TOKEN_LIMIT";
  return null;
}

export function buildContextBundle(request: ContextRequest, rawPolicy: ContextPolicy, candidates: ContextItem[], rawExclusions: Exclusion[] = []): ContextBundle {
  const policy = ContextPolicySchema.parse(rawPolicy);
  const exclusions = rawExclusions.map((item) => ({ ...item }));
  const requestedAtMs = new Date(request.requestedAt).getTime();
  const allowed = new Set<ContextSourceType>(policy.allowedSourceTypes);
  const normalized = candidates.map((candidate) => ContextItemSchema.parse(candidate)).filter((item) => {
    const denied = item.sources.find((source) => !allowed.has(source.sourceType) || !policy.allowedClassifications.includes(source.classification));
    if (denied) { exclusions.push({ sourceType: denied.sourceType, reasonCode: policy.allowedClassifications.includes(denied.classification) ? "SOURCE_INVALID" : "CLASSIFICATION_DENIED", count: 1 }); return false; }
    const invalidTime = item.sources.find((source) => new Date(source.recordedAt).getTime() > requestedAtMs || (source.observedAt !== null && new Date(source.observedAt).getTime() > requestedAtMs));
    if (invalidTime) { exclusions.push({ sourceType: invalidTime.sourceType, reasonCode: "SOURCE_INVALID", count: 1 }); return false; }
    const revoked = item.sources.find((source) => source.evidenceState === "REVOKED");
    if (revoked) { exclusions.push({ sourceType: revoked.sourceType, reasonCode: "SOURCE_REVOKED", count: 1 }); return false; }
    const superseded = item.sources.find((source) => source.evidenceState === "SUPERSEDED");
    if (superseded) { exclusions.push({ sourceType: superseded.sourceType, reasonCode: "SOURCE_SUPERSEDED", count: 1 }); return false; }
    const stale = item.sources.find((source) => source.freshness !== "FRESH");
    if (stale) { exclusions.push({ sourceType: stale.sourceType, reasonCode: stale.freshness === "STALE" ? "SOURCE_STALE" : "SOURCE_INVALID", count: 1 }); return false; }
    return true;
  });

  const byItemKey = new Map<string, ContextItem[]>();
  for (const item of normalized) byItemKey.set(item.itemKey, [...(byItemKey.get(item.itemKey) ?? []), item]);
  const resolved: ContextItem[] = [];
  for (const key of [...byItemKey.keys()].sort(compareText)) {
    const equivalents = byItemKey.get(key)!;
    const values = new Set(equivalents.filter((item) => item.value.kind === "KNOWN").map((item) => canonicalContextJson(item.value)));
    if (values.size > 1) {
      const base = equivalents.slice().sort((a, b) => compareText(a.sources[0].sourceRef, b.sources[0].sourceRef))[0];
      if (base.groupRequirement === "REQUIRED") throw new Error("CONTEXT_SOURCE_CONFLICT");
      resolved.push({ ...base, value: { kind: "CONFLICT", reasonCode: "EQUIVALENT_SOURCES_CONFLICT" }, sources: equivalents.flatMap((item) => item.sources).sort((a, b) => compareText(a.sourceRef, b.sourceRef)) });
    } else resolved.push(equivalents.slice().sort((a, b) => compareText(a.sources[0].sourceRef, b.sources[0].sourceRef))[0]);
  }

  const groups = new Map<string, ContextItem[]>();
  for (const item of resolved) groups.set(item.selectionGroup, [...(groups.get(item.selectionGroup) ?? []), item]);
  const orderedGroups = [...groups.entries()].map(([key, items]) => ({ key, items: items.sort((a, b) => b.priority - a.priority || compareText(a.domain, b.domain) || compareText(a.itemKey, b.itemKey)), required: items.some((item) => item.groupRequirement === "REQUIRED") }))
    .sort((a, b) => Number(b.required) - Number(a.required) || Math.max(...b.items.map((item) => item.priority)) - Math.max(...a.items.map((item) => item.priority)) || compareText(a.key, b.key));
  const selected: ContextItem[] = [];
  for (const group of orderedGroups) {
    const reason = budgetReason(policy, selected, group.items);
    if (!reason) { selected.push(...group.items); continue; }
    for (const item of group.items) exclusions.push({ sourceType: item.sources[0].sourceType, reasonCode: reason, count: 1 });
    if (group.required) throw new Error("CONTEXT_BUDGET_EXCEEDED");
  }

  const includedTypes = new Set(selected.flatMap((item) => item.sources.map((source) => source.sourceType)));
  if (policy.requiredSourceTypes.some((type) => !includedTypes.has(type))) throw new Error("CONTEXT_SOURCE_MISSING");
  if (!selected.length) throw new Error("CONTEXT_SOURCE_MISSING");
  const preparedAt = request.requestedAt;
  const validUntil = allowedValidUntil(preparedAt, selected, policy);
  const classification = selected.flatMap((item) => item.sources).reduce<ContextClassification>((best, source) => classificationRank(source.classification) > classificationRank(best) ? source.classification : best, "INTERNAL");
  const content = {
    schemaVersion: request.schemaVersion, policyVersion: policy.version, purpose: request.purpose,
    actorRef: safeContextRef("actor", request.userId), conversationRef: safeContextRef("conversation", request.conversationId),
    organizationRef: safeContextRef("org", request.organizationId), projectRef: safeContextRef("project", request.projectId),
    preparedAt, validUntil, classification, boundary: "DATA_NOT_INSTRUCTION" as const, items: selected, exclusions: aggregateExclusions(exclusions),
  };
  const fingerprint = contextFingerprint(fingerprintCore(content, policy));
  const base = { ...content, requestRef: safeContextRef("request", request.requestId), correlationRef: safeContextRef("correlation", request.correlationId), fingerprint };
  const byteCount = Buffer.byteLength(canonicalContextJson(base), "utf8");
  const estimatedTokens = estimateContextTokens(byteCount);
  if (byteCount > policy.budget.maxBytes || estimatedTokens > policy.budget.maxEstimatedTokens) throw new Error("CONTEXT_BUDGET_EXCEEDED");
  const bundle = ContextBundleSchema.parse({ ...base, measurements: { itemCount: selected.length, byteCount, estimatedTokens } });
  return deepFreeze(bundle);
}

export interface ContextConsumptionIdentity {
  actorUserId: string;
  conversationId: string;
  organizationId: string;
  projectId: string;
  idempotencyKey: string;
  executionLogId: string;
  pendingActionId: string;
  correlationId: string;
}

export function contextConsumptionBinding(bundle: ContextBundle, identity: ContextConsumptionIdentity): ContextConsumptionBinding {
  const valid = ContextBundleSchema.parse(bundle);
  if (valid.actorRef !== safeContextRef("actor", identity.actorUserId)
    || valid.conversationRef !== safeContextRef("conversation", identity.conversationId)
    || valid.organizationRef !== safeContextRef("org", identity.organizationId)
    || valid.projectRef !== safeContextRef("project", identity.projectId)
    || valid.requestRef !== identity.idempotencyKey
    || valid.correlationRef !== safeContextRef("correlation", identity.correlationId)) throw new Error("CONTEXT_INTEGRITY_FAILED");
  return ContextConsumptionBindingSchema.parse({
    policyVersion: valid.policyVersion, purpose: valid.purpose, preparedAt: valid.preparedAt,
    validUntil: valid.validUntil, fingerprint: valid.fingerprint, ...identity,
  });
}

export function renderContextBundleForTransport(bundle: ContextBundle): string {
  const valid = ContextBundleSchema.parse(bundle);
  const evidence = valid.items.map((item, index) => ({
    citation: `E${index + 1}`, domain: item.domain, label: item.label, value: item.value, unit: item.unit,
    boundary: item.trustBoundary,
    sources: item.sources.map((source) => ({ type: source.sourceType, ref: source.sourceRef, version: source.version, recordedAt: source.recordedAt, freshness: source.freshness, classification: source.classification, state: source.evidenceState })),
    signals: item.injectionSignals,
  }));
  return canonicalContextJson({ schemaVersion: valid.schemaVersion, boundary: "DATA_NOT_INSTRUCTION", fingerprint: valid.fingerprint, evidence });
}

export interface ContextBundleScope {
  organizationId: string;
  projectId?: string;
  userId: string;
  conversationId: string;
  correlationId: string;
  idempotencyKey?: string;
  now?: Date;
}

export function assertBundleScope(bundle: ContextBundle, scope: ContextBundleScope): ContextBundle {
  const valid = ContextBundleSchema.parse(bundle);
  const now = scope.now ?? new Date();
  const policy = contextPolicyFor(valid.purpose);
  if (!scope.projectId || !scope.idempotencyKey || scope.idempotencyKey !== valid.requestRef
    || valid.organizationRef !== safeContextRef("org", scope.organizationId)
    || valid.projectRef !== safeContextRef("project", scope.projectId)
    || valid.actorRef !== safeContextRef("actor", scope.userId)
    || valid.conversationRef !== safeContextRef("conversation", scope.conversationId)
    || valid.correlationRef !== safeContextRef("correlation", scope.correlationId)
    || valid.policyVersion !== policy.version
    || new Date(valid.preparedAt).getTime() > now.getTime()
    || new Date(valid.validUntil).getTime() <= now.getTime()) throw new Error("CONTEXT_INTEGRITY_FAILED");
  for (const source of valid.items.flatMap((item) => item.sources)) {
    if (new Date(source.recordedAt).getTime() > new Date(valid.preparedAt).getTime()
      || (source.observedAt !== null && new Date(source.observedAt).getTime() > new Date(valid.preparedAt).getTime())) throw new Error("CONTEXT_INTEGRITY_FAILED");
  }
  const content = {
    schemaVersion: valid.schemaVersion, policyVersion: valid.policyVersion, purpose: valid.purpose,
    actorRef: valid.actorRef, conversationRef: valid.conversationRef, organizationRef: valid.organizationRef,
    projectRef: valid.projectRef, preparedAt: valid.preparedAt, validUntil: valid.validUntil,
    classification: valid.classification, boundary: valid.boundary,
    items: valid.items, exclusions: valid.exclusions,
  };
  if (allowedValidUntil(valid.preparedAt, valid.items, policy) !== valid.validUntil
    || contextFingerprint(fingerprintCore(content, policy)) !== valid.fingerprint) throw new Error("CONTEXT_INTEGRITY_FAILED");
  const measuredBase = { ...content, requestRef: valid.requestRef, correlationRef: valid.correlationRef, fingerprint: valid.fingerprint };
  const byteCount = Buffer.byteLength(canonicalContextJson(measuredBase), "utf8");
  if (valid.measurements.itemCount !== valid.items.length || valid.measurements.byteCount !== byteCount || valid.measurements.estimatedTokens !== estimateContextTokens(byteCount)) throw new Error("CONTEXT_INTEGRITY_FAILED");
  return valid;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
