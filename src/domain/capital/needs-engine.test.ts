import { describe, expect, it } from "vitest";
import { DEMO_PROJECT } from "@/domain/financial/demo";
import { calculateProject } from "@/domain/financial/engine";
import { computeCapitalNeed } from "./needs-engine";

describe("computeCapitalNeed", () => {
  const result = calculateProject(DEMO_PROJECT, "base", "2026-08-17T12:00:00.000Z");

  it("usa a exposição máxima da Base Aprovada como necessidade total, sem recalcular nada", () => {
    const need = computeCapitalNeed(result.cashFlow, result.metrics);
    expect(need.totalCapitalNeed).toBe(result.metrics.maximumCashExposure);
    expect(need.peakExposureMonth).toBe(result.metrics.maximumExposureMonth);
  });

  it("é determinístico: mesma entrada produz o mesmo resultado", () => {
    const a = computeCapitalNeed(result.cashFlow, result.metrics, "500000", "100000");
    const b = computeCapitalNeed(result.cashFlow, result.metrics, "500000", "100000");
    expect(a).toEqual(b);
  });

  it("marca déficit somente nos meses com caixa de projeto negativo", () => {
    const need = computeCapitalNeed(result.cashFlow, result.metrics);
    const negativeMonths = result.cashFlow.filter((row) => Number(row.cumulativeProjectCash) < 0).map((row) => row.month);
    expect(need.deficitMonths).toEqual(negativeMonths);
  });

  it("abate equity contribuído e funding já desembolsado da necessidade ainda em aberto", () => {
    const totalNeed = Number(result.metrics.maximumCashExposure);
    const need = computeCapitalNeed(result.cashFlow, result.metrics, String(totalNeed), "0");
    expect(need.fundingStillNeeded).toBe("0.00");
    expect(need.fullyCovered).toBe(true);
  });

  it("nunca produz necessidade ainda em aberto negativa quando a cobertura excede o total", () => {
    const totalNeed = Number(result.metrics.maximumCashExposure);
    const need = computeCapitalNeed(result.cashFlow, result.metrics, String(totalNeed * 2), "0");
    expect(Number(need.fundingStillNeeded)).toBe(0);
  });
});
