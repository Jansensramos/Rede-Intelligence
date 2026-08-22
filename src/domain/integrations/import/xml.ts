import { IMPORT_LIMITS, assertWithinFileSizeLimit } from "./limits";
import type { ImportParseReport, StagingRow } from "./types";

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescapeXmlEntities(value: string) {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity in XML_ENTITIES) return XML_ENTITIES[entity];
    if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return match; // entidade desconhecida/externa: preservada como texto literal, NUNCA resolvida (proteção XXE)
  });
}

/**
 * Parser XML mínimo e seguro para o importador universal. Não implementa DTD,
 * DOCTYPE ou ENTITY externas — a seção é removida antes do parsing, então
 * qualquer `&entidadeCustomizada;` permanece como texto literal (nunca é
 * expandida/buscada), eliminando XXE por construção em vez de tentar bloquear
 * uma implementação completa de parser.
 *
 * Formato aceito: `<row>` repetido com filhos simples de texto, ex.:
 * `<rows><row><nome>Ana</nome><email>a@x.com</email></row>...</rows>`.
 */
export function parseGenericXml(content: string): ImportParseReport {
  assertWithinFileSizeLimit(Buffer.byteLength(content, "utf8"));
  if (Buffer.byteLength(content, "utf8") > IMPORT_LIMITS.maxXmlBytes) {
    return { format: "XML", columns: [], rows: [], structuralErrors: [{ index: 0, message: "Arquivo XML excede o limite de tamanho." }] };
  }
  const withoutDoctype = content.replace(/<!DOCTYPE[\s\S]*?(\[[\s\S]*?\])?\s*>/gi, "").replace(/<!ENTITY[\s\S]*?>/gi, "").replace(/<\?xml[\s\S]*?\?>/gi, "");
  const rowMatches = [...withoutDoctype.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)];
  if (rowMatches.length === 0) return { format: "XML", columns: [], rows: [], structuralErrors: [{ index: 0, message: "Nenhum elemento <row> encontrado." }] };

  const structuralErrors: Array<{ index: number; message: string }> = [];
  const limited = rowMatches.slice(0, IMPORT_LIMITS.maxRows);
  if (rowMatches.length > IMPORT_LIMITS.maxRows) structuralErrors.push({ index: IMPORT_LIMITS.maxRows + 1, message: `Arquivo excede o limite de ${IMPORT_LIMITS.maxRows} linhas; processando apenas as primeiras.` });

  const rows: StagingRow[] = [];
  const columnSet = new Set<string>();
  limited.forEach((match, offset) => {
    const rowIndex = offset + 1;
    const inner = match[1];
    const fieldMatches = [...inner.matchAll(/<([a-zA-Z_][\w.-]*)\b[^>]*>([\s\S]*?)<\/\1>/g)];
    if (fieldMatches.length === 0) { structuralErrors.push({ index: rowIndex, message: "Linha sem campos reconhecíveis." }); return; }
    const raw: Record<string, unknown> = {};
    for (const field of fieldMatches) {
      const [, name, value] = field;
      raw[name] = unescapeXmlEntities(value.trim());
      columnSet.add(name);
    }
    rows.push({ index: rowIndex, raw });
  });

  return { format: "XML", columns: [...columnSet], rows, structuralErrors };
}
