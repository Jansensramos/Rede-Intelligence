import type { AIProvider, AIProviderRequest, AIProviderResult, AIProviderStatus } from "./types";

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export class DeterministicAIProvider implements AIProvider {
  readonly name = "rede-deterministic";
  readonly defaultModel = "rede-grounded-v1";
  readonly status: AIProviderStatus = "LIMITED";

  async generateText(request: AIProviderRequest): Promise<AIProviderResult> {
    const text = request.groundedContext || "Esse dado não está disponível no estudo atual.";
    return { text, model: "rede-grounded-v1", provider: this.name, inputTokens: estimateTokens(request.userPrompt), outputTokens: estimateTokens(text), estimatedCost: 0 };
  }

  async generateStructured<T>(request: AIProviderRequest, validate: (value: unknown) => T): Promise<T> {
    return validate({ text: (await this.generateText(request)).text });
  }

  async *stream(request: AIProviderRequest): AsyncIterable<string> {
    const result = await this.generateText(request);
    for (const part of result.text.split(/(?<=\.|\n)\s+/)) yield `${part} `;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => Array.from({ length: 16 }, (_, index) => ((text.charCodeAt(index % Math.max(1, text.length)) || 0) / 255)));
  }

  async classify(text: string, labels: string[]): Promise<string> {
    const normalized = text.toLocaleLowerCase("pt-BR");
    return labels.find((label) => normalized.includes(label.toLocaleLowerCase("pt-BR"))) ?? labels[0] ?? "OTHER";
  }

  async summarize(text: string, maxCharacters = 800): Promise<string> {
    return text.length <= maxCharacters ? text : `${text.slice(0, maxCharacters - 1).trim()}…`;
  }
}

export class CompatibleHTTPAIProvider implements AIProvider {
  readonly name: string;
  readonly defaultModel: string;
  readonly status: AIProviderStatus = "AVAILABLE";
  constructor(private readonly options: { apiKey: string; baseUrl: string; model: string; name?: string; inputCostPerMillion?: number; outputCostPerMillion?: number }) { this.name = options.name ?? "compatible-http"; this.defaultModel = options.model; }

  async generateText(request: AIProviderRequest): Promise<AIProviderResult> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const selectedModel = request.model ?? this.options.model;
        const response = await fetch(this.options.baseUrl, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}` }, body: JSON.stringify({ model: selectedModel, temperature: request.temperature, max_tokens: request.maxTokens, messages: [{ role: "system", content: request.systemPrompt }, { role: "user", content: `${request.userPrompt}\n\nCONTEXTO ESTRUTURADO CONFIÁVEL:\n${request.groundedContext}` }] }), signal: AbortSignal.timeout(45_000) });
        if (!response.ok) {
          const error = new Error(`AI_PROVIDER_HTTP_${response.status}`);
          if (response.status !== 429 && response.status < 500) throw error;
          lastError = error;
          continue;
        }
        const data = await response.json() as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        const text = data.choices?.[0]?.message?.content?.trim();
        if (!text) throw new Error("AI_PROVIDER_EMPTY_RESPONSE");
        const inputTokens = data.usage?.prompt_tokens ?? estimateTokens(request.userPrompt + request.groundedContext);
        const outputTokens = data.usage?.completion_tokens ?? estimateTokens(text);
        const estimatedCost = (inputTokens * (this.options.inputCostPerMillion ?? 0) + outputTokens * (this.options.outputCostPerMillion ?? 0)) / 1_000_000;
        return { text, model: selectedModel, provider: this.name, inputTokens, outputTokens, estimatedCost };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("AI_PROVIDER_FAILURE");
        if (!/timeout|fetch|AI_PROVIDER_HTTP_(429|5\d\d)/i.test(lastError.message)) throw lastError;
      }
    }
    throw lastError ?? new Error("AI_PROVIDER_FAILURE");
  }

  async generateStructured<T>(request: AIProviderRequest, validate: (value: unknown) => T): Promise<T> {
    const result = await this.generateText({ ...request, systemPrompt: `${request.systemPrompt}\nResponda somente com JSON válido.` });
    return validate(JSON.parse(result.text));
  }
  async *stream(request: AIProviderRequest): AsyncIterable<string> { yield (await this.generateText(request)).text; }
  async embed(): Promise<number[][]> { throw new Error("AI_PROVIDER_EMBED_NOT_CONFIGURED"); }
  async classify(text: string, labels: string[]): Promise<string> { return (await this.generateText({ task: "EXTRACTION", systemPrompt: `Classifique em: ${labels.join(", ")}. Responda só o rótulo.`, userPrompt: text, groundedContext: "", maxTokens: 20, temperature: 0 })).text; }
  async summarize(text: string, maxCharacters = 800): Promise<string> { return (await this.generateText({ task: "SYNTHESIS", systemPrompt: `Resuma em até ${maxCharacters} caracteres sem inventar fatos.`, userPrompt: text, groundedContext: "", maxTokens: Math.ceil(maxCharacters / 3), temperature: 0 })).text; }
}

export function createAIProvider(): AIProvider {
  const apiKey = process.env.AI_PROVIDER_API_KEY?.trim();
  const baseUrl = process.env.AI_PROVIDER_BASE_URL?.trim();
  const model = process.env.AI_DEFAULT_MODEL?.trim();
  if (apiKey && baseUrl && model) return new CompatibleHTTPAIProvider({ apiKey, baseUrl, model, name: process.env.AI_PROVIDER_NAME, inputCostPerMillion: Number(process.env.AI_INPUT_COST_PER_MILLION ?? 0), outputCostPerMillion: Number(process.env.AI_OUTPUT_COST_PER_MILLION ?? 0) });
  return new DeterministicAIProvider();
}
