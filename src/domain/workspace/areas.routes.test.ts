import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ECOSYSTEM_ENTRIES, HELP_ENTRY, OPERATIONAL_AREAS, TRANSVERSAL_AREAS } from "./areas";

/**
 * Fase 9K.1: garante que toda `path` declarada na metadata de Grandes Áreas (usada pela navegação
 * em `src/components/workspace-shell.tsx`) corresponde a uma rota Next.js real dentro do grupo
 * `(workspace)`. Next.js não valida isso em tempo de build para strings soltas em `<Link href>` —
 * este teste é a rede de segurança contra um link de sidebar apontando para uma rota inexistente.
 */
const workspaceAppDir = fileURLToPath(new URL("../../app/(workspace)/", import.meta.url));

function hasRealRoute(path: string) {
  const segment = path.replace(/^\//, "");
  return existsSync(`${workspaceAppDir}${segment}/page.tsx`);
}

describe("toda Grande Área tem uma rota Next.js real (9K.1, ordem de serviço §5)", () => {
  it.each(OPERATIONAL_AREAS.map((area) => [area.id, area.path] as const))("área operacional '%s' (%s) tem page.tsx", (_id, path) => {
    expect(hasRealRoute(path)).toBe(true);
  });

  it.each(TRANSVERSAL_AREAS.map((area) => [area.id, area.path] as const))("área transversal '%s' (%s) tem page.tsx", (_id, path) => {
    expect(hasRealRoute(path)).toBe(true);
  });

  it.each(ECOSYSTEM_ENTRIES.map((entry) => [entry.id, entry.path] as const))("entrada de ecossistema '%s' (%s) tem page.tsx", (_id, path) => {
    expect(hasRealRoute(path)).toBe(true);
  });

  it("Central de Ajuda tem page.tsx", () => {
    expect(hasRealRoute(HELP_ENTRY.path)).toBe(true);
  });
});
