import { describe, expect, it } from "vitest";
import { evaluateFreshness, evaluateLaunchTrigger, macroScenarioAdjustments, normalizeMacroValue, recommendLaunch, selectPreferredObservation } from "./engine";

describe("Inteligência de Lançamento 9O", () => {
  it("classifica atualização sem transformar ausência em zero", () => {
    expect(evaluateFreshness({ referenceDate: null, expectedFreshnessDays: 30, asOf: "2026-08-28" })).toEqual({ status: "NO_EVIDENCE", ageDays: null });
    expect(evaluateFreshness({ referenceDate: "2026-08-20", expectedFreshnessDays: 30, asOf: "2026-08-28" }).status).toBe("UPDATED");
    expect(evaluateFreshness({ referenceDate: "2026-06-01", expectedFreshnessDays: 30, asOf: "2026-08-28" }).status).toBe("STALE");
  });

  it("normaliza taxa mensal de modo determinístico e rejeita unidade livre", () => {
    const result = normalizeMacroValue({ code: "SELIC", rawValue: 1, rawUnit: "% a.m.", normalizationKey: "MONTHLY_EFFECTIVE_TO_ANNUAL_EFFECTIVE" });
    expect(result.normalizedValue).toBeCloseTo(12.6825, 3);
    expect(() => normalizeMacroValue({ code: "SELIC", rawValue: 10, rawUnit: "qualquer", normalizationKey: "IDENTITY" })).toThrow("Unidade incompatível");
  });

  it("prioriza observação organizacional fresca e não usa dado stale como fallback", () => {
    const selected = selectPreferredObservation([
      { id: "global", organizationId: null, freshness: "UPDATED" as const, regionCompatible: true },
      { id: "org", organizationId: "org-1", freshness: "AGING" as const, regionCompatible: true },
    ]);
    expect(selected.observation?.id).toBe("org");
    expect(selectPreferredObservation([{ id: "old", organizationId: "org-1", freshness: "STALE" as const, regionCompatible: true }]).reason).toBe("NO_EVIDENCE");
  });

  it("retorna SEM EVIDÊNCIA SUFICIENTE quando um fato crítico falta", () => {
    const result = recommendLaunch({ marginPercentage: 30, minimumMarginPercentage: 20, affordabilityRatioPercentage: 95, vsoPercentage: 7, monthsOfStock: 10, constructionInflationPercentage: null, criticalEvidenceMissing: ["INCC atualizado"] });
    expect(result.recommendation).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.missingEvidence).toContain("INCC atualizado");
  });

  it("explica cenário favorável e cenário que exige revisar produto/preço", () => {
    expect(recommendLaunch({ marginPercentage: 30, minimumMarginPercentage: 20, affordabilityRatioPercentage: 90, vsoPercentage: 8, monthsOfStock: 8, constructionInflationPercentage: 5, criticalEvidenceMissing: [] }).recommendation).toBe("FAVORABLE_TO_LAUNCH");
    const review = recommendLaunch({ marginPercentage: 30, minimumMarginPercentage: 20, affordabilityRatioPercentage: 130, vsoPercentage: 8, monthsOfStock: 8, constructionInflationPercentage: 5, criticalEvidenceMissing: [] });
    expect(review.recommendation).toBe("REVIEW_PRODUCT_PRICE");
    expect(review.conditionsForChange.some((item) => item.includes("produto/preço"))).toBe(true);
  });

  it("gatilho recusa evidência stale, unidade incompatível e confiança insuficiente", () => {
    expect(evaluateLaunchTrigger({ operator: "GT", value: 12, threshold: 10, unit: "%", actualUnit: "%", freshness: "STALE" }).eligible).toBe(false);
    expect(evaluateLaunchTrigger({ operator: "GT", value: 12, threshold: 10, unit: "%", actualUnit: "R$", freshness: "UPDATED" }).reason).toBe("UNIDADE INCOMPATÍVEL");
    expect(evaluateLaunchTrigger({ operator: "GT", value: 12, threshold: 10, unit: "%", actualUnit: "%", freshness: "UPDATED", confidenceLevel: "LOW", minimumConfidence: "HIGH" }).eligible).toBe(false);
    expect(evaluateLaunchTrigger({ operator: "BETWEEN", value: 12, threshold: 10, thresholdEnd: 15, unit: "%", actualUnit: "%", freshness: "UPDATED" }).matched).toBe(true);
  });

  it("mantém sensibilidades explícitas para os três cenários", () => {
    expect(macroScenarioAdjustments("BASE").priceRate).toBe(1);
    expect(macroScenarioAdjustments("FAVORABLE").salesVelocityRate).toBeGreaterThan(1);
    expect(macroScenarioAdjustments("STRESSED").constructionCostRate).toBeGreaterThan(1);
  });

  it("interpreta VSO em pontos percentuais na fronteira do motor", () => {
    const result = recommendLaunch({ marginPercentage: 30, minimumMarginPercentage: 20, affordabilityRatioPercentage: 90, vsoPercentage: 15, monthsOfStock: 8, constructionInflationPercentage: 5, criticalEvidenceMissing: [] });
    expect(result.favorableFactors.some((item) => item.includes("15.0%"))).toBe(true);
  });
});
