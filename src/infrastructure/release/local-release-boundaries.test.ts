import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import reviewed from "../../../docs/PHASE_9Q2A_SURFACE_MANIFEST.json";
import migrations from "../../../docs/PHASE_9Q2A_MIGRATION_MANIFEST.json";
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";
import { vi } from "vitest";
function walk(path: string): string[] { return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)]); }
function directGate(source: string) {
  const tree = ts.createSourceFile("surface.ts", source, ts.ScriptTarget.Latest, true);
  if (tree.statements.some(node => ts.isExportDeclaration(node) || (ts.isVariableStatement(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)))) return false;
  const functions = tree.statements.filter(ts.isFunctionDeclaration).filter(node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
  return functions.length > 0 && functions.every(node => {
    const first = node.body?.statements[0];
    if (!first || !ts.isVariableStatement(first)) return false;
    const init = first.declarationList.declarations[0]?.initializer;
    return !!init && ts.isAwaitExpression(init) && ts.isCallExpression(init.expression) && init.expression.expression.getText(tree) === "requireDomainActionContext" && source.includes('from "./authorization"');
  });
}
describe("9Q.2A architectural release boundaries", () => {
  it("rejects new unreviewed routes and actions without a first-statement authorization gate", () => {
    const files = [...walk("src/app/api").filter(file => file.endsWith("route.ts")), ...walk("src/app/actions").filter(file => file.endsWith(".ts") && !file.endsWith(".test.ts"))];
    for (const file of files) {
      const path = relative(process.cwd(), file).replaceAll("\\", "/"); const source = readFileSync(file, "utf8");
      const baseline = reviewed.find(row => row.path === path);
      if (baseline) expect(createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex"), `Surface requires review: ${path}`).toBe(baseline.sha256);
      else expect(path.startsWith("src/app/actions/") && directGate(source), `New surface needs explicit reviewed authorization: ${path}`).toBe(true);
    }
  });
  it("does not accept a comment or unused gate import as authorization", () => { expect(directGate('import {requireDomainActionContext} from "./authorization"; export async function unsafe() { return true; }')).toBe(false); });
  it("preserves the exact migration set and checksums", () => {
    const actual = readdirSync("prisma/migrations", { withFileTypes: true }).filter(row => row.isDirectory()).map(row => {
      const text = readFileSync(join("prisma/migrations", row.name, "migration.sql"), "utf8").replaceAll("\r\n", "\n");
      return { name: row.name, checksum: createHash("sha256").update(text).digest("hex"), windowsChecksum: createHash("sha256").update(text.replaceAll("\n", "\r\n")).digest("hex") };
    }).sort((a, b) => a.name.localeCompare(b.name));
    expect(actual).toEqual(migrations);
  });
  it("issues unpredictable ingress correlations and contextual CSP", () => {
    vi.stubEnv("NODE_ENV", "test");
    try { const a = middleware(new NextRequest("http://localhost/ajuda", { headers: { "x-correlation-id": "guessable" } })); const b = middleware(new NextRequest("http://localhost/ajuda")); expect(a.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/); expect(a.headers.get("x-correlation-id")).not.toBe(b.headers.get("x-correlation-id")); expect(a.headers.get("content-security-policy")).toContain("frame-ancestors 'none'"); } finally { vi.unstubAllEnvs(); }
  });
  it("blocks production traffic with CSP but leaves liveness available", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "invalid");
    try { const blocked = middleware(new NextRequest("http://localhost/ajuda")); expect(blocked.status).toBe(503); expect(blocked.headers.get("content-security-policy")).toContain("'strict-dynamic'"); expect(blocked.headers.get("content-security-policy")).not.toContain("'unsafe-eval'"); expect(middleware(new NextRequest("http://localhost/api/health/live")).status).toBe(200); } finally { vi.unstubAllEnvs(); }
  });
});
