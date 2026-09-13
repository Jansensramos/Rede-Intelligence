import { describe, expect, it, vi } from "vitest";
import type { DnsRecord, DnsResolver } from "@/infrastructure/observability/alert-dispatcher";
import { CompatibleHttpAiProviderAdapter } from "./compatible-http-adapter";
import type { AiHttpRequester, AiHttpResponseLike } from "./safe-transport";
import { SYNTHETIC_MODEL_CATALOG } from "./model-catalog";
import type { AiRequest } from "@/domain/ai-gateway";

const PROFILE = SYNTHETIC_MODEL_CATALOG.get("synthetic-compatible-http-test")!;

function fakeResolver(): DnsResolver {
  return vi.fn(async (): Promise<DnsRecord[]> => [{ address: "93.184.216.34", family: 4 }]);
}
function fakeRequester(response: AiHttpResponseLike | Error): AiHttpRequester {
  return vi.fn(async () => { if (response instanceof Error) throw response; return response; });
}
function baseRequest(overrides: Partial<AiRequest> = {}): AiRequest {
  return {
    correlationId: "corr-1", organizationId: "org-1", actorRef: "user-1", task: "CHAT",
    requiredCapabilities: ["TEXT_GENERATION"], dataClassification: "INTERNAL", criticality: "STANDARD",
    content: { systemInstructions: "sys", trustedContext: "ctx", untrustedUserContent: "pergunta" },
    ...overrides,
  };
}
function jsonResponse(body: unknown, statusCode = 200): AiHttpResponseLike {
  return { statusCode, headers: {}, body: JSON.stringify(body) };
}

describe("CompatibleHttpAiProviderAdapter — sem rede real (transporte injetado)", () => {
  it("envia headers de autenticacao e nunca coloca a chave na URL/corpo/log", async () => {
    const requester = fakeRequester(jsonResponse({ choices: [{ message: { content: "ola" } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }));
    const adapter = new CompatibleHttpAiProviderAdapter({ providerRef: "synthetic-compatible-http-test", baseUrl: new URL("https://api.provider.test/v1/chat"), apiKey: "SECRET_KEY_XYZ", model: "test-model", resolver: fakeResolver(), requester }, PROFILE);
    await adapter.execute(baseRequest(), new AbortController().signal);
    const call = (requester as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.headers.authorization).toBe("Bearer SECRET_KEY_XYZ");
    expect(call.path).not.toContain("SECRET_KEY_XYZ");
    expect(call.body).not.toContain("SECRET_KEY_XYZ");
  });

  it("classifica 401 como falha permanente (AUTHENTICATION)", async () => {
    const adapter = new CompatibleHttpAiProviderAdapter({ providerRef: "synthetic-compatible-http-test", baseUrl: new URL("https://api.provider.test/v1/chat"), apiKey: "k", model: "m", resolver: fakeResolver(), requester: fakeRequester({ statusCode: 401, headers: {}, body: "" }) }, PROFILE);
    await expect(adapter.execute(baseRequest(), new AbortController().signal)).rejects.toMatchObject({ code: "AUTHENTICATION", retryable: false });
  });

  it("classifica 403 como AUTHORIZATION permanente", async () => {
    const adapter = new CompatibleHttpAiProviderAdapter({ providerRef: "synthetic-compatible-http-test", baseUrl: new URL("https://api.provider.test/v1/chat"), apiKey: "k", model: "m", resolver: fakeResolver(), requester: fakeRequester({ statusCode: 403, headers: {}, body: "" }) }, PROFILE);
    await expect(adapter.execute(baseRequest(), new AbortController().signal)).rejects.toMatchObject({ code: "AUTHORIZATION", retryable: false });
  });

  it("classifica 429 como PROVIDER_UNAVAILABLE retryable", async () => {
    const adapter = new CompatibleHttpAiProviderAdapter({ providerRef: "synthetic-compatible-http-test", baseUrl: new URL("https://api.provider.test/v1/chat"), apiKey: "k", model: "m", resolver: fakeResolver(), requester: fakeRequester({ statusCode: 429, headers: {}, body: "" }) }, PROFILE);
    await expect(adapter.execute(baseRequest(), new AbortController().signal)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
  });

  it("classifica 500 como PROVIDER_UNAVAILABLE retryable", async () => {
    const adapter = new CompatibleHttpAiProviderAdapter({ providerRef: "synthetic-compatible-http-test", baseUrl: new URL("https://api.provider.test/v1/chat"), apiKey: "k", model: "m", resolver: fakeResolver(), requester: fakeRequester({ statusCode: 500, headers: {}, body: "" }) }, PROFILE);
    await expect(adapter.execute(baseRequest(), new AbortController().signal)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
  });

  it("trata 3xx como falha (nunca segue redirect)", async () => {
    const adapter = new CompatibleHttpAiProviderAdapter({ providerRef: "synthetic-compatible-http-test", baseUrl: new URL("https://api.provider.test/v1/chat"), apiKey: "k", model: "m", resolver: fakeResolver(), requester: fakeRequester({ statusCode: 302, headers: { location: "https://evil.test" }, body: "" }) }, PROFILE);
    await expect(adapter.execute(baseRequest(), new AbortController().signal)).rejects.toBeDefined();
  });

  it("recusa executar se o signal ja estiver abortado antes do envio", async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = new CompatibleHttpAiProviderAdapter({ providerRef: "synthetic-compatible-http-test", baseUrl: new URL("https://api.provider.test/v1/chat"), apiKey: "k", model: "m", resolver: fakeResolver(), requester: fakeRequester({ statusCode: 200, headers: {}, body: "{}" }) }, PROFILE);
    await expect(adapter.execute(baseRequest(), controller.signal)).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("resposta que nao e JSON valido vira INVALID_RESPONSE", async () => {
    const adapter = new CompatibleHttpAiProviderAdapter({ providerRef: "synthetic-compatible-http-test", baseUrl: new URL("https://api.provider.test/v1/chat"), apiKey: "k", model: "m", resolver: fakeResolver(), requester: fakeRequester({ statusCode: 200, headers: {}, body: "isto nao e JSON" }) }, PROFILE);
    await expect(adapter.execute(baseRequest(), new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("resposta sem conteudo (choices vazio) vira INVALID_RESPONSE", async () => {
    const adapter = new CompatibleHttpAiProviderAdapter({ providerRef: "synthetic-compatible-http-test", baseUrl: new URL("https://api.provider.test/v1/chat"), apiKey: "k", model: "m", resolver: fakeResolver(), requester: fakeRequester(jsonResponse({ choices: [] })) }, PROFILE);
    await expect(adapter.execute(baseRequest(), new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("saida estruturada malformada (nao e JSON) vira INVALID_RESPONSE, nunca reparada silenciosamente", async () => {
    const adapter = new CompatibleHttpAiProviderAdapter({ providerRef: "synthetic-compatible-http-test", baseUrl: new URL("https://api.provider.test/v1/chat"), apiKey: "k", model: "m", resolver: fakeResolver(), requester: fakeRequester(jsonResponse({ choices: [{ message: { content: "isto nao e json" } }] })) }, PROFILE);
    await expect(adapter.execute(baseRequest({ outputSchema: { name: "gateway.synthetic.text_summary", version: "1" } }), new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("saida estruturada valida passa e retorna dado tipado + schemaVersion", async () => {
    const adapter = new CompatibleHttpAiProviderAdapter({ providerRef: "synthetic-compatible-http-test", baseUrl: new URL("https://api.provider.test/v1/chat"), apiKey: "k", model: "m", resolver: fakeResolver(), requester: fakeRequester(jsonResponse({ choices: [{ message: { content: JSON.stringify({ summary: "resumo ok", confidence: "HIGH" }) } }] })) }, PROFILE);
    const response = await adapter.execute(baseRequest({ outputSchema: { name: "gateway.synthetic.text_summary", version: "1" } }), new AbortController().signal);
    expect(response.content).toEqual({ summary: "resumo ok", confidence: "HIGH" });
    expect(response.schemaVersion).toBe("gateway.synthetic.text_summary@1");
  });

  it("calcula uso/custo a partir do usage retornado pelo provider", async () => {
    const adapter = new CompatibleHttpAiProviderAdapter({ providerRef: "synthetic-compatible-http-test", baseUrl: new URL("https://api.provider.test/v1/chat"), apiKey: "k", model: "m", resolver: fakeResolver(), requester: fakeRequester(jsonResponse({ choices: [{ message: { content: "ola" } }], usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 } })) }, PROFILE);
    const response = await adapter.execute(baseRequest(), new AbortController().signal);
    expect(response.usage.inputUnits).toBe(1_000_000);
    expect(response.usage.outputUnits).toBe(1_000_000);
    expect(response.usage.estimatedCostUsdMicros).toBe(500_000 + 1_500_000);
  });

  describe("correção focal — validação explícita de header/token (achado MÉDIO)", () => {
    it.each([
      ["string vazia", ""],
      ["só espaços", "   "],
      ["espaço inicial/final", " k "],
      ["CR/LF", "abc\r\ndef"],
      ["NUL", `abc${String.fromCharCode(0)}def`],
      ["DEL", `abc${String.fromCharCode(127)}def`],
      ["controle", `abc${String.fromCharCode(7)}def`],
      ["tab", "abc\tdef"],
      ["Unicode bidi (RTL override)", "abc‮def"],
      ["Unicode zero-width", "abc​def"],
      ["emoji", "abc🔑def"],
      ["homoglyph (Cirílico 'а' parecido com 'a' latino)", "abcаdef"],
      ["objeto hostil", { toString: () => "k" } as unknown as string],
      ["array hostil", ["k"] as unknown as string],
      ["Proxy hostil", new Proxy({}, { get: () => "k" }) as unknown as string],
      ["número", 12345 as unknown as string],
      ["muito longa (4097 chars)", "a".repeat(4097)],
    ])("apiKey = %s -> AiGatewayError classificado ANTES do DNS/transporte; resolver e requester nunca chamados", async (_label, hostileKey) => {
      const resolver = fakeResolver();
      const requester = fakeRequester(jsonResponse({ choices: [{ message: { content: "ola" } }] }));
      const adapter = new CompatibleHttpAiProviderAdapter({ providerRef: "synthetic-compatible-http-test", baseUrl: new URL("https://api.provider.test/v1/chat"), apiKey: hostileKey, model: "m", resolver, requester }, PROFILE);
      await expect(adapter.execute(baseRequest(), new AbortController().signal)).rejects.toMatchObject({ code: "CONFIGURATION" });
      expect(resolver).not.toHaveBeenCalled();
      expect(requester).not.toHaveBeenCalled();
    });

    it("apiKey válida no formato ainda passa normalmente", async () => {
      const adapter = new CompatibleHttpAiProviderAdapter({ providerRef: "synthetic-compatible-http-test", baseUrl: new URL("https://api.provider.test/v1/chat"), apiKey: "sk-valid-token-123", model: "m", resolver: fakeResolver(), requester: fakeRequester(jsonResponse({ choices: [{ message: { content: "ola" } }] })) }, PROFILE);
      const response = await adapter.execute(baseRequest(), new AbortController().signal);
      expect(response.status).toBe("OK");
    });
  });
});
