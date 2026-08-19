import { describe, expect, it } from "vitest";
import { DEMO_PROJECT } from "@/domain/financial/demo";
import { calculateSensitivity } from "./engine";

const timestamp = "2026-08-17T12:00:00.000Z";

describe("Sensitivity Engine v1", () => {
  it("calculates the documented isolated matrix and combined stresses deterministically", () => {
    const first = calculateSensitivity(DEMO_PROJECT, "base", timestamp);
    const second = calculateSensitivity(DEMO_PROJECT, "base", timestamp);
    expect(first).toEqual(second);
    expect(first.cases).toHaveLength(30);
    expect(first.stresses.map((stress) => stress.key)).toEqual(["MODERATE", "SEVERE", "EXTREME"]);
    expect(first.baseScore.totalScore).toBe(45);
    expect(first.stresses.map((stress) => stress.score)).toEqual([38, 24, 12]);
    expect(first.breakEvens).toHaveLength(4);
    expect(first.breakEvens.find((item) => item.key === "SALES_START_DELAY")).toMatchObject({ status: "FOUND", value: 26 });
  });

  it("keeps isolated price and construction shocks economically monotonic", () => {
    const result = calculateSensitivity(DEMO_PROJECT, "base", timestamp);
    const prices = result.cases.filter((item) => item.variable === "SALE_PRICE");
    const construction = result.cases.filter((item) => item.variable === "CONSTRUCTION_COST");
    expect(prices.map((item) => Number(item.metrics.npv))).toEqual([...prices].map((item) => Number(item.metrics.npv)).sort((a, b) => a - b));
    expect(construction.map((item) => Number(item.metrics.npv))).toEqual([...construction].map((item) => Number(item.metrics.npv)).sort((a, b) => b - a));
  });

  it("makes each combined stress harsher than the previous one", () => {
    const result = calculateSensitivity(DEMO_PROJECT, "base", timestamp);
    const npvs = result.stresses.map((stress) => Number(stress.metrics.npv));
    const margins = result.stresses.map((stress) => Number(stress.metrics.marginOnVgv));
    expect(npvs[0]).toBeGreaterThan(npvs[1]);
    expect(npvs[1]).toBeGreaterThan(npvs[2]);
    expect(margins[0]).toBeGreaterThan(margins[1]);
    expect(margins[1]).toBeGreaterThan(margins[2]);
  });

  it("ranks variables by adverse score impact and reports valid break-even statuses", () => {
    const result = calculateSensitivity(DEMO_PROJECT, "base", timestamp);
    expect(result.ranking).toHaveLength(8);
    expect(result.ranking[0].scoreImpact).toBeGreaterThanOrEqual(result.ranking.at(-1)!.scoreImpact);
    expect(result.breakEvens.every((item) => ["FOUND", "NOT_REACHED", "BASE_FAILS_POLICY"].includes(item.status))).toBe(true);
  });
});
