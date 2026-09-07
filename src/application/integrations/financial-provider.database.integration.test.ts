import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { createFinancialInstallation, configureFinancialInstallation, enqueueFinancialOperation, processFinancialJob, readFinancialEvidence, failFinancialJob, retryFinancialJob, purgeFinancialEvidence, listFinancialJobs, listFinancialEvidence } from "./financial-provider-service";
import { FinancialProviderError, type FinancialTransport } from "@/domain/integrations/financial-provider";
import { dispatchJob } from "@/application/worker/job-dispatcher";
import { DurableWorker } from "@/application/worker/worker-runtime";
import * as fundingDossier from "@/application/capital/capital-dossier";
describe.sequential("9P.4 financial provider persistence and adversarial gates", () => {
  let context: { organizationId: string; userId: string; role: "OWNER" };
  const fixtures: Record<string, { projectId: string; targetId: string }> = {}; const installations: string[] = [];
  beforeAll(async () => {
    const m = await prisma.organizationMembership.findFirstOrThrow({ where: { organization: { slug: "rede-nucleo-de-negocios" }, user: { email: "admin@rede.local" } } }); context = { organizationId: m.organizationId, userId: m.userId, role: "OWNER" };
    const account = await prisma.bankAccount.findFirstOrThrow({ where: { organizationId: context.organizationId, status: "ACTIVE" } });
    const project = account.projectId ?? (await prisma.project.findFirstOrThrow({ where: { organizationId: context.organizationId, companyId: account.companyId } })).id;
    fixtures.BANK = { projectId: project, targetId: account.id };
    const sale = await prisma.salesProposal.findFirstOrThrow({ where: { organizationId: context.organizationId } }); fixtures.BUREAU = { projectId: sale.projectId, targetId: sale.customerId };
    const funding = await prisma.fundingProposal.findFirstOrThrow({ where: { organizationId: context.organizationId } }); fixtures.FUNDING = { projectId: funding.projectId, targetId: funding.id };
  });
  afterAll(async () => { await prisma.integrationJob.updateMany({ where: { installationId: { in: installations }, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCELLED" } }); await prisma.connectorInstallation.updateMany({ where: { id: { in: installations } }, data: { status: "PAUSED" } }); await prisma.$disconnect(); });
  async function installation(capability: "BANK" | "BUREAU" | "FUNDING" = "BANK", perMinute = 10) { const i = await createFinancialInstallation(context, { name: "Financial local QA", projectId: fixtures[capability].projectId, capability, retentionDays: 30 }); installations.push(i.id); await configureFinancialInstallation(context, i.id, { mode: "MOCK", capability, retentionDays: 30, perMinute }); return i.id; }
  const request = (capability = "BANK") => ({ idempotencyKey: randomUUID(), targetId: fixtures[capability].targetId, operation: capability === "BANK" ? "BANK_SYNC" : capability === "BUREAU" ? "BUREAU_CONSULT" : "FUNDING_SUBMIT", ...(capability === "BUREAU" ? { legalBasis: "CREDIT_PROTECTION", purpose: "SALE_PROPOSAL_ANALYSIS" } : {}) });
  async function claim(id: string, attemptCount = 1) { return prisma.integrationJob.update({ where: { id }, data: { status: "RUNNING", attemptCount, leaseOwner: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000) } }); }
  const item = (externalId = "tx-1", amount = "25.00") => ({ externalId, amount, occurredAt: "2026-09-07T00:00:00Z", direction: "CREDIT" });
  const bank = (transactions: unknown[], nextCursor: string | null = null) => ({ transactions, nextCursor, checkpoint: "checkpoint-final" });
  function transport(values: unknown[]): FinancialTransport { return { kind: "LOCAL_SIMULATION", execute: vi.fn(async () => { if (!values.length) throw new Error("Unexpected call"); const next = values.shift(); if (next instanceof Error) throw next; return next; }) }; }
  it("serializes duplicate requests and paginated evidence without mutating the official ledger", async () => {
    const id = await installation(); const raw = request(); const before = await prisma.bankTransaction.count({ where: { bankAccountId: raw.targetId } });
    const jobs = await Promise.all([enqueueFinancialOperation(context, id, raw), enqueueFinancialOperation(context, id, raw)]); expect(jobs[0].id).toBe(jobs[1].id);
    await expect(enqueueFinancialOperation(context, id, { ...raw, targetId: randomUUID() })).rejects.toThrow();
    const job = await claim(jobs[0].id); const fake = transport([bank([item()], "page-2"), bank([item("tx-2")])]);
    await processFinancialJob(job, new AbortController().signal, fake); await processFinancialJob(job, new AbortController().signal, fake); expect(fake.execute).toHaveBeenCalledTimes(2);
    expect(await prisma.financialProviderEvidence.count({ where: { installationId: id } })).toBe(2); expect(await prisma.bankTransaction.count({ where: { bankAccountId: raw.targetId } })).toBe(before);
    const j2 = await enqueueFinancialOperation(context, id, request()); const replay = transport([bank([item(), item("tx-2")])]); await processFinancialJob(await claim(j2.id), new AbortController().signal, replay);
    expect(replay.execute).toHaveBeenCalledWith(expect.objectContaining({ cursor: "checkpoint-final" }), expect.any(AbortSignal)); expect(await prisma.financialProviderEvidence.count({ where: { installationId: id } })).toBe(2);
  });
  it("rolls back an entire failed page sequence and replays without losing values", async () => {
    const id = await installation(); const j = await enqueueFinancialOperation(context, id, request()); const job = await claim(j.id);
    await expect(processFinancialJob(job, new AbortController().signal, transport([bank([item()], "p2"), new Error("private account")]))).rejects.toThrow("TRANSPORT_FAILURE");
    expect(await prisma.financialProviderEvidence.count({ where: { installationId: id } })).toBe(0); expect(await prisma.integrationCursor.count({ where: { installationId: id } })).toBe(0);
    await processFinancialJob(job, new AbortController().signal, transport([bank([item()])]));
  });
  it("rejects a conflicting bank event instead of overwriting its immutable value", async () => {
    const id = await installation(); const a = await enqueueFinancialOperation(context, id, request()); await processFinancialJob(await claim(a.id), new AbortController().signal, transport([bank([item()])]));
    const b = await enqueueFinancialOperation(context, id, request()); await expect(processFinancialJob(await claim(b.id), new AbortController().signal, transport([bank([item("tx-1", "30.00")])]))).rejects.toThrow("EVIDENCE_CONFLICT");
    const record = await prisma.financialProviderEvidence.findFirstOrThrow({ where: { installationId: id } }); expect((await readFinancialEvidence(context, id, record.id)).value).toMatchObject({ amount: "25.00" });
  });
  it("stores a minimal immutable bureau snapshot with purpose/legal basis and no raw tax ID", async () => {
    const id = await installation("BUREAU"); const raw = request("BUREAU"); const before = await prisma.creditBureauConsultation.count({ where: { organizationId: context.organizationId } });
    await expect(enqueueFinancialOperation(context, id, { ...raw, legalBasis: undefined })).rejects.toThrow("INVALID_INPUT");
    const j = await enqueueFinancialOperation(context, id, raw); await dispatchJob(await claim(j.id), new AbortController().signal);
    const record = await prisma.financialProviderEvidence.findFirstOrThrow({ where: { jobId: j.id } }); expect(record.encryptedPayload).not.toContain("INSUFFICIENT_DATA");
    expect((await readFinancialEvidence(context, id, record.id)).value).toMatchObject({ score: null, recommendation: "INSUFFICIENT_DATA" });
    const logs = await prisma.auditLog.findMany({ where: { entityId: j.id } }); expect(logs.some(l => JSON.stringify(l.metadata).includes("CREDIT_PROTECTION"))).toBe(true);
    expect(await prisma.creditBureauConsultation.count({ where: { organizationId: context.organizationId } })).toBe(before);
    await expect(prisma.financialProviderEvidence.update({ where: { id: record.id }, data: { contentHash: "a".repeat(64) } })).rejects.toThrow("IMMUTABLE");
    await expect(prisma.financialProviderEvidence.delete({ where: { id: record.id } })).rejects.toThrow("IMMUTABLE");
    await expect(prisma.$executeRaw`TRUNCATE financial_provider_evidence`).rejects.toThrow("IMMUTABLE");
    await expect(readFinancialEvidence({ ...context, role: "VIEWER" }, id, record.id)).rejects.toThrow("FORBIDDEN");
  });
  it("expires and purges snapshots without recalculation or a residual plaintext report", async () => {
    const id = await installation("BUREAU"); const j = await enqueueFinancialOperation(context, id, request("BUREAU")); await processFinancialJob(await claim(j.id), new AbortController().signal);
    const original = await prisma.financialProviderEvidence.findFirstOrThrow({ where: { jobId: j.id } }); const expiredId = `expired_${randomUUID()}`;
    await prisma.financialProviderEvidence.create({ data: { ...original, id: expiredId, externalKeyHash: createHash("sha256").update(expiredId).digest("hex"), recordedAt: new Date(Date.now() - 172_800_000), expiresAt: new Date(Date.now() - 86_400_000) } });
    await expect(readFinancialEvidence(context, id, expiredId)).rejects.toThrow("EXPIRED");
    expect(await purgeFinancialEvidence(context, id)).toEqual({ count: 1 }); expect(await prisma.financialProviderEvidence.findUnique({ where: { id: expiredId } })).toBeNull(); expect(await prisma.financialProviderEvidence.findUnique({ where: { id: original.id } })).not.toBeNull();
  });
  it("keeps funding submissions and reported releases separate from debt, obligations and realized disbursements", async () => {
    const id = await installation("FUNDING"); const raw = request("FUNDING"); const original = await prisma.fundingProposal.findUniqueOrThrow({ where: { id: raw.targetId } });
    const count = await prisma.fundingDisbursement.count({ where: { proposal: { organizationId: context.organizationId } } }); const obligations = await prisma.financialObligation.count({ where: { organizationId: context.organizationId } });
    const j = await enqueueFinancialOperation(context, id, raw); await processFinancialJob(await claim(j.id), new AbortController().signal);
    const submission = await prisma.financialProviderEvidence.findFirstOrThrow({ where: { jobId: j.id } });
    expect(await listFinancialEvidence(context, id)).toEqual([expect.objectContaining({ id: submission.id, jobId: j.id, operation: "FUNDING_SUBMIT", simulated: true })]);
    expect((await listFinancialEvidence(context, id))[0]).not.toHaveProperty("encryptedPayload");
    const status = await enqueueFinancialOperation(context, id, { operation: "FUNDING_STATUS", targetId: raw.targetId, submissionId: submission.id, idempotencyKey: randomUUID() });
    await processFinancialJob(await claim(status.id), new AbortController().signal, transport([{ externalId: j.id, state: "RELEASE_REPORTED", amount: "100.00" }]));
    expect(await prisma.fundingProposal.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original); expect(await prisma.fundingDisbursement.count({ where: { proposal: { organizationId: context.organizationId } } })).toBe(count); expect(await prisma.financialObligation.count({ where: { organizationId: context.organizationId } })).toBe(obligations);
  });
  it("freezes and encrypts the existing funding dossier before a retryable submission", async () => {
    const id = await installation("FUNDING"); const raw = request("FUNDING"); const j = await enqueueFinancialOperation(context, id, raw);
    const job = await claim(j.id); expect(JSON.stringify(job.payload)).not.toContain("necessidadeDeCapital");
    const noRecalculation = vi.spyOn(fundingDossier, "assembleFundingDossier").mockRejectedValue(new Error("must not recompute"));
    const fake = transport([{ externalId: j.id, state: "SUBMITTED" }]);
    try {
      await processFinancialJob(job, new AbortController().signal, fake);
      expect(fake.execute).toHaveBeenCalledWith(expect.objectContaining({ dossier: expect.objectContaining({ project: expect.objectContaining({ id: fixtures.FUNDING.projectId }), necessidadeDeCapital: expect.any(Object), propostasRegistradas: expect.any(Array) }) }), expect.any(AbortSignal));
      expect(noRecalculation).not.toHaveBeenCalled();
    } finally { noRecalculation.mockRestore(); }
    await prisma.integrationJob.update({ where: { id: j.id }, data: { createdAt: new Date(Date.now() - 31 * 86_400_000) } });
    await purgeFinancialEvidence(context, id);
    expect((await prisma.integrationJob.findUniqueOrThrow({ where: { id: j.id } })).payload).not.toHaveProperty("dossier");
  });
  it("denies foreign installations to another authorized tenant and enforces database scope", async () => {
    const id = await installation(); const org = await prisma.organization.create({ data: { name: "Financial QA isolation", slug: `financial-qa-${randomUUID()}`, memberships: { create: { userId: context.userId, role: "OWNER" } } } }); const other = { ...context, organizationId: org.id };
    await expect(enqueueFinancialOperation(other, id, request())).rejects.toThrow("FORBIDDEN"); await expect(listFinancialJobs(other, id)).rejects.toThrow("FORBIDDEN");
    const j = await enqueueFinancialOperation(context, id, request()); await processFinancialJob(await claim(j.id), new AbortController().signal, transport([bank([item()])])); const record = await prisma.financialProviderEvidence.findFirstOrThrow({ where: { jobId: j.id } });
    await expect(readFinancialEvidence(other, id, record.id)).rejects.toThrow("FORBIDDEN");
    await expect(prisma.financialProviderEvidence.create({ data: { ...record, id: randomUUID(), organizationId: org.id } })).rejects.toThrow("SCOPE_INVALID");
  });
  it("blocks REAL, disabled, forged role and stale configuration before transport", async () => {
    const id = await installation(); await expect(enqueueFinancialOperation({ ...context, role: "VIEWER" }, id, request())).rejects.toThrow("FORBIDDEN");
    const j = await enqueueFinancialOperation(context, id, request()); const job = await claim(j.id); const fake = transport([]);
    await configureFinancialInstallation(context, id, { mode: "REAL", capability: "BANK", perMinute: 10, retentionDays: 30 }); await expect(enqueueFinancialOperation(context, id, request())).rejects.toThrow("REAL_NOT_CONFIGURED"); await expect(processFinancialJob(job, new AbortController().signal, fake)).rejects.toThrow("REAL_NOT_CONFIGURED");
    await configureFinancialInstallation(context, id, { mode: "DISABLED", capability: "BANK", perMinute: 10, retentionDays: 30 }); await expect(processFinancialJob(job, new AbortController().signal, fake)).rejects.toThrow("DISABLED"); expect(fake.execute).not.toHaveBeenCalled();
  });
  it("rate limits completed operations, retries safely, and fences an older attempt of the same worker", async () => {
    const id = await installation("BANK", 1); const a = await enqueueFinancialOperation(context, id, request()); await processFinancialJob(await claim(a.id), new AbortController().signal);
    const b = await enqueueFinancialOperation(context, id, request()); const old = await claim(b.id);
    await expect(processFinancialJob(old, new AbortController().signal)).rejects.toThrow("RATE_LIMIT"); expect(await failFinancialJob(old, new FinancialProviderError("RATE_LIMIT", "RATE_LIMIT", 2000))).toBe("RETRY");
    await prisma.integrationJob.update({ where: { id: b.id }, data: { status: "RUNNING", leaseOwner: old.leaseOwner, leaseExpiresAt: new Date(Date.now() + 60_000), attemptCount: 2 } });
    await expect(processFinancialJob(old, new AbortController().signal)).rejects.toThrow("LEASE_LOST"); await failFinancialJob(old, new FinancialProviderError("INVALID_RESPONSE")); expect((await prisma.integrationJob.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("RUNNING");
  });
  it("dead-letters once and permits only an authorized manual retry", async () => {
    const id = await installation(); const j = await enqueueFinancialOperation(context, id, request()); const job = await claim(j.id, 5);
    expect(await failFinancialJob(job, new FinancialProviderError("TRANSPORT_FAILURE", "NETWORK"))).toBe("DEAD_LETTER"); await failFinancialJob(job, new FinancialProviderError("TRANSPORT_FAILURE", "NETWORK")); expect(await prisma.integrationDeadLetter.count({ where: { sourceId: job.id } })).toBe(1);
    await expect(retryFinancialJob({ ...context, role: "VIEWER" }, job.id)).rejects.toThrow("FORBIDDEN"); expect(await retryFinancialJob(context, job.id)).toMatchObject({ id: job.id, status: "QUEUED" });
  });
  it("aborts without committing snapshots and refuses repeated pagination cursors", async () => {
    const id = await installation(); const j = await enqueueFinancialOperation(context, id, request()); const job = await claim(j.id); const c = new AbortController();
    await expect(processFinancialJob(job, c.signal, { kind: "LOCAL_SIMULATION", execute: async () => { c.abort(); return bank([item()]); } })).rejects.toThrow();
    await expect(processFinancialJob(job, new AbortController().signal, transport([bank([item()], "same"), bank([item()], "same")]))).rejects.toThrow("PAGINATION_LIMIT"); expect(await prisma.financialProviderEvidence.count({ where: { installationId: id } })).toBe(0);
  });
  it("uses the audited worker failure path instead of exposing arbitrary errors", async () => {
    const id = await installation(); const j = await enqueueFinancialOperation(context, id, request()); const job = await claim(j.id); let claimed = false; const genericFail = vi.fn();
    const worker = new DurableWorker({ concurrency: 1, pollMs: 1, leaseMs: 30_000 }, { claim: async () => { if (claimed) { worker.requestStop(); return null; } claimed = true; return job; }, dispatch: async () => { throw new Error("private data"); }, complete: vi.fn(), fail: genericFail, heartbeat: vi.fn() });
    await worker.run(); expect(genericFail).not.toHaveBeenCalled(); expect((await prisma.integrationJob.findUniqueOrThrow({ where: { id: job.id } })).lastError).toBe("FINANCIAL_TRANSPORT_FAILURE");
  });
  it("dead-letters corrupt job payloads without copying their content", async () => {
    const id = await installation(); const j = await enqueueFinancialOperation(context, id, request()); await prisma.integrationJob.update({ where: { id: j.id }, data: { payload: { secret: "controlled-private-value" } } }); const job = await claim(j.id);
    await expect(processFinancialJob(job, new AbortController().signal)).rejects.toThrow("CONTENT_UNAVAILABLE");
    expect(await failFinancialJob(job, new FinancialProviderError("CONTENT_UNAVAILABLE"))).toBe("DEAD_LETTER");
    const dead = await prisma.integrationDeadLetter.findFirstOrThrow({ where: { sourceId: j.id } }); expect(JSON.stringify(dead)).not.toContain("controlled-private-value");
  });
  it("revalidates persisted role at consumption and refuses retry after revocation", async () => {
    const id = await installation(); const user = await prisma.user.create({ data: { name: "Financial QA actor", email: `financial-${randomUUID()}@example.invalid`, passwordHash: "synthetic-not-a-login-hash" } });
    const membership = await prisma.organizationMembership.create({ data: { organizationId: context.organizationId, userId: user.id, role: "ANALYST" } }); const actor = { ...context, userId: user.id };
    const j = await enqueueFinancialOperation(actor, id, request()); const job = await claim(j.id);
    await prisma.organizationMembership.update({ where: { id: membership.id }, data: { role: "VIEWER" } });
    await expect(processFinancialJob(job, new AbortController().signal)).rejects.toThrow("FORBIDDEN"); await failFinancialJob(job, new FinancialProviderError("FORBIDDEN", "AUTHORIZATION"));
    await expect(retryFinancialJob(context, job.id)).rejects.toThrow("FORBIDDEN"); await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
  });
});

