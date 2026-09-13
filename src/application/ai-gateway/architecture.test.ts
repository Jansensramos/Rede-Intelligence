import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Teste arquitetural do AI Gateway (Fase 10A). Analisa TODOS os arquivos produtivos
 * relevantes via AST real (TypeScript compiler API), nunca decidindo se um arquivo "parece
 * relacionado a IA" antes de olhar seu conteudo. Nenhuma pre-filtragem por palavra-chave,
 * nome de arquivo ou comentario existe neste gate.
 *
 * Correcao critica pos-reauditoria (achado ALTO "gate AST ainda bypassavel") — a
 * reauditoria plantou e removeu sondas reais provando 3 bypasses triviais na versao
 * anterior deste arquivo, nenhum deles "metaprogramacao arbitraria":
 *   1. `globalThis["fetch"]`/`window["fetch"]`/`Reflect.get(globalThis, "fetch")` evadiam
 *      a deteccao de FETCH_REFERENCE por completo (a chave "fetch" e um literal de string
 *      ESTATICO, do mesmo tipo que o scanner ja inspeciona para dominios de IA — nao e
 *      ofuscacao dinamica). Fechado: `visit()` agora trata acesso computado/bracket a
 *      `globalThis`/`window` com chave literal "fetch" (incluindo template literal
 *      estatico) e `Reflect.get/apply/construct(globalThis|window, "fetch", ...)` como
 *      FETCH_REFERENCE, exatamente como a forma `.fetch` ja era tratada.
 *   2. Arquivos `.js`/`.jsx`/`.mjs`/`.cjs` nunca eram escaneados (`listFilesRecursive` so
 *      aceitava `.ts`/`.tsx`). Fechado: as 6 extensoes produtivas realmente aceitas pelo
 *      projeto (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`) sao cobertas.
 *   3. `scripts/` (incluindo `scripts/worker.ts`, um entrypoint de producao real) estava
 *      inteiramente fora do escopo (`SCAN_DIRS` so cobria `src/{domain,application,
 *      infrastructure,app}`). Fechado: `scripts/` entrou no escopo (com um allowlist
 *      minimo e documentado para os 2 usos legitimos pre-existentes que ele contem: um
 *      servidor HTTP local de health-check e um smoke-test que so chama a propria app).
 *
 * Limite residual documentado (nao prometemos deteccao perfeita de metaprogramacao
 * dinamica arbitraria): o scanner NAO resolve fluxo de dados nem construcao dinamica de
 * strings — `globalThis["fe" + "tch"]`, `eval(...)`, ou `Reflect.construct` com um
 * identificador totalmente computado em runtime (nao um literal) continuam fora do
 * alcance; fechar isso exigiria um type-checker completo com resolucao de fluxo de dados,
 * fora de escopo. `eval`/`new Function` nao tem nenhum uso em codigo produtivo hoje
 * (verificado por grep antes desta correcao) e um teste dedicado abaixo garante que
 * nenhum uso futuro passe silenciosamente.
 */

const REPO_ROOT = process.cwd();
const SRC_ROOT = join(REPO_ROOT, "src");

/**
 * Allowlist minima, por caminho EXATO relativo a raiz do repositorio, documentada linha a
 * linha. Nao pode ser ampliada por comentario ou string dentro de um arquivo-fonte — a
 * unica forma de estender esta lista e editar este arquivo de teste diretamente (auditavel
 * via `git diff` desta lista). O teste "allowlist nao pode crescer silenciosamente" abaixo
 * trava o conteudo exato desta lista.
 */
const TRANSPORT_ALLOWLIST = {
  // Unico transporte HTTP real autorizado para o provider de IA compativel (SSRF-safe,
  // allowlist de host + DNS pinning). Usa node:https diretamente.
  httpsModuleImport: new Set(["src/infrastructure/ai-gateway/safe-transport.ts"]),
  // Dependencia pre-existente, nao relacionada a IA, ja auditada (9Q.2B) — alertas
  // operacionais via webhook. Usa node:https diretamente.
  httpsModuleImportPreExisting: new Set(["src/infrastructure/observability/alert-dispatcher.ts"]),
  // scripts/worker.ts (correcao critica pos-reauditoria, achado "gate AST ainda
  // bypassavel", item C "escopo"): servidor HTTP LOCAL de health-check do worker
  // (127.0.0.1, sem cliente/rede de saida) - nao e transporte para nenhum terceiro.
  nodeHttpModuleImport: new Set(["scripts/worker.ts"]),
  // Chamadores legitimos de fetch() para integracoes NAO relacionadas a IA, pre-existentes
  // a Fase 10A: webhook de saida, worker de disparo de job, Google Drive, Clicksign, e o
  // smoke-test operacional (chama so a propria app, nunca um terceiro).
  fetchNonAi: new Set([
    "src/application/integrations/webhook-delivery.ts",
    "src/application/worker/job-dispatcher.ts",
    "src/infrastructure/adapters/drive/google-drive.ts",
    "src/infrastructure/adapters/signature/clicksign-signature-provider.ts",
    "scripts/smoke-authenticated.ts",
  ]),
  // Provider legado (CompatibleHTTPAIProvider) — usa fetch() sem allowlist/DNS-rebinding.
  // Nunca chamado por nenhum caminho novo (ver architecture test "legacy provider" abaixo).
  fetchLegacyAiProvider: new Set(["src/domain/ai/provider.ts"]),
  // Unico ponto autorizado a construir os adapters do AiGateway.
  adapterConstruction: new Set(["src/infrastructure/ai-gateway/config.ts"]),
  // Unico ponto autorizado a construir/acessar o provider legado (composition root legado).
  legacyFactoryAccess: new Set(["src/infrastructure/ai/provider-factory.ts"]),
};

const FORBIDDEN_MODULE_SPECIFIERS = ["node:http", "node:https", "http", "https", "undici", "axios"];
const AI_VENDOR_SDK_SPECIFIERS = ["openai", "@anthropic-ai/sdk", "@google/generative-ai", "@google-ai/generativelanguage", "cohere-ai", "replicate", "groq-sdk", "@mistralai/mistralai", "ollama"];
const AI_VENDOR_DOMAINS = ["api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com", "api.cohere.ai", "api.together.xyz", "api.groq.com", "api.mistral.ai", "api.perplexity.ai", "api.replicate.com"];
const ADAPTER_MODULE_MATCHERS: Array<{ needle: string; className: string; kind: "adapter" }> = [
  { needle: "compatible-http-adapter", className: "CompatibleHttpAiProviderAdapter", kind: "adapter" },
  { needle: "disabled-provider-adapter", className: "DisabledAiProviderAdapter", kind: "adapter" },
  // Legado: CompatibleHTTPAIProvider (fetch() sem SSRF/DNS-rebinding). O modulo e
  // "domain/ai/provider" - precisa de um needle mais especifico que nao bata em
  // "infrastructure/ai-gateway/compatible-http-adapter" (needle diferente, acima).
  { needle: "domain/ai/provider", className: "CompatibleHTTPAIProvider", kind: "adapter" },
];
const LEGACY_FACTORY_MODULE_NEEDLE = "provider-factory";
const LEGACY_FACTORY_FUNCTION_NAME = "createAIProvider";
const FETCH_PROPERTY_NAME = "fetch";
const GLOBAL_OBJECT_IDENTIFIERS = new Set(["globalThis", "window"]);
const REFLECT_METAPROGRAMMING_METHODS = new Set(["get", "apply", "construct"]);

function toRepoRelative(absolutePath: string): string {
  return absolutePath.slice(REPO_ROOT.length + 1).split(sep).join("/");
}

/** Extensoes produtivas realmente aceitas pelo projeto (ver package.json/tsconfig) - correcao critica pos-reauditoria, item B. */
const PRODUCTION_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
/** Diretorios de saida/dependencias - nunca escaneados mesmo que apareçam sob um SCAN_DIR. */
const EXCLUDED_DIR_NAMES = new Set(["node_modules", ".next", "dist", "build", "coverage", ".turbo", "tmp", "temp"]);

function listFilesRecursive(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) { if (!EXCLUDED_DIR_NAMES.has(entry)) listFilesRecursive(full, out); continue; }
    if (PRODUCTION_EXTENSIONS.some((extension) => full.endsWith(extension))) out.push(full);
  }
  return out;
}

/**
 * Escopo do gate (correcao critica pos-reauditoria, item C "escopo"): codigo de
 * dominio/aplicacao/infraestrutura server-side MAIS `scripts/` (entrypoints executaveis
 * reais - `scripts/worker.ts`, `scripts/preflight-production.ts` etc., listados em
 * `package.json#scripts`). `src/components` (React client-side) e excluido de proposito —
 * `fetch()` la chama SEMPRE rotas internas `/api/*` da propria aplicacao (mesma origem),
 * uma preocupacao de confianca totalmente diferente de chamada de rede de servidor para um
 * provedor de IA/terceiro; incluir esse diretorio geraria falso positivo em toda a UI sem
 * nenhum ganho de seguranca real. `node_modules`/`.next`/`dist`/`build`/saida nunca
 * entram (ver `EXCLUDED_DIR_NAMES`), mesmo que apareçam sob um destes diretorios.
 */
const SCAN_DIRS = ["src/domain", "src/application", "src/infrastructure", "src/app", "scripts"].map((dir) => join(REPO_ROOT, dir));

const TEST_FILE_PATTERN = /\.test\.(ts|tsx|js|jsx|mjs|cjs)$/;
function isTestFile(path: string): boolean {
  return TEST_FILE_PATTERN.test(path);
}

function computeProductionFiles(): string[] {
  return SCAN_DIRS.filter((dir) => { try { statSync(dir); return true; } catch { return false; } })
    .flatMap((dir) => listFilesRecursive(dir))
    .filter((file) => !isTestFile(file));
}

const PRODUCTION_FILES = computeProductionFiles();

export type ViolationKind =
  | "FETCH_REFERENCE"
  | "FORBIDDEN_MODULE_IMPORT"
  | "FORBIDDEN_MODULE_REQUIRE"
  | "FORBIDDEN_MODULE_DYNAMIC_IMPORT"
  | "AI_VENDOR_SDK_IMPORT"
  | "AI_VENDOR_DOMAIN_LITERAL"
  | "ADAPTER_DIRECT_CONSTRUCTION"
  | "LEGACY_FACTORY_ACCESS"
  | "EVAL_OR_FUNCTION_CONSTRUCTOR";

export interface Violation {
  kind: ViolationKind;
  detail: string;
  line: number;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function stringLiteralText(node: ts.Node): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  return null;
}

function isGlobalObjectIdentifier(node: ts.Node): boolean {
  return ts.isIdentifier(node) && GLOBAL_OBJECT_IDENTIFIERS.has(node.text);
}

function isFetchStringLiteral(node: ts.Node | undefined): boolean {
  return !!node && ts.isStringLiteralLike(node) && node.text === FETCH_PROPERTY_NAME;
}

/**
 * Analisa uma unica SourceFile (ja parseada) e devolve toda violacao encontrada,
 * independentemente de qualquer allowlist — a allowlist e aplicada pelo chamador, nunca
 * dentro do scanner, para que a logica de deteccao seja sempre a mesma para todo arquivo.
 */
export function scanSourceFileForViolations(sourceFile: ts.SourceFile): Violation[] {
  const violations: Violation[] = [];
  const adapterLocalNames = new Map<string, string>(); // local identifier -> className
  const adapterNamespaceLocalNames = new Set<string>();
  const legacyFactoryLocalNames = new Set<string>();
  const legacyFactoryNamespaceLocalNames = new Set<string>();

  function recordImportBindings(moduleSpecifierText: string, importClause: ts.ImportClause | undefined) {
    const adapterMatch = ADAPTER_MODULE_MATCHERS.find((m) => moduleSpecifierText.includes(m.needle));
    const isLegacyFactoryModule = moduleSpecifierText.includes(LEGACY_FACTORY_MODULE_NEEDLE);
    if (!importClause) return;
    if (importClause.name) {
      // default import
      if (adapterMatch) adapterLocalNames.set(importClause.name.text, adapterMatch.className);
      if (isLegacyFactoryModule) legacyFactoryLocalNames.add(importClause.name.text);
    }
    const bindings = importClause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      if (adapterMatch) adapterNamespaceLocalNames.add(bindings.name.text);
      if (isLegacyFactoryModule) legacyFactoryNamespaceLocalNames.add(bindings.name.text);
    }
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const importedName = (element.propertyName ?? element.name).text;
        const localName = element.name.text;
        if (adapterMatch && importedName === adapterMatch.className) adapterLocalNames.set(localName, adapterMatch.className);
        if (isLegacyFactoryModule && importedName === LEGACY_FACTORY_FUNCTION_NAME) legacyFactoryLocalNames.add(localName);
      }
    }
  }

  function checkForbiddenModuleSpecifier(specifierText: string, node: ts.Node, kind: "FORBIDDEN_MODULE_IMPORT" | "FORBIDDEN_MODULE_REQUIRE" | "FORBIDDEN_MODULE_DYNAMIC_IMPORT") {
    if (FORBIDDEN_MODULE_SPECIFIERS.includes(specifierText)) {
      violations.push({ kind, detail: `modulo proibido "${specifierText}"`, line: lineOf(sourceFile, node) });
    }
    if (AI_VENDOR_SDK_SPECIFIERS.includes(specifierText)) {
      violations.push({ kind: "AI_VENDOR_SDK_IMPORT", detail: `SDK de fornecedor de IA "${specifierText}"`, line: lineOf(sourceFile, node) });
    }
  }

  function visit(node: ts.Node) {
    // 1. Qualquer referencia ao identificador "fetch" (bare, globalThis.fetch, window.fetch,
    //    alias, desestruturacao) — checagem sintatica ampla e deliberadamente agressiva.
    if (ts.isIdentifier(node) && node.text === FETCH_PROPERTY_NAME) {
      violations.push({ kind: "FETCH_REFERENCE", detail: "referencia ao identificador fetch", line: lineOf(sourceFile, node) });
    }

    // 1b. Correcao critica pos-reauditoria (achado ALTO "gate AST ainda bypassavel", item A
    //     "computed/bracket access"): globalThis["fetch"]/window["fetch"], incluindo
    //     template literal estatico (`globalThis[`fetch`]`), e
    //     Reflect.get/apply/construct(globalThis|window, "fetch", ...). A chave e sempre um
    //     literal de string ESTATICO (nao computado em runtime) - o scanner ja inspeciona
    //     literais de string em outro lugar (dominios de IA); isto usa a mesma tecnica.
    if (ts.isElementAccessExpression(node) && isGlobalObjectIdentifier(node.expression) && isFetchStringLiteral(node.argumentExpression)) {
      violations.push({ kind: "FETCH_REFERENCE", detail: `acesso computado a "${node.expression.getText(sourceFile)}[\"fetch\"]"`, line: lineOf(sourceFile, node) });
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Reflect" &&
      REFLECT_METAPROGRAMMING_METHODS.has(node.expression.name.text) &&
      node.arguments.length >= 2 &&
      isGlobalObjectIdentifier(node.arguments[0]) &&
      isFetchStringLiteral(node.arguments[1])
    ) {
      violations.push({ kind: "FETCH_REFERENCE", detail: `Reflect.${node.expression.name.text}(${node.arguments[0].getText(sourceFile)}, "fetch")`, line: lineOf(sourceFile, node) });
    }

    // 2. Imports estaticos de modulos proibidos + bindings de adapter/legacy factory.
    if (ts.isImportDeclaration(node)) {
      const specifierText = stringLiteralText(node.moduleSpecifier);
      if (specifierText !== null) {
        checkForbiddenModuleSpecifier(specifierText, node, "FORBIDDEN_MODULE_IMPORT");
        recordImportBindings(specifierText, node.importClause);
      }
    }

    // 3. require("...") e import("...") dinamico.
    if (ts.isCallExpression(node)) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if ((isRequire || isDynamicImport) && node.arguments.length > 0) {
        const argText = stringLiteralText(node.arguments[0]);
        if (argText !== null) {
          checkForbiddenModuleSpecifier(argText, node, isRequire ? "FORBIDDEN_MODULE_REQUIRE" : "FORBIDDEN_MODULE_DYNAMIC_IMPORT");
          const adapterMatch = ADAPTER_MODULE_MATCHERS.find((m) => argText.includes(m.needle));
          if (adapterMatch) violations.push({ kind: "ADAPTER_DIRECT_CONSTRUCTION", detail: `import dinamico do adapter "${adapterMatch.className}"`, line: lineOf(sourceFile, node) });
          if (argText.includes(LEGACY_FACTORY_MODULE_NEEDLE)) violations.push({ kind: "LEGACY_FACTORY_ACCESS", detail: "import dinamico do provider-factory legado", line: lineOf(sourceFile, node) });
        }
      }
      // createAIProvider(...) e ns.createAIProvider(...)
      if (ts.isIdentifier(node.expression) && legacyFactoryLocalNames.has(node.expression.text)) {
        violations.push({ kind: "LEGACY_FACTORY_ACCESS", detail: `chamada a ${LEGACY_FACTORY_FUNCTION_NAME} via import`, line: lineOf(sourceFile, node) });
      }
      if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && legacyFactoryNamespaceLocalNames.has(node.expression.expression.text) && node.expression.name.text === LEGACY_FACTORY_FUNCTION_NAME) {
        violations.push({ kind: "LEGACY_FACTORY_ACCESS", detail: `chamada a ${LEGACY_FACTORY_FUNCTION_NAME} via namespace import`, line: lineOf(sourceFile, node) });
      }
    }

    // 4. new CompatibleHttpAiProviderAdapter(...) / new DisabledAiProviderAdapter(...),
    //    diretamente, via alias de import nomeado, ou via import de namespace.
    if (ts.isNewExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        const byLiteralName = ADAPTER_MODULE_MATCHERS.find((m) => m.className === node.expression.getText(sourceFile));
        const byImportedAlias = adapterLocalNames.get(node.expression.text);
        if (byLiteralName || byImportedAlias) {
          violations.push({ kind: "ADAPTER_DIRECT_CONSTRUCTION", detail: `new ${byImportedAlias ?? byLiteralName?.className} (identificador "${node.expression.text}")`, line: lineOf(sourceFile, node) });
        }
      }
      if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && adapterNamespaceLocalNames.has(node.expression.expression.text)) {
        const className = node.expression.name.text;
        if (ADAPTER_MODULE_MATCHERS.some((m) => m.className === className)) {
          violations.push({ kind: "ADAPTER_DIRECT_CONSTRUCTION", detail: `new ${className} via namespace import`, line: lineOf(sourceFile, node) });
        }
      }
    }

    // 5. Dominios conhecidos de provedores de IA em qualquer literal de string/template.
    if (ts.isStringLiteralLike(node)) {
      for (const domain of AI_VENDOR_DOMAINS) {
        if (node.text.includes(domain)) violations.push({ kind: "AI_VENDOR_DOMAIN_LITERAL", detail: `dominio de fornecedor de IA "${domain}"`, line: lineOf(sourceFile, node) });
      }
    }

    // 6. Correcao critica DEFINITIVA pos-reauditoria (item 9B "eval/new Function"): bloqueio
    // explicito no proprio scanner AST, nao so um teste de regressao textual separado.
    // Nenhum uso legitimo conhecido em codigo produtivo - qualquer ocorrencia e sempre
    // violacao (`isAllowedFor` nunca permite este kind, em nenhum caminho).
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "eval") {
      violations.push({ kind: "EVAL_OR_FUNCTION_CONSTRUCTOR", detail: "chamada a eval(...)", line: lineOf(sourceFile, node) });
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Function") {
      violations.push({ kind: "EVAL_OR_FUNCTION_CONSTRUCTOR", detail: "construcao de new Function(...)", line: lineOf(sourceFile, node) });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function scriptKindFor(absolutePath: string): ts.ScriptKind {
  if (absolutePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (absolutePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (absolutePath.endsWith(".ts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS; // .js, .mjs, .cjs
}

function scanFile(absolutePath: string): Violation[] {
  const text = readFileSync(absolutePath, "utf8");
  const sourceFile = ts.createSourceFile(absolutePath, text, ts.ScriptTarget.Latest, true, scriptKindFor(absolutePath));
  return scanSourceFileForViolations(sourceFile);
}

function isAllowedFor(relativePath: string, kind: ViolationKind): boolean {
  if (kind === "FETCH_REFERENCE") {
    return TRANSPORT_ALLOWLIST.fetchNonAi.has(relativePath) || TRANSPORT_ALLOWLIST.fetchLegacyAiProvider.has(relativePath);
  }
  if (kind === "FORBIDDEN_MODULE_IMPORT" || kind === "FORBIDDEN_MODULE_REQUIRE" || kind === "FORBIDDEN_MODULE_DYNAMIC_IMPORT") {
    return TRANSPORT_ALLOWLIST.httpsModuleImport.has(relativePath) || TRANSPORT_ALLOWLIST.httpsModuleImportPreExisting.has(relativePath) || TRANSPORT_ALLOWLIST.nodeHttpModuleImport.has(relativePath);
  }
  if (kind === "ADAPTER_DIRECT_CONSTRUCTION") return TRANSPORT_ALLOWLIST.adapterConstruction.has(relativePath) || TRANSPORT_ALLOWLIST.legacyFactoryAccess.has(relativePath);
  if (kind === "LEGACY_FACTORY_ACCESS") return TRANSPORT_ALLOWLIST.legacyFactoryAccess.has(relativePath);
  return false; // AI_VENDOR_SDK_IMPORT, AI_VENDOR_DOMAIN_LITERAL e EVAL_OR_FUNCTION_CONSTRUCTOR nunca sao permitidos, em nenhum arquivo
}

describe("AiGateway - fronteira arquitetural (Fase 10A, AST real)", () => {
  it("nenhum arquivo produtivo fora da allowlist viola a fronteira de transporte/adapter/SDK de IA", () => {
    const failures: string[] = [];
    for (const file of PRODUCTION_FILES) {
      const relative = toRepoRelative(file);
      const violations = scanFile(file);
      for (const violation of violations) {
        if (isAllowedFor(relative, violation.kind)) continue;
        failures.push(`${relative}:${violation.line} [${violation.kind}] ${violation.detail}`);
      }
    }
    expect(failures, `violacoes encontradas:\n${failures.join("\n")}`).toEqual([]);
  });

  it("a allowlist de transporte nao pode crescer silenciosamente (trava o conteudo exato)", () => {
    expect([...TRANSPORT_ALLOWLIST.httpsModuleImport]).toEqual(["src/infrastructure/ai-gateway/safe-transport.ts"]);
    expect([...TRANSPORT_ALLOWLIST.httpsModuleImportPreExisting]).toEqual(["src/infrastructure/observability/alert-dispatcher.ts"]);
    expect([...TRANSPORT_ALLOWLIST.nodeHttpModuleImport]).toEqual(["scripts/worker.ts"]);
    expect([...TRANSPORT_ALLOWLIST.fetchNonAi].sort()).toEqual([
      "scripts/smoke-authenticated.ts",
      "src/application/integrations/webhook-delivery.ts",
      "src/application/worker/job-dispatcher.ts",
      "src/infrastructure/adapters/drive/google-drive.ts",
      "src/infrastructure/adapters/signature/clicksign-signature-provider.ts",
    ]);
    expect([...TRANSPORT_ALLOWLIST.fetchLegacyAiProvider]).toEqual(["src/domain/ai/provider.ts"]);
    expect([...TRANSPORT_ALLOWLIST.adapterConstruction]).toEqual(["src/infrastructure/ai-gateway/config.ts"]);
    expect([...TRANSPORT_ALLOWLIST.legacyFactoryAccess]).toEqual(["src/infrastructure/ai/provider-factory.ts"]);
  });

  it("askRedeAI (application/ai) nao instancia nenhum provider/adapter diretamente - so chama o AiGateway", () => {
    const content = readFileSync(join(SRC_ROOT, "application", "ai", "ai-service.ts"), "utf8");
    expect(content).not.toMatch(/createAIProvider\(\)/);
    expect(content).not.toMatch(/new CompatibleHTTP|new CompatibleHttpAiProviderAdapter|new DisabledAiProviderAdapter/);
  });

  it("nenhum arquivo do AI Gateway (10A) menciona conceitos de fases futuras (10B-10I) nao autorizadas nesta rodada", () => {
    const FUTURE_PHASE_TOKENS = /autopilot|agent-framework|cognitive-tool|context-engine|red-team-2|autonomous-decision/i;
    const dirs = [join(SRC_ROOT, "domain", "ai-gateway"), join(SRC_ROOT, "application", "ai-gateway"), join(SRC_ROOT, "infrastructure", "ai-gateway")];
    const selfPath = join(SRC_ROOT, "application", "ai-gateway", "architecture.test.ts");
    for (const dir of dirs) {
      for (const file of listFilesRecursive(dir).filter((candidate) => candidate !== selfPath)) {
        const content = readFileSync(file, "utf8");
        expect(content, `token de fase futura encontrado em ${file}`).not.toMatch(FUTURE_PHASE_TOKENS);
      }
    }
  });

  it("nenhum escritor Prisma fora de application/ai-gateway (ledger-service.ts e o unico escritor)", () => {
    for (const file of listFilesRecursive(join(SRC_ROOT, "domain", "ai-gateway")).concat(listFilesRecursive(join(SRC_ROOT, "infrastructure", "ai-gateway")))) {
      const content = readFileSync(file, "utf8");
      expect(content, `escrita de persistencia fora da camada de aplicacao em ${file}`).not.toMatch(/prisma\.\w+\.(create|update|upsert)\(/);
    }
  });

  // Correcao critica DEFINITIVA pos-reauditoria (item 9B): `eval`/`new Function` agora sao
  // bloqueados DENTRO do proprio scanner AST (kind `EVAL_OR_FUNCTION_CONSTRUCTOR`, nunca
  // allowlisted - ver `visit()` passo 6 e `isAllowedFor`), cobertos pelo teste principal
  // "nenhum arquivo produtivo fora da allowlist viola..." acima - nao mais um teste de
  // regressao textual separado "fora do alcance do AST scanner". Fixtures adversariais
  // provando a deteccao real estao no bloco de fixtures abaixo.

  describe("fixtures adversariais - o scanner deve reprovar cada padrao proibido e aprovar o transporte legitimo", () => {
    let dir: string;
    function write(name: string, content: string): string {
      const path = join(dir, name);
      writeFileSync(path, content, "utf8");
      return path;
    }
    function violationsOf(path: string): Violation[] {
      return scanFile(path);
    }

    it("roda todas as fixtures (bracket/Reflect/template literal incluidos - correção crítica pós-reauditoria)", () => {
      dir = mkdtempSync(join(tmpdir(), "arch-gate-fixtures-"));
      try {
        const cases: Array<{ name: string; file: string; content: string; expectKind: ViolationKind | null }> = [
          { name: "fetch direto", file: "a.ts", content: `export async function x() { return fetch("https://api.openai.com/v1/chat/completions"); }`, expectKind: "FETCH_REFERENCE" },
          { name: "alias local de fetch", file: "b.ts", content: `const f = fetch; export async function x() { return f("https://example.com"); }`, expectKind: "FETCH_REFERENCE" },
          { name: "globalThis.fetch", file: "c.ts", content: `export async function x() { return globalThis.fetch("https://example.com"); }`, expectKind: "FETCH_REFERENCE" },
          { name: "window.fetch", file: "d.ts", content: `declare const window: any; export async function x() { return window.fetch("https://example.com"); }`, expectKind: "FETCH_REFERENCE" },
          { name: "desestruturacao de fetch", file: "e.ts", content: `declare const globalThis: any; const { fetch } = globalThis; export async function x() { return fetch("https://example.com"); }`, expectKind: "FETCH_REFERENCE" },
          { name: "import estatico node:https", file: "f.ts", content: `import { request } from "node:https"; export const r = request;`, expectKind: "FORBIDDEN_MODULE_IMPORT" },
          { name: "import estatico de namespace https", file: "g.ts", content: `import * as https from "https"; export const r = https;`, expectKind: "FORBIDDEN_MODULE_IMPORT" },
          { name: "require de https", file: "h.ts", content: `export const https = require("https");`, expectKind: "FORBIDDEN_MODULE_REQUIRE" },
          { name: "import dinamico de node:https", file: "i.ts", content: `export async function x() { const m = await import("node:https"); return m; }`, expectKind: "FORBIDDEN_MODULE_DYNAMIC_IMPORT" },
          { name: "import dinamico do adapter", file: "j.ts", content: `export async function x() { const m = await import("@/infrastructure/ai-gateway/compatible-http-adapter"); return new m.CompatibleHttpAiProviderAdapter({} as never, {} as never); }`, expectKind: "ADAPTER_DIRECT_CONSTRUCTION" },
          { name: "alias do construtor do adapter", file: "k.ts", content: `import { CompatibleHttpAiProviderAdapter as Ctor } from "@/infrastructure/ai-gateway/compatible-http-adapter"; export const x = new Ctor({} as never, {} as never);`, expectKind: "ADAPTER_DIRECT_CONSTRUCTION" },
          { name: "URL da OpenAI sem mencionar AIProvider", file: "l.ts", content: `export const ENDPOINT = "https://api.openai.com/v1/chat/completions";`, expectKind: "AI_VENDOR_DOMAIN_LITERAL" },
          { name: "chamada escondida em diretorio nao relacionado", file: "reporting-hidden.ts", content: `export async function sendSummaryToVendor(q: string) { const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST" }); return r.json(); }`, expectKind: "FETCH_REFERENCE" },
          { name: "createAIProvider via alias", file: "m.ts", content: `import { createAIProvider as make } from "@/infrastructure/ai/provider-factory"; export const p = make();`, expectKind: "LEGACY_FACTORY_ACCESS" },
          // Correção crítica pós-reauditoria: os 3 bypasses comprovados pela reauditoria.
          { name: "globalThis[\"fetch\"] (bracket, achado ALTO)", file: "n.ts", content: `export async function x() { return globalThis["fetch"]("https://api.openai.com/v1"); }`, expectKind: "FETCH_REFERENCE" },
          { name: "window[\"fetch\"] (bracket)", file: "o.ts", content: `declare const window: any; export async function x() { return window["fetch"]("https://api.openai.com/v1"); }`, expectKind: "FETCH_REFERENCE" },
          { name: "globalThis[`fetch`] (template literal estático)", file: "p.ts", content: "export async function x() { return globalThis[`fetch`](\"https://api.openai.com/v1\"); }", expectKind: "FETCH_REFERENCE" },
          { name: "Reflect.get(globalThis, \"fetch\")", file: "q.ts", content: `export async function x() { return Reflect.get(globalThis, "fetch")("https://api.openai.com/v1"); }`, expectKind: "FETCH_REFERENCE" },
          { name: "Reflect.get + atribuição a alias antes da chamada", file: "r.ts", content: `export async function x() { const f = Reflect.get(globalThis, "fetch") as typeof fetch; return f("https://api.openai.com/v1"); }`, expectKind: "FETCH_REFERENCE" },
          // Correção crítica DEFINITIVA (item 9B "eval/new Function"): bloqueio explícito no scanner AST.
          { name: "eval(...)", file: "s.ts", content: `export function x(code: string) { return eval(code); }`, expectKind: "EVAL_OR_FUNCTION_CONSTRUCTOR" },
          { name: "new Function(...)", file: "t.ts", content: `export function x(body: string) { return new Function(body); }`, expectKind: "EVAL_OR_FUNCTION_CONSTRUCTOR" },
          { name: "chamada legitima dentro do transporte allowlisted nao deve ser sinalizada quando o CAMINHO esta na allowlist", file: "safe-transport.ts", content: `import { request } from "node:https"; export const r = request;`, expectKind: null },
        ];
        for (const testCase of cases) {
          const path = write(testCase.file, testCase.content);
          const violations = violationsOf(path);
          if (testCase.expectKind === null) {
            // Este caso simula o CONTEUDO do arquivo real allowlisted; o teste de
            // allowlist real (acima) e quem decide path-exato. Aqui so confirmamos que o
            // scanner (sem aplicar allowlist) ainda deteta a violacao pelo conteudo -
            // provando que a allowlist e uma decisao de CAMINHO, nunca de conteudo/comentario.
            expect(violations.some((v) => v.kind === "FORBIDDEN_MODULE_IMPORT"), `${testCase.name}: esperava que o scanner CRU detectasse a violacao (a allowlist e aplicada so pelo caminho, fora do scanner)`).toBe(true);
            continue;
          }
          expect(violations.some((v) => v.kind === testCase.expectKind), `${testCase.name}: esperava violacao ${testCase.expectKind}, obteve ${JSON.stringify(violations)}`).toBe(true);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("extensão .js dentro de um diretório escaneado é incluída automaticamente (achado ALTO da reauditoria)", () => {
      const targetDir = join(SRC_ROOT, "application", "reporting");
      const probePath = join(targetDir, ".reaudit-fixture-extension.js");
      writeFileSync(probePath, `module.exports.x = async function () { return fetch("https://api.openai.com/v1"); };`, "utf8");
      try {
        const files = computeProductionFiles();
        expect(files).toContain(probePath); // a extensão .js agora é coletada
        const violations = scanFile(probePath);
        expect(violations.some((v) => v.kind === "FETCH_REFERENCE")).toBe(true);
      } finally {
        rmSync(probePath, { force: true });
      }
    });

    it("scripts/ está dentro do escopo - um novo script produtivo hostil é incluído automaticamente (achado ALTO da reauditoria)", () => {
      const probePath = join(REPO_ROOT, "scripts", ".reaudit-fixture-script.ts");
      writeFileSync(probePath, `export async function x() { return fetch("https://api.openai.com/v1"); }`, "utf8");
      try {
        const files = computeProductionFiles();
        expect(files).toContain(probePath);
        const relative = toRepoRelative(probePath);
        expect(isAllowedFor(relative, "FETCH_REFERENCE")).toBe(false); // caminho não listado - não herda a allowlist de scripts/worker.ts ou smoke-authenticated.ts
      } finally {
        rmSync(probePath, { force: true });
      }
    });

    it("caminho parecido com um allowlisted (não exato) não herda a allowlist - allowlist é por caminho EXATO", () => {
      expect(isAllowedFor("src/infrastructure/ai-gateway/safe-transport-copy.ts", "FORBIDDEN_MODULE_IMPORT")).toBe(false);
      expect(isAllowedFor("src/infrastructure/ai-gateway/Safe-Transport.ts", "FORBIDDEN_MODULE_IMPORT")).toBe(false); // case alternativo
      expect(isAllowedFor("src\\infrastructure\\ai-gateway\\safe-transport.ts", "FORBIDDEN_MODULE_IMPORT")).toBe(false); // barra invertida literal (não normalizada, path real nunca chega assim)
      expect(isAllowedFor("src/infrastructure/ai-gateway/safe-transport.ts", "FORBIDDEN_MODULE_IMPORT")).toBe(true); // controle: o caminho exato real continua permitido
    });
  });
});
