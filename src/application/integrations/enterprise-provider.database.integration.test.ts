import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { EnterpriseError, enterpriseEntity, type EnterpriseEntity, type EnterpriseTransport } from "@/domain/integrations/enterprise-provider";
import { bindEnterpriseEntity, configureEnterpriseInstallation, createEnterpriseInstallation, enqueueEnterpriseSync, failEnterpriseJob, listEnterpriseBindings, listEnterpriseEvidence, listEnterpriseJobs, listEnterpriseQuarantine, processEnterpriseJob, purgeEnterpriseEvidence, readEnterpriseEvidence, readEnterpriseQuarantine, retryEnterpriseJob, reviewEnterpriseEvidence } from "./enterprise-provider-service";
import { readEnterpriseProjection } from "./enterprise-projection";
import { dispatchJob } from "@/application/worker/job-dispatcher";
import { DurableWorker } from "@/application/worker/worker-runtime";

describe.sequential("9P.5 enterprise staging and adversarial persistence", () => {
  let context: { organizationId: string; userId: string; role: "OWNER" }; let projectId: string; let companyId: string;
  const fixtures = {} as Record<EnterpriseEntity, string>; const installations: string[] = []; const configs = new Map<string, { mode: "MOCK"; capability: "ERP" | "CRM"; sourceKey: string; retentionDays: number; perMinute: number }>();
  beforeAll(async () => {
    // Own all data: no dependency on another suite or on pre-existing enterprise records.
    const user = await prisma.user.create({ data: { name: "Enterprise QA", email: `enterprise-${randomUUID()}@example.invalid`, passwordHash: "synthetic-not-a-login-hash" } });
    const org = await prisma.organization.create({ data: { name: "Enterprise isolated QA", slug: `enterprise-${randomUUID()}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
    context = { organizationId: org.id, userId: user.id, role: "OWNER" };
    const common = { organizationId: org.id, createdById: user.id }; const stamp = { ...common, updatedById: user.id }; const now = new Date();
    const company = await prisma.company.create({ data: { ...common, name: "QA", legalName: "QA sintética", type: "SPE" } }); companyId = company.id; fixtures.COMPANY = company.id;
    const project = await prisma.project.create({ data: { ...stamp, companyId, name: "Projeto sintético", city: "São Paulo", state: "SP" } }); projectId = project.id; fixtures.PROJECT = project.id;
    fixtures.COST_CENTER = (await prisma.costCenter.create({ data: { ...common, projectId, code: "C1", name: "Centro QA" } })).id;
    fixtures.ECONOMIC_ITEM = (await prisma.economicItem.create({ data: { ...common, projectId, code: "E1", description: "Item QA", category: "QA", unit: "m2" } })).id;
    fixtures.SUPPLIER = (await prisma.supplier.create({ data: { ...common, name: "Fornecedor sintético" } })).id;
    fixtures.CUSTOMER = (await prisma.customer.create({ data: { ...common, name: "Cliente sintético" } })).id;
    fixtures.BUDGET = (await prisma.budget.create({ data: { ...stamp, companyId, projectId, name: "Orçamento QA", baseDate: now, totalBudget: "1000.00", status: "APPROVED", approvedById: user.id, approvedAt: now } })).id;
    fixtures.OPERATIONAL_CONTRACT = (await prisma.operationalContract.create({ data: { ...stamp, companyId, projectId, supplierId: fixtures.SUPPLIER, number: "CT1", title: "Contrato QA", type: "SERVICE", billingModel: "MEASUREMENT", scope: "Simulação", originalAmount: "1000.00", startsAt: now, endsAt: now, responsibleId: user.id } })).id;
    fixtures.MEASUREMENT = (await prisma.measurementCertificate.create({ data: { ...stamp, projectId, contractId: fixtures.OPERATIONAL_CONTRACT, number: 1, competenceDate: now, periodStart: now, periodEnd: now, issuedAt: now, dueDate: now, responsibleId: user.id, grossAmount: "100.00", netAmount: "100.00" } })).id;
    fixtures.FINANCIAL_OBLIGATION = (await prisma.financialObligation.create({ data: { ...common, projectId, companyId, nature: "PAYABLE", description: "Obrigação sintética", competenceDate: now, dueDate: now, amount: "100.00" } })).id;
    const period = await prisma.accountingPeriod.create({ data: { ...stamp, companyId, referenceMonth: now } });
    fixtures.ACCOUNTING_ENTRY = (await prisma.accountingEntry.create({ data: { ...common, companyId, projectId, periodId: period.id, entryNumber: "QA1", accountingDate: now, competenceDate: now, description: "Rascunho sintético", totalDebit: "10.00", totalCredit: "10.00", checksum: "qa" } })).id;
    fixtures.LEAD = (await prisma.salesLead.create({ data: { ...common, projectId, name: "Lead sintético", contact: "qa@example.invalid", source: "MOCK" } })).id;
    fixtures.SALES_UNIT = (await prisma.salesUnit.create({ data: { ...common, projectId, companyId, code: "A1", typology: "QA", privateAreaM2: "50" } })).id;
    const price = await prisma.salesPriceTable.create({ data: { ...common, companyId, projectId, version: 1, validFrom: now, responsibleId: user.id } });
    fixtures.SALES_PROPOSAL = (await prisma.salesProposal.create({ data: { ...common, projectId, salesUnitId: fixtures.SALES_UNIT, customerId: fixtures.CUSTOMER, priceTableId: price.id, proposedPrice: "1000.00", paymentConditionSummary: {}, validUntil: now } })).id;
    fixtures.SALE = (await prisma.sale.create({ data: { ...common, companyId, projectId, salesUnitId: fixtures.SALES_UNIT, priceTableId: price.id, soldPrice: "1000.00", commercialConditionSnapshot: {} } })).id;
    fixtures.SALES_CONTRACT = (await prisma.salesContract.create({ data: { ...common, companyId, projectId, saleId: fixtures.SALE, number: "SC1", title: "Contrato sintético", soldPrice: "1000.00", commercialCondition: {} } })).id;
  });
  afterAll(async () => {
    if (context) {
      await prisma.integrationJob.updateMany({ where: { organizationId: context.organizationId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCELLED" } });
      await prisma.connectorInstallation.updateMany({ where: { id: { in: installations } }, data: { status: "PAUSED" } });
      await prisma.user.update({ where: { id: context.userId }, data: { isActive: false } });
    }
    await prisma.$disconnect();
  });
  async function installation(capability: "ERP" | "CRM" = "ERP", perMinute = 60, sourceKey = randomUUID()) {
    const row = await createEnterpriseInstallation(context, { name: "Conector local QA", projectId, capability, sourceKey, retentionDays: 30 }); installations.push(row.id);
    const c = { mode: "MOCK" as const, capability, sourceKey, retentionDays: 30, perMinute }; configs.set(row.id, c); await configureEnterpriseInstallation(context, row.id, c); return row.id;
  }
  async function bind(id: string, entityType: EnterpriseEntity = "BUDGET", externalId = "x1", entityId = fixtures[entityType]) { return bindEnterpriseEntity(context, id, { entityType, entityId, externalId }); }
  async function claim(id: string, attemptCount = 1) { return prisma.integrationJob.update({ where: { id }, data: { status: "RUNNING", attemptCount, leaseOwner: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000) } }); }
  const request = (entityType: EnterpriseEntity = "BUDGET") => ({ idempotencyKey: randomUUID(), entityType });
  const item = (externalId = "x1", externalVersion = "v1", totalBudget = "1500.00") => ({ externalId, externalVersion, entityType: "BUDGET", data: { status: "APPROVED", version: 1, currency: "BRL", totalBudget } });
  const page = (items: unknown[], nextCursor: string | null = null) => ({ items, nextCursor, checkpoint: "checkpoint-1" });
  function transport(values: unknown[]): EnterpriseTransport { return { kind: "LOCAL_SIMULATION", pull: vi.fn(async () => { const value = values.shift(); if (value instanceof Error) throw value; if (!value) throw new Error("Unexpected extra call"); return value; }) }; }
  async function sync(id: string, items: unknown[], entityType: EnterpriseEntity = "BUDGET") { const j = await enqueueEnterpriseSync(context, id, request(entityType)); await processEnterpriseJob(await claim(j.id), new AbortController().signal, transport([page(items)])); return j; }
  async function failed(id: string, values: unknown[], entityType: EnterpriseEntity = "BUDGET") { const j = await enqueueEnterpriseSync(context, id, request(entityType)); const job = await claim(j.id); try { await processEnterpriseJob(job, new AbortController().signal, transport(values)); throw new Error("Expected failure"); } catch (error) { if (!(error instanceof EnterpriseError)) throw error; await failEnterpriseJob(job, error); return { job, error }; } }

  it.each(enterpriseEntity.options)("binds and stages %s using only the existing canonical entity", async entity => {
    const id = await installation(entity === "LEAD" || entity === "SALES_PROPOSAL" ? "CRM" : "ERP"); await bind(id, entity);
    const before = await prisma.$transaction(tx => readEnterpriseProjection(tx, context.organizationId, projectId, entity, fixtures[entity]));
    await sync(id, [{ externalId: "x1", externalVersion: "v1", entityType: entity, data: before.data }], entity);
    const rows = await listEnterpriseEvidence(context, id); expect(rows).toHaveLength(1); expect(rows[0].divergent).toBe(false);
    expect(await prisma.$transaction(tx => readEnterpriseProjection(tx, context.organizationId, projectId, entity, fixtures[entity]))).toEqual(before);
  });
  it("deduplicates concurrent requests, pages, events and completed worker attempts", async () => {
    const id = await installation(); await bind(id); await bind(id, "BUDGET", "x2"); const raw = request();
    const jobs = await Promise.all([enqueueEnterpriseSync(context, id, raw), enqueueEnterpriseSync(context, id, raw)]); expect(jobs[0].id).toBe(jobs[1].id);
    await expect(enqueueEnterpriseSync(context, id, { ...raw, entityType: "ECONOMIC_ITEM" })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    const job = await claim(jobs[0].id); const t = transport([page([item()], "p2"), page([item("x2")])]);
    await processEnterpriseJob(job, new AbortController().signal, t); await processEnterpriseJob(job, new AbortController().signal, t); expect(t.pull).toHaveBeenCalledTimes(2);
    const replay = await enqueueEnterpriseSync(context, id, request()); const again = transport([page([item(), item("x2")])]); await processEnterpriseJob(await claim(replay.id), new AbortController().signal, again);
    expect(again.pull).toHaveBeenCalledWith(expect.objectContaining({ cursor: "checkpoint-1" }), expect.any(AbortSignal));
    expect(await prisma.enterpriseSyncEvidence.count({ where: { installationId: id } })).toBe(2); expect(await prisma.integrationConflict.count({ where: { installationId: id } })).toBe(2);
    const cursor = await prisma.integrationCursor.findFirstOrThrow({ where: { installationId: id } }); expect(cursor.cursorValue).not.toContain("checkpoint-1");
  });
  it("requires a human crosswalk, quarantines safely and reprocesses without losing the cursor", async () => {
    const id = await installation(); const result = await failed(id, [page([item()])]); expect(result.error.reason).toBe("UNMAPPED");
    expect(await prisma.integrationCursor.count({ where: { installationId: id } })).toBe(0);
    const [q] = await listEnterpriseQuarantine(context, id); const detail = await readEnterpriseQuarantine(context, id, q.id); expect(detail.item.externalId).toBe("x1");
    expect(JSON.stringify((await prisma.integrationQuarantineItem.findUniqueOrThrow({ where: { id: q.id } })).payload)).not.toContain("1500.00");
    await expect(bindEnterpriseEntity({ ...context, role: "ANALYST" }, id, { entityType: "BUDGET", entityId: fixtures.BUDGET, externalId: "x1" })).rejects.toThrow("FORBIDDEN");
    await bind(id); await retryEnterpriseJob(context, result.job.id); await processEnterpriseJob(await claim(result.job.id), new AbortController().signal, transport([page([item()])]));
    expect(await listEnterpriseQuarantine(context, id)).toHaveLength(0); expect(await listEnterpriseEvidence(context, id)).toHaveLength(1);
  });
  it("enforces one immutable crosswalk across installations sharing a tenant/source", async () => {
    const source = randomUUID(); const a = await installation("ERP", 60, source); const b = await installation("ERP", 60, source);
    const binding = await bind(a); expect((await bind(a)).id).toBe(binding.id); await expect(bind(b)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await expect(prisma.externalEntityReference.update({ where: { id: binding.id }, data: { entityId: fixtures.ECONOMIC_ITEM } })).rejects.toThrow("IMMUTABLE");
    await expect(prisma.externalEntityReference.delete({ where: { id: binding.id } })).rejects.toThrow("IMMUTABLE");
    const raw = await prisma.externalEntityReference.findUniqueOrThrow({ where: { id: binding.id } }); expect(raw.externalId).toMatch(/^[a-f0-9]{64}$/); expect(raw.externalId).not.toBe("x1");
    await expect(prisma.externalEntityReference.create({ data: { ...raw, metadata: { simulated: true }, id: randomUUID(), installationId: b } })).rejects.toThrow();
    await expect(prisma.connectorInstallation.update({ where: { id: a }, data: { configuration: { ...configs.get(a)!, sourceKey: "changed" } } })).rejects.toThrow("CONTEXT_IMMUTABLE");
  });
  it("turns divergence into immutable review without changing Budget, contract or economic values", async () => {
    const id = await installation(); await bind(id); const before = await prisma.budget.findUniqueOrThrow({ where: { id: fixtures.BUDGET } });
    await sync(id, [item()]); const [e] = await listEnterpriseEvidence(context, id); expect(e.divergent).toBe(true);
    await expect(prisma.integrationConflict.update({ where: { id: `ec_${e.id}` }, data: { status: "RESOLVED_AUTO" } })).rejects.toThrow("REVIEW_REQUIRED");
    await expect(reviewEnterpriseEvidence({ ...context, role: "ANALYST" }, id, e.id, "PROPOSE_REVISION")).rejects.toThrow("FORBIDDEN");
    const reviewed = await reviewEnterpriseEvidence(context, id, e.id, "PROPOSE_REVISION"); expect(reviewed.businessMutation).toBe(false);
    expect(await reviewEnterpriseEvidence(context, id, e.id, "PROPOSE_REVISION")).toEqual(reviewed);
    await expect(reviewEnterpriseEvidence(context, id, e.id, "REJECT")).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    expect(await prisma.budget.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
    await expect(prisma.enterpriseEvidenceReview.update({ where: { id: reviewed.id }, data: { decision: "REJECT" } })).rejects.toThrow("IMMUTABLE");
    await expect(prisma.enterpriseSyncEvidence.update({ where: { id: e.id }, data: { localHash: "a".repeat(64) } })).rejects.toThrow("IMMUTABLE");
    await expect(prisma.enterpriseSyncEvidence.delete({ where: { id: e.id } })).rejects.toThrow();
    const raw = await prisma.enterpriseSyncEvidence.findUniqueOrThrow({ where: { id: e.id } }); expect(raw.encryptedPayload).not.toContain("1500.00");
    expect((await readEnterpriseEvidence(context, id, e.id)).value).toMatchObject({ external: { data: { totalBudget: "1500.00" } } });
  });
  it("rejects stale human review after the local entity changes", async () => {
    const id = await installation("CRM"); await bind(id, "LEAD"); await sync(id, [{ externalId: "x1", externalVersion: "v1", entityType: "LEAD", data: { stage: "QUALIFICADO" } }], "LEAD");
    const [e] = await listEnterpriseEvidence(context, id); await prisma.salesLead.update({ where: { id: fixtures.LEAD }, data: { name: "QA revisado" } });
    await expect(reviewEnterpriseEvidence(context, id, e.id, "PROPOSE_REVISION")).rejects.toThrow("STALE_REVIEW");
  });
  it("preserves the first version when the same external version changes", async () => {
    const id = await installation(); await bind(id); await sync(id, [item()]); const result = await failed(id, [page([item("x1", "v1", "9999.00")])]); expect(result.error.reason).toBe("EVIDENCE_CONFLICT");
    expect(await listEnterpriseEvidence(context, id)).toHaveLength(1); await sync(id, [item("x1", "v2", "9999.00")]); expect(await listEnterpriseEvidence(context, id)).toHaveLength(2);
  });
  it("rolls back partial pages, rejects circular pagination and honors cancellation", async () => {
    const id = await installation(); await bind(id); const result = await failed(id, [page([item()], "p2"), new Error("private payload")]); expect(result.error.reason).toBe("TRANSPORT_FAILURE");
    expect(await prisma.enterpriseSyncEvidence.count({ where: { installationId: id } })).toBe(0); expect(await prisma.integrationCursor.count({ where: { installationId: id } })).toBe(0);
    const cycle = await failed(id, [page([item()], "p2"), page([item()], "p2")]); expect(cycle.error.reason).toBe("PAGINATION_LIMIT");
    const job = await claim((await enqueueEnterpriseSync(context, id, request())).id); const controller = new AbortController(); controller.abort(); const t = transport([page([])]);
    await expect(processEnterpriseJob(job, controller.signal, t)).rejects.toThrow(); expect(t.pull).not.toHaveBeenCalled();
  });
  it("fences stale owners and attempts and persists rate limiting and dead letters once", async () => {
    const id = await installation("ERP", 1); await bind(id); await sync(id, [item()]);
    const j = await enqueueEnterpriseSync(context, id, request()); const job = await claim(j.id); const t = transport([page([])]);
    await expect(processEnterpriseJob({ ...job, attemptCount: 0 }, new AbortController().signal, t)).rejects.toThrow("LEASE_LOST");
    await failEnterpriseJob({ ...job, attemptCount: 0 }, new EnterpriseError("INVALID_INPUT")); expect((await prisma.integrationJob.findUniqueOrThrow({ where: { id: j.id } })).status).toBe("RUNNING");
    await expect(processEnterpriseJob(job, new AbortController().signal, t)).rejects.toThrow("RATE_LIMIT"); expect(t.pull).not.toHaveBeenCalled();
    await failEnterpriseJob(job, new EnterpriseError("RATE_LIMIT", "RATE_LIMIT", 5000)); expect((await prisma.integrationJob.findUniqueOrThrow({ where: { id: j.id } })).status).toBe("QUEUED");
    const final = await claim(j.id, 5); await failEnterpriseJob(final, new EnterpriseError("TRANSPORT_FAILURE", "NETWORK")); await failEnterpriseJob(final, new EnterpriseError("TRANSPORT_FAILURE", "NETWORK"));
    expect(await prisma.integrationDeadLetter.count({ where: { sourceId: j.id } })).toBe(1);
  });
  it("blocks foreign tenants, foreign projects, forged roles, inactive actors and REAL before transport", async () => {
    const id = await installation(); const org = await prisma.organization.create({ data: { name: "Foreign QA", slug: `foreign-${randomUUID()}`, memberships: { create: { userId: context.userId, role: "OWNER" } } } }); const foreign = { ...context, organizationId: org.id };
    await expect(enqueueEnterpriseSync(foreign, id, request())).rejects.toThrow("FORBIDDEN"); await expect(listEnterpriseJobs(foreign, id)).rejects.toThrow("FORBIDDEN");
    const foreignProject = await prisma.project.create({ data: { organizationId: org.id, createdById: context.userId, updatedById: context.userId, name: "Foreign", city: "São Paulo", state: "SP" } });
    await expect(bindEnterpriseEntity(context, id, { entityType: "PROJECT", entityId: foreignProject.id, externalId: "x" })).rejects.toThrow("FORBIDDEN");
    await expect(enqueueEnterpriseSync({ ...context, role: "VIEWER" }, id, request())).rejects.toThrow("FORBIDDEN");
    const job = await claim((await enqueueEnterpriseSync(context, id, request())).id); await configureEnterpriseInstallation(context, id, { ...configs.get(id)!, mode: "REAL" }); const t = transport([page([])]);
    await expect(processEnterpriseJob(job, new AbortController().signal, t)).rejects.toThrow("REAL_NOT_CONFIGURED"); expect(t.pull).not.toHaveBeenCalled();
    await expect(enqueueEnterpriseSync(context, id, request())).rejects.toThrow("REAL_NOT_CONFIGURED");
    await configureEnterpriseInstallation(context, id, { ...configs.get(id)!, mode: "DISABLED" }); await expect(processEnterpriseJob(job, new AbortController().signal, t)).rejects.toThrow("DISABLED");
    await configureEnterpriseInstallation(context, id, configs.get(id)!);
    const member = await prisma.organizationMembership.findFirstOrThrow({ where: { organizationId: context.organizationId, userId: context.userId } });
    try { await prisma.organizationMembership.update({ where: { id: member.id }, data: { role: "VIEWER" } }); await expect(processEnterpriseJob(job, new AbortController().signal, t)).rejects.toThrow("FORBIDDEN"); await expect(bind(id)).rejects.toThrow("FORBIDDEN"); }
    finally { await prisma.organizationMembership.update({ where: { id: member.id }, data: { role: "OWNER" } }); }
  });
  it("denies unprivileged evidence access and cross-tenant SQL inserts", async () => {
    const id = await installation(); await bind(id); await sync(id, [item()]); const [e] = await listEnterpriseEvidence(context, id);
    await expect(readEnterpriseEvidence({ ...context, role: "VIEWER" }, id, e.id)).rejects.toThrow("FORBIDDEN"); await expect(listEnterpriseBindings({ ...context, role: "VIEWER" }, id)).rejects.toThrow("FORBIDDEN");
    const raw = await prisma.enterpriseSyncEvidence.findUniqueOrThrow({ where: { id: e.id } }); const foreign = await prisma.organization.findFirstOrThrow({ where: { slug: "rede-nucleo-de-negocios" } });
    await expect(prisma.enterpriseSyncEvidence.create({ data: { ...raw, id: randomUUID(), organizationId: foreign.id } })).rejects.toThrow("SCOPE_INVALID");
    await expect(prisma.$executeRaw`TRUNCATE enterprise_evidence_reviews, enterprise_sync_evidence`).rejects.toThrow("IMMUTABLE");
    await expect(prisma.integrationJob.update({ where: { id: raw.jobId }, data: { jobType: "OTHER" } })).rejects.toThrow("CONTEXT_IMMUTABLE");
  });
  it("expires encrypted evidence and purges only expired snapshots", async () => {
    const id = await installation(); await bind(id); await sync(id, [item()]); const original = await prisma.enterpriseSyncEvidence.findFirstOrThrow({ where: { installationId: id } }); const expiredId = `expired_${randomUUID()}`;
    await prisma.enterpriseSyncEvidence.create({ data: { ...original, id: expiredId, versionHash: "b".repeat(64), recordedAt: new Date(Date.now() - 172_800_000), expiresAt: new Date(Date.now() - 86_400_000) } });
    await expect(readEnterpriseEvidence(context, id, expiredId)).rejects.toThrow("EXPIRED"); expect(await purgeEnterpriseEvidence(context, id)).toEqual({ evidenceCount: 1, quarantineCount: 0 });
    expect(await prisma.enterpriseSyncEvidence.findUnique({ where: { id: original.id } })).not.toBeNull();
  });
  it("dispatches through the existing worker and redacts arbitrary failures", async () => {
    const id = await installation(); const j = await enqueueEnterpriseSync(context, id, request()); await dispatchJob(await claim(j.id), new AbortController().signal);
    expect((await listEnterpriseJobs(context, id))[0].status).toBe("SUCCEEDED");
    const bad = await claim((await enqueueEnterpriseSync(context, id, request())).id); const generic = vi.fn(); let available = true;
    const worker = new DurableWorker({ concurrency: 1, pollMs: 1, leaseMs: 30_000 }, { claim: async () => { if (!available) { worker.requestStop(); return null; } available = false; return bad; }, heartbeat: async () => {}, complete: async () => {}, fail: generic, dispatch: async () => { throw new Error("token=private@example.invalid"); } });
    await worker.run(); expect(generic).not.toHaveBeenCalled(); expect((await prisma.integrationJob.findUniqueOrThrow({ where: { id: bad.id } })).lastError).toBe("ENTERPRISE_TRANSPORT_FAILURE");
  });
});
