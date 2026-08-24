/**
 * Severidade canônica de UI (Fase 9K.0, plano §I "Gestão por Exceção").
 *
 * O domínio tem hoje pelo menos 4 vocabulários de severidade independentes e cada um continua
 * sendo a fonte oficial dentro do seu módulo:
 *  - financial-ops: `classifyDueSeverity()` → "VERDE" | "AMARELO" | "VERMELHO"
 *  - legal: `LegalAlert.status` (OPEN/ACKNOWLEDGED/RESOLVED/DISMISSED) + `LegalAlert.criticality`
 *    (LOW/MEDIUM/HIGH/CRITICAL)
 *  - integrations: `InstallationUiState` → "HEALTHY" | "STALE" | "ATTENTION" | "CRITICAL"
 *  - risk: `FindingSeverity` → "critical" | "warning" | "positive"
 *
 * Este módulo NÃO substitui nenhum deles. É só uma camada de tradução para superfícies
 * transversais futuras (Visão Executiva, Central de Ações — 9K.2/9K.3). As funções abaixo são
 * puras: mesma entrada, mesma saída, sem I/O.
 */

export type CanonicalSeverity = "NORMAL" | "ATENCAO" | "ACAO_NECESSARIA" | "DECISAO" | "CRITICO";

export const CANONICAL_SEVERITY_ORDER: CanonicalSeverity[] = ["NORMAL", "ATENCAO", "ACAO_NECESSARIA", "DECISAO", "CRITICO"];

export const SEVERITY_LABELS: Record<CanonicalSeverity, string> = {
  NORMAL: "Normal",
  ATENCAO: "Atenção",
  ACAO_NECESSARIA: "Ação necessária",
  DECISAO: "Decisão",
  CRITICO: "Crítico",
};

/** Tom visual (cores já definidas em globals.css) associado a cada severidade canônica. */
export type SeverityTone = "positive" | "neutral" | "warning" | "critical";

export const SEVERITY_TONES: Record<CanonicalSeverity, SeverityTone> = {
  NORMAL: "positive",
  ATENCAO: "neutral",
  ACAO_NECESSARIA: "warning",
  DECISAO: "warning",
  CRITICO: "critical",
};

/** financial-ops: `src/domain/financial-ops/engine.ts` `classifyDueSeverity()`. */
export type FinancialDueSeverity = "VERDE" | "AMARELO" | "VERMELHO";

export function mapFinancialDueSeverity(value: FinancialDueSeverity): CanonicalSeverity {
  switch (value) {
    case "VERDE":
      return "NORMAL";
    case "AMARELO":
      return "ATENCAO";
    case "VERMELHO":
      return "CRITICO";
  }
}

/** legal: `LegalAlert.status` + `LegalAlert.criticality` (prisma/schema.prisma). */
export type LegalAlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED";
export type LegalCriticality = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export function mapLegalAlertSeverity(status: LegalAlertStatus, criticality: LegalCriticality): CanonicalSeverity {
  if (status === "RESOLVED" || status === "DISMISSED") return "NORMAL";
  switch (criticality) {
    case "LOW":
      return "ATENCAO";
    case "MEDIUM":
      return "ACAO_NECESSARIA";
    case "HIGH":
      return "ACAO_NECESSARIA";
    case "CRITICAL":
      return "CRITICO";
  }
}

/** integrations: `InstallationUiState` (`src/domain/integrations/installation-state.ts`). */
export type InstallationUiState = "HEALTHY" | "STALE" | "ATTENTION" | "CRITICAL";

export function mapIntegrationUiState(value: InstallationUiState): CanonicalSeverity {
  switch (value) {
    case "HEALTHY":
      return "NORMAL";
    case "STALE":
      return "ATENCAO";
    case "ATTENTION":
      return "ACAO_NECESSARIA";
    case "CRITICAL":
      return "CRITICO";
  }
}

/** risk: `FindingSeverity` (`src/domain/risk/rules.ts`). Escala de viabilidade, não de operação. */
export type RiskFindingSeverity = "critical" | "warning" | "positive";

export function mapRiskFindingSeverity(value: RiskFindingSeverity): CanonicalSeverity {
  switch (value) {
    case "positive":
      return "NORMAL";
    case "warning":
      return "ATENCAO";
    case "critical":
      return "CRITICO";
  }
}
