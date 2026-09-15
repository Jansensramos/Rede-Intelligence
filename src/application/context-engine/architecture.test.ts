import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
function files(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : /\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [join(dir, entry.name)] : []); }

const FORBIDDEN_CONTEXT_DEPENDENCY = /infrastructure\/ai-gateway|provider-factory|tool-registry|autopilot|agent-framework|decision-engine|investment-committee|\bfetch\b|node:https|node:http|\brequire\s*\(\s*["']https?["']|\bimport\s*\(\s*["'](?:node:)?https?["']/i;

describe("Context Engine architecture", () => {
  it("keeps providers independent from Context Engine and Prisma", () => {
    for (const file of files(join(ROOT, "src", "infrastructure", "ai-gateway"))) {
      const content = readFileSync(file, "utf8");
      expect(content, file).not.toMatch(/context-engine|@prisma\/client|infrastructure\/database\/prisma/i);
    }
  });

  it("keeps Context Engine independent from providers, adapters, tools and future phases", () => {
    for (const root of [join(ROOT, "src", "domain", "context-engine"), join(ROOT, "src", "application", "context-engine")]) for (const file of files(root)) {
      const content = readFileSync(file, "utf8");
      expect(content, file).not.toMatch(FORBIDDEN_CONTEXT_DEPENDENCY);
      expect(content, file).not.toMatch(/prisma\s*\[|\$queryRaw|JSON\.stringify\([^)]*(?:row|entity|model)/i);
    }
  });

  it("uses fixed scoped readers and never accepts arbitrary source IDs", () => {
    const service = readFileSync(join(ROOT, "src", "application", "context-engine", "service.ts"), "utf8");
    const readers = readFileSync(join(ROOT, "src", "application", "context-engine", "readers.ts"), "utf8");
    expect(service).not.toMatch(/sourceIds?|tableName|modelName/);
    expect(readers).toMatch(/organizationId: request\.organizationId/); expect(readers).toMatch(/projectId: request\.projectId/);
  });

  it("portable adversarial fixture creates missing parents and always cleans up", () => {
    const root = mkdtempSync(join(tmpdir(), "context-engine-architecture-"));
    try {
      const nested = join(root, "missing", "nested"); mkdirSync(nested, { recursive: true });
      const probes = [
        ["alias.ts", 'import { CompatibleHttpAiProviderAdapter as C } from "@/infrastructure/ai-gateway/compatible-http-adapter"; export const x = C;'],
        ["namespace.mjs", 'import * as provider from "@/infrastructure/ai-gateway/safe-transport"; export { provider };'],
        ["dynamic.js", 'export const x = () => import("@/infrastructure/ai-gateway/safe-transport");'],
        ["indirect.cjs", 'const f = globalThis["fetch"]; module.exports = () => f("https://example.test");'],
      ] as const;
      for (const [name, content] of probes) writeFileSync(join(nested, name), content, "utf8");
      const discovered = files(root);
      expect(discovered).toHaveLength(probes.length);
      expect(discovered.some((file) => file.endsWith(".cjs"))).toBe(true);
      for (const file of discovered) expect(readFileSync(file, "utf8"), file).toMatch(FORBIDDEN_CONTEXT_DEPENDENCY);
    }
    finally { rmSync(root, { recursive: true, force: true }); }
    expect(() => files(root)).toThrow();
  });
});
