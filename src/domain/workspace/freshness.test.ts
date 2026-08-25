import { describe, expect, it } from "vitest";
import { latestTimestamp, resolveDomainFreshness } from "./freshness";

describe("latestTimestamp", () => {
  it("devolve null para lista vazia ou só nulos", () => {
    expect(latestTimestamp([])).toBeNull();
    expect(latestTimestamp([null, undefined, null])).toBeNull();
  });

  it("devolve a data mais recente, ignorando null/undefined misturados", () => {
    const old = new Date("2026-01-01T00:00:00.000Z");
    const recent = new Date("2026-08-20T00:00:00.000Z");
    expect(latestTimestamp([old, null, recent, undefined])).toBe(recent);
  });
});

describe("resolveDomainFreshness (9K.2, fechamento — gate 3: freshness real)", () => {
  const referenceDate = new Date("2026-08-25T12:00:00.000Z");

  it("com timestamp real de fonte, é 'source_updated' e NUNCA usa o instante da leitura", () => {
    const old = new Date("2026-06-01T00:00:00.000Z");
    const result = resolveDomainFreshness(old, referenceDate, true);
    expect(result.kind).toBe("source_updated");
    expect(result.updatedAt).toBe(old.toISOString());
    expect(result.updatedAt).not.toBe(referenceDate.toISOString());
    expect(result.queriedAt).toBeUndefined();
  });

  it("um registro antigo não aparece como se tivesse sido atualizado agora (regressão do bug original)", () => {
    const veryOld = new Date("2020-01-01T00:00:00.000Z");
    const result = resolveDomainFreshness(veryOld, referenceDate, true);
    expect(result.updatedAt).toBe("2020-01-01T00:00:00.000Z");
  });

  it("sem timestamp de fonte, mas com valor computável ao vivo, é 'queried_now' (nunca 'Atualizado agora')", () => {
    const result = resolveDomainFreshness(null, referenceDate, true);
    expect(result.kind).toBe("queried_now");
    expect(result.queriedAt).toBe(referenceDate.toISOString());
    expect(result.updatedAt).toBeUndefined();
  });

  it("sem timestamp e sem nenhum valor computável, é 'unavailable' — não inventa nem 'consultado agora'", () => {
    const result = resolveDomainFreshness(null, referenceDate, false);
    expect(result.kind).toBe("unavailable");
    expect(result.updatedAt).toBeUndefined();
    expect(result.queriedAt).toBeUndefined();
  });
});
