import { describe, expect, it } from "vitest";
import { isSafeCostUsdMicros, MAX_SAFE_COST_USD_MICROS } from "./cost";

describe("isSafeCostUsdMicros — correcao focal (achado MEDIO)", () => {
  it("aceita zero (custo legitimo quando permitido)", () => expect(isSafeCostUsdMicros(0)).toBe(true));
  it("aceita inteiro positivo comum", () => expect(isSafeCostUsdMicros(10_000_000)).toBe(true));
  it("rejeita -1", () => expect(isSafeCostUsdMicros(-1)).toBe(false));
  it("rejeita o minimo negativo representavel", () => expect(isSafeCostUsdMicros(Number.MIN_SAFE_INTEGER)).toBe(false));
  it("rejeita NaN", () => expect(isSafeCostUsdMicros(Number.NaN)).toBe(false));
  it("rejeita Infinity e -Infinity", () => {
    expect(isSafeCostUsdMicros(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isSafeCostUsdMicros(Number.NEGATIVE_INFINITY)).toBe(false);
  });
  it("rejeita decimal fracionario", () => expect(isSafeCostUsdMicros(1.5)).toBe(false));
  it("rejeita string numerica (sem coercao)", () => expect(isSafeCostUsdMicros("1000" as unknown)).toBe(false));
  it("rejeita bigint", () => expect(isSafeCostUsdMicros(BigInt(1000))).toBe(false));
  it("aceita exatamente o limite maximo", () => expect(isSafeCostUsdMicros(MAX_SAFE_COST_USD_MICROS)).toBe(true));
  it("rejeita acima do limite maximo", () => expect(isSafeCostUsdMicros(MAX_SAFE_COST_USD_MICROS + 1)).toBe(false));
});
