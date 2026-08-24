export * from "./types";
export * from "./capabilities";
export * from "./geography";
export * from "./affordability";
export * from "./demand";
export * from "./typologies";
export * from "./similarity";
export * from "./mix-solver";
export * from "./price-recommendation";
export * from "./explainability";
export * from "./product-confidence";
export * from "./engine-mapping";
export * from "./schemas";

// Versão do motor determinístico da 9J — toda métrica/cenário/decisão persiste este valor (ou o
// valor vigente no momento do cálculo) para reprodutibilidade em auditorias futuras.
export const MARKET_PRODUCT_ENGINE_VERSION = "9j-engine-1.0.0";
