import { describe, expect, it } from "vitest";
import {
  assertTemplateVersionEditable, classifyCreditResult, maskTaxId, mapToContractSignatureStatus,
  nextSignatureRequestStatus, renderContractTemplate, sha256Hex,
} from "./contract-closing";

describe("renderContractTemplate", () => {
  it("substitui placeholders conhecidos e reporta os desconhecidos sem inventar valor", () => {
    const { rendered, unresolved } = renderContractTemplate("Contrato {{contractNumber}} — comprador {{buyerName}} — obs {{extra}}", { contractNumber: "CV-1", buyerName: "Maria" });
    expect(rendered).toBe("Contrato CV-1 — comprador Maria — obs {{extra}}");
    expect(unresolved).toEqual(["extra"]);
  });

  it("não altera texto sem placeholders", () => {
    expect(renderContractTemplate("texto fixo", {}).rendered).toBe("texto fixo");
  });
});

describe("assertTemplateVersionEditable", () => {
  it("permite editar rascunho", () => expect(() => assertTemplateVersionEditable("DRAFT")).not.toThrow());
  it("bloqueia edição de versão aprovada", () => expect(() => assertTemplateVersionEditable("APPROVED")).toThrow(/imutável/));
});

describe("nextSignatureRequestStatus", () => {
  it("permanece aguardando enquanto houver pendente", () => {
    expect(nextSignatureRequestStatus([{ status: "SIGNED" }, { status: "PENDING" }])).toBe("AGUARDANDO_ASSINATURAS");
  });
  it("fecha ASSINADO quando todos assinaram", () => {
    expect(nextSignatureRequestStatus([{ status: "SIGNED" }, { status: "SIGNED" }])).toBe("ASSINADO");
  });
  it("uma recusa falha a request inteira mesmo com outros assinados", () => {
    expect(nextSignatureRequestStatus([{ status: "SIGNED" }, { status: "DECLINED" }])).toBe("RECUSADO");
  });
});

describe("mapToContractSignatureStatus", () => {
  it("PENDING quando ninguém assinou", () => expect(mapToContractSignatureStatus([{ status: "PENDING" }])).toBe("PENDING"));
  it("PARTIALLY_SIGNED quando parte assinou", () => expect(mapToContractSignatureStatus([{ status: "SIGNED" }, { status: "PENDING" }])).toBe("PARTIALLY_SIGNED"));
  it("SIGNED quando todos assinaram", () => expect(mapToContractSignatureStatus([{ status: "SIGNED" }])).toBe("SIGNED"));
});

describe("maskTaxId", () => {
  it("mantém só os 3 primeiros dígitos de um CPF", () => expect(maskTaxId("123.456.789-01")).toBe("123********"));
  it("funciona sem pontuação", () => expect(maskTaxId("12345678901")).toBe("123********"));
});

describe("classifyCreditResult", () => {
  it("REQUER_ANALISE quando não há score", () => expect(classifyCreditResult({ score: null, findingsCount: 0 })).toBe("REQUER_ANALISE"));
  it("COM_RESTRICAO quando há apontamento, mesmo com score alto", () => expect(classifyCreditResult({ score: 900, findingsCount: 1 })).toBe("COM_RESTRICAO"));
  it("REQUER_ANALISE quando score baixo sem apontamento", () => expect(classifyCreditResult({ score: 400, findingsCount: 0 })).toBe("REQUER_ANALISE"));
  it("SEM_RESTRICAO quando score alto sem apontamento", () => expect(classifyCreditResult({ score: 800, findingsCount: 0 })).toBe("SEM_RESTRICAO"));
});

describe("sha256Hex", () => {
  it("é determinístico", () => expect(sha256Hex("abc")).toBe(sha256Hex("abc")));
  it("muda com o conteúdo", () => expect(sha256Hex("abc")).not.toBe(sha256Hex("abd")));
});
