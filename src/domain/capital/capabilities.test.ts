import { describe, expect, it } from "vitest";
import { assertCapitalCapability, hasCapitalCapability } from "./capabilities";

describe("capacidades da Fase 9N", () => {
  it("VIEWER só enxerga, nunca cadastra proposta nem aprova", () => {
    expect(hasCapitalCapability("VIEWER", "CAPITAL_VIEW")).toBe(true);
    expect(hasCapitalCapability("VIEWER", "CAPITAL_PROPOSAL_MANAGE")).toBe(false);
    expect(hasCapitalCapability("VIEWER", "CAPITAL_APPROVE")).toBe(false);
  });

  it("aprovação de funding (que gera obrigação financeira real) fica restrita a ADMIN/OWNER", () => {
    expect(hasCapitalCapability("ANALYST", "CAPITAL_APPROVE")).toBe(false);
    expect(hasCapitalCapability("REVIEWER", "CAPITAL_APPROVE")).toBe(false);
    expect(hasCapitalCapability("ADMIN", "CAPITAL_APPROVE")).toBe(true);
    expect(hasCapitalCapability("OWNER", "CAPITAL_APPROVE")).toBe(true);
    expect(() => assertCapitalCapability("ANALYST", "CAPITAL_APPROVE")).toThrow(/capacidade/);
  });

  it("cadastro de proposta e simulação de cenário não exigem alçada de aprovação", () => {
    expect(hasCapitalCapability("ANALYST", "CAPITAL_PROPOSAL_MANAGE")).toBe(true);
    expect(hasCapitalCapability("ANALYST", "CAPITAL_SCENARIO_SIMULATE")).toBe(true);
  });

  it("gestão de covenants/condições precedentes está disponível para quem revisa, não só para quem edita proposta", () => {
    expect(hasCapitalCapability("REVIEWER", "CAPITAL_COVENANT_MANAGE")).toBe(true);
    expect(hasCapitalCapability("REVIEWER", "CAPITAL_PROPOSAL_MANAGE")).toBe(false);
  });
});
