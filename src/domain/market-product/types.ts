// Contratos de domínio da Fase 9J — Inteligência de Mercado e Inteligência de Produto.
// Puro TypeScript, sem dependência de Prisma (mesma disciplina de src/domain/land/types.ts).

export type MarketAreaType = "RADIUS" | "NEIGHBORHOOD" | "MUNICIPALITY" | "CUSTOM_POLYGON" | "ISOCHRONE";
export type MarketDevelopmentStage = "BREVE_LANCAMENTO" | "LANCAMENTO" | "EM_OBRAS" | "PRONTO_NOVO" | "PRONTO_USADO";
export type MarketProductStandard = "ECONOMICO_MCMV" | "MEDIO_BAIXO" | "MEDIO" | "MEDIO_ALTO" | "ALTO" | "LUXO";
export type MarketPriceType = "LIST_PRICE" | "ADVERTISED" | "NEGOTIATED" | "TRANSACTED_REGISTRY" | "REDE_ACTUAL_SALE";
export type ProductScenarioKind = "CONSERVATIVE" | "BASE" | "AGGRESSIVE" | "CUSTOM";
export type ProductLifecycleStatus = "DRAFT" | "UNDER_REVIEW" | "RECOMMENDED" | "APPROVED" | "REJECTED" | "SUPERSEDED";
export type MarketPositioning = "ECONOMICO_MCMV" | "MEDIO_PADRAO" | "MEDIO_ALTO" | "ALTO_PADRAO" | "COMPACTO_INVESTIDOR";
export type MarketConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

// Rastreabilidade completa de cada fato externo (plano 9J, seção R). "DEMO_SYNTHETIC" e
// "INTERNAL_DEMO_DATA" existem exclusivamente para marcar dado sintético de demonstração (ex.:
// seed START BUTANTÃ) — nunca podem ser confundidos com um método/licença de coleta real, já que
// ainda não existe nenhum conector real 9H para IBGE/Prospecta/portais de mercado.
export interface MarketProvenanceMetadata {
  sourceProvider: string;
  sourceUrl?: string;
  collectedAt: string;
  referenceDate: string;
  collectionMethod: "API" | "STRUCTURED_IMPORT" | "MANUAL_FIELD_SURVEY" | "INFERRED_MODEL" | "DEMO_SYNTHETIC";
  confidenceLevel: MarketConfidenceLevel;
  dataLicense: "PUBLIC_DOMAIN" | "COMMERCIAL_INTERNAL_USE" | "PROPRIETARY" | "INTERNAL_DEMO_DATA";
  evidenceChecksum: string;
  isDemo?: boolean;
}

export interface MarketSimilarityWeights {
  distance: number;
  productStandard: number;
  typology: number;
  pricePoint: number;
  recency: number;
}
