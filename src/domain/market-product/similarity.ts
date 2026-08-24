// Comparabilidade e similaridade de concorrentes (plano 9J, seção L e V) — mesma disciplina de
// decomposição em fatores explicáveis usada em src/domain/data-intelligence/comparability.ts.
// Concorrência não é apenas proximidade: dois empreendimentos a 200m podem não ser concorrentes
// se um for MCMV Econômico e o outro Alto Padrão de 200 m².

import { haversineDistanceMeters } from "./geography";
import type { GeoPoint, MarketSimilarityWeights } from "./types";

const STANDARD_ORDER = ["ECONOMICO_MCMV", "MEDIO_BAIXO", "MEDIO", "MEDIO_ALTO", "ALTO", "LUXO"] as const;

function standardMatchScore(subjectStandard: string, candidateStandard: string): number {
  const indexA = STANDARD_ORDER.indexOf(subjectStandard as (typeof STANDARD_ORDER)[number]);
  const indexB = STANDARD_ORDER.indexOf(candidateStandard as (typeof STANDARD_ORDER)[number]);
  if (indexA === -1 || indexB === -1) return 0.5;
  const distance = Math.abs(indexA - indexB);
  if (distance === 0) return 1;
  if (distance === 1) return 0.3;
  return 0;
}

export interface CompetitorSubject extends GeoPoint {
  standard: string;
  targetTicket: number;
  targetAreaM2: number;
  targetBedrooms: number;
  asOfDate: Date;
}

export interface CompetitorCandidate extends GeoPoint {
  standard: string;
  averageTicket: number;
  averageAreaM2: number;
  bedrooms: number;
  observedAt: Date;
}

export interface SimilarityFactor {
  key: string;
  weight: number;
  score: number;
  contribution: number;
  note: string;
}

export interface CompetitorSimilarityResult {
  score: number;
  distanceMeters: number;
  factors: SimilarityFactor[];
}

export function calculateCompetitorSimilarity(subject: CompetitorSubject, candidate: CompetitorCandidate, weights: MarketSimilarityWeights): CompetitorSimilarityResult {
  const distanceMeters = haversineDistanceMeters(subject, candidate);
  // 1.0 para <=500m, decaimento linear até 0 em 5km (plano 9J, seção L.1).
  const distanceScore = distanceMeters <= 500 ? 1 : Math.max(0, 1 - (distanceMeters - 500) / 4500);
  const standardScore = standardMatchScore(subject.standard, candidate.standard);
  const areaRatio = candidate.averageAreaM2 > 0
    ? Math.min(subject.targetAreaM2, candidate.averageAreaM2) / Math.max(subject.targetAreaM2, candidate.averageAreaM2)
    : 0;
  const bedroomScore = Math.max(0, 1 - Math.abs(subject.targetBedrooms - candidate.bedrooms) * 0.35);
  const typologyScore = (areaRatio + bedroomScore) / 2;
  const priceRatio = candidate.averageTicket > 0
    ? Math.min(subject.targetTicket, candidate.averageTicket) / Math.max(subject.targetTicket, candidate.averageTicket)
    : 0;
  const ageMonths = Math.abs(subject.asOfDate.getTime() - candidate.observedAt.getTime()) / (1000 * 60 * 60 * 24 * 30);
  const recencyScore = Math.max(0, 1 - ageMonths / 24);

  const factors: SimilarityFactor[] = [
    { key: "distance", weight: weights.distance, score: distanceScore, contribution: 0, note: `${Math.round(distanceMeters)} m de distância do terreno.` },
    { key: "productStandard", weight: weights.productStandard, score: standardScore, contribution: 0, note: standardScore === 1 ? "Mesmo padrão construtivo." : "Padrão construtivo diferente." },
    { key: "typology", weight: weights.typology, score: typologyScore, contribution: 0, note: `Área média de ${candidate.averageAreaM2.toFixed(0)} m², ${candidate.bedrooms} dormitório(s).` },
    { key: "pricePoint", weight: weights.pricePoint, score: priceRatio, contribution: 0, note: "Relação entre o ticket do concorrente e o ticket alvo do estudo." },
    { key: "recency", weight: weights.recency, score: recencyScore, contribution: 0, note: `${ageMonths.toFixed(1)} meses desde a observação.` },
  ].map((factor) => ({ ...factor, contribution: factor.score * factor.weight }));

  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const score = totalWeight === 0 ? 0 : factors.reduce((sum, factor) => sum + factor.contribution, 0) / totalWeight;

  return { score: Math.max(0, Math.min(1, score)), distanceMeters, factors };
}

export interface CompetitorEligibilityResult {
  eligible: boolean;
  reason: string | null;
}

// Gate de concorrência (plano 9J, seção L.1): padrões muito distantes na escala nunca entram no
// comparativo direto, mesmo que geograficamente próximos.
export function checkCompetitorEligibility(subjectStandard: string, candidateStandard: string): CompetitorEligibilityResult {
  const indexA = STANDARD_ORDER.indexOf(subjectStandard as (typeof STANDARD_ORDER)[number]);
  const indexB = STANDARD_ORDER.indexOf(candidateStandard as (typeof STANDARD_ORDER)[number]);
  if (indexA === -1 || indexB === -1) return { eligible: true, reason: null };
  const incompatible = Math.abs(indexA - indexB) >= 3;
  return { eligible: !incompatible, reason: incompatible ? "INELIGIBLE_FOR_DIRECT_BENCHMARK: padrão construtivo incompatível com o produto em estudo." : null };
}

// Matching canônico de concorrentes vindos de fontes distintas (plano 9J, seção BB.1).
export interface CanonicalMatchInput {
  distanceMeters: number;
  nameSimilarity: number; // 0..1 — Levenshtein normalizado ou equivalente
  sameUnitsCount: boolean;
}

export function isCanonicalMatch(input: CanonicalMatchInput): boolean {
  return input.distanceMeters <= 50 && input.nameSimilarity >= 0.85;
}

// Similaridade fonética simplificada e determinística (Levenshtein normalizado) para
// deduplicação de nomes de empreendimentos vindos de fontes distintas.
export function normalizedNameSimilarity(a: string, b: string): number {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (left === right) return 1;
  if (left.length === 0 || right.length === 0) return 0;

  const rows = left.length + 1;
  const cols = right.length + 1;
  const distances: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) distances[i][0] = i;
  for (let j = 0; j < cols; j += 1) distances[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      distances[i][j] = Math.min(distances[i - 1][j] + 1, distances[i][j - 1] + 1, distances[i - 1][j - 1] + cost);
    }
  }
  const editDistance = distances[rows - 1][cols - 1];
  const maxLength = Math.max(left.length, right.length);
  return Math.max(0, 1 - editDistance / maxLength);
}
