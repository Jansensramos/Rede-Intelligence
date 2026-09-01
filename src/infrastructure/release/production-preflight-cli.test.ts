import { describe, expect, it } from "vitest";
import type { ProductionDependencyFailureKind } from "@/infrastructure/security/production-dependency-error";
import type { ProductionPreflightResult } from "./production-preflight";
import { productionPreflightCliResult } from "./production-preflight-cli";

function failureResult(kind: ProductionDependencyFailureKind): ProductionPreflightResult {
  return {
    ok: false,
    correlationId: "correlacao-segura",
    configurationErrors: [],
    unavailableServices: kind === "SERVICE_UNAVAILABLE" ? ["KMS_PROVIDER"] : [],
    checkedServices: [],
    dependencyFailures: [{ service: "KMS_PROVIDER", kind, errorClass: "ProviderError" }],
  };
}

describe("saída do preflight para o operador", () => {
  it.each([
    ["INVALID_CONFIGURATION", "CONFIGURACAO_INVALIDA"],
    ["MISSING_CREDENTIALS", "CREDENCIAL_AUSENTE_OU_INVALIDA"],
    ["PERMISSION_DENIED", "PERMISSAO_NEGADA"],
    ["TIMEOUT", "TEMPO_LIMITE_EXCEDIDO"],
    ["SERVICE_UNAVAILABLE", "SERVICO_INDISPONIVEL"],
    ["UNEXPECTED", "FALHA_INESPERADA"],
  ] as const)("expõe %s como %s com o serviço afetado", (kind, operatorCategory) => {
    const output = productionPreflightCliResult(failureResult(kind));
    expect(output.exitCode).toBe(3);
    expect(output.payload).toMatchObject({
      status: "DEPENDENCIA_OBRIGATORIA_REPROVADA",
      falhas: [{ servico: "KMS_PROVIDER", categoria: operatorCategory, classe: "ProviderError" }],
    });
    expect(JSON.stringify(output)).not.toContain("mensagem");
  });

  it("preserva a saída aprovada", () => {
    const result: ProductionPreflightResult = {
      ok: true,
      correlationId: "correlacao-segura",
      configurationErrors: [],
      unavailableServices: [],
      checkedServices: ["DATABASE_URL"],
      dependencyFailures: [],
    };
    expect(productionPreflightCliResult(result)).toMatchObject({ exitCode: 0, payload: { status: "APROVADO" } });
  });

  it("preserva a saída de configuração global inválida", () => {
    const result = failureResult("UNEXPECTED");
    result.configurationErrors = ["Configuração inválida: KMS_KEY_ID. Valores não foram exibidos."];
    expect(productionPreflightCliResult(result)).toMatchObject({ exitCode: 2, payload: { status: "CONFIGURACAO_INVALIDA" } });
  });
});
