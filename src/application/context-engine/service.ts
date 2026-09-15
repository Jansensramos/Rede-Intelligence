import { randomUUID } from "node:crypto";
import { Prisma, type ProjectStatus } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { assertAiUse } from "@/application/ai-gateway/rbac";
import { prisma } from "@/infrastructure/database/prisma";
import {
  assertBundleScope, buildContextBundle, contextPolicyFor, ContextEngineError,
  ContextRequestSchema, safeContextRef, type ContextBundle, type ContextPurpose,
} from "@/domain/context-engine";
import { readContextCandidates } from "./readers";

export interface ContextEngineClock { now(): Date }
const systemClock: ContextEngineClock = { now: () => new Date() };
const MAX_PREPARATION_ATTEMPTS = 3;
const CONTEXT_ACTIVE_PROJECT_STATUSES = new Set<ProjectStatus>(["DRAFT", "UNDER_REVIEW", "APPROVED"]);

/** The current schema has no ACTIVE literal; these are its three non-suspended lifecycle states. */
export function isContextProjectStatusActive(status: ProjectStatus): boolean {
  return CONTEXT_ACTIVE_PROJECT_STATUSES.has(status);
}

export function contextPurposeFor(task: string, plannedReaderNames: readonly string[] = []): ContextPurpose {
  const normalized = `${task}:${plannedReaderNames.join(":")}`.toLowerCase();
  if (/legal|jurid/.test(normalized)) return "LEGAL_EVIDENCE_SUMMARY";
  if (/engineer|engenharia|obra|design/.test(normalized)) return "ENGINEERING_PROGRESS_REVIEW";
  if (/risk|risco|red.team/.test(normalized)) return "RISK_REVIEW";
  if (/financ|account|contab|variance/.test(normalized)) return "FINANCIAL_VARIANCE_EXPLANATION";
  return "EXECUTIVE_PROJECT_SUMMARY";
}

export interface PreparedContextBundle {
  bundle: ContextBundle;
  /** Created inside the application boundary and never accepted from a client. */
  correlationId: string;
}

function isSerializableConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

export async function prepareContextBundle(context: AuthContext, input: { conversationId: string; purpose: ContextPurpose }, clock: ContextEngineClock = systemClock): Promise<PreparedContextBundle> {
  const correlationId = randomUUID();
  const policy = contextPolicyFor(input.purpose);
  try { assertAiUse(context, policy.domainCapability); } catch { throw new ContextEngineError("CONTEXT_ACCESS_DENIED", correlationId); }
  for (let attempt = 1; attempt <= MAX_PREPARATION_ATTEMPTS; attempt += 1) {
    try {
      const bundle = await prisma.$transaction(
        (tx) => prepareContextBundleInTransaction(tx, context, { ...input, correlationId }, clock),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return { bundle, correlationId };
    } catch (error) {
      if (error instanceof ContextEngineError) throw error;
      if (isSerializableConflict(error) && attempt < MAX_PREPARATION_ATTEMPTS) continue;
      if (isSerializableConflict(error)) throw new ContextEngineError("CONTEXT_CONCURRENT_CHANGE", correlationId, { cause: error });
      throw new ContextEngineError("CONTEXT_DEPENDENCY_UNAVAILABLE", correlationId, { cause: error });
    }
  }
  throw new ContextEngineError("CONTEXT_CONCURRENT_CHANGE", correlationId);
}

function throwForMissingRequired(bundleInput: Awaited<ReturnType<typeof readContextCandidates>>, requiredSourceTypes: readonly string[], correlationId: string): never | void {
  const includedTypes = new Set(bundleInput.items.flatMap((item) => item.sources.map((source) => source.sourceType)));
  for (const required of requiredSourceTypes) if (!includedTypes.has(required as never)) {
    const reasons = new Set(bundleInput.exclusions.filter((item) => item.sourceType === required).map((item) => item.reasonCode));
    if (reasons.has("SOURCE_REVOKED")) throw new ContextEngineError("CONTEXT_SOURCE_REVOKED", correlationId);
    if (reasons.has("SOURCE_STALE")) throw new ContextEngineError("CONTEXT_SOURCE_STALE", correlationId);
    if (reasons.has("SOURCE_INVALID")) throw new ContextEngineError("CONTEXT_SOURCE_INVALID", correlationId);
    throw new ContextEngineError("CONTEXT_SOURCE_MISSING", correlationId);
  }
}

function buildOrThrow(
  request: ReturnType<typeof ContextRequestSchema.parse>,
  selected: Awaited<ReturnType<typeof readContextCandidates>>,
  correlationId: string,
): ContextBundle {
  const policy = contextPolicyFor(request.purpose);
  throwForMissingRequired(selected, policy.requiredSourceTypes, correlationId);
  try { return buildContextBundle(request, policy, selected.items, selected.exclusions); }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    if (error.message === "CONTEXT_SOURCE_MISSING") throw new ContextEngineError("CONTEXT_SOURCE_MISSING", correlationId);
    if (error.message === "CONTEXT_SOURCE_STALE") throw new ContextEngineError("CONTEXT_SOURCE_STALE", correlationId);
    if (error.message === "CONTEXT_SOURCE_CONFLICT") throw new ContextEngineError("CONTEXT_SOURCE_CONFLICT", correlationId);
    if (error.message === "CONTEXT_BUDGET_EXCEEDED") throw new ContextEngineError("CONTEXT_BUDGET_EXCEEDED", correlationId);
    if (error.message === "CONTEXT_POLICY_UNAVAILABLE") throw new ContextEngineError("CONTEXT_POLICY_UNAVAILABLE", correlationId);
    throw error;
  }
}

/** Executes selection and audit in a caller-owned transaction; correlation injection exists only for deterministic tests. */
export async function prepareContextBundleInTransaction(tx: Prisma.TransactionClient, context: AuthContext, input: { conversationId: string; purpose: ContextPurpose; correlationId?: string }, clock: ContextEngineClock = systemClock): Promise<ContextBundle> {
  const correlationId = input.correlationId ?? randomUUID();
  const policy = contextPolicyFor(input.purpose);
  try { assertAiUse(context, policy.domainCapability); } catch { throw new ContextEngineError("CONTEXT_ACCESS_DENIED", correlationId); }
  const membership = await tx.organizationMembership.findFirst({ where: { organizationId: context.organizationId, userId: context.userId, isActive: true, user: { isActive: true } }, select: { role: true } });
  if (!membership || membership.role !== context.role) throw new ContextEngineError("CONTEXT_ACCESS_DENIED", correlationId);
  const conversation = await tx.aIConversation.findFirst({ where: { id: input.conversationId, organizationId: context.organizationId, createdById: context.userId, projectId: { not: null } }, select: { projectId: true } });
  if (!conversation?.projectId) throw new ContextEngineError("CONTEXT_ACCESS_DENIED", correlationId);
  const project = await tx.project.findFirst({ where: { id: conversation.projectId, organizationId: context.organizationId }, select: { id: true, status: true } });
  if (!project || !isContextProjectStatusActive(project.status)) throw new ContextEngineError("CONTEXT_ACCESS_DENIED", correlationId);
  const request = ContextRequestSchema.parse({ schemaVersion: "CONTEXT_BUNDLE_V1", requestId: randomUUID(), correlationId, organizationId: context.organizationId, projectId: project.id, userId: context.userId, conversationId: input.conversationId, purpose: input.purpose, policyVersion: policy.version, requestedAt: clock.now().toISOString() });
  const selected = await readContextCandidates(tx, request, policy);
  const bundle = buildOrThrow(request, selected, correlationId);
  try {
    await tx.auditLog.create({ data: { organizationId: context.organizationId, userId: context.userId, projectId: project.id, action: "CONTEXT_PREPARED", entityType: "ContextBundle", entityId: safeContextRef("audit", correlationId), metadata: { purpose: bundle.purpose, classification: bundle.classification, result: "READY", itemCount: bundle.measurements.itemCount, excludedCount: bundle.exclusions.reduce((sum, item) => sum + item.count, 0), correlationRef: bundle.correlationRef } } });
  } catch { throw new ContextEngineError("CONTEXT_AUDIT_UNAVAILABLE", correlationId); }
  return bundle;
}

export interface ContextConsumptionInput {
  bundle: ContextBundle;
  correlationId: string;
  organizationId: string;
  projectId?: string;
  userId: string;
  conversationId: string;
  idempotencyKey?: string;
  executionLogId: string;
}

/** Must run after the ledger acquires its mutation barrier and inside the QUEUED -> RUNNING transaction. */
export async function consumeContextBundleInTransaction(tx: Prisma.TransactionClient, input: ContextConsumptionInput, clock: ContextEngineClock = systemClock): Promise<void> {
  const now = clock.now();
  let bundle: ContextBundle;
  try { bundle = assertBundleScope(input.bundle, { ...input, now }); }
  catch { throw new ContextEngineError("CONTEXT_INTEGRITY_FAILED", input.correlationId); }
  const membership = await tx.organizationMembership.findFirst({ where: { organizationId: input.organizationId, userId: input.userId, isActive: true, user: { isActive: true } }, select: { role: true } });
  if (!membership) throw new ContextEngineError("CONTEXT_ACCESS_DENIED", input.correlationId);
  const policy = contextPolicyFor(bundle.purpose);
  try { assertAiUse({ role: membership.role }, policy.domainCapability); } catch { throw new ContextEngineError("CONTEXT_ACCESS_DENIED", input.correlationId); }
  const conversation = await tx.aIConversation.findFirst({ where: { id: input.conversationId, organizationId: input.organizationId, createdById: input.userId, projectId: { not: null } }, select: { projectId: true } });
  if (!conversation?.projectId || conversation.projectId !== input.projectId) throw new ContextEngineError("CONTEXT_ACCESS_DENIED", input.correlationId);
  const project = await tx.project.findFirst({ where: { id: conversation.projectId, organizationId: input.organizationId }, select: { id: true, status: true } });
  if (!project || !isContextProjectStatusActive(project.status)) throw new ContextEngineError("CONTEXT_ACCESS_DENIED", input.correlationId);
  const readRequest = ContextRequestSchema.parse({ schemaVersion: "CONTEXT_BUNDLE_V1", requestId: randomUUID(), correlationId: input.correlationId, organizationId: input.organizationId, projectId: project.id, userId: input.userId, conversationId: input.conversationId, purpose: bundle.purpose, policyVersion: policy.version, requestedAt: now.toISOString() });
  const selected = await readContextCandidates(tx, readRequest, policy);
  // Sources are evaluated at consumption time, while the fingerprint is rebuilt for the
  // original canonical preparation instant. A later source/version therefore cannot extend
  // the original validity window or masquerade as the prepared bundle.
  const rebuildRequest = ContextRequestSchema.parse({ ...readRequest, requestedAt: bundle.preparedAt });
  const rebuilt = buildOrThrow(rebuildRequest, selected, input.correlationId);
  if (rebuilt.fingerprint !== bundle.fingerprint || rebuilt.classification !== bundle.classification) throw new ContextEngineError("CONTEXT_CONCURRENT_CHANGE", input.correlationId);
  try { assertBundleScope(bundle, { ...input, now: clock.now() }); }
  catch { throw new ContextEngineError("CONTEXT_INTEGRITY_FAILED", input.correlationId); }
  try {
    await tx.auditLog.create({ data: { organizationId: input.organizationId, userId: input.userId, projectId: project.id, action: "CONTEXT_CONSUMED", entityType: "AIExecutionLog", entityId: input.executionLogId, metadata: { purpose: bundle.purpose, policyVersion: bundle.policyVersion, fingerprint: bundle.fingerprint, requestRef: bundle.requestRef, correlationRef: bundle.correlationRef, result: "TRANSPORT_AUTHORIZED" } } });
  } catch { throw new ContextEngineError("CONTEXT_AUDIT_UNAVAILABLE", input.correlationId); }
}
