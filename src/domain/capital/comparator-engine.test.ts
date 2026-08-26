import { describe, expect, it } from "vitest";
import { compareFundingProposal, compareFundingProposals, type BaseProjectEconomics } from "./comparator-engine";
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

function proposal(overrides: Partial<FundingProposalInput> = {}): FundingProposalInput {
  return {
    id: "prop-1",
    providerName: "Banco X",
    kind: "BANCO",
    amount: "400000",
    indexer: "PRE_FIXADO",
    annualNominalRate: "14",
    termMonths: 4,
    graceMonths: 1,
    amortizationSystem: "SAC",
    fees: noFees,
    ...overrides,
  };
}

describe("compareFundingProposal", () => {
  it("custo total é a soma de juros e fees do cronograma de serviço da dívida", () => {
    const result = compareFundingProposal(proposal(), capitalNeed, base);
    const expectedTotalCost = result.debtService.reduce((sum, row) => sum + Number(row.interest) + Number(row.fees), 0);
    expect(Number(result.totalCost)).toBeCloseTo(expectedTotalCost, 6);
  });

  it("pico de dívida nunca excede o valor contratado (sem juros capitalizados)", () => {
    const result = compareFundingProposal(proposal(), capitalNeed, base);
    expect(Number(result.peakDebt)).toBeLessThanOrEqual(400000.01);
  });

  it("o custo com financiamento aumenta o custo total do projeto na mesma magnitude do serviço da dívida", () => {
    const result = compareFundingProposal(proposal(), capitalNeed, base);
    expect(Number(result.impact.totalCostWithFinancing)).toBeCloseTo(800000 + Number(result.totalCost), 6);
  });

  it("é determinístico: mesma proposta produz o mesmo resultado", () => {
    const a = compareFundingProposal(proposal(), capitalNeed, base);
    const b = compareFundingProposal(proposal(), capitalNeed, base);
    expect(a).toEqual(b);
  });

  it("nunca muta os objetos de entrada (capitalNeed/base ficam intactos)", () => {
    const capitalNeedBefore = JSON.parse(JSON.stringify(capitalNeed));
    const baseBefore = JSON.parse(JSON.stringify(base));
    compareFundingProposal(proposal(), capitalNeed, base);
    expect(capitalNeed).toEqual(capitalNeedBefore);
    expect(base).toEqual(baseBefore);
  });

  it("sinaliza risco quando a TIR do projeto fica negativa com a estrutura proposta", () => {
    const expensive = proposal({ amount: "900000", annualNominalRate: "80", termMonths: 4, graceMonths: 0 });
    const result = compareFundingProposal(expensive, capitalNeed, base);
    expect(result.riskFlags.length).toBeGreaterThan(0);
  });
});

describe("compareFundingProposals", () => {
  it("compara A vs B preservando a ordem de entrada", () => {
    const proposalA = proposal({ id: "A", providerName: "Banco A" });
    const proposalB = proposal({ id: "B", providerName: "Fundo B", annualNominalRate: "18" });
    const results = compareFundingProposals([proposalA, proposalB], capitalNeed, base);
    expect(results.map((item) => item.proposalId)).toEqual(["A", "B"]);
    expect(Number(results[1].nominalAnnualCost)).toBeGreaterThan(Number(results[0].nominalAnnualCost));
  });
});
