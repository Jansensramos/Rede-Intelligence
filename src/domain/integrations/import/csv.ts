import { IMPORT_LIMITS, assertWithinFileSizeLimit } from "./limits";
import type { ImportParseReport, StagingRow } from "./types";

/**
 * Parser CSV genérico do importador universal — qualquer cabeçalho, não apenas o
 * formato bancário específico (`src/domain/financial-ops/csv-import.ts`, que
 * continua intocado e é o parser especializado de extrato). Segue o mesmo
 * princípio: separador autodetectado, aspas simples e "parcial só entre linhas
 * independentes" (uma linha malformada nunca derruba o arquivo inteiro).
 */
function detectSeparator(headerLine: string) {
  return headerLine.includes(";") && !headerLine.includes(",") ? ";" : ",";
}

function splitCsvLine(line: string, separator: string) {
  return line.split(separator).map((cell) => cell.trim().replace(/^"|"$/g, ""));
}

export function parseGenericCsv(content: string): ImportParseReport {
  assertWithinFileSizeLimit(Buffer.byteLength(content, "utf8"));
  const lines = content.replace(/\r\n/g, "\n").split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { format: "CSV", columns: [], rows: [], structuralErrors: [{ index: 0, message: "Arquivo vazio." }] };

  const separator = detectSeparator(lines[0]);
  const columns = splitCsvLine(lines[0], separator);
  const rows: StagingRow[] = [];
  const structuralErrors: Array<{ index: number; message: string }> = [];

  const dataLines = lines.slice(1, 1 + IMPORT_LIMITS.maxRows);
  if (lines.length - 1 > IMPORT_LIMITS.maxRows) structuralErrors.push({ index: IMPORT_LIMITS.maxRows + 1, message: `Arquivo excede o limite de ${IMPORT_LIMITS.maxRows} linhas; processando apenas as primeiras.` });

  dataLines.forEach((line, offset) => {
    const rowIndex = offset + 1;
    const cells = splitCsvLine(line, separator);
    if (cells.length !== columns.length) { structuralErrors.push({ index: rowIndex, message: `Número de colunas (${cells.length}) diferente do cabeçalho (${columns.length}).` }); return; }
    const raw: Record<string, unknown> = {};
    columns.forEach((column, columnIndex) => { raw[column] = cells[columnIndex]; });
    rows.push({ index: rowIndex, raw });
  });

  return { format: "CSV", columns, rows, structuralErrors };
}
