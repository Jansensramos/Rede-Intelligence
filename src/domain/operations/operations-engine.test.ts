import { describe, expect, it } from "vitest";
import { buildBudgetBridge, buildProjectedCashFlow, calculateLaborCost, distributeLinear, distributeSCurve, scheduleIndicators, validateBudgetHierarchy, validateDependencies, validateScheduleIntegrity } from "./operations-engine";

describe("motor operacional", () => {
  it("calcula a ponte entre Base Aprovada e Orçamento Oficial", () => {
    const bridge = buildBudgetBridge(
      [{ economicItemId: "a", category: "Construção", value: 100 }],
      [{ economicItemId: "a", category: "Construção", value: 107 }]
    );
    expect(bridge[0]).toMatchObject({ difference: 7, percentage: 7, level: "RELEVANTE" });
  });

  it("mantém prova-zero nas distribuições linear e curva S", () => {
    for (const allocations of [distributeLinear(10_000_000, ["2026-01", "2026-02", "2026-03"]), distributeSCurve(10_000_000, ["2026-01", "2026-02", "2026-03", "2026-04"])]) {
      expect(allocations.reduce((sum, item) => sum + item.financialValue, 0)).toBe(10_000_000);
      expect(allocations.reduce((sum, item) => sum + item.physicalPercentage, 0)).toBe(100);
      expect(validateScheduleIntegrity([{ id: "1", name: "Estrutura", plannedCost: 10_000_000, allocations }]).valid).toBe(true);
    }
  });

  it("separa avanço físico e desembolso financeiro e calcula fluxo", () => {
    const activity = { id: "1", name: "Fundação", plannedCost: 300, allocations: [
      { period: "2026-01", physicalPercentage: 60, financialValue: 100 },
      { period: "2026-02", physicalPercentage: 40, financialValue: 200 },
    ] };
    const flow = buildProjectedCashFlow([activity], { "2026-01": 250, "2026-02": 100 });
    expect(flow).toEqual([
      { period: "2026-01", inflow: 250, outflow: 100, net: 150, accumulated: 150 },
      { period: "2026-02", inflow: 100, outflow: 200, net: -100, accumulated: 50 },
    ]);
    expect(scheduleIndicators(flow, "2026-01")).toMatchObject({ totalCost: 300, next90Days: 300, peakOutflow: 200, peakPeriod: "2026-02" });
  });

  it("rejeita ciclos e referências inválidas em dependências", () => {
    expect(validateDependencies(["a", "b"], [{ predecessorId: "a", successorId: "b", type: "FINISH_TO_START" }])).toBe(true);
    expect(validateDependencies(["a", "b"], [
      { predecessorId: "a", successorId: "b", type: "FINISH_TO_START" },
      { predecessorId: "b", successorId: "a", type: "FINISH_TO_START" },
    ])).toBe(false);
    expect(() => validateDependencies(["a"], [{ predecessorId: "a", successorId: "x", type: "FINISH_TO_START" }])).toThrow();
  });

  it("calcula composição profissional e EAP sem dupla contagem", () => {
    expect(calculateLaborCost({ headcount: 2, monthlyCost: 10_000, burdenRate: 0.5, monthlyBenefits: 2_000, months: 36 })).toBe(1_224_000);
    expect(validateBudgetHierarchy([{ id: "01", parentId: null, value: 300 }, { id: "01.01", parentId: "01", value: 100 }, { id: "01.02", parentId: "01", value: 200 }])).toEqual({ valid: true, errors: [], leafTotal: 300 });
    expect(validateBudgetHierarchy([{ id: "a", parentId: "b", value: 1 }, { id: "b", parentId: "a", value: 1 }]).valid).toBe(false);
  });
});
