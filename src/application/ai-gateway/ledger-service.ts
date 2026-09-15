import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import { evaluateBudget, isSafeCostUsdMicros, isSafeIdempotencyKey, isSafeUsageUnits, type AiBudgetPolicy, type AiGatewayErrorCode, type AiRequest, AiGatewayError } from "@/domain/ai-gateway";
import { ContextConsumptionBindingSchema, ContextEngineError, contextConsumptionBinding, isPlainContextData } from "@/domain/context-engine";
import { consumeContextBundleInTransaction } from "@/application/context-engine/service";
import { reapExpiredGatewayReservations } from "./reaper";

// Correcao critica pos-reauditoria (achado MEDIO "reaper sem call site produtivo"): limite
// pequeno, pensado para rodar dentro do caminho sincrono de uma reserva (nunca a torna
// lenta sob carga normal); nao precisa esvaziar todo o backlog de uma vez - a proxima
// reserva desta organizacao continua o trabalho (ver `reserveGatewayExecution`).
const OPPORTUNISTIC_REAP_BATCH_LIMIT = 20;

/** Sentinela interna: forca rollback da transacao interativa quando um CAS falha (conta afetada != esperado). Nunca escapa desta unidade. */
class LedgerCasConflict extends Error {}

/**
 * Ledger de orcamento + idempotencia + auditoria do AI Gateway (docs Fase 10A §9/§10/§12).
 *
 * IMPORTANTE — limitacao documentada (ver docs/PHASE_10A_AUDIT_RECORD.md): a ceremonia
 * obrigatoria de backup+restauracao isolada exigida ANTES de qualquer migration (decisao 9)
 * precisa de um papel de banco com privilegio CREATEDB, que nao esta disponivel neste
 * ambiente e que o operador esta proibido de solicitar ("nao solicite credenciais"). Por
 * isso NENHUMA migration foi criada nesta rodada — este ledger reaproveita exclusivamente
 * `AIExecutionLog` e `AIPendingAction`, ja existentes, sem nenhuma coluna nova. Como os dois
 * exigem `conversationId` (FK obrigatoria), o ledger persistido do Gateway so funciona para
 * chamadores associados a uma `AIConversation` (hoje: `askRedeAI`). Um chamador futuro sem
 * conversa (ex.: Red Team) exigiria uma migration real, feita so quando o privilegio de
 * backup estiver disponivel.
 */

export interface GatewayLedgerContext {
  organizationId: string;
  userId: string;
  conversationId: string;
  messageId?: string;
}

const MAX_SERIALIZABLE_RETRY_ATTEMPTS = 3;
const TRANSACTION_TIMEOUT_MS = 15_000;
export const AI_GATEWAY_PROMPT_VERSION = "AI_GATEWAY_V1.0.0";

function isTransientWriteConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}
export function contextTransportRetryDisposition(error: unknown, attempt: number): "RETRY" | "EXHAUSTED" | "NOT_RETRYABLE" {
  if (!isTransientWriteConflict(error)) return "NOT_RETRYABLE";
  return attempt < MAX_SERIALIZABLE_RETRY_ATTEMPTS ? "RETRY" : "EXHAUSTED";
}
function jitterDelay(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, 30 * attempt + Math.floor(Math.random() * 40)));
}

/** Fingerprint estrutural do request (nunca do conteudo livre) — usado so para detectar reuso de idempotencyKey com payload divergente (decisao 12). */
export function requestFingerprint(request: AiRequest): string {
  const canonical = JSON.stringify({
    task: request.task,
    requiredCapabilities: [...request.requiredCapabilities].sort(),
    dataClassification: request.dataClassification,
    criticality: request.criticality,
    maxCostUsdMicros: request.maxCostUsdMicros ?? null,
    outputSchema: request.outputSchema ?? null,
    projectId: request.projectId ?? null,
    contextFingerprint: request.contextBundle?.fingerprint ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function startOfMonth(now: Date) {
  const value = new Date(now); value.setUTCDate(1); value.setUTCHours(0, 0, 0, 0); return value;
}
function startOfDay(now: Date) {
  const value = new Date(now); value.setUTCHours(0, 0, 0, 0); return value;
}

async function loadBudgetPolicy(organizationId: string, task: AiRequest["task"], tx: Prisma.TransactionClient = prisma): Promise<AiBudgetPolicy | null> {
  const row = await tx.aIUsageBudget.findUnique({ where: { organizationId } });
  if (!row || Number(row.monthlyLimit) <= 0) return null;
  return { organizationId, taskCategory: task, monthlyLimitUsdMicros: Math.round(Number(row.monthlyLimit) * 1_000_000), hardBlock: true };
}

async function spendToDateUsdMicros(organizationId: string, since: Date, tx: Prisma.TransactionClient = prisma): Promise<number> {
  const usage = await tx.aIExecutionLog.aggregate({ where: { organizationId, createdAt: { gte: since }, status: { notIn: ["FAILED", "CANCELLED"] } }, _sum: { estimatedCost: true } });
  return Math.round(Number(usage._sum.estimatedCost ?? 0) * 1_000_000);
}

export type ReservationOutcome =
  | { kind: "RESERVED"; executionLogId: string; pendingActionId: string }
  | { kind: "IDEMPOTENT_REPLAY"; executionLogId: string; pendingActionId: string; status: "COMPLETED" | "FAILED" | "EXECUTING" };

/**
 * Reserva atomica: dentro de uma transacao Serializable, releitura do gasto do mes/dia +
 * checagem de idempotencyKey + insercao da reserva (AIExecutionLog RUNNING + AIPendingAction
 * EXECUTING). Ausencia de orcamento/preco versionado falha fechado (decisao 6/9).
 */
export async function reserveGatewayExecution(
  ledger: GatewayLedgerContext,
  request: AiRequest,
  estimatedCostUsdMicros: number,
  priceVersion: string | null,
  providerRef: string,
  model: string,
): Promise<ReservationOutcome> {
  // Correcao focal pos-auditoria (achados MEDIOS "idempotencyKey hostil" e "custo
  // negativo/nao finito"): validado ANTES de qualquer acesso ao Prisma, inclusive antes
  // do calculo do fingerprint. Nenhuma normalizacao silenciosa - uma chave/custo fora do
  // formato e sempre rejeitado com AiGatewayError classificado, nunca reescrito.
  if (request.idempotencyKey !== undefined && !isSafeIdempotencyKey(request.idempotencyKey)) {
    throw new AiGatewayError("idempotencyKey fora do formato seguro.", "CONFIGURATION", false, request.correlationId);
  }
  if (!isSafeCostUsdMicros(estimatedCostUsdMicros)) {
    throw new AiGatewayError("Custo estimado fora do formato seguro (deve ser inteiro, finito, nao-negativo).", "CONFIGURATION", false, request.correlationId);
  }
  // Correcao critica pos-reauditoria (achado MEDIO "reaper sem call site produtivo"): antes
  // de calcular o gasto do periodo, recupera oportunisticamente (tenant-scoped, relogio
  // server-side, lote limitado) qualquer reserva QUEUED vencida desta organizacao - sem
  // isto, uma reserva orfa (processo morto antes de `markGatewayExecutionTransportStarted`)
  // continuaria contando contra o orcamento para sempre, ja que `reapExpiredGatewayReservations`
  // nunca era chamada por nenhum caminho de producao. Se o reaper falhar (ex.: erro de
  // banco), a reserva TAMBEM falha - nunca calcula orcamento sobre um estado que pode estar
  // incorreto (nenhuma chamada ao adapter acontece durante esta recuperacao).
  await reapExpiredGatewayReservations({ organizationId: ledger.organizationId, batchLimit: OPPORTUNISTIC_REAP_BATCH_LIMIT });
  const fingerprint = requestFingerprint(request);
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        if (request.idempotencyKey) {
          const existing = await tx.aIPendingAction.findUnique({ where: { organizationId_idempotencyKey: { organizationId: ledger.organizationId, idempotencyKey: request.idempotencyKey } } });
          if (existing) {
            const storedFingerprint = (existing.arguments as Record<string, unknown>).fingerprint;
            if (storedFingerprint !== fingerprint) {
              throw new AiGatewayError("idempotencyKey reutilizada com um payload diferente.", "POLICY_BLOCKED", false, request.correlationId);
            }
            return { kind: "IDEMPOTENT_REPLAY", executionLogId: existing.affectedEntityId!, pendingActionId: existing.id, status: existing.status as "COMPLETED" | "FAILED" | "EXECUTING" };
          }
        }
        const policy = await loadBudgetPolicy(ledger.organizationId, request.task, tx);
        const now = new Date();
        const monthToDate = await spendToDateUsdMicros(ledger.organizationId, startOfMonth(now), tx);
        const dayToDate = await spendToDateUsdMicros(ledger.organizationId, startOfDay(now), tx);
        const decision = evaluateBudget({ policy, monthToDateUsdMicros: monthToDate, dayToDateUsdMicros: dayToDate, estimatedCostUsdMicros, priceVersion });
        if (!decision.allowed) {
          throw new AiGatewayError(`Orcamento indisponivel ou excedido (${decision.reason}).`, "BUDGET_EXCEEDED", false, request.correlationId);
        }
        // Correcao focal pos-auditoria (achado MEDIO "reserva orfa RUNNING"): a reserva
        // nasce QUEUED - orcamento ja contabilizado, mas o transporte AINDA NAO comecou.
        // `gateway.ts` so transiciona para RUNNING (via markGatewayExecutionTransportStarted)
        // imediatamente antes de chamar o adapter. Essa distincao de estado, ja existente no
        // enum `AIExecutionStatus`, e o que permite ao reaper (`reaper.ts`) liberar com
        // seguranca reservas QUEUED vencidas (transporte comprovadamente nunca iniciado) sem
        // jamais tocar reservas RUNNING vencidas (ambiguas - podem ter sido enviadas/cobradas).
        const executionLogId = randomUUID();
        const pendingActionId = randomUUID();
        const idempotencyKey = request.idempotencyKey ?? `auto-${randomUUID()}`;
        const executionLog = await tx.aIExecutionLog.create({
          data: {
            id: executionLogId,
            organizationId: ledger.organizationId,
            userId: ledger.userId,
            conversationId: ledger.conversationId,
            messageId: ledger.messageId,
            task: request.task,
            model,
            provider: providerRef,
            status: "QUEUED",
            estimatedCost: estimatedCostUsdMicros / 1_000_000,
            promptVersion: AI_GATEWAY_PROMPT_VERSION,
            toolsVersion: "N/A",
            contextBuilderVersion: "N/A",
            startedAt: now,
          },
        });
        const pendingAction = await tx.aIPendingAction.create({
          data: {
            id: pendingActionId,
            organizationId: ledger.organizationId,
            userId: ledger.userId,
            conversationId: ledger.conversationId,
            sourceMessageId: ledger.messageId,
            actionType: "AI_GATEWAY_EXECUTION",
            preview: { correlationId: request.correlationId, task: request.task },
            arguments: {
              fingerprint,
              context: request.contextBundle ? contextConsumptionBinding(request.contextBundle, {
                actorUserId: ledger.userId,
                conversationId: ledger.conversationId,
                organizationId: ledger.organizationId,
                projectId: request.projectId!,
                idempotencyKey,
                executionLogId,
                pendingActionId,
                correlationId: request.correlationId,
              }) : null,
            },
            idempotencyKey,
            status: "EXECUTING",
            confirmedAt: now,
            affectedEntityType: "AIExecutionLog",
            affectedEntityId: executionLog.id,
            expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          },
        });
        return { kind: "RESERVED", executionLogId: executionLog.id, pendingActionId: pendingAction.id };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: TRANSACTION_TIMEOUT_MS });
    } catch (error) {
      if (error instanceof AiGatewayError) throw error;
      if (!isTransientWriteConflict(error) || attempt === MAX_SERIALIZABLE_RETRY_ATTEMPTS) {
        if (isTransientWriteConflict(error)) throw new AiGatewayError("Conflito de concorrencia persistente ao reservar orcamento.", "BUDGET_EXCEEDED", true, request.correlationId, { cause: error });
        throw error;
      }
      await jitterDelay(attempt);
    }
  }
  throw new AiGatewayError("Conflito de concorrencia persistente ao reservar orcamento.", "BUDGET_EXCEEDED", true, request.correlationId);
}

export type TransportStartOutcome =
  | { transitioned: true }
  | { transitioned: false; reasonCode: "RESERVATION_NOT_ACTIVE" };

/**
 * Promove QUEUED -> RUNNING de forma atomica e VERIFICADA (correcao critica pos-
 * reauditoria, achado CRITICO "reserva expirada ressuscita"). Chamada por `gateway.ts`
 * imediatamente antes de `adapter.execute()`, em cada tentativa (idempotente:
 * RUNNING->RUNNING e um no-op valido). AIExecutionLog e AIPendingAction sao CAS'ados na
 * MESMA transacao interativa - se qualquer um dos dois nao estiver mais no estado
 * esperado (ex.: o reaper ja expirou a reserva QUEUED para FAILED enquanto isto rodava),
 * a transacao inteira reverte (nenhuma mutacao parcial) e a funcao devolve
 * `transitioned: false`. O CONTRATO com o chamador e absoluto: `transitioned !== true`
 * significa que o adapter NUNCA pode ser chamado para esta reserva.
 */
export interface ContextTransportAuthorization {
  ledger: GatewayLedgerContext;
  request: AiRequest;
}

// SHARE conflicts with every productive INSERT/UPDATE/DELETE (ROW EXCLUSIVE). A mutation
// that committed first is visible to the reconstruction below; one that loses this lock
// race can only commit after TRANSPORT_AUTHORIZED/RUNNING commits and is therefore later.
// The statement is static and contains no user-controlled identifier.
const CONTEXT_MUTATION_BARRIER_SQL = `LOCK TABLE
  organization_memberships, users, ai_conversations, projects,
  viability_studies, study_versions, assumption_snapshots, calculation_runs,
  financial_results, risk_findings, legal_evidence_documents,
  engineering_technical_opinions, engineering_technical_opinion_items
  IN SHARE MODE`;

function sameJson(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function storedContextBinding(argumentsJson: unknown) {
  if (!isPlainContextData(argumentsJson) || !argumentsJson || typeof argumentsJson !== "object" || Array.isArray(argumentsJson)) return null;
  const record = argumentsJson as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "context,fingerprint" || typeof record.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(record.fingerprint)) return null;
  const parsed = ContextConsumptionBindingSchema.safeParse(record.context);
  return parsed.success ? { fingerprint: record.fingerprint, context: parsed.data } : null;
}

export async function markGatewayExecutionTransportStarted(
  executionLogId: string,
  pendingActionId: string,
  authorization?: ContextTransportAuthorization,
): Promise<TransportStartOutcome> {
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        if (authorization) {
          if (!authorization.request.contextBundle) throw new ContextEngineError("CONTEXT_INTEGRITY_FAILED", authorization.request.correlationId);
          await tx.$executeRawUnsafe(CONTEXT_MUTATION_BARRIER_SQL);
          const execution = await tx.aIExecutionLog.findUnique({ where: { id: executionLogId }, select: { organizationId: true, userId: true, conversationId: true, status: true } });
          const pending = await tx.aIPendingAction.findUnique({ where: { id: pendingActionId }, select: { organizationId: true, userId: true, conversationId: true, status: true, affectedEntityId: true, idempotencyKey: true, arguments: true } });
          if (!execution || !pending || execution.status !== "QUEUED" || pending.status !== "EXECUTING"
            || pending.affectedEntityId !== executionLogId || execution.organizationId !== authorization.ledger.organizationId
            || execution.userId !== authorization.ledger.userId || execution.conversationId !== authorization.ledger.conversationId
            || pending.organizationId !== authorization.ledger.organizationId || pending.userId !== authorization.ledger.userId
            || pending.conversationId !== authorization.ledger.conversationId || pending.idempotencyKey !== authorization.request.idempotencyKey) throw new LedgerCasConflict();
          const stored = storedContextBinding(pending.arguments);
          const expected = contextConsumptionBinding(authorization.request.contextBundle, {
            actorUserId: authorization.ledger.userId,
            conversationId: authorization.ledger.conversationId,
            organizationId: authorization.ledger.organizationId,
            projectId: authorization.request.projectId!,
            idempotencyKey: authorization.request.idempotencyKey!,
            executionLogId,
            pendingActionId,
            correlationId: authorization.request.correlationId,
          });
          if (!stored || stored.fingerprint !== requestFingerprint(authorization.request) || !sameJson(stored.context, expected)) throw new ContextEngineError("CONTEXT_INTEGRITY_FAILED", authorization.request.correlationId);
          await consumeContextBundleInTransaction(tx, {
            bundle: authorization.request.contextBundle, correlationId: authorization.request.correlationId,
            organizationId: authorization.ledger.organizationId, projectId: authorization.request.projectId,
            userId: authorization.ledger.userId, conversationId: authorization.ledger.conversationId,
            idempotencyKey: authorization.request.idempotencyKey, executionLogId,
          });
        }
        const logCas = await tx.aIExecutionLog.updateMany({ where: { id: executionLogId, status: authorization ? "QUEUED" : { in: ["QUEUED", "RUNNING"] } }, data: { status: "RUNNING" } });
        if (logCas.count !== 1) throw new LedgerCasConflict();
        const pendingCas = await tx.aIPendingAction.updateMany({ where: { id: pendingActionId, status: "EXECUTING" }, data: { status: "EXECUTING" } });
        if (pendingCas.count !== 1) throw new LedgerCasConflict();
      }, { isolationLevel: authorization ? Prisma.TransactionIsolationLevel.Serializable : undefined, timeout: TRANSACTION_TIMEOUT_MS });
      return { transitioned: true };
    } catch (error) {
      if (error instanceof LedgerCasConflict) return { transitioned: false, reasonCode: "RESERVATION_NOT_ACTIVE" };
      if (error instanceof ContextEngineError) throw error;
      if (!authorization) throw error;
      const disposition = contextTransportRetryDisposition(error, attempt);
      if (disposition === "NOT_RETRYABLE") throw error;
      if (disposition === "EXHAUSTED") throw new ContextEngineError("CONTEXT_CONCURRENT_CHANGE", authorization.request.correlationId, { cause: error });
      await jitterDelay(attempt);
    }
  }
  throw new ContextEngineError("CONTEXT_CONCURRENT_CHANGE", authorization?.request.correlationId ?? "correlation-unavailable");
}

export type ConfirmOutcome = { outcome: "CONFIRMED" } | { outcome: "ALREADY_CONFIRMED_IDENTICAL" };

// Nao persistido - so satisfaz a exigencia de dominio "custo > 0 exige preco versionado"
// (`evaluateBudget`) na revalidacao de orcamento feita aqui. A prova real de preco
// versionado ja aconteceu em `reserveGatewayExecution`; esta reconciliacao nao cria um
// novo preco, so verifica se o valor OBSERVADO cabe no orcamento restante.
const OBSERVED_COST_BUDGET_PROOF = "RECONCILIATION_CHECK";

/**
 * Confirma a reserva com o uso/custo observado real — nunca grava conteudo, so numeros/
 * versoes/codigos estaticos (decisao 10). `provider`/`model` NUNCA sao recebidos aqui - ja
 * foram gravados em `reserveGatewayExecution` a partir da rota canonica e permanecem
 * imutaveis pelo resto do ciclo de vida da execucao (achado ALTO original "provider/model
 * nao confiaveis no ledger").
 *
 * Correcao critica pos-reauditoria (achado ALTO "custo observado hostil"): `usage` vem do
 * adapter - tao nao-confiavel quanto qualquer entrada externa. Validado ANTES de qualquer
 * transacao. CAS transacional a partir de RUNNING apenas - um estado ja terminal
 * (COMPLETED/FAILED/EXPIRED/CANCELLED) nunca e sobrescrito; um CAS perdido nunca e
 * interpretado como sucesso (fail-closed, `INVALID_RESPONSE`). Se o custo observado
 * exceder o que foi reservado, o excedente e revalidado atomicamente contra o orcamento
 * restante do periodo; se nao couber, a confirmacao falha fechado SEM truncar o custo e
 * SEM mutar a linha - ela permanece `RUNNING` (ambigua), a mesma politica de reconciliacao
 * manual ja usada para qualquer `RUNNING` vencida (nunca liberada automaticamente).
 */
export async function confirmGatewayExecution(
  executionLogId: string,
  pendingActionId: string,
  usage: { inputUnits: number; outputUnits: number; observedCostUsdMicros: number; latencyMs: number },
  correlationId: string,
): Promise<ConfirmOutcome> {
  if (!isSafeUsageUnits(usage.inputUnits) || !isSafeUsageUnits(usage.outputUnits)) {
    throw new AiGatewayError("Unidades de uso (input/output) reportadas pelo adapter fora do formato seguro.", "PROVIDER_USAGE_INVALID", false, correlationId);
  }
  if (!isSafeCostUsdMicros(usage.observedCostUsdMicros)) {
    throw new AiGatewayError("Custo observado reportado pelo adapter fora do formato seguro (deve ser inteiro, finito, nao-negativo).", "PROVIDER_USAGE_INVALID", false, correlationId);
  }
  if (typeof usage.latencyMs !== "number" || !Number.isInteger(usage.latencyMs) || !Number.isFinite(usage.latencyMs) || usage.latencyMs < 0) {
    throw new AiGatewayError("Latencia observada reportada pelo adapter fora do formato seguro.", "PROVIDER_USAGE_INVALID", false, correlationId);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.aIExecutionLog.findUniqueOrThrow({ where: { id: executionLogId } });
      const observedUsdMicros = usage.observedCostUsdMicros;
      if (current.status === "COMPLETED") {
        const identical = current.inputTokens === usage.inputUnits && current.outputTokens === usage.outputUnits
          && Math.round(Number(current.estimatedCost) * 1_000_000) === observedUsdMicros;
        if (identical) return { outcome: "ALREADY_CONFIRMED_IDENTICAL" } as const;
        throw new LedgerCasConflict();
      }
      if (current.status !== "RUNNING") throw new LedgerCasConflict();

      const now = new Date();
      const reservedUsdMicros = Math.round(Number(current.estimatedCost) * 1_000_000);
      const overageUsdMicros = observedUsdMicros - reservedUsdMicros;
      if (overageUsdMicros > 0) {
        const policy = await loadBudgetPolicy(current.organizationId, current.task, tx);
        const monthToDateExcludingThisRow = (await spendToDateUsdMicros(current.organizationId, startOfMonth(now), tx)) - reservedUsdMicros;
        const dayToDateExcludingThisRow = (await spendToDateUsdMicros(current.organizationId, startOfDay(now), tx)) - reservedUsdMicros;
        const decision = evaluateBudget({
          policy,
          monthToDateUsdMicros: monthToDateExcludingThisRow,
          dayToDateUsdMicros: dayToDateExcludingThisRow,
          estimatedCostUsdMicros: observedUsdMicros,
          priceVersion: OBSERVED_COST_BUDGET_PROOF,
        });
        if (!decision.allowed) {
          // Codigo dedicado (nunca BUDGET_EXCEEDED): o chamador (`gateway.ts`) precisa
          // distinguir este caso de qualquer outra falha para NUNCA chamar
          // `releaseGatewayExecution` aqui - a linha fica RUNNING (ambigua) de proposito.
          throw new AiGatewayError(`Custo observado excede o orcamento disponivel para reconciliacao (${decision.reason}).`, "RECONCILIATION_REQUIRED", false, correlationId);
        }
      }

      const logCas = await tx.aIExecutionLog.updateMany({
        where: { id: executionLogId, status: "RUNNING" },
        data: { status: "COMPLETED", inputTokens: usage.inputUnits, outputTokens: usage.outputUnits, estimatedCost: observedUsdMicros / 1_000_000, durationMs: usage.latencyMs, completedAt: now },
      });
      if (logCas.count !== 1) throw new LedgerCasConflict();
      const pendingCas = await tx.aIPendingAction.updateMany({
        where: { id: pendingActionId, status: "EXECUTING" },
        data: { status: "COMPLETED", result: { observedCostUsdMicros: observedUsdMicros }, executedAt: now },
      });
      if (pendingCas.count !== 1) throw new LedgerCasConflict();
      return { outcome: "CONFIRMED" } as const;
    });
  } catch (error) {
    if (error instanceof LedgerCasConflict) {
      throw new AiGatewayError("Nao foi possivel confirmar: a execucao ja esta em outro estado terminal.", "INVALID_RESPONSE", false, correlationId);
    }
    throw error;
  }
}

export interface ReleaseOutcome { released: boolean }

/**
 * Libera a reserva em falha COMPROVADAMENTE pre-transporte (correcao critica DEFINITIVA
 * pos-reauditoria, achado CRITICO "liberacao automatica de execucao potencialmente
 * cobravel"). A reauditoria provou ao vivo que a versao anterior aceitava `RUNNING` como
 * origem e liberava (custo zerado) QUALQUER falha pos-transporte, inclusive
 * TIMEOUT/PROVIDER_UNAVAILABLE/UNEXPECTED, que nao tem garantia nenhuma de nao-cobranca.
 *
 * Esta funcao agora e o unico caminho de liberacao AUTOMATICA e so aceita CAS a partir de
 * `QUEUED` - o transporte comprovadamente nunca comecou (nenhuma chamada ao adapter
 * aconteceu para esta reserva). Uma linha `RUNNING` NUNCA e aceita aqui: a tentativa
 * simplesmente nao afeta nenhuma linha (`released: false`) - nunca lanca, nunca zera
 * custo, nunca muda `RUNNING` para `FAILED`. Isso e deliberado: o unico caminho de
 * producao (`gateway.ts`) so chama esta funcao quando `adapterInvoked === false` (ver
 * comentario la); nao existe hoje nenhum caminho legitimo de codigo produtivo que precise
 * liberar uma reserva `RUNNING` automaticamente - uma reserva `RUNNING` vencida so sai
 * desse estado via `confirmGatewayExecution` (sucesso real) ou intervencao manual de
 * reconciliacao de um operador, nunca por este caminho automatico.
 *
 * CAS transacional: um estado ja terminal (COMPLETED/FAILED/EXPIRED/CANCELLED) nunca e
 * sobrescrito - o CAS simplesmente nao afeta nenhuma linha. AIExecutionLog e
 * AIPendingAction sao atualizados atomicamente; falha em um lado reverte o outro.
 */
export async function releaseGatewayExecution(executionLogId: string, pendingActionId: string, code: AiGatewayErrorCode): Promise<ReleaseOutcome> {
  try {
    await prisma.$transaction(async (tx) => {
      const logCas = await tx.aIExecutionLog.updateMany({ where: { id: executionLogId, status: "QUEUED" }, data: { status: "FAILED", estimatedCost: 0, errorCode: code, completedAt: new Date() } });
      if (logCas.count !== 1) throw new LedgerCasConflict();
      const pendingCas = await tx.aIPendingAction.updateMany({ where: { id: pendingActionId, status: "EXECUTING" }, data: { status: "FAILED", result: { errorCode: code } } });
      if (pendingCas.count !== 1) throw new LedgerCasConflict();
    });
    return { released: true };
  } catch (error) {
    if (error instanceof LedgerCasConflict) return { released: false };
    throw error;
  }
}
