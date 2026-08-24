export * from "./capabilities";
export * from "./statistics";
export * from "./normalization";
export * from "./comparability";
export * from "./confidence";
export * from "./forecast-accuracy";
export * from "./auto-budget";

// Versão do motor determinístico da 9I — toda métrica/benchmark/avaliação persiste este valor
// (ou o valor vigente no momento do cálculo) para reprodutibilidade (plano 9I, seção 52).
export const DATA_INTELLIGENCE_ENGINE_VERSION = "9i-engine-1.0.0";
