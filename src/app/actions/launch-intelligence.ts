"use server";

import { revalidatePath } from "next/cache";
import { requireDomainActionContext } from "./authorization";
const requireAuthContext = () => requireDomainActionContext("MARKET_PRODUCT_READ");
import { buildMarketProductWorkspaceView, getMarketProductWorkspace, type MarketProductWorkspaceView } from "@/application/market-product";
import { createCustomLaunchScenario, createLaunchTrigger, decideLaunch, generateLaunchScenarios, registerMacroObservation } from "@/application/launch-intelligence";
import type { CreateCustomLaunchScenarioInput, CreateLaunchTriggerInput, DecideLaunchInput, GenerateLaunchScenariosInput, RegisterMacroObservationInput } from "@/domain/launch-intelligence";

export type LaunchActionResult = { ok: true; data: MarketProductWorkspaceView } | { ok: false; error: string };
function refresh() { revalidatePath("/mercado-produto"); revalidatePath("/executivo"); revalidatePath("/acoes"); }
async function workspace(projectId: string) { const context = await requireAuthContext(); return buildMarketProductWorkspaceView(await getMarketProductWorkspace(context, projectId)); }
function failure(error: unknown): LaunchActionResult { return { ok: false, error: error instanceof Error ? error.message : "Não foi possível concluir a operação." }; }

export async function registerMacroObservationAction(projectId: string, input: RegisterMacroObservationInput): Promise<LaunchActionResult> {
  try { const context = await requireAuthContext(); await registerMacroObservation(context, input); refresh(); return { ok: true, data: await workspace(projectId) }; } catch (error) { return failure(error); }
}
export async function generateLaunchScenariosAction(input: GenerateLaunchScenariosInput): Promise<LaunchActionResult> {
  try { const context = await requireAuthContext(); await generateLaunchScenarios(context, input); refresh(); return { ok: true, data: await workspace(input.projectId) }; } catch (error) { return failure(error); }
}
export async function createCustomLaunchScenarioAction(input: CreateCustomLaunchScenarioInput): Promise<LaunchActionResult> {
  try { const context = await requireAuthContext(); await createCustomLaunchScenario(context, input); refresh(); return { ok: true, data: await workspace(input.projectId) }; } catch (error) { return failure(error); }
}
export async function createLaunchTriggerAction(input: CreateLaunchTriggerInput): Promise<LaunchActionResult> {
  try { const context = await requireAuthContext(); await createLaunchTrigger(context, input); refresh(); return { ok: true, data: await workspace(input.projectId) }; } catch (error) { return failure(error); }
}
export async function decideLaunchAction(projectId: string, input: DecideLaunchInput): Promise<LaunchActionResult> {
  try { const context = await requireAuthContext(); await decideLaunch(context, input); refresh(); return { ok: true, data: await workspace(projectId) }; } catch (error) { return failure(error); }
}
