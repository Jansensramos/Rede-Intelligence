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
});
