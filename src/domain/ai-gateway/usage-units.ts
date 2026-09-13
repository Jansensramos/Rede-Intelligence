/**
 * Validacao de unidades de uso (input/output tokens) reportadas pelo adapter (correcao
 * critica pos-reauditoria, achado ALTO "custo observado hostil"). Mesma politica do custo:
 * inteiro, finito, nao-negativo, com teto - nunca aceita coercao de string/bigint/objeto.
 */
export const MAX_SAFE_USAGE_UNITS = 100_000_000; // generoso para qualquer contagem real de tokens/unidades

export function isSafeUsageUnits(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value) && value >= 0 && value <= MAX_SAFE_USAGE_UNITS;
}
