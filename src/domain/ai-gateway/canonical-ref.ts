/**
 * Formato fechado para referencias canonicas de provider/model (correcao focal
 * pos-auditoria, achado ALTO "provider/model nao confiaveis no ledger"): tamanho
 * limitado, ASCII seguro, sem URL, sem espacos/controles, sem token, sem texto livre.
 * Usado tanto para validar o catalogo do servidor quanto para recusar qualquer valor
 * "observado" de um adapter que nao bata com a rota esperada.
 */
const CANONICAL_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isSafeCanonicalRef(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_REF_PATTERN.test(value);
}
