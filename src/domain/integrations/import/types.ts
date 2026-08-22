export type ImportFormat = "CSV" | "XLSX" | "JSON" | "XML";

export interface StagingRow {
  index: number; // 1-based, posição do item na fonte
  raw: Record<string, unknown>;
}

export interface ImportRowError {
  index: number;
  message: string;
}

export interface ImportParseReport {
  format: ImportFormat;
  columns: string[];
  rows: StagingRow[];
  structuralErrors: ImportRowError[];
}

export interface ImportPreview {
  format: ImportFormat;
  columns: string[];
  sampleRows: StagingRow[];
  totalRows: number;
  structuralErrorCount: number;
}

export function buildPreview(report: ImportParseReport, sampleSize = 20): ImportPreview {
  return { format: report.format, columns: report.columns, sampleRows: report.rows.slice(0, sampleSize), totalRows: report.rows.length, structuralErrorCount: report.structuralErrors.length };
}
