import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { assertTestDatabaseUrl } from "./scripts/database-url-safety.mjs";

// Prisma CLI auto-loads .env; a plain `vitest run` process does not, which left
// DATABASE_URL undefined here even when .env defines it — integration suites
// guarded by describe.skipIf(!process.env.DATABASE_URL) silently skipped, and
// older unguarded suites failed with "Environment variable not found: DATABASE_URL".
const envFile = fileURLToPath(new URL("./.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Mesmo guard de scripts/run-tests.mjs — uma única fonte de verdade, para que
// `vitest run` direto (fora do wrapper pnpm test) nunca aceite um banco que o
// wrapper rejeitaria.
process.env.DATABASE_URL = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
process.env.REDE_TEST_DATABASE_GUARD = "confirmed";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 15_000,
    // Integration suites share one real PostgreSQL schema. Serializing files
    // prevents unrelated snapshot transactions from deadlocking each other.
    fileParallelism: false,
    coverage: { reporter: ["text", "html"] },
  },
});
