import { describe, expect, it, vi } from "vitest";
import { ExternalKmsProvider, ExternalSecretProvider, EnvironmentSecretProvider, createSecretProvider } from "./secret-provider";

describe("SecretProvider", () => {
  it("lê segredo por nome sem o incluir no erro", async () => {
    const provider = new EnvironmentSecretProvider({ TEST_SECRET: "valor-ultrassecreto" });
    expect(await provider.get("TEST_SECRET")).toBe("valor-ultrassecreto");
    await expect(provider.get("MISSING_SECRET")).rejects.not.toThrow(/valor-ultrassecreto/);
  });
  it("proíbe environment provider em produção", () => {
    expect(() => createSecretProvider({ NODE_ENV: "production", DATABASE_URL: "db", SESSION_COOKIE_NAME: "rede", STORAGE_PROVIDER: "s3", STORAGE_FORCE_PATH_STYLE: "false", STORAGE_SIGNED_URL_TTL_SECONDS: 300, MALWARE_SCANNER_PROVIDER: "external", SECRET_PROVIDER: "environment", KMS_PROVIDER: "external", WORKER_CONCURRENCY: 1, WORKER_POLL_MS: 100, WORKER_LEASE_MS: 5000, WORKER_JOB_TIMEOUT_MS: 1000 })).toThrow(/proibido/);
  });
  it("resolve por adapter determinístico sem acesso de rede", async () => {
    const adapter = { read: vi.fn(async () => "conteudo-sintetico"), healthCheck: vi.fn(async () => undefined) };
    const provider = new ExternalSecretProvider(adapter);
    expect(await provider.get("referencia-valida")).toBe("conteudo-sintetico");
    await provider.healthCheck("referencia-preflight");
    expect(adapter.read).toHaveBeenCalledOnce();
    expect(adapter.healthCheck).toHaveBeenCalledOnce();
  });
  it("falha fechado sem adapters externos", async () => {
    await expect(new ExternalSecretProvider().get("referencia")).rejects.toThrow(/não configurado/);
    await expect(new ExternalKmsProvider().healthCheck()).rejects.toThrow(/não configurado/);
  });
  it("delega KMS somente ao double injetado", async () => {
    const adapter = {
      name: "DOUBLE_KMS",
      encrypt: vi.fn(async () => new Uint8Array([2, 4, 6])),
      decrypt: vi.fn(async () => new Uint8Array([1, 3, 5])),
      healthCheck: vi.fn(async () => undefined),
    };
    const provider = new ExternalKmsProvider(adapter);
    expect(await provider.encrypt(new Uint8Array([1]), { tenant: "organizacao" })).toEqual(new Uint8Array([2, 4, 6]));
    expect(await provider.decrypt(new Uint8Array([2]), { tenant: "organizacao" })).toEqual(new Uint8Array([1, 3, 5]));
    await provider.healthCheck();
    expect(adapter.healthCheck).toHaveBeenCalledOnce();
  });
});
