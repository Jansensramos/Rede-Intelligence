import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["src/components", "src/app/(workspace)"];
const EXCLUDED = new Set(["src/components/user-facing-text-sanitizer.tsx"]);
const FORBIDDEN = [
  "Learning Loop",
  "Decision Engine",
  "Red Team 2.0",
  "Autopilot",
  "Investment Committee",
  "Tool Layer",
  "Context Engine",
  "AI Gateway",
  "COMITÊ COGNITIVO",
  "GOVERNANÇA COGNITIVA",
  "FECHAMENTO DAS FASES",
];

function filesUnder(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name).replaceAll("\\", "/");
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...filesUnder(path));
    else if (/\.(tsx|ts)$/.test(name) && !EXCLUDED.has(path)) out.push(path);
  }
  return out;
}

function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function hasWholeTerm(source: string, term: string) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^A-Za-z0-9_])" + escaped + "([^A-Za-z0-9_]|$)").test(source);
}

describe("linguagem pública da interface", () => {
  it("não expõe nomes internos da arquitetura cognitiva", () => {
    const violations: string[] = [];
    for (const root of ROOTS) {
      for (const file of filesUnder(root)) {
        const source = stripComments(readFileSync(file, "utf8"));
        for (const term of FORBIDDEN) {
          if (hasWholeTerm(source, term)) violations.push(file + ": " + term);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("carrega o tema claro e a marca oficial no shell", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    const mark = readFileSync("src/components/rede-mark.tsx", "utf8");
    const theme = readFileSync("src/app/product-theme.css", "utf8");

    expect(layout).toContain('import "./product-theme.css"');
    expect(mark).toContain("/branding/rede-intelligence-logo-color.svg");
    expect(theme).toContain("--rede-sidebar: #f2f0ea");
    expect(theme).toContain(".sidebar");
  });
});
