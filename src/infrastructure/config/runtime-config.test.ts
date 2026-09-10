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
  it("rejeita política de proxy inválida citando somente o nome da configuração", () => {
    const environment = {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://localhost/rede_intelligence_test",
      TRUSTED_PROXY_HOPS: "segredo-invalido",
    };
    expect(() => parseRuntimeConfig(environment)).toThrow(/TRUSTED_PROXY_HOPS/);
    try { parseRuntimeConfig(environment); }
    catch (error) { expect(String(error)).not.toContain("segredo-invalido"); }
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
  it("exige destino externo de alerting em produção mesmo com o restante do contrato completo", () => {
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
      AWS_REGION: "regiao-seguranca",
      SECRETS_MANAGER_PREFIX: "rede/producao",
      SECRETS_MANAGER_PREFLIGHT_SECRET_ID: "referencia-preflight",
      KMS_KEY_ID: "referencia-kms",
    };
    expect(() => parseRuntimeConfig(environment)).toThrow(/ALERTING_PROVIDER|ALERTING_EXTERNAL_ENDPOINT/);
    expect(parseRuntimeConfig({ ...environment, ALERTING_PROVIDER: "external", ALERTING_EXTERNAL_ENDPOINT: "https://alerts.example.invalid/webhook" }).ALERTING_PROVIDER).toBe("external");
  });

  // Achado Bloqueador da reauditoria 9Q.2B: DATABASE_URL do runtime (web/worker/Prisma)
  // não tinha nenhuma proteção contra banco arquivado — só TEST_DATABASE_URL era
  // coberta, por um caminho totalmente separado. Este é o ponto central de config
  // usado por web, worker e preflight.
  it.each([
    "postgresql://u:p@localhost/rede_intelligence_test_archived_20260904",
    "postgresql://u:p@localhost/rede_intelligence_archive",
    "postgresql://u:p@localhost/rede_intelligence_archival",
    "postgresql://u:p@localhost/rede_intelligence_ARCHIVED",
  ])("recusa DATABASE_URL apontando para banco arquivado (%s), sem revelar credenciais", (databaseUrl) => {
    const environment = { NODE_ENV: "test", DATABASE_URL: databaseUrl.replace("u:p", "usuario_secreto:senha_secreta") };
    expect(() => parseRuntimeConfig(environment)).toThrow(/arquivado/);
    try { parseRuntimeConfig(environment); } catch (error) { expect(String(error)).not.toContain("senha_secreta"); }
  });

  it("aceita DATABASE_URL de um banco legítimo, não arquivado", () => {
    expect(parseRuntimeConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://localhost/rede_intelligence_test" }).DATABASE_URL).toContain("rede_intelligence_test");
  });
});
