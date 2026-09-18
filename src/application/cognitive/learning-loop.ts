import type {
  LearningMetric,
  LearningObservation,
  LearningReport,
} from "./types";

export function buildLearningReport(observations: readonly LearningObservation[]): LearningReport {
  const byMetric = new Map<string, LearningObservation[]>();

  for (const observation of observations) {
    const bucket = byMetric.get(observation.predicted.metric) ?? [];
    bucket.push(observation);
    byMetric.set(observation.predicted.metric, bucket);
  }

  const metrics: LearningMetric[] = [...byMetric.entries()].map(([metric, samples]) => {
    const errors = samples.map((item) => item.actual.value - item.predicted.value);
    const meanAbsoluteError = errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length;
    const meanBias = errors.reduce((sum, value) => sum + value, 0) / errors.length;

    return {
      metric,
      sampleSize: samples.length,
      meanAbsoluteError,
      meanBias,
    };
  });

  const recommendations = metrics
    .filter((metric) => metric.sampleSize >= 2 && metric.meanAbsoluteError > 0)
    .map((metric) => `Revisar premissas de ${metric.metric}; erro absoluto médio observado: ${metric.meanAbsoluteError.toFixed(2)}.`);

  return {
    metrics,
    recommendations,
    policyMutationAllowed: false,
  };
}
