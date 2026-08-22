export interface HealthComponents {
  availability: number | null;
  successRate: number | null;
  latencyScore: number | null;
  freshnessScore: number | null;
  backlogScore: number | null;
}

export interface HealthScoreResult {
  score: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  components: HealthComponents;
}

const weights = { availability: 0.3, successRate: 0.3, latencyScore: 0.15, freshnessScore: 0.15, backlogScore: 0.1 } as const;

/**
 * Score técnico de integração, decomposto por componente — nunca um número opaco
 * (ver plano §31.2). Ausência de dado reduz confiança em vez de fingir saúde perfeita.
 */
export function calculateHealthScore(input: {
  availability?: number | null;
  successRate?: number | null;
  avgLatencyMs?: number | null;
  latencyBudgetMs?: number;
  freshnessSeconds?: number | null;
  freshnessBudgetSeconds?: number;
  backlogCount?: number | null;
  backlogBudget?: number;
}): HealthScoreResult {
  const latencyScore = input.avgLatencyMs == null ? null : clamp01(1 - input.avgLatencyMs / (input.latencyBudgetMs ?? 5000));
  const freshnessScore = input.freshnessSeconds == null ? null : clamp01(1 - input.freshnessSeconds / (input.freshnessBudgetSeconds ?? 86_400));
  const backlogScore = input.backlogCount == null ? null : clamp01(1 - input.backlogCount / (input.backlogBudget ?? 100));
  const components: HealthComponents = {
    availability: normalizeRatio(input.availability),
    successRate: normalizeRatio(input.successRate),
    latencyScore,
    freshnessScore,
    backlogScore,
  };
  const present = Object.entries(components).filter(([, value]) => value !== null) as Array<[keyof HealthComponents, number]>;
  if (present.length === 0) return { score: 0, confidence: "LOW", components };
  const totalWeight = present.reduce((sum, [key]) => sum + weights[key], 0);
  const score = present.reduce((sum, [key, value]) => sum + value * weights[key], 0) / totalWeight;
  const confidence = present.length === 5 ? "HIGH" : present.length >= 3 ? "MEDIUM" : "LOW";
  return { score: Math.round(clamp01(score) * 100) / 100, confidence, components };
}

function normalizeRatio(value: number | null | undefined) {
  return value == null ? null : clamp01(value);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
