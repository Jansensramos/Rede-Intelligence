import type { AiModelProfile } from "@/domain/ai-gateway";

/**
 * Catalogo sintetico (decisao 5: "precos reais permanecem ausentes; testes usam
 * catalogo sintetico"). O unico provider realmente ativo nesta rodada e "disabled"
 * (decisao 1/2) - este catalogo existe só para exercitar roteamento/orcamento em
 * testes com transporte injetado, nunca para chamar um provider comercial real.
 */
export const AI_PRICE_CATALOG_VERSION_SYNTHETIC = "SYNTHETIC_TEST_CATALOG_V1";

export const DISABLED_PROVIDER_REF = "disabled";

export const SYNTHETIC_MODEL_CATALOG: ReadonlyMap<string, AiModelProfile> = new Map([
  [
    DISABLED_PROVIDER_REF,
    {
      provider: DISABLED_PROVIDER_REF,
      modelRef: "disabled",
      capabilities: [],
      contextWindowTokens: 0,
      maxOutputTokens: 0,
      supportsJsonSchema: false,
      safetyTier: "RESTRICTED",
      retentionPolicy: "NONE",
    } satisfies AiModelProfile,
  ],
  [
    "synthetic-compatible-http-test",
    {
      provider: "synthetic-compatible-http-test",
      modelRef: "synthetic-model",
      capabilities: ["TEXT_GENERATION", "STRUCTURED_OUTPUT"],
      contextWindowTokens: 32_000,
      maxOutputTokens: 2_000,
      supportsJsonSchema: true,
      safetyTier: "STANDARD",
      dataResidency: "TEST_ONLY",
      retentionPolicy: "ZERO_RETENTION_CONFIRMED",
    } satisfies AiModelProfile,
  ],
]);

/** Precos sinteticos por milhao de unidades, em micro-USD (1 USD = 1_000_000). Nunca reais. */
export const SYNTHETIC_PRICE_TABLE: Readonly<Record<string, { inputUsdMicrosPerMillion: number; outputUsdMicrosPerMillion: number }>> = {
  [DISABLED_PROVIDER_REF]: { inputUsdMicrosPerMillion: 0, outputUsdMicrosPerMillion: 0 },
  "synthetic-compatible-http-test": { inputUsdMicrosPerMillion: 500_000, outputUsdMicrosPerMillion: 1_500_000 },
};
