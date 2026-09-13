import { describe, expect, it } from "vitest";
import type { RuntimeConfig } from "@/infrastructure/config/runtime-config";
import { buildAiProviderAdapter, aiGatewayProviderStatus } from "./config";
import { DisabledAiProviderAdapter } from "./disabled-provider-adapter";
import { CompatibleHttpAiProviderAdapter } from "./compatible-http-adapter";

function baseConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    NODE_ENV: "test", DATABASE_URL: "postgresql://db/test", SESSION_COOKIE_NAME: "rede", TRUSTED_PROXY_HOPS: 0,
    STORAGE_PROVIDER: "local", STORAGE_FORCE_PATH_STYLE: "false", STORAGE_SIGNED_URL_TTL_SECONDS: 300,
    MALWARE_SCANNER_PROVIDER: "noop", SECRET_PROVIDER: "environment", KMS_PROVIDER: "local",
    ALERTING_PROVIDER: "local", WORKER_CONCURRENCY: 1, WORKER_POLL_MS: 100, WORKER_LEASE_MS: 5000, WORKER_JOB_TIMEOUT_MS: 1000,
    AI_GATEWAY_PROVIDER_MODE: "disabled",
    ...overrides,
  } as RuntimeConfig;
}

describe("buildAiProviderAdapter", () => {
  it("modo disabled sempre retorna o adapter seguro por padrao", () => {
    expect(buildAiProviderAdapter(baseConfig())).toBeInstanceOf(DisabledAiProviderAdapter);
  });

  it("modo compatible_http sem configuracao completa cai de volta para disabled (nunca provider parcialmente configurado)", () => {
    expect(buildAiProviderAdapter(baseConfig({ AI_GATEWAY_PROVIDER_MODE: "compatible_http" }))).toBeInstanceOf(DisabledAiProviderAdapter);
    expect(buildAiProviderAdapter(baseConfig({ AI_GATEWAY_PROVIDER_MODE: "compatible_http", AI_PROVIDER_BASE_URL: "https://api.provider.test/v1" }))).toBeInstanceOf(DisabledAiProviderAdapter);
  });

  it("modo compatible_http com configuracao completa e host na allowlist constroi o adapter real", () => {
    const adapter = buildAiProviderAdapter(baseConfig({
      AI_GATEWAY_PROVIDER_MODE: "compatible_http",
      AI_PROVIDER_ALLOWED_HOSTS: "api.provider.test",
      AI_PROVIDER_BASE_URL: "https://api.provider.test/v1/chat",
      AI_PROVIDER_API_KEY: "k",
      AI_DEFAULT_MODEL: "m",
    }));
    expect(adapter).toBeInstanceOf(CompatibleHttpAiProviderAdapter);
  });

  it("modo compatible_http com host fora da allowlist lanca em vez de silenciosamente cair para disabled", () => {
    expect(() => buildAiProviderAdapter(baseConfig({
      AI_GATEWAY_PROVIDER_MODE: "compatible_http",
      AI_PROVIDER_ALLOWED_HOSTS: "outro-host.test",
      AI_PROVIDER_BASE_URL: "https://api.provider.test/v1/chat",
      AI_PROVIDER_API_KEY: "k",
      AI_DEFAULT_MODEL: "m",
    }))).toThrow();
  });
});

describe("aiGatewayProviderStatus", () => {
  it("LIMITED quando disabled", () => {
    expect(aiGatewayProviderStatus(baseConfig())).toBe("LIMITED");
  });
  it("AVAILABLE somente com configuracao completa em compatible_http", () => {
    expect(aiGatewayProviderStatus(baseConfig({ AI_GATEWAY_PROVIDER_MODE: "compatible_http" }))).toBe("LIMITED");
    expect(aiGatewayProviderStatus(baseConfig({ AI_GATEWAY_PROVIDER_MODE: "compatible_http", AI_PROVIDER_ALLOWED_HOSTS: "h", AI_PROVIDER_BASE_URL: "https://h/v1", AI_PROVIDER_API_KEY: "k", AI_DEFAULT_MODEL: "m" }))).toBe("AVAILABLE");
  });
});
