"use server";

/**
 * Fase 9K.4A — ações de simulação da Gestão Executiva ("O que você precisa saber para decidir").
 * Deliberadamente SEM `revalidatePath`: são simulações somente-leitura (ordem de serviço §9) — nada
 * muda no domínio, então não há nada para revalidar. Mesmo padrão de tratamento de erro de
 * `src/app/actions/financial.ts`, sem o efeito colateral de revalidação que não se aplica aqui.
 */
import { requireDomainActionContext } from "./authorization";
const requireAuthContext = () => requireDomainActionContext("EXECUTIVE_READ");
import { simulateDiscountForUnit, simulateHiringForProject } from "@/application/executive-insights/executive-insights-service";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "A simulação não pôde ser concluída.");

async function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function simulateHiringAction(projectId: string, monthlyCost: number) {
  const context = await requireAuthContext();
  return run(() => simulateHiringForProject(context, projectId, monthlyCost));
}

export async function simulateDiscountAction(projectId: string, salesUnitId: string, proposedPrice: number) {
  const context = await requireAuthContext();
  return run(() => simulateDiscountForUnit(context, projectId, salesUnitId, proposedPrice));
}
