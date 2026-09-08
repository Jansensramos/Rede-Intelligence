import { createHash, randomUUID } from "node:crypto";
import { Prisma, type IntegrationJob } from "@prisma/client";
import { z } from "zod";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { assertIntegrationCapability, decideRetry, type IntegrationCapability } from "@/domain/integrations";
import { ENTERPRISE_CODE, ENTERPRISE_JOB, EnterpriseError as Failure, enterpriseConfiguration, enterpriseRequest, enterpriseBinding, enterpriseEntity, opaqueId, normalizeEnterpriseItem, supportsEnterpriseEntity, pullEnterprisePage, type EnterpriseItem, type EnterpriseEntity, type EnterpriseTransport } from "@/domain/integrations/enterprise-provider";
import { encryptEnterpriseEvidence, decryptEnterpriseEvidence, enterpriseDigest } from "@/infrastructure/security/enterprise-evidence-cipher";
import { authorizeEnterpriseData, readEnterpriseProjection } from "./enterprise-projection";
import { registerConnectorDefinition } from "./integrations-service";

type Context = Pick<AuthContext, "organizationId" | "userId" | "role">;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = (value: unknown) => value as Prisma.InputJsonValue;
const jobPayload = z.object({ userId: opaqueId, request: enterpriseRequest, configHash: z.string(), fingerprint: z.string(), simulated: z.boolean().optional(), evidenceIds: z.array(z.string()).optional() }).strict();
const createInput = z.object({ name: z.string().trim().min(1).max(120), projectId: opaqueId, capability: z.enum(["ERP", "CRM"]), sourceKey: opaqueId, retentionDays: z.number().int().min(1).max(180) }).strict();
export type CreateEnterpriseInstallation = z.infer<typeof createInput>;
async function authorize(tx: Prisma.TransactionClient, context: Context, capability: IntegrationCapability, entity?: EnterpriseEntity) {
  await tx.$queryRaw`SELECT id FROM organization_memberships WHERE organization_id=${context.organizationId} AND user_id=${context.userId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM users WHERE id=${context.userId} FOR SHARE`;
  const member = await tx.organizationMembership.findFirst({ where: { organizationId: context.organizationId, userId: context.userId, isActive: true, user: { isActive: true } } });
  try {
    if (!member) throw new Error(); assertIntegrationCapability(context.role, capability); assertIntegrationCapability(member.role, capability);
    if (entity) { authorizeEnterpriseData(context.role, entity); authorizeEnterpriseData(member.role, entity); }
  } catch { throw new Failure("FORBIDDEN", "AUTHORIZATION"); }
}
async function lock(tx: Prisma.TransactionClient, organizationId: string) { await tx.$queryRaw`SELECT id FROM organizations WHERE id=${organizationId} FOR UPDATE`; }
async function installed(tx: Prisma.TransactionClient, context: Context, id: string) {
  await tx.$queryRaw`SELECT id FROM connector_installations WHERE id=${id} AND organization_id=${context.organizationId} FOR UPDATE`;
  const row = await tx.connectorInstallation.findFirst({ where: { id, organizationId: context.organizationId, connectorDefinition: { code: ENTERPRISE_CODE } } });
  if (!row?.projectId || !await tx.project.findFirst({ where: { id: row.projectId, organizationId: context.organizationId }, select: { id: true } })) throw new Failure("FORBIDDEN", "AUTHORIZATION");
  return row;
}
function config(raw: unknown) { const parsed = enterpriseConfiguration.safeParse(raw); if (!parsed.success) throw new Failure("INVALID_INPUT"); return parsed.data; }
function usable(row: { status: string; direction: string; configuration: unknown }) {
  const c = config(row.configuration);
  if (c.mode === "REAL") throw new Failure("REAL_NOT_CONFIGURED", "BUSINESS_RULE");
  if (c.mode !== "MOCK" || row.status !== "ACTIVE" || row.direction !== "INBOUND") throw new Failure("DISABLED", "BUSINESS_RULE");
  return c;
}
function audit(tx: Prisma.TransactionClient, context: Context, id: string, action: string, metadata: unknown) { return tx.auditLog.create({ data: { organizationId: context.organizationId, userId: context.userId, entityId: id, entityType: "EnterpriseProvider", action, metadata: json(metadata) } }); }
const namespace = (c: ReturnType<typeof config>) => `${c.capability}:${c.sourceKey}`;
const externalKey = (organizationId: string, source: string, entity: EnterpriseEntity, externalId: string) => enterpriseDigest([organizationId, source, entity, externalId]);
export async function createEnterpriseInstallation(context: Context, raw: CreateEnterpriseInstallation) {
  const parsed = createInput.safeParse(raw); if (!parsed.success) throw new Failure("INVALID_INPUT"); const input = parsed.data;
  await authorize(prisma, context, "INTEGRATION_CONFIGURE");
  await registerConnectorDefinition({ code: ENTERPRISE_CODE, name: "ERP e CRM locais", provider: "UNASSIGNED", category: "OTHER", authMethod: "NONE", capabilities: ["ERP", "CRM"], adapterVersion: "1.0.0", contractVersion: "1.0", sandboxAvailable: false });
  return prisma.$transaction(async tx => {
    await lock(tx, context.organizationId); await authorize(tx, context, "INTEGRATION_CONFIGURE");
    if (!await tx.project.findFirst({ where: { id: input.projectId, organizationId: context.organizationId }, select: { id: true } })) throw new Failure("FORBIDDEN", "AUTHORIZATION");
    const definition = await tx.connectorDefinition.findUniqueOrThrow({ where: { code: ENTERPRISE_CODE } });
    const c = config({ mode: "DISABLED", capability: input.capability, sourceKey: input.sourceKey, retentionDays: input.retentionDays, perMinute: 10 });
    const row = await tx.connectorInstallation.create({ data: { organizationId: context.organizationId, projectId: input.projectId, createdById: context.userId, connectorDefinitionId: definition.id, name: input.name, direction: "INBOUND", status: "PAUSED", configuration: c } });
    await audit(tx, context, row.id, "ENTERPRISE_INSTALLATION_CREATED", { capability: c.capability, mode: c.mode }); return { id: row.id, status: row.status };
  });
}
export async function configureEnterpriseInstallation(context: Context, id: string, raw: unknown) {
  const c = config(raw);
  return prisma.$transaction(async tx => {
    await lock(tx, context.organizationId); await authorize(tx, context, "INTEGRATION_CONFIGURE"); const row = await installed(tx, context, id);
    if (namespace(config(row.configuration)) !== namespace(c)) throw new Failure("INVALID_INPUT");
    await tx.connectorInstallation.update({ where: { id }, data: { configuration: c, status: c.mode === "DISABLED" ? "PAUSED" : "ACTIVE" } });
    await audit(tx, context, id, "ENTERPRISE_CONFIGURED", { mode: c.mode, retentionDays: c.retentionDays, perMinute: c.perMinute }); return c;
  });
}
export async function bindEnterpriseEntity(context: Context, installationId: string, raw: unknown) {
  const parsed = enterpriseBinding.safeParse(raw); if (!parsed.success) throw new Failure("INVALID_INPUT"); const input = parsed.data;
  return prisma.$transaction(async tx => {
    await lock(tx, context.organizationId); await authorize(tx, context, "INTEGRATION_APPROVE", input.entityType);
    const installation = await installed(tx, context, installationId); const c = usable(installation);
    if (!supportsEnterpriseEntity(c.capability, input.entityType)) throw new Failure("INVALID_INPUT");
    await readEnterpriseProjection(tx, context.organizationId, installation.projectId!, input.entityType, input.entityId);
    const source = namespace(c); const key = externalKey(context.organizationId, source, input.entityType, input.externalId);
    const existing = await tx.externalEntityReference.findFirst({ where: { organizationId: context.organizationId, enterpriseSourceKey: source, externalType: input.entityType, externalId: key } });
    if (existing) { if (existing.installationId !== installationId || existing.entityType !== input.entityType || existing.entityId !== input.entityId || existing.projectId !== installation.projectId) throw new Failure("IDEMPOTENCY_CONFLICT"); return { id: existing.id }; }
    const row = await tx.externalEntityReference.create({ data: { organizationId: context.organizationId, installationId, enterpriseSourceKey: source, entityType: input.entityType, entityId: input.entityId, externalType: input.entityType, externalId: key, projectId: installation.projectId, metadata: { simulated: true, contractVersion: "1.0" } } });
    await audit(tx, context, row.id, "ENTERPRISE_CROSSWALK_APPROVED", { entityType: input.entityType, mode: "MOCK" }); return { id: row.id };
  });
}
export async function enqueueEnterpriseSync(context: Context, installationId: string, raw: unknown) {
  const parsed = enterpriseRequest.safeParse(raw); if (!parsed.success) throw new Failure("INVALID_INPUT"); const request = parsed.data;
  return prisma.$transaction(async tx => {
    await lock(tx, context.organizationId); await authorize(tx, context, "INTEGRATION_SYNC", request.entityType); const row = await installed(tx, context, installationId); const c = usable(row);
    if (!supportsEnterpriseEntity(c.capability, request.entityType)) throw new Failure("INVALID_INPUT");
    const id = `ep_${hash([context.organizationId, installationId, request.idempotencyKey])}`; const fingerprint = enterpriseDigest(request);
    const existing = await tx.integrationJob.findUnique({ where: { id } });
    if (existing) { const payload = jobPayload.safeParse(existing.payload); if (!payload.success || payload.data.fingerprint !== fingerprint) throw new Failure("IDEMPOTENCY_CONFLICT"); return { id, status: existing.status }; }
    const rowJob = await tx.integrationJob.create({ data: { id, organizationId: context.organizationId, installationId, jobType: ENTERPRISE_JOB, maxAttempts: 5, correlationId: randomUUID(), payload: json({ userId: context.userId, request, fingerprint, configHash: hash(c) }) } });
    await audit(tx, context, id, "ENTERPRISE_QUEUED", { entityType: request.entityType, mode: "MOCK" }); return { id, status: rowJob.status };
  });
}
class QuarantineFailure extends Failure {
  constructor(reason: "UNMAPPED" | "EVIDENCE_CONFLICT", readonly item: EnterpriseItem) { super(reason, "MAPPING"); }
}
export async function processEnterpriseJob(job: IntegrationJob, signal: AbortSignal, transport?: EnterpriseTransport) {
  try { await prisma.$transaction(async tx => {
    await lock(tx, job.organizationId); await tx.$queryRaw`SELECT id FROM integration_jobs WHERE id=${job.id} FOR UPDATE`;
    const current = await tx.integrationJob.findFirst({ where: { id: job.id, organizationId: job.organizationId, jobType: ENTERPRISE_JOB } });
    if (!current?.installationId) throw new Failure("FORBIDDEN", "AUTHORIZATION");
    if (current.status === "SUCCEEDED") return;
    if (current.status !== "RUNNING" || !job.leaseOwner || current.leaseOwner !== job.leaseOwner || current.attemptCount !== job.attemptCount || !current.leaseExpiresAt || current.leaseExpiresAt <= new Date()) throw new Failure("LEASE_LOST", "BUSINESS_RULE");
    const parsed = jobPayload.safeParse(current.payload); if (!parsed.success) throw new Failure("INVALID_INPUT"); const payload = parsed.data;
    const member = await tx.organizationMembership.findFirst({ where: { organizationId: job.organizationId, userId: payload.userId } }); if (!member) throw new Failure("FORBIDDEN", "AUTHORIZATION");
    const context = { organizationId: job.organizationId, userId: payload.userId, role: member.role };
    await authorize(tx, context, "INTEGRATION_SYNC", payload.request.entityType);
    const row = await installed(tx, context, current.installationId); const c = usable(row);
    if (hash(c) !== payload.configHash || !supportsEnterpriseEntity(c.capability, payload.request.entityType)) throw new Failure("DISABLED", "BUSINESS_RULE");
    if (current.createdAt.getTime() + c.retentionDays * 86_400_000 <= Date.now()) throw new Failure("EXPIRED", "BUSINESS_RULE");
    const cursorKey = { installationId: row.id, capability: ENTERPRISE_JOB, partitionKey: hash([payload.request.entityType, c]) };
    const cursorScope = `enterprise-cursor:${row.id}:${cursorKey.partitionKey}`;
    const previous = await tx.integrationCursor.findUnique({ where: { installationId_capability_partitionKey: cursorKey } });
    let cursor = previous?.cursorValue ? opaqueId.parse(decryptEnterpriseEvidence(previous.cursorValue, cursorScope)) : null;
    const rateKey = { organizationId: job.organizationId, scopeKey: `enterprise:${row.id}` }; const now = new Date();
    const rate = await tx.integrationRateLimitState.findUnique({ where: { organizationId_scopeKey: rateKey } });
    const sameWindow = rate && now.getTime() - rate.windowStart.getTime() < 60_000;
    if (sameWindow && rate.requestCount >= c.perMinute) throw new Failure("RATE_LIMIT", "RATE_LIMIT", 60_000 - (now.getTime() - rate.windowStart.getTime()));
    const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]); const seen = new Set<string>(); const evidenceIds = new Set<string>();
    for (let page = 0; page < 10; page++) {
      const response = await pullEnterprisePage(c.mode, { entityType: payload.request.entityType, requestKey: current.id, cursor }, combinedSignal, transport);
      for (const item of response.items) {
        combinedSignal.throwIfAborted();
        const reference = await tx.externalEntityReference.findFirst({ where: { organizationId: job.organizationId, enterpriseSourceKey: namespace(c), externalType: item.entityType, externalId: externalKey(job.organizationId, namespace(c), item.entityType, item.externalId) } });
        if (!reference) throw new QuarantineFailure("UNMAPPED", item);
        if (reference.installationId !== row.id || reference.projectId !== row.projectId || reference.entityType !== item.entityType) throw new Failure("FORBIDDEN", "AUTHORIZATION");
        const local = await readEnterpriseProjection(tx, job.organizationId, row.projectId!, item.entityType, reference.entityId);
        const unique = { installationId: row.id, referenceId: reference.id, versionHash: enterpriseDigest([item.externalId, item.externalVersion]) };
        const contentHash = enterpriseDigest(item); const old = await tx.enterpriseSyncEvidence.findUnique({ where: { installationId_referenceId_versionHash: unique } });
        if (old) { if (old.contentHash !== contentHash) throw new QuarantineFailure("EVIDENCE_CONFLICT", item); if (old.expiresAt <= now) throw new Failure("EXPIRED", "BUSINESS_RULE"); evidenceIds.add(old.id); continue; }
        const id = `ee_${hash([job.organizationId, unique])}`; const divergent = enterpriseDigest(local.data) !== enterpriseDigest(item.data);
        await tx.enterpriseSyncEvidence.create({ data: { id, organizationId: job.organizationId, ...unique, jobId: current.id, contentHash, localHash: enterpriseDigest(local), encryptedPayload: encryptEnterpriseEvidence({ external: item, local }, id), divergent, recordedAt: now, expiresAt: new Date(now.getTime() + c.retentionDays * 86_400_000) } });
        if (divergent) await tx.integrationConflict.create({ data: { id: `ec_${id}`, organizationId: job.organizationId, installationId: row.id, externalReferenceId: reference.id, entityType: item.entityType, entityId: reference.entityId, fieldName: "ENTERPRISE_SNAPSHOT_V1", localValue: { evidenceId: id }, externalValue: { simulated: true }, policyApplied: "MANUAL_REVIEW" } });
        evidenceIds.add(id);
      }
      if (!response.nextCursor) { await tx.integrationCursor.upsert({ where: { installationId_capability_partitionKey: cursorKey }, create: { organizationId: job.organizationId, ...cursorKey, cursorValue: encryptEnterpriseEvidence(response.checkpoint, cursorScope), lastSuccessAt: now }, update: { cursorValue: encryptEnterpriseEvidence(response.checkpoint, cursorScope), lastSuccessAt: now } }); break; }
      if (page === 9 || seen.has(response.nextCursor) || response.nextCursor === cursor) throw new Failure("PAGINATION_LIMIT"); seen.add(response.nextCursor); cursor = response.nextCursor;
    }
    combinedSignal.throwIfAborted();
    await tx.integrationRateLimitState.upsert({ where: { organizationId_scopeKey: rateKey }, create: { ...rateKey, windowStart: now, requestCount: 1 }, update: { windowStart: sameWindow ? rate.windowStart : now, requestCount: sameWindow ? rate.requestCount + 1 : 1 } });
    await tx.integrationJob.update({ where: { id: current.id }, data: { status: "SUCCEEDED", finishedAt: now, leaseOwner: null, leaseExpiresAt: null, lastError: null, payload: json({ ...payload, simulated: true, evidenceIds: [...evidenceIds] }) } });
    await tx.integrationQuarantineItem.updateMany({ where: { organizationId: job.organizationId, installationId: row.id, capability: ENTERPRISE_JOB, payload: { path: ["jobId"], equals: job.id }, status: "PENDING" }, data: { status: "REVIEWED", reviewedById: context.userId, reviewedAt: now } });
    await audit(tx, context, current.id, "ENTERPRISE_SIMULATED", { entityType: payload.request.entityType, evidenceCount: evidenceIds.size, businessMutation: false });
  }, { timeout: 15_000, maxWait: 15_000 }); } catch (error) { if (error instanceof Failure) throw error; throw new Failure("CONTENT_UNAVAILABLE"); }
}

export async function failEnterpriseJob(job: IntegrationJob, error: Failure) {
  return prisma.$transaction(async tx => {
    await lock(tx, job.organizationId); await tx.$queryRaw`SELECT id FROM integration_jobs WHERE id=${job.id} FOR UPDATE`;
    const current = await tx.integrationJob.findFirst({ where: { id: job.id, organizationId: job.organizationId, jobType: ENTERPRISE_JOB, status: "RUNNING", leaseOwner: job.leaseOwner, attemptCount: job.attemptCount } }); if (!current || !job.leaseOwner) return;
    const parsed = jobPayload.safeParse(current.payload);
    const installation = current.installationId ? await tx.connectorInstallation.findFirst({ where: { id: current.installationId, organizationId: job.organizationId } }) : null;
    const actor = parsed.success ? await tx.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true } }) : null;
    const userId = actor?.id ?? installation?.createdById; if (!userId) throw new Failure("FORBIDDEN", "AUTHORIZATION");
    const decision = decideRetry({ errorClass: error.errorClass, attemptCount: current.attemptCount, retryAfterMs: error.retryAfterMs, policy: { baseDelayMs: 1000, maxDelayMs: 300_000, maxAttempts: current.maxAttempts, jitterRatio: 0.2 } });
    // Persist a newly constructed safe reason; never a transport's mutable Error.message.
    const reason = new Failure(error.reason).message;
    await tx.integrationJob.update({ where: { id: job.id }, data: { status: decision.action === "RETRY" ? "QUEUED" : "DEAD_LETTER", scheduledAt: decision.action === "RETRY" ? new Date(Date.now() + decision.delayMs) : current.scheduledAt, finishedAt: decision.action === "RETRY" ? null : new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: reason } });
    if (decision.action === "DEAD_LETTER") await tx.integrationDeadLetter.create({ data: { organizationId: job.organizationId, sourceType: "JOB", sourceId: job.id, installationId: current.installationId, reason, errorClass: error.errorClass, payload: { jobId: job.id } } });
    if (error instanceof QuarantineFailure && installation) {
      const item = normalizeEnterpriseItem(error.item); const id = `eq_${hash([job.id, enterpriseDigest(item)])}`;
      const expiresAt = new Date(Date.now() + config(installation.configuration).retentionDays * 86_400_000).toISOString();
      await tx.integrationQuarantineItem.upsert({ where: { id }, create: { id, organizationId: job.organizationId, installationId: installation.id, capability: ENTERPRISE_JOB, externalType: item.entityType, reason, errorClass: "MAPPING", payload: { jobId: job.id, expiresAt, ciphertext: encryptEnterpriseEvidence(item, id) } }, update: {} });
    }
    await audit(tx, { organizationId: job.organizationId, userId, role: "OWNER" }, job.id, `ENTERPRISE_${decision.action}`, { reason: error.reason, attempt: current.attemptCount }); return decision.action;
  });
}
export async function retryEnterpriseJob(context: Context, id: string) {
  return prisma.$transaction(async tx => {
    await lock(tx, context.organizationId); await authorize(tx, context, "INTEGRATION_RETRY");
    const job = await tx.integrationJob.findFirst({ where: { id, organizationId: context.organizationId, jobType: ENTERPRISE_JOB, status: "DEAD_LETTER" } }); if (!job?.installationId) throw new Failure("FORBIDDEN", "AUTHORIZATION");
    const parsed = jobPayload.safeParse(job.payload); if (!parsed.success) throw new Failure("INVALID_INPUT"); const payload = parsed.data;
    const row = await installed(tx, context, job.installationId); const c = usable(row);
    if (payload.configHash !== hash(c)) throw new Failure("DISABLED", "BUSINESS_RULE");
    if (job.createdAt.getTime() + c.retentionDays * 86_400_000 <= Date.now()) throw new Failure("EXPIRED", "BUSINESS_RULE");
    const member = await tx.organizationMembership.findFirst({ where: { organizationId: context.organizationId, userId: payload.userId } }); if (!member) throw new Failure("FORBIDDEN", "AUTHORIZATION");
    await authorize(tx, { ...context, userId: member.userId, role: member.role }, "INTEGRATION_SYNC", payload.request.entityType);
    await tx.integrationJob.update({ where: { id }, data: { status: "QUEUED", attemptCount: 0, scheduledAt: new Date(), finishedAt: null, lastError: null, leaseOwner: null, leaseExpiresAt: null } });
    await tx.integrationDeadLetter.updateMany({ where: { organizationId: context.organizationId, sourceType: "JOB", sourceId: id, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: context.userId, resolutionNotes: "Retentativa local solicitada" } });
    await audit(tx, context, id, "ENTERPRISE_MANUAL_RETRY", { mode: "MOCK" }); return { id, status: "QUEUED" };
  });
}
export async function listEnterpriseJobs(context: Context, installationId: string) {
  return prisma.$transaction(async tx => { await authorize(tx, context, "INTEGRATION_VIEW"); await installed(tx, context, installationId); return tx.integrationJob.findMany({ where: { organizationId: context.organizationId, installationId, jobType: ENTERPRISE_JOB }, select: { id: true, status: true, attemptCount: true, scheduledAt: true, lastError: true }, orderBy: { createdAt: "desc" }, take: 100 }); });
}
export async function listEnterpriseBindings(context: Context, installationId: string) {
  return prisma.$transaction(async tx => {
    await authorize(tx, context, "INTEGRATION_AUDIT"); await installed(tx, context, installationId);
    const rows = await tx.externalEntityReference.findMany({ where: { organizationId: context.organizationId, installationId, enterpriseSourceKey: { not: null } }, select: { id: true, entityType: true, entityId: true, projectId: true }, take: 100, orderBy: { createdAt: "desc" } });
    for (const row of rows) await authorize(tx, context, "INTEGRATION_AUDIT", enterpriseEntity.parse(row.entityType));
    await audit(tx, context, installationId, "ENTERPRISE_BINDINGS_LISTED", { count: rows.length }); return rows;
  });
}
async function evidenceForRead(tx: Prisma.TransactionClient, context: Context, installationId: string, id: string) {
  const row = await tx.enterpriseSyncEvidence.findFirst({ where: { id, organizationId: context.organizationId, installationId }, include: { reference: true, review: true } });
  if (!row) throw new Failure("FORBIDDEN", "AUTHORIZATION");
  await authorize(tx, context, "INTEGRATION_AUDIT", enterpriseEntity.parse(row.reference.entityType));
  if (row.expiresAt <= new Date()) throw new Failure("EXPIRED", "BUSINESS_RULE"); return row;
}
export async function readEnterpriseEvidence(context: Context, installationId: string, id: string) {
  return prisma.$transaction(async tx => {
    await authorize(tx, context, "INTEGRATION_AUDIT"); await installed(tx, context, installationId); const row = await evidenceForRead(tx, context, installationId, id);
    const value = decryptEnterpriseEvidence(row.encryptedPayload, row.id);
    await audit(tx, context, id, "ENTERPRISE_EVIDENCE_READ", { simulated: true });
    return { id, simulated: true, value, divergent: row.divergent, expiresAt: row.expiresAt, review: row.review ? { decision: row.review.decision, recordedAt: row.review.recordedAt } : null };
  });
}
export async function listEnterpriseEvidence(context: Context, installationId: string) {
  return prisma.$transaction(async tx => {
    await authorize(tx, context, "INTEGRATION_AUDIT"); await installed(tx, context, installationId);
    const rows = await tx.enterpriseSyncEvidence.findMany({ where: { organizationId: context.organizationId, installationId, expiresAt: { gt: new Date() } }, select: { id: true, jobId: true, reference: { select: { entityType: true } }, divergent: true, simulated: true, recordedAt: true, expiresAt: true, review: { select: { decision: true } } }, take: 100, orderBy: { recordedAt: "desc" } });
    for (const row of rows) await authorize(tx, context, "INTEGRATION_AUDIT", enterpriseEntity.parse(row.reference.entityType));
    await audit(tx, context, installationId, "ENTERPRISE_EVIDENCE_LISTED", { count: rows.length }); return rows;
  });
}
export async function reviewEnterpriseEvidence(context: Context, installationId: string, id: string, decision: "PROPOSE_REVISION" | "REJECT") {
  if (decision !== "PROPOSE_REVISION" && decision !== "REJECT") throw new Failure("INVALID_INPUT");
  return prisma.$transaction(async tx => {
    await lock(tx, context.organizationId); await authorize(tx, context, "INTEGRATION_APPROVE"); const installation = await installed(tx, context, installationId); usable(installation);
    const row = await evidenceForRead(tx, context, installationId, id);
    if (!row.divergent) throw new Failure("INVALID_INPUT");
    if (row.review) { if (row.review.decision !== decision) throw new Failure("IDEMPOTENCY_CONFLICT"); return { id: row.review.id, decision, businessMutation: false }; }
    const local = await readEnterpriseProjection(tx, context.organizationId, installation.projectId!, enterpriseEntity.parse(row.reference.entityType), row.reference.entityId);
    if (enterpriseDigest(local) !== row.localHash) throw new Failure("STALE_REVIEW", "BUSINESS_RULE");
    const review = await tx.enterpriseEvidenceReview.create({ data: { id: randomUUID(), organizationId: context.organizationId, evidenceId: id, userId: context.userId, decision } });
    await tx.integrationConflict.update({ where: { id: `ec_${id}` }, data: { status: "RESOLVED_MANUAL", resolvedById: context.userId, resolvedAt: review.recordedAt, resolution: { reviewId: review.id, decision, simulated: true, businessMutation: false } } });
    await audit(tx, context, id, "ENTERPRISE_EVIDENCE_REVIEWED", { decision, reviewId: review.id, businessMutation: false });
    return { id: review.id, decision, businessMutation: false };
  });
}
const quarantinePayload = z.object({ jobId: z.string(), expiresAt: z.string().datetime(), ciphertext: z.string() }).strict();
export async function listEnterpriseQuarantine(context: Context, installationId: string) {
  return prisma.$transaction(async tx => {
    await authorize(tx, context, "INTEGRATION_AUDIT"); await installed(tx, context, installationId);
    const rows = await tx.integrationQuarantineItem.findMany({ where: { organizationId: context.organizationId, installationId, capability: ENTERPRISE_JOB, status: "PENDING" }, select: { id: true, externalType: true, reason: true, status: true }, take: 100, orderBy: { createdAt: "desc" } });
    for (const row of rows) await authorize(tx, context, "INTEGRATION_AUDIT", enterpriseEntity.parse(row.externalType));
    await audit(tx, context, installationId, "ENTERPRISE_QUARANTINE_LISTED", { count: rows.length }); return rows;
  });
}
export async function readEnterpriseQuarantine(context: Context, installationId: string, id: string) {
  return prisma.$transaction(async tx => {
    await authorize(tx, context, "INTEGRATION_AUDIT"); await installed(tx, context, installationId);
    const row = await tx.integrationQuarantineItem.findFirst({ where: { id, organizationId: context.organizationId, installationId, capability: ENTERPRISE_JOB } }); if (!row) throw new Failure("FORBIDDEN", "AUTHORIZATION");
    await authorize(tx, context, "INTEGRATION_AUDIT", enterpriseEntity.parse(row.externalType)); const payload = quarantinePayload.safeParse(row.payload); if (!payload.success) throw new Failure("CONTENT_UNAVAILABLE");
    if (new Date(payload.data.expiresAt) <= new Date()) throw new Failure("EXPIRED", "BUSINESS_RULE");
    const item = normalizeEnterpriseItem(decryptEnterpriseEvidence(payload.data.ciphertext, id));
    await audit(tx, context, id, "ENTERPRISE_QUARANTINE_READ", { simulated: true }); return { id, item, jobId: payload.data.jobId, expiresAt: payload.data.expiresAt, simulated: true };
  });
}
export async function purgeEnterpriseEvidence(context: Context, installationId: string) {
  return prisma.$transaction(async tx => {
    await lock(tx, context.organizationId); await authorize(tx, context, "INTEGRATION_CONFIGURE"); await installed(tx, context, installationId);
    const now = new Date(); const expired = await tx.enterpriseSyncEvidence.findMany({ where: { organizationId: context.organizationId, installationId, expiresAt: { lte: now } }, select: { id: true }, take: 100, orderBy: { expiresAt: "asc" } }); const ids = expired.map(row => row.id);
    await tx.integrationConflict.deleteMany({ where: { organizationId: context.organizationId, installationId, id: { in: ids.map(id => `ec_${id}`) }, fieldName: "ENTERPRISE_SNAPSHOT_V1" } });
    await tx.enterpriseEvidenceReview.deleteMany({ where: { organizationId: context.organizationId, evidenceId: { in: ids } } });
    const result = await tx.enterpriseSyncEvidence.deleteMany({ where: { organizationId: context.organizationId, installationId, id: { in: ids } } });
    const quarantine = await tx.integrationQuarantineItem.findMany({ where: { organizationId: context.organizationId, installationId, capability: ENTERPRISE_JOB, payload: { path: ["expiresAt"], lt: now.toISOString() } }, select: { id: true }, take: 100, orderBy: { createdAt: "asc" } });
    await tx.integrationQuarantineItem.deleteMany({ where: { organizationId: context.organizationId, installationId, id: { in: quarantine.map(row => row.id) } } });
    await audit(tx, context, installationId, "ENTERPRISE_EVIDENCE_PURGED", { evidenceCount: result.count, quarantineCount: quarantine.length }); return { evidenceCount: result.count, quarantineCount: quarantine.length };
  });
}
