import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Prisma, type AIExecutionStatus, type MembershipRole } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { assertAiUse } from "@/application/ai-gateway/rbac";
import { CONTEXT_MUTATION_BARRIER_SQL, MAX_SERIALIZABLE_RETRY_ATTEMPTS, TRANSACTION_TIMEOUT_MS } from "@/application/ai-gateway/ledger-service";
import { checkAndConsumeRateLimit } from "@/application/integrations/resilience-service";
import { prepareContextBundle, consumeContextBundleInTransaction, type ContextConsumptionInput } from "@/application/context-engine";
import { ContextEngineError, isPlainContextData, renderContextBundleForTransport, safeContextRef } from "@/domain/context-engine";
import {
  AI_TOOLS_LAYER_VERSION, AiToolError, AiToolNameSchema, AiToolResultSchema,
  type AiToolErrorCode, type AiToolName, type AiToolResult,
} from "@/domain/ai-tools";
import { prisma } from "@/infrastructure/database/prisma";
import { getAiToolSpec } from "./catalog";

/**
 * Fase 10C (Tool Layer) - correcao BLOQUEADORA final pos-reauditoria (achado ALTO-2,
 * "bypass estrutural do choke point"). `executeAiTool` e o UNICO ponto publico de execucao.
 *
 * Ate a correcao anterior, `prepareAiToolInvocation`/`consumeAiToolInvocation` eram `export`
 * deste arquivo (so nao reexportadas por `index.ts`) e o gate arquitetural dependia de uma
 * varredura textual (`content.includes(identifier)`) para provar que nenhum arquivo externo
 * as alcancava. A reauditoria provou um bypass FUNCIONAL: um arquivo fora do pacote montou o
 * nome via `["prepare","Ai","Tool","Invocation"].join("")`, fez `import()` dinamico deste
 * modulo e acessou a funcao por colchete - nunca escrevendo o identificador litearlmente, o
 * gate textual nao detectou, e a funcao interna foi de fato invocada de fora do pacote.
 *
 * Fechamento ESTRUTURAL (nao apenas textual): as duas funcoes abaixo NAO tem mais a palavra-
 * chave `export`. Um modulo ES so expoe os bindings que declara com `export` - nao existe
 * reflexao, Proxy, `import()` dinamico ou acesso computado capaz de obter um binding nao
 * exportado a partir do objeto de namespace do modulo, INDEPENDENTEMENTE de como o
 * identificador e escrito no arquivo importador (literal, concatenado, template literal).
 * Isto fecha a classe inteira de bypass provada pela reauditoria, nao so a instancia
 * especifica reproduzida - e a unica garantia que nao depende de nenhum scanner "pegar" a
 * ofuscacao certa.
 *
 * Os testes de corrida do pacote (mesmo arquivo nao pode ser importado por outro sem export)
 * usam o harness dedicado ao final deste arquivo (`__raceTestPrepare`/`__raceTestConsume`/
 * `__raceTestConsumeInSubprocess`), que tem acesso lexico direto as duas funcoes privadas
 * (mesmo escopo de modulo) mas so devolve resumos seguros (status terminal + executionLogId) -
 * nunca o `ContextBundle`/evidencia, e nenhuma composicao das tres funcoes do harness permite
 * obter evidencia sem passar pelo fluxo real de `consumeAiToolInvocation` (CAS + auditoria).
 * Ver docstring do harness para o racional completo, incluindo o motivo do uso pontual e
 * documentado de `node:child_process` (preservar cobertura de corrida entre processos
 * genuinamente independentes, nunca ativo fora de um teste que o aciona explicitamente).
 *
 * O gate arquitetural (`architecture.test.ts`) foi reescrito para usar a TypeScript Compiler
 * API (AST real, mesmo padrao de `ai-gateway/architecture.test.ts`) como camada adicional de
 * defesa-em-profundidade e diagnostico precoce - mas a garantia que realmente fecha o achado
 * ALTO-2 e a ausencia do `export` acima, nao o gate.
 *
 * Toda saida e um `AiToolResult` fechado (COMPLETED/REFUSED/FAILED) - nenhuma excecao bruta
 * escapa para o chamador. Toda transicao terminal do `AIExecutionLog` e feita por CAS
 * guardado pelo status anterior esperado (nunca um `update` incondicional) e e atomica, na
 * mesma transacao, com a criacao do `AIToolCallLog` correspondente (ALTO-1).
 */

const ROLE_RANK: Record<MembershipRole, number> = { VIEWER: 0, REVIEWER: 1, ANALYST: 2, ADMIN: 3, OWNER: 4 };
const TOOL_RATE_LIMIT_POLICY = { limit: 30, windowMs: 60_000 };
/** MEDIO-5: nunca persistir um toolName bruto nao reconhecido - so este sentinel estatico. */
const UNKNOWN_TOOL_AUDIT_SENTINEL = "UNKNOWN_TOOL_NAME";

function isTransientWriteConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function errorResult(name: AiToolName | "UNKNOWN", correlationId: string, error: AiToolError, durationMs: number): AiToolResult {
  return AiToolResultSchema.parse({
    name,
    status: error.retryable ? "REFUSED" : "FAILED",
    correlationId,
    toolsVersion: AI_TOOLS_LAYER_VERSION,
    error: { code: error.code, message: error.message, correlationId, retryable: error.retryable },
    durationMs,
  }) as AiToolResult;
}

async function resolveConversationProjectId(context: AuthContext, conversationId: string): Promise<string | null> {
  const conversation = await prisma.aIConversation.findFirst({
    where: { id: conversationId, organizationId: context.organizationId, createdById: context.userId, projectId: { not: null } },
    select: { projectId: true },
  });
  return conversation?.projectId ?? null;
}

async function createOrchestrationLog(context: AuthContext, conversationId: string) {
  return prisma.aIExecutionLog.create({
    data: {
      organizationId: context.organizationId,
      userId: context.userId,
      conversationId,
      task: "TOOL_ORCHESTRATION",
      model: "n/a",
      provider: "rede-tool-layer",
      status: "QUEUED",
      promptVersion: "N/A",
      toolsVersion: AI_TOOLS_LAYER_VERSION,
      contextBuilderVersion: "N/A",
      startedAt: new Date(),
    },
  });
}

/**
 * MEDIO-5: `toolNameInput` so e persistido em `AIToolCallLog.tool` quando corresponde a uma
 * ferramenta real do registro fechado (`AiToolNameSchema`, ja validada por forma/charset por
 * construcao - e um enum literal). Qualquer entrada que nao resolva a uma ferramenta
 * conhecida grava exclusivamente o sentinel estatico `UNKNOWN_TOOL_AUDIT_SENTINEL` - nunca o
 * valor bruto controlado pelo cliente/modelo, independentemente de tamanho, charset,
 * controles, CRLF, NUL, bidi ou zero-width.
 */
function auditToolLabel(name: AiToolName | "UNKNOWN"): string {
  return name === "UNKNOWN" ? UNKNOWN_TOOL_AUDIT_SENTINEL : AiToolNameSchema.parse(name);
}

/**
 * MEDIO-4: referencia de ator determinista e segura (mesmo primitivo `safeContextRef` ja
 * usado pela 10B para actor/conversation/org/project refs) - nunca o userId bruto na chave
 * de rate limit compartilhada. `checkAndConsumeRateLimit` ja particiona por `organizationId`
 * como parametro proprio (chave composta `organizationId_scopeKey` na tabela existente); a
 * `scopeKey` abaixo soma ferramenta + ator, entao a chave efetiva isola cumulativamente
 * organizacao (parametro) + ferramenta + ator (string). Nunca compartilha orcamento/rate
 * limit do provider (10A usa uma politica e uma chave inteiramente separadas,
 * `RATE_LIMIT_POLICY`/`scopeKey` em `gateway.ts`, com prefixo `ai-gateway:`).
 */
function toolRateLimitScopeKey(userId: string, toolName: AiToolName): string {
  return `ai-tool:${toolName}:${safeContextRef("actor", userId)}`;
}

type TerminalTransition = { from: readonly AIExecutionStatus[]; to: "COMPLETED" | "FAILED" };

/**
 * ALTO-1: unica funcao que grava o desfecho de uma tentativa. A transicao do
 * `AIExecutionLog` e um CAS guardado por `transition.from` (nunca um `update` incondicional)
 * e, quando o CAS nao se aplica (o status atual ja nao esta em `transition.from` porque outro
 * chamador ja determinou o desfecho terminal), a funcao NAO toca o `AIExecutionLog` - so
 * registra a tentativa do proprio chamador em `AIToolCallLog`. As duas escritas (o CAS,
 * quando aplicavel, e a criacao do `AIToolCallLog`) acontecem na MESMA transacao, portanto
 * atomicamente quando pertencem ao mesmo desfecho - nunca uma sem a outra. Nenhuma leitura
 * seguida de update: o `updateMany` com `where: {status: {in: from}}` e a unica operacao,
 * avaliada pelo Postgres sob o snapshot mais recente no momento do lock (sem TOCTOU).
 */
async function finalizeAndAudit(input: {
  executionLogId: string;
  organizationId: string;
  userId: string;
  toolName: AiToolName | "UNKNOWN";
  result: AiToolResult;
  transition: TerminalTransition;
}) {
  const serialized = JSON.stringify(input.result);
  const resultSummary = serialized.length <= 16_000 ? input.result : { status: input.result.status, truncated: true };
  const toolLabel = auditToolLabel(input.toolName);
  await prisma.$transaction(async (tx) => {
    await tx.aIExecutionLog.updateMany({
      where: { id: input.executionLogId, status: { in: [...input.transition.from] } },
      data: { status: input.transition.to, completedAt: new Date() },
    });
    // Contagem intencionalmente nao verificada aqui: 0 linhas afetadas significa que outro
    // chamador ja determinou o desfecho terminal (vencedor legitimo ou outro perdedor mais
    // rapido) - isso NUNCA e um erro desta tentativa, e o AIToolCallLog abaixo ainda registra
    // o que este chamador especificamente observou, sem jamais sobrescrever o estado alheio.
    await tx.aIToolCallLog.create({
      data: {
        executionId: input.executionLogId,
        organizationId: input.organizationId,
        userId: input.userId,
        tool: toolLabel,
        mode: "READ_ONLY",
        arguments: {},
        resultSummary: resultSummary as Prisma.InputJsonValue,
        durationMs: input.result.durationMs,
        status: input.result.status === "COMPLETED" ? "COMPLETED" : "FAILED",
        errorCode: input.result.status === "COMPLETED" ? null : input.result.error.code,
      },
    });
  }).catch(() => undefined);
}

/**
 * Consome o bundle sob o protocolo transacional completo da 10B (decisao 10): barreira SHARE
 * reaproveitada do ledger (`CONTEXT_MUTATION_BARRIER_SQL`), CAS `QUEUED->RUNNING` no
 * `AIExecutionLog` proprio da ferramenta, e `consumeContextBundleInTransaction`
 * (revalidacao imediatamente antes da execucao, reconstrucao do fingerprint, auditoria
 * `CONTEXT_CONSUMED`). Retry e exclusivo de `P2034` (conflito serializavel), no maximo
 * `MAX_SERIALIZABLE_RETRY_ATTEMPTS` vezes, e sempre re-tenta a transacao inteira do zero - se
 * `consumeContextBundleInTransaction` ja tiver rodado com sucesso nessa tentativa, a funcao
 * ja retornou e o loop nunca e alcancado outra vez; o handler nunca roda duas vezes para a
 * mesma tentativa.
 */
async function consumeWithCas(input: ContextConsumptionInput): Promise<{ transitioned: boolean }> {
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      let transitioned = false;
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(CONTEXT_MUTATION_BARRIER_SQL);
        const cas = await tx.aIExecutionLog.updateMany({ where: { id: input.executionLogId, status: "QUEUED" }, data: { status: "RUNNING" } });
        if (cas.count !== 1) return;
        await consumeContextBundleInTransaction(tx, input);
        transitioned = true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: TRANSACTION_TIMEOUT_MS });
      return { transitioned };
    } catch (error) {
      if (error instanceof ContextEngineError) throw error;
      if (!isTransientWriteConflict(error) || attempt === MAX_SERIALIZABLE_RETRY_ATTEMPTS) throw error;
    }
  }
  return { transitioned: false };
}

function mapContextEngineErrorCode(code: string): AiToolErrorCode {
  if (code === "CONTEXT_CONCURRENT_CHANGE" || code === "CONTEXT_AUDIT_UNAVAILABLE" || code === "CONTEXT_DEPENDENCY_UNAVAILABLE") return "TOOL_CONCURRENT_CHANGE";
  return "TOOL_CONTEXT_REFUSED";
}

type PreparedAiToolInvocation =
  | { ok: true; executionLogId: string; name: AiToolName; correlationId: string; started: number; projectId: string; prepared: Awaited<ReturnType<typeof prepareContextBundle>>; conversationId: string; context: AuthContext }
  | { ok: false; result: AiToolResult };

/**
 * Fase de preparo: choke point, rate limit, argumentos, resolucao de projeto e
 * `prepareContextBundle` (10B). Passo interno de `executeAiTool` (abaixo) - binding privado
 * de modulo (ALTO-2, fechamento estrutural), nunca `export`ado. Ver docstring do topo do
 * arquivo.
 */
async function prepareAiToolInvocation(context: AuthContext, conversationId: string, toolNameInput: string, rawArguments: unknown = {}): Promise<PreparedAiToolInvocation> {
  const correlationId = randomUUID();
  const started = Date.now();

  // O AIExecutionLog de orquestracao e criado antes de qualquer outra checagem - se
  // `conversationId` nao existir, a criacao falha por violacao de FK e isso e tratado como
  // recusa generica, indistinguivel de qualquer outra causa de acesso negado. Nenhum
  // AIToolCallLog e possivel aqui (nao ha executionLogId), entao nao ha nada a auditar.
  let executionLogId: string;
  try {
    executionLogId = (await createOrchestrationLog(context, conversationId)).id;
  } catch {
    return { ok: false, result: errorResult("UNKNOWN", correlationId, new AiToolError("TOOL_ACCESS_DENIED", correlationId), Date.now() - started) };
  }

  async function failFromQueued(code: AiToolErrorCode, toolName: AiToolName | "UNKNOWN"): Promise<PreparedAiToolInvocation> {
    const result = errorResult(toolName, correlationId, new AiToolError(code, correlationId), Date.now() - started);
    await finalizeAndAudit({ executionLogId, organizationId: context.organizationId, userId: context.userId, toolName, result, transition: { from: ["QUEUED"], to: "FAILED" } });
    return { ok: false, result };
  }

  const spec = getAiToolSpec(toolNameInput);
  if (!spec) return failFromQueued("TOOL_UNKNOWN", "UNKNOWN");
  const name = spec.name;

  // Choke point unico - mesmo padrao de `askRedeAI`/`AIToolRegistry.execute`
  // (docs/PHASE_10A_AUDIT_RECORD.md).
  try { assertAiUse(context, spec.domainCapability); }
  catch { return failFromQueued("TOOL_ACCESS_DENIED", name); }
  if (ROLE_RANK[context.role] < ROLE_RANK[spec.minimumRole]) return failFromQueued("TOOL_ACCESS_DENIED", name);

  const rateLimit = await checkAndConsumeRateLimit(context.organizationId, toolRateLimitScopeKey(context.userId, name), TOOL_RATE_LIMIT_POLICY);
  if (!rateLimit.allowed) return failFromQueued("TOOL_RATE_LIMITED", name);

  if (!isPlainContextData(rawArguments) || Object.keys(rawArguments as object).length > 0) return failFromQueued("TOOL_ARGUMENTS_INVALID", name);

  try {
    const projectId = await resolveConversationProjectId(context, conversationId);
    if (!projectId) return failFromQueued("TOOL_ACCESS_DENIED", name);

    const prepared = await prepareContextBundle(context, { conversationId, purpose: spec.contextPurpose });
    return { ok: true, executionLogId, name, correlationId, started, projectId, prepared, conversationId, context };
  } catch (error) {
    if (error instanceof ContextEngineError) return failFromQueued(mapContextEngineErrorCode(error.code), name);
    return failFromQueued("TOOL_UNAVAILABLE", name);
  }
}

/** Fase de consumo: barreira + CAS + `consumeContextBundleInTransaction` (decisao 10). Binding privado de modulo (ALTO-2) - ver docstring do topo do arquivo. */
async function consumeAiToolInvocation(state: PreparedAiToolInvocation): Promise<AiToolResult> {
  if (!state.ok) return state.result;
  const { executionLogId, name, correlationId, started, projectId, prepared, conversationId, context } = state;
  // ALTO-1: distingue se ESTE chamador chegou a possuir a transicao QUEUED->RUNNING (e portanto
  // e o unico com direito de decidir o desfecho terminal a partir de RUNNING) de um chamador
  // que nunca a possuiu (perdedor da corrida interna de `consumeWithCas`, ou cuja propria
  // transacao foi revertida por completo - nesse caso a linha volta a QUEUED e so pode ser
  // finalizada a partir de QUEUED, nunca de RUNNING, para nunca competir com o verdadeiro dono).
  let wonRunning = false;

  async function fail(code: AiToolErrorCode): Promise<AiToolResult> {
    const result = errorResult(name, correlationId, new AiToolError(code, correlationId), Date.now() - started);
    await finalizeAndAudit({
      executionLogId, organizationId: context.organizationId, userId: context.userId, toolName: name, result,
      transition: wonRunning ? { from: ["RUNNING"], to: "FAILED" } : { from: ["QUEUED"], to: "FAILED" },
    });
    return result;
  }

  try {
    const consumption = await consumeWithCas({
      bundle: prepared.bundle,
      correlationId: prepared.correlationId,
      organizationId: context.organizationId,
      projectId,
      userId: context.userId,
      conversationId,
      idempotencyKey: prepared.bundle.requestRef,
      executionLogId,
    });
    if (!consumption.transitioned) return fail("TOOL_CONCURRENT_CHANGE");
    wonRunning = true;

    const evidence = renderContextBundleForTransport(prepared.bundle);
    const result = AiToolResultSchema.parse({
      name,
      status: "COMPLETED",
      correlationId,
      toolsVersion: AI_TOOLS_LAYER_VERSION,
      contextPolicyVersion: prepared.bundle.policyVersion,
      purpose: prepared.bundle.purpose,
      measurements: prepared.bundle.measurements,
      evidence,
      durationMs: Date.now() - started,
    }) as AiToolResult;

    await finalizeAndAudit({
      executionLogId, organizationId: context.organizationId, userId: context.userId, toolName: name, result,
      transition: { from: ["RUNNING"], to: "COMPLETED" },
    });
    return result;
  } catch (error) {
    if (error instanceof ContextEngineError) return fail(mapContextEngineErrorCode(error.code));
    return fail("TOOL_UNAVAILABLE");
  }
}

/**
 * Unico caminho publico de execucao (ALTO-2). Compoe preparo + consumo sincronamente - nao ha
 * nenhuma forma de obter evidencia real chamando apenas uma das duas fases a partir de fora
 * deste arquivo, porque nenhuma delas e um binding exportado (fechamento estrutural, nao
 * apenas um gate de teste - ver docstring do topo do arquivo). Uma preparacao cujo processo
 * morre antes do consumo deixa `AIExecutionLog.status = "QUEUED"`; essa linha e generica (nao
 * tem nenhuma coluna especifica da Tool Layer) e e reconciliada com seguranca pelo mesmo
 * reaper generico ja existente da 10A (`reapExpiredGatewayReservations`,
 * `src/application/ai-gateway/reaper.ts` - CAS QUEUED->FAILED, sem tocar linhas RUNNING), sem
 * nenhum codigo novo: prova em `ai-tools.database.integration.test.ts`.
 */
export async function executeAiTool(context: AuthContext, conversationId: string, toolNameInput: string, rawArguments: unknown = {}): Promise<AiToolResult> {
  const prepared = await prepareAiToolInvocation(context, conversationId, toolNameInput, rawArguments);
  return consumeAiToolInvocation(prepared);
}

/* ============================================================================================
 * HARNESS DE TESTE DE CORRIDA (SOMENTE TESTES) - ALTO-2, correcao bloqueadora final.
 *
 * `prepareAiToolInvocation`/`consumeAiToolInvocation` nao sao mais exportadas (acima). Os
 * testes de corrida deste pacote (mesmo arquivo do proprio pacote, mas um MODULO diferente -
 * `ai-tools.database.integration.test.ts`) precisam exercitar as duas fases separadamente
 * para provar as invariantes de ALTO-1 (monotonicidade terminal sob corrida). Como um modulo
 * ES so pode usar bindings de outro modulo que este exporta, as tres funcoes abaixo sao o
 * UNICO ponto de acesso restante - e cada uma delas e deliberadamente estreita:
 *
 *   - Nenhuma devolve o `ContextBundle`/evidencia projetada (nunca `prepared.prepared` nem
 *     `result.evidence`/`result.measurements`) - apenas o status terminal (`AiToolResult`
 *     status) e o `executionLogId` (um identificador opaco, ja publico em qualquer log/UI,
 *     sem valor de evidencia por si so).
 *   - `__raceTestPrepare` devolve um `handle` (UUID aleatorio) que so e resolvivel atraves de
 *     um Map privado deste PROCESSO Node - nao serializavel, nao reutilizavel entre
 *     processos, inutil para qualquer chamador que nao seja este mesmo processo de teste.
 *   - Nenhuma composicao das tres funcoes abaixo permite obter evidencia sem passar pelo
 *     fluxo real de `consumeAiToolInvocation` (CAS + `AIToolCallLog` + auditoria
 *     `CONTEXT_CONSUMED`) - a diferenca central que fechou o achado ALTO-2 original (antes,
 *     chamar so o preparo ja expunha evidencia completa sem nunca passar pelo CAS).
 *   - `__raceTestConsumeInSubprocess` preserva a cobertura de corrida entre processos
 *     Node/PrismaClient GENUINAMENTE independentes (nao so `Promise.all` no mesmo processo):
 *     serializa o estado preparado (que SIM contem o ContextBundle) inteiramente DENTRO desta
 *     funcao, entrega-o ao subprocesso exclusivamente via variavel de ambiente
 *     process-local (nunca via valor de retorno, nunca visivel ao chamador), e o subprocesso
 *     devolve apenas `{status}`. A serializacao nunca atravessa uma fronteira de modulo
 *     exportado como dado utilizavel por si so.
 *   - `node:child_process` e usado exclusivamente aqui, documentado e allowlisted por
 *     caminho exato em `architecture.test.ts` (mesmo padrao da allowlist de
 *     `ai-gateway/architecture.test.ts`). Nunca invocado por nenhum caminho de producao -
 *     `__raceTestConsumeInSubprocess` nao e chamada por `executeAiTool`/`index.ts`, e o
 *     bloco auto-invocado abaixo so ativa dentro do PROPRIO subprocesso que este arquivo
 *     cria, gatilhado por uma variavel de ambiente que nunca existe em producao.
 * ============================================================================================
 */

const RACE_TEST_STATE_REGISTRY = new Map<string, PreparedAiToolInvocation>();
const RACE_TEST_SUBPROCESS_ENV_VAR = "__REDE_AI_TOOLS_RACE_HARNESS_SUBPROCESS_STATE__";

/** SOMENTE TESTES. Prepara uma vez e devolve um handle opaco (nunca o ContextBundle) - ver banner acima. */
export async function __raceTestPrepare(context: AuthContext, conversationId: string, toolNameInput: string, rawArguments: unknown = {}): Promise<{ ok: boolean; handle: string; executionLogId: string | null }> {
  const prepared = await prepareAiToolInvocation(context, conversationId, toolNameInput, rawArguments);
  const handle = randomUUID();
  RACE_TEST_STATE_REGISTRY.set(handle, prepared);
  return { ok: prepared.ok, handle, executionLogId: prepared.ok ? prepared.executionLogId : null };
}

function requireRaceTestState(handle: string): PreparedAiToolInvocation {
  const state = RACE_TEST_STATE_REGISTRY.get(handle);
  if (!state) throw new Error("handle de teste de corrida invalido ou de outro processo");
  return state;
}

/** SOMENTE TESTES. Consome pelo handle devolvido por `__raceTestPrepare` (mesmo processo) - devolve apenas o status terminal. */
export async function __raceTestConsume(handle: string): Promise<{ status: AiToolResult["status"] }> {
  const result = await consumeAiToolInvocation(requireRaceTestState(handle));
  return { status: result.status };
}

/** SOMENTE TESTES. Consome o mesmo handle num subprocesso Node com seu proprio PrismaClient - ver banner acima. */
export async function __raceTestConsumeInSubprocess(handle: string): Promise<{ status: AiToolResult["status"] }> {
  const state = requireRaceTestState(handle);
  const source = `import "./src/application/ai-tools/service.ts";`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "./scripts/patch-node-os.mjs", "--import", "tsx", "--input-type=module", "--eval", source], {
      cwd: process.cwd(),
      env: { ...process.env, [RACE_TEST_SUBPROCESS_ENV_VAR]: JSON.stringify(state) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) { reject(new Error(`race-test subprocess failed (${code}): ${stderr.slice(0, 500)}`)); return; }
      try { resolve(JSON.parse(stdout) as { status: AiToolResult["status"] }); }
      catch { reject(new Error(`race-test subprocess returned invalid JSON: ${stdout.slice(0, 500)}`)); }
    });
  });
}

/**
 * Gatilho do subprocesso acima: ativa SOMENTE quando a variavel de ambiente especifica esta
 * presente (nunca em producao) e o proprio subprocesso importa este arquivo so pelo efeito
 * colateral (`import "./service"`, sem nenhum binding nomeado) - nao existe nenhum export
 * novo aqui, e o acesso a `consumeAiToolInvocation` e lexico direto (mesmo modulo).
 */
if (process.env[RACE_TEST_SUBPROCESS_ENV_VAR]) {
  const rawState = process.env[RACE_TEST_SUBPROCESS_ENV_VAR]!;
  (async () => {
    try {
      const state = JSON.parse(rawState) as PreparedAiToolInvocation;
      const result = await consumeAiToolInvocation(state);
      process.stdout.write(JSON.stringify({ status: result.status }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ status: "FAILED", errorCode: (error as { code?: string } | null)?.code ?? "UNEXPECTED" }));
    } finally {
      await prisma.$disconnect();
      process.exit(0);
    }
  })();
}
