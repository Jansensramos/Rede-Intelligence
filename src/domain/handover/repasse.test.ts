import { describe, expect, it } from "vitest";
import { evaluateDisbursementReconciliation } from "./repasse";

describe("conciliação de repasse bancário (Fase 9R) — regra pura", () => {
  it("concilia quando o valor liberado é exatamente igual à parcela", () => {
    const result = evaluateDisbursementReconciliation({ disbursedAmount: "300000.00", installmentAmount: "300000.00" });
    expect(result).toEqual({ matches: true, differenceCents: 0 });
  });

  it("diverge com 1 centavo de diferença por padrão (tolerância zero) — nunca ajusta silenciosamente", () => {
    const result = evaluateDisbursementReconciliation({ disbursedAmount: "300000.01", installmentAmount: "300000.00" });
    expect(result.matches).toBe(false);
    expect(result.differenceCents).toBe(1);
  });

  it("diverge quando o valor liberado é menor que o esperado", () => {
    const result = evaluateDisbursementReconciliation({ disbursedAmount: "299000.00", installmentAmount: "300000.00" });
    expect(result.matches).toBe(false);
    expect(result.differenceCents).toBe(-100000);
  });

  it("respeita tolerância explícita quando informada", () => {
    const result = evaluateDisbursementReconciliation({ disbursedAmount: "300000.05", installmentAmount: "300000.00", toleranceCents: 10 });
    expect(result.matches).toBe(true);
    expect(result.differenceCents).toBe(5);
  });

  it("precisão decimal.js evita erro de ponto flutuante em valores grandes", () => {
    const result = evaluateDisbursementReconciliation({ disbursedAmount: "1234567.89", installmentAmount: "1234567.89" });
    expect(result).toEqual({ matches: true, differenceCents: 0 });
  });
});
