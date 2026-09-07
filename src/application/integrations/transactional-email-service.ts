import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { Prisma, type IntegrationJob } from "@prisma/client";
import { z } from "zod";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { assertIntegrationCapability, decideRetry, type IntegrationCapability } from "@/domain/integrations";
import { EMAIL_CODE, EMAIL_JOB, EmailError, deliverEmail, emailConfiguration, emailInput, renderEmail, type EmailTransport } from "@/domain/integrations/transactional-email";
import { registerConnectorDefinition } from "./integrations-service";

type Context = Pick<AuthContext, "organizationId" | "userId" | "role">;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const payloadSchema = z.object({ userId: z.string(), fingerprint: z.string(), encrypted: z.string(), mode: z.literal("MOCK"), simulated: z.boolean().optional() }).strict();
function key() {
  const secret = process.env.INTEGRATION_SECRET_KEY;
  if (!secret || secret.length < 32) throw new EmailError("CONTENT_UNAVAILABLE");
  return createHash("sha256").update(`email-content-v1:${secret}`).digest();
}
function seal(value: string, aad: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv); cipher.setAAD(Buffer.from(aad));
  return Buffer.concat([iv, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
}
function unseal(value: string, aad: string) {
  try { const bytes = Buffer.from(value, "base64"); const cipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12)); cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString("utf8"); }
  catch { throw new EmailError("CONTENT_UNAVAILABLE"); }
}
async function authorize(context: Context, capability: IntegrationCapability, tx: Prisma.TransactionClient = prisma) {
  await tx.$queryRaw`SELECT id FROM organization_memberships WHERE organization_id=${context.organizationId} AND user_id=${context.userId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM users WHERE id=${context.userId} FOR SHARE`;
  try { assertIntegrationCapability(context.role, capability); } catch { throw new EmailError("FORBIDDEN", "AUTHORIZATION"); }
  const member = await tx.organizationMembership.findFirst({ where: { organizationId: context.organizationId, userId: context.userId, isActive: true, user: { isActive: true } } });
  try { if (!member) throw new Error(); assertIntegrationCapability(member.role, capability); } catch { throw new EmailError("FORBIDDEN", "AUTHORIZATION"); }
}
async function lockTenant(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id=${organizationId} FOR UPDATE`;
}
async function installation(tx: Prisma.TransactionClient, context: Context, id: string) {
  await tx.$queryRaw`SELECT id FROM connector_installations WHERE id=${id} AND organization_id=${context.organizationId} FOR UPDATE`;
  const row = await tx.connectorInstallation.findFirst({ where: { id, organizationId: context.organizationId, connectorDefinition: { code: EMAIL_CODE } } });
  if (!row) throw new EmailError("FORBIDDEN", "AUTHORIZATION");
  return row;
}
function audit(tx: Prisma.TransactionClient, context: Context, id: string, action: string, metadata: unknown) {
  return tx.auditLog.create({ data: { organizationId: context.organizationId, userId: context.userId, entityId: id, entityType: "TransactionalEmail", action, metadata: json(metadata) } });
}
function configuration(raw: unknown) { const result = emailConfiguration.safeParse(raw); if (!result.success) throw new EmailError("INVALID_INPUT"); return result.data; }
export async function createEmailInstallation(context: Context, name: string) {
  await authorize(context, "INTEGRATION_CONFIGURE");
  if (!name.trim() || name.length > 120) throw new EmailError("INVALID_INPUT");
  await registerConnectorDefinition({ code: EMAIL_CODE, name: "E-mail transacional local", provider: "UNASSIGNED", category: "OTHER", authMethod: "NONE", capabilities: [{ code: "TRANSACTIONAL_EMAIL", direction: "OUTBOUND" }], adapterVersion: "1.0.0", contractVersion: "1.0", sandboxAvailable: false });
  return prisma.$transaction(async tx => {
    await lockTenant(tx, context.organizationId); await authorize(context, "INTEGRATION_CONFIGURE", tx);
    const definition = await tx.connectorDefinition.findUniqueOrThrow({ where: { code: EMAIL_CODE } });
    const created = await tx.connectorInstallation.create({ data: { organizationId: context.organizationId, connectorDefinitionId: definition.id, name: name.trim(), direction: "OUTBOUND", status: "PAUSED", createdById: context.userId, configuration: { mode: "DISABLED", perMinute: 10 } } });
    await audit(tx, context, created.id, "EMAIL_INSTALLATION_CREATED", { mode: "DISABLED", provider: "UNASSIGNED" });
    return { id: created.id, status: created.status };
  });
}
export async function configureEmailInstallation(context: Context, id: string, raw: unknown) {
  const config = configuration(raw);
  return prisma.$transaction(async tx => {
    await lockTenant(tx, context.organizationId); await authorize(context, "INTEGRATION_CONFIGURE", tx); await installation(tx, context, id);
    // REAL can be recorded as intent but never constitutes operational proof.
    await tx.connectorInstallation.update({ where: { id }, data: { configuration: config, status: config.mode === "DISABLED" ? "PAUSED" : "ACTIVE" } });
    await audit(tx, context, id, "EMAIL_CONFIGURED", config);
    return config;
  });
}
export async function enqueueEmail(context: Context, installationId: string, raw: unknown) {
  const parsed = emailInput.safeParse(raw); if (!parsed.success) throw new EmailError("INVALID_INPUT");
  const input = parsed.data;
  const id = `email_${hash(JSON.stringify([context.organizationId, installationId, input.idempotencyKey]))}`;
  const fingerprint = createHmac("sha256", key()).update(JSON.stringify(input)).digest("hex");
  return prisma.$transaction(async tx => {
    await lockTenant(tx, context.organizationId); await authorize(context, "INTEGRATION_SYNC", tx);
    const row = await installation(tx, context, installationId); const config = configuration(row.configuration);
    if (config.mode === "REAL") throw new EmailError("REAL_NOT_CONFIGURED", "BUSINESS_RULE");
    if (config.mode === "DISABLED" || row.status !== "ACTIVE") throw new EmailError("DISABLED", "BUSINESS_RULE");
    const existing = await tx.integrationJob.findUnique({ where: { id } });
    if (existing) { if (payloadSchema.parse(existing.payload).fingerprint !== fingerprint) throw new EmailError("IDEMPOTENCY_CONFLICT"); return { id, status: existing.status }; }
    const payload = { userId: context.userId, fingerprint, encrypted: seal(JSON.stringify(input), `${context.organizationId}:${installationId}:${id}`), mode: "MOCK" };
    const job = await tx.integrationJob.create({ data: { id, organizationId: context.organizationId, installationId, jobType: EMAIL_JOB, payload, maxAttempts: 5, correlationId: randomUUID() } });
    await audit(tx, context, id, "EMAIL_QUEUED", { template: input.template, mode: "MOCK" });
    return { id, status: job.status };
  });
}
export async function processEmailJob(job: IntegrationJob, signal: AbortSignal, transport?: EmailTransport) {
  try {
    await prisma.$transaction(async tx => {
      await lockTenant(tx, job.organizationId);
      await tx.$queryRaw`SELECT id FROM integration_jobs WHERE id=${job.id} FOR UPDATE`;
      const current = await tx.integrationJob.findFirst({ where: { id: job.id, organizationId: job.organizationId, jobType: EMAIL_JOB } });
      if (!current || !current.installationId) throw new EmailError("FORBIDDEN", "AUTHORIZATION");
      if (current.status === "SUCCEEDED") return;
      if (current.status !== "RUNNING" || !job.leaseOwner || current.leaseOwner !== job.leaseOwner || current.attemptCount !== job.attemptCount || !current.leaseExpiresAt || current.leaseExpiresAt <= new Date()) throw new EmailError("LEASE_LOST", "BUSINESS_RULE");
      const payload = payloadSchema.parse(current.payload);
      const member = await tx.organizationMembership.findFirst({ where: { organizationId: job.organizationId, userId: payload.userId } });
      if (!member) throw new EmailError("FORBIDDEN", "AUTHORIZATION");
      const context = { organizationId: job.organizationId, userId: payload.userId, role: member.role };
      await authorize(context, "INTEGRATION_SYNC", tx);
      const row = await installation(tx, context, current.installationId); const config = configuration(row.configuration);
      if (config.mode === "REAL") throw new EmailError("REAL_NOT_CONFIGURED", "BUSINESS_RULE");
      if (config.mode !== payload.mode || row.status !== "ACTIVE") throw new EmailError("DISABLED", "BUSINESS_RULE");
      const scopeKey = `transactional-email:${row.id}`; const now = new Date();
      const rate = await tx.integrationRateLimitState.findUnique({ where: { organizationId_scopeKey: { organizationId: job.organizationId, scopeKey } } });
      const sameWindow = rate && now.getTime() - rate.windowStart.getTime() < 60_000;
      if (sameWindow && rate.requestCount >= config.perMinute) throw new EmailError("RATE_LIMIT", "RATE_LIMIT", 60_000 - (now.getTime() - rate.windowStart.getTime()));
      const input = emailInput.parse(JSON.parse(unseal(payload.encrypted, `${job.organizationId}:${row.id}:${job.id}`)));
      const receipt = await deliverEmail(config.mode, renderEmail(input), current.id, AbortSignal.any([signal, AbortSignal.timeout(10_000)]), transport);
      signal.throwIfAborted();
      await tx.integrationRateLimitState.upsert({ where: { organizationId_scopeKey: { organizationId: job.organizationId, scopeKey } }, create: { organizationId: job.organizationId, scopeKey, windowStart: now, requestCount: 1 }, update: { windowStart: sameWindow ? rate.windowStart : now, requestCount: sameWindow ? rate.requestCount + 1 : 1 } });
      await tx.integrationJob.update({ where: { id: current.id }, data: { status: "SUCCEEDED", finishedAt: now, leaseOwner: null, leaseExpiresAt: null, payload: { ...payload, simulated: true } } });
      await audit(tx, context, current.id, "EMAIL_SIMULATED", receipt);
    }, { timeout: 15_000, maxWait: 15_000 });
  } catch (error) { if (error instanceof EmailError) throw error; throw new EmailError("CONTENT_UNAVAILABLE"); }
}
/** Fenced failure transition: a stale worker cannot retry or dead-letter a newer lease. */
export async function failEmailJob(job: IntegrationJob, error: EmailError) {
  return prisma.$transaction(async tx => {
    await lockTenant(tx, job.organizationId);
    await tx.$queryRaw`SELECT id FROM integration_jobs WHERE id=${job.id} FOR UPDATE`;
    const current = await tx.integrationJob.findFirst({ where: { id: job.id, organizationId: job.organizationId, jobType: EMAIL_JOB, status: "RUNNING", leaseOwner: job.leaseOwner, attemptCount: job.attemptCount } });
    if (!current || !job.leaseOwner) return;
    const payload = payloadSchema.safeParse(current.payload);
    const row = current.installationId ? await tx.connectorInstallation.findFirst({ where: { id: current.installationId, organizationId: job.organizationId } }) : null;
    const userId = payload.success ? payload.data.userId : row?.createdById;
    if (!userId) throw new EmailError("FORBIDDEN", "AUTHORIZATION");
    const decision = decideRetry({ errorClass: error.errorClass, attemptCount: current.attemptCount, retryAfterMs: error.retryAfterMs, policy: { baseDelayMs: 1000, maxDelayMs: 300_000, maxAttempts: current.maxAttempts, jitterRatio: 0.2 } });
    await tx.integrationJob.update({ where: { id: current.id }, data: { status: decision.action === "RETRY" ? "QUEUED" : "DEAD_LETTER", scheduledAt: decision.action === "RETRY" ? new Date(Date.now() + decision.delayMs) : current.scheduledAt, finishedAt: decision.action === "RETRY" ? null : new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: error.message } });
    if (decision.action === "DEAD_LETTER") await tx.integrationDeadLetter.create({ data: { organizationId: job.organizationId, sourceType: "JOB", sourceId: job.id, installationId: current.installationId, reason: error.message, errorClass: error.errorClass, payload: { jobId: job.id } } });
    await audit(tx, { organizationId: job.organizationId, userId, role: "OWNER" }, job.id, `EMAIL_${decision.action}`, { reason: error.reason, attempt: current.attemptCount });
    return decision.action;
  });
}
export async function listEmailJobs(context: Context, installationId: string) {
  return prisma.$transaction(async tx => {
    await authorize(context, "INTEGRATION_VIEW", tx); await installation(tx, context, installationId);
    return tx.integrationJob.findMany({ where: { organizationId: context.organizationId, installationId, jobType: EMAIL_JOB }, select: { id: true, status: true, attemptCount: true, scheduledAt: true, finishedAt: true, lastError: true }, take: 100, orderBy: { createdAt: "desc" } });
  });
}
export async function retryEmailJob(context: Context, id: string) {
  return prisma.$transaction(async tx => {
    await lockTenant(tx, context.organizationId); await authorize(context, "INTEGRATION_RETRY", tx);
    const job = await tx.integrationJob.findFirst({ where: { id, organizationId: context.organizationId, jobType: EMAIL_JOB, status: "DEAD_LETTER" } });
    if (!job?.installationId) throw new EmailError("FORBIDDEN", "AUTHORIZATION");
    const row = await installation(tx, context, job.installationId);
    if (configuration(row.configuration).mode !== "MOCK" || row.status !== "ACTIVE") throw new EmailError("DISABLED", "BUSINESS_RULE");
    const payload = payloadSchema.parse(job.payload);
    // A retry never transfers the original actor's authority to the retrier.
    const member = await tx.organizationMembership.findFirst({ where: { organizationId: context.organizationId, userId: payload.userId } });
    if (!member) throw new EmailError("FORBIDDEN", "AUTHORIZATION");
    await authorize({ ...context, userId: member.userId, role: member.role }, "INTEGRATION_SYNC", tx);
    await tx.integrationJob.update({ where: { id }, data: { status: "QUEUED", attemptCount: 0, scheduledAt: new Date(), finishedAt: null, lastError: null, leaseOwner: null, leaseExpiresAt: null } });
    await tx.integrationDeadLetter.updateMany({ where: { organizationId: context.organizationId, sourceId: id, sourceType: "JOB", resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: context.userId, resolutionNotes: "Manual local retry" } });
    await audit(tx, context, id, "EMAIL_MANUAL_RETRY", { mode: "MOCK" });
    return { id, status: "QUEUED" as const };
  });
}
