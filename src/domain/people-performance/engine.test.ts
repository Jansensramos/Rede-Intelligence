import { describe, expect, it } from "vitest";
import {
  allocateAdministrativeCost,
  assertAllocationCapacity,
  assertCorrectiveActionTransition,
  assertNoHierarchyCycle,
  assertPerformanceVarianceTransition,
  assertRootCauseAllocation,
  calculateEfficiencyVariance,
  calculateRelationshipCost,
  simulateIncentivePool,
} from "./engine";

describe("motor de pessoas, eficiência e causa-raiz", () => {
  it("soma os componentes do custo gerencial sem arredondamento oculto", () => {
    expect(calculateRelationshipCost({ baseCost: "10000.10", burdenCost: "3500.20", benefitsCost: "850.30", otherCost: "149.40" }).totalCost.toString()).toBe("14500");
  });

  it("exige justificativa para superalocação", () => {
    expect(() => assertAllocationCapacity([{ criterion: "PERCENTAGE", allocationRate: "0.8" }], { criterion: "PERCENTAGE", allocationRate: "0.3" })).toThrow(/justificativa/);
    expect(assertAllocationCapacity([{ criterion: "PERCENTAGE", allocationRate: "0.8" }], { criterion: "PERCENTAGE", allocationRate: "0.3", justification: "Apoio temporário aprovado para a etapa crítica." }).overAllocated).toBe(true);
  });

  it("bloqueia ciclos na hierarquia organizacional", () => {
    expect(() => assertNoHierarchyCycle([{ id: "a", parentId: null }, { id: "b", parentId: "a" }], "a", "b")).toThrow(/ciclo/);
  });

  it("rateia centavos com prova de zero", () => {
    const result = allocateAdministrativeCost("100.00", [{ targetId: "a", value: 1 }, { targetId: "b", value: 1 }, { targetId: "c", value: 1 }]);
    expect(result.lines.map((line) => line.allocatedAmount.toString())).toEqual(["33.34", "33.33", "33.33"]);
    expect(result.allocatedAmount.toString()).toBe("100");
    expect(result.residualAmount.toString()).toBe("0");
    expect(result.proofZero).toBe(true);
  });

  it("não chama de economia um desembolso menor causado por atraso físico", () => {
    const result = calculateEfficiencyVariance({ plannedAmount: 350000, committedAmount: 0, measuredAmount: 200000, actualAmount: 200000, forecastAmount: 350000, plannedProgress: 1, actualProgress: 0.5 });
    expect(result.cashVariance.toString()).toBe("150000");
    expect(result.expectedCostAtProgress.toString()).toBe("175000");
    expect(result.delayedExecution).toBe(true);
    expect(result.savingEligible).toBe(false);
    expect(result.validatedSavingAmount.toString()).toBe("0");
  });

  it("só reconhece elegibilidade quando existe economia previamente validada", () => {
    const unvalidated = calculateEfficiencyVariance({ plannedAmount: 350000, committedAmount: 0, measuredAmount: 200000, actualAmount: 200000, forecastAmount: 300000, plannedProgress: 1, actualProgress: 1, validatedSavingAmount: 50000, validatedSavingConfirmed: false });
    const validated = calculateEfficiencyVariance({ plannedAmount: 350000, committedAmount: 0, measuredAmount: 200000, actualAmount: 200000, forecastAmount: 300000, plannedProgress: 1, actualProgress: 1, validatedSavingAmount: 50000, validatedSavingConfirmed: true });
    expect(unvalidated.savingEligible).toBe(false);
    expect(validated.savingEligible).toBe(true);
  });

  it("controla causas parciais e exige 100% no fechamento", () => {
    expect(assertRootCauseAllocation([0.4, 0.35]).toString()).toBe("0.75");
    expect(() => assertRootCauseAllocation([0.4, 0.35], true)).toThrow(/100%/);
    expect(assertRootCauseAllocation([0.4, 0.35, 0.25], true).toString()).toBe("1");
  });

  it("aplica transições rastreáveis às ações corretivas", () => {
    expect(() => assertCorrectiveActionTransition("DRAFT", "VERIFIED")).toThrow(/inválida/);
    expect(() => assertCorrectiveActionTransition("COMPLETED", "VERIFIED")).not.toThrow();
  });

  it("impede pular etapas na classificação do desvio", () => {
    expect(() => assertPerformanceVarianceTransition("UNCLASSIFIED", "VALIDATED")).toThrow(/inválida/);
    expect(() => assertPerformanceVarianceTransition("UNDER_ANALYSIS", "CLASSIFIED")).not.toThrow();
    expect(() => assertPerformanceVarianceTransition("VALIDATED", "CLOSED")).not.toThrow();
  });

  it("simula incentivo sem criar pagamento e sem percentual oculto", () => {
    const result = simulateIncentivePool({ validatedSavingAmount: 100000, validatedSavingConfirmed: true, implementationCost: 10000, reversalAmount: 5000, reserveRate: 0.1, poolRate: 0.2 });
    expect(result.eligibleBase.toString()).toBe("85000");
    expect(result.simulatedPool.toString()).toBe("15300");
    expect(result.payableAmount.toString()).toBe("0");
    expect(result.isSimulationOnly).toBe(true);
  });

  it("zera incentivo quando a economia não veio de ValidatedSaving", () => {
    const result = simulateIncentivePool({ validatedSavingAmount: 100000, validatedSavingConfirmed: false, poolRate: 0.2 });
    expect(result.eligibleBase.toString()).toBe("0");
    expect(result.simulatedPool.toString()).toBe("0");
  });
});
