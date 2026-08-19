import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { DEMO_PROJECT } from "./demo";
import { calculateAllScenarios, calculateProject } from "./engine";
import { irr, normalizedConstructionWeights, npv } from "./math";

describe("financial math", () => {
  it("normalizes the construction curve without losing value", () => {
    const weights = normalizedConstructionWeights(18);
    const total = weights.reduce((sum, value) => sum.plus(value), new Decimal(0));
    expect(weights).toHaveLength(18);
    expect(total.toNumber()).toBeCloseTo(1, 12);
    expect(weights[8].gt(weights[0])).toBe(true);
  });

  it("calculates NPV for a known two-period flow", () => {
    const result = npv([new Decimal(-100), new Decimal(110)], new Decimal("0.10"));
    expect(result.abs().toNumber()).toBeLessThan(0.0000001);
  });

  it("calculates IRR for a known two-period flow", () => {
    const result = irr([new Decimal(-100), new Decimal(110)]);
    expect(result).not.toBeNull();
    expect(result!.toNumber()).toBeCloseTo(0.1, 8);
  });
});

describe("REDE Engine", () => {
  it("derives VGV and area from the documented formulas", () => {
    const result = calculateProject(DEMO_PROJECT, "base", "2026-08-17T12:00:00.000Z");
    expect(result.metrics.vgv).toBe("15560000.00");
    expect(result.metrics.totalPrivateAreaM2).toBe("2000");
    expect(Number(result.metrics.grossBuiltAreaM2)).toBeCloseTo(2777.77777778, 6);
    expect(result.engineVersion).toBe("1.0.0");
  });

  it("reconciles sales, receipts and cost components", () => {
    const result = calculateProject(DEMO_PROJECT);
    const sum = (field: keyof typeof result.cashFlow[number]) => result.cashFlow.reduce((total, row) => {
      const value = row[field];
      return typeof value === "string" ? total.plus(value) : total;
    }, new Decimal(0));
    expect(sum("salesValue").toNumber()).toBeCloseTo(Number(result.metrics.vgv), 2);
    expect(sum("receipts").toNumber()).toBeCloseTo(Number(result.metrics.vgv), 2);
    expect(sum("constructionCost").toNumber()).toBeCloseTo(Number(result.metrics.constructionCost), 2);
    expect(sum("commission").toNumber()).toBeCloseTo(Number(result.metrics.commission), 2);
    expect(sum("taxes").toNumber()).toBeCloseTo(Number(result.metrics.taxes), 2);
  });

  it("reconciles profit with the final equity flow when debt is repaid", () => {
    const result = calculateProject(DEMO_PROJECT);
    const equityTotal = result.cashFlow.reduce((total, row) => total.plus(row.equityFlow), new Decimal(0));
    expect(equityTotal.toNumber()).toBeCloseTo(Number(result.metrics.profit), 2);
    expect(new Decimal(result.cashFlow.at(-1)?.outstandingDebt ?? "1").eq(0)).toBe(true);
  });

  it("reconciles the persisted funding need with financing draws", () => {
    const result = calculateProject(DEMO_PROJECT);
    const draws = result.cashFlow.reduce((total, row) => total.plus(row.financingDraw), new Decimal(0));
    expect(draws.toNumber()).toBeCloseTo(Number(result.metrics.fundingNeed), 2);
  });

  it("keeps every important aggregate in the audit trail", () => {
    const result = calculateProject(DEMO_PROJECT);
    expect(result.auditTrail.map((item) => item.metric)).toEqual(expect.arrayContaining([
      "vgv", "constructionCost", "profit", "maximumCashExposure", "roi", "annualIrr", "breakEvenVgv",
    ]));
    expect(result.auditTrail.every((item) => item.engineVersion === result.engineVersion)).toBe(true);
  });

  it("makes the conservative scenario strictly harsher than base for key metrics", () => {
    const scenarios = calculateAllScenarios(DEMO_PROJECT, "2026-08-17T12:00:00.000Z");
    expect(Number(scenarios.conservative.metrics.vgv)).toBeLessThan(Number(scenarios.base.metrics.vgv));
    expect(Number(scenarios.conservative.metrics.constructionCost)).toBeGreaterThan(Number(scenarios.base.metrics.constructionCost));
    expect(Number(scenarios.conservative.metrics.profit)).toBeLessThan(Number(scenarios.base.metrics.profit));
    expect(scenarios.conservative.metrics.deliveryMonth).toBeGreaterThan(scenarios.base.metrics.deliveryMonth);
  });

  it("rejects payment terms that do not total 100 percent", () => {
    expect(() => calculateProject({ ...DEMO_PROJECT, downPaymentRate: "11" })).toThrow(/somar 100%/);
  });
});
