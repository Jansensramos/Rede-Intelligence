/**
 * Semântica de freshness (Fase 9K.2, fechamento — gate 3). `asOf = instante da leitura` confundia
 * "consultado agora" com "dado atualizado agora" — um registro antigo aparecia com o mesmo texto
 * de um registro que mudou há um segundo. Este módulo é puro (sem I/O) e decide, a partir do
 * timestamp real mais recente já disponível na leitura (nunca uma consulta nova só para isso), qual
 * das três semânticas se aplica:
 *
 *  - `source_updated` — há um timestamp confiável da própria fonte (`updatedAt`/`closedAt`/
 *    `lastSyncAt`/...) entre os registros já buscados. É o único caso em que a UI pode dizer
 *    "Atualizado em".
 *  - `queried_now` — o valor é um cálculo/agregado ao vivo (soma de caixa, contagem) sem um
 *    registro individual para ancorar; a UI diz "Consultado em", nunca "Atualizado agora".
 *  - `unavailable` — não há nem registro nem cálculo com timestamp confiável (ex.: domínio sem
 *    nenhum dado); a UI diz "Atualização da fonte indisponível", nunca inventa uma data.
 */
export type FreshnessKind = "source_updated" | "queried_now" | "unavailable";

export interface DomainFreshness {
  kind: FreshnessKind;
  /** Presente somente quando kind = "source_updated": o timestamp real da fonte mais recente. */
  updatedAt?: string;
  /** Presente somente quando kind = "queried_now": quando o REDE calculou/consultou — nunca é apresentado como "atualização do dado". */
  queriedAt?: string;
}

/** Maior timestamp entre os já coletados na leitura (nunca dispara uma consulta nova). `null`/`undefined` são ignorados. */
export function latestTimestamp(dates: Array<Date | null | undefined>): Date | null {
  const valid = dates.filter((date): date is Date => date instanceof Date);
  if (valid.length === 0) return null;
  return valid.reduce((latest, date) => (date.getTime() > latest.getTime() ? date : latest));
}

/**
 * Resolve a semântica de freshness de um domínio.
 * `hasComputableValue` marca se o domínio tem algum valor ao vivo (agregado ou lista vazia, mas
 * consultada) — quando `false` (ex.: nenhuma empresa vinculada, nenhum período contábil, nenhuma
 * instalação), o resultado é `unavailable`, nunca "consultado agora" (isso fingiria uma consulta
 * útil onde não houve nenhuma fonte para consultar).
 */
export function resolveDomainFreshness(latest: Date | null, referenceDate: Date, hasComputableValue: boolean): DomainFreshness {
  if (latest) return { kind: "source_updated", updatedAt: latest.toISOString() };
  if (!hasComputableValue) return { kind: "unavailable" };
  return { kind: "queried_now", queriedAt: referenceDate.toISOString() };
}
