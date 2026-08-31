import type { AIProvider } from "@/domain/ai/types";
import { CompatibleHTTPAIProvider, DeterministicAIProvider } from "@/domain/ai/provider";

/** Composition root: somente infraestrutura lê configuração operacional. */
export function createAIProvider(environment: Record<string, string | undefined> = process.env): AIProvider {
  const apiKey = environment.AI_PROVIDER_API_KEY?.trim();
  const baseUrl = environment.AI_PROVIDER_BASE_URL?.trim();
  const model = environment.AI_DEFAULT_MODEL?.trim();
  if (apiKey && baseUrl && model) return new CompatibleHTTPAIProvider({ apiKey, baseUrl, model, name: environment.AI_PROVIDER_NAME, inputCostPerMillion: Number(environment.AI_INPUT_COST_PER_MILLION ?? 0), outputCostPerMillion: Number(environment.AI_OUTPUT_COST_PER_MILLION ?? 0) });
  return new DeterministicAIProvider();
}
