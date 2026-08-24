import { describe, expect, it } from "vitest";
import {
  CANONICAL_SEVERITY_ORDER,
  SEVERITY_LABELS,
  SEVERITY_TONES,
  mapFinancialDueSeverity,
  mapIntegrationUiState,
  mapLegalAlertSeverity,
  mapRiskFindingSeverity,
} from "./severity";

describe("normalização de severidade canônica (9K.0, plano §I)", () => {
  it("mapeia financial-ops (VERDE/AMARELO/VERMELHO)", () => {
    expect(mapFinancialDueSeverity("VERDE")).toBe("NORMAL");
    expect(mapFinancialDueSeverity("AMARELO")).toBe("ATENCAO");
    expect(mapFinancialDueSeverity("VERMELHO")).toBe("CRITICO");
  });

  it("mapeia legal (status + criticality) — status resolvido sempre normaliza para NORMAL", () => {
    expect(mapLegalAlertSeverity("RESOLVED", "CRITICAL")).toBe("NORMAL");
    expect(mapLegalAlertSeverity("DISMISSED", "HIGH")).toBe("NORMAL");
    expect(mapLegalAlertSeverity("OPEN", "LOW")).toBe("ATENCAO");
    expect(mapLegalAlertSeverity("OPEN", "MEDIUM")).toBe("ACAO_NECESSARIA");
    expect(mapLegalAlertSeverity("ACKNOWLEDGED", "HIGH")).toBe("ACAO_NECESSARIA");
    expect(mapLegalAlertSeverity("OPEN", "CRITICAL")).toBe("CRITICO");
  });

  it("mapeia integrações (InstallationUiState)", () => {
    expect(mapIntegrationUiState("HEALTHY")).toBe("NORMAL");
    expect(mapIntegrationUiState("STALE")).toBe("ATENCAO");
    expect(mapIntegrationUiState("ATTENTION")).toBe("ACAO_NECESSARIA");
    expect(mapIntegrationUiState("CRITICAL")).toBe("CRITICO");
  });

  it("mapeia risco de viabilidade (FindingSeverity) — sem estados intermediários", () => {
    expect(mapRiskFindingSeverity("positive")).toBe("NORMAL");
    expect(mapRiskFindingSeverity("warning")).toBe("ATENCAO");
    expect(mapRiskFindingSeverity("critical")).toBe("CRITICO");
  });

  it("toda severidade canônica tem rótulo em português e tom visual", () => {
    for (const severity of CANONICAL_SEVERITY_ORDER) {
      expect(SEVERITY_LABELS[severity]).toBeTruthy();
      expect(["positive", "neutral", "warning", "critical"]).toContain(SEVERITY_TONES[severity]);
    }
  });

  it("a ordem canônica tem exatamente os 5 estados do plano, sem duplicar", () => {
    expect(CANONICAL_SEVERITY_ORDER).toEqual(["NORMAL", "ATENCAO", "ACAO_NECESSARIA", "DECISAO", "CRITICO"]);
    expect(new Set(CANONICAL_SEVERITY_ORDER).size).toBe(5);
  });
});
