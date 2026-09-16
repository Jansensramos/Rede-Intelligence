import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Fase 10C - decisao 9 (changeContext) + correcao focal pos-auditoria, achado ALTO-3
 * (catalogo legado). Dois escopos DISTINTOS e deliberadamente separados neste arquivo:
 *
 * 1. `changeContext` (decisao 9): sempre gravou (persistContextSelection ->
 *    prisma.aIConversation.updateMany) mas estava rotulada `mode: "READ_ONLY"`. Corrigida
 *    para `MUTATION`. A regressao "generaliza" abaixo cobre APENAS o mesmo padrao estrutural
 *    de `changeContext` - uma ferramenta delegada por REFERENCIA NOMEADA
 *    (`execute: nomeDaFuncao`, nao uma arrow function inline) cujo CORPO PROPRIO contem uma
 *    escrita Prisma direta. Ela NAO detecta escrita alcancada por uma CHAMADA INDIRETA a
 *    outro modulo (ex.: uma arrow function inline que chama `getXWorkspace(...)`, e essa
 *    funcao, em outro arquivo, escreve) - esse e exatamente o caso do achado ALTO-3 abaixo,
 *    que tem seu proprio mecanismo de deteccao porque o padrao e estruturalmente diferente.
 *
 * 2. ALTO-3: manifesto explicito, exato e mantido a mao (NUNCA gerado/auto-atualizado em
 *    teste) das excecoes legadas ja conhecidas - ferramentas `READ_ONLY` cujo getter de
 *    workspace grava antes de ler, documentado desde a 10B
 *    (docs/PHASE_10B_CONTEXT_ENGINE_CONTRACT.md secao 5: "Alguns getters nao sao leituras
 *    puras"). Esta correcao NAO reclassifica nem refatora essas 13 ferramentas (isso mudaria
 *    permissao/comportamento fora do piloto 10C, fora de escopo aqui) - so documenta
 *    nominalmente o que existe e cria um gate preventivo contra novas excecoes silenciosas.
 */

const TOOL_REGISTRY_PATH = join(process.cwd(), "src", "application", "ai", "tool-registry.ts");
/** `tx.` cobre escritas dentro de `prisma.$transaction(async (tx) => ...)`, como `releaseSalesReservation`. */
const PRISMA_WRITE_PATTERN = /\b(?:prisma|tx)\.\w+\.(create|update|updateMany|upsert|delete|deleteMany)\(/;

function extractFunctionBody(source: string, functionName: string): string {
  const declaration = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${functionName}\\s*\\(`);
  const match = declaration.exec(source);
  if (!match) throw new Error(`funcao ${functionName} nao encontrada`);
  let index = match.index + match[0].length;
  while (source[index] !== "{") index += 1;
  let depth = 0;
  const start = index;
  do {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") depth -= 1;
    index += 1;
  } while (depth > 0 && index < source.length);
  return source.slice(start, index);
}

function toolRegistrationLine(source: string, toolName: string): string {
  const pattern = new RegExp(`makeTool\\(\\{ name: "${toolName}"[^\\n]*?\\}\\),`);
  const match = pattern.exec(source);
  if (!match) throw new Error(`registro de ${toolName} nao encontrado`);
  return match[0];
}

describe("tool-registry.ts - regressao de classificacao de changeContext (Fase 10C, decisao 9)", () => {
  const source = readFileSync(TOOL_REGISTRY_PATH, "utf8");

  it("changeContext esta registrada como MUTATION, nunca READ_ONLY", () => {
    const registration = toolRegistrationLine(source, "changeContext");
    expect(registration).toMatch(/mode:\s*"MUTATION"/);
    expect(registration).not.toMatch(/mode:\s*"READ_ONLY"/);
  });

  it("a funcao changeContext realmente escreve (prova de que a reclassificacao e factual, nao decorativa)", () => {
    const body = extractFunctionBody(source, "changeContext");
    expect(body).toMatch(/persistContextSelection\(/);
  });

  it("persistContextSelection grava via Prisma (aIConversation.updateMany)", () => {
    const contextBuilderPath = join(process.cwd(), "src", "application", "ai", "context-builder.ts");
    const contextBuilder = readFileSync(contextBuilderPath, "utf8");
    const body = extractFunctionBody(contextBuilder, "persistContextSelection");
    expect(body).toMatch(PRISMA_WRITE_PATTERN);
  });

  it("escopo estreito e deliberado: nenhuma ferramenta delegada por REFERENCIA NOMEADA (execute: nomeDaFuncao, mesmo padrao de changeContext) com escrita Prisma direta no proprio corpo pode estar registrada como READ_ONLY - nao cobre chamadas indiretas (ver ALTO-3 abaixo para essas)", () => {
    const delegatedPattern = /execute:\s*(\w+)\s*\}\)/g;
    const offenders: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = delegatedPattern.exec(source))) {
      const functionName = match[1];
      if (functionName === "changeContext") continue; // ja coberto e ja corrigido acima
      let body: string;
      try { body = extractFunctionBody(source, functionName); } catch { continue; }
      if (PRISMA_WRITE_PATTERN.test(body)) {
        const toolNameMatch = new RegExp(`name:\\s*"(\\w+)"[^}]*execute:\\s*${functionName}\\s*\\}\\)`).exec(source);
        const registration = toolNameMatch ? toolRegistrationLine(source, toolNameMatch[1]) : "";
        if (/mode:\s*"READ_ONLY"/.test(registration)) offenders.push(functionName);
      }
    }
    expect(offenders, `funcoes delegadas por referencia com escrita Prisma direta ainda rotuladas READ_ONLY: ${offenders.join(", ")}`).toEqual([]);
  });
});

/**
 * ALTO-3: manifesto fixo (nao gerado, nao auto-atualizavel) das 13 ferramentas legadas
 * `READ_ONLY` cujo getter de workspace realiza escrita real ANTES de ler. Revisado a mao
 * nesta correcao, cruzando cada ferramenta com o helper impuro que ela chama.
 */
const IMPURE_LEGACY_GETTERS = [
  { name: "getLegalWorkspace", modulePath: join(process.cwd(), "src", "application", "legal", "legal-service.ts"), sideEffectFunction: "refreshLegalDeadlines" },
  { name: "getSalesWorkspace", modulePath: join(process.cwd(), "src", "application", "sales", "sales-service.ts"), sideEffectFunction: "releaseExpiredReservations" },
] as const;

const KNOWN_LEGACY_READ_ONLY_SIDE_EFFECT_TOOLS: ReadonlyArray<{ tool: string; impureGetter: (typeof IMPURE_LEGACY_GETTERS)[number]["name"] }> = [
  { tool: "getLegalReadiness", impureGetter: "getLegalWorkspace" },
  { tool: "getLegalDeadlines", impureGetter: "getLegalWorkspace" },
  { tool: "getPropertyDueDiligence", impureGetter: "getLegalWorkspace" },
  { tool: "getSalesInventory", impureGetter: "getSalesWorkspace" },
  { tool: "getUnitTypologyPerformance", impureGetter: "getSalesWorkspace" },
  { tool: "getPricePerSquareMeter", impureGetter: "getSalesWorkspace" },
  { tool: "getDiscountGranted", impureGetter: "getSalesWorkspace" },
  { tool: "getExpiringProposals", impureGetter: "getSalesWorkspace" },
  { tool: "getDelinquentCustomers", impureGetter: "getSalesWorkspace" },
  { tool: "getReceivableCurve", impureGetter: "getSalesWorkspace" },
  { tool: "getRescindedUnits", impureGetter: "getSalesWorkspace" },
  { tool: "getPendingCommissions", impureGetter: "getSalesWorkspace" },
  { tool: "getUnitsAwaitingDelivery", impureGetter: "getSalesWorkspace" },
];

describe("tool-registry.ts - ALTO-3: manifesto e gate preventivo das excecoes legadas READ_ONLY com efeito colateral", () => {
  const toolRegistrySource = readFileSync(TOOL_REGISTRY_PATH, "utf8");
  const getterSources = new Map(IMPURE_LEGACY_GETTERS.map((getter) => [getter.name, readFileSync(getter.modulePath, "utf8")]));

  it("o manifesto tem exatamente 13 entradas (pinado - qualquer mudanca exige revisao humana explicita deste arquivo)", () => {
    expect(KNOWN_LEGACY_READ_ONLY_SIDE_EFFECT_TOOLS).toHaveLength(13);
  });

  it("cada ferramenta do manifesto ainda esta registrada como READ_ONLY e ainda chama o getter impuro declarado", () => {
    for (const entry of KNOWN_LEGACY_READ_ONLY_SIDE_EFFECT_TOOLS) {
      const registration = toolRegistrationLine(toolRegistrySource, entry.tool);
      expect(registration, `${entry.tool} deveria continuar READ_ONLY nesta correcao (nao reclassificar fora de decisao especifica)`).toMatch(/mode:\s*"READ_ONLY"/);
      const body = toolRegistrationLine(toolRegistrySource, entry.tool);
      expect(body, `${entry.tool} deveria chamar ${entry.impureGetter}(`).toContain(`${entry.impureGetter}(`);
    }
  });

  it("cada getter impuro do manifesto ainda realiza escrita real de negocio antes de ler (premissa do manifesto continua valida)", () => {
    for (const getter of IMPURE_LEGACY_GETTERS) {
      const source = getterSources.get(getter.name)!;
      const workspaceBody = extractFunctionBody(source, getter.name);
      expect(workspaceBody, `${getter.name} deveria chamar ${getter.sideEffectFunction}(`).toContain(`${getter.sideEffectFunction}(`);
      const sideEffectBody = extractFunctionBody(source, getter.sideEffectFunction);
      const transitiveOrDirectWrite = PRISMA_WRITE_PATTERN.test(sideEffectBody) || (() => {
        // releaseExpiredReservations chama releaseSalesReservation, que e quem escreve de fato.
        const nestedCallMatch = /await\s+(\w+)\(/.exec(sideEffectBody);
        if (!nestedCallMatch) return false;
        try { return PRISMA_WRITE_PATTERN.test(extractFunctionBody(source, nestedCallMatch[1])); } catch { return false; }
      })();
      expect(transitiveOrDirectWrite, `${getter.sideEffectFunction} (ou a funcao que ele chama) deveria escrever via Prisma`).toBe(true);
    }
  });

  it("gate preventivo: nenhuma ferramenta FORA do manifesto chama um getter impuro conhecido - falha se uma nova excecao for introduzida silenciosamente", () => {
    const manifestedTools = new Set(KNOWN_LEGACY_READ_ONLY_SIDE_EFFECT_TOOLS.map((entry) => entry.tool));
    const toolNamePattern = /makeTool\(\{ name: "(\w+)"/g;
    const undocumented: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = toolNamePattern.exec(toolRegistrySource))) {
      const toolName = match[1];
      if (manifestedTools.has(toolName) || toolName === "changeContext") continue;
      const registration = toolRegistrationLine(toolRegistrySource, toolName);
      for (const getter of IMPURE_LEGACY_GETTERS) {
        if (registration.includes(`${getter.name}(`)) undocumented.push(`${toolName} -> ${getter.name}`);
      }
    }
    expect(undocumented, `ferramentas chamando getter impuro sem estar no manifesto (nova excecao nao documentada): ${undocumented.join(", ")}`).toEqual([]);
  });

  it("nenhuma das 13 ferramentas do manifesto legado entra no novo registro 10C", async () => {
    const { listAiTools } = await import("@/application/ai-tools");
    const newCatalogNames = new Set(listAiTools().map((spec) => spec.name));
    for (const entry of KNOWN_LEGACY_READ_ONLY_SIDE_EFFECT_TOOLS) {
      expect(newCatalogNames.has(entry.tool as never), `${entry.tool} nao pode estar no catalogo 10C`).toBe(false);
    }
  });
});
