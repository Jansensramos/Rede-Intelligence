import type { ProductionPreflightResult } from "./production-preflight";
import type { ProductionDependencyFailureKind } from "@/infrastructure/security/production-dependency-error";

const OPERATOR_CATEGORY: Record<ProductionDependencyFailureKind, string> = {
  INVALID_CONFIGURATION: "CONFIGURACAO_INVALIDA",
  MISSING_CREDENTIALS: "CREDENCIAL_AUSENTE_OU_INVALIDA",
  PERMISSION_DENIED: "PERMISSAO_NEGADA",
  TIMEOUT: "TEMPO_LIMITE_EXCEDIDO",
  SERVICE_UNAVAILABLE: "SERVICO_INDISPONIVEL",
  UNEXPECTED: "FALHA_INESPERADA",
};

export function productionPreflightCliResult(result: ProductionPreflightResult) {
  if (result.ok) {
    return {
      stream: "info" as const,
      exitCode: 0,
      payload: { status: "APROVADO", correlationId: result.correlationId, verificacoes: result.checkedServices },
    };
  }
  if (result.configurationErrors.length > 0) {
    return {
      stream: "error" as const,
      exitCode: 2,
      payload: { status: "CONFIGURACAO_INVALIDA", correlationId: result.correlationId, configuracoes: result.configurationErrors },
    };
  }
  return {
    stream: "error" as const,
    exitCode: 3,
    payload: {
      status: "DEPENDENCIA_OBRIGATORIA_REPROVADA",
      correlationId: result.correlationId,
      falhas: result.dependencyFailures.map((failure) => ({
        servico: failure.service,
        categoria: OPERATOR_CATEGORY[failure.kind],
        classe: failure.errorClass,
      })),
    },
  };
}
