import { describe, expect, it, vi } from "vitest";
import { ProductionDependencyError, type ProductionDependencyFailureKind } from "@/infrastructure/security/production-dependency-error";
import type { ProductionPreflightDependencies } from "./production-preflight";
import { runProductionPreflight } from "./production-preflight";

const validEnvironment = () => ({
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://usuario:conteudo-sintetico@db/producao",
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

function doubles(): ProductionPreflightDependencies {
  return {
    database: vi.fn(async () => undefined),
    storage: vi.fn(async () => undefined),
    secretManager: vi.fn(async () => undefined),
    kms: vi.fn(async () => undefined),
    malwareScanner: vi.fn(async () => undefined),
  };
}

describe("preflight de produção", () => {
  it("executa apenas doubles injetados e aprova todas as dependências", async () => {
    const dependencies = doubles();
    const result = await runProductionPreflight(validEnvironment(), dependencies);
    expect(result.ok).toBe(true);
    expect(result.checkedServices).toHaveLength(5);
    expect(result.dependencyFailures).toEqual([]);
    expect(Object.values(dependencies).every((dependency) => vi.mocked(dependency).mock.calls.length === 1)).toBe(true);
  });

  it("separa serviço indisponível de configuração inválida", async () => {
    const dependencies = doubles();
    vi.mocked(dependencies.kms).mockRejectedValueOnce(new Error("detalhe interno"));
    const result = await runProductionPreflight(validEnvironment(), dependencies);
    expect(result.ok).toBe(false);
    expect(result.configurationErrors).toEqual([]);
    expect(result.unavailableServices).toEqual([]);
    expect(result.dependencyFailures).toEqual([{ service: "KMS_PROVIDER", kind: "UNEXPECTED", errorClass: "Error" }]);
    expect(JSON.stringify(result)).not.toContain("detalhe interno");
  });

  it("informa somente nomes de configuração e nunca valores", async () => {
    const environment = validEnvironment();
    delete (environment as Partial<typeof environment>).KMS_KEY_ID;
    const result = await runProductionPreflight(environment, doubles());
    expect(result.ok).toBe(false);
    expect(result.configurationErrors.join(" ")).toContain("KMS_KEY_ID");
    expect(JSON.stringify(result)).not.toContain("conteudo-sintetico");
    expect(JSON.stringify(result)).not.toContain("postgresql://");
    expect(result.dependencyFailures).toEqual([{ service: "CONFIGURATION", kind: "INVALID_CONFIGURATION", errorClass: "Error" }]);
  });

  it.each<[ProductionDependencyFailureKind, string]>([
    ["MISSING_CREDENTIALS", "CredentialsProviderError"],
    ["PERMISSION_DENIED", "AccessDeniedException"],
    ["TIMEOUT", "TimeoutError"],
    ["SERVICE_UNAVAILABLE", "ServiceUnavailable"],
    ["UNEXPECTED", "UnknownProviderFailure"],
  ])("mantém no resultado a categoria %s sem expor a mensagem bruta", async (kind, errorClass) => {
    const dependencies = doubles();
    const raw = Object.assign(new Error("token=valor-secreto-nao-pode-vazar"), { name: errorClass });
    vi.mocked(dependencies.secretManager).mockRejectedValueOnce(raw);
    const result = await runProductionPreflight(validEnvironment(), dependencies);
    expect(result.ok).toBe(false);
    expect(result.unavailableServices).toEqual(kind === "SERVICE_UNAVAILABLE" ? ["SECRET_PROVIDER"] : []);
    expect(result.dependencyFailures).toEqual([{ service: "SECRET_PROVIDER", kind, errorClass }]);
    expect(JSON.stringify(result)).not.toContain("valor-secreto");
  });

  it("registra somente categoria e classe segura com correlation ID", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dependencies = doubles();
    vi.mocked(dependencies.kms).mockRejectedValueOnce(
      new ProductionDependencyError("AWS_KMS", "PERMISSION_DENIED", "AccessDeniedException", "Mensagem segura.", {
        cause: new Error("arn:aws:kms:regiao:conta:key/segredo-operacional"),
      }),
    );
    const result = await runProductionPreflight(validEnvironment(), dependencies);
    const lines = consoleError.mock.calls.flat().join("\n");
    consoleError.mockRestore();
    expect(lines).toContain('"failureKind":"PERMISSION_DENIED"');
    expect(lines).toContain('"errorClass":"AccessDeniedException"');
    expect(lines).toContain(result.correlationId);
    expect(lines).not.toContain("segredo-operacional");
    expect(lines).not.toContain("arn:aws");
  });

  it("não apresenta configuração inválida do provider como serviço indisponível", async () => {
    const dependencies = doubles();
    vi.mocked(dependencies.kms).mockRejectedValueOnce(
      new ProductionDependencyError("AWS_KMS", "INVALID_CONFIGURATION", "ConfigurationError", "Chave KMS inválida."),
    );
    const result = await runProductionPreflight(validEnvironment(), dependencies);
    expect(result.ok).toBe(false);
    expect(result.unavailableServices).toEqual([]);
    expect(result.dependencyFailures).toEqual([{ service: "KMS_PROVIDER", kind: "INVALID_CONFIGURATION", errorClass: "ConfigurationError" }]);
  });
});
