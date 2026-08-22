/**
 * Estados de UI da Central de Integrações (plano §44): derivados de dados já
 * existentes no read model, nunca recalculados/duplicados na camada de tela.
 */
export type InstallationUiState = "HEALTHY" | "STALE" | "ATTENTION" | "CRITICAL";

export interface InstallationStateInput {
  installationStatus: "DRAFT" | "ACTIVE" | "PAUSED" | "ERROR" | "REVOKED";
  healthStatus: "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN";
  credentialStatus: "PENDING" | "ACTIVE" | "EXPIRING" | "EXPIRED" | "REVOKED" | "ERROR";
  stale: boolean;
}

export function classifyInstallationState(input: InstallationStateInput): InstallationUiState {
  if (input.installationStatus === "ERROR" || input.healthStatus === "DOWN" || ["EXPIRED", "REVOKED", "ERROR"].includes(input.credentialStatus)) return "CRITICAL";
  if (input.healthStatus === "DEGRADED" || input.credentialStatus === "EXPIRING") return "ATTENTION";
  if (input.stale) return "STALE";
  return "HEALTHY";
}
