import Decimal from "decimal.js";
import type { ProjectAssumptions, ScenarioDefinition, ScenarioKey } from "./types";

export const SCENARIOS: Record<ScenarioKey, ScenarioDefinition> = {
  conservative: {
    key: "conservative",
    label: "Conservador",
    description: "Pressiona preço, custo, prazo e absorção simultaneamente.",
    changes: ["Venda -8%", "Obra +10%", "Vendas -25%", "Aprovação +3 meses", "Juros +2 p.p."],
  },
  base: {
    key: "base",
    label: "Base",
    description: "Premissas informadas pelo responsável do empreendimento.",
    changes: ["Sem ajustes"],
  },
  aggressive: {
    key: "aggressive",
    label: "Agressivo",
    description: "Testa execução acima do caso base sem alterar o produto.",
    changes: ["Venda +5%", "Obra -4%", "Vendas +20%", "Aprovação -1 mês", "Juros -1 p.p."],
  },
};

function multiply(value: string, multiplier: string): string {
  return new Decimal(value).times(multiplier).toFixed(8);
}

function add(value: string, delta: string): string {
  return Decimal.max(0, new Decimal(value).plus(delta)).toFixed(8);
}

export function applyScenario(input: ProjectAssumptions, scenario: ScenarioKey): ProjectAssumptions {
  if (scenario === "base") return structuredClone(input);
  if (scenario === "conservative") {
    return {
      ...structuredClone(input),
      unitPrice: multiply(input.unitPrice, "0.92"),
      constructionCostPerM2: multiply(input.constructionCostPerM2, "1.10"),
      salesVelocityUnitsMonth: multiply(input.salesVelocityUnitsMonth, "0.75"),
      approvalMonths: input.approvalMonths + 3,
      annualFinancingRate: add(input.annualFinancingRate, "2"),
    };
  }
  return {
    ...structuredClone(input),
    unitPrice: multiply(input.unitPrice, "1.05"),
    constructionCostPerM2: multiply(input.constructionCostPerM2, "0.96"),
    salesVelocityUnitsMonth: multiply(input.salesVelocityUnitsMonth, "1.20"),
    approvalMonths: Math.max(0, input.approvalMonths - 1),
    annualFinancingRate: add(input.annualFinancingRate, "-1"),
  };
}
