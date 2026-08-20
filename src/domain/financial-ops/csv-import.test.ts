import { describe, expect, it } from "vitest";
import { parseBankStatementCsv } from "./csv-import";

describe("importação de extrato CSV", () => {
  it("aceita linhas válidas e preserva valor, direção e documento", () => {
    const csv = [
      "data,valor,tipo,descricao,contraparte,documento,external_id",
      "2026-09-15,180000,DEBITO,PAG NF 4821 CONSTRUTORA HORIZONTE,Construtora Horizonte,NF 4821,ext-1",
      "2026-09-10,45000,CREDITO,RECEBIMENTO VENDA UNIDADE,Maria Aparecida,CV-2026-0912,ext-2",
    ].join("\n");
    const report = parseBankStatementCsv(csv);
    expect(report.rejected).toEqual([]);
    expect(report.accepted).toHaveLength(2);
    expect(report.accepted[0]).toMatchObject({ amount: "180000.00", direction: "DEBIT", documentRef: "NF 4821", externalId: "ext-1" });
    expect(report.accepted[1].direction).toBe("CREDIT");
  });

  it("rejeita linhas inválidas individualmente sem interromper o restante do arquivo", () => {
    const csv = [
      "data,valor,tipo,descricao",
      "2026-09-15,180000,DEBITO,Pagamento válido",
      "data-invalida,180000,DEBITO,Linha com data ruim",
      "2026-09-16,-50,DEBITO,Valor negativo",
      "2026-09-17,100,TALVEZ,Tipo desconhecido",
      "2026-09-18,200,CREDITO,",
    ].join("\n");
    const report = parseBankStatementCsv(csv);
    expect(report.accepted).toHaveLength(1);
    expect(report.rejected).toHaveLength(4);
    expect(report.rejected.map((row) => row.line)).toEqual([3, 4, 5, 6]);
  });

  it("recusa arquivo sem as colunas obrigatórias", () => {
    const report = parseBankStatementCsv("nome,idade\nfulano,30");
    expect(report.accepted).toEqual([]);
    expect(report.rejected[0].message).toContain("Colunas obrigatórias ausentes");
  });

  it("aceita separador ponto e vírgula e valor em formato brasileiro", () => {
    const csv = "data;valor;tipo;descricao\n2026-09-15;1.234,56;DEBITO;Pagamento formato BR";
    const report = parseBankStatementCsv(csv);
    expect(report.accepted[0].amount).toBe("1234.56");
  });
});
