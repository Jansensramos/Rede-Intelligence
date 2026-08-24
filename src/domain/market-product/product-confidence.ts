import type { MarketConfidenceLevel } from "./types";

// Algoritmo de confiança do produto (plano 9J, seção AK) — combina a confiança dos dados de
// mercado (reaproveitando calculateConfidence da 9I), a precisão do zoneamento (Land Intelligence)
// e a aderência das premissas de custo (Auto Budget 9I).
//
// Regra inviolável (correção pós-revisão): AUSÊNCIA DE EVIDÊNCIA DE CUSTO ≠ CONFIANÇA MÉDIA. Se não
// houver proposta aprovada de Orçamento Inteligente, a dimensão de custo nunca recebe um placeholder
// numérico (ex.: 0,5) — o chamador passa `costAdherenceScore: null`, o que: (1) nunca soma um valor
// artificial à média; (2) nunca eleva a confiança global; (3) aplica uma penalidade explícita e uma
// trava rígida que impede o nível "HIGH" enquanto a dimensão de custo — sempre material para uma
// recomendação de produto — permanecer sem validação.

export type CostEvidenceStatus = "EVIDENCE_BASED" | "SEM_EVIDENCIA";

export interface ProductConfidenceInput {
  marketConfidenceScore: number; // 0..1 — vindo de calculateConfidence (9I) aplicado à amostra de mercado
  zoningPrecisionScore: number; // 0..1 — derivado de RegulatoryConfidence.score (Fase 5)
  costAdherenceScore: number | null; // 0..1 — derivado de proposta APROVADA do Auto Budget (9I); null = SEM_EVIDENCIA, nunca um placeholder
}

export interface ProductConfidenceResult {
  score: number;
  level: MarketConfidenceLevel;
  costEvidenceStatus: CostEvidenceStatus;
}

const NO_EVIDENCE_PENALTY = 0.2;
// Trava rígida: mesmo que mercado e zoneamento sejam perfeitos, a ausência de evidência de custo
// nunca permite classificar a recomendação como "HIGH" (limiar de HIGH é score >= 0.7).
const NO_EVIDENCE_CEILING = 0.69;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function calculateProductConfidence(input: ProductConfidenceInput): ProductConfidenceResult {
  const marketScore = clamp01(input.marketConfidenceScore);
  const zoningScore = clamp01(input.zoningPrecisionScore);

  if (input.costAdherenceScore === null) {
    const baseScore = (marketScore + zoningScore) / 2;
    const score = Math.max(0, Math.min(baseScore - NO_EVIDENCE_PENALTY, NO_EVIDENCE_CEILING));
    const level: MarketConfidenceLevel = score < 0.4 ? "LOW" : "MEDIUM";
    return { score, level, costEvidenceStatus: "SEM_EVIDENCIA" };
  }

  const costScore = clamp01(input.costAdherenceScore);
  const score = (marketScore + zoningScore + costScore) / 3;
  const level: MarketConfidenceLevel = score < 0.4 ? "LOW" : score < 0.7 ? "MEDIUM" : "HIGH";
  return { score, level, costEvidenceStatus: "EVIDENCE_BASED" };
}
