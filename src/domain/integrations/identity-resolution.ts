/**
 * Resolução de identidade em camadas (ver plano 9H §14):
 * 1. ExternalEntityReference exata (feita no serviço, via constraint única);
 * 2. identificador legal/canônico validado (ex.: CNPJ) — `resolveByCanonicalIdentifier`;
 * 3+ regra composta/candidatos com score/revisão humana ficam para adapters futuros.
 * Nunca cria duplicata: quando nada resolve, o chamador decide criar ou revisar.
 */
const onlyDigits = (value: string) => value.replace(/\D/g, "");

export function resolveByCanonicalIdentifier<T>(
  candidates: T[],
  extractIdentifier: (candidate: T) => string | null | undefined,
  externalIdentifier: string | null | undefined,
): T | null {
  if (!externalIdentifier) return null;
  const normalizedExternal = onlyDigits(externalIdentifier);
  if (!normalizedExternal) return null;
  return candidates.find((candidate) => {
    const value = extractIdentifier(candidate);
    return Boolean(value) && onlyDigits(value!) === normalizedExternal;
  }) ?? null;
}

export interface IdentityCandidateScore {
  entityId: string;
  score: number;
  matchedFields: string[];
}

/**
 * Score explicável e determinístico (0..1) para candidatos compostos. Não cria merge
 * automático: o chamador deve exigir score acima de um limiar E revisão humana antes
 * de qualquer vínculo definitivo, salvo quando a política explicitamente permitir.
 */
export function scoreIdentityCandidates(
  external: Record<string, unknown>,
  candidates: Array<{ entityId: string; fields: Record<string, unknown> }>,
  weightedFields: Array<{ field: string; weight: number }>,
): IdentityCandidateScore[] {
  const totalWeight = weightedFields.reduce((sum, item) => sum + item.weight, 0) || 1;
  return candidates
    .map((candidate) => {
      const matchedFields: string[] = [];
      let score = 0;
      for (const { field, weight } of weightedFields) {
        const externalValue = external[field];
        const candidateValue = candidate.fields[field];
        if (externalValue !== undefined && candidateValue !== undefined && String(externalValue).trim().toLowerCase() === String(candidateValue).trim().toLowerCase()) {
          score += weight;
          matchedFields.push(field);
        }
      }
      return { entityId: candidate.entityId, score: score / totalWeight, matchedFields };
    })
    .sort((a, b) => b.score - a.score);
}
