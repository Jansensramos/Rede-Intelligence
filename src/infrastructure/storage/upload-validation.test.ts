import { describe, expect, it } from "vitest";
import { DOCUMENT_UPLOAD_LIMITS, validateDocumentUpload } from "./upload-validation";

const pdfBytes = new TextEncoder().encode("%PDF-1.7\n%%EOF");

describe("validação genérica de documento (sala de documentos / evidências)", () => {
  it("aceita documento com extensão, MIME e assinatura consistentes", () => {
    const result = validateDocumentUpload({ fileName: "contrato.pdf", mimeType: "application/pdf", bytes: pdfBytes });
    expect(result).toEqual({ extension: "pdf", mimeType: "application/pdf", fileSize: pdfBytes.length });
  });

  it("aceita texto simples sem exigir assinatura binária", () => {
    const bytes = new TextEncoder().encode("Memorando de funding.");
    expect(validateDocumentUpload({ fileName: "memo.txt", mimeType: "text/plain", bytes }).extension).toBe("txt");
  });

  it("rejeita extensão fora da lista permitida nesta área", () => {
    expect(() => validateDocumentUpload({ fileName: "script.js", mimeType: "text/javascript", bytes: new Uint8Array([1]) })).toThrow(/não suportado/);
  });

  it("rejeita arquivo vazio", () => {
    expect(() => validateDocumentUpload({ fileName: "vazio.pdf", mimeType: "application/pdf", bytes: new Uint8Array() })).toThrow(/vazio/);
  });

  it("rejeita arquivo acima do limite por tipo", () => {
    const oversized = new Uint8Array(DOCUMENT_UPLOAD_LIMITS.png + 1);
    oversized.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() => validateDocumentUpload({ fileName: "grande.png", mimeType: "image/png", bytes: oversized })).toThrow(/excede o limite/);
  });

  it("rejeita MIME incompatível com a extensão declarada", () => {
    expect(() => validateDocumentUpload({ fileName: "planilha.xlsx", mimeType: "application/pdf", bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]) })).toThrow(/incompatível/);
  });

  it("rejeita conteúdo cuja assinatura binária não corresponde à extensão (renomeado)", () => {
    expect(() => validateDocumentUpload({ fileName: "falso.pdf", mimeType: "application/pdf", bytes: new TextEncoder().encode("not a pdf") })).toThrow(/incompatível/);
  });

  it("rejeita executável PE/EXE disfarçado de PDF", () => {
    const exeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, ...new TextEncoder().encode("%PDF-1.7")]);
    expect(() => validateDocumentUpload({ fileName: "fatura.pdf", mimeType: "application/pdf", bytes: exeBytes })).toThrow(/executável/);
  });

  it("rejeita script com shebang mesmo sob extensão de texto", () => {
    const script = new TextEncoder().encode("#!/bin/sh\nrm -rf /");
    expect(() => validateDocumentUpload({ fileName: "notas.txt", mimeType: "text/plain", bytes: script })).toThrow(/executável/);
  });

  it("aceita pacote OOXML (docx/xlsx/pptx) por assinatura ZIP", () => {
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(validateDocumentUpload({ fileName: "proposta.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes: zipBytes }).extension).toBe("pptx");
  });

  it("rejeita nome de arquivo com override bidirecional (disfarce visual de extensão)", () => {
    // U+202E (RLO) inverte a exibição do que vem depois — um leitor humano veria uma
    // extensão diferente da real; a validação recusa antes mesmo de olhar a extensão.
    const rlo = String.fromCodePoint(0x202e);
    const hostileName = "fatura" + rlo + "fdp.exe";
    expect(() => validateDocumentUpload({ fileName: hostileName, mimeType: "application/pdf", bytes: pdfBytes })).toThrow(/caracteres/);
  });

  it.each([
    ["LRE U+202A", 0x202a],
    ["PDF U+202C", 0x202c],
    ["LRO U+202D", 0x202d],
    ["LRI U+2066", 0x2066],
    ["PDI U+2069", 0x2069],
    ["NUL U+0000", 0x0000],
    ["tab U+0009", 0x0009],
    ["DEL U+007F", 0x007f],
  ])("rejeita nome de arquivo com caractere de controle/bidi (%s)", (_label, codePoint) => {
    const char = String.fromCodePoint(codePoint);
    expect(() => validateDocumentUpload({ fileName: "fatura" + char + "nome.pdf", mimeType: "application/pdf", bytes: pdfBytes })).toThrow(/caracteres/);
  });

  it("rejeita nome de arquivo com formato de path traversal ou separador de caminho", () => {
    expect(() => validateDocumentUpload({ fileName: "../../etc/passwd.pdf", mimeType: "application/pdf", bytes: pdfBytes })).toThrow(/caracteres/);
    expect(() => validateDocumentUpload({ fileName: "pasta/arquivo.pdf", mimeType: "application/pdf", bytes: pdfBytes })).toThrow(/caracteres/);
    expect(() => validateDocumentUpload({ fileName: "pasta\\arquivo.pdf", mimeType: "application/pdf", bytes: pdfBytes })).toThrow(/caracteres/);
  });

  it("rejeita nome de arquivo vazio ou excessivamente longo", () => {
    expect(() => validateDocumentUpload({ fileName: "", mimeType: "application/pdf", bytes: pdfBytes })).toThrow(/inválido/);
    expect(() => validateDocumentUpload({ fileName: "a".repeat(300) + ".pdf", mimeType: "application/pdf", bytes: pdfBytes })).toThrow(/inválido/);
  });

  it.each(["CON", "con.txt", "AUX.pdf", "COM1.doc", "LPT9", "PRN.pdf", "Nul.txt"])("rejeita nome reservado do Windows: %s", (fileName) => {
    expect(() => validateDocumentUpload({ fileName, mimeType: "application/pdf", bytes: pdfBytes })).toThrow(/reservado/);
  });

  it("rejeita nome de arquivo terminado em ponto final", () => {
    expect(() => validateDocumentUpload({ fileName: "fatura.pdf.", mimeType: "application/pdf", bytes: pdfBytes })).toThrow(/ponto ou espaço/);
  });

  it("rejeita nome de arquivo terminado em espaço", () => {
    expect(() => validateDocumentUpload({ fileName: "fatura.pdf ", mimeType: "application/pdf", bytes: pdfBytes })).toThrow(/ponto ou espaço/);
  });

  it("aceita nome no limite de 255 caracteres", () => {
    const name = `${"a".repeat(251)}.pdf`; // 255 no total
    expect(name).toHaveLength(255);
    expect(validateDocumentUpload({ fileName: name, mimeType: "application/pdf", bytes: pdfBytes }).extension).toBe("pdf");
  });

  it("não confunde nome legítimo que apenas contém 'con'/'aux' como substring com o nome reservado", () => {
    const result = validateDocumentUpload({ fileName: "contrato-auxiliar.pdf", mimeType: "application/pdf", bytes: pdfBytes });
    expect(result.extension).toBe("pdf");
  });

  it("aceita nome de arquivo com acentuação/Unicode legítimo (não confundir com ataque)", () => {
    const accentedName = "relat" + String.fromCodePoint(0xf3) + "rio-jur" + String.fromCodePoint(0xed) + "dico.pdf";
    const result = validateDocumentUpload({ fileName: accentedName, mimeType: "application/pdf", bytes: pdfBytes });
    expect(result.extension).toBe("pdf");
  });
});
