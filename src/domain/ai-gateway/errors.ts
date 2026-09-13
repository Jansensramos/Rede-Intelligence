import { classifyProductionDependencyFailure } from "@/infrastructure/security/production-dependency-error";
import { AiGatewayError, isRetryableAiGatewayErrorCode, type AiGatewayErrorCode } from "./types";

/**
 * Ponte entre a classificacao generica de falha de dependencia externa (ja auditada, ver
 * production-dependency-error.ts) e a taxonomia fechada do AI Gateway (docs Fase 10A §8).
 * 401/403 sao sempre permanentes; 408/429/5xx sao retryable ate o limite da politica de
 * retry (retry-policy.ts) - reaproveitados, nunca duplicados.
 */

export function classifyTransportFailureAsGatewayError(error: unknown, correlationId: string): AiGatewayError {
  const classification = classifyProductionDependencyFailure(error);
  const code: AiGatewayErrorCode =
    classification.kind === "MISSING_CREDENTIALS" ? "AUTHENTICATION"
    : classification.kind === "PERMISSION_DENIED" ? "AUTHORIZATION"
    : classification.kind === "TIMEOUT" ? "TIMEOUT"
    : classification.kind === "SERVICE_UNAVAILABLE" ? "PROVIDER_UNAVAILABLE"
    : classification.kind === "INVALID_CONFIGURATION" ? "CONFIGURATION"
    : "UNEXPECTED";
  return new AiGatewayError("Falha de transporte com o provider de IA.", code, isRetryableAiGatewayErrorCode(code), correlationId, { cause: error });
}

export function gatewayError(message: string, code: AiGatewayErrorCode, correlationId: string, cause?: unknown): AiGatewayError {
  return new AiGatewayError(message, code, isRetryableAiGatewayErrorCode(code), correlationId, cause !== undefined ? { cause } : undefined);
}
