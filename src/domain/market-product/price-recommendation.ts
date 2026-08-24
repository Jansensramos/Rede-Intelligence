// Metodologia de formação de preço recomendado (plano 9J, seção AF) — três âncoras
// determinísticas, nunca uma opinião isolada: mediana dos concorrentes, ticket suportável local e
// histórico de preço real do REDE (quando disponível).

export interface PriceRecommendationInput {
  competitorMedianPricePerSqm: number;
  competitorP25PricePerSqm: number;
  competitorP75PricePerSqm: number;
  affordableTicket: number;
  affordableAreaM2: number;
  redeHistoricalPricePerSqm: number | null;
}

export interface PriceSensitivityPoint {
  deltaPercent: number;
  pricePerSqm: number;
}

export interface PriceRecommendationResult {
  recommendedPricePerSqm: number;
  rangeP25PricePerSqm: number;
  rangeP75PricePerSqm: number;
  sensitivity: PriceSensitivityPoint[];
  rationale: string;
}

export function recommendPrice(input: PriceRecommendationInput): PriceRecommendationResult {
  const affordabilityAnchor = input.affordableAreaM2 > 0 ? input.affordableTicket / input.affordableAreaM2 : input.competitorMedianPricePerSqm;
  const historicalAnchor = input.redeHistoricalPricePerSqm ?? input.competitorMedianPricePerSqm;
  const anchors = [input.competitorMedianPricePerSqm, affordabilityAnchor, historicalAnchor];
  const recommendedPricePerSqm = anchors.reduce((sum, value) => sum + value, 0) / anchors.length;

  const sensitivity = [-10, -5, 5, 10].map((deltaPercent) => ({
    deltaPercent,
    pricePerSqm: Math.round(recommendedPricePerSqm * (1 + deltaPercent / 100) * 100) / 100,
  }));

  return {
    recommendedPricePerSqm: Math.round(recommendedPricePerSqm * 100) / 100,
    rangeP25PricePerSqm: input.competitorP25PricePerSqm,
    rangeP75PricePerSqm: input.competitorP75PricePerSqm,
    sensitivity,
    rationale: `Média de 3 âncoras: mediana dos concorrentes elegíveis (R$ ${input.competitorMedianPricePerSqm.toFixed(2)}/m²), ticket suportável local (R$ ${affordabilityAnchor.toFixed(2)}/m²) e histórico REDE (R$ ${historicalAnchor.toFixed(2)}/m²).`,
  };
}
