import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { assertTestDatabaseUrl } from "./database-url-safety.mjs";

if (existsSync(".env")) process.loadEnvFile(".env");
const databaseUrl = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const env = { ...process.env, DATABASE_URL: databaseUrl, REDE_TEST_DATABASE_GUARD: "confirmed" };
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("Não foi possível localizar o executável do pnpm.");
for (const args of [["exec", "prisma", "migrate", "deploy"], ["exec", "prisma", "db", "seed"], ["exec", "vitest", "run", "--configLoader", "runner"]]) {
  const result = spawnSync(process.execPath, [pnpmCli, ...args], { env, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
