import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/application/auth/session";
import { updateLineItem } from "@/application/budget/budget-service";
import { getOperationsWorkspace } from "./operations-service";
import { prisma } from "@/infrastructure/database/prisma";
import { validateScheduleIntegrity } from "@/domain/operations/operations-engine";

describe.skipIf(!process.env.DATABASE_URL).sequential("base operacional multiempresa", () => {
  let context: AuthContext;
  let projectId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: "rede-nucleo-de-negocios" } });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "admin@rede.local" } });
    projectId = (await prisma.project.findUniqueOrThrow({ where: { organizationId_name: { organizationId: organization.id, name: "START BUTANTÃ" } } })).id;
    context = { sessionId: "test", userId: user.id, userName: user.name, userEmail: user.email, organizationId: organization.id, organizationName: organization.name, organizationSlug: organization.slug, role: "OWNER" };
  });

  afterAll(async () => prisma.$disconnect());

  it("preserva Base, Orçamento e Cronograma como estados econômicos distintos", async () => {
    const workspace = await getOperationsWorkspace(context, projectId);
    expect(workspace.baseline).toMatchObject({ status: "APPROVED", version: 1 });
    expect(workspace.baseline?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(workspace.budget).toMatchObject({ status: "OFFICIAL", kind: "OFFICIAL" });
    expect(workspace.budget?.total).toBe(40_761_463.51);
    expect(workspace.schedule).toMatchObject({ status: "APPROVED", version: 1 });
    expect(workspace.indicators.durationMonths).toBe(36);
    expect(workspace.indicators.totalCost).toBe(40_761_463.51);
  });

  it("mantém prova-zero financeira e física por atividade", async () => {
    const schedule = await prisma.operationalSchedule.findFirstOrThrow({ where: { projectId, status: "APPROVED" }, include: { activities: { include: { allocations: true } } } });
    const proof = validateScheduleIntegrity(schedule.activities.map((activity) => ({
      id: activity.id,
      name: activity.name,
      plannedCost: Number(activity.plannedCost),
      allocations: activity.allocations.map((allocation) => ({ period: allocation.periodStart.toISOString().slice(0, 7), physicalPercentage: Number(allocation.physicalPercent) * 100, financialValue: Number(allocation.plannedDisbursement) })),
    })));
    expect(proof).toEqual({ valid: true, errors: [] });
  });

  it("bloqueia alteração direta no Orçamento Oficial", async () => {
    const budget = await prisma.budget.findFirstOrThrow({ where: { projectId, status: "OFFICIAL" }, include: { lineItems: true } });
    await expect(updateLineItem(context, budget.id, budget.lineItems[0].id, { unitCost: "1" })).rejects.toThrow("Crie uma nova versão");
  });

  it("impede leitura cruzada entre organizações", async () => {
    const atlas = await prisma.organization.findUniqueOrThrow({ where: { slug: "grupo-atlas" } });
    await expect(getOperationsWorkspace({ organizationId: atlas.id }, projectId)).rejects.toThrow("não encontrado nesta organização");
  });

  it("prioriza o Orçamento Oficial vigente mesmo com uma proposta preliminar aprovada mais recente", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const project = await prisma.project.create({ data: { organizationId: context.organizationId, name: `TESTE PRIORIDADE ORCAMENTO ${suffix}`, city: "São Paulo", state: "SP", createdById: context.userId, updatedById: context.userId } });
    const official = await prisma.budget.create({ data: { organizationId: context.organizationId, projectId: project.id, name: `Orçamento Oficial ${suffix}`, status: "OFFICIAL", kind: "OFFICIAL", currency: "BRL", baseDate: new Date("2026-08-01"), version: 1, totalBudget: 1_000_000, createdById: context.userId, updatedById: context.userId } });
    // Proposta preliminar aprovada pelo Auto Budget (kind=PRELIMINARY -> status="APPROVED" em approveBudget,
    // nunca "OFFICIAL"), criada depois e com versão mais alta — não pode ocultar o orçamento oficial.
    await prisma.budget.create({ data: { organizationId: context.organizationId, projectId: project.id, name: `Proposta preliminar mais recente ${suffix}`, status: "APPROVED", kind: "PRELIMINARY", currency: "BRL", baseDate: new Date("2026-08-29"), version: 99, totalBudget: 9_999_999, createdById: context.userId, updatedById: context.userId } });

    const workspace = await getOperationsWorkspace(context, project.id);
    expect(workspace.budget).toMatchObject({ id: official.id, status: "OFFICIAL", kind: "OFFICIAL", total: 1_000_000 });

    await prisma.project.update({ where: { id: project.id }, data: { status: "ARCHIVED", updatedById: context.userId } });
  });

  it("sem Orçamento Oficial elegível, usa o fallback correto (melhor orçamento disponível por versão/atualização)", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const project = await prisma.project.create({ data: { organizationId: context.organizationId, name: `TESTE FALLBACK ORCAMENTO ${suffix}`, city: "São Paulo", state: "SP", createdById: context.userId, updatedById: context.userId } });
    const draft = await prisma.budget.create({ data: { organizationId: context.organizationId, projectId: project.id, name: `Rascunho ${suffix}`, status: "DRAFT", kind: "PRELIMINARY", currency: "BRL", baseDate: new Date("2026-08-01"), version: 1, totalBudget: 100, createdById: context.userId, updatedById: context.userId } });
    const preliminaryApproved = await prisma.budget.create({ data: { organizationId: context.organizationId, projectId: project.id, name: `Proposta preliminar aprovada ${suffix}`, status: "APPROVED", kind: "PRELIMINARY", currency: "BRL", baseDate: new Date("2026-08-15"), version: 2, totalBudget: 500_000, createdById: context.userId, updatedById: context.userId } });
    void draft;

    const workspace = await getOperationsWorkspace(context, project.id);
    expect(workspace.budget).toMatchObject({ id: preliminaryApproved.id, status: "APPROVED", kind: "PRELIMINARY", total: 500_000 });

    await prisma.project.update({ where: { id: project.id }, data: { status: "ARCHIVED", updatedById: context.userId } });
  });

  it("um Orçamento Oficial SUPERSEDED nunca compete, mesmo com versão mais alta e kind=OFFICIAL", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const project = await prisma.project.create({ data: { organizationId: context.organizationId, name: `TESTE OFICIAL SUPERADO ${suffix}`, city: "São Paulo", state: "SP", createdById: context.userId, updatedById: context.userId } });
    // Simula um Orçamento Oficial já superado (kind continua OFFICIAL, mas status não é mais "OFFICIAL")
    // com a versão mais alta do projeto — status, não kind nem versão, decide elegibilidade.
    await prisma.budget.create({ data: { organizationId: context.organizationId, projectId: project.id, name: `Oficial superado ${suffix}`, status: "SUPERSEDED", kind: "OFFICIAL", currency: "BRL", baseDate: new Date("2026-07-01"), version: 5, totalBudget: 8_000_000, createdById: context.userId, updatedById: context.userId } });
    const draft = await prisma.budget.create({ data: { organizationId: context.organizationId, projectId: project.id, name: `Rascunho corrente ${suffix}`, status: "DRAFT", kind: "PRELIMINARY", currency: "BRL", baseDate: new Date("2026-08-01"), version: 1, totalBudget: 300_000, createdById: context.userId, updatedById: context.userId } });

    const workspace = await getOperationsWorkspace(context, project.id);
    expect(workspace.budget).toMatchObject({ id: draft.id, status: "DRAFT", total: 300_000 });

    await prisma.project.update({ where: { id: project.id }, data: { status: "ARCHIVED", updatedById: context.userId } });
  });
});
