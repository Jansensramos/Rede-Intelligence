import { describe, expect, it } from "vitest";
import { buildExceptionId, highestSeverity, sortExceptionsByPriority, summarizeExceptionsBySeverity, type ExecutiveException } from "./exceptions";

function exception(overrides: Partial<ExecutiveException>): ExecutiveException {
  return {
    id: "id",
    organizationId: "org-1",
    domain: "financial",
    type: "payable_due",
    title: "t",
    summary: "s",
    severity: "ATENCAO",
    confidence: "ALTA",
    source: "REDE",
    occurredAt: "2026-08-25T00:00:00.000Z",
    href: "/financeiro",
    reason: "r",
    status: "ABERTA",
    evidence: [],
    ...overrides,
  };
}

describe("buildExceptionId (9K.2, plano §AQ aplicado à leitura executiva)", () => {
  it("é determinístico: mesma entrada produz o mesmo id", () => {
    const a = buildExceptionId("org-1", "legal", "obligation_due", "obl-1");
    const b = buildExceptionId("org-1", "legal", "obligation_due", "obl-1");
    expect(a).toBe(b);
  });

  it("muda se qualquer componente mudar", () => {
    const base = buildExceptionId("org-1", "legal", "obligation_due", "obl-1");
    expect(buildExceptionId("org-2", "legal", "obligation_due", "obl-1")).not.toBe(base);
    expect(buildExceptionId("org-1", "financial", "obligation_due", "obl-1")).not.toBe(base);
    expect(buildExceptionId("org-1", "legal", "license_expiring", "obl-1")).not.toBe(base);
    expect(buildExceptionId("org-1", "legal", "obligation_due", "obl-2")).not.toBe(base);
  });

  it("aceita período opcional para itens recorrentes", () => {
    const withPeriod = buildExceptionId("org-1", "accounting", "period_open", "period-1", "2026-08");
    expect(withPeriod).toBe("org-1:accounting:period_open:period-1:2026-08");
  });
});

describe("sortExceptionsByPriority (plano §N — motor determinístico, nunca a IA decide a ordem)", () => {
  it("ordena por severidade decrescente primeiro (CRÍTICO no topo)", () => {
    const items = [exception({ id: "1", severity: "ATENCAO" }), exception({ id: "2", severity: "CRITICO" }), exception({ id: "3", severity: "NORMAL" })];
    const sorted = sortExceptionsByPriority(items);
    expect(sorted.map((item) => item.id)).toEqual(["2", "1", "3"]);
  });

  it("dentro da mesma severidade, ordena por materialidade decrescente", () => {
    const items = [
      exception({ id: "low", severity: "CRITICO", materialityValue: 1000 }),
      exception({ id: "high", severity: "CRITICO", materialityValue: 50000 }),
      exception({ id: "none", severity: "CRITICO", materialityValue: null }),
    ];
    const sorted = sortExceptionsByPriority(items);
    expect(sorted.map((item) => item.id)).toEqual(["high", "low", "none"]);
  });

  it("dentro da mesma severidade e sem materialidade, ordena por prazo mais próximo primeiro", () => {
    const items = [
      exception({ id: "far", severity: "DECISAO", dueDate: "2026-12-01T00:00:00.000Z" }),
      exception({ id: "near", severity: "DECISAO", dueDate: "2026-09-01T00:00:00.000Z" }),
      exception({ id: "none", severity: "DECISAO", dueDate: null }),
    ];
    const sorted = sortExceptionsByPriority(items);
    expect(sorted.map((item) => item.id)).toEqual(["near", "far", "none"]);
  });

  it("não muta o array original", () => {
    const items = [exception({ id: "1", severity: "NORMAL" }), exception({ id: "2", severity: "CRITICO" })];
    const copy = [...items];
    sortExceptionsByPriority(items);
    expect(items).toEqual(copy);
  });
});

describe("summarizeExceptionsBySeverity / highestSeverity", () => {
  it("conta cada severidade, incluindo zero para as ausentes", () => {
    const summary = summarizeExceptionsBySeverity([exception({ severity: "CRITICO" }), exception({ severity: "CRITICO" }), exception({ severity: "ATENCAO" })]);
    expect(summary).toEqual({ NORMAL: 0, ATENCAO: 1, ACAO_NECESSARIA: 0, DECISAO: 0, CRITICO: 2 });
  });

  it("lista vazia não gera severidade crítica falsa (nunca some 'sem dados' com zero problemas)", () => {
    expect(summarizeExceptionsBySeverity([])).toEqual({ NORMAL: 0, ATENCAO: 0, ACAO_NECESSARIA: 0, DECISAO: 0, CRITICO: 0 });
    expect(highestSeverity([])).toBe("NORMAL");
  });

  it("highestSeverity devolve a pior presente", () => {
    expect(highestSeverity([exception({ severity: "ATENCAO" }), exception({ severity: "DECISAO" }), exception({ severity: "ACAO_NECESSARIA" })])).toBe("DECISAO");
  });
});
