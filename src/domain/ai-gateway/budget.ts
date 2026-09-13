import type { AiBudgetPolicy } from "./types";

/**
 * Decisao pura de orcamento (docs Fase 10A §9 / decisao 9): ausencia de orcamento
 * equivale a bloqueio; o orcamento e sempre rigido (hardBlock) - nao existe modo "soft"
 * nesta rodada. A concorrencia real (corrida de orcamento) e responsabilidade da camada
 * de aplicacao (budget-service.ts), que usa transacao Serializable sobre este calculo.
 */

export type BudgetBlockReason = "BUDGET_MISSING" | "MONTHLY_LIMIT_EXCEEDED" | "DAILY_LIMIT_EXCEEDED" | "PRICE_NOT_VERSIONED";

export interface BudgetDecision {
  allowed: boolean;
  reason?: BudgetBlockReason;
}

export interface BudgetCheckInput {
  policy: AiBudgetPolicy | null;
  monthToDateUsdMicros: number;
  dayToDateUsdMicros: number;
  estimatedCostUsdMicros: number;
  /** Prova de preco versionado (decisao 6): chamada cobravel sem isto falha fechado. */
  priceVersion: string | null;
}

export function evaluateBudget(input: BudgetCheckInput): BudgetDecision {
  if (!input.policy) return { allowed: false, reason: "BUDGET_MISSING" };
  if (input.estimatedCostUsdMicros > 0 && !input.priceVersion) return { allowed: false, reason: "PRICE_NOT_VERSIONED" };
  const monthlyLimit = input.policy.monthlyLimitUsdMicros;
  if (monthlyLimit <= 0) return { allowed: false, reason: "BUDGET_MISSING" };
  if (input.monthToDateUsdMicros + input.estimatedCostUsdMicros > monthlyLimit) return { allowed: false, reason: "MONTHLY_LIMIT_EXCEEDED" };
  if (input.policy.dailyLimitUsdMicros != null) {
    if (input.dayToDateUsdMicros + input.estimatedCostUsdMicros > input.policy.dailyLimitUsdMicros) return { allowed: false, reason: "DAILY_LIMIT_EXCEEDED" };
  }
  return { allowed: true };
}
