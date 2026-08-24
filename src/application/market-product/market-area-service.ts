import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { assertMarketProductCapability, createMarketAreaSchema, type CreateMarketAreaInput, type MarketProductCapability } from "@/domain/market-product";

export type MarketProductContext = Pick<AuthContext, "organizationId" | "userId" | "role">;

export function requireMarketProductCapability(context: Pick<MarketProductContext, "role">, capability: MarketProductCapability) {
  assertMarketProductCapability(context.role, capability);
}

async function assertLandAssetScope(organizationId: string, landAssetId: string) {
  const landAsset = await prisma.landAsset.findFirst({ where: { id: landAssetId, organizationId } });
  if (!landAsset) throw new Error("Terreno não encontrado nesta organização.");
  return landAsset;
}

async function assertProjectScope(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  return project;
}

// Cria (ou reaproveita, se já existir uma padrão para o mesmo terreno/empreendimento) a área de
// mercado / área de influência (plano 9J, seção E). Grain: [organizationId, landAssetId|projectId, name].
export async function getOrCreateDefaultMarketArea(context: MarketProductContext, rawInput: CreateMarketAreaInput, options?: { isDemo?: boolean }) {
  requireMarketProductCapability(context, "MARKET_MANAGE");
  const input = createMarketAreaSchema.parse(rawInput);
  if (input.landAssetId) await assertLandAssetScope(context.organizationId, input.landAssetId);
  if (input.projectId) await assertProjectScope(context.organizationId, input.projectId);

  const existing = await prisma.marketArea.findFirst({
    where: {
      organizationId: context.organizationId,
      isDefault: true,
      ...(input.landAssetId ? { landAssetId: input.landAssetId } : {}),
      ...(input.projectId && !input.landAssetId ? { projectId: input.projectId } : {}),
    },
  });
  if (existing) return existing;

  return prisma.marketArea.create({
    data: {
      organizationId: context.organizationId,
      landAssetId: input.landAssetId ?? null,
      projectId: input.projectId ?? null,
      name: input.name,
      type: input.type,
      centerLatitude: input.centerLatitude,
      centerLongitude: input.centerLongitude,
      radiusMeters: input.radiusMeters ?? 3_000,
      neighborhood: input.neighborhood,
      city: input.city,
      state: input.state,
      isDefault: true,
      isDemo: options?.isDemo ?? false,
      createdById: context.userId,
    },
  });
}

export async function getMarketAreaForOrganization(context: Pick<MarketProductContext, "organizationId" | "role">, marketAreaId: string) {
  requireMarketProductCapability(context, "MARKET_VIEW");
  const marketArea = await prisma.marketArea.findFirst({ where: { id: marketAreaId, organizationId: context.organizationId } });
  if (!marketArea) throw new Error("Área de mercado não encontrada nesta organização.");
  return marketArea;
}

export async function listMarketAreas(context: Pick<MarketProductContext, "organizationId" | "role">) {
  requireMarketProductCapability(context, "MARKET_VIEW");
  return prisma.marketArea.findMany({ where: { organizationId: context.organizationId }, orderBy: { createdAt: "desc" } });
}
