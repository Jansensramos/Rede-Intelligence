import { describe, expect, it } from "vitest";
import { EnvironmentSecretProvider, createSecretProvider } from "./secret-provider";

describe("SecretProvider", () => {
  it("lê segredo por nome sem o incluir no erro", async () => {
    const provider = new EnvironmentSecretProvider({ TEST_SECRET: "valor-ultrassecreto" });
    expect(await provider.get("TEST_SECRET")).toBe("valor-ultrassecreto");
    await expect(provider.get("MISSING_SECRET")).rejects.not.toThrow(/valor-ultrassecreto/);
  });
  it("proíbe environment provider em produção", () => {
    expect(() => createSecretProvider({ NODE_ENV: "production", DATABASE_URL: "db", SESSION_COOKIE_NAME: "rede", STORAGE_PROVIDER: "s3", STORAGE_FORCE_PATH_STYLE: "false", STORAGE_SIGNED_URL_TTL_SECONDS: 300, MALWARE_SCANNER_PROVIDER: "external", SECRET_PROVIDER: "environment", KMS_PROVIDER: "external", WORKER_CONCURRENCY: 1, WORKER_POLL_MS: 100, WORKER_LEASE_MS: 5000, WORKER_JOB_TIMEOUT_MS: 1000 })).toThrow(/proibido/);
  });
});
