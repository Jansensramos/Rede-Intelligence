import { prisma } from "@/infrastructure/database/prisma";
import { requireMarketProductCapability, type MarketProductContext } from "./market-area-service";
import { getMarketOverview, type MarketOverview } from "./market-metrics-service";
import { listProductScenarios } from "./product-scenario-service";

export interface MarketProductWorkspace {
  marketArea: Awaited<ReturnType<typeof prisma.marketArea.findFirst>>;
  overview: MarketOverview | null;
  scenarios: Awaited<ReturnType<typeof listProductScenarios>>;
}

// Ponto único de leitura para a UI (Inteligência de Mercado + Inteligência de Produto). Somente
// leitura — nunca provisiona dados como efeito colateral de uma visualização; a área de mercado
// padrão é criada explicitamente (seed ou ação de um perfil com MARKET_MANAGE).
export async function getMarketProductWorkspace(context: MarketProductContext): Promise<MarketProductWorkspace> {
  requireMarketProductCapability(context, "MARKET_VIEW");

  const marketArea = await prisma.marketArea.findFirst({
    where: { organizationId: context.organizationId, isDefault: true },
    orderBy: { createdAt: "desc" },
  });
  if (!marketArea) return { marketArea: null, overview: null, scenarios: [] };

  const [overview, scenarios] = await Promise.all([
    getMarketOverview(context, marketArea.id),
    listProductScenarios(context, marketArea.id),
  ]);

  return { marketArea, overview, scenarios };
}
