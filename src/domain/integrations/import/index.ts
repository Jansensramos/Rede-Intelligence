import { parseGenericCsv } from "./csv";
import { parseGenericJson } from "./json";
import { parseGenericXml } from "./xml";
import { parseXlsx } from "./xlsx";
import type { ImportFormat, ImportParseReport } from "./types";

export * from "./types";
export * from "./limits";
export * from "./csv";
export * from "./json";
export * from "./xml";
export * from "./xlsx";
export * from "./zip";
export * from "./mapping";

/** Ponto único de entrada do importador universal — detecta o parser pelo formato declarado. */
export function parseImportFile(format: ImportFormat, content: string | Buffer): ImportParseReport {
  switch (format) {
    case "CSV": return parseGenericCsv(content.toString("utf8"));
    case "JSON": return parseGenericJson(content.toString("utf8"));
    case "XML": return parseGenericXml(content.toString("utf8"));
    case "XLSX": return parseXlsx(Buffer.isBuffer(content) ? content : Buffer.from(content, "binary"));
    default: throw new Error(`Formato de importação não suportado: ${format}.`);
  }
}
