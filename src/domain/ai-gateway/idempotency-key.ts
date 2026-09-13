/**
 * Validacao de `idempotencyKey` (correcao focal pos-auditoria, achado MEDIO
 * "idempotencyKey hostil"): a chave precisa passar por este formato fechado ANTES de
 * qualquer acesso ao Prisma - nenhuma normalizacao silenciosa (trim, case-fold,
 * normalizacao Unicode) e feita; uma chave fora do formato e sempre rejeitada, nunca
 * reescrita para "a mesma" chave de outra entrada.
 *
 * Charset seguro documentado: ASCII alfanumerico + `:` `_` `.` `-`, comeca por
 * alfanumerico, 1 a 200 caracteres. Isso exclui estruturalmente, sem checagem separada:
 * string vazia, string só de espaços, espaço inicial/final, CR/LF/NUL/DEL/controles,
 * Unicode bidi/zero-width/emoji, e qualquer forma de URL (barra `/` não é permitida).
 * O formato real usado pelo unico chamador hoje (`${userMessage.id}:generate`) cabe
 * confortavelmente neste charset.
 */
const IDEMPOTENCY_KEY_MAX_LENGTH = 200;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,199}$/;

export function isSafeIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && value.length <= IDEMPOTENCY_KEY_MAX_LENGTH && IDEMPOTENCY_KEY_PATTERN.test(value);
}
