"use server";

import { requireDomainActionContext } from "./authorization";
const requireAuthContext = () => requireDomainActionContext("MARKET_PRODUCT_READ");
import {
  buildMarketProductWorkspaceView,
  decideProductScenario,
  generateAndPersistProductScenarios,
  getMarketProductWorkspace,
  type MarketProductWorkspaceView,
} from "@/application/market-product";
import { decideProductScenarioSchema, generateProductScenariosSchema, type DecideProductScenarioInput, type GenerateProductScenariosInput } from "@/domain/market-product";
import { prisma } from "@/infrastructure/database/prisma";

export type MarketProductActionResult =
  | { ok: true; data: MarketProductWorkspaceView }
  | { ok: false; error: string };

export async function generateProductScenariosAction(raw: GenerateProductScenariosInput): Promise<MarketProductActionResult> {
  const context = await requireAuthContext();
  const parsed = generateProductScenariosSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Parâmetros inválidos para gerar os cenários de produto." };
  try {
    await generateAndPersistProductScenarios(context, parsed.data);
    const workspace = await getMarketProductWorkspace(context, parsed.data.projectId);
    return { ok: true, data: buildMarketProductWorkspaceView(workspace) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível gerar os cenários de produto." };
  }
}

export async function decideProductScenarioAction(raw: DecideProductScenarioInput): Promise<MarketProductActionResult> {
  const context = await requireAuthContext();
  const parsed = decideProductScenarioSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Parâmetros inválidos para decidir o cenário de produto." };
  try {
    const scenario = await prisma.productScenario.findFirst({ where: { id: parsed.data.scenarioId, organizationId: context.organizationId }, select: { projectId: true } });
    await decideProductScenario(context, parsed.data);
    const workspace = await getMarketProductWorkspace(context, scenario?.projectId ?? undefined);
    return { ok: true, data: buildMarketProductWorkspaceView(workspace) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível registrar a decisão sobre o cenário de produto." };
  }
}
