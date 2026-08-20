import { z } from "zod";

const decimalValue = z.union([z.string().trim().min(1), z.number().finite()]).transform(String);

export const budgetLineItemInputSchema = z.object({
  parentId: z.string().min(1).nullable().optional(),
  code: z.string().trim().min(1).max(80).nullable().optional(),
  phase: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  quantity: decimalValue,
  unit: z.string().trim().min(1).max(30),
  unitCost: decimalValue,
  sortOrder: z.number().int().nonnegative().optional(),
  costCenter: z.string().trim().max(120).nullable().optional(),
  tower: z.string().trim().max(120).nullable().optional(),
  origin: z.string().trim().max(120).nullable().optional(),
});

export const createBudgetSchema = z.object({
  projectId: z.string().min(1),
  studyVersionId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(160).default("Orçamento-base"),
  description: z.string().trim().max(1000).nullable().optional(),
  currency: z.string().trim().length(3).default("BRL"),
  baseDate: z.coerce.date().default(() => new Date()),
  lineItems: z.array(budgetLineItemInputSchema).min(1),
});

export const updateBudgetLineItemSchema = budgetLineItemInputSchema
  .pick({ description: true, quantity: true, unitCost: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo para atualização.");

export type CreateBudgetInput = z.input<typeof createBudgetSchema>;
export type UpdateBudgetLineItemInput = z.input<typeof updateBudgetLineItemSchema>;
