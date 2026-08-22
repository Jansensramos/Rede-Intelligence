/**
 * Limites de segurança para importação de arquivos externos (plano 9H §27/§34.1):
 * tamanho máximo, linhas máximas, e proteção contra zip bomb (XLSX) e XXE (XML).
 */
export const IMPORT_LIMITS = {
  maxFileBytes: 25 * 1024 * 1024, // 25 MB
  maxRows: 100_000,
  maxXlsxEntryUncompressedBytes: 50 * 1024 * 1024, // por parte do zip
  maxXlsxTotalUncompressedBytes: 200 * 1024 * 1024,
  maxXmlBytes: 25 * 1024 * 1024,
} as const;

export function assertWithinFileSizeLimit(bytes: number) {
  if (bytes > IMPORT_LIMITS.maxFileBytes) throw new Error(`Arquivo excede o limite de ${IMPORT_LIMITS.maxFileBytes} bytes.`);
}
