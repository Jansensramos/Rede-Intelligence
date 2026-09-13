import { describe, expect, it } from "vitest";
import { isSafeIdempotencyKey } from "./idempotency-key";

describe("isSafeIdempotencyKey — correcao focal (achado MEDIO)", () => {
  it("aceita a chave real usada pelo unico chamador hoje", () => {
    expect(isSafeIdempotencyKey("cly1a2b3c4d5:generate")).toBe(true);
  });

  it("rejeita string vazia", () => expect(isSafeIdempotencyKey("")).toBe(false));
  it("rejeita string só de espaços", () => expect(isSafeIdempotencyKey("   ")).toBe(false));
  it("rejeita espaço inicial", () => expect(isSafeIdempotencyKey(" abc")).toBe(false));
  it("rejeita espaço final", () => expect(isSafeIdempotencyKey("abc ")).toBe(false));
  it("rejeita NUL", () => expect(isSafeIdempotencyKey(`abc${String.fromCharCode(0)}def`)).toBe(false));
  it("rejeita CR/LF", () => expect(isSafeIdempotencyKey("abc\r\ndef")).toBe(false));
  it("rejeita DEL (0x7F)", () => expect(isSafeIdempotencyKey(`abc${String.fromCharCode(127)}def`)).toBe(false));
  it("rejeita outros controles", () => expect(isSafeIdempotencyKey(`abc${String.fromCharCode(7)}def`)).toBe(false));
  it("rejeita chave acima do comprimento maximo (201 chars)", () => expect(isSafeIdempotencyKey("a".repeat(201))).toBe(false));
  it("aceita chave no limite exato (200 chars)", () => expect(isSafeIdempotencyKey("a".repeat(200))).toBe(true));
  it("rejeita Unicode bidi/zero-width", () => {
    expect(isSafeIdempotencyKey("abc‮def")).toBe(false);
    expect(isSafeIdempotencyKey("abc​def")).toBe(false);
  });
  it("rejeita URL (barra nao faz parte do charset)", () => expect(isSafeIdempotencyKey("https://evil.test/x")).toBe(false));
  it("rejeita tipos hostis: objeto, array, bigint, numero", () => {
    expect(isSafeIdempotencyKey({ toString: () => "x" })).toBe(false);
    expect(isSafeIdempotencyKey(["x"])).toBe(false);
    expect(isSafeIdempotencyKey(BigInt(1))).toBe(false);
    expect(isSafeIdempotencyKey(123)).toBe(false);
  });
  it("não normaliza — duas chaves diferentes nunca convergem: aceita/rejeita cada uma pelo proprio conteudo", () => {
    expect(isSafeIdempotencyKey("Key-A")).toBe(true);
    expect(isSafeIdempotencyKey("key-a")).toBe(true);
    // ambas validas e DIFERENTES entre si (case-sensitive, sem fold) - a igualdade de
    // chave e responsabilidade da constraint unica do banco, nunca deste validador.
    const a: string = "Key-A";
    const b: string = "key-a";
    expect(a === b).toBe(false);
  });
  it("aceita charset documentado: alfanumerico, dois-pontos, underscore, ponto, hifen", () => {
    expect(isSafeIdempotencyKey("a1:b2_c3.d4-e5")).toBe(true);
  });
  it("rejeita primeiro caractere fora de alfanumerico", () => {
    expect(isSafeIdempotencyKey(":abc")).toBe(false);
    expect(isSafeIdempotencyKey("-abc")).toBe(false);
    expect(isSafeIdempotencyKey(".abc")).toBe(false);
  });
});
