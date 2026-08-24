import type { ConfidenceLevel } from "./confidence";

// Fundação do Orçamento Inteligente (plano 9I, seção 30/36-38 do prompt). Produz SUGESTÃO, nunca
// base aprovada — a saída sempre exige revisão humana (AutoBudgetProposal.status começa DRAFT).

export interface AutoBudgetSuggestionInput {
  quantity: number;
  benchmarkMedian: number;
  benchmarkP25: number;
  benchmarkP75: number;
  confidenceLevel: ConfidenceLevel;
  sampleSize: number;
  sampleProjectNames: string[];
  unit: string;
}

export interface AutoBudgetSuggestionResult {
  suggestedUnitCost: number;
  suggestedTotalCost: number;
  rangeLow: number;
  rangeHigh: number;
  confidenceLevel: ConfidenceLevel;
  rationale: string;
  exceptions: string[];
}

// Usa a mediana do benchmark como sugestão central (mais robusta que a média a outliers) e o
// intervalo P25–P75 como faixa. Nunca decide sozinho: rationale sempre nomeia amostra e critérios.
export function suggestUnitCost(input: AutoBudgetSuggestionInput): AutoBudgetSuggestionResult {
  const exceptions: string[] = [];
  if (input.sampleSize < 3) exceptions.push(`Amostra pequena (${input.sampleSize} projeto(s) comparável(is)) — sugestão apenas referencial.`);
  if (input.confidenceLevel === "LOW") exceptions.push("Nível de confiança baixo — revisão especializada obrigatória antes de qualquer uso.");

  const suggestedUnitCost = input.benchmarkMedian;
  const suggestedTotalCost = suggestedUnitCost * input.quantity;
  const rangeLow = input.benchmarkP25 * input.quantity;
  const rangeHigh = input.benchmarkP75 * input.quantity;

  const projectList = input.sampleProjectNames.length > 0 ? input.sampleProjectNames.join(", ") : "nenhum projeto comparável identificado";
  const rationale = `Mediana de ${input.sampleSize} observação(ões) comparável(is) (${projectList}) para ${input.unit}: R$ ${suggestedUnitCost.toFixed(2)}/${input.unit}. Faixa P25–P75: R$ ${input.benchmarkP25.toFixed(2)} a R$ ${input.benchmarkP75.toFixed(2)}. Confiança: ${input.confidenceLevel}.`;

  return { suggestedUnitCost, suggestedTotalCost, rangeLow, rangeHigh, confidenceLevel: input.confidenceLevel, rationale, exceptions };
}
