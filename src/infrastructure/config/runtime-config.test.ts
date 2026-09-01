import { describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "./runtime-config";

describe("contrato de ambiente", () => {
  it("falha cedo em produção sem revelar valores", () => {
    const environment = { NODE_ENV: "production", DATABASE_URL: "postgresql://user:super-secret@db/prod" };
    expect(() => parseRuntimeConfig(environment)).toThrow(/APP_PUBLIC_URL|SESSION_SECRET|STORAGE/);
    try { parseRuntimeConfig(environment); } catch (error) { expect(String(error)).not.toContain("super-secret"); }
  });
  it("aceita configuração mínima de teste", () => {
    expect(parseRuntimeConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://localhost/rede_intelligence_test" }).STORAGE_PROVIDER).toBe("local");
  });
  it("exige os nomes de configuração dos providers externos em produção sem revelar valores", () => {
    const environment = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://usuario:valor-nao-publico@db/producao",
      APP_PUBLIC_URL: "https://app.example.invalid",
      WEBHOOK_BASE_URL: "https://app.example.invalid/api/webhooks",
      SESSION_SECRET: "x".repeat(32),
      STORAGE_PROVIDER: "s3",
      STORAGE_BUCKET: "bucket",
      STORAGE_REGION: "regiao",
      STORAGE_ACCESS_KEY_ID: "identificador",
      STORAGE_SECRET_ACCESS_KEY: "valor-nao-publico",
      MALWARE_SCANNER_PROVIDER: "external",
      SECRET_PROVIDER: "external",
      KMS_PROVIDER: "external",
    };
    expect(() => parseRuntimeConfig(environment)).toThrow(/AWS_REGION|SECRETS_MANAGER_PREFIX|SECRETS_MANAGER_PREFLIGHT_SECRET_ID|KMS_KEY_ID/);
    try { parseRuntimeConfig(environment); } catch (error) { expect(String(error)).not.toContain("valor-nao-publico"); }
  });
});
