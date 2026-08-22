import { IMPORT_LIMITS, assertWithinFileSizeLimit } from "./limits";
import type { ImportParseReport, StagingRow } from "./types";
import { createZip, readZip } from "./zip";

/**
 * Leitor/escritor mínimo de XLSX (OOXML real, sem dependência externa) — não
 * cobre todos os recursos do Excel (estilos, múltiplas planilhas, fórmulas),
 * mas produz e lê um arquivo `.xlsx` genuíno e válido. Proteção contra zip bomb
 * herdada de `readZip` (limite por entrada e total descomprimido).
 */
const columnLetters = (index: number) => {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
};

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildXlsx(header: string[], rows: string[][]): Buffer {
  const sheetRows = [header, ...rows].map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => `<c r="${columnLetters(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

  return createZip([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRels, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXml, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheetXml, "utf8") },
  ]);
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => {
    const texts = [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((textMatch) => textMatch[1]);
    return texts.join("");
  });
}

function cellColumnLetters(cellRef: string) {
  return cellRef.match(/^[A-Z]+/)?.[0] ?? "A";
}

export function parseXlsx(buffer: Buffer): ImportParseReport {
  assertWithinFileSizeLimit(buffer.length);
  let entries: Map<string, Buffer>;
  try {
    entries = readZip(buffer, { maxEntryUncompressedBytes: IMPORT_LIMITS.maxXlsxEntryUncompressedBytes, maxTotalUncompressedBytes: IMPORT_LIMITS.maxXlsxTotalUncompressedBytes });
  } catch (error) {
    return { format: "XLSX", columns: [], rows: [], structuralErrors: [{ index: 0, message: error instanceof Error ? error.message : "Falha ao ler o arquivo XLSX." }] };
  }
  const sheetBuffer = entries.get("xl/worksheets/sheet1.xml");
  if (!sheetBuffer) return { format: "XLSX", columns: [], rows: [], structuralErrors: [{ index: 0, message: "Planilha xl/worksheets/sheet1.xml não encontrada." }] };
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8"));
  const sheetXml = sheetBuffer.toString("utf8");

  const rowMatches = [...sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)];
  if (rowMatches.length === 0) return { format: "XLSX", columns: [], rows: [], structuralErrors: [{ index: 0, message: "Planilha sem linhas." }] };

  const parsedRows = rowMatches.slice(0, 1 + IMPORT_LIMITS.maxRows).map((rowMatch) => {
    const cellMatches = [...rowMatch[1].matchAll(/<c r="([A-Z]+\d+)"(?:\s+[^>]*)?>([\s\S]*?)<\/c>|<c r="([A-Z]+\d+)"[^>]*\/>/g)];
    const cells = new Map<string, string>();
    for (const cellMatch of cellMatches) {
      const ref = cellMatch[1] ?? cellMatch[3];
      const body = cellMatch[2] ?? "";
      if (!ref) continue;
      const typeMatch = rowMatch[1].match(new RegExp(`<c r="${ref}"[^>]*t="([a-zA-Z]+)"`));
      const type = typeMatch?.[1];
      let value = "";
      if (type === "inlineStr") value = body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
      else if (type === "s") { const stringIndex = Number(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "-1"); value = sharedStrings[stringIndex] ?? ""; }
      else value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      cells.set(cellColumnLetters(ref), value);
    }
    return cells;
  });

  const header = parsedRows[0];
  const columnRefs = [...header.keys()].sort();
  const columns = columnRefs.map((ref) => header.get(ref) ?? ref);
  const rows: StagingRow[] = [];
  const structuralErrors: Array<{ index: number; message: string }> = [];

  parsedRows.slice(1).forEach((cellMap, offset) => {
    const rowIndex = offset + 1;
    if (cellMap.size === 0) { structuralErrors.push({ index: rowIndex, message: "Linha vazia ignorada." }); return; }
    const raw: Record<string, unknown> = {};
    columnRefs.forEach((ref, columnIndex) => { raw[columns[columnIndex]] = cellMap.get(ref) ?? ""; });
    rows.push({ index: rowIndex, raw });
  });

  return { format: "XLSX", columns, rows, structuralErrors };
}
