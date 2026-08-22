import { IMPORT_LIMITS, assertWithinFileSizeLimit } from "./limits";
import type { ImportParseReport, StagingRow } from "./types";

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function sanitizeRecord(value: Record<string, unknown>, index: number, errors: Array<{ index: number; message: string }>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) { errors.push({ index, message: `Campo "${key}" não é permitido.` }); continue; }
    clean[key] = val;
  }
  return clean;
}

/**
 * Aceita `[{...}, {...}]` ou `{ "rows": [{...}, ...] }`. Nunca usa um reviver
 * arbitrário nem `eval`; rejeita explicitamente chaves de poluição de protótipo.
 */
export function parseGenericJson(content: string): ImportParseReport {
  assertWithinFileSizeLimit(Buffer.byteLength(content, "utf8"));
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { format: "JSON", columns: [], rows: [], structuralErrors: [{ index: 0, message: "JSON inválido." }] };
  }
  const list = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === "object" && Array.isArray((parsed as { rows?: unknown }).rows) ? (parsed as { rows: unknown[] }).rows : null);
  if (!list) return { format: "JSON", columns: [], rows: [], structuralErrors: [{ index: 0, message: "Esperado um array de objetos ou { rows: [...] }." }] };

  const structuralErrors: Array<{ index: number; message: string }> = [];
  const limited = list.slice(0, IMPORT_LIMITS.maxRows);
  if (list.length > IMPORT_LIMITS.maxRows) structuralErrors.push({ index: IMPORT_LIMITS.maxRows + 1, message: `Arquivo excede o limite de ${IMPORT_LIMITS.maxRows} linhas; processando apenas as primeiras.` });

  const rows: StagingRow[] = [];
  const columnSet = new Set<string>();
  limited.forEach((item, offset) => {
    const rowIndex = offset + 1;
    if (!item || typeof item !== "object" || Array.isArray(item)) { structuralErrors.push({ index: rowIndex, message: "Item não é um objeto." }); return; }
    const raw = sanitizeRecord(item as Record<string, unknown>, rowIndex, structuralErrors);
    Object.keys(raw).forEach((key) => columnSet.add(key));
    rows.push({ index: rowIndex, raw });
  });

  return { format: "JSON", columns: [...columnSet], rows, structuralErrors };
}
