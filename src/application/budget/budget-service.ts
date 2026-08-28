import { Prisma, type BudgetStatus } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { calculateBudgetSummary, type BudgetLineItem, type BudgetSummary } from "@/domain/budget/budget-engine";
import {
  createBudgetSchema,
  updateBudgetLineItemSchema,
  type CreateBudgetInput,
  type UpdateBudgetLineItemInput,
} from "@/domain/budget/schemas";

const budgetInclude = {
  project: { select: { id: true, name: true, city: true, state: true } },
  lineItems: { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }] },
} satisfies Prisma.BudgetInclude;

export type BudgetRecord = Prisma.BudgetGetPayload<{ include: typeof budgetInclude }>;

export interface BudgetWorkspaceView {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  description: string | null;
  status: BudgetStatus;
  currency: string;
  baseDate: string;
  version: number;
  totalBudget: number;
  lineItems: Array<BudgetLineItem & { id: string; code: string | null; parentId: string | null; sortOrder: number }>;
  summary: BudgetSummary;
}

function assertCanMutate(context: Pick<AuthContext, "role">) {
  if (!(["OWNER", "ADMIN", "ANALYST"] as const).includes(context.role as "OWNER" | "ADMIN" | "ANALYST")) {
    throw new Error("Seu perfil não pode alterar orçamentos.");
  }
}

async function projectForTenant(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  return project;
}

async function budgetForTenant(organizationId: string, budgetId: string): Promise<BudgetRecord> {
  const budget = await prisma.budget.findFirst({
    where: { id: budgetId, organizationId, project: { organizationId } },
    include: budgetInclude,
  });
  if (!budget) throw new Error("Orçamento não encontrado nesta organização.");
  return budget;
}

function lineTotal(quantity: Prisma.Decimal.Value, unitCost: Prisma.Decimal.Value) {
  return new Prisma.Decimal(quantity).mul(new Prisma.Decimal(unitCost)).toDecimalPlaces(2);
}

async function recalculateBudgetTotal(budgetId: string) {
  const items = await prisma.budgetLineItem.findMany({ where: { budgetId }, select: { id: true, parentId: true, totalCost: true } });
  const parents = new Set(items.flatMap((item) => item.parentId ? [item.parentId] : []));
  const totalBudget = items.filter((item) => !parents.has(item.id)).reduce((sum, item) => sum.add(item.totalCost), new Prisma.Decimal(0));
  await prisma.budget.update({ where: { id: budgetId }, data: { totalBudget } });
  return totalBudget;
}

export function toBudgetWorkspaceView(budget: BudgetRecord, vgv?: Prisma.Decimal.Value): BudgetWorkspaceView {
  const lineItems = budget.lineItems.map((item) => ({
    id: item.id,
    code: item.code,
    parentId: item.parentId,
    phase: item.phase,
    category: item.category,
    description: item.description,
    quantity: Number(item.quantity),
    unit: item.unit,
    unitCost: Number(item.unitCost),
    totalCost: Number(item.totalCost),
    sortOrder: item.sortOrder,
  }));
  return {
    id: budget.id,
    projectId: budget.projectId,
    projectName: budget.project.name,
    name: budget.name,
    description: budget.description,
    status: budget.status,
    currency: budget.currency,
    baseDate: budget.baseDate.toISOString(),
    version: budget.version,
    totalBudget: Number(budget.totalBudget),
    lineItems,
    summary: calculateBudgetSummary(lineItems, vgv === undefined ? undefined : Number(vgv)),
  };
}

export async function createBudget(context: AuthContext, raw: CreateBudgetInput) {
  assertCanMutate(context);
  const input = createBudgetSchema.parse(raw);
  await projectForTenant(context.organizationId, input.projectId);
  if (input.studyVersionId) {
    const version = await prisma.studyVersion.findFirst({
      where: { id: input.studyVersionId, study: { project: { id: input.projectId, organizationId: context.organizationId } } },
      select: { id: true },
    });
    if (!version) throw new Error("A versão informada não pertence a este empreendimento.");
  }
  const latest = await prisma.budget.aggregate({
    where: { projectId: input.projectId, name: input.name },
    _max: { version: true },
  });
  const version = (latest._max.version ?? 0) + 1;
  const lineItems = input.lineItems.map((item, index) => ({
    parentId: item.parentId ?? null,
    code: item.code ?? null,
    phase: item.phase,
    category: item.category,
    description: item.description,
    quantity: new Prisma.Decimal(item.quantity),
    unit: item.unit,
    unitCost: new Prisma.Decimal(item.unitCost),
    totalCost: lineTotal(item.quantity, item.unitCost),
    sortOrder: item.sortOrder ?? index,
    costCenter: item.costCenter ?? null,
    tower: item.tower ?? null,
    origin: item.origin ?? "USER_PROVIDED",
  }));
  const totalBudget = lineItems.reduce((sum, item) => sum.add(item.totalCost), new Prisma.Decimal(0));
  return prisma.budget.create({
    data: {
      organizationId: context.organizationId,
      projectId: input.projectId,
      studyVersionId: input.studyVersionId ?? null,
      name: input.name,
      description: input.description ?? null,
      currency: input.currency.toUpperCase(),
      baseDate: input.baseDate,
      version,
      totalBudget,
      createdById: context.userId,
      updatedById: context.userId,
      lineItems: { create: lineItems },
    },
    include: budgetInclude,
  });
}

export async function getBudget(context: Pick<AuthContext, "organizationId">, budgetId: string) {
  return budgetForTenant(context.organizationId, budgetId);
}

export async function updateLineItem(context: AuthContext, budgetId: string, lineItemId: string, raw: UpdateBudgetLineItemInput) {
  assertCanMutate(context);
  const input = updateBudgetLineItemSchema.parse(raw);
  const budget = await budgetForTenant(context.organizationId, budgetId);
  if (["APPROVED", "OFFICIAL", "SUPERSEDED", "CLOSED", "ARCHIVED"].includes(budget.status)) throw new Error("Crie uma nova versão para alterar um orçamento aprovado.");
  const currentItem = budget.lineItems.find((item) => item.id === lineItemId);
  if (!currentItem) throw new Error("Item não encontrado neste orçamento.");
  const quantity = new Prisma.Decimal(input.quantity ?? currentItem.quantity);
  const unitCost = new Prisma.Decimal(input.unitCost ?? currentItem.unitCost);
  await prisma.budgetLineItem.update({
    where: { id: lineItemId },
    data: {
      quantity,
      unitCost,
      totalCost: lineTotal(quantity, unitCost),
      description: input.description ?? currentItem.description,
    },
  });
  await recalculateBudgetTotal(budgetId);
  await prisma.budget.update({ where: { id: budgetId }, data: { updatedById: context.userId } });
  return budgetForTenant(context.organizationId, budgetId);
}

export async function deleteLineItem(context: AuthContext, budgetId: string, lineItemId: string) {
  assertCanMutate(context);
  const budget = await budgetForTenant(context.organizationId, budgetId);
  if (["APPROVED", "OFFICIAL", "SUPERSEDED", "CLOSED", "ARCHIVED"].includes(budget.status)) throw new Error("Crie uma nova versão para alterar um orçamento aprovado.");
  if (!budget.lineItems.some((item) => item.id === lineItemId)) throw new Error("Item não encontrado neste orçamento.");
  await prisma.budgetLineItem.delete({ where: { id: lineItemId } });
  await recalculateBudgetTotal(budgetId);
  await prisma.budget.update({ where: { id: budgetId }, data: { updatedById: context.userId } });
}

export async function getBudgetSummary(context: Pick<AuthContext, "organizationId">, budgetId: string, vgv?: Prisma.Decimal.Value) {
  return toBudgetWorkspaceView(await budgetForTenant(context.organizationId, budgetId), vgv).summary;
}

export async function listProjectBudgets(context: Pick<AuthContext, "organizationId">, projectId: string) {
  await projectForTenant(context.organizationId, projectId);
  return prisma.budget.findMany({
    where: { organizationId: context.organizationId, projectId },
    orderBy: [{ name: "asc" }, { version: "desc" }],
    include: budgetInclude,
  });
}

export async function getLatestProjectBudget(context: Pick<AuthContext, "organizationId">, projectId: string, vgv?: Prisma.Decimal.Value) {
  const budget = await prisma.budget.findFirst({
    where: { organizationId: context.organizationId, projectId, status: { notIn: ["ARCHIVED", "SUPERSEDED", "CLOSED"] }, project: { organizationId: context.organizationId } },
    orderBy: [{ version: "desc" }, { updatedAt: "desc" }],
    include: budgetInclude,
  });
  return budget ? toBudgetWorkspaceView(budget, vgv) : null;
}

export async function approveBudget(context: AuthContext, budgetId: string) {
  if (!(["OWNER", "ADMIN"] as const).includes(context.role as "OWNER" | "ADMIN")) throw new Error("Somente Owner ou Admin pode aprovar orçamentos.");
  const budget = await budgetForTenant(context.organizationId, budgetId);
  const parents = new Set(budget.lineItems.flatMap((item) => item.parentId ? [item.parentId] : []));
  const proofTotal = budget.lineItems.filter((item) => !parents.has(item.id)).reduce((sum, item) => sum.add(item.totalCost), new Prisma.Decimal(0));
  if (!proofTotal.equals(budget.totalBudget)) throw new Error("Prova-zero inválida: a soma das linhas finais difere do total do orçamento.");
  return prisma.$transaction(async (tx) => {
    if (budget.kind === "OFFICIAL" || budget.kind === "REVISED") {
      await tx.budget.updateMany({ where: { projectId: budget.projectId, status: "OFFICIAL", id: { not: budget.id } }, data: { status: "SUPERSEDED" } });
    }
    const approved = await tx.budget.update({
      where: { id: budgetId },
      data: { status: budget.kind === "PRELIMINARY" ? "APPROVED" : "OFFICIAL", approvedById: context.userId, approvedAt: new Date(), updatedById: context.userId },
      include: budgetInclude,
    });
    await tx.auditLog.create({ data: { organizationId: context.organizationId, userId: context.userId, projectId: budget.projectId, action: "BUDGET_APPROVED", entityType: "Budget", entityId: budget.id, after: { status: approved.status, version: approved.version, totalBudget: approved.totalBudget.toString() } } });
    return approved;
  });
}
