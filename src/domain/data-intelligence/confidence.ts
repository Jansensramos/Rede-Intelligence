// Confidence score de benchmark (plano 9I, seção 19.1). Decomposto e versionado por política —
// nunca um número mágico sem memória. Uma única observação nunca produz confiança alta, por mais
// exata que pareça (caso crítico: "compra única barata").

export interface ConfidenceWeights {
  sampleSize: number;
  recency: number;
  dispersion: number;
  similarity: number;
  provenance: number;
}

export interface ConfidenceInput {
  sampleSize: number;
  minimumSampleSize: number;
  averageAgeMonths: number;
  coefficientOfVariation: number;
  averageSimilarity: number; // 0..1
  provenanceScore: number; // 0..1 — qualidade/formalidade média das fontes
}

export interface ConfidenceFactor {
  key: string;
  weight: number;
  score: number; // 0..1
  contribution: number;
  note: string;
}

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export interface ConfidenceResult {
  level: ConfidenceLevel;
  score: number; // 0..1
  factors: ConfidenceFactor[];
}

function sampleSizeScore(n: number, minimum: number): number {
  if (n < minimum) return 0;
  // satura em 1.0 a partir de 3x o mínimo — amostra grande não compensa infinitamente outros defeitos.
  return Math.max(0, Math.min(1, n / (minimum * 3)));
}

function recencyScore(ageMonths: number): number {
  return Math.max(0, Math.min(1, 1 - ageMonths / 36));
}

function dispersionScore(cv: number): number {
  // CV=0 -> 1.0 (nenhuma dispersão); CV>=1 (100% de variação) -> 0.
  return Math.max(0, Math.min(1, 1 - cv));
}

export function calculateConfidence(input: ConfidenceInput, weights: ConfidenceWeights): ConfidenceResult {
  const factors: ConfidenceFactor[] = [
    { key: "sampleSize", weight: weights.sampleSize, score: sampleSizeScore(input.sampleSize, input.minimumSampleSize), contribution: 0, note: `Amostra de ${input.sampleSize} (mínimo configurado: ${input.minimumSampleSize}).` },
    { key: "recency", weight: weights.recency, score: recencyScore(input.averageAgeMonths), contribution: 0, note: `Idade média de ${input.averageAgeMonths.toFixed(1)} meses.` },
    { key: "dispersion", weight: weights.dispersion, score: dispersionScore(input.coefficientOfVariation), contribution: 0, note: `Coeficiente de variação de ${(input.coefficientOfVariation * 100).toFixed(1)}%.` },
    { key: "similarity", weight: weights.similarity, score: Math.max(0, Math.min(1, input.averageSimilarity)), contribution: 0, note: `Similaridade média de ${(input.averageSimilarity * 100).toFixed(1)}%.` },
    { key: "provenance", weight: weights.provenance, score: Math.max(0, Math.min(1, input.provenanceScore)), contribution: 0, note: `Proveniência média de ${(input.provenanceScore * 100).toFixed(1)}%.` },
  ].map((f) => ({ ...f, contribution: f.score * f.weight }));

  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  const score = totalWeight === 0 ? 0 : factors.reduce((sum, f) => sum + f.contribution, 0) / totalWeight;

  // Amostra abaixo do mínimo configurado nunca produz confiança alta, mesmo que os demais fatores
  // sejam perfeitos — corta o nível independentemente da média ponderada.
  const belowMinimum = input.sampleSize < input.minimumSampleSize;
  let level: ConfidenceLevel;
  if (belowMinimum || score < 0.4) level = "LOW";
  else if (score < 0.7) level = "MEDIUM";
  else level = "HIGH";

  return { level, score: Math.max(0, Math.min(1, score)), factors };
}
