import type { SensitivityAdjustment, SensitivityVariable, StressKey, VariationUnit } from "./types";

export const SENSITIVITY_CONFIG_VERSION = "REDE_SENSITIVITY_V1.0.0";

export interface SensitivityVariableConfig {
  variable: SensitivityVariable;
  label: string;
  unit: VariationUnit;
  variations: number[];
}

export const SENSITIVITY_VARIABLES: SensitivityVariableConfig[] = [
  { variable: "SALE_PRICE", label: "Preço de venda", unit: "RATE", variations: [-0.15, -0.10, -0.05, 0, 0.05, 0.10] },
  { variable: "CONSTRUCTION_COST", label: "Custo de obra", unit: "RATE", variations: [0, 0.05, 0.10, 0.15, 0.20] },
  { variable: "SALES_VELOCITY", label: "Velocidade de vendas", unit: "RATE", variations: [-0.10, -0.20, -0.30, -0.40] },
  { variable: "CONSTRUCTION_DURATION", label: "Prazo de obra", unit: "MONTHS", variations: [3, 6, 12] },
  { variable: "FINANCING_COST", label: "Custo do financiamento", unit: "PERCENTAGE_POINTS", variations: [2, 4, 6] },
  { variable: "LAND_COST", label: "Custo do terreno", unit: "RATE", variations: [0.05, 0.10, 0.20] },
  { variable: "COMMERCIAL_EXPENSES", label: "Despesas comerciais", unit: "RATE", variations: [0.10, 0.20, 0.30] },
  { variable: "SALES_START_DELAY", label: "Atraso no início das vendas", unit: "MONTHS", variations: [3, 6, 12] },
];

export interface StressDefinition {
  key: StressKey;
  label: string;
  adjustments: SensitivityAdjustment[];
}

const adjustment = (
  variable: SensitivityVariable,
  label: string,
  variation: number,
  variationUnit: VariationUnit,
): SensitivityAdjustment => ({ variable, label, variation, variationUnit });

export const STRESS_TESTS: StressDefinition[] = [
  {
    key: "MODERATE",
    label: "Stress moderado",
    adjustments: [
      adjustment("SALE_PRICE", "Preço de venda", -0.05, "RATE"),
      adjustment("CONSTRUCTION_COST", "Custo de obra", 0.05, "RATE"),
      adjustment("SALES_VELOCITY", "Velocidade de vendas", -0.15, "RATE"),
    ],
  },
  {
    key: "SEVERE",
    label: "Stress severo",
    adjustments: [
      adjustment("SALE_PRICE", "Preço de venda", -0.10, "RATE"),
      adjustment("CONSTRUCTION_COST", "Custo de obra", 0.10, "RATE"),
      adjustment("SALES_VELOCITY", "Velocidade de vendas", -0.30, "RATE"),
      adjustment("CONSTRUCTION_DURATION", "Prazo de obra", 6, "MONTHS"),
    ],
  },
  {
    key: "EXTREME",
    label: "Stress extremo",
    adjustments: [
      adjustment("SALE_PRICE", "Preço de venda", -0.15, "RATE"),
      adjustment("CONSTRUCTION_COST", "Custo de obra", 0.20, "RATE"),
      adjustment("SALES_VELOCITY", "Velocidade de vendas", -0.40, "RATE"),
      adjustment("CONSTRUCTION_DURATION", "Prazo de obra", 12, "MONTHS"),
      adjustment("FINANCING_COST", "Custo do financiamento", 4, "PERCENTAGE_POINTS"),
    ],
  },
];
