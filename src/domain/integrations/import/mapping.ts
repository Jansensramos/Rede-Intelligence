import type { ImportRowError, StagingRow } from "./types";

export interface FieldMappingRule {
  sourceField: string;
  targetField: string;
  required?: boolean;
  type?: "string" | "number" | "date" | "boolean";
}

export interface MappedRow {
  index: number;
  data: Record<string, unknown>;
}

export interface MappingReport {
  accepted: MappedRow[];
  rejected: ImportRowError[];
}

function coerce(value: unknown, type: FieldMappingRule["type"]): { ok: true; value: unknown } | { ok: false; message: string } {
  const raw = value === undefined || value === null ? "" : String(value).trim();
  switch (type) {
    case "number": {
      const normalized = raw.replace(/\./g, "").replace(",", ".");
      const parsed = Number(normalized === "" ? raw : normalized);
      return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false, message: `Valor numérico inválido: "${raw}".` };
    }
    case "date": {
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? { ok: false, message: `Data inválida: "${raw}".` } : { ok: true, value: parsed };
    }
    case "boolean":
      return { ok: true, value: ["true", "1", "sim", "yes"].includes(raw.toLowerCase()) };
    default:
      return { ok: true, value: raw };
  }
}

/**
 * Aplica um `MappingProfile` versionado (campo de origem → campo REDE, tipo,
 * obrigatoriedade) e valida linha a linha — mesmo padrão `accepted`/`rejected`
 * do importador bancário: uma linha inválida nunca derruba o lote inteiro.
 */
export function applyMappingAndValidate(rows: StagingRow[], rules: FieldMappingRule[]): MappingReport {
  const accepted: MappedRow[] = [];
  const rejected: ImportRowError[] = [];

  for (const row of rows) {
    const data: Record<string, unknown> = {};
    let rowError: string | null = null;
    for (const rule of rules) {
      const rawValue = row.raw[rule.sourceField];
      if (rule.required && (rawValue === undefined || rawValue === null || String(rawValue).trim() === "")) { rowError = `Campo obrigatório ausente: "${rule.sourceField}".`; break; }
      if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") continue;
      const coerced = coerce(rawValue, rule.type);
      if (!coerced.ok) { rowError = coerced.message; break; }
      data[rule.targetField] = coerced.value;
    }
    if (rowError) rejected.push({ index: row.index, message: rowError });
    else accepted.push({ index: row.index, data });
  }

  return { accepted, rejected };
}
