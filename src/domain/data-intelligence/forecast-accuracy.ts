// Engine determinístico de precisão de previsão (plano 9I, seção 24). Nunca reescreve a
// previsão original — apenas avalia o erro contra o realizado, preservando os dois fatos.

export type ForecastBias = "OPTIMISTIC" | "PESSIMISTIC" | "NEUTRAL";

export interface ForecastEvaluationInput {
  predictedValue: number;
  actualValue: number;
  /** Tolerância relativa dentro da qual o viés é considerado neutro (padrão 2%). */
  neutralToleranceRate?: number;
}

export interface ForecastEvaluationResult {
  absoluteError: number;
  /** null quando o valor previsto é zero — divisão por zero nunca é calculada silenciosamente. */
  percentError: number | null;
  bias: ForecastBias;
}

export function evaluateForecastAccuracy(input: ForecastEvaluationInput): ForecastEvaluationResult {
  const tolerance = input.neutralToleranceRate ?? 0.02;
  const absoluteError = input.actualValue - input.predictedValue;
  const percentError = input.predictedValue === 0 ? null : absoluteError / Math.abs(input.predictedValue);
  let bias: ForecastBias = "NEUTRAL";
  if (percentError != null) {
    if (percentError > tolerance) bias = "PESSIMISTIC"; // previu menos do que aconteceu (subestimou custo/prazo)
    else if (percentError < -tolerance) bias = "OPTIMISTIC"; // previu mais do que aconteceu (superestimou)
  }
  return { absoluteError: Math.abs(absoluteError), percentError, bias };
}

export interface ForecastSeriesPoint {
  bias: ForecastBias;
  percentError: number | null;
}

export interface BiasSummary {
  count: number;
  optimisticCount: number;
  pessimisticCount: number;
  neutralCount: number;
  averagePercentError: number | null;
  dominantBias: ForecastBias | null;
}

// Resume um conjunto de avaliações para responder "sempre subestimamos custo?" de forma factual,
// sem acusação — apenas contagem e média (plano 9I, seção 33).
export function summarizeBias(points: ForecastSeriesPoint[]): BiasSummary {
  const withError = points.filter((p) => p.percentError != null) as { bias: ForecastBias; percentError: number }[];
  const optimisticCount = points.filter((p) => p.bias === "OPTIMISTIC").length;
  const pessimisticCount = points.filter((p) => p.bias === "PESSIMISTIC").length;
  const neutralCount = points.filter((p) => p.bias === "NEUTRAL").length;
  const averagePercentError = withError.length === 0 ? null : withError.reduce((sum, p) => sum + p.percentError, 0) / withError.length;
  let dominantBias: ForecastBias | null = null;
  if (points.length > 0) {
    if (optimisticCount > pessimisticCount && optimisticCount > neutralCount) dominantBias = "OPTIMISTIC";
    else if (pessimisticCount > optimisticCount && pessimisticCount > neutralCount) dominantBias = "PESSIMISTIC";
    else dominantBias = "NEUTRAL";
  }
  return { count: points.length, optimisticCount, pessimisticCount, neutralCount, averagePercentError, dominantBias };
}
