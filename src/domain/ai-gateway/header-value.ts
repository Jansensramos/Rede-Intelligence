/**
 * Validacao explicita de valor de header HTTP (achado MEDIO "header validation implicita",
 * endurecida na correcao critica pos-reauditoria, achado BAIXO "header Unicode"): a
 * auditoria original confirmou que a rejeicao de CR/LF/NUL no header `Authorization`
 * dependia inteiramente do `https.request` nativo do Node (`ERR_INVALID_CHAR`) - funciona,
 * mas e uma dependencia implicita de terceiro, nunca verificada pela propria aplicacao.
 *
 * A reauditoria confirmou que a versao anterior (so bloqueava controles/CR/LF/NUL/DEL, sem
 * fechar o charset) aceitava Unicode bidi (`‮`) e zero-width (`​`) silenciosamente
 * - nao violava o que fora pedido no momento, mas era inconsistente com o padrao de
 * charset FECHADO ja usado por `canonical-ref`/`idempotency-key`. Esta versao usa a mesma
 * politica fechada: so ASCII IMPRIMIVEL (0x20-0x7E) e aceito - isso exclui, de uma unica
 * vez, controles, CR/LF/NUL/DEL, e qualquer Unicode (bidi, zero-width, emoji, homoglyph)
 * fora do intervalo ASCII imprimivel. Roda ANTES do transporte (antes de qualquer
 * DNS/rede), falha com `AiGatewayError` classificado, e nunca deixa o valor hostil chegar
 * perto de `https.request`.
 *
 * Se o formato real de uma credencial algum dia exigir um caractere fora deste intervalo,
 * isso precisa de allowlist EXPLICITA e revisada aqui - nunca aceitacao implicita de
 * Unicode arbitrario.
 */
const MAX_HEADER_VALUE_LENGTH = 4096;
const PRINTABLE_ASCII_PATTERN = /^[\x20-\x7E]+$/;

export function isSafeHeaderValue(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_HEADER_VALUE_LENGTH) return false;
  if (value.trim() !== value) return false; // sem espaço inicial/final (trim exato)
  return PRINTABLE_ASCII_PATTERN.test(value); // ASCII imprimível fechado - cobre controles/CR/LF/NUL/DEL e todo Unicode (bidi/zero-width/emoji/homoglyph) de uma vez
}
