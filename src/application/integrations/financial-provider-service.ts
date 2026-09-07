import { createHash, randomUUID } from "node:crypto";
import { Prisma, type IntegrationJob } from "@prisma/client";
import { z } from "zod";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { assertIntegrationCapability, decideRetry, type IntegrationCapability } from "@/domain/integrations";
import { FINANCIAL_CODE, FINANCIAL_JOB, FinancialProviderError as Failure, financialConfiguration, financialRequest, operationCapability, executeFinancialTransport, bankPage, bureauResult, fundingResult, type FinancialRequest, type FinancialTransport } from "@/domain/integrations/financial-provider";
import { encryptFinancialEvidence, decryptFinancialEvidence, financialEvidenceDigest } from "@/infrastructure/security/financial-evidence-cipher";
import { registerConnectorDefinition } from "./integrations-service";
import { assembleFundingDossier } from "@/application/capital/capital-dossier";
type Context = Pick<AuthContext, "organizationId" | "userId" | "role">;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = (value: unknown) => value as Prisma.InputJsonValue;
const jobPayload = z.object({ userId: z.string(), request: financialRequest, configHash: z.string(), fingerprint: z.string(), targetHash: z.string(), dossier: z.string().optional(), simulated: z.boolean().optional(), evidenceIds: z.array(z.string()).optional() }).strict();
async function authorize(tx: Prisma.TransactionClient, context: Context, capability: IntegrationCapability) {
  await tx.$queryRaw`SELECT id FROM organization_memberships WHERE organization_id=${context.organizationId} AND user_id=${context.userId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM users WHERE id=${context.userId} FOR SHARE`;
  const member = await tx.organizationMembership.findFirst({ where: { organizationId: context.organizationId, userId: context.userId, isActive: true, user: { isActive: true } } });
  try { if (!member) throw new Error(); assertIntegrationCapability(context.role, capability); assertIntegrationCapability(member.role, capability); } catch { throw new Failure("FORBIDDEN", "AUTHORIZATION"); }
}
async function lock(tx: Prisma.TransactionClient, organizationId: string) { await tx.$queryRaw`SELECT id FROM organizations WHERE id=${organizationId} FOR UPDATE`; }
async function installed(tx: Prisma.TransactionClient, context: Context, id: string) {
  await tx.$queryRaw`SELECT id FROM connector_installations WHERE id=${id} AND organization_id=${context.organizationId} FOR UPDATE`;
  const row = await tx.connectorInstallation.findFirst({ where: { id, organizationId: context.organizationId, connectorDefinition: { code: FINANCIAL_CODE } } });
  if (!row?.projectId) throw new Failure("FORBIDDEN", "AUTHORIZATION");
  return row;
}
function config(raw: unknown) { const parsed = financialConfiguration.safeParse(raw); if (!parsed.success) throw new Failure("INVALID_INPUT"); return parsed.data; }
function usable(row: { status: string; configuration: unknown }) { const c = config(row.configuration); if (c.mode === "REAL") throw new Failure("REAL_NOT_CONFIGURED", "BUSINESS_RULE"); if (c.mode !== "MOCK" || row.status !== "ACTIVE") throw new Failure("DISABLED", "BUSINESS_RULE"); return c; }
function audit(tx: Prisma.TransactionClient, context: Context, id: string, action: string, metadata: unknown) { return tx.auditLog.create({ data: { organizationId: context.organizationId, userId: context.userId, entityId: id, entityType: "FinancialProvider", action, metadata: json(metadata) } }); }
async function target(tx: Prisma.TransactionClient, context: Context, projectId: string, request: FinancialRequest) {
  const project = await tx.project.findFirst({ where: { id: projectId, organizationId: context.organizationId }, select: { id: true, companyId: true } }); if (!project) throw new Failure("FORBIDDEN", "AUTHORIZATION");
  if (request.operation === "BANK_SYNC") {
    await tx.$queryRaw`SELECT id FROM bank_accounts WHERE id=${request.targetId} FOR SHARE`;
    const account = await tx.bankAccount.findFirst({ where: { id: request.targetId, organizationId: context.organizationId, companyId: project.companyId ?? "", status: "ACTIVE", OR: [{ projectId }, { projectId: null }] }, select: { id: true } });
    if (!account) throw new Failure("FORBIDDEN", "AUTHORIZATION");
  } else if (request.operation === "BUREAU_CONSULT") {
    const customer = await tx.customer.findFirst({ where: { id: request.targetId, organizationId: context.organizationId }, select: { id: true } });
    // Purpose is tied to an actual proposal in this project; never accepts an unrelated tenant customer.
    const proposal = await tx.salesProposal.findFirst({ where: { customerId: request.targetId, organizationId: context.organizationId, projectId }, select: { id: true } });
    if (!customer || !proposal) throw new Failure("FORBIDDEN", "AUTHORIZATION");
  } else {
    await tx.$queryRaw`SELECT id FROM funding_proposals WHERE id=${request.targetId} FOR SHARE`;
    const proposal = await tx.fundingProposal.findFirst({ where: { id: request.targetId, organizationId: context.organizationId, projectId }, select: { id: true, version: true, amount: true, currency: true } });
    if (!proposal) throw new Failure("FORBIDDEN", "AUTHORIZATION");
    return { id: proposal.id, version: proposal.version, amount: proposal.amount.toFixed(2), currency: proposal.currency, projectId };
  }
}
export async function createFinancialInstallation(context: Context, input: { name: string; projectId: string; capability: "BANK" | "BUREAU" | "FUNDING"; retentionDays: number }) {
  const c = config({ mode: "DISABLED", capability: input.capability, retentionDays: input.retentionDays, perMinute: 10 });
  if (!input.name?.trim() || input.name.length > 120) throw new Failure("INVALID_INPUT");
  await authorize(prisma, context, "INTEGRATION_CONFIGURE");
  await registerConnectorDefinition({ code: FINANCIAL_CODE, name: "Financeiro e crédito local", provider: "UNASSIGNED", category: "OTHER", authMethod: "NONE", capabilities: ["BANK", "BUREAU", "FUNDING"], adapterVersion: "1.0.0", contractVersion: "1.0", sandboxAvailable: false });
  return prisma.$transaction(async tx => {
    await lock(tx, context.organizationId); await authorize(tx, context, "INTEGRATION_CONFIGURE");
    if (!await tx.project.findFirst({ where: { id: input.projectId, organizationId: context.organizationId } })) throw new Failure("FORBIDDEN", "AUTHORIZATION");
    const definition = await tx.connectorDefinition.findUniqueOrThrow({ where: { code: FINANCIAL_CODE } });
    const row = await tx.connectorInstallation.create({ data: { organizationId: context.organizationId, projectId: input.projectId, createdById: context.userId, connectorDefinitionId: definition.id, name: input.name.trim(), direction: "BIDIRECTIONAL", status: "PAUSED", configuration: c } });
    await audit(tx, context, row.id, "FINANCIAL_INSTALLATION_CREATED", c); return { id: row.id, status: row.status };
  });
}
export async function configureFinancialInstallation(context: Context, id: string, raw: unknown) {
  const c = config(raw);
  return prisma.$transaction(async tx => {
    await lock(tx, context.organizationId); await authorize(tx, context, "INTEGRATION_CONFIGURE"); const row = await installed(tx, context, id);
    if (config(row.configuration).capability !== c.capability) throw new Failure("INVALID_INPUT");
    await tx.connectorInstallation.update({ where: { id }, data: { configuration: c, status: c.mode === "DISABLED" ? "PAUSED" : "ACTIVE" } });
    await audit(tx, context, id, "FINANCIAL_CONFIGURED", c); return c;
  });
}
export async function enqueueFinancialOperation(context: Context, installationId: string, raw: unknown) {
  const parsed = financialRequest.safeParse(raw); if (!parsed.success) throw new Failure("INVALID_INPUT"); const request = parsed.data;
  return prisma.$transaction(async tx => {
    await lock(tx, context.organizationId); await authorize(tx, context, "INTEGRATION_SYNC"); const row = await installed(tx, context, installationId); const c = usable(row);
    if (operationCapability[request.operation] !== c.capability) throw new Failure("INVALID_INPUT");
    const currentTarget = await target(tx, context, row.projectId!, request);
    const id = `fp_${hash([context.organizationId, installationId, request.idempotencyKey])}`; const fingerprint = hash(request);
    const existing = await tx.integrationJob.findUnique({ where: { id } });
    if (existing) { if (jobPayload.parse(existing.payload).fingerprint !== fingerprint) throw new Failure("IDEMPOTENCY_CONFLICT"); return { id, status: existing.status }; }
    const dossier = request.operation === "FUNDING_SUBMIT" ? encryptFinancialEvidence(await assembleFundingDossier(context, row.projectId!), id) : undefined;
    const created = await tx.integrationJob.create({ data: { id, organizationId: context.organizationId, installationId, jobType: FINANCIAL_JOB, maxAttempts: 5, correlationId: randomUUID(), payload: json({ userId: context.userId, request, fingerprint, configHash: hash(c), targetHash: hash(currentTarget ?? request.targetId), ...(dossier ? { dossier } : {}) }) } });
    await audit(tx, context, id, "FINANCIAL_QUEUED", { operation: request.operation, mode: "MOCK", ...(request.operation === "BUREAU_CONSULT" ? { purpose: request.purpose, legalBasis: request.legalBasis } : {}) });
    return { id, status: created.status };
  }, { timeout: 30_000 });
}
export async function processFinancialJob(job: IntegrationJob, signal: AbortSignal, transport?: FinancialTransport) {
  try { await prisma.$transaction(async tx => {
    await lock(tx, job.organizationId); await tx.$queryRaw`SELECT id FROM integration_jobs WHERE id=${job.id} FOR UPDATE`;
    const current = await tx.integrationJob.findFirst({ where: { id: job.id, organizationId: job.organizationId, jobType: FINANCIAL_JOB } });
    if (!current?.installationId) throw new Failure("FORBIDDEN", "AUTHORIZATION");
    if (current.status === "SUCCEEDED") return;
    if (current.status !== "RUNNING" || !job.leaseOwner || current.leaseOwner !== job.leaseOwner || current.attemptCount !== job.attemptCount || !current.leaseExpiresAt || current.leaseExpiresAt <= new Date()) throw new Failure("LEASE_LOST", "BUSINESS_RULE");
    const payload = jobPayload.parse(current.payload); const request = payload.request;
    const member = await tx.organizationMembership.findFirst({ where: { organizationId: job.organizationId, userId: payload.userId } }); if (!member) throw new Failure("FORBIDDEN", "AUTHORIZATION");
    const context = { organizationId: job.organizationId, userId: payload.userId, role: member.role }; await authorize(tx, context, "INTEGRATION_SYNC");
    const row = await installed(tx, context, current.installationId); const c = usable(row);
    if (current.createdAt.getTime() + c.retentionDays * 86_400_000 <= Date.now()) throw new Failure("EXPIRED", "BUSINESS_RULE");
    if (hash(c) !== payload.configHash || operationCapability[request.operation] !== c.capability) throw new Failure("DISABLED", "BUSINESS_RULE");
    const proposal = await target(tx, context, row.projectId!, request);
    if (hash(proposal ?? request.targetId) !== payload.targetHash) throw new Failure("EVIDENCE_CONFLICT");
    const dossier = request.operation === "FUNDING_SUBMIT" && payload.dossier ? z.record(z.string(), z.unknown()).parse(decryptFinancialEvidence(payload.dossier, current.id)) : undefined;
    if (request.operation === "FUNDING_SUBMIT" && !dossier) throw new Failure("CONTENT_UNAVAILABLE");
    let submissionReference: string | undefined;
    if (request.operation === "FUNDING_STATUS") {
      const submission = await tx.financialProviderEvidence.findFirst({ where: { id: request.submissionId, organizationId: job.organizationId, installationId: row.id, targetId: request.targetId, operation: "FUNDING_SUBMIT", expiresAt: { gt: new Date() } } });
      if (!submission) throw new Failure("FORBIDDEN", "AUTHORIZATION");
      submissionReference = fundingResult.parse(decryptFinancialEvidence(submission.encryptedPayload, submission.id)).externalId;
    }
    const partitionKey = hash([request.targetId, payload.configHash]);
    const cursorKey = { installationId: row.id, capability: "FINANCIAL_BANK", partitionKey };
    let cursor = request.operation === "BANK_SYNC" ? (await tx.integrationCursor.findUnique({ where: { installationId_capability_partitionKey: cursorKey } }))?.cursorValue ?? null : null;
    const seen = new Set<string>(); const evidenceIds: string[] = [];
    const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    for (let page = 0; page < 10; page++) {
      const now = new Date(); const scopeKey = `financial-provider:${row.id}`;
      const rateKey = { organizationId: job.organizationId, scopeKey }; const rate = await tx.integrationRateLimitState.findUnique({ where: { organizationId_scopeKey: rateKey } });
      const sameWindow = rate && now.getTime() - rate.windowStart.getTime() < 60_000;
      if (page === 0 && sameWindow && rate.requestCount >= c.perMinute) throw new Failure("RATE_LIMIT", "RATE_LIMIT", 60_000 - (now.getTime() - rate.windowStart.getTime()));
      const response = await executeFinancialTransport(c.mode, { operation: request.operation, targetId: request.targetId, requestKey: current.id, cursor, proposal, dossier, submissionReference }, combinedSignal, transport);
      combinedSignal.throwIfAborted();
      const values = request.operation === "BANK_SYNC" ? bankPage.parse(response).transactions : [request.operation === "BUREAU_CONSULT" ? bureauResult.parse(response) : fundingResult.parse(response)];
      for (const value of values) {
        const externalKeyHash = hash(request.operation === "FUNDING_STATUS" ? [value.externalId, financialEvidenceDigest(value)] : value.externalId);
        const unique = { installationId: row.id, operation: request.operation, targetId: request.targetId, externalKeyHash }; const contentHash = financialEvidenceDigest(value);
        const existing = await tx.financialProviderEvidence.findUnique({ where: { installationId_operation_targetId_externalKeyHash: unique } });
        if (existing) { if (existing.contentHash !== contentHash) throw new Failure("EVIDENCE_CONFLICT"); if (existing.expiresAt <= now) throw new Failure("EXPIRED", "BUSINESS_RULE"); evidenceIds.push(existing.id); continue; }
        const id = `fpe_${hash(unique)}`;
        await tx.financialProviderEvidence.create({ data: { id, organizationId: job.organizationId, ...unique, jobId: current.id, contentHash, encryptedPayload: encryptFinancialEvidence(value, id), recordedAt: now, expiresAt: new Date(now.getTime() + c.retentionDays * 86_400_000) } }); evidenceIds.push(id);
      }
      if (page === 0) await tx.integrationRateLimitState.upsert({ where: { organizationId_scopeKey: rateKey }, create: { ...rateKey, windowStart: now, requestCount: 1 }, update: { windowStart: sameWindow ? rate.windowStart : now, requestCount: sameWindow ? rate.requestCount + 1 : 1 } });
      if (request.operation !== "BANK_SYNC") break;
      const bank = bankPage.parse(response);
      if (!bank.nextCursor) { await tx.integrationCursor.upsert({ where: { installationId_capability_partitionKey: cursorKey }, create: { organizationId: job.organizationId, ...cursorKey, cursorValue: bank.checkpoint, lastSuccessAt: now }, update: { cursorValue: bank.checkpoint, lastSuccessAt: now } }); break; }
      if (page === 9 || seen.has(bank.nextCursor) || bank.nextCursor === cursor) throw new Failure("PAGINATION_LIMIT"); seen.add(bank.nextCursor); cursor = bank.nextCursor;
    }
    combinedSignal.throwIfAborted();
    await tx.integrationJob.update({ where: { id: current.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, payload: json({ ...payload, simulated: true, evidenceIds: [...new Set(evidenceIds)] }) } });
    await audit(tx, context, job.id, "FINANCIAL_SIMULATED", { operation: request.operation, count: new Set(evidenceIds).size, ...(request.operation === "BUREAU_CONSULT" ? { legalBasis: request.legalBasis, purpose: request.purpose } : {}) });
  }, { timeout: 15_000, maxWait: 15_000 }); } catch (error) { if (error instanceof Failure) throw error; throw new Failure("CONTENT_UNAVAILABLE"); }
}
export async function failFinancialJob(job: IntegrationJob, error: Failure) {
  return prisma.$transaction(async tx => {
    await lock(tx, job.organizationId); await tx.$queryRaw`SELECT id FROM integration_jobs WHERE id=${job.id} FOR UPDATE`;
    const current = await tx.integrationJob.findFirst({ where: { id: job.id, organizationId: job.organizationId, jobType: FINANCIAL_JOB, status: "RUNNING", leaseOwner: job.leaseOwner, attemptCount: job.attemptCount } }); if (!current || !job.leaseOwner) return;
    const parsed = jobPayload.safeParse(current.payload);
    const installation = current.installationId ? await tx.connectorInstallation.findFirst({ where: { id: current.installationId, organizationId: job.organizationId } }) : null;
    const actorExists = parsed.success ? await tx.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true } }) : null;
    const userId = actorExists?.id ?? installation?.createdById;
    if (!userId) throw new Failure("FORBIDDEN", "AUTHORIZATION");
    const decision = decideRetry({ errorClass: error.errorClass, attemptCount: current.attemptCount, retryAfterMs: error.retryAfterMs, policy: { baseDelayMs: 1000, maxDelayMs: 300_000, maxAttempts: current.maxAttempts, jitterRatio: 0.2 } });
    await tx.integrationJob.update({ where: { id: job.id }, data: { status: decision.action === "RETRY" ? "QUEUED" : "DEAD_LETTER", scheduledAt: decision.action === "RETRY" ? new Date(Date.now() + decision.delayMs) : current.scheduledAt, finishedAt: decision.action === "RETRY" ? null : new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: error.message } });
    if (decision.action === "DEAD_LETTER") await tx.integrationDeadLetter.create({ data: { organizationId: job.organizationId, sourceType: "JOB", sourceId: job.id, installationId: current.installationId, reason: error.message, errorClass: error.errorClass, payload: { jobId: job.id } } });
    await audit(tx, { organizationId: job.organizationId, userId, role: "OWNER" }, job.id, `FINANCIAL_${decision.action}`, { reason: error.reason, attempt: current.attemptCount }); return decision.action;
  });
}
export async function readFinancialEvidence(context: Context, installationId: string, id: string) {
  return prisma.$transaction(async tx => {
    await authorize(tx, context, "INTEGRATION_AUDIT"); await authorize(tx, context, "INTEGRATION_SYNC"); await installed(tx, context, installationId);
    const record = await tx.financialProviderEvidence.findFirst({ where: { id, organizationId: context.organizationId, installationId } }); if (!record) throw new Failure("FORBIDDEN", "AUTHORIZATION"); if (record.expiresAt <= new Date()) throw new Failure("EXPIRED", "BUSINESS_RULE");
    const value = decryptFinancialEvidence(record.encryptedPayload, record.id); await audit(tx, context, id, "FINANCIAL_EVIDENCE_READ", { operation: record.operation });
    return { id, mode: "MOCK", value, expiresAt: record.expiresAt };
  });
}
export async function listFinancialEvidence(context: Context, installationId: string) {
  return prisma.$transaction(async tx => {
    await authorize(tx, context, "INTEGRATION_AUDIT"); await authorize(tx, context, "INTEGRATION_SYNC"); await installed(tx, context, installationId);
    const records = await tx.financialProviderEvidence.findMany({ where: { organizationId: context.organizationId, installationId, expiresAt: { gt: new Date() } }, select: { id: true, operation: true, jobId: true, simulated: true, recordedAt: true, expiresAt: true }, orderBy: { recordedAt: "desc" }, take: 100 });
    await audit(tx, context, installationId, "FINANCIAL_EVIDENCE_LISTED", { count: records.length }); return records;
  });
}
export async function purgeFinancialEvidence(context: Context, installationId: string) {
  return prisma.$transaction(async tx => {
    await lock(tx, context.organizationId); await authorize(tx, context, "INTEGRATION_CONFIGURE"); const installation = await installed(tx, context, installationId);
    const expired = await tx.financialProviderEvidence.findMany({ where: { organizationId: context.organizationId, installationId, expiresAt: { lte: new Date() } }, select: { id: true }, take: 100 });
    const result = await tx.financialProviderEvidence.deleteMany({ where: { id: { in: expired.map(row => row.id) }, organizationId: context.organizationId, installationId } });
    const oldJobs = await tx.integrationJob.findMany({ where: { organizationId: context.organizationId, installationId, jobType: FINANCIAL_JOB, payload: { path: ["dossier"], string_starts_with: "" }, createdAt: { lte: new Date(Date.now() - config(installation.configuration).retentionDays * 86_400_000) }, status: { not: "RUNNING" } }, orderBy: { createdAt: "asc" }, take: 100 });
    for (const job of oldJobs) { const parsed = jobPayload.safeParse(job.payload); if (parsed.success && parsed.data.dossier) { const cleaned = { ...parsed.data }; delete cleaned.dossier; await tx.integrationJob.update({ where: { id: job.id }, data: { payload: json(cleaned) } }); } }
    await audit(tx, context, installationId, "FINANCIAL_EVIDENCE_PURGED", { count: result.count }); return result;
  });
}
export async function listFinancialJobs(context: Context, installationId: string) {
  return prisma.$transaction(async tx => { await authorize(tx, context, "INTEGRATION_VIEW"); await installed(tx, context, installationId); return tx.integrationJob.findMany({ where: { organizationId: context.organizationId, installationId, jobType: FINANCIAL_JOB }, select: { id: true, status: true, attemptCount: true, scheduledAt: true, lastError: true }, orderBy: { createdAt: "desc" }, take: 100 }); });
}
export async function retryFinancialJob(context: Context, id: string) {
  return prisma.$transaction(async tx => {
    await lock(tx, context.organizationId); await authorize(tx, context, "INTEGRATION_RETRY");
    const row = await tx.integrationJob.findFirst({ where: { id, organizationId: context.organizationId, jobType: FINANCIAL_JOB, status: "DEAD_LETTER" } }); if (!row?.installationId) throw new Failure("FORBIDDEN", "AUTHORIZATION");
    const payload = jobPayload.parse(row.payload); const installation = await installed(tx, context, row.installationId); const c = usable(installation);
    if (row.createdAt.getTime() + c.retentionDays * 86_400_000 <= Date.now()) throw new Failure("EXPIRED", "BUSINESS_RULE");
    const member = await tx.organizationMembership.findFirst({ where: { organizationId: context.organizationId, userId: payload.userId } }); if (!member) throw new Failure("FORBIDDEN", "AUTHORIZATION");
    await authorize(tx, { ...context, userId: member.userId, role: member.role }, "INTEGRATION_SYNC"); await target(tx, context, installation.projectId!, payload.request);
    if (payload.configHash !== hash(c)) throw new Failure("DISABLED", "BUSINESS_RULE");
    await tx.integrationJob.update({ where: { id }, data: { status: "QUEUED", attemptCount: 0, scheduledAt: new Date(), finishedAt: null, lastError: null, leaseOwner: null, leaseExpiresAt: null } });
    await tx.integrationDeadLetter.updateMany({ where: { organizationId: context.organizationId, sourceType: "JOB", sourceId: id, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: context.userId, resolutionNotes: "Local retry" } });
    await audit(tx, context, id, "FINANCIAL_MANUAL_RETRY", { mode: "MOCK" }); return { id, status: "QUEUED" };
  });
}
