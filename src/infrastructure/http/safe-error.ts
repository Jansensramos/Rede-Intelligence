import { randomUUID } from "node:crypto";
import { logger } from "@/infrastructure/observability/logger";
import { resolveCorrelationId } from "@/infrastructure/observability/correlation";

export function reportInternalError(error: unknown, input: { component: string; event: string; correlationId?: string; organizationId?: string }) {
  const correlationId = input.correlationId ? resolveCorrelationId(input.correlationId) : randomUUID();
  logger.error("Operação recusada por erro interno.", { ...input, correlationId, error });
  return correlationId;
}

export function safeOperatorError(correlationId: string, message = "Não foi possível concluir a operação.") {
  return `${message} Informe o código de correlação ${correlationId} ao suporte.`;
}
