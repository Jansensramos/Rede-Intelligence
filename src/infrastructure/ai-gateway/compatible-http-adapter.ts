import type { DnsResolver } from "@/infrastructure/observability/alert-dispatcher";
import { AiGatewayError, classifyTransportFailureAsGatewayError, isSafeHeaderValue, renderEnvelope, validateStructuredOutput, type AiModelProfile, type AiProviderAdapter, type AiRequest, type AiResponse } from "@/domain/ai-gateway";
import { performSafeAiHttpRequest, type AiHttpRequester } from "./safe-transport";
import { SYNTHETIC_PRICE_TABLE } from "./model-catalog";

/**
 * Unica implementacao de transporte HTTP real desta rodada (docs Fase 10A §14). Nunca
 * instanciada por servicos de dominio/aplicacao - so o AiGateway a constroi, e so quando
 * `AI_GATEWAY_PROVIDER_MODE=compatible_http` (sempre "disabled" em producao - ver
 * runtime-config.ts). Substitui o `CompatibleHTTPAIProvider` legado (src/domain/ai/provider.ts),
 * que usa `fetch()` sem allowlist de host nem proteção de DNS rebinding e por isso nao e
 * mais chamado por nenhum caminho novo - ele permanece no repositorio só como referencia
 * ja documentada como legada (ver docs/PHASE_10A_AUDIT_RECORD.md).
 */
export interface CompatibleHttpAdapterOptions {
  providerRef: string;
  baseUrl: URL;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  resolver?: DnsResolver;
  requester?: AiHttpRequester;
}

interface CompatibleHttpResponseBody {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class CompatibleHttpAiProviderAdapter implements AiProviderAdapter {
  readonly ref: string;
  constructor(private readonly options: CompatibleHttpAdapterOptions, readonly profile: AiModelProfile) {
    this.ref = options.providerRef;
  }

  async execute(request: AiRequest, signal: AbortSignal): Promise<AiResponse> {
    if (signal.aborted) throw new AiGatewayError("Chamada abortada antes do envio.", "TIMEOUT", true, request.correlationId);
    // Correcao focal pos-auditoria (achado MEDIO "header validation implicita"): validado
    // explicitamente ANTES do DNS/transporte - nunca depende so do https.request nativo
    // para rejeitar CR/LF/NUL/controle/objeto hostil na chave.
    if (!isSafeHeaderValue(this.options.apiKey)) {
      throw new AiGatewayError("Credencial do provider de IA fora do formato seguro de header.", "CONFIGURATION", false, request.correlationId);
    }
    const envelope = renderEnvelope(request.content);
    const body = JSON.stringify({
      model: this.options.model,
      messages: [{ role: "system", content: envelope.system }, { role: "user", content: envelope.user }],
      ...(request.outputSchema ? { response_format: { type: "json_object" } } : {}),
    });
    const startedAt = Date.now();
    let response;
    try {
      response = await performSafeAiHttpRequest({
        url: this.options.baseUrl,
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}` },
        body,
        timeoutMs: this.options.timeoutMs ?? 45_000,
        resolver: this.options.resolver,
        requester: this.options.requester,
      });
    } catch (error) {
      throw classifyTransportFailureAsGatewayError(error, request.correlationId);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw classifyTransportFailureAsGatewayError(Object.assign(new Error(`AI_PROVIDER_HTTP_${response.statusCode}`), { statusCode: response.statusCode }), request.correlationId);
    }
    let parsed: CompatibleHttpResponseBody;
    try { parsed = JSON.parse(response.body) as CompatibleHttpResponseBody; }
    catch { throw new AiGatewayError("Resposta do provider nao e JSON valido.", "INVALID_RESPONSE", false, request.correlationId); }
    const text = parsed.choices?.[0]?.message?.content?.trim();
    if (!text) throw new AiGatewayError("Resposta do provider nao contem conteudo.", "INVALID_RESPONSE", false, request.correlationId);

    let content: unknown = text;
    let schemaVersion: string | undefined;
    if (request.outputSchema) {
      let rawJson: unknown;
      try { rawJson = JSON.parse(text); }
      catch { throw new AiGatewayError("Saida estruturada nao e JSON valido.", "INVALID_RESPONSE", false, request.correlationId); }
      const validated = validateStructuredOutput(request.outputSchema, rawJson);
      if (!validated.ok) throw new AiGatewayError(`Saida estruturada invalida: ${validated.reason}.`, "INVALID_RESPONSE", false, request.correlationId);
      content = validated.data;
      schemaVersion = `${request.outputSchema.name}@${request.outputSchema.version}`;
    }

    const inputUnits = parsed.usage?.prompt_tokens ?? Math.ceil((envelope.system.length + envelope.user.length) / 4);
    const outputUnits = parsed.usage?.completion_tokens ?? Math.ceil(text.length / 4);
    const price = SYNTHETIC_PRICE_TABLE[this.ref] ?? { inputUsdMicrosPerMillion: 0, outputUsdMicrosPerMillion: 0 };
    const estimatedCostUsdMicros = Math.round((inputUnits * price.inputUsdMicrosPerMillion + outputUnits * price.outputUsdMicrosPerMillion) / 1_000_000);

    return {
      correlationId: request.correlationId,
      status: "OK",
      content,
      evidenceRefs: [],
      usage: { inputUnits, outputUnits, estimatedCostUsdMicros, latencyMs: Date.now() - startedAt },
      routing: { provider: this.ref, model: this.options.model, fallbackCount: 0, retryCount: 0 },
      policyVersion: "",
      promptVersion: "",
      schemaVersion,
    };
  }
}
