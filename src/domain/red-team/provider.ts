import type { ZodType } from "zod";

export interface StructuredGenerationRequest<T> {
  system: string;
  evidence: string;
  schemaName: string;
  schema: ZodType<T>;
  repair?: boolean;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface StructuredGenerationResponse {
  data: unknown;
  usage?: ProviderUsage;
}

export interface LLMProvider {
  readonly configured: boolean;
  readonly name: string;
  readonly model: string | null;
  generateStructured<T>(request: StructuredGenerationRequest<T>): Promise<StructuredGenerationResponse>;
}

export class ProviderUnavailableError extends Error {
  constructor() {
    super("Red Team AI não configurado.");
    this.name = "ProviderUnavailableError";
  }
}

export function createDisabledProvider(): LLMProvider {
  return {
    configured: false,
    name: "disabled",
    model: null,
    async generateStructured() {
      throw new ProviderUnavailableError();
    },
  };
}
