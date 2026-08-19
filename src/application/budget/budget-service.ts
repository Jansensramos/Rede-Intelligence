import { Prisma } from "@prisma/client";
import {
  calculateLineItemTotal,
  calculateBudgetSummary,
  validateBudget,
  calculateImpactOnFinancial,
  BudgetLineItem,
  BudgetSummary,
} from "@/domain/budget/budget-engine";

interface CreateBudgetInput {
  projectId: string;
  lineItems: Array<{
    phase: string;
    category: string;
    description: string;
    quantity: number;
    unit: string;
    unitCost: number;
  }>;
}

interface UpdateLineItemInput {
  quantity?: number;
  unitCost?: number;
  description?: string;
}

export async function createBudget(prisma: any, input: CreateBudgetInput) {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
  });

  if (!project) {
    throw new Error(`Project ${input.projectId} not found`);
  }

  const lineItemsWithTotals = input.lineItems.map((item) => ({
    ...item,
    totalCost: calculateLineItemTotal(item.quantity, item.unitCost),
  }));

  const totalBudget = lineItemsWithTotals.reduce(
    (sum, item) => sum + item.totalCost,
    0
  );

  const budget = await prisma.budget.create({
    data: {
      projectId: input.projectId,
      version: 1,
      totalBudget,
      lineItems: {
        createMany: {
          data: lineItemsWithTotals,
        },
      },
    },
    include: {
      lineItems: true,
    },
  });

  return budget;
}

export async function getBudget(prisma: any, budgetId: string) {
  const budget = await prisma.budget.findUnique({
    where: { id: budgetId },
    include: {
      lineItems: true,
      project: {
        select: {
          id: true,
          name: true,
          city: true,
        },
      },
    },
  });

  if (!budget) {
    throw new Error(`Budget ${budgetId} not found`);
  }

  return budget;
}

export async function updateLineItem(
  prisma: any,
  budgetId: string,
  lineItemId: string,
  input: UpdateLineItemInput
) {
  const currentItem = await prisma.budgetLineItem.findUnique({
    where: { id: lineItemId },
  });

  if (!currentItem) {
    throw new Error(`Line item ${lineItemId} not found`);
  }

  if (currentItem.budgetId !== budgetId) {
    throw new Error(
      `Line item ${lineItemId} does not belong to budget ${budgetId}`
    );
  }

  const quantity = input.quantity ?? currentItem.quantity;
  const unitCost = input.unitCost ?? currentItem.unitCost;
  const description = input.description ?? currentItem.description;

  const totalCost = calculateLineItemTotal(quantity, unitCost);

  const updatedItem = await prisma.budgetLineItem.update({
    where: { id: lineItemId },
    data: {
      quantity,
      unitCost,
      totalCost,
      description,
    },
  });

  const allItems = await prisma.budgetLineItem.findMany({
    where: { budgetId },
  });

  const newTotalBudget = allItems.reduce(
    (sum, item) =>
      sum +
      (item.id === lineItemId
        ? totalCost
        : calculateLineItemTotal(item.quantity, item.unitCost)),
    0
  );

  await prisma.budget.update({
    where: { id: budgetId },
    data: { totalBudget: newTotalBudget },
  });

  return updatedItem;
}

export async function deleteLineItem(
  prisma: any,
  budgetId: string,
  lineItemId: string
) {
  const item = await prisma.budgetLineItem.findUnique({
    where: { id: lineItemId },
  });

  if (!item || item.budgetId !== budgetId) {
    throw new Error(`Line item ${lineItemId} not found in budget ${budgetId}`);
  }

  await prisma.budgetLineItem.delete({
    where: { id: lineItemId },
  });

  const remainingItems = await prisma.budgetLineItem.findMany({
    where: { budgetId },
  });

  const newTotal = remainingItems.reduce(
    (sum, item) => sum + item.totalCost,
    0
  );

  await prisma.budget.update({
    where: { id: budgetId },
    data: { totalBudget: newTotal },
  });
}

export async function getBudgetSummary(
  prisma: any,
  budgetId: string,
  vgv?: number
): Promise<BudgetSummary> {
  const budget = await getBudget(prisma, budgetId);

  const items: BudgetLineItem[] = budget.lineItems.map((item) => ({
    phase: item.phase,
    category: item.category,
    description: item.description,
    quantity: Number(item.quantity),
    unit: item.unit,
    unitCost: Number(item.unitCost),
    totalCost: Number(item.totalCost),
  }));

  return calculateBudgetSummary(items, vgv);
}

export async function validateBudgetAgainstVGV(
  prisma: any,
  budgetId: string,
  vgv: number,
  minMarginPercentage?: number
) {
  const budget = await getBudget(prisma, budgetId);

  const items: BudgetLineItem[] = budget.lineItems.map((item) => ({
    phase: item.phase,
    category: item.category,
    description: item.description,
    quantity: Number(item.quantity),
    unit: item.unit,
    unitCost: Number(item.unitCost),
    totalCost: Number(item.totalCost),
  }));

  return validateBudget(items, vgv, minMarginPercentage);
}

export async function listProjectBudgets(prisma: any, projectId: string) {
  const budgets = await prisma.budget.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: {
      lineItems: {
        orderBy: { phase: "asc" },
      },
    },
  });

  return budgets;
}

export async function approveBudget(
  prisma: any,
  budgetId: string,
  approvedById: string
) {
  const budget = await prisma.budget.update({
    where: { id: budgetId },
    data: {
      approvedBy: approvedById,
      approvedAt: new Date(),
    },
    include: {
      lineItems: true,
    },
  });

  return budget;
}