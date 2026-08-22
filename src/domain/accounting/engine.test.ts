import { describe, expect, it } from "vitest";
import { allocateExact, assertAllocationProof, assertBalancedEntry, assertEventReplay, assertPeriodAllowsPosting, buildEconomicIdentity, calculateConfiguredTax, calculateConsolidation, calculateReconciliation, calculateRevenueRecognition, calculateTrialBalance, reversePostingLines, selectAccountingMapping } from ".";

describe("motor contábil determinístico", () => {
  it("aceita partidas dobradas e rejeita diferença de um centavo", () => {
    expect(assertBalancedEntry([{ accountId: "custo", side: "DEBIT", amount: "100000" }, { accountId: "fornecedor", side: "CREDIT", amount: "100000" }])).toEqual({ debit: "100000.00", credit: "100000.00" });
    expect(() => assertBalancedEntry([{ accountId: "custo", side: "DEBIT", amount: "100000" }, { accountId: "fornecedor", side: "CREDIT", amount: "99999.99" }])).toThrow("desequilibrado");
  });

  it("gera estorno exatamente invertido", () => {
    expect(reversePostingLines([{ accountId: "a", side: "DEBIT", amount: 10 }, { accountId: "b", side: "CREDIT", amount: 10 }]).map((line) => line.side)).toEqual(["CREDIT", "DEBIT"]);
  });

  it("faz replay idempotente apenas com a mesma versão e checksum", () => {
    expect(assertEventReplay({ payloadChecksum: "x", eventVersion: 1 }, { payloadChecksum: "x", eventVersion: 1 })).toBe("REPLAY");
    expect(() => assertEventReplay({ payloadChecksum: "x", eventVersion: 1 }, { payloadChecksum: "y", eventVersion: 1 })).toThrow("divergente");
    expect(buildEconomicIdentity({ organizationId: "ORG", companyId: "SPE", sourceDomain: "9C", rootSourceId: "BM-1" })).toBe("org:spe:9c:bm-1");
  });

  it("seleciona regra vigente mais específica e bloqueia empate", () => {
    const date = new Date("2026-01-15");
    expect(selectAccountingMapping([{ id: "grupo", priority: 1, specificity: 1, effectiveFrom: new Date("2026-01-01") }, { id: "spe", priority: 1, specificity: 3, effectiveFrom: new Date("2026-01-01") }], date)?.id).toBe("spe");
    expect(() => selectAccountingMapping([{ id: "a", priority: 1, specificity: 1, effectiveFrom: new Date("2026-01-01") }, { id: "b", priority: 1, specificity: 1, effectiveFrom: new Date("2026-01-01") }], date)).toThrow("ambíguo");
  });

  it("rateia R$ 100 mil sem perder centavos", () => {
    const lines = allocateExact("100000", [{ id: "a", driver: 1 }, { id: "b", driver: 1 }, { id: "c", driver: 1 }, { id: "d", driver: 1 }]);
    expect(lines.map((line) => line.amount)).toEqual(["25000.00", "25000.00", "25000.00", "25000.00"]);
    expect(assertAllocationProof("100000", lines.map((line) => line.amount)).proofZero).toBe(true);
  });

  it("prova balancete, consolidação e reconciliação sem ajuste silencioso", () => {
    expect(calculateTrialBalance([{ accountId: "caixa", normalBalance: "DEBIT", openingBalance: 100, debit: 20, credit: 5 }])[0].closingBalance).toBe("115.00");
    expect(calculateConsolidation({ individualAmount: "4000000", eliminationAmount: "2000000" }).consolidated).toBe("2000000.00");
    expect(calculateReconciliation("100000", "97000", "1000")).toMatchObject({ difference: "3000.00", material: true, status: "DIVERGENT" });
  });

  it("mantém VGV, recebível, caixa e receita separados", () => {
    expect(calculateRevenueRecognition({ vgv: 830000, receivable: 747000, cashReceived: 83000, recognitionRate: "0.25", allocatedUnitCost: 400000 })).toEqual({ vgv: "830000.00", receivable: "747000.00", cashReceived: "83000.00", recognizedRevenue: "207500.00", recognizedCost: "100000.00", margin: "107500.00" });
  });

  it("calcula tributo somente com política parametrizada", () => {
    expect(calculateConfiguredTax({ taxableBase: 100000, rate: "0.04" })).toBe("4000.00");
    expect(() => calculateConfiguredTax({ taxableBase: 100000, rate: "1.5" })).toThrow("configurada");
  });

  it("bloqueia lançamento em período fechado e fora da competência", () => {
    expect(() => assertPeriodAllowsPosting("CLOSED", new Date("2026-01-10"), new Date("2026-01-01"))).toThrow("não permite");
    expect(() => assertPeriodAllowsPosting("OPEN", new Date("2026-02-01"), new Date("2026-01-01"))).toThrow("não pertence");
    expect(() => assertPeriodAllowsPosting("OPEN", new Date("2026-01-10"), new Date("2026-01-01"))).not.toThrow();
  });
});
