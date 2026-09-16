import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Correção crítica pós-reauditoria (achado MÉDIO "choke point de RBAC"): a reauditoria
 * confirmou que `assertAiUse` — a única função desenhada para combinar AI_READ + AI_USE +
 * capacidade de domínio num único ponto — nunca era chamada por nenhuma das 4 superfícies
 * reais; cada uma duplicava manualmente `assertAiCapability` + `assertProtectedReadCapability`,
 * criando risco real (não hipotético) de uma superfície ser corrigida e outra esquecida, e
 * nenhum teste arquitetural impedia uma futura Server Action/rota de IA de nascer sem
 * nenhuma checagem de AI_USE (o gate genérico da Fase 9Q.2A só exige uma autorização de
 * domínio qualquer, não especificamente AI_USE).
 *
 * Este teste garante duas coisas: (1) as 4 superfícies conhecidas usam EXCLUSIVAMENTE
 * `assertAiUse`, nunca a combinação manual antiga; (2) qualquer arquivo NOVO em
 * `src/app/actions` ou `src/app/api` que importe um entry point do Gateway/execução de
 * ferramentas de IA (`createOrganizationAiGateway`, `askRedeAI`, `aiToolRegistry`) também
 * precisa referenciar `assertAiUse` - falha automaticamente se não referenciar, sem exigir
 * atualização manual de nenhuma lista.
 */

const SRC_ROOT = join(process.cwd(), "src");
const TEST_FILE_PATTERN = /\.test\.(ts|tsx)$/;

function listFilesRecursive(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) { listFilesRecursive(full, out); continue; }
    if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const MANUAL_COMBINATION_PATTERN = /assertAiCapability\(|assertProtectedReadCapability\(/;

const GATEWAY_ENTRY_POINTS: Array<{ module: string; name: string }> = [
  { module: "@/application/ai-gateway", name: "createOrganizationAiGateway" },
  { module: "@/application/ai/ai-service", name: "askRedeAI" },
  { module: "@/application/ai/tool-registry", name: "aiToolRegistry" },
  // Fase 10C (decisao 6, docs/PHASE_10C_TOOL_LAYER_CONTRACT.md): novo entry point de
  // execucao de ferramenta - precisa do mesmo choke point, sem excecao.
  { module: "@/application/ai-tools", name: "executeAiTool" },
];

function importsEntryPoint(content: string, entry: { module: string; name: string }): boolean {
  const moduleEscaped = entry.module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`import\\s*(?:type\\s*)?\\{[^}]*\\b${entry.name}\\b[^}]*\\}\\s*from\\s*["']${moduleEscaped}["']`);
  return pattern.test(content);
}

describe("RBAC — choke point único assertAiUse (correção crítica pós-reauditoria, achado MÉDIO)", () => {
  it("askRedeAI e tool-registry.execute usam exclusivamente assertAiUse - nunca montam a combinação AI_READ+AI_USE+domínio manualmente", () => {
    const aiService = readFileSync(join(SRC_ROOT, "application", "ai", "ai-service.ts"), "utf8");
    expect(aiService).toMatch(/\bassertAiUse\(/);
    expect(aiService).not.toMatch(MANUAL_COMBINATION_PATTERN);
    const toolRegistry = readFileSync(join(SRC_ROOT, "application", "ai", "tool-registry.ts"), "utf8");
    expect(toolRegistry).toMatch(/\bassertAiUse\(/);
    expect(toolRegistry).not.toMatch(MANUAL_COMBINATION_PATTERN);
  });

  it("Fase 10C: application/ai-tools/service.ts (executeAiTool) usa exclusivamente assertAiUse", () => {
    const toolService = readFileSync(join(SRC_ROOT, "application", "ai-tools", "service.ts"), "utf8");
    expect(toolService).toMatch(/\bassertAiUse\(/);
    expect(toolService).not.toMatch(MANUAL_COMBINATION_PATTERN);
  });

  it("a Server Action (app/actions/ai.ts) e a rota /api/ai/chat usam exclusivamente assertAiUse", () => {
    const action = readFileSync(join(SRC_ROOT, "app", "actions", "ai.ts"), "utf8");
    expect(action).toMatch(/\bassertAiUse\(/);
    expect(action).not.toMatch(MANUAL_COMBINATION_PATTERN);
    const route = readFileSync(join(SRC_ROOT, "app", "api", "ai", "chat", "route.ts"), "utf8");
    expect(route).toMatch(/\bassertAiUse\(/);
    expect(route).not.toMatch(MANUAL_COMBINATION_PATTERN);
  });

  it("nenhum arquivo novo em src/app/actions ou src/app/api pode importar um entry point do Gateway/ferramentas de IA sem também referenciar assertAiUse", () => {
    const dirs = [join(SRC_ROOT, "app", "actions"), join(SRC_ROOT, "app", "api")];
    const failures: string[] = [];
    for (const dir of dirs) {
      for (const file of listFilesRecursive(dir).filter((candidate) => !TEST_FILE_PATTERN.test(candidate))) {
        const content = readFileSync(file, "utf8");
        const touchesGateway = GATEWAY_ENTRY_POINTS.some((entry) => importsEntryPoint(content, entry));
        if (touchesGateway && !/\bassertAiUse\(/.test(content)) {
          failures.push(file);
        }
      }
    }
    expect(failures, `arquivos que importam um entry point do AI Gateway sem chamar assertAiUse:\n${failures.join("\n")}`).toEqual([]);
  });

  it("fixture: um novo arquivo hostil que importa askRedeAI sem assertAiUse É detectado pela regra acima", () => {
    // Prova direta da regra (sem depender de plantar um arquivo real em src/app): a mesma
    // função `importsEntryPoint` usada no teste acima, aplicada a um conteúdo hostil
    // minimalista, confirma que a detecção funciona antes de confiar nela.
    const hostileContent = `import { askRedeAI } from "@/application/ai/ai-service";\nexport async function newAction() { return askRedeAI({} as never, {} as never); }`;
    const touchesGateway = GATEWAY_ENTRY_POINTS.some((entry) => importsEntryPoint(hostileContent, entry));
    expect(touchesGateway).toBe(true);
    expect(/\bassertAiUse\(/.test(hostileContent)).toBe(false);
  });
});
