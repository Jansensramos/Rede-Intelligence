import { describe, expect, it } from "vitest";
import {
  assertDataIntelligenceCapability,
  calculateConfidence,
  calculateSimilarity,
  checkEligibility,
  convertUnit,
  detectOutliersIqr,
  detectOutliersMad,
  evaluateForecastAccuracy,
  hasDataIntelligenceCapability,
  normalizeCurrency,
  percentile,
  suggestUnitCost,
  summarizeBias,
  summarizeDistribution,
} from ".";

describe("normalização de unidades", () => {
  it("converte dentro da mesma dimensão física", () => {
    expect(convertUnit(25, "t", "kg")).toMatchObject({ value: 25000, compatible: true });
    expect(convertUnit(1000, "kg", "t")).toMatchObject({ value: 1, compatible: true });
  });

  it("recusa converter grandezas incompatíveis, sem lançar exceção", () => {
    const result = convertUnit(10, "kg", "m2");
    expect(result.compatible).toBe(false);
    expect(Number.isNaN(result.value)).toBe(true);
  });

  it("nunca converte verba/lote para uma dimensão física", () => {
    expect(convertUnit(1, "verba", "kg").compatible).toBe(false);
  });

  it("verba/lote nunca são compatíveis com unidade de serviço, mesmo ambas sendo contáveis", () => {
    // Regressão: um orçamento em "VB" (verba, quantidade sempre 1) não pode ser pooled com um
    // contrato medido em "unidade de serviço" só porque as duas são cardinalidade inteira — isso
    // misturou R$ 24,5 milhões (verba) com ~R$ 1.000 (unidade de serviço) num mesmo benchmark.
    expect(convertUnit(1, "verba", "unidade de serviço").compatible).toBe(false);
    expect(convertUnit(1, "vb", "unidade").compatible).toBe(false);
    expect(convertUnit(1, "lote", "peça").compatible).toBe(false);
  });
});

describe("normalização de moeda e índice", () => {
  const series = [
    { referenceDate: new Date("2023-01-01"), value: 100 },
    { referenceDate: new Date("2026-01-01"), value: 115 },
  ];

  it("preserva o valor nominal sem alterar o histórico", () => {
    const result = normalizeCurrency({ sourceAmount: 2100, sourceDate: new Date("2023-06-01"), targetDate: new Date("2026-06-01"), method: "NOMINAL", indexSeries: series });
    expect(result.normalizedAmount).toBe(2100);
    expect(result.method).toBe("NOMINAL");
  });

  it("aplica o fator do índice mais próximo ao corrigir", () => {
    const result = normalizeCurrency({ sourceAmount: 2100, sourceDate: new Date("2023-01-01"), targetDate: new Date("2026-01-01"), method: "CORRECTED", indexSeries: series, indexName: "INCC" });
    expect(result.factor).toBeCloseTo(1.15, 4);
    expect(result.normalizedAmount).toBeCloseTo(2415, 2);
    expect(result.memory).toContain("INCC");
  });
});

describe("estatística e outliers", () => {
  it("calcula percentis por interpolação linear", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([2700, 2700, 2700, 2700, 2700, 2700], 50)).toBe(2700);
  });

  it("não marca outlier com amostra insuficiente", () => {
    expect(detectOutliersIqr([2700, 2750])).toEqual([]);
    expect(detectOutliersMad([2700, 2750])).toEqual([]);
  });

  it("sinaliza um ponto genuinamente fora da distribuição, mas não remove ninguém automaticamente", () => {
    const values = [2600, 2650, 2700, 2680, 2660, 9000];
    const flags = detectOutliersIqr(values);
    expect(flags.map((f) => f.value)).toContain(9000);
    expect(summarizeDistribution(values).sampleSize).toBe(6);
  });
});

describe("gate de comparabilidade e similaridade", () => {
  const subject = { currency: "BRL", unit: "m3", region: "São Paulo/SP", economicStage: "CONTRACTED", productStandard: "MCMV", projectId: "p1", asOfDate: new Date("2026-08-01") };

  it("recusa candidato com moeda incompatível", () => {
    const candidate = { ...subject, projectId: "p2", currency: "USD" };
    expect(checkEligibility(subject, candidate, { requireSameCurrency: true, requireCompatibleUnit: true, requireSameEconomicStageOrLater: false, maxAgeMonths: null, allowedRegions: null }).eligible).toBe(false);
  });

  it("aceita candidato dentro da janela de idade e região", () => {
    const candidate = { ...subject, projectId: "p2" };
    const result = checkEligibility(subject, candidate, { requireSameCurrency: true, requireCompatibleUnit: true, requireSameEconomicStageOrLater: false, maxAgeMonths: 24, allowedRegions: ["São Paulo/SP"] });
    expect(result.eligible).toBe(true);
  });

  it("similaridade cai quando região e padrão divergem, e mostra os fatores", () => {
    const weights = { region: 3, economicStage: 2, productStandard: 3, recency: 1 };
    const same = calculateSimilarity(subject, { ...subject, projectId: "p2" }, weights);
    const different = calculateSimilarity(subject, { ...subject, projectId: "p3", region: "Goiânia/GO", productStandard: "ALTO_PADRAO" }, weights);
    expect(same.score).toBeGreaterThan(different.score);
    expect(different.factors.find((f) => f.key === "region")?.note).toContain("diferente");
  });
});

describe("nível de confiança", () => {
  const weights = { sampleSize: 3, recency: 2, dispersion: 2, similarity: 2, provenance: 1 };

  it("nunca dá confiança alta para amostra única, mesmo com dados perfeitos", () => {
    const result = calculateConfidence({ sampleSize: 1, minimumSampleSize: 5, averageAgeMonths: 0, coefficientOfVariation: 0, averageSimilarity: 1, provenanceScore: 1 }, weights);
    expect(result.level).toBe("LOW");
  });

  it("dá confiança alta para amostra grande, recente, coesa e bem documentada", () => {
    const result = calculateConfidence({ sampleSize: 20, minimumSampleSize: 5, averageAgeMonths: 2, coefficientOfVariation: 0.05, averageSimilarity: 0.9, provenanceScore: 0.9 }, weights);
    expect(result.level).toBe("HIGH");
  });
});

describe("precisão de forecast e bias", () => {
  it("calcula erro absoluto e percentual sem dividir por zero", () => {
    expect(evaluateForecastAccuracy({ predictedValue: 40_000_000, actualValue: 44_000_000 })).toMatchObject({ absoluteError: 4_000_000, bias: "PESSIMISTIC" });
    const zero = evaluateForecastAccuracy({ predictedValue: 0, actualValue: 100 });
    expect(zero.percentError).toBeNull();
  });

  it("não reescreve a previsão original — apenas resume o padrão de erro", () => {
    const summary = summarizeBias([
      { bias: "PESSIMISTIC", percentError: 0.1 },
      { bias: "PESSIMISTIC", percentError: 0.08 },
      { bias: "NEUTRAL", percentError: 0.01 },
    ]);
    expect(summary.dominantBias).toBe("PESSIMISTIC");
    expect(summary.averagePercentError).toBeCloseTo(0.063, 3);
  });
});

describe("fundação do Orçamento Inteligente", () => {
  it("sugere pela mediana e sinaliza amostra pequena como exceção", () => {
    const result = suggestUnitCost({ quantity: 100, benchmarkMedian: 2700, benchmarkP25: 2500, benchmarkP75: 2900, confidenceLevel: "LOW", sampleSize: 1, sampleProjectNames: ["START BUTANTÃ"], unit: "m3" });
    expect(result.suggestedTotalCost).toBe(270_000);
    expect(result.exceptions.length).toBeGreaterThan(0);
  });
});

describe("RBAC — capacidades da Inteligência de Dados", () => {
  it("segrega quem constrói de quem aprova", () => {
    expect(hasDataIntelligenceCapability("ANALYST", "AUTOBUDGET_BUILD")).toBe(true);
    expect(hasDataIntelligenceCapability("ANALYST", "AUTOBUDGET_APPROVE")).toBe(false);
    expect(hasDataIntelligenceCapability("REVIEWER", "AUTOBUDGET_APPROVE")).toBe(true);
    expect(() => assertDataIntelligenceCapability("VIEWER", "AUTOBUDGET_APPROVE")).toThrow("VIEWER");
  });
});
