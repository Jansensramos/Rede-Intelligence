import { describe, expect, it } from "vitest";
import { buildDebtServiceSchedule } from "./amortization";

const noFees = { upfrontFeeRate: "0", recurringFeeRateAnnual: "0" };

describe("buildDebtServiceSchedule", () => {
  it("SAC mantém a amortização constante e quita o saldo no último mês", () => {
    const rows = buildDebtServiceSchedule({ amount: "120000", annualNominalRate: "12", termMonths: 12, graceMonths: 0, amortizationSystem: "SAC", fees: noFees });
    const amortizingRows = rows.filter((row) => Number(row.amortization) > 0);
    const amounts = amortizingRows.slice(0, -1).map((row) => Number(row.amortization));
    for (const amount of amounts) expect(amount).toBeCloseTo(10000, 2);
    expect(Number(rows.at(-1)!.closingBalance)).toBeCloseTo(0, 6);
  });

  it("BULLET só paga juros até quitar o principal inteiro no último mês", () => {
    const rows = buildDebtServiceSchedule({ amount: "100000", annualNominalRate: "12", termMonths: 6, graceMonths: 0, amortizationSystem: "BULLET", fees: noFees });
    for (const row of rows.slice(0, -1)) expect(Number(row.amortization)).toBe(0);
    expect(Number(rows.at(-1)!.amortization)).toBeCloseTo(100000, 2);
    expect(Number(rows.at(-1)!.closingBalance)).toBeCloseTo(0, 6);
  });

  it("PRICE produz parcela (juros+amortização) constante fora da carência", () => {
    const rows = buildDebtServiceSchedule({ amount: "50000", annualNominalRate: "12", termMonths: 10, graceMonths: 0, amortizationSystem: "PRICE", fees: noFees });
    const installmentCore = rows.slice(1).map((row) => Number(row.interest) + Number(row.amortization));
    const first = installmentCore[0];
    for (const value of installmentCore) expect(value).toBeCloseTo(first, 2);
    expect(Number(rows.at(-1)!.closingBalance)).toBeCloseTo(0, 6);
  });

  it("carência posterga a amortização mas ainda acumula juros sobre o saldo devedor", () => {
    const rows = buildDebtServiceSchedule({ amount: "100000", annualNominalRate: "12", termMonths: 12, graceMonths: 3, amortizationSystem: "SAC", fees: noFees });
    for (const row of rows.slice(0, 3)) expect(Number(row.amortization)).toBe(0);
    expect(Number(rows[1].interest)).toBeGreaterThan(0);
    expect(Number(rows.at(-1)!.closingBalance)).toBeCloseTo(0, 6);
  });

  it("é determinístico: mesma entrada produz o mesmo cronograma", () => {
    const input = { amount: "75000", annualNominalRate: "15", termMonths: 24, graceMonths: 2, amortizationSystem: "PRICE" as const, fees: { upfrontFeeRate: "1", recurringFeeRateAnnual: "0.5" } };
    expect(buildDebtServiceSchedule(input)).toEqual(buildDebtServiceSchedule(input));
  });

  it("respeita um cronograma de desembolso em múltiplas parcelas", () => {
    const rows = buildDebtServiceSchedule({
      amount: "100000",
      annualNominalRate: "12",
      termMonths: 6,
      graceMonths: 2,
      amortizationSystem: "SAC",
      fees: noFees,
      disbursementSchedule: [{ month: 0, amount: "60000" }, { month: 1, amount: "40000" }],
    });
    expect(Number(rows[0].openingBalance)).toBeCloseTo(60000, 2);
    expect(Number(rows[1].openingBalance)).toBeCloseTo(60000 + 40000, 2);
  });
});
