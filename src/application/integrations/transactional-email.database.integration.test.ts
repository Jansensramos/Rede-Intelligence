import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { createEmailInstallation, configureEmailInstallation, enqueueEmail, processEmailJob, failEmailJob, listEmailJobs, retryEmailJob } from "./transactional-email-service";
import { EmailError } from "@/domain/integrations/transactional-email";
import { DurableWorker } from "@/application/worker/worker-runtime";
import { dispatchJob } from "@/application/worker/job-dispatcher";

describe.sequential("Transactional email durable local queue", () => {
  let context: { organizationId: string; userId: string; role: "OWNER" };
  const ids: string[] = [];
  const input = () => ({ idempotencyKey: randomUUID(), to: "qa@example.invalid", template: "NOTICE_V1", variables: { name: "Local QA", reference: "Estudo" } });
  beforeAll(async () => { const member = await prisma.organizationMembership.findFirstOrThrow({ where: { organization: { slug: "rede-nucleo-de-negocios" }, user: { email: "admin@rede.local" } } }); context = { organizationId: member.organizationId, userId: member.userId, role: "OWNER" }; });
  afterAll(async () => { await prisma.integrationJob.updateMany({ where: { installationId: { in: ids }, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCELLED" } }); await prisma.connectorInstallation.updateMany({ where: { id: { in: ids } }, data: { status: "PAUSED" } }); await prisma.$disconnect(); });
  async function installed(perMinute = 10) { const i = await createEmailInstallation(context, "Email local QA"); ids.push(i.id); await configureEmailInstallation(context, i.id, { mode: "MOCK", perMinute }); return i.id; }
  async function claimed(id: string, attemptCount = 1) { return prisma.integrationJob.update({ where: { id }, data: { status: "RUNNING", attemptCount, leaseOwner: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000) } }); }
  it("serializes concurrent idempotency and rejects mismatched content without plaintext in queue/audit", async () => {
    const id = await installed(); const raw = input(); const jobs = await Promise.all(Array.from({ length: 4 }, () => enqueueEmail(context, id, raw)));
    expect(new Set(jobs.map(j => j.id)).size).toBe(1);
    await expect(enqueueEmail(context, id, { ...raw, to: "different@example.invalid" })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    const job = await prisma.integrationJob.findUniqueOrThrow({ where: { id: jobs[0].id } }); expect(JSON.stringify(job.payload)).not.toContain(raw.to); expect(JSON.stringify(job.payload)).not.toContain("Local QA");
    const audits = await prisma.auditLog.findMany({ where: { entityId: job.id } }); expect(audits).toHaveLength(1); expect(JSON.stringify(audits)).not.toContain(raw.to);
  });
  it("processes once, stores only simulated evidence, and makes no HTTP calls", async () => {
    const id = await installed(); const raw = input(); const j = await enqueueEmail(context, id, raw); const job = await claimed(j.id);
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("forbidden"));
    try { await processEmailJob(job, new AbortController().signal); await processEmailJob(job, new AbortController().signal); expect(fetch).not.toHaveBeenCalled(); } finally { fetch.mockRestore(); }
    expect(await prisma.auditLog.count({ where: { entityId: job.id, action: "EMAIL_SIMULATED" } })).toBe(1);
    expect(await enqueueEmail(context, id, raw)).toMatchObject({ id: job.id, status: "SUCCEEDED" });
    expect((await listEmailJobs(context, id))[0]).not.toHaveProperty("payload");
  });
  it("denies tenant spoofing, viewer enqueue and nonexistent active user", async () => {
    const id = await installed();
    await expect(enqueueEmail({ ...context, role: "VIEWER" }, id, input())).rejects.toThrow("FORBIDDEN");
    await expect(enqueueEmail({ ...context, organizationId: randomUUID() }, id, input())).rejects.toThrow("FORBIDDEN");
    await expect(enqueueEmail({ ...context, userId: randomUUID() }, id, input())).rejects.toThrow("FORBIDDEN");
    await expect(listEmailJobs({ ...context, organizationId: randomUUID() }, id)).rejects.toThrow("FORBIDDEN");
  });
  it("isolates two authorized tenants and rechecks a downgraded membership at dispatch", async () => {
    const org = await prisma.organization.create({ data: { name: "Email isolated QA", slug: `email-qa-${randomUUID()}`, memberships: { create: { userId: context.userId, role: "OWNER" } } } });
    const other = { ...context, organizationId: org.id }; const ownId = await installed();
    const otherInstallation = await createEmailInstallation(other, "Other tenant email QA"); ids.push(otherInstallation.id);
    await configureEmailInstallation(other, otherInstallation.id, { mode: "MOCK" });
    const raw = input(); const a = await enqueueEmail(context, ownId, raw); const b = await enqueueEmail(other, otherInstallation.id, raw); expect(a.id).not.toBe(b.id);
    await expect(enqueueEmail(other, ownId, raw)).rejects.toThrow("FORBIDDEN"); await expect(listEmailJobs(other, ownId)).rejects.toThrow("FORBIDDEN");
    await prisma.organizationMembership.update({ where: { organizationId_userId: { organizationId: org.id, userId: context.userId } }, data: { role: "VIEWER" } });
    await expect(enqueueEmail(other, otherInstallation.id, input())).rejects.toThrow("FORBIDDEN");
    await expect(processEmailJob(await claimed(b.id), new AbortController().signal)).rejects.toThrow("FORBIDDEN");
  });
  it("blocks DISABLED and REAL even with injected transport and fabricated proof", async () => {
    const id = await installed(); const j = await enqueueEmail(context, id, input()); const job = await claimed(j.id); const send = vi.fn();
    await configureEmailInstallation(context, id, { mode: "REAL" });
    await expect(enqueueEmail(context, id, input())).rejects.toThrow("REAL_NOT_CONFIGURED");
    await expect(processEmailJob(job, new AbortController().signal, { kind: "LOCAL_SIMULATION", send })).rejects.toThrow("REAL_NOT_CONFIGURED"); expect(send).not.toHaveBeenCalled();
    await expect(configureEmailInstallation(context, id, { mode: "REAL", verified: true })).rejects.toThrow("INVALID_INPUT");
    await configureEmailInstallation(context, id, { mode: "DISABLED" }); await expect(enqueueEmail(context, id, input())).rejects.toThrow("DISABLED");
    await expect(processEmailJob(job, new AbortController().signal)).rejects.toThrow("DISABLED");
  });
  it("enforces durable rate limit across concurrent workers and schedules a safe retry", async () => {
    const id = await installed(1); const jobs = await Promise.all([enqueueEmail(context, id, input()), enqueueEmail(context, id, input())]); const a = await claimed(jobs[0].id); const b = await claimed(jobs[1].id);
    const results = await Promise.allSettled([processEmailJob(a, new AbortController().signal), processEmailJob(b, new AbortController().signal)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const failedIndex = results.findIndex(r => r.status === "rejected"); const error = (results[failedIndex] as PromiseRejectedResult).reason as EmailError; expect(error.reason).toBe("RATE_LIMIT");
    const failed = [a, b][failedIndex]; expect(await failEmailJob(failed, error)).toBe("RETRY");
    const pending = await prisma.integrationJob.findUniqueOrThrow({ where: { id: failed.id } }); expect(pending.status).toBe("QUEUED"); expect(pending.scheduledAt.getTime()).toBeGreaterThan(Date.now());
    expect(await prisma.auditLog.count({ where: { entityId: failed.id, action: "EMAIL_RETRY" } })).toBe(1);
  });
  it("dead-letters exhausted failures exactly once with sanitized metadata", async () => {
    const id = await installed(); const j = await enqueueEmail(context, id, input()); const job = await claimed(j.id, 5);
    expect(await failEmailJob(job, new EmailError("TRANSPORT_FAILURE", "NETWORK"))).toBe("DEAD_LETTER"); await failEmailJob(job, new EmailError("TRANSPORT_FAILURE", "NETWORK"));
    const dead = await prisma.integrationDeadLetter.findMany({ where: { sourceId: job.id } }); expect(dead).toHaveLength(1); expect(dead[0].payload).toEqual({ jobId: job.id });
  });
  it("rejects stale leases and cannot overwrite a newer claim", async () => {
    const id = await installed(); const j = await enqueueEmail(context, id, input()); const old = await claimed(j.id); const current = await claimed(j.id, 2);
    await expect(processEmailJob(old, new AbortController().signal)).rejects.toThrow("LEASE_LOST"); await failEmailJob(old, new EmailError("LEASE_LOST"));
    expect((await prisma.integrationJob.findUniqueOrThrow({ where: { id: j.id } })).leaseOwner).toBe(current.leaseOwner);
    await prisma.integrationJob.update({ where: { id: j.id }, data: { leaseOwner: old.leaseOwner } });
    await expect(processEmailJob(old, new AbortController().signal)).rejects.toThrow("LEASE_LOST");
    await failEmailJob(old, new EmailError("LEASE_LOST"));
    expect((await prisma.integrationJob.findUniqueOrThrow({ where: { id: j.id } })).status).toBe("RUNNING");
  });
  it("authenticates encrypted content against job identity", async () => {
    const id = await installed(); const a = await enqueueEmail(context, id, input()); const b = await enqueueEmail(context, id, input()); const first = await prisma.integrationJob.findUniqueOrThrow({ where: { id: a.id } });
    await prisma.integrationJob.update({ where: { id: b.id }, data: { payload: first.payload! } }); const job = await claimed(b.id);
    await expect(processEmailJob(job, new AbortController().signal)).rejects.toThrow("CONTENT_UNAVAILABLE");
    expect(await prisma.auditLog.count({ where: { entityId: b.id, action: "EMAIL_SIMULATED" } })).toBe(0);
  });
  it("rolls back cancellation after transport and safely resumes", async () => {
    const id = await installed(); const j = await enqueueEmail(context, id, input()); const job = await claimed(j.id); const controller = new AbortController();
    await expect(processEmailJob(job, controller.signal, { kind: "LOCAL_SIMULATION", send: async () => { controller.abort(); return { disposition: "SIMULATED" }; } })).rejects.toThrow();
    expect((await prisma.integrationJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("RUNNING");
    expect(await prisma.auditLog.count({ where: { entityId: job.id, action: "EMAIL_SIMULATED" } })).toBe(0);
    await processEmailJob(job, new AbortController().signal);
  });
  it("requires retry capability, resolves dead letter and preserves the message identity", async () => {
    const id = await installed(); const j = await enqueueEmail(context, id, input()); const job = await claimed(j.id, 5);
    await failEmailJob(job, new EmailError("TRANSPORT_FAILURE", "NETWORK"));
    await expect(retryEmailJob({ ...context, role: "VIEWER" }, job.id)).rejects.toThrow("FORBIDDEN");
    await expect(retryEmailJob({ ...context, organizationId: randomUUID() }, job.id)).rejects.toThrow("FORBIDDEN");
    expect(await retryEmailJob(context, job.id)).toEqual({ id: job.id, status: "QUEUED" });
    const row = await prisma.integrationJob.findUniqueOrThrow({ where: { id: job.id } }); expect(row.payload).toEqual(job.payload); expect(row.attemptCount).toBe(0);
    expect((await prisma.integrationDeadLetter.findFirstOrThrow({ where: { sourceId: job.id } })).resolvedAt).not.toBeNull();
    await dispatchJob(await claimed(job.id), new AbortController().signal);
    await expect(retryEmailJob(context, job.id)).rejects.toThrow("FORBIDDEN");
  });
  it("routes worker failures through the fenced audited transition without leaking raw errors", async () => {
    const id = await installed(); const j = await enqueueEmail(context, id, input()); const job = await claimed(j.id);
    const genericFail = vi.fn(); const complete = vi.fn(); let consumed = false;
    const worker = new DurableWorker({ concurrency: 1, pollMs: 1, leaseMs: 30_000 }, {
      claim: async () => { if (consumed) { worker.requestStop(); return null; } consumed = true; return job; },
      dispatch: async () => { throw new Error("private-provider-content"); }, complete,
      fail: genericFail, heartbeat: vi.fn(),
    });
    await worker.run(); expect(genericFail).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
    const row = await prisma.integrationJob.findUniqueOrThrow({ where: { id: job.id } }); expect(row.lastError).toBe("EMAIL_TRANSPORT_FAILURE"); expect(row.status).toBe("QUEUED");
    expect(await prisma.auditLog.count({ where: { entityId: job.id, action: "EMAIL_RETRY" } })).toBe(1);
  });
});
