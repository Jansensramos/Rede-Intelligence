import { describe, expect, it } from "vitest";
import { parseTrustedProxyHops, resolveTrustedClientAddress, UNKNOWN_CLIENT_ADDRESS } from "./trusted-proxy";

function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null };
}

describe("política de proxy confiável", () => {
  it("ignora headers encaminhados quando nenhum proxy é confiável", () => {
    expect(resolveTrustedClientAddress(headers({ "x-forwarded-for": "203.0.113.9" }), 0)).toBe(UNKNOWN_CLIENT_ADDRESS);
  });

  it("resolve IPv4 e IPv6 pelo número explícito de saltos", () => {
    expect(resolveTrustedClientAddress(headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.2" }), 2)).toBe("203.0.113.9");
    expect(resolveTrustedClientAddress(headers({ "x-forwarded-for": "2001:db8::1" }), 1)).toBe("[2001:db8::1]".slice(1, -1));
  });

  it.each(["203.0.113.9, inválido", "999.1.1.1", "1.2.3.4,", "for=1.2.3.4"])("rejeita cadeia malformada: %s", (value) => {
    expect(resolveTrustedClientAddress(headers({ "x-forwarded-for": value }), 1)).toBe(UNKNOWN_CLIENT_ADDRESS);
  });

  it("rejeita cadeia menor que a quantidade de proxies configurada", () => {
    expect(resolveTrustedClientAddress(headers({ "x-forwarded-for": "203.0.113.9" }), 2)).toBe(UNKNOWN_CLIENT_ADDRESS);
  });

  it("não lança diante de getter hostil", () => {
    const hostile = { get: () => { throw new Error("valor hostil"); } };
    expect(resolveTrustedClientAddress(hostile, 1)).toBe(UNKNOWN_CLIENT_ADDRESS);
  });

  it("falha fechado com configuração inválida", () => {
    expect(() => parseTrustedProxyHops("-1")).toThrow("Configuração de proxy confiável inválida.");
    expect(() => parseTrustedProxyHops("onze")).toThrow("Configuração de proxy confiável inválida.");
    expect(parseTrustedProxyHops(undefined)).toBe(0);
  });
});
