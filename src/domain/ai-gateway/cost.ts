/**
 * Validacao de valores de custo em micro-USD (correcao focal pos-auditoria, achado
 * MEDIO "custo negativo/nao finito"). Precisa ser inteiro, finito, nao-negativo e dentro
 * de um teto seguro - nunca aceita coercao de string, bigint, NaN, Infinity ou fracao.
 * Custo negativo nunca pode reduzir o gasto rastreado (o unico jeito de garantir isso e
 * nunca aceitar um valor negativo em primeiro lugar).
 */
export const MAX_SAFE_COST_USD_MICROS = 1_000_000_000_000; // US$ 1.000.000,00 — teto generoso, evita overflow/valor absurdo

export function isSafeCostUsdMicros(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value) && value >= 0 && value <= MAX_SAFE_COST_USD_MICROS;
}
