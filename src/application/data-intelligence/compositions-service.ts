import { createHash } from "node:crypto";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { assertDataIntelligenceCapability, type DataIntelligenceCapability } from "@/domain/data-intelligence";

type DIContext = Pick<AuthContext, "organizationId" | "userId" | "role">;
const checksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function requireCapability(context: Pick<DIContext, "role">, capability: DataIntelligenceCapability) {
  assertDataIntelligenceCapability(context.role, capability);
}

// ============================================================================
// Fundação de Composições (plano 9I, seção 14.2)
// ============================================================================
//
// Serviço → insumos/mão de obra/equipamento → coeficiente → unidade →
// produtividade → vigência. Estrutura versionada mínima para o futuro
// Orçamento Inteligente evoluir sem redesenho — não é SINAPI, não importa
// base externa, e o preço de um insumo nunca é gravado aqui como fato
// oficial (isso é responsabilidade do AnalyticsFact/benchmark, não da
// composição, que descreve apenas a receita técnica).

export interface CompositionItemInput {
  inputType: "MATERIAL" | "LABOR" | "EQUIPMENT";
  economicItemId?: string | null;
  description: string;
  unit: string;
  coefficient: number;
  productivity?: number | null;
  wastageRate?: number;
}

export interface CreateCompositionInput {
  key: string;
  name: string;
  outputDescription: string;
  outputUnit: string;
  region?: string | null;
  productStandard?: string | null;
  constructiveMethod?: string | null;
  economicItemId?: string | null;
  source: string;
  effectiveFrom: Date;
  items: CompositionItemInput[];
}

export async function createCostComposition(context: DIContext, input: CreateCompositionInput) {
  requireCapability(context, "DATA_CONTRACT_MANAGE");
  if (input.items.length === 0) throw new Error("Uma composição precisa de ao menos um insumo, mão de obra ou equipamento.");

  const previous = await prisma.costCompositionDefinition.findFirst({ where: { organizationId: context.organizationId, key: input.key }, orderBy: { version: "desc" } });
  const version = (previous?.version ?? 0) + 1;
  const payload = { key: input.key, outputDescription: input.outputDescription, outputUnit: input.outputUnit, items: input.items };

  return prisma.costCompositionDefinition.create({
    data: {
      organizationId: context.organizationId, key: input.key, version, name: input.name,
      outputDescription: input.outputDescription, outputUnit: input.outputUnit,
      region: input.region ?? null, productStandard: input.productStandard ?? null, constructiveMethod: input.constructiveMethod ?? null,
      economicItemId: input.economicItemId ?? null, source: input.source, status: "DRAFT", effectiveFrom: input.effectiveFrom,
      checksum: checksum(payload), createdById: context.userId,
      items: { create: input.items.map((item, index) => ({ inputType: item.inputType, economicItemId: item.economicItemId ?? null, description: item.description, unit: item.unit, coefficient: item.coefficient, productivity: item.productivity ?? null, wastageRate: item.wastageRate ?? 0, sortOrder: index })) },
    },
    include: { items: true },
  });
}

export async function activateCostComposition(context: DIContext, compositionId: string) {
  requireCapability(context, "METRIC_APPROVE");
  const composition = await prisma.costCompositionDefinition.findFirst({ where: { id: compositionId, organizationId: context.organizationId } });
  if (!composition) throw new Error("Composição não encontrada nesta organização.");
  if (composition.status !== "DRAFT") throw new Error(`Composição em status ${composition.status} não pode ser ativada.`);
  return prisma.costCompositionDefinition.update({ where: { id: compositionId }, data: { status: "ACTIVE" } });
}

export async function listCostCompositions(context: DIContext) {
  requireCapability(context, "DATA_VIEW");
  const compositions = await prisma.costCompositionDefinition.findMany({
    where: { organizationId: context.organizationId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ key: "asc" }, { version: "desc" }],
  });
  return compositions.map((c) => ({
    id: c.id, key: c.key, version: c.version, name: c.name, outputDescription: c.outputDescription, outputUnit: c.outputUnit,
    region: c.region, productStandard: c.productStandard, constructiveMethod: c.constructiveMethod, source: c.source, status: c.status,
    effectiveFrom: c.effectiveFrom.toISOString(), effectiveTo: c.effectiveTo?.toISOString() ?? null,
    items: c.items.map((item) => ({ id: item.id, inputType: item.inputType, description: item.description, unit: item.unit, coefficient: Number(item.coefficient), productivity: item.productivity ? Number(item.productivity) : null, wastageRate: Number(item.wastageRate) })),
  }));
}

export type CostCompositionListItem = Awaited<ReturnType<typeof listCostCompositions>>[number];
