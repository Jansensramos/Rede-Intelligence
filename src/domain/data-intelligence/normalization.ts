// Registro canônico de unidades por dimensão física. "unidade"/"unidade de serviço"/"peça" são
// contáveis (dimensão COUNT) e nunca convertem para MASS/VOLUME/AREA — evita transformar uma
// verba em quantidade física artificial (plano 9I, seção 9.1). "verba"/"vb"/"lote" recebem a
// dimensão LUMP_SUM, isolada de COUNT: são convenção de orçamento (quantidade sempre 1 por
// construção), não uma contagem real de algo — uma verba de R$ 24,5 milhões não é comparável a
// 930 "unidade de serviço" contratadas só porque ambas têm cardinalidade inteira.
export type UnitDimension = "MASS" | "VOLUME" | "AREA" | "LENGTH" | "COUNT" | "TIME" | "LUMP_SUM";

const UNIT_DIMENSION: Record<string, UnitDimension> = {
  kg: "MASS", t: "MASS", g: "MASS",
  m3: "VOLUME", "m³": "VOLUME", l: "VOLUME",
  m2: "AREA", "m²": "AREA",
  m: "LENGTH", km: "LENGTH", cm: "LENGTH",
  unidade: "COUNT", un: "COUNT", peca: "COUNT", "unidade de serviço": "COUNT",
  verba: "LUMP_SUM", vb: "LUMP_SUM", lote: "LUMP_SUM",
  hora: "TIME", h: "TIME", dia: "TIME", mes: "TIME",
};

// Fator de conversão para a unidade-base de cada dimensão (kg, m³, m², m, unidade, verba, hora).
const TO_BASE_FACTOR: Record<string, number> = {
  kg: 1, t: 1000, g: 0.001,
  m3: 1, "m³": 1, l: 0.001,
  m2: 1, "m²": 1,
  m: 1, km: 1000, cm: 0.01,
  unidade: 1, un: 1, peca: 1, "unidade de serviço": 1,
  verba: 1, vb: 1, lote: 1,
  hora: 1, h: 1, dia: 24, mes: 720,
};

export function unitDimension(unit: string): UnitDimension | null {
  return UNIT_DIMENSION[unit.trim().toLowerCase()] ?? null;
}

export interface UnitConversionResult {
  value: number;
  fromUnit: string;
  toUnit: string;
  factor: number;
  compatible: boolean;
}

// Retorna compatible=false (em vez de lançar) quando as dimensões não batem, para que o chamador
// decida excluir o dado da comparação e registrar o motivo — nunca comparar grandezas incompatíveis.
export function convertUnit(value: number, fromUnit: string, toUnit: string): UnitConversionResult {
  const from = fromUnit.trim().toLowerCase();
  const to = toUnit.trim().toLowerCase();
  if (from === to) return { value, fromUnit, toUnit, factor: 1, compatible: true };
  const fromDim = unitDimension(from);
  const toDim = unitDimension(to);
  if (!fromDim || !toDim || fromDim !== toDim) return { value: NaN, fromUnit, toUnit, factor: NaN, compatible: false };
  const factor = TO_BASE_FACTOR[from] / TO_BASE_FACTOR[to];
  return { value: value * factor, fromUnit, toUnit, factor, compatible: true };
}

export type NormalizationMethod = "NOMINAL" | "CORRECTED";

export interface IndexPoint {
  referenceDate: Date;
  value: number;
}

export interface CurrencyNormalizationInput {
  sourceAmount: number;
  sourceDate: Date;
  targetDate: Date;
  method: NormalizationMethod;
  indexSeries: IndexPoint[];
  indexName?: string;
}

export interface CurrencyNormalizationResult {
  sourceAmount: number;
  sourceDate: Date;
  targetDate: Date;
  method: NormalizationMethod;
  indexName: string | null;
  factor: number;
  normalizedAmount: number;
  memory: string;
}

function nearestIndexPoint(series: IndexPoint[], date: Date): IndexPoint | null {
  if (series.length === 0) return null;
  return series.reduce((closest, point) => {
    const closestDiff = Math.abs(closest.referenceDate.getTime() - date.getTime());
    const pointDiff = Math.abs(point.referenceDate.getTime() - date.getTime());
    return pointDiff < closestDiff ? point : closest;
  });
}

// method=NOMINAL preserva o valor original sem nenhuma correção — o nominal nunca é sobrescrito
// (plano 9I, seção 9.2 e princípio arquitetural #2). method=CORRECTED aplica o fator do índice
// mais próximo disponível na data-fonte e na data-alvo.
export function normalizeCurrency(input: CurrencyNormalizationInput): CurrencyNormalizationResult {
  if (input.method === "NOMINAL" || input.indexSeries.length === 0) {
    return {
      sourceAmount: input.sourceAmount,
      sourceDate: input.sourceDate,
      targetDate: input.targetDate,
      method: "NOMINAL",
      indexName: null,
      factor: 1,
      normalizedAmount: input.sourceAmount,
      memory: "Método NOMINAL: valor original preservado sem correção por índice.",
    };
  }
  const sourcePoint = nearestIndexPoint(input.indexSeries, input.sourceDate);
  const targetPoint = nearestIndexPoint(input.indexSeries, input.targetDate);
  if (!sourcePoint || !targetPoint || sourcePoint.value === 0) {
    return {
      sourceAmount: input.sourceAmount,
      sourceDate: input.sourceDate,
      targetDate: input.targetDate,
      method: "NOMINAL",
      indexName: input.indexName ?? null,
      factor: 1,
      normalizedAmount: input.sourceAmount,
      memory: "Sem pontos de índice suficientes para correção; valor nominal preservado.",
    };
  }
  const factor = targetPoint.value / sourcePoint.value;
  return {
    sourceAmount: input.sourceAmount,
    sourceDate: input.sourceDate,
    targetDate: input.targetDate,
    method: "CORRECTED",
    indexName: input.indexName ?? null,
    factor,
    normalizedAmount: input.sourceAmount * factor,
    memory: `Corrigido por ${input.indexName ?? "índice"}: ${sourcePoint.value} em ${sourcePoint.referenceDate.toISOString().slice(0, 10)} → ${targetPoint.value} em ${targetPoint.referenceDate.toISOString().slice(0, 10)} (fator ${factor.toFixed(6)}).`,
  };
}
