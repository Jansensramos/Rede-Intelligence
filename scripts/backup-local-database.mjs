import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// No credentials in arguments or output. Restore only into a newly created database;
// never replace, reset or drop an existing database.
try {
if (existsSync(".env")) process.loadEnvFile(".env");
const key = process.argv[2] ?? "DATABASE_URL";
if (!["DATABASE_URL", "TEST_DATABASE_URL"].includes(key)) throw new Error("Unsupported database selector.");
const url = new URL(process.env[key]);
if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("This backup command is restricted to the local PostgreSQL instance.");
const database = decodeURIComponent(url.pathname.slice(1));
const restoreDatabase = `rede_restore_${randomUUID().replaceAll("-", "")}`;
const directory = resolve("outputs", "backups", `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${key.toLowerCase()}`);
mkdirSync(directory, { recursive: true });
const bin = process.env.POSTGRES_BIN ?? "C:/Program Files/PostgreSQL/17/bin";
const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: database, PGCONNECT_TIMEOUT: "10" };
function run(tool, args, databaseName = database, administrative = false) {
  const credentials = administrative && process.env.BACKUP_ADMIN_USER && process.env.BACKUP_ADMIN_PASSWORD
    ? { PGUSER: process.env.BACKUP_ADMIN_USER, PGPASSWORD: process.env.BACKUP_ADMIN_PASSWORD } : {};
  try { return execFileSync(join(bin, `${tool}.exe`), args, { env: { ...env, ...credentials, PGDATABASE: databaseName }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); }
  catch {
    throw new Error(`Local backup failed at ${tool}; no migration is authorized by this result. Diagnostic details withheld.`);
  }
}
function sql(query, databaseName = database) { return run("psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", query], databaseName).trim(); }
function manifest(databaseName) {
  const tables = JSON.parse(sql("SELECT coalesce(json_agg(tablename ORDER BY tablename), '[]') FROM pg_tables WHERE schemaname = 'public'", databaseName));
  const identifier = (value) => '"' + value.replaceAll('"', '""') + '"';
  if (!tables.length) return [];
  const query = tables.map((table) => `SELECT json_build_object('table', '${table.replaceAll("'", "''")}', 'rows', count(*), 'contentChecksum', md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text)), ''))) FROM public.${identifier(table)} t`).join(" UNION ALL ");
  // Read SQL from a file to avoid Windows argument-size limits for the full catalog.
  const queryFile = join(directory, "verify-tables.sql");
  writeFileSync(queryFile, query);
  return run("psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", queryFile], databaseName).trim().split(/\r?\n/).map((line) => JSON.parse(line)).sort((a, b) => a.table.localeCompare(b.table));
}
const before = manifest(database);
const dump = join(directory, "database.dump");
run("pg_dump", ["--format=custom", "--file", dump, "--no-owner", "--no-privileges"]);
const toc = run("pg_restore", ["--list", dump]);
if (!statSync(dump).size || !toc.includes("TABLE DATA")) throw new Error("Backup archive is empty or missing data.");
writeFileSync(join(directory, "archive-list.txt"), toc);
run("createdb", ["--template=template0", "--owner", env.PGUSER, restoreDatabase], "postgres", true);
run("pg_restore", ["--exit-on-error", "--no-owner", "--no-privileges", "--dbname", restoreDatabase, dump], restoreDatabase);
const restored = manifest(restoreDatabase);
const after = manifest(database);
writeFileSync(join(directory, "restored-tables.json"), JSON.stringify(restored, null, 2));
writeFileSync(join(directory, "source-after-tables.json"), JSON.stringify(after, null, 2));
const valid = JSON.stringify(before) === JSON.stringify(after) && JSON.stringify(before) === JSON.stringify(restored);
const report = { startedWith: key, database, restoreDatabase, createdAt: new Date().toISOString(), dump, bytes: statSync(dump).size, sha256: createHash("sha256").update(readFileSync(dump)).digest("hex"), tableCount: before.length, totalRows: before.reduce((sum, t) => sum + t.rows, 0), sourceStable: JSON.stringify(before) === JSON.stringify(after), restoredContentMatches: JSON.stringify(before) === JSON.stringify(restored), valid, tables: before };
writeFileSync(join(directory, "verification.json"), JSON.stringify(report, null, 2) + "\n");
if (!valid) throw new Error("Backup restore verification failed or the source changed. Migration remains blocked.");
console.log(JSON.stringify({ ...report, tables: undefined }));
} catch {
  console.error("Backup local recusado. Nenhuma migration autorizada; confira o ambiente e os artefatos privados. Valores e detalhes do banco foram omitidos.");
  process.exitCode = 1;
}
