export function assertTestDatabaseUrl(rawUrl) {
  if (!rawUrl) throw new Error("TEST_DATABASE_URL é obrigatória para executar testes.");
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error("TEST_DATABASE_URL inválida."); }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")).toLowerCase();
  if (database !== "rede_intelligence_test") throw new Error(`Execução bloqueada: o banco '${database || "desconhecido"}' não é o banco de testes autorizado.`);
  return rawUrl;
}
