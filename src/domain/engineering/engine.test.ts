import { describe, expect, it } from "vitest";
import { buildCostCycleRow, calculateSmartBudgetLine, compareValueEngineeringAlternatives, evaluateAutoBudgetApprovalGate } from "./engine";

describe("motor determinístico de Engenharia e Orçamento Inteligente 9M", () => {
  it("calcula quantidade x preço com quatro casas no unitário e snapshot completo", () => {
    const result = calculateSmartBudgetLine({ quantity: 12.3456, unit: "m³", quantityOrigin: "BIM_IFC", quantityReferenceId: "q-1", composition: { id: "c-1", key: "CONCRETO", version: 2, checksum: "abc" }, price: { value: 487.2367, source: "Histórico REDE", evidenceStatus: "COMPARABLE_HISTORICAL_PRICE", observedAt: "2026-08-01" }, confidence: "MEDIUM" });
    expect(result.unitCost).toBe(487.2367);
    expect(result.totalCost).toBe(6015.23);
    expect(result.snapshot.quantity.origin).toBe("BIM_IFC");
    expect(result.snapshot.composition.version).toBe(2);
  });

  it("não inventa preço quando não há evidência", () => {
    const result = calculateSmartBudgetLine({ quantity: 10, unit: "m²", quantityOrigin: "MANUAL", confidence: "LOW" });
    expect(result.evidenceStatus).toBe("NO_EVIDENCE");
    expect(result.unitCost).toBe(0);
    expect(result.totalCost).toBe(0);
    expect(result.snapshot.price.value).toBeNull();
  });

  it("bloqueia aprovação pendente, rejeitada, sem evidência ou sem snapshot", () => {
    const result = evaluateAutoBudgetApprovalGate([
      { id: "a", evidenceRequired: true, evidenceStatus: "NO_EVIDENCE", sourceSnapshot: null, latestDecision: null },
      { id: "b", evidenceRequired: false, evidenceStatus: "ESTIMATED_PRICE", sourceSnapshot: {}, latestDecision: "REJECTED" },
    ]);
    expect(result.allowed).toBe(false);
    expect(result.blockers.map((item) => item.reason)).toEqual(expect.arrayContaining(["Item pendente de revisão.", "Item obrigatório sem evidência de preço.", "Snapshot de origem ausente.", "Item rejeitado."]));
  });

  it("não soma estágios e só projeta custo final com estimativa restante evidenciada", () => {
    const noEvidence = buildCostCycleRow({ economicItemId: "e", code: "1", description: "Estrutura", budgeted: 100, contracted: 90, measured: 60, realized: 50 });
    expect(noEvidence.finalProjected).toBeNull();
    const evidenced = buildCostCycleRow({ economicItemId: "e", code: "1", description: "Estrutura", budgeted: 100, contracted: 90, measured: 60, realized: 50, remainingEstimate: 8 });
    expect(evidenced.openCommitment).toBe(40);
    expect(evidenced.finalProjected).toBe(98);
  });

  it("Engenharia de Valor nunca decide automaticamente", () => {
    const [option] = compareValueEngineeringAlternatives([{ name: "Solução A", cost: 10, scheduleMonths: 2, risk: "Baixo", technicalImpact: "Compatível" }]);
    expect(option.decision).toBeNull();
    expect(option.humanDecisionRequired).toBe(true);
  });
});
