// Importação segura de extrato bancário em CSV estruturado.
// Formato esperado (cabeçalho obrigatório, separador vírgula ou ponto e vírgula):
// data,valor,tipo,descricao,contraparte,documento,external_id
// data: AAAA-MM-DD · valor: numérico positivo · tipo: DEBITO|CREDITO (ou DEBIT|CREDIT)

export interface ParsedCsvTransaction {
  occurredAt: Date;
  amount: string;
  direction: "DEBIT" | "CREDIT";
  description: string;
  counterparty?: string;
  documentRef?: string;
  externalId?: string;
}

export interface CsvImportRowError {
  line: number;
  message: string;
}

export interface CsvImportReport {
  accepted: ParsedCsvTransaction[];
  rejected: CsvImportRowError[];
}

const REQUIRED_COLUMNS = ["data", "valor", "tipo"] as const;
const DIRECTION_MAP: Record<string, "DEBIT" | "CREDIT"> = { debito: "DEBIT", débito: "DEBIT", debit: "DEBIT", credito: "CREDIT", crédito: "CREDIT", credit: "CREDIT" };

function detectSeparator(headerLine: string) {
  return headerLine.includes(";") && !headerLine.includes(",") ? ";" : ",";
}

function splitCsvLine(line: string, separator: string) {
  return line.split(separator).map((cell) => cell.trim().replace(/^"|"$/g, ""));
}

export function parseBankStatementCsv(content: string): CsvImportReport {
  const lines = content.replace(/\r\n/g, "\n").split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { accepted: [], rejected: [{ line: 0, message: "Arquivo vazio." }] };

  const separator = detectSeparator(lines[0]);
  const header = splitCsvLine(lines[0], separator).map((cell) => cell.toLocaleLowerCase("pt-BR"));
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) return { accepted: [], rejected: [{ line: 1, message: `Colunas obrigatórias ausentes: ${missing.join(", ")}.` }] };

  const columnIndex = (name: string) => header.indexOf(name);
  const accepted: ParsedCsvTransaction[] = [];
  const rejected: CsvImportRowError[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const cells = splitCsvLine(lines[index], separator);
    if (cells.length < header.length) { rejected.push({ line: lineNumber, message: "Número de colunas menor que o esperado." }); continue; }

    const rawDate = cells[columnIndex("data")];
    const occurredAt = new Date(`${rawDate}T00:00:00.000Z`);
    if (!rawDate || Number.isNaN(occurredAt.getTime())) { rejected.push({ line: lineNumber, message: `Data inválida: "${rawDate}". Use AAAA-MM-DD.` }); continue; }

    const rawAmount = cells[columnIndex("valor")].replace(/\./g, "").replace(",", ".");
    const amountValue = Number(rawAmount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) { rejected.push({ line: lineNumber, message: `Valor inválido: "${cells[columnIndex("valor")]}".` }); continue; }

    const rawDirection = cells[columnIndex("tipo")].toLocaleLowerCase("pt-BR");
    const direction = DIRECTION_MAP[rawDirection];
    if (!direction) { rejected.push({ line: lineNumber, message: `Tipo inválido: "${cells[columnIndex("tipo")]}". Use DEBITO ou CREDITO.` }); continue; }

    const descriptionIndex = columnIndex("descricao");
    const description = descriptionIndex >= 0 ? cells[descriptionIndex] : "";
    if (!description.trim()) { rejected.push({ line: lineNumber, message: "Descrição obrigatória." }); continue; }

    const counterpartyIndex = columnIndex("contraparte");
    const documentIndex = columnIndex("documento");
    const externalIdIndex = columnIndex("external_id");

    accepted.push({
      occurredAt,
      amount: amountValue.toFixed(2),
      direction,
      description: description.trim(),
      counterparty: counterpartyIndex >= 0 && cells[counterpartyIndex] ? cells[counterpartyIndex] : undefined,
      documentRef: documentIndex >= 0 && cells[documentIndex] ? cells[documentIndex] : undefined,
      externalId: externalIdIndex >= 0 && cells[externalIdIndex] ? cells[externalIdIndex] : undefined,
    });
  }

  return { accepted, rejected };
}
