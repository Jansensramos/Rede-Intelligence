import { describe, expect, it } from "vitest";
import { validateStructuredOutput } from "./output-schema";
import type { AiOutputSchemaRef } from "./types";

const REF: AiOutputSchemaRef = { name: "gateway.synthetic.text_summary", version: "1" };

describe("validateStructuredOutput", () => {
  it("aceita payload conforme o schema", () => {
    const result = validateStructuredOutput(REF, { summary: "ok", confidence: "HIGH" });
    expect(result).toEqual({ ok: true, data: { summary: "ok", confidence: "HIGH" } });
  });

  it("rejeita schema desconhecido", () => {
    expect(validateStructuredOutput({ name: "nao-existe", version: "1" }, {})).toEqual({ ok: false, reason: "SCHEMA_UNKNOWN" });
  });

  it("rejeita campo extra (strict)", () => {
    const result = validateStructuredOutput(REF, { summary: "ok", confidence: "HIGH", extra: "campo nao declarado" });
    expect(result).toEqual({ ok: false, reason: "SCHEMA_MISMATCH" });
  });

  it("rejeita enum fora do conjunto fechado", () => {
    const result = validateStructuredOutput(REF, { summary: "ok", confidence: "VERY_HIGH" });
    expect(result).toEqual({ ok: false, reason: "SCHEMA_MISMATCH" });
  });

  it("rejeita numero nao finito (Infinity/NaN) mesmo antes do parse do schema", () => {
    expect(validateStructuredOutput(REF, { summary: "ok", confidence: "HIGH", score: Number.POSITIVE_INFINITY })).toEqual({ ok: false, reason: "NON_FINITE_NUMBER" });
    expect(validateStructuredOutput(REF, { summary: "ok", confidence: "HIGH", score: Number.NaN })).toEqual({ ok: false, reason: "NON_FINITE_NUMBER" });
  });

  it("rejeita JSON profundo demais antes de tentar o parse do schema", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < 20; i += 1) deep = { nested: deep };
    expect(validateStructuredOutput(REF, deep)).toEqual({ ok: false, reason: "TOO_DEEP" });
  });

  it("rejeita payload maior que o limite de bytes", () => {
    const result = validateStructuredOutput(REF, { summary: "x".repeat(300_000), confidence: "HIGH" });
    expect(result).toEqual({ ok: false, reason: "TOO_LARGE" });
  });

  it("nunca repara silenciosamente — schema mismatch nunca retorna ok:true com dado corrigido", () => {
    const result = validateStructuredOutput(REF, { summary: 123, confidence: "HIGH" });
    expect(result.ok).toBe(false);
  });
});
