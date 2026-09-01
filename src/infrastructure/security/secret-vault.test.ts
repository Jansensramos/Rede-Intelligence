import { describe, expect, it, vi } from "vitest";
import { parseRuntimeConfig } from "@/infrastructure/config/runtime-config";
import { createIntegrationSecretVault } from "./secret-vault";

describe("seleção do cofre por ambiente", () => {
  it("mantém desenvolvimento e teste no cofre local sem construir client externo", () => {
    const config = parseRuntimeConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://localhost/rede_intelligence_test" });
    expect(createIntegrationSecretVault(config).name).toBe("LOCAL_ENCRYPTED_V1");
  });

  it("seleciona AWS Secrets Manager em produção somente com contrato completo", () => {
    const config = parseRuntimeConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://db/producao",
      APP_PUBLIC_URL: "https://app.example.invalid",
      WEBHOOK_BASE_URL: "https://app.example.invalid/api/webhooks",
      SESSION_SECRET: "s".repeat(32),
      STORAGE_PROVIDER: "s3",
      STORAGE_BUCKET: "bucket",
      STORAGE_REGION: "regiao-storage",
      STORAGE_ACCESS_KEY_ID: "identificador",
      STORAGE_SECRET_ACCESS_KEY: "conteudo-sintetico",
      MALWARE_SCANNER_PROVIDER: "external",
      SECRET_PROVIDER: "external",
      KMS_PROVIDER: "external",
      AWS_REGION: "regiao-seguranca",
      SECRETS_MANAGER_PREFIX: "rede/teste",
      SECRETS_MANAGER_PREFLIGHT_SECRET_ID: "referencia-preflight",
      KMS_KEY_ID: "referencia-kms",
    });
    const createAdapter = vi.fn(() => ({
      create: vi.fn(async () => "referencia"),
      read: vi.fn(async () => "conteudo"),
      revoke: vi.fn(async () => undefined),
    }));
    expect(createIntegrationSecretVault(config, createAdapter).name).toBe("AWS_SECRETS_MANAGER_V1");
    expect(createAdapter).toHaveBeenCalledWith("regiao-seguranca");
  });
});
