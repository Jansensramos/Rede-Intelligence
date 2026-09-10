import { describe, expect, it } from "vitest";
import { createMalwareScanner, inspectUpload } from "./upload-policy";
import { DESIGN_UPLOAD_LIMITS, validateDesignUpload } from "@/domain/design/adapters";

describe("fundação segura de uploads", () => {
  it("proíbe scanner noop ou ausente em produção", () => {
    expect(() => createMalwareScanner("production", "noop")).toThrow(/proibido/);
    expect(() => createMalwareScanner("production")).toThrow(/proibido/);
  });
  it("valida extensão, MIME, assinatura, tamanho por tipo e checksum", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\n");
    expect(validateDesignUpload({ fileName: "planta.pdf", mimeType: "application/pdf", bytes }).extension).toBe("pdf");
    expect(DESIGN_UPLOAD_LIMITS.pdf).toBeLessThan(DESIGN_UPLOAD_LIMITS.ifc);
    expect((await inspectUpload({ fileName: "planta.pdf", bytes })).checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejeita conteúdo incompatível e scanner negativo sem revelar detalhes", async () => {
    expect(() => validateDesignUpload({ fileName: "ata.pdf", mimeType: "application/pdf", bytes: new Uint8Array([1, 2]) })).toThrow(/incompatível/);
    await expect(inspectUpload({ fileName: "x.pdf", bytes: new Uint8Array([1]), scanner: { scan: async () => ({ clean: false, reason: "assinatura interna" }) } })).rejects.toThrow("Arquivo rejeitado pela política de segurança.");
  });

  it("quando mimeType é informado, aplica validação de MIME/extensão/assinatura antes do scanner", async () => {
    const exeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
    await expect(inspectUpload({ fileName: "fatura.pdf", mimeType: "application/pdf", bytes: exeBytes })).rejects.toThrow(/executável/);
  });

  it("sem mimeType, preserva o comportamento anterior (compatibilidade com validateDesignUpload já aplicado a montante)", async () => {
    const bytes = new TextEncoder().encode("ISO-10303-21");
    await expect(inspectUpload({ fileName: "modelo.ifc", bytes })).resolves.toMatchObject({ checksum: expect.any(String) });
  });
});
