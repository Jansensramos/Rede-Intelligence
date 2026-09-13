import { describe, expect, it, vi } from "vitest";
import type { DnsRecord, DnsResolver } from "@/infrastructure/observability/alert-dispatcher";
import { assertSafeAiProviderEndpoint, performSafeAiHttpRequest, resolveSafeAiProviderAddress, type AiHttpRequester } from "./safe-transport";

const ALLOWED = new Set(["api.provider.test"]);

function fakeResolver(records: DnsRecord[] | Error): DnsResolver {
  return vi.fn(async () => { if (records instanceof Error) throw records; return records; });
}
function fakeRequester(response: { statusCode: number; headers?: Record<string, string>; body?: string } | Error): AiHttpRequester {
  return vi.fn(async () => { if (response instanceof Error) throw response; return { headers: {}, body: "", ...response }; });
}

describe("assertSafeAiProviderEndpoint — camada 1 (literal da URL)", () => {
  it("aceita https com host na allowlist exata", () => {
    expect(() => assertSafeAiProviderEndpoint("https://api.provider.test/v1/chat", ALLOWED)).not.toThrow();
  });

  it("recusa http (nao https)", () => {
    expect(() => assertSafeAiProviderEndpoint("http://api.provider.test/v1/chat", ALLOWED)).toThrow();
  });

  it("recusa userinfo embutido na URL", () => {
    expect(() => assertSafeAiProviderEndpoint("https://user:pass@api.provider.test/v1/chat", ALLOWED)).toThrow();
  });

  it("recusa porta alternativa", () => {
    expect(() => assertSafeAiProviderEndpoint("https://api.provider.test:8443/v1/chat", ALLOWED)).toThrow();
  });

  it("recusa fragmento", () => {
    expect(() => assertSafeAiProviderEndpoint("https://api.provider.test/v1/chat#frag", ALLOWED)).toThrow();
  });

  it("recusa host fora da allowlist exata (sem sufixo/prefixo)", () => {
    expect(() => assertSafeAiProviderEndpoint("https://evil-api.provider.test/v1/chat", ALLOWED)).toThrow();
    expect(() => assertSafeAiProviderEndpoint("https://api.provider.test.evil.com/v1/chat", ALLOWED)).toThrow();
  });

  it("recusa host literal loopback/privado mesmo se (hipoteticamente) estivesse na allowlist", () => {
    const allowLoopback = new Set(["127.0.0.1", "169.254.169.254", "10.0.0.5"]);
    expect(() => assertSafeAiProviderEndpoint("https://127.0.0.1/v1", allowLoopback)).toThrow();
    expect(() => assertSafeAiProviderEndpoint("https://169.254.169.254/v1", allowLoopback)).toThrow(); // metadados de nuvem
    expect(() => assertSafeAiProviderEndpoint("https://10.0.0.5/v1", allowLoopback)).toThrow();
  });

  it("recusa IPv4-mapeado-em-IPv6 apontando para loopback/metadados", () => {
    const allow = new Set(["[::ffff:127.0.0.1]", "[::ffff:169.254.169.254]"]);
    expect(() => assertSafeAiProviderEndpoint("https://[::ffff:127.0.0.1]/v1", allow)).toThrow();
    expect(() => assertSafeAiProviderEndpoint("https://[::ffff:169.254.169.254]/v1", allow)).toThrow();
  });

  it("recusa URL invalida", () => {
    expect(() => assertSafeAiProviderEndpoint("not a url", ALLOWED)).toThrow();
  });
});

describe("resolveSafeAiProviderAddress — camada 2 (DNS rebinding)", () => {
  it("aceita IPv4 publico resolvido", async () => {
    const resolved = await resolveSafeAiProviderAddress("api.provider.test", fakeResolver([{ address: "93.184.216.34", family: 4 }]));
    expect(resolved.address).toBe("93.184.216.34");
  });

  it("recusa quando o DNS resolve para um IP privado (rebinding)", async () => {
    await expect(resolveSafeAiProviderAddress("api.provider.test", fakeResolver([{ address: "10.0.0.1", family: 4 }]))).rejects.toThrow();
  });

  it("recusa quando o DNS resolve para loopback", async () => {
    await expect(resolveSafeAiProviderAddress("api.provider.test", fakeResolver([{ address: "127.0.0.1", family: 4 }]))).rejects.toThrow();
  });

  it("recusa quando o DNS resolve para metadados de nuvem (169.254.169.254)", async () => {
    await expect(resolveSafeAiProviderAddress("api.provider.test", fakeResolver([{ address: "169.254.169.254", family: 4 }]))).rejects.toThrow();
  });

  it("recusa quando nao ha nenhum registro", async () => {
    await expect(resolveSafeAiProviderAddress("api.provider.test", fakeResolver([]))).rejects.toThrow();
  });

  it("recusa quando o resolver falha (fail-closed, nunca segue sem endereco validado)", async () => {
    await expect(resolveSafeAiProviderAddress("api.provider.test", fakeResolver(new Error("DNS down")))).rejects.toThrow();
  });

  it("recusa IPv6 link-local (fe80::)", async () => {
    await expect(resolveSafeAiProviderAddress("api.provider.test", fakeResolver([{ address: "fe80::1", family: 6 }]))).rejects.toThrow();
  });
});

describe("performSafeAiHttpRequest — integracao camadas + limite de corpo", () => {
  it("conecta no endereco resolvido, nao no hostname (pinning) e preserva servername para SNI", async () => {
    const requester = fakeRequester({ statusCode: 200, body: "{}" });
    await performSafeAiHttpRequest({
      url: new URL("https://api.provider.test/v1/chat"),
      method: "POST",
      headers: { authorization: "Bearer test" },
      body: "{}",
      timeoutMs: 1000,
      resolver: fakeResolver([{ address: "93.184.216.34", family: 4 }]),
      requester,
    });
    expect(requester).toHaveBeenCalledWith(expect.objectContaining({ connectAddress: "93.184.216.34", servername: "api.provider.test" }));
  });

  it("propaga falha de resolucao sem nunca chamar o requester (nenhuma rede real quando o host e inseguro)", async () => {
    const requester = fakeRequester({ statusCode: 200 });
    await expect(performSafeAiHttpRequest({
      url: new URL("https://api.provider.test/v1/chat"),
      method: "POST",
      headers: {},
      body: "{}",
      timeoutMs: 1000,
      resolver: fakeResolver([{ address: "127.0.0.1", family: 4 }]),
      requester,
    })).rejects.toThrow();
    expect(requester).not.toHaveBeenCalled();
  });

  it("classifica falha HTTP/timeout do requester como ProductionDependencyError, nunca crua", async () => {
    const requester = fakeRequester(Object.assign(new Error("boom"), { name: "AbortError" }));
    await expect(performSafeAiHttpRequest({
      url: new URL("https://api.provider.test/v1/chat"),
      method: "POST",
      headers: {},
      body: "{}",
      timeoutMs: 1000,
      resolver: fakeResolver([{ address: "93.184.216.34", family: 4 }]),
      requester,
    })).rejects.toMatchObject({ name: "ProductionDependencyError", kind: "TIMEOUT" });
  });
});
