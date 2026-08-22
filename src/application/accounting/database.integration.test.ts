import { beforeAll, describe, expect, it } from "vitest";
import { closeAccountingPeriod, getAccountingWorkspace, ingestAccountingEvent, postAccountingEvent } from "./accounting-service";
import { prisma } from "@/infrastructure/database/prisma";

describe("Contabilidade 9G em PostgreSQL real", () => {
  let context: { organizationId: string; userId: string; role: "OWNER" };
  let projectId: string;
  let companyId: string;

  beforeAll(async () => {
    const membership = await prisma.organizationMembership.findFirstOrThrow({ where: { organization: { slug: "rede-nucleo-de-negocios" }, user: { email: "admin@rede.local" } } });
    const project = await prisma.project.findUniqueOrThrow({ where: { organizationId_name: { organizationId: membership.organizationId, name: "START BUTANTÃ" } } });
    const company = await prisma.company.findFirstOrThrow({ where: { organizationId: membership.organizationId, projects: { some: { id: project.id } } } });
    context = { organizationId: membership.organizationId, userId: membership.userId, role: "OWNER" };
    projectId = project.id;
    companyId = company.id;
  });

  it("carrega plano, razão, balancete, estoque, fiscal e consolidação do START BUTANTÃ", async () => {
    const workspace = await getAccountingWorkspace(context, projectId);
    expect(workspace.chart[0]?.accounts.length).toBeGreaterThanOrEqual(10);
    expect(workspace.entries.length).toBeGreaterThanOrEqual(4);
    expect(workspace.entries.every((entry) => entry.totalDebit === entry.totalCredit)).toBe(true);
    expect(workspace.inventory.allocations[0]).toMatchObject({ proofZero: true, residualAmount: 0 });
    expect(workspace.fiscal.assessments[0]?.amount).toBe(6100);
    expect(workspace.consolidations[0]).toMatchObject({ eliminationAmount: 2_000_000, consolidatedAmount: 2_000_000, proofZero: true });
  });

  it("faz replay idempotente do mesmo evento sem duplicar efeito econômico", async () => {
    const base = { companyId, projectId, sourceModule: "PROCUREMENT", sourceType: "MEASUREMENT", sourceId: "INTEGRATION-9G-IDEMPOTENCY", sourceVersion: "1", economicIdentityKey: `${context.organizationId}:${companyId}:test:idempotency`, eventType: "COST_RECOGNITION", occurredAt: new Date("2026-10-20"), competenceDate: new Date("2026-10-01"), grossAmount: "1000", netAmount: "1000", payload: { amount: "1000", version: 1 }, provenance: { test: true } };
    const first = await ingestAccountingEvent(context, base);
    const replay = await ingestAccountingEvent(context, base);
    expect(replay.id).toBe(first.id);
    expect(await prisma.accountingEvent.count({ where: { organizationId: context.organizationId, idempotencyKey: first.idempotencyKey } })).toBe(1);
  });

  it("separa competência fechada de caixa e bloqueia retroatividade", async () => {
    const event = await ingestAccountingEvent(context, { companyId, projectId, sourceModule: "PROCUREMENT", sourceType: "MEASUREMENT", sourceId: "INTEGRATION-9G-CLOSED-PERIOD", sourceVersion: "1", economicIdentityKey: `${context.organizationId}:${companyId}:test:closed`, eventType: "COST_RECOGNITION", occurredAt: new Date("2026-10-02"), competenceDate: new Date("2026-09-01"), documentIssuedAt: new Date("2026-10-02"), settledAt: new Date("2026-11-03"), grossAmount: "1000", netAmount: "1000", payload: { service: "September", document: "October", cash: "November" }, provenance: { test: true } });
    expect(event.status).toBe("CLASSIFIED");
    await expect(postAccountingEvent(context, event.id)).rejects.toThrow("não permite lançamentos");
  });

  it("não fecha período com divergência material", async () => {
    const october = await prisma.accountingPeriod.findUniqueOrThrow({ where: { organizationId_companyId_referenceMonth: { organizationId: context.organizationId, companyId, referenceMonth: new Date("2026-10-01") } } });
    await expect(closeAccountingPeriod(context, october.id, { financial: true, apAr: true, measurements: true, provisions: true, tax: true, intercompany: true, inventory: true, trialBalance: true })).rejects.toThrow("divergência");
  });

  it("isola organização e respeita capacidade de leitura versus contabilização", async () => {
    const isolated = await prisma.organization.findUniqueOrThrow({ where: { slug: "grupo-atlas" } });
    await expect(getAccountingWorkspace({ organizationId: isolated.id, role: "VIEWER" }, projectId)).rejects.toThrow("não encontrado");
    await expect(ingestAccountingEvent({ organizationId: context.organizationId, userId: context.userId, role: "VIEWER" }, { companyId, projectId, sourceModule: "TEST", sourceType: "TEST", sourceId: "FORBIDDEN", sourceVersion: "1", economicIdentityKey: "forbidden", eventType: "TEST", occurredAt: new Date(), competenceDate: new Date("2026-10-01"), grossAmount: "1", netAmount: "1", payload: {}, provenance: {} })).rejects.toThrow("não possui a capacidade");
  });
});
