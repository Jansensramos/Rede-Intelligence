import { describe, expect, it } from "vitest";
import { evaluateBudget } from "./budget";
import type { AiBudgetPolicy } from "./types";

function policy(overrides: Partial<AiBudgetPolicy> = {}): AiBudgetPolicy {
  return { organizationId: "org-1", monthlyLimitUsdMicros: 10_000_000, hardBlock: true, ...overrides };
}

describe("evaluateBudget", () => {
  it("ausencia de politica de orcamento equivale a bloqueio (decisao 9)", () => {
    expect(evaluateBudget({ policy: null, monthToDateUsdMicros: 0, dayToDateUsdMicros: 0, estimatedCostUsdMicros: 1, priceVersion: "v1" })).toEqual({ allowed: false, reason: "BUDGET_MISSING" });
  });

  it("monthlyLimitUsdMicros <= 0 equivale a bloqueio (ausencia de orcamento real)", () => {
    const decision = evaluateBudget({ policy: policy({ monthlyLimitUsdMicros: 0 }), monthToDateUsdMicros: 0, dayToDateUsdMicros: 0, estimatedCostUsdMicros: 1, priceVersion: "v1" });
    expect(decision).toEqual({ allowed: false, reason: "BUDGET_MISSING" });
  });

  it("chamada cobravel sem preco versionado falha fechado (decisao 6)", () => {
    const decision = evaluateBudget({ policy: policy(), monthToDateUsdMicros: 0, dayToDateUsdMicros: 0, estimatedCostUsdMicros: 100, priceVersion: null });
    expect(decision).toEqual({ allowed: false, reason: "PRICE_NOT_VERSIONED" });
  });

  it("chamada de custo zero sem preco versionado nao e bloqueada por preco (nada a precificar)", () => {
    const decision = evaluateBudget({ policy: policy(), monthToDateUsdMicros: 0, dayToDateUsdMicros: 0, estimatedCostUsdMicros: 0, priceVersion: null });
    expect(decision.allowed).toBe(true);
  });

  it("bloqueia quando o gasto do mes + custo estimado excede o limite mensal", () => {
    const decision = evaluateBudget({ policy: policy({ monthlyLimitUsdMicros: 1_000 }), monthToDateUsdMicros: 900, dayToDateUsdMicros: 0, estimatedCostUsdMicros: 200, priceVersion: "v1" });
    expect(decision).toEqual({ allowed: false, reason: "MONTHLY_LIMIT_EXCEEDED" });
  });

  it("permite exatamente no limite (gasto + custo == limite)", () => {
    const decision = evaluateBudget({ policy: policy({ monthlyLimitUsdMicros: 1_000 }), monthToDateUsdMicros: 800, dayToDateUsdMicros: 0, estimatedCostUsdMicros: 200, priceVersion: "v1" });
    expect(decision.allowed).toBe(true);
  });

  it("bloqueia quando excede o limite diario, mesmo dentro do limite mensal", () => {
    const decision = evaluateBudget({ policy: policy({ monthlyLimitUsdMicros: 1_000_000, dailyLimitUsdMicros: 500 }), monthToDateUsdMicros: 100, dayToDateUsdMicros: 400, estimatedCostUsdMicros: 200, priceVersion: "v1" });
    expect(decision).toEqual({ allowed: false, reason: "DAILY_LIMIT_EXCEEDED" });
  });

  it("sem limite diario configurado, so o limite mensal se aplica", () => {
    const decision = evaluateBudget({ policy: policy({ monthlyLimitUsdMicros: 1_000_000 }), monthToDateUsdMicros: 100, dayToDateUsdMicros: 999_000, estimatedCostUsdMicros: 200, priceVersion: "v1" });
    expect(decision.allowed).toBe(true);
  });
});
