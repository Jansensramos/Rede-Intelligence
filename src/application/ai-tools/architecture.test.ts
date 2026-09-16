import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve as resolvePath, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Fase 10C (decisao 6, docs/PHASE_10C_TOOL_LAYER_CONTRACT.md) - gate arquitetural
 * obrigatorio, entregue junto com o codigo.
 *
 * CORRECAO BLOQUEADORA FINAL pos-reauditoria (achado ALTO-2, "bypass estrutural do choke
 * point"): a versao anterior deste arquivo provava a ausencia das fases internas
 * (`prepareAiToolInvocation`/`consumeAiToolInvocation`) fora do pacote com uma varredura
 * TEXTUAL (`content.includes(identifier)`). A reauditoria provou um bypass FUNCIONAL: um
 * arquivo fora do pacote montou o identificador via
 * `["prepare","Ai","Tool","Invocation"].join("")`, fez `import()` dinamico do modulo e
 * acessou a funcao por colchete - nunca escrevendo o nome literalmente, o gate textual nao
 * detectou, e a funcao interna foi de fato invocada de fora do pacote.
 *
 * Duas correcoes independentes, nesta ordem de forca:
 *   1. FECHAMENTO ESTRUTURAL (a garantia real): `prepareAiToolInvocation`/
 *      `consumeAiToolInvocation` deixaram de ser bindings `export`ados de `service.ts`. Um
 *      modulo ES so expoe o que declara com `export` - nao existe tecnica de import (estatica,
 *      dinamica, `require`, acesso computado, concatenacao, reflexao) capaz de obter um
 *      binding nao exportado a partir do objeto de namespace do modulo. Isto fecha a CLASSE
 *      inteira de bypass, nao so a instancia reproduzida pela reauditoria - ver docstring no
 *      topo de `service.ts`.
 *   2. GATE AST REAL (defesa em profundidade + diagnostico precoce, mesmo padrao ja auditado
 *      de `ai-gateway/architecture.test.ts`): usa a TypeScript Compiler API para reconhecer
 *      import estatico/dinamico/`require`, aliases, namespace imports, reexport, acesso
 *      computado com chave literal OU estaticamente resolvivel (concatenacao `+`,
 *      `[...].join(sep)`, template literal com ou sem interpolacao resolvivel), examinando
 *      `.ts`/`.tsx`/`.js`/`.mjs`/`.cjs`. Mesmo que o binding real ja nao exista (defesa 1), o
 *      gate falha ALTO/explicito assim que qualquer arquivo fora do pacote TENTA a forma de
 *      acesso, em vez de deixar o erro estourar silenciosamente em runtime.
 *
 * Limite residual documentado (mesmo principio ja aceito por `ai-gateway/architecture.test.ts`,
 * secao "Limite residual"): o gate AST nao resolve `eval(...)`, `new Function(...)`, ou uma
 * string construida a partir de entrada verdadeiramente dinamica em runtime (leitura de
 * arquivo, variavel de ambiente, resposta de rede) - fechar isso exigiria um interpretador
 * completo de fluxo de dados, fora de escopo de qualquer scanner estatico. Isto NAO enfraquece
 * a protecao real: como a defesa 1 (fechamento estrutural) independe totalmente de deteccao
 * textual/AST, mesmo essa metaprogramacao arbitraria NUNCA teria um binding para obter -
 * `mod[identificadorComputadoEmRuntime]` sempre resolve para `undefined`, porque o binding
 * simplesmente nao existe no objeto de namespace do modulo, qualquer que seja a tecnica usada
 * para nomea-lo. O gate AST cobre as formas ESTATICAS (fixtures abaixo) como defesa adicional
 * e alarme precoce - nunca como a unica garantia.
 */

const ROOT = process.cwd();
const SRC_ROOT = join(ROOT, "src");
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : /\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name) ? [join(dir, entry.name)] : [],
  );
}
function productionFiles(dir: string): string[] {
  return files(dir).filter((file) => !/\.test\./.test(file));
}

const FORBIDDEN_TOOL_DEPENDENCY = /infrastructure\/ai-gateway|provider-factory|tool-registry|\bautopilot\b|agent-framework|cognitive-tool|red-team-2|decision-engine|investment-committee|\bfetch\b|node:https|node:http|node:child_process|node:fs\b|\brequire\s*\(\s*["']https?["']|\bimport\s*\(\s*["'](?:node:)?https?["']/i;

const APP_ROOT = join(SRC_ROOT, "application", "ai-tools");
const DOMAIN_ROOT = join(SRC_ROOT, "domain", "ai-tools");

/**
 * Excecao unica, documentada e travada por caminho EXATO (mesmo padrao de
 * `ai-gateway/architecture.test.ts` TRANSPORT_ALLOWLIST): `service.ts` usa
 * `node:child_process` SOMENTE dentro do harness de teste de corrida
 * (`__raceTestConsumeInSubprocess`), gatilhado por uma variavel de ambiente que nunca existe
 * em producao, para preservar cobertura de corrida entre processos Node/PrismaClient
 * genuinamente independentes (ALTO-1) sem reexpor `prepareAiToolInvocation`/
 * `consumeAiToolInvocation` como bindings exportados (ALTO-2). Qualquer OUTRA dependencia
 * proibida neste mesmo arquivo (fetch, tool-registry, etc.) ainda reprova - a excecao cobre
 * exclusivamente o token `node:child_process`.
 */
const CHILD_PROCESS_ALLOWLIST = new Set([join(APP_ROOT, "service.ts")]);

/** Modelos Prisma que o Tool Layer pode escrever - fechado e travado (falha se crescer silenciosamente). */
const ALLOWED_PRISMA_WRITE_MODELS = ["aIExecutionLog", "aIToolCallLog"];

function writtenPrismaModels(content: string): string[] {
  const pattern = /\b(?:tx|prisma)\.(\w+)\.(create|update|updateMany|upsert|delete|deleteMany)\(/g;
  const models = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) models.add(match[1]);
  return [...models].sort();
}

/** Remove comentarios de bloco e de linha antes de checar codigo real - evita falso positivo contra a propria documentacao do arquivo. */
function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("Tool Layer architecture (Fase 10C)", () => {
  it("nao depende de providers, do registro legado de ferramentas ou de conceitos de fases futuras", () => {
    for (const file of [...productionFiles(APP_ROOT), ...productionFiles(DOMAIN_ROOT)]) {
      const content = readFileSync(file, "utf8");
      if (CHILD_PROCESS_ALLOWLIST.has(file)) {
        const withoutChildProcessToken = content.replace(/node:child_process/g, "");
        expect(withoutChildProcessToken, file).not.toMatch(FORBIDDEN_TOOL_DEPENDENCY);
        continue;
      }
      expect(content, file).not.toMatch(FORBIDDEN_TOOL_DEPENDENCY);
    }
  });

  it("domain/ai-tools nunca importa @prisma/client nem infrastructure/database/prisma", () => {
    for (const file of files(DOMAIN_ROOT)) {
      const content = readFileSync(file, "utf8");
      expect(content, file).not.toMatch(/@prisma\/client|infrastructure\/database\/prisma/);
    }
  });

  it("o unico escritor Prisma e application/ai-tools/service.ts, e apenas nos modelos allowlisted (AIExecutionLog CAS + AIToolCallLog)", () => {
    const writers: string[] = [];
    for (const file of productionFiles(APP_ROOT)) {
      const models = writtenPrismaModels(readFileSync(file, "utf8"));
      if (models.length) writers.push(file);
      for (const model of models) {
        expect(ALLOWED_PRISMA_WRITE_MODELS, `${file} escreve em modelo fora do allowlist: ${model}`).toContain(model);
      }
    }
    expect(writers, "apenas service.ts deve escrever no Tool Layer").toEqual([join(APP_ROOT, "service.ts")]);
  });

  it("executeAiTool e o unico ponto de entrada exportado por application/ai-tools/index.ts", () => {
    const index = stripComments(readFileSync(join(APP_ROOT, "index.ts"), "utf8"));
    expect(index).toMatch(/export\s*\{\s*executeAiTool\s*\}\s*from\s*".\/service"/);
    expect(index).not.toMatch(/export\s*\*/); // nunca um wildcard - so reexport nomeado e explicito
    const service = readFileSync(join(APP_ROOT, "service.ts"), "utf8");
    expect(service).toMatch(/export async function executeAiTool\(/);
  });

  it("ALTO-2: index.ts nunca menciona as fases internas em codigo real (nem por reexport, alias ou string) - fora de comentarios", () => {
    const index = stripComments(readFileSync(join(APP_ROOT, "index.ts"), "utf8"));
    for (const identifier of INTERNAL_PHASE_IDENTIFIERS) expect(index, `index.ts menciona ${identifier} fora de um comentario`).not.toMatch(new RegExp(identifier));
  });

  it("ALTO-2 (fechamento estrutural): prepareAiToolInvocation/consumeAiToolInvocation nao sao mais export de service.ts - service.ts nunca declara `export ... function` com esses nomes", () => {
    const service = stripComments(readFileSync(join(APP_ROOT, "service.ts"), "utf8"));
    for (const identifier of INTERNAL_PHASE_IDENTIFIERS) {
      expect(service, `service.ts ainda exporta ${identifier}`).not.toMatch(new RegExp(`export\\s+(?:async\\s+)?function\\s+${identifier}\\b`));
      expect(service, `service.ts declara ${identifier} sem export (esperado - binding privado)`).toMatch(new RegExp(`(?<!export\\s)(?:^|\\n)async function ${identifier}\\b`));
    }
  });

  it("ALTO-2: prova estrutural - o modulo publico (@/application/ai-tools) nao expoe as fases internas em runtime", async () => {
    const publicModule = await import("./index");
    expect(Object.prototype.hasOwnProperty.call(publicModule, "prepareAiToolInvocation")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(publicModule, "consumeAiToolInvocation")).toBe(false);
    expect(typeof (publicModule as Record<string, unknown>).executeAiTool).toBe("function");
  });

  it("ALTO-2: prova estrutural - mesmo o modulo interno (./service, caminho profundo) nao expoe as fases internas como bindings, nem por acesso computado com chave montada por concatenacao (reproducao literal do bypass da reauditoria)", async () => {
    const internalModule = (await import("./service")) as Record<string, unknown>;
    const concatenatedPrepare = ["prepare", "Ai", "Tool", "Invocation"].join("");
    const concatenatedConsume = ["consume", "Ai", "Tool", "Invocation"].join("");
    expect(internalModule[concatenatedPrepare], "acesso computado por concatenacao deveria ser undefined - binding nao existe").toBeUndefined();
    expect(internalModule[concatenatedConsume], "acesso computado por concatenacao deveria ser undefined - binding nao existe").toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(internalModule, "prepareAiToolInvocation")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(internalModule, "consumeAiToolInvocation")).toBe(false);
  });

  it("catalog.ts nunca digita domainCapability a mao - deriva de contextPolicyFor", () => {
    const catalog = readFileSync(join(APP_ROOT, "catalog.ts"), "utf8");
    expect(catalog).toMatch(/contextPolicyFor\(/);
    expect(catalog).not.toMatch(/domainCapability:\s*"[A-Z_]+"/);
  });
});

/* ================================================================================================
 * ALTO-2 - GATE AST REAL (TypeScript Compiler API), mesmo padrao de ai-gateway/architecture.test.ts
 * ================================================================================================
 */

/**
 * Nomes que jamais podem ser referenciados por nenhum arquivo fora de
 * `src/application/ai-tools/**`. Inclui as duas fases internas estruturalmente privadas
 * (defesa 1) e, por profundidade de defesa, os nomes do harness de teste de corrida (nao sao
 * uma superficie publica pretendida - so o proprio pacote deveria referencia-los).
 */
const INTERNAL_PHASE_IDENTIFIERS = ["prepareAiToolInvocation", "consumeAiToolInvocation"];
const INTERNAL_HARNESS_IDENTIFIERS = ["__raceTestPrepare", "__raceTestConsume", "__raceTestConsumeInSubprocess"];
const FORBIDDEN_INTERNAL_IDENTIFIER_SET = new Set([...INTERNAL_PHASE_IDENTIFIERS, ...INTERNAL_HARNESS_IDENTIFIERS]);

/** Extensoes produtivas escaneadas pelo gate - inclui .cjs explicitamente (requisito da correcao final). */
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs"];

export type AiToolsViolationKind =
  | "INTERNAL_IDENTIFIER_REFERENCE" // identificador interno (fase ou harness) referenciado como Identifier node
  | "INTERNAL_COMPUTED_PROPERTY_ACCESS" // acesso por colchete cuja chave resolve (literal ou constant-fold) a um identificador interno
  | "INTERNAL_DEEP_IMPORT"; // import/require/import() dinamico cujo especificador resolve para dentro do pacote alem da raiz publica

export interface AiToolsViolation {
  kind: AiToolsViolationKind;
  detail: string;
  line: number;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/**
 * "Constant folding" minimo: resolve o valor de uma expressao de string SOMENTE quando todas
 * as suas partes sao estaticas (literais, template literals sem interpolacao ou com
 * interpolacao ela mesma resolvivel, concatenacao binaria `+` de operandos resolviveis,
 * `[...].join(separador)` de um array literal cujos elementos sao todos resolviveis, e uma
 * referencia a uma variavel `const` cujo inicializador e ele mesmo resolvivel - propagacao de
 * constante de UM salto via `constBindings`, essencial porque o bypass real reproduzido pela
 * reauditoria atribui o nome concatenado a uma `const` ANTES de usa-lo no acesso por colchete
 * (`const fnName = [...].join(""); mod[fnName]`), nunca inline). Qualquer parte nao resolvivel
 * (identificador desconhecido, chamada de funcao arbitraria, leitura de ambiente/rede/arquivo)
 * devolve `null` - o scanner desiste em vez de arriscar falso positivo. Isto e deliberadamente
 * mais amplo que o scanner de referencia (ai-gateway/architecture.test.ts documenta NAO
 * resolver concatenacao `+`/`.join`) porque o achado ALTO-2 desta correcao exige detectar
 * exatamente essa tecnica.
 */
function resolveStaticStringValue(node: ts.Node, constBindings: ReadonlyMap<string, string> = new Map()): string | null {
  if (ts.isStringLiteralLike(node)) return node.text; // string literal + no-substitution template literal
  if (ts.isParenthesizedExpression(node)) return resolveStaticStringValue(node.expression, constBindings);
  if (ts.isIdentifier(node)) return constBindings.get(node.text) ?? null;
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      const resolved = resolveStaticStringValue(span.expression, constBindings);
      if (resolved === null) return null;
      out += resolved + span.literal.text;
    }
    return out;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveStaticStringValue(node.left, constBindings);
    const right = resolveStaticStringValue(node.right, constBindings);
    if (left === null || right === null) return null;
    return left + right;
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "join" && ts.isArrayLiteralExpression(node.expression.expression)) {
    const separator = node.arguments.length > 0 ? resolveStaticStringValue(node.arguments[0], constBindings) : ",";
    if (separator === null) return null;
    const parts: string[] = [];
    for (const element of node.expression.expression.elements) {
      const resolved = resolveStaticStringValue(element, constBindings);
      if (resolved === null) return null;
      parts.push(resolved);
    }
    return parts.join(separator);
  }
  return null;
}

/**
 * Coleta todo `const NOME = <expressao>` do arquivo (qualquer profundidade de bloco - nao
 * tenta resolver sombreamento/escopo com precisao, over-approximation deliberada e segura
 * para deteccao) cuja expressao resolve estaticamente, formando o mapa usado pela propagacao
 * de constante de um salto acima. Nunca resolve `let`/`var` (podem ser reatribuidos).
 */
function collectConstStringBindings(sourceFile: ts.SourceFile): Map<string, string> {
  const bindings = new Map<string, string>();
  function visit(node: ts.Node) {
    if (ts.isVariableStatement(node) && (node.declarationList.flags & ts.NodeFlags.Const) !== 0) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          const resolved = resolveStaticStringValue(declaration.initializer, bindings);
          if (resolved !== null) bindings.set(declaration.name.text, resolved);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return bindings;
}

/** Resolve um especificador de import/require (relativo ou alias `@/`) para um caminho absoluto normalizado (sem extensao) - `null` se for um pacote de terceiros (nunca interno). */
function resolveSpecifierToAbsolute(specifierText: string, importingFileAbsolutePath: string): string | null {
  let base: string;
  if (specifierText.startsWith(".")) base = resolvePath(dirname(importingFileAbsolutePath), specifierText);
  else if (specifierText.startsWith("@/")) base = resolvePath(SRC_ROOT, specifierText.slice(2));
  else return null;
  return base.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
}

/** Verdadeiro quando o especificador alcanca um arquivo DENTRO do pacote alem da raiz publica (`@/application/ai-tools` ou `.../ai-tools/index`, que resolvem ao barrel legitimo). */
function isForbiddenInternalSpecifier(specifierText: string, importingFileAbsolutePath: string): boolean {
  const resolved = resolveSpecifierToAbsolute(specifierText, importingFileAbsolutePath);
  if (resolved === null) return false;
  if (resolved === APP_ROOT || resolved === join(APP_ROOT, "index")) return false; // raiz publica do pacote - legitimo
  return resolved === APP_ROOT || resolved.startsWith(APP_ROOT + sep);
}

/** Analisa uma SourceFile ja parseada e devolve toda violacao - a allowlist (arquivos DENTRO do pacote) e aplicada pelo chamador, nunca aqui. */
export function scanAiToolsSourceFileForViolations(sourceFile: ts.SourceFile, importingFileAbsolutePath: string): AiToolsViolation[] {
  const violations: AiToolsViolation[] = [];
  const constBindings = collectConstStringBindings(sourceFile);

  function flagIdentifier(node: ts.Node, text: string) {
    violations.push({ kind: "INTERNAL_IDENTIFIER_REFERENCE", detail: `referencia ao identificador interno "${text}"`, line: lineOf(sourceFile, node) });
  }

  function visit(node: ts.Node) {
    // 1. Qualquer referencia ao identificador em si (import nomeado/aliased, namespace
    //    property access, require destructuring, export specifier) - varredura ampla via AST
    //    (nao mais substring bruta), cobre a MAIORIA das formas triviais listadas no requisito.
    if (ts.isIdentifier(node) && FORBIDDEN_INTERNAL_IDENTIFIER_SET.has(node.text)) {
      flagIdentifier(node, node.text);
    }

    // 2. Acesso computado/por colchete cuja chave resolve (literal ou constant-fold) a um
    //    identificador interno - fecha EXATAMENTE o bypass provado pela reauditoria
    //    (`["prepare","Ai","Tool","Invocation"].join("")` + acesso por colchete), que nao
    //    contem o identificador como um Identifier node em nenhum lugar do arquivo.
    if (ts.isElementAccessExpression(node) && node.argumentExpression) {
      const resolved = resolveStaticStringValue(node.argumentExpression, constBindings);
      if (resolved !== null && FORBIDDEN_INTERNAL_IDENTIFIER_SET.has(resolved)) {
        violations.push({ kind: "INTERNAL_COMPUTED_PROPERTY_ACCESS", detail: `acesso computado resolvido estaticamente para "${resolved}"`, line: lineOf(sourceFile, node) });
      }
    }

    // 3. Import estatico, `require(...)` e `import(...)` dinamico cujo especificador (literal
    //    OU estaticamente resolvivel) alcanca um arquivo DENTRO do pacote alem da raiz
    //    publica - flagra independentemente do que e extraido do modulo (cobre tambem
    //    `import * as internal from "..."` isolado, sem nenhum acesso de propriedade ainda).
    if (ts.isImportDeclaration(node)) {
      const specifierText = resolveStaticStringValue(node.moduleSpecifier, constBindings);
      if (specifierText !== null && isForbiddenInternalSpecifier(specifierText, importingFileAbsolutePath)) {
        violations.push({ kind: "INTERNAL_DEEP_IMPORT", detail: `import estatico de caminho interno "${specifierText}"`, line: lineOf(sourceFile, node) });
      }
    }
    if (ts.isCallExpression(node)) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if ((isRequire || isDynamicImport) && node.arguments.length > 0) {
        const specifierText = resolveStaticStringValue(node.arguments[0], constBindings);
        if (specifierText !== null && isForbiddenInternalSpecifier(specifierText, importingFileAbsolutePath)) {
          violations.push({ kind: "INTERNAL_DEEP_IMPORT", detail: `${isRequire ? "require" : "import()"} de caminho interno "${specifierText}"`, line: lineOf(sourceFile, node) });
        }
      }
    }

    // 4. `export * from "..."` / `export { x } from "..."` cujo especificador alcanca o
    //    pacote internamente (reexport indireto). `export { prepareAiToolInvocation }` (sem
    //    especificador, reexport local por nome) ja e coberto pela regra 1 (Identifier node).
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const specifierText = resolveStaticStringValue(node.moduleSpecifier, constBindings);
      if (specifierText !== null && isForbiddenInternalSpecifier(specifierText, importingFileAbsolutePath)) {
        violations.push({ kind: "INTERNAL_DEEP_IMPORT", detail: `reexport de caminho interno "${specifierText}"`, line: lineOf(sourceFile, node) });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function scriptKindFor(absolutePath: string): ts.ScriptKind {
  if (absolutePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (absolutePath.endsWith(".ts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS; // .js, .mjs, .cjs
}

function scanAiToolsFile(absolutePath: string): AiToolsViolation[] {
  const text = readFileSync(absolutePath, "utf8");
  const sourceFile = ts.createSourceFile(absolutePath, text, ts.ScriptTarget.Latest, true, scriptKindFor(absolutePath));
  return scanAiToolsSourceFileForViolations(sourceFile, absolutePath);
}

function isInsidePackage(absoluteFilePath: string): boolean {
  const relativeToApp = relative(APP_ROOT, absoluteFilePath);
  const relativeToDomain = relative(DOMAIN_ROOT, absoluteFilePath);
  return !relativeToApp.startsWith("..") || !relativeToDomain.startsWith("..");
}

function listAllRepoFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist" || entry.name === "build" || entry.name === "coverage") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { listAllRepoFiles(full, out); continue; }
    if (SCANNED_EXTENSIONS.some((extension) => full.endsWith(extension))) out.push(full);
  }
  return out;
}

describe("Tool Layer - ALTO-2 gate AST real (TypeScript Compiler API)", () => {
  it("nenhum arquivo fora de src/application/ai-tools/** (nem src/domain/ai-tools/**) referencia as fases internas ou o harness de teste, sob nenhuma forma AST reconhecida (import estatico/dinamico, require, namespace, acesso computado/concatenado, reexport)", () => {
    const offenders: string[] = [];
    for (const file of listAllRepoFiles(SRC_ROOT)) {
      if (isInsidePackage(file)) continue;
      const violations = scanAiToolsFile(file);
      for (const violation of violations) offenders.push(`${file}:${violation.line} [${violation.kind}] ${violation.detail}`);
    }
    expect(offenders, `arquivos fora do pacote que referenciam fases internas/harness do Tool Layer:\n${offenders.join("\n")}`).toEqual([]);
  });

  describe("fixtures adversariais - cada forma listada deve ser reprovada; a serie roda dentro de UM teste com cleanup em finally mesmo se uma asserção falhar", () => {
    it("todas as fixtures adversariais sao detectadas, e um import legitimo de executeAiTool nao e sinalizado", () => {
      // As fixtures analisam CONTEUDO sintetico via `scanAiToolsSourceFileForViolations`
      // diretamente (sem gravar em disco - nao ha nada para limpar em finally aqui) - so
      // precisam de um caminho de arquivo IMPORTADOR plausivel para que especificadores
      // relativos (`../application/ai-tools/service`) resolvam corretamente (nao precisa
      // existir de fato: so a resolucao de path importa). A fixture .cjs (que grava em disco)
      // tem seu proprio try/finally dedicado, no teste seguinte.
      {
        const importingFile = join(SRC_ROOT, "reporting-hidden-fixture", "probe.ts");
        const cases: Array<{ name: string; content: string; expectKind: AiToolsViolationKind | null }> = [
          { name: "import { prepareAiToolInvocation }", content: `import { prepareAiToolInvocation } from "../application/ai-tools/service";`, expectKind: "INTERNAL_IDENTIFIER_REFERENCE" },
          { name: "import { prepareAiToolInvocation as p }", content: `import { prepareAiToolInvocation as p } from "../application/ai-tools/service";`, expectKind: "INTERNAL_IDENTIFIER_REFERENCE" },
          { name: "import * as internal (namespace)", content: `import * as internal from "../application/ai-tools/service"; export const x = internal;`, expectKind: "INTERNAL_DEEP_IMPORT" },
          { name: "require(caminho relativo)", content: `const svc = require("../application/ai-tools/service"); export const x = svc.prepareAiToolInvocation;`, expectKind: "INTERNAL_DEEP_IMPORT" },
          { name: "import() dinamico (caminho relativo)", content: `export async function x() { const m = await import("../application/ai-tools/service"); return m; }`, expectKind: "INTERNAL_DEEP_IMPORT" },
          { name: "import() dinamico (alias @/)", content: `export async function x() { const m = await import("@/application/ai-tools/service"); return m; }`, expectKind: "INTERNAL_DEEP_IMPORT" },
          { name: "acesso por colchete literal", content: `declare const m: Record<string, unknown>; export const x = m["prepareAiToolInvocation"];`, expectKind: "INTERNAL_COMPUTED_PROPERTY_ACCESS" },
          { name: "acesso por colchete via concatenacao join atribuida a const (bypass real da reauditoria)", content: `declare const m: Record<string, unknown>; const fnName = ["prepare","Ai","Tool","Invocation"].join(""); export const x = m[fnName];`, expectKind: "INTERNAL_COMPUTED_PROPERTY_ACCESS" },
          { name: "acesso por colchete via template literal equivalente", content: "declare const m: Record<string, unknown>; export const x = m[`prepareAiToolInvocation`];", expectKind: "INTERNAL_COMPUTED_PROPERTY_ACCESS" },
          { name: "export * reexport", content: `export * from "../application/ai-tools/service";`, expectKind: "INTERNAL_DEEP_IMPORT" },
          { name: "export { ... } reexport nomeado", content: `export { prepareAiToolInvocation } from "../application/ai-tools/service";`, expectKind: "INTERNAL_DEEP_IMPORT" },
        ];
        for (const testCase of cases) {
          const violations = scanAiToolsSourceFileForViolations(ts.createSourceFile(importingFile, testCase.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), importingFile);
          expect(violations.some((v) => v.kind === testCase.expectKind), `${testCase.name}: esperava ${testCase.expectKind}, obteve ${JSON.stringify(violations)}`).toBe(true);
        }

        // Controle: importar executeAiTool pelo entry point publico nunca e sinalizado.
        const legitimateContent = `import { executeAiTool } from "@/application/ai-tools"; export const x = executeAiTool;`;
        const legitimateViolations = scanAiToolsSourceFileForViolations(ts.createSourceFile(importingFile, legitimateContent, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), importingFile);
        expect(legitimateViolations, `import legitimo de executeAiTool nao deveria ser sinalizado: ${JSON.stringify(legitimateViolations)}`).toEqual([]);

        // Controle: codigo legitimo interno do proprio pacote (service.ts de verdade) nao gera falso positivo quando escaneado com o caminho de importacao correto.
        const serviceContent = readFileSync(join(APP_ROOT, "service.ts"), "utf8");
        const serviceViolations = scanAiToolsSourceFileForViolations(ts.createSourceFile(join(APP_ROOT, "service.ts"), serviceContent, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), join(APP_ROOT, "service.ts"));
        // service.ts DEFINE os identificadores (declaracoes de funcao), entao o scanner CRU
        // (sem a allowlist de "dentro do pacote" aplicada pelo teste principal acima) ainda os
        // encontra como Identifier nodes - isso e esperado aqui; o teste principal e quem
        // decide que arquivos DENTRO do pacote sao isentos, nunca o scanner em si.
        expect(serviceViolations.length, "service.ts declara os identificadores - o scanner cru os encontra, a isencao e por caminho no teste principal").toBeGreaterThan(0);
      }
    });
  });

  it(".cjs esta dentro das extensoes escaneadas - uma fixture .cjs hostil e detectada", () => {
    // Precisa ficar DENTRO de src/application/ para que o especificador relativo
    // ("../ai-tools/service") resolva de fato para o pacote real - mesma estrutura da sonda
    // funcional da reauditoria original (src/application/__audit_bypass_probe__/...).
    const dir = mkdtempSync(join(SRC_ROOT, "application", ".ai-tools-gate-cjs-fixture-"));
    try {
      const probePath = join(dir, "probe.cjs");
      writeFileSync(probePath, `const svc = require("../ai-tools/service"); module.exports.x = svc["prepareAiToolInvocation"];`, "utf8");
      expect(SCANNED_EXTENSIONS.some((extension) => probePath.endsWith(extension))).toBe(true);
      const violations = scanAiToolsFile(probePath);
      expect(violations.some((v) => v.kind === "INTERNAL_DEEP_IMPORT" || v.kind === "INTERNAL_COMPUTED_PROPERTY_ACCESS"), JSON.stringify(violations)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("SONDA FUNCIONAL: reproduz literalmente o bypass da reauditoria (import() dinamico + nome montado por concatenacao + acesso por colchete) a partir de um arquivo fora do pacote, criado e removido em finally - o gate AST detecta o PADRAO estaticamente, e a execucao real (subprocesso Node isolado) confirma que o binding nao existe mais (fechamento estrutural)", async () => {
    const probeDir = mkdtempSync(join(SRC_ROOT, "application", ".alto2-reaudit-probe-"));
    const probePath = join(probeDir, "concat-bypass.ts");
    try {
      const probeSource = [
        "const partA = \"prepare\";",
        "const partB = \"Ai\";",
        "const partC = \"Tool\";",
        "const partD = \"Invocation\";",
        "const fnName = [partA, partB, partC, partD].join(\"\");",
        "",
        "export async function bypassProbe() {",
        "  const mod: Record<string, unknown> = await import(\"../ai-tools/service\");",
        "  const fn = mod[fnName] as ((...args: unknown[]) => unknown) | undefined;",
        "  return typeof fn;",
        "}",
      ].join("\n");
      writeFileSync(probePath, probeSource, "utf8");

      // 1. O gate AST detecta o PADRAO estaticamente (import() dinamico de caminho interno).
      const staticViolations = scanAiToolsFile(probePath);
      expect(staticViolations.some((v) => v.kind === "INTERNAL_DEEP_IMPORT"), `esperava INTERNAL_DEEP_IMPORT no import() dinamico: ${JSON.stringify(staticViolations)}`).toBe(true);

      // 2. A execucao real (subprocesso Node isolado, mesma tecnica ja usada pelos testes de
      //    corrida deste pacote) confirma o fechamento ESTRUTURAL: o binding nao existe, mesmo
      //    fora do escopo do gate - prova que a garantia nao depende de nenhum scanner "pegar"
      //    a ofuscacao certa.
      const relativeProbePathFromCwd = `./${relative(ROOT, probePath).split(sep).join("/")}`;
      const evalSource = `
        import { bypassProbe } from "${relativeProbePathFromCwd}";
        const resultType = await bypassProbe();
        process.stdout.write(JSON.stringify({ resultType }));
      `;
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "./scripts/patch-node-os.mjs", "--import", "tsx", "--input-type=module", "--eval", evalSource], {
          cwd: ROOT,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        let stdout = ""; let stderr = "";
        child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.once("error", reject);
        child.once("close", (code) => {
          if (code !== 0) reject(new Error(`sonda funcional falhou (${code}): ${stderr.slice(0, 500)}`));
          else resolve(stdout);
        });
      });
      const { resultType } = JSON.parse(output) as { resultType: string };
      expect(resultType, "a funcao interna nao deveria mais ser alcancavel de fora do pacote - binding inexistente, nao apenas nao detectado").toBe("undefined");
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
  }, 30_000);
});
