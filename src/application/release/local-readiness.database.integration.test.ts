import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { attestLocalOnboarding, getLocalReadiness, localDatabaseReleaseCheck } from "./local-readiness-service";
describe.sequential("9Q.2A scoped readiness and onboarding", () => {
  let context: { organizationId: string; userId: string; role: "OWNER" }; let otherId: string;
  beforeAll(async () => {
    const user = await prisma.user.create({ data: { name: "Local QA", email: `readiness-${randomUUID()}@example.invalid`, passwordHash: "not-a-login-hash" } });
    const org = await prisma.organization.create({ data: { name: "Readiness isolated QA", slug: `readiness-${randomUUID()}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
    const other = await prisma.organization.create({ data: { name: "Other QA", slug: `other-${randomUUID()}` } }); otherId = other.id;
    context = { organizationId: org.id, userId: user.id, role: "OWNER" };
    await prisma.integrationJob.create({ data: { organizationId: otherId, jobType: "OTHER", correlationId: randomUUID(), payload: { secret: "must-not-leak" } } });
  });
  afterAll(async () => { if (context) await prisma.user.update({ where: { id: context.userId }, data: { isActive: false } }); if (otherId) await prisma.integrationJob.updateMany({ where: { organizationId: otherId }, data: { status: "CANCELLED" } }); });
  it("checks all migration checksums in the local database", async () => { expect(await localDatabaseReleaseCheck()).toBe(true); });
  it("does not count or expose another tenant's jobs or secrets", async () => { const report = await getLocalReadiness(context); expect(report.metrics.jobs).toEqual([]); expect(report.observed.projects).toBe(0); expect(report.productionReady).toBe(false); expect(JSON.stringify(report)).not.toMatch(/must-not-leak|password|postgresql:\/\//); });
  it.each(["ANALYST", "REVIEWER", "VIEWER"] as const)("denies %s", async role => { await expect(getLocalReadiness({ ...context, role })).rejects.toThrow("acesso"); await expect(attestLocalOnboarding({ ...context, role }, { step: "ORGANIZATION", confirmed: true })).rejects.toThrow("acesso"); });
  it("rejects tenant switching and forged owner after downgrade", async () => {
    await expect(getLocalReadiness({ ...context, organizationId: otherId })).rejects.toThrow("acesso");
    await prisma.organizationMembership.update({ where: { organizationId_userId: { organizationId: context.organizationId, userId: context.userId } }, data: { role: "VIEWER" } });
    try { await expect(getLocalReadiness(context)).rejects.toThrow("acesso"); } finally { await prisma.organizationMembership.update({ where: { organizationId_userId: { organizationId: context.organizationId, userId: context.userId } }, data: { role: "OWNER" } }); }
  });
  it("rejects inactive user and explicit foreign data in the input", async () => {
    await expect(attestLocalOnboarding(context, { step: "ORGANIZATION", confirmed: true, organizationId: otherId })).rejects.toThrow("inválida");
    await prisma.user.update({ where: { id: context.userId }, data: { isActive: false } });
    try { await expect(attestLocalOnboarding(context, { step: "ORGANIZATION", confirmed: true })).rejects.toThrow("acesso"); } finally { await prisma.user.update({ where: { id: context.userId }, data: { isActive: true } }); }
  });
  it("serializes attestations without duplicating audit evidence", async () => {
    await Promise.all([attestLocalOnboarding(context, { step: "ORGANIZATION", confirmed: true }), attestLocalOnboarding(context, { step: "ORGANIZATION", confirmed: true })]);
    const rows = await prisma.auditLog.findMany({ where: { organizationId: context.organizationId, entityType: "LocalOnboarding", entityId: "ORGANIZATION" } }); expect(rows).toHaveLength(1); expect(rows[0].metadata).toMatchObject({ humanAttestation: true, externalEvidence: false });
  });
  it("does not fabricate project, study, baseline or integration facts", async () => { for (const step of ["FIRST_PROJECT", "FIRST_FEASIBILITY", "APPROVED_BASELINE", "LOCAL_INTEGRATION"]) await expect(attestLocalOnboarding(context, { step, confirmed: true })).rejects.toThrow("registro"); });
  it("refuses premature acceptance and unsupported real approval", async () => { await expect(attestLocalOnboarding(context, { step: "LOCAL_ACCEPTANCE", confirmed: true })).rejects.toThrow("anteriores"); await expect(attestLocalOnboarding(context, { step: "REAL_ACCEPTANCE", confirmed: true })).rejects.toThrow("inválida"); });
});

