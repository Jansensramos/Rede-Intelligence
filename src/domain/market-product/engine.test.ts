import { describe, expect, it } from "vitest";
import { calculateConfidence } from "@/domain/data-intelligence";
import type { ProjectAssumptions } from "@/domain/financial/types";
import { DEMO_PROJECT } from "@/domain/financial/demo";
import {
  boundingBoxDegrees,
  buildExplainability,
  calculateAffordability,
  calculateAffordableAreaM2,
  calculateCompetitorSimilarity,
  calculateProductConfidence,
  checkCompetitorEligibility,
  decomposeDemandSignals,
  findTypologyByCode,
  generateProductScenarios,
  haversineDistanceMeters,
  isCanonicalMatch,
  isWithinRadius,
  mapProductScenarioToAssumptions,
  normalizedNameSimilarity,
  recommendPrice,
  selectTypologyForArea,
} from "./index";

describe("Geografia (Haversine e bounding box) — plano 9J seção F", () => {
  it("calcula distância conhecida entre dois pontos com precisão métrica", () => {
    // São Paulo (Praça da Sé) a Campinas — referência pública conhecida (~90km em linha reta).
    const se = { latitude: -23.5505, longitude: -46.6333 };
    const campinas = { latitude: -22.9099, longitude: -47.0626 };
    const distance = haversineDistanceMeters(se, campinas);
    expect(distance).toBeGreaterThan(80_000);
    expect(distance).toBeLessThan(90_000);
  });

  it("distância de um ponto a si mesmo é zero", () => {
    const point = { latitude: -23.5505, longitude: -46.6333 };
    expect(haversineDistanceMeters(point, point)).toBe(0);
  });

  it("enquadra pontos dentro e fora do raio de influência", () => {
    const center = { latitude: -23.5705, longitude: -46.7108 }; // Butantã aproximado
    const near = { latitude: -23.5710, longitude: -46.7112 };
    const far = { latitude: -23.4, longitude: -46.5 };
    expect(isWithinRadius(center, near, 3_000)).toBe(true);
    expect(isWithinRadius(center, far, 3_000)).toBe(false);
  });

  it("bounding box contém o centro e cresce com o raio", () => {
    const center = { latitude: -23.5705, longitude: -46.7108 };
    const small = boundingBoxDegrees(center, 500);
    const large = boundingBoxDegrees(center, 5_000);
    expect(small.minLatitude).toBeGreaterThan(large.minLatitude);
    expect(small.maxLatitude).toBeLessThan(large.maxLatitude);
    expect(center.latitude).toBeGreaterThan(small.minLatitude);
    expect(center.latitude).toBeLessThan(small.maxLatitude);
  });
});

describe("Capacidade de Pagamento e Compra — plano 9J seção I", () => {
  const policy = { maxCommitmentRate: 0.3, annualInterestRate: 0.11, termMonths: 360, minDownPaymentRate: 0.2 };

  it("calcula prestação máxima, financiamento suportável e ticket suportável", () => {
    const result = calculateAffordability(10_000, policy);
    expect(result.maxInstallment).toBeCloseTo(3_000, 5);
    expect(result.financeableAmount).toBeGreaterThan(0);
    expect(result.affordableTicket).toBeGreaterThan(result.financeableAmount);
  });

  it("renda maior sempre produz ticket suportável maior (monotonicidade econômica)", () => {
    const low = calculateAffordability(5_000, policy);
    const high = calculateAffordability(15_000, policy);
    expect(high.affordableTicket).toBeGreaterThan(low.affordableTicket);
  });

  it("área máxima suportável = ticket suportável ÷ preço por m²", () => {
    const area = calculateAffordableAreaM2({ affordableTicket: 400_000, pricePerSqm: 8_500 });
    expect(area).toBeCloseTo(47.06, 1);
  });

  it("preço por m² zero não gera divisão inválida", () => {
    expect(calculateAffordableAreaM2({ affordableTicket: 400_000, pricePerSqm: 0 })).toBe(0);
  });
});

describe("Demanda Imobiliária — plano 9J seção J", () => {
  it("decompõe os quatro sinais de demanda sem produzir um score único opaco", () => {
    const result = decomposeDemandSignals({
      currentHouseholds: 10_000,
      householdGrowthRateAnnual: 0.02,
      affordableHouseholdsShare: 0.45,
      competitorMonthlyVelocityUnits: 12,
      annualNewUnitsLaunched: 150,
    });
    expect(result.newHouseholdsPerYear).toBeCloseTo(200, 5);
    expect(result.affordableHouseholdsShare).toBe(0.45);
    expect(result.commercialVelocitySignalUnitsMonth).toBe(12);
    expect(result.housingDeficitRatio).toBeCloseTo(200 / 150, 5);
  });

  it("déficit habitacional é nulo quando não há lançamentos anuais (evita divisão por zero)", () => {
    const result = decomposeDemandSignals({
      currentHouseholds: 1_000, householdGrowthRateAnnual: 0.01, affordableHouseholdsShare: 0.3,
      competitorMonthlyVelocityUnits: 0, annualNewUnitsLaunched: 0,
    });
    expect(result.housingDeficitRatio).toBeNull();
  });
});

describe("Catálogo de Tipologias — plano 9J seção AA", () => {
  it("seleciona a tipologia correta para cada faixa de área", () => {
    expect(selectTypologyForArea(28).code).toBe("STUDIO");
    expect(selectTypologyForArea(45).code).toBe("2_DORMITORIES_COMPACT");
    expect(selectTypologyForArea(200).code).toBe("4_PLUS_DORMITORIES");
  });

  it("lança erro para código de tipologia inexistente no catálogo", () => {
    expect(() => findTypologyByCode("INEXISTENTE")).toThrow();
  });
});

describe("Similaridade e Concorrência — plano 9J seções L e V", () => {
  const weights = { distance: 0.25, productStandard: 0.25, typology: 0.2, pricePoint: 0.15, recency: 0.15 };
  const subject = { latitude: -23.5705, longitude: -46.7108, standard: "MEDIO", targetTicket: 450_000, targetAreaM2: 50, targetBedrooms: 2, asOfDate: new Date("2026-08-01") };

  it("concorrente próximo, mesmo padrão e recente produz similaridade alta", () => {
    const candidate = { latitude: -23.5710, longitude: -46.7112, standard: "MEDIO", averageTicket: 460_000, averageAreaM2: 52, bedrooms: 2, observedAt: new Date("2026-07-15") };
    const result = calculateCompetitorSimilarity(subject, candidate, weights);
    expect(result.score).toBeGreaterThan(0.7);
  });

  it("concorrente distante e padrão diferente produz similaridade baixa", () => {
    const candidate = { latitude: -23.0, longitude: -46.0, standard: "LUXO", averageTicket: 2_000_000, averageAreaM2: 180, bedrooms: 4, observedAt: new Date("2023-01-01") };
    const result = calculateCompetitorSimilarity(subject, candidate, weights);
    expect(result.score).toBeLessThan(0.3);
  });

  it("gate de concorrência marca padrões extremos como inelegíveis para comparativo direto", () => {
    const result = checkCompetitorEligibility("ECONOMICO_MCMV", "LUXO");
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("INELIGIBLE_FOR_DIRECT_BENCHMARK");
  });

  it("padrões adjacentes permanecem elegíveis", () => {
    const result = checkCompetitorEligibility("MEDIO", "MEDIO_ALTO");
    expect(result.eligible).toBe(true);
  });

  it("matching canônico exige proximidade e similaridade de nome simultaneamente", () => {
    expect(isCanonicalMatch({ distanceMeters: 30, nameSimilarity: 0.9, sameUnitsCount: true })).toBe(true);
    expect(isCanonicalMatch({ distanceMeters: 200, nameSimilarity: 0.95, sameUnitsCount: true })).toBe(false);
    expect(isCanonicalMatch({ distanceMeters: 20, nameSimilarity: 0.5, sameUnitsCount: true })).toBe(false);
  });

  it("similaridade de nome é determinística e simétrica para nomes idênticos e distintos", () => {
    expect(normalizedNameSimilarity("Residencial Vital Brasil", "Residencial Vital Brasil")).toBe(1);
    expect(normalizedNameSimilarity("Residencial Vital Brasil", "Torre Completamente Diferente")).toBeLessThan(0.5);
  });
});

describe("Nível de Confiança de Mercado — plano 9J seção W (reaproveita calculateConfidence da 9I)", () => {
  const weights = { sampleSize: 0.3, recency: 0.2, dispersion: 0.2, similarity: 0.15, provenance: 0.15 };

  it("amostra com N < 3 nunca retorna confiança HIGH — regra inviolável", () => {
    const result = calculateConfidence(
      { sampleSize: 2, minimumSampleSize: 3, averageAgeMonths: 1, coefficientOfVariation: 0.01, averageSimilarity: 0.99, provenanceScore: 1 },
      weights,
    );
    expect(result.level).toBe("LOW");
  });

  it("amostra grande, recente, coesa e de fontes confiáveis produz confiança HIGH", () => {
    const result = calculateConfidence(
      { sampleSize: 12, minimumSampleSize: 3, averageAgeMonths: 2, coefficientOfVariation: 0.05, averageSimilarity: 0.9, provenanceScore: 0.95 },
      weights,
    );
    expect(result.level).toBe("HIGH");
  });
});

describe("Solver de Mix e Cenários de Produto — plano 9J seções X, Y, Z, AH", () => {
  const solverInput = {
    maximumComputableAreaM2: 12_000,
    targetEfficiencyRate: 0.82,
    medianCompetitorPricePerSqm: 8_500,
    competitorVelocityUnitsMonth: 10,
    affordableAreaM2: 47,
  };

  it("sempre gera exatamente os 3 cenários obrigatórios (Conservador, Base, Potencial)", () => {
    const scenarios = generateProductScenarios(solverInput);
    expect(scenarios).toHaveLength(3);
    expect(scenarios.map((scenario) => scenario.kind)).toEqual(["CONSERVATIVE", "BASE", "AGGRESSIVE"]);
  });

  it("cada cenário respeita o envelope urbanístico (área privativa total dentro do orçamento computável)", () => {
    const scenarios = generateProductScenarios(solverInput);
    const areaBudget = solverInput.maximumComputableAreaM2 * solverInput.targetEfficiencyRate;
    for (const scenario of scenarios) {
      expect(scenario.totalPrivateAreaM2).toBeLessThanOrEqual(areaBudget * 1.01);
    }
  });

  it("percentuais de mix somam 100% dentro de cada cenário", () => {
    const scenarios = generateProductScenarios(solverInput);
    for (const scenario of scenarios) {
      const totalShare = scenario.mixLines.reduce((sum, line) => sum + line.mixPercentage, 0);
      expect(totalShare).toBeCloseTo(1, 1);
      const totalUnitsFromLines = scenario.mixLines.reduce((sum, line) => sum + line.unitCount, 0);
      expect(totalUnitsFromLines).toBe(scenario.totalUnits);
    }
  });

  it("cenário Potencial projeta VGV maior e velocidade menor que o Conservador (trade-off explícito)", () => {
    const [conservative, , aggressive] = generateProductScenarios(solverInput);
    expect(aggressive.targetVgv).toBeGreaterThan(conservative.targetVgv);
    expect(aggressive.expectedVelocityUnitsMonth).toBeLessThan(conservative.expectedVelocityUnitsMonth);
  });
});

describe("Recomendação de Preço — plano 9J seção AF", () => {
  it("combina as três âncoras e produz sensibilidade em 4 pontos", () => {
    const result = recommendPrice({
      competitorMedianPricePerSqm: 8_500,
      competitorP25PricePerSqm: 7_800,
      competitorP75PricePerSqm: 9_200,
      affordableTicket: 400_000,
      affordableAreaM2: 47,
      redeHistoricalPricePerSqm: 8_700,
    });
    expect(result.recommendedPricePerSqm).toBeGreaterThan(0);
    expect(result.sensitivity).toHaveLength(4);
    expect(result.sensitivity.map((point) => point.deltaPercent)).toEqual([-10, -5, 5, 10]);
  });
});

describe("Explicabilidade — plano 9J seção AJ (10 perguntas obrigatórias)", () => {
  it("responde exatamente às 10 perguntas do checklist de transparência", () => {
    const answers = buildExplainability({
      demandRationale: "x", areaRationale: "x", priceRationale: "x", mixRationale: "x",
      competitorsUsed: [{ name: "Concorrente A", similarityScore: 0.8 }],
      marketAreaLabel: "Raio de 3km", dataAsOfDate: "2026-08-24", sourcesUsed: ["IBGE"],
      sampleSize: 4, confidenceLevel: "MEDIUM", sensitivityNote: "Sensível a preço.",
    });
    expect(answers).toHaveLength(10);
    expect(answers.every((answer) => answer.answer.length > 0)).toBe(true);
  });
});

describe("Confiança de Produto — plano 9J seção AK", () => {
  it("combina confiança de mercado, precisão de zoneamento e aderência de custo quando há evidência válida", () => {
    const high = calculateProductConfidence({ marketConfidenceScore: 0.9, zoningPrecisionScore: 0.9, costAdherenceScore: 0.9 });
    expect(high.level).toBe("HIGH");
    expect(high.costEvidenceStatus).toBe("EVIDENCE_BASED");
    const low = calculateProductConfidence({ marketConfidenceScore: 0.1, zoningPrecisionScore: 0.2, costAdherenceScore: 0.1 });
    expect(low.level).toBe("LOW");
  });

  // Regra inviolável (correção pós-revisão): AUSÊNCIA DE EVIDÊNCIA DE CUSTO ≠ CONFIANÇA MÉDIA.
  it("sem evidência de custo NUNCA retorna confiança Alta, mesmo com mercado e zoneamento perfeitos", () => {
    const result = calculateProductConfidence({ marketConfidenceScore: 1, zoningPrecisionScore: 1, costAdherenceScore: null });
    expect(result.level).not.toBe("HIGH");
    expect(result.costEvidenceStatus).toBe("SEM_EVIDENCIA");
    expect(result.score).toBeLessThan(0.7);
  });

  it("sem evidência de custo nunca produz uma confiança artificialmente igual ou maior que o caso equivalente com evidência real", () => {
    const withoutEvidence = calculateProductConfidence({ marketConfidenceScore: 0.8, zoningPrecisionScore: 0.8, costAdherenceScore: null });
    // Mesmo comparando com uma evidência de custo mediana (não um placeholder inventado), o caso
    // sem evidência nunca pode superar o caso com evidência real equivalente.
    const withMedianEvidence = calculateProductConfidence({ marketConfidenceScore: 0.8, zoningPrecisionScore: 0.8, costAdherenceScore: 0.5 });
    expect(withoutEvidence.score).toBeLessThan(withMedianEvidence.score);
  });

  it("a ausência de evidência de custo aplica penalidade explícita — nunca apenas ignora a dimensão silenciosamente", () => {
    const baseAverage = (0.8 + 0.8) / 2;
    const result = calculateProductConfidence({ marketConfidenceScore: 0.8, zoningPrecisionScore: 0.8, costAdherenceScore: null });
    expect(result.score).toBeLessThan(baseAverage);
  });
});

describe("Integração com REDE Engine — plano 9J seção AO", () => {
  it("mapeia o cenário de produto para ProjectAssumptions sem duplicar o motor financeiro", () => {
    const base: ProjectAssumptions = DEMO_PROJECT;
    const mapped = mapProductScenarioToAssumptions({ totalUnits: 200, averageUnitAreaM2: 45, averageTicket: 410_000, expectedVelocityUnitsMonth: 10 }, base);
    expect(mapped.units).toBe(200);
    expect(mapped.privateAreaPerUnitM2).toBe("45.00");
    expect(mapped.unitPrice).toBe("410000.00");
    expect(mapped.salesVelocityUnitsMonth).toBe("10.00");
    expect(mapped.city).toBe(base.city); // demais premissas preservadas
  });
});
