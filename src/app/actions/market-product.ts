"use server";

import { requireDomainActionContext } from "./authorization";
const requireAuthContext = () => requireDomainActionContext("MARKET_PRODUCT_READ");
import {
  buildMarketProductWorkspaceView,
  decideProductScenario,
  generateAndPersistProductScenarios,
  getMarketProductWorkspace,
  ingestMarketDevelopment,
  ingestMarketInventorySnapshot,
  ingestMarketPriceObservation,
  type MarketProductWorkspaceView,
} from "@/application/market-product";
import {
  decideProductScenarioSchema,
  generateProductScenariosSchema,
  ingestMarketDevelopmentSchema,
  ingestMarketInventorySnapshotSchema,
  ingestMarketPriceObservationSchema,
  type DecideProductScenarioInput,
  type GenerateProductScenariosInput,
  type IngestMarketDevelopmentInput,
  type IngestMarketInventorySnapshotInput,
  type IngestMarketPriceObservationInput,
} from "@/domain/market-product";
import { getOrCreateDefaultMarketArea } from "@/application/market-product/market-area-service";
import { prisma } from "@/infrastructure/database/prisma";

export type MarketProductActionResult = { ok: true; data: MarketProductWorkspaceView } | { ok: false; error: string };

export async function generateProductScenariosAction(raw: GenerateProductScenariosInput): Promise<MarketProductActionResult> {
  try {
    const context = await requireAuthContext();
    const parsed = generateProductScenariosSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Parâmetros inválidos para gerar os cenários de produto." };
    await generateAndPersistProductScenarios(context, parsed.data);
    const workspace = await getMarketProductWorkspace(context, parsed.data.projectId);
    return { ok: true, data: buildMarketProductWorkspaceView(workspace) };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Não foi possível gerar os cenários de produto." }; }
}

export async function decideProductScenarioAction(raw: DecideProductScenarioInput): Promise<MarketProductActionResult> {
  try {
    const context = await requireAuthContext();
    const parsed = decideProductScenarioSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Parâmetros inválidos para decidir o cenário de produto." };
    const scenario = await prisma.productScenario.findFirst({ where: { id: parsed.data.scenarioId, organizationId: context.organizationId }, select: { projectId: true } });
    await decideProductScenario(context, parsed.data);
    const workspace = await getMarketProductWorkspace(context, scenario?.projectId ?? undefined);
    return { ok: true, data: buildMarketProductWorkspaceView(workspace) };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Não foi possível registrar a decisão sobre o cenário de produto." }; }
}

async function refreshedWorkspaceForMarketArea(context: Awaited<ReturnType<typeof requireAuthContext>>, marketAreaId: string) {
  const area = await prisma.marketArea.findFirst({
    where: { id: marketAreaId, organizationId: context.organizationId },
    select: { projectId: true },
  });
  return buildMarketProductWorkspaceView(await getMarketProductWorkspace(context, area?.projectId ?? undefined));
}

export async function registerMarketDevelopmentAction(raw: IngestMarketDevelopmentInput): Promise<MarketProductActionResult> {
  try {
    const context = await requireAuthContext();
    const parsed = ingestMarketDevelopmentSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos para cadastrar o concorrente." };
    await ingestMarketDevelopment(context, parsed.data, false);
    return { ok: true, data: await refreshedWorkspaceForMarketArea(context, parsed.data.marketAreaId) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível cadastrar o concorrente." };
  }
}

export async function registerMarketPriceObservationAction(raw: IngestMarketPriceObservationInput): Promise<MarketProductActionResult> {
  try {
    const context = await requireAuthContext();
    const parsed = ingestMarketPriceObservationSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos para registrar o preço." };
    const development = await prisma.marketDevelopment.findFirst({
      where: { id: parsed.data.developmentId, organizationId: context.organizationId },
      select: { marketAreaId: true },
    });
    if (!development) return { ok: false, error: "Concorrente não encontrado nesta organização." };
    await ingestMarketPriceObservation(context, parsed.data, false);
    return { ok: true, data: await refreshedWorkspaceForMarketArea(context, development.marketAreaId) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível registrar o preço observado." };
  }
}

export async function registerMarketInventorySnapshotAction(raw: IngestMarketInventorySnapshotInput): Promise<MarketProductActionResult> {
  try {
    const context = await requireAuthContext();
    const parsed = ingestMarketInventorySnapshotSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos para registrar o estoque." };
    const development = await prisma.marketDevelopment.findFirst({
      where: { id: parsed.data.developmentId, organizationId: context.organizationId },
      select: { marketAreaId: true },
    });
    if (!development) return { ok: false, error: "Concorrente não encontrado nesta organização." };
    await ingestMarketInventorySnapshot(context, parsed.data, false);
    return { ok: true, data: await refreshedWorkspaceForMarketArea(context, development.marketAreaId) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível registrar o estoque observado." };
  }
}

export async function createDefaultMarketAreaAction(projectId: string, input: {
  name: string;
  type: "RADIUS" | "NEIGHBORHOOD" | "MUNICIPALITY" | "CUSTOM_POLYGON" | "ISOCHRONE";
  centerLatitude: number;
  centerLongitude: number;
  radiusMeters?: number;
  neighborhood?: string;
  city: string;
  state: string;
}): Promise<MarketProductActionResult> {
  try {
    const context = await requireAuthContext();
    await getOrCreateDefaultMarketArea(context, { ...input, projectId }, { isDemo: false });
    return { ok: true, data: buildMarketProductWorkspaceView(await getMarketProductWorkspace(context, projectId)) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível criar a área de mercado." };
  }
}
