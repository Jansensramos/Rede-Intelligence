import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

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
