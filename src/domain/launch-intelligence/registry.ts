export type LaunchRegistryValueType = "RATE" | "MONEY" | "NUMBER" | "MONTHS" | "PERCENTAGE";

export interface LaunchRegistryEntry {
  key: string;
  label: string;
  type: LaunchRegistryValueType;
  unit: string;
  origin: "MACRO" | "MARKET" | "VIABILITY" | "ENGINEERING" | "CAPITAL";
  triggerEligible: boolean;
  critical?: boolean;
}

export const MACRO_INDICATOR_REGISTRY = {
  SELIC: { key: "SELIC", label: "Selic", type: "RATE", unit: "% a.a.", origin: "MACRO", triggerEligible: true, critical: true },
  IPCA: { key: "IPCA", label: "IPCA", type: "RATE", unit: "% a.a.", origin: "MACRO", triggerEligible: true },
  INCC: { key: "INCC", label: "INCC", type: "RATE", unit: "% a.a.", origin: "MACRO", triggerEligible: true, critical: true },
  CUB: { key: "CUB", label: "CUB", type: "MONEY", unit: "R$/m²", origin: "MACRO", triggerEligible: true },
  SINAPI: { key: "SINAPI", label: "SINAPI", type: "MONEY", unit: "R$/m²", origin: "MACRO", triggerEligible: true },
  IGPM: { key: "IGPM", label: "IGP-M", type: "RATE", unit: "% a.a.", origin: "MACRO", triggerEligible: true },
  CAMBIO_BRL_USD: { key: "CAMBIO_BRL_USD", label: "Câmbio real/dólar", type: "NUMBER", unit: "R$/US$", origin: "MACRO", triggerEligible: true },
  PIB: { key: "PIB", label: "PIB", type: "RATE", unit: "% a.a.", origin: "MACRO", triggerEligible: true },
  DESEMPREGO: { key: "DESEMPREGO", label: "Desemprego", type: "RATE", unit: "%", origin: "MACRO", triggerEligible: true },
  RENDA_DOMICILIAR: { key: "RENDA_DOMICILIAR", label: "Renda domiciliar", type: "MONEY", unit: "R$/mês", origin: "MACRO", triggerEligible: true },
  CONFIANCA_MERCADO: { key: "CONFIANCA_MERCADO", label: "Confiança do mercado", type: "NUMBER", unit: "pontos", origin: "MACRO", triggerEligible: true },
  TAXA_FINANCIAMENTO: { key: "TAXA_FINANCIAMENTO", label: "Taxa média de financiamento", type: "RATE", unit: "% a.a.", origin: "MACRO", triggerEligible: true, critical: true },
  CREDITO_IMOBILIARIO: { key: "CREDITO_IMOBILIARIO", label: "Crédito imobiliário", type: "MONEY", unit: "R$", origin: "MACRO", triggerEligible: true },
  SBPE: { key: "SBPE", label: "SBPE", type: "MONEY", unit: "R$", origin: "MACRO", triggerEligible: true },
  FGTS: { key: "FGTS", label: "FGTS", type: "MONEY", unit: "R$", origin: "MACRO", triggerEligible: true },
  SPREAD_FUNDING: { key: "SPREAD_FUNDING", label: "Spread de funding", type: "RATE", unit: "% a.a.", origin: "MACRO", triggerEligible: true },
} as const satisfies Record<string, LaunchRegistryEntry>;

export const LAUNCH_METRIC_REGISTRY = {
  ...MACRO_INDICATOR_REGISTRY,
  VSO: { key: "VSO", label: "VSO", type: "PERCENTAGE", unit: "%", origin: "MARKET", triggerEligible: true, critical: true },
  ESTOQUE_MESES: { key: "ESTOQUE_MESES", label: "Meses de estoque", type: "MONTHS", unit: "meses", origin: "MARKET", triggerEligible: true },
  PRECO_M2: { key: "PRECO_M2", label: "Preço por m²", type: "MONEY", unit: "R$/m²", origin: "MARKET", triggerEligible: true },
  AFFORDABILITY_RATIO: { key: "AFFORDABILITY_RATIO", label: "Compatibilidade do ticket com a renda", type: "PERCENTAGE", unit: "%", origin: "MARKET", triggerEligible: true, critical: true },
  MARGEM_VGV: { key: "MARGEM_VGV", label: "Margem sobre VGV", type: "PERCENTAGE", unit: "%", origin: "VIABILITY", triggerEligible: true, critical: true },
  NECESSIDADE_CAPITAL: { key: "NECESSIDADE_CAPITAL", label: "Necessidade de capital", type: "MONEY", unit: "R$", origin: "CAPITAL", triggerEligible: true },
  DSCR: { key: "DSCR", label: "DSCR", type: "NUMBER", unit: "x", origin: "CAPITAL", triggerEligible: true },
  CUSTO_CONSTRUCAO_M2: { key: "CUSTO_CONSTRUCAO_M2", label: "Custo de construção", type: "MONEY", unit: "R$/m²", origin: "ENGINEERING", triggerEligible: true },
} as const satisfies Record<string, LaunchRegistryEntry>;

export const LAUNCH_ASSUMPTION_REGISTRY = {
  TAXA_FINANCIAMENTO: LAUNCH_METRIC_REGISTRY.TAXA_FINANCIAMENTO,
  INFLACAO_CONSTRUCAO: { key: "INFLACAO_CONSTRUCAO", label: "Inflação de construção", type: "RATE", unit: "%", origin: "ENGINEERING", triggerEligible: false },
  PRECO_M2: LAUNCH_METRIC_REGISTRY.PRECO_M2,
  VSO: LAUNCH_METRIC_REGISTRY.VSO,
  VELOCIDADE_VENDAS: { key: "VELOCIDADE_VENDAS", label: "Velocidade de vendas", type: "NUMBER", unit: "unidades/mês", origin: "VIABILITY", triggerEligible: false },
  PRAZO_VENDAS: { key: "PRAZO_VENDAS", label: "Prazo de vendas", type: "MONTHS", unit: "meses", origin: "VIABILITY", triggerEligible: false },
  CUSTO_CONSTRUCAO_M2: LAUNCH_METRIC_REGISTRY.CUSTO_CONSTRUCAO_M2,
  TAXA_FUNDING: { key: "TAXA_FUNDING", label: "Taxa de funding", type: "RATE", unit: "% a.a.", origin: "CAPITAL", triggerEligible: false },
  ATRASO_LANCAMENTO: { key: "ATRASO_LANCAMENTO", label: "Atraso do lançamento", type: "MONTHS", unit: "meses", origin: "VIABILITY", triggerEligible: false },
} as const satisfies Record<string, LaunchRegistryEntry>;

export type MacroIndicatorCode = keyof typeof MACRO_INDICATOR_REGISTRY;
export type LaunchMetricKey = keyof typeof LAUNCH_METRIC_REGISTRY;
export type LaunchAssumptionKey = keyof typeof LAUNCH_ASSUMPTION_REGISTRY;

export function macroIndicator(code: string) {
  return MACRO_INDICATOR_REGISTRY[code as MacroIndicatorCode] ?? null;
}

export function launchMetric(key: string) {
  return LAUNCH_METRIC_REGISTRY[key as LaunchMetricKey] ?? null;
}

export function launchAssumption(key: string) {
  return LAUNCH_ASSUMPTION_REGISTRY[key as LaunchAssumptionKey] ?? null;
}
