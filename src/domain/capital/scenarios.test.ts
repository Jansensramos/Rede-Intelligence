import { describe, expect, it } from "vitest";
import type { BaseProjectEconomics } from "./comparator-engine";
import { simulateFundingScenario } from "./scenarios";
import type { CapitalNeedMonth, FundingProposalInput } from "./types";

const base: BaseProjectEconomics = {
  vgv: "1000000.00",
  profit: "200000.00",
  totalCost: "800000.00",
  operatingNetByMonth: [
    { month: 0, operatingNet: "-300000" },
    { month: 1, operatingNet: "-100000" },
    { month: 2, operatingNet: "-100000" },
    { month: 3, operatingNet: "-100000" },
    { month: 4, operatingNet: "800000" },
  ],
};

const capitalNeed: CapitalNeedMonth[] = base.operatingNetByMonth.map((row, index, all) => {
  const cumulative = all.slice(0, index + 1).reduce((sum, item) => sum + Number(item.operatingNet), 0);
  return { month: row.month, phase: "obra", projectCashBalance: cumulative.toFixed(2), deficit: cumulative < 0 ? (-cumulative).toFixed(2) : "0.00" };
});

const noFees = { upfrontFeeRate: "0", recurringFeeRateAnnual: "0" };
const proposalA: FundingProposalInput = { id: "A", providerName: "Banco A", kind: "BANCO", amount: "400000", indexer: "PRE_FIXADO", annualNominalRate: "14", termMonths: 4, graceMonths: 1, amortizationSystem: "SAC", fees: noFees };
const proposalB: FundingProposalInput = { id: "B", providerName: "Fundo B", kind: "FUNDO", amount: "200000", indexer: "CDI", annualNominalRate: "16", termMonths: 4, graceMonths: 0, amortizationSystem: "PRICE", fees: noFees };

describe("simulateFundingScenario", () => {
  it("NO_FUNDING não usa nenhuma proposta e reflete só o fluxo operacional 100% equity", () => {
    const scenario = simulateFundingScenario("NO_FUNDING", [proposalA], capitalNeed, base);
    expect(scenario.proposals).toEqual([]);
    expect(scenario.combinedImpact?.totalCostWithFinancing).toBe("800000.00");
  });

  it("EQUITY produz o mesmo resultado que NO_FUNDING (nenhuma dívida estruturada)", () => {
    const noFunding = simulateFundingScenario("NO_FUNDING", [], capitalNeed, base);
    const equity = simulateFundingScenario("EQUITY", [], capitalNeed, base);
    expect(equity.proposals).toEqual(noFunding.proposals);
    expect(equity.combinedImpact).toEqual(noFunding.combinedImpact);
  });

  it("DEBT com uma única proposta expõe o impacto combinado igual ao impacto individual", () => {
    const scenario = simulateFundingScenario("DEBT", [proposalA], capitalNeed, base);
    expect(scenario.proposals).toHaveLength(1);
    expect(scenario.combinedImpact).toEqual(scenario.proposals[0].impact);
  });

  it("PROPOSAL_COMPARISON com A e B não expõe combinedImpact único (decisão ainda em aberto)", () => {
    const scenario = simulateFundingScenario("PROPOSAL_COMPARISON", [proposalA, proposalB], capitalNeed, base);
    expect(scenario.proposals).toHaveLength(2);
    expect(scenario.combinedImpact).toBeNull();
  });

  it("HYBRID combina o serviço da dívida das duas propostas simultaneamente contra o operatingNet", () => {
    const scenario = simulateFundingScenario("HYBRID", [proposalA, proposalB], capitalNeed, base);
    const expectedTotalFinancingCost = scenario.proposals.reduce((sum, item) => sum + Number(item.totalCost), 0);
    expect(Number(scenario.combinedImpact!.totalCostWithFinancing)).toBeCloseTo(800000 + expectedTotalFinancingCost, 6);
  });

  it("é determinístico e não muta as propostas de entrada", () => {
    const proposalsBefore = JSON.parse(JSON.stringify([proposalA, proposalB]));
    const first = simulateFundingScenario("HYBRID", [proposalA, proposalB], capitalNeed, base);
    const second = simulateFundingScenario("HYBRID", [proposalA, proposalB], capitalNeed, base);
    expect(first).toEqual(second);
    expect([proposalA, proposalB]).toEqual(proposalsBefore);
  });
});
