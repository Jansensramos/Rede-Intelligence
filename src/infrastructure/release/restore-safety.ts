import { assertNotArchivedDatabase, DatabaseUrlSafetyError } from "../../../scripts/database-url-safety.mjs";

/**
 * Guarda de segurança compartilhada por qualquer ferramenta de restauração (local hoje;
 * cloud quando um alvo gerenciado real existir). Nunca permite que o alvo de restauração
 * resolva para o mesmo host+porta+banco da fonte — "nunca restaurar sobre produção"
 * (contrato 9Q, §4/§5) — e exige um marcador explícito de isolamento no nome do banco alvo.
 * Também recusa, como origem ou destino, qualquer banco arquivado (mesma política
 * central de `scripts/database-url-safety.mjs` — achado alto da reauditoria 9Q.2B: a
 * ferramenta de restauração precisa da mesma proteção que o runtime).
 */
export class UnsafeRestoreTargetError extends Error {
  readonly name = "UnsafeRestoreTargetError";
  constructor(message: string) { super(message); }
}

function parseDatabaseUrl(label: string, raw: string) {
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new UnsafeRestoreTargetError(`${label} não é uma URL de banco válida.`); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new UnsafeRestoreTargetError(`${label} precisa ser PostgreSQL.`);
  try { assertNotArchivedDatabase(raw, label); }
  catch (error) { throw new UnsafeRestoreTargetError(error instanceof DatabaseUrlSafetyError ? error.message : `${label} aponta para um banco arquivado.`); }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new UnsafeRestoreTargetError(`${label} não informa um banco de dados.`);
  return { host: url.hostname.toLowerCase(), port: url.port || "5432", database };
}

export interface RestoreTargetCheckInput {
  sourceUrl: string;
  targetUrl: string;
  /** Prefixo obrigatório do banco alvo, comprovando que ele foi criado apenas para este ensaio. */
  isolationPrefix?: string;
}

/**
 * Lança `UnsafeRestoreTargetError` quando o alvo coincide com a fonte (mesmo
 * host+porta+banco) ou quando o nome do banco alvo não carrega o prefixo de isolamento
 * esperado. Não executa nenhuma operação de rede — validação puramente estrutural,
 * independente de acesso externo.
 */
export function assertIsolatedRestoreTarget(input: RestoreTargetCheckInput) {
  const source = parseDatabaseUrl("sourceUrl", input.sourceUrl);
  const target = parseDatabaseUrl("targetUrl", input.targetUrl);
  if (source.host === target.host && source.port === target.port && source.database === target.database) {
    throw new UnsafeRestoreTargetError("O alvo de restauração não pode ser o mesmo banco da fonte.");
  }
  const prefix = input.isolationPrefix ?? "rede_restore_";
  if (!target.database.startsWith(prefix)) {
    throw new UnsafeRestoreTargetError(`O banco alvo precisa começar com "${prefix}" para comprovar que é um ensaio isolado.`);
  }
  return { source, target };
}
