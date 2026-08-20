import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

// Prisma CLI auto-loads .env; a plain `vitest run` process does not, which left
// DATABASE_URL undefined here even when .env defines it — integration suites
// guarded by describe.skipIf(!process.env.DATABASE_URL) silently skipped, and
// older unguarded suites failed with "Environment variable not found: DATABASE_URL".
const envFile = fileURLToPath(new URL("./.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    testTimeout: 15_000,
    // Integration suites share one real PostgreSQL schema. Serializing files
    // prevents unrelated snapshot transactions from deadlocking each other.
    fileParallelism: false,
    coverage: { reporter: ["text", "html"] },
  },
});
