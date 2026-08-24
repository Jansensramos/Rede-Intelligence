export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Interpolação linear (método comum em planilhas/estatística descritiva), não "nearest rank".
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function coefficientOfVariation(values: number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  return standardDeviation(values) / Math.abs(m);
}

export interface OutlierFlag {
  index: number;
  value: number;
  method: "IQR" | "MAD";
  score: number;
}

// IQR: sinaliza pontos fora de [Q1 - k*IQR, Q3 + k*IQR]. k=1.5 é o padrão de boxplot.
export function detectOutliersIqr(values: number[], k = 1.5): OutlierFlag[] {
  if (values.length < 4) return [];
  const q1 = percentile(values, 25);
  const q3 = percentile(values, 75);
  const iqr = q3 - q1;
  const lower = q1 - k * iqr;
  const upper = q3 + k * iqr;
  const flags: OutlierFlag[] = [];
  values.forEach((value, index) => {
    if (value < lower || value > upper) {
      const distance = value < lower ? lower - value : value - upper;
      flags.push({ index, value, method: "IQR", score: iqr === 0 ? Number.POSITIVE_INFINITY : distance / iqr });
    }
  });
  return flags;
}

// MAD (median absolute deviation) com z-score modificado — mais robusto que IQR para amostras
// pequenas ou muito assimétricas. Threshold 3.5 segue Iglewicz & Hoaglin (1993).
export function detectOutliersMad(values: number[], threshold = 3.5): OutlierFlag[] {
  if (values.length < 3) return [];
  const med = median(values);
  const deviations = values.map((v) => Math.abs(v - med));
  const mad = median(deviations);
  if (mad === 0) return [];
  const flags: OutlierFlag[] = [];
  values.forEach((value, index) => {
    const modifiedZ = (0.6745 * (value - med)) / mad;
    if (Math.abs(modifiedZ) > threshold) flags.push({ index, value, method: "MAD", score: Math.abs(modifiedZ) });
  });
  return flags;
}

export interface DistributionSummary {
  sampleSize: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
  stdDev: number;
  coefficientOfVariation: number;
  min: number;
  max: number;
}

export function summarizeDistribution(values: number[]): DistributionSummary {
  return {
    sampleSize: values.length,
    mean: mean(values),
    median: median(values),
    p25: percentile(values, 25),
    p75: percentile(values, 75),
    stdDev: standardDeviation(values),
    coefficientOfVariation: coefficientOfVariation(values),
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
  };
}
