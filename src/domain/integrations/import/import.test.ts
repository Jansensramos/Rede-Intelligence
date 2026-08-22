import { describe, expect, it } from "vitest";
import { applyMappingAndValidate } from "./mapping";
import { parseGenericCsv } from "./csv";
import { parseGenericJson } from "./json";
import { parseGenericXml } from "./xml";
import { buildXlsx, parseXlsx } from "./xlsx";
import { createZip, readZip } from "./zip";
import { parseImportFile } from ".";

describe("importador universal — CSV genérico", () => {
  it("detecta cabeçalho, separador e mantém linhas independentes mesmo com uma malformada", () => {
    const content = "nome;email;cnpj\nAna;ana@x.com;12.345.678/0001-90\nBeto;beto@x.com\nCarla;carla@x.com;99.999.999/0001-99\n";
    const report = parseGenericCsv(content);
    expect(report.columns).toEqual(["nome", "email", "cnpj"]);
    expect(report.rows).toHaveLength(2);
    expect(report.structuralErrors).toHaveLength(1);
    expect(report.structuralErrors[0].index).toBe(2);
  });
});

describe("importador universal — JSON genérico", () => {
  it("aceita array de objetos e { rows: [...] }", () => {
    const asArray = parseGenericJson(JSON.stringify([{ nome: "Ana" }, { nome: "Beto" }]));
    expect(asArray.rows).toHaveLength(2);
    const asWrapped = parseGenericJson(JSON.stringify({ rows: [{ nome: "Carla" }] }));
    expect(asWrapped.rows).toHaveLength(1);
  });

  it("rejeita chaves de poluição de protótipo sem quebrar o restante da linha", () => {
    // JSON.stringify de um literal com chave "__proto__" não a serializa (define o protótipo em vez de
    // uma propriedade própria) — por isso a string JSON é montada diretamente para simular um payload malicioso real.
    const report = parseGenericJson('[{"nome":"Ana","__proto__":{"polluted":true}}]');
    expect(Object.prototype.hasOwnProperty.call(report.rows[0].raw, "__proto__")).toBe(false);
    expect(report.structuralErrors.some((error) => error.message.includes("__proto__"))).toBe(true);
  });

  it("rejeita JSON malformado sem lançar exceção", () => {
    const report = parseGenericJson("{ not json");
    expect(report.rows).toHaveLength(0);
    expect(report.structuralErrors[0].message).toContain("inválido");
  });
});

describe("importador universal — XML genérico e seguro (sem XXE)", () => {
  it("extrai linhas de <row> com campos filhos", () => {
    const xml = "<rows><row><nome>Ana</nome><cnpj>12.345.678/0001-90</cnpj></row><row><nome>Beto</nome><cnpj>99.999.999/0001-99</cnpj></row></rows>";
    const report = parseGenericXml(xml);
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0].raw).toEqual({ nome: "Ana", cnpj: "12.345.678/0001-90" });
  });

  it("nunca expande entidade externa (DOCTYPE/ENTITY removidos antes do parsing)", () => {
    const malicious = `<?xml version="1.0"?><!DOCTYPE rows [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rows><row><nome>&xxe;</nome></row></rows>`;
    const report = parseGenericXml(malicious);
    expect(report.rows).toHaveLength(1);
    // a entidade não é resolvida: o texto literal "&xxe;" permanece, nunca vira conteúdo de arquivo local
    expect(report.rows[0].raw.nome).toBe("&xxe;");
  });
});

describe("importador universal — ZIP mínimo (base do XLSX)", () => {
  it("escreve e lê de volta um ZIP com múltiplas entradas", () => {
    const zip = createZip([{ name: "a.txt", data: Buffer.from("hello") }, { name: "b.txt", data: Buffer.from("world") }]);
    const entries = readZip(zip, { maxEntryUncompressedBytes: 1000, maxTotalUncompressedBytes: 10_000 });
    expect(entries.get("a.txt")?.toString()).toBe("hello");
    expect(entries.get("b.txt")?.toString()).toBe("world");
  });

  it("bloqueia entrada que excede o limite por arquivo (proteção contra zip bomb)", () => {
    const zip = createZip([{ name: "big.txt", data: Buffer.alloc(2000, "x") }]);
    expect(() => readZip(zip, { maxEntryUncompressedBytes: 100, maxTotalUncompressedBytes: 10_000 })).toThrow(/zip bomb|limite/i);
  });
});

describe("importador universal — XLSX real (sem dependência externa)", () => {
  it("escreve e lê de volta um XLSX genuíno (OOXML válido)", () => {
    const buffer = buildXlsx(["nome", "cnpj"], [["Ana", "12.345.678/0001-90"], ["Beto", "99.999.999/0001-99"]]);
    const report = parseXlsx(buffer);
    expect(report.columns).toEqual(["nome", "cnpj"]);
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0].raw).toEqual({ nome: "Ana", cnpj: "12.345.678/0001-90" });
    expect(report.rows[1].raw).toEqual({ nome: "Beto", cnpj: "99.999.999/0001-99" });
  });

  it("rejeita arquivo que não é um ZIP válido sem lançar exceção", () => {
    const report = parseXlsx(Buffer.from("not a zip file"));
    expect(report.rows).toHaveLength(0);
    expect(report.structuralErrors.length).toBeGreaterThan(0);
  });
});

describe("parseImportFile — despacho por formato", () => {
  it("resolve os quatro formatos pelo mesmo ponto de entrada", () => {
    expect(parseImportFile("CSV", "a,b\n1,2\n").rows).toHaveLength(1);
    expect(parseImportFile("JSON", JSON.stringify([{ a: 1 }])).rows).toHaveLength(1);
    expect(parseImportFile("XML", "<rows><row><a>1</a></row></rows>").rows).toHaveLength(1);
    expect(parseImportFile("XLSX", buildXlsx(["a"], [["1"]])).rows).toHaveLength(1);
  });
});

describe("mapping e validação genérica", () => {
  it("mapeia campos de origem para campos REDE e valida tipos, mantendo linhas independentes", () => {
    const rows = [
      { index: 1, raw: { nome_erp: "Ana", cnpj_erp: "12.345.678/0001-90", valor_erp: "1.234,56" } },
      { index: 2, raw: { nome_erp: "", cnpj_erp: "99.999.999/0001-99", valor_erp: "100" } }, // nome obrigatório ausente
      { index: 3, raw: { nome_erp: "Carla", cnpj_erp: "11.111.111/0001-11", valor_erp: "não é número" } },
    ];
    const rules = [
      { sourceField: "nome_erp", targetField: "name", required: true, type: "string" as const },
      { sourceField: "cnpj_erp", targetField: "taxId", required: true, type: "string" as const },
      { sourceField: "valor_erp", targetField: "amount", type: "number" as const },
    ];
    const report = applyMappingAndValidate(rows, rules);
    expect(report.accepted).toHaveLength(1);
    expect(report.accepted[0].data).toEqual({ name: "Ana", taxId: "12.345.678/0001-90", amount: 1234.56 });
    expect(report.rejected).toHaveLength(2);
    expect(report.rejected[0].index).toBe(2);
    expect(report.rejected[1].index).toBe(3);
  });
});
