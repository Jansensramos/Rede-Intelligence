// Gate de comparabilidade (plano 9I, seção 18.1) e motor de similaridade (18.2).
// Nada é comparado antes de passar pelo eligibility gate; a similaridade só decompõe QUÃO
// parecidos são os elegíveis, nunca decide sozinha se algo entra na amostra.

export interface ComparableContext {
  currency: string;
  unit: string;
  region: string | null;
  economicStage: string | null;
  productStandard: string | null;
  projectId: string;
  asOfDate: Date;
}

export interface EligibilityRules {
  requireSameCurrency: boolean;
  requireCompatibleUnit: boolean;
  requireSameEconomicStageOrLater: boolean;
  maxAgeMonths: number | null;
  allowedRegions: string[] | null;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

export function checkEligibility(subject: ComparableContext, candidate: ComparableContext, rules: EligibilityRules): EligibilityResult {
  const reasons: string[] = [];
  if (rules.requireSameCurrency && subject.currency !== candidate.currency) {
    reasons.push(`Moeda incompatível (${candidate.currency} ≠ ${subject.currency}).`);
  }
  if (rules.maxAgeMonths != null) {
    const ageMonths = (subject.asOfDate.getTime() - candidate.asOfDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (ageMonths > rules.maxAgeMonths) reasons.push(`Observação com ${Math.round(ageMonths)} meses, acima do limite de ${rules.maxAgeMonths} meses.`);
  }
  if (rules.allowedRegions && rules.allowedRegions.length > 0 && candidate.region && !rules.allowedRegions.includes(candidate.region)) {
    reasons.push(`Região "${candidate.region}" fora do filtro permitido.`);
  }
  return { eligible: reasons.length === 0, reasons };
}

export interface SimilarityWeights {
  region: number;
  economicStage: number;
  productStandard: number;
  recency: number;
}

export interface SimilarityFactor {
  key: string;
  weight: number;
  match: number; // 0..1
  contribution: number;
  note: string;
}

export interface SimilarityResult {
  score: number; // 0..1, soma ponderada dos fatores
  factors: SimilarityFactor[];
}

// Cada fator contribui score_i * weight_i; o total é normalizado pela soma dos pesos, então pesos
// não precisam somar 1. Todo fator aparece no resultado — inclusive os que reduziram a
// similaridade — para que a UI explique o que aproximou e o que afastou os casos.
export function calculateSimilarity(subject: ComparableContext, candidate: ComparableContext, weights: SimilarityWeights): SimilarityResult {
  const factors: SimilarityFactor[] = [];

  const regionMatch = subject.region && candidate.region ? (subject.region === candidate.region ? 1 : 0) : 0.5;
  factors.push({ key: "region", weight: weights.region, match: regionMatch, contribution: regionMatch * weights.region, note: subject.region === candidate.region ? "Mesma região." : "Região diferente ou desconhecida." });

  const stageMatch = subject.economicStage && candidate.economicStage ? (subject.economicStage === candidate.economicStage ? 1 : 0.4) : 0.5;
  factors.push({ key: "economicStage", weight: weights.economicStage, match: stageMatch, contribution: stageMatch * weights.economicStage, note: subject.economicStage === candidate.economicStage ? "Mesmo estágio econômico." : "Estágio econômico diferente." });

  const standardMatch = subject.productStandard && candidate.productStandard ? (subject.productStandard === candidate.productStandard ? 1 : 0.3) : 0.5;
  factors.push({ key: "productStandard", weight: weights.productStandard, match: standardMatch, contribution: standardMatch * weights.productStandard, note: subject.productStandard === candidate.productStandard ? "Mesmo padrão/produto." : "Padrão/produto diferente." });

  const ageMonths = Math.abs(subject.asOfDate.getTime() - candidate.asOfDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
  const recencyMatch = Math.max(0, 1 - ageMonths / 24);
  factors.push({ key: "recency", weight: weights.recency, match: recencyMatch, contribution: recencyMatch * weights.recency, note: `${ageMonths.toFixed(1)} meses de diferença.` });

  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  const score = totalWeight === 0 ? 0 : factors.reduce((sum, f) => sum + f.contribution, 0) / totalWeight;
  return { score: Math.max(0, Math.min(1, score)), factors };
}
