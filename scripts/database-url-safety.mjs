/**
 * Fonte única de verdade para identificar um banco de dados arquivado a partir de uma
 * URL de conexão (DATABASE_URL, TEST_DATABASE_URL, origem/destino de backup ou
 * restauração). Bancos arquivados (ex.: `rede_intelligence_test_archived_20260904`)
 * existem só para auditoria e nunca podem ser alvo de aplicação, worker, seed, backup,
 * restauração ou suíte de teste — em nenhum ambiente.
 *
 * Corrige o achado Bloqueador da reauditoria 9Q.2B: a versão anterior (a) só era
 * chamada por `assertTestDatabaseUrl` (TEST_DATABASE_URL) — DATABASE_URL do
 * runtime/worker/Prisma não tinha proteção alguma; (b) tinha uma cópia duplicada e
 * mais fraca em `backup-local-database.mjs`; (c) usava `/archived/i`, que não cobre
 * "archive"/"archival" (só "archived" com o "d" final); (d) falhava ABERTO (silêncio)
 * em URL inválida, em vez de bloquear.
 *
 * Extrai e valida SOMENTE o nome do banco (pathname da URL) — nunca usuário, senha,
 * host ou parâmetros de query —, para que credenciais não produzam falso positivo nem
 * possam ser usadas para disfarçar um bypass. Fail-closed: qualquer entrada que não
 * possa ser interpretada com segurança (URL inválida, percent-encoding malformado,
 * valor não textual) é recusada, nunca silenciosamente aceita.
 */

export class DatabaseUrlSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = "DatabaseUrlSafetyError";
  }
}

// Cobre "archived", "archive" e "archival" (e qualquer variante que comece com o mesmo
// radical: archived_YYYYMMDD, archive-YYYY-MM-DD, prefixo, sufixo, caixa, separador
// "_"/"-"/nenhum) através de um único radical — não é a enumeração de sufixos que se
// mostrou incompleta na correção anterior. Nenhum nome de banco legítimo desta base
// contém "archiv" por coincidência.
const ARCHIVE_MARKER = /archiv/i;

/**
 * Extrai só o nome do banco (pathname, decodificado, normalizado) de uma URL de
 * conexão. Retorna `null` quando `rawUrl` está ausente — nada para checar; exigir
 * presença é responsabilidade do chamador (`assertTestDatabaseUrl`, o schema de
 * runtime-config, etc.). Lança `DatabaseUrlSafetyError` para qualquer entrada que não
 * possa ser decodificada com segurança: fail-closed, nunca "deixa passar" por não
 * conseguir interpretar.
 */
function extractDatabaseName(rawUrl, label) {
  if (rawUrl === undefined || rawUrl === null || rawUrl === "") return null;
  if (typeof rawUrl !== "string") {
    throw new DatabaseUrlSafetyError(`${label} tem um formato inesperado e foi recusada por segurança.`);
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new DatabaseUrlSafetyError(`${label} não é uma URL de banco de dados válida.`);
  }
  let database;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    throw new DatabaseUrlSafetyError(`${label} contém um caminho codificado de forma inválida.`);
  }
  // NFKC neutraliza variantes de compatibilidade Unicode (ex.: largura total) do
  // radical "archiv" sem tentar resolver o problema geral, não solucionável por
  // regex, de homóglifos multi-idioma.
  return database.normalize("NFKC");
}

/**
 * Recusa (fail-closed) qualquer URL cujo banco de dados carregue o radical "archiv".
 * Nunca inclui a connection string, usuário, senha, host ou parâmetros na mensagem de
 * erro — só o rótulo informado pelo chamador e, quando extraído com segurança, o nome
 * do banco em si (não é segredo; é o próprio motivo do bloqueio).
 */
export function assertNotArchivedDatabase(rawUrl, label = "URL de banco") {
  const database = extractDatabaseName(rawUrl, label);
  if (database === null || database === "") return rawUrl;
  if (ARCHIVE_MARKER.test(database)) {
    throw new DatabaseUrlSafetyError(`Execução bloqueada: ${label} aponta para um banco arquivado ('${database}') — reservado somente para auditoria.`);
  }
  return rawUrl;
}

export function assertTestDatabaseUrl(rawUrl) {
  if (!rawUrl) throw new DatabaseUrlSafetyError("TEST_DATABASE_URL é obrigatória para executar testes.");
  assertNotArchivedDatabase(rawUrl, "TEST_DATABASE_URL");
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new DatabaseUrlSafetyError("TEST_DATABASE_URL inválida.");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")).toLowerCase();
  if (database !== "rede_intelligence_test") {
    throw new DatabaseUrlSafetyError(`Execução bloqueada: o banco '${database || "desconhecido"}' não é o banco de testes autorizado.`);
  }
  return rawUrl;
}
