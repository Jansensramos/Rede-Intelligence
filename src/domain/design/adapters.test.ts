import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { processDesignFile, validateDesignUpload } from "./adapters";

describe("Design file adapters and security", () => {
  it("blocks extension/MIME spoofing before parsing", () => {
    expect(() => validateDesignUpload({ fileName: "fake.pdf", mimeType: "application/pdf", bytes: new TextEncoder().encode("not a pdf") })).toThrow(/Conteúdo incompatível/);
    expect(() => validateDesignUpload({ fileName: "plan.pdf", mimeType: "image/png", bytes: new TextEncoder().encode("%PDF-1.7") })).toThrow(/MIME/);
  });

  it("extracts real PDF page dimensions but leaves scale unknown", async () => {
    const document = await PDFDocument.create();
    document.setTitle("ARQ-101 Rev 04");
    document.addPage([841.89, 595.28]);
    document.addPage([595.28, 841.89]);
    const bytes = await document.save();
    const result = await processDesignFile({ fileName: "ARQ-101-R04.pdf", mimeType: "application/pdf", bytes });
    expect(result.metadata).toMatchObject({ pageCount: 2, title: "ARQ-101 Rev 04" });
    expect(result.sheets.map((sheet) => sheet.scaleConfidence)).toEqual(["UNKNOWN", "UNKNOWN"]);
    expect(result.limitations.join(" ")).toMatch(/Escala não confirmada/);
  });

  it("extracts IFC spatial metadata without pretending to have 3D geometry", async () => {
    const ifc = `ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n#1=IFCPROJECT('g',$,'Demo',$,$,$,$,$,$);\n#2=IFCBUILDING('b',$,'Torre A',$,$,$,$,$,$,$,$,$);\n#3=IFCBUILDINGSTOREY('s',$,'Térreo',$,$,$,$,$,$,0.);\nENDSEC;\nEND-ISO-10303-21;`;
    const result = await processDesignFile({ fileName: "modelo.ifc", mimeType: "application/ifc", bytes: new TextEncoder().encode(ifc) });
    expect(result.status).toBe("PARTIAL");
    expect(result.metadata).toMatchObject({ schema: "IFC4", projectCount: 1, buildingCount: 1 });
    expect(result.limitations.join(" ")).toMatch(/Geometria 3D/);
  });

  it("requires conversion for proprietary CAD instead of using a fragile parser", async () => {
    const bytes = new TextEncoder().encode("AC1027binary-placeholder");
    const result = await processDesignFile({ fileName: "modelo.dwg", mimeType: "application/acad", bytes });
    expect(result.support).toBe("CONVERSION_REQUIRED");
    expect(result.metadata).toMatchObject({ conversionRequired: true });
  });
});
