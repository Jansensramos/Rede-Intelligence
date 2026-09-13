import { Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/database/prisma";

/**
 * Recuperacao de reservas expiradas do AI Gateway (correcao focal pos-auditoria, achado
 * MEDIO "reserva orfa RUNNING"). Mapeamento de estados usado:
 *
 * - `AIExecutionLog.status = "QUEUED"`: orcamento reservado, mas o transporte para o
 *   adapter NUNCA foi iniciado (ver `reserveGatewayExecution`/`markGatewayExecutionTransportStarted`
 *   em `ledger-service.ts`). Comprovadamente nao-enviada -> pode expirar e liberar
 *   orcamento com seguranca.
 * - `AIExecutionLog.status = "RUNNING"`: o transporte foi iniciado pelo menos uma vez.
 *   Se o processo morrer antes de `confirmGatewayExecution`/`releaseGatewayExecution`,
 *   NAO SABEMOS se o provider recebeu/cobrou a chamada -> estado ambiguo. Este reaper
 *   NUNCA libera automaticamente uma linha RUNNING vencida; so a conta/relata para
 *   intervencao manual de um operador (nenhuma reconciliacao automatica e criada aqui -
 *   isso seria uma decisao autonoma fora do escopo desta correcao).
 *
 * Nenhuma coluna nova foi necessaria: os dois valores de `AIExecutionStatus` (QUEUED,
 * RUNNING) e o valor `EXPIRED` de `AIActionStatus` ja existiam no schema antes da 10A e
 * carregam exatamente a semantica necessaria aqui.
 */

export const DEFAULT_QUEUED_STALE_MS = 5 * 60_000; // 5 min - tempo generoso para markGatewayExecutionTransportStarted rodar
export const DEFAULT_REAPER_BATCH_LIMIT = 100;

export interface ReapOptions {
  organizationId?: string;
  now?: Date;
  staleAfterMs?: number;
  batchLimit?: number;
}

export interface ReapResult {
  releasedExecutionLogIds: string[];
  ambiguousExecutionLogIds: string[];
}

/**
 * Libera com seguranca reservas QUEUED vencidas (claim via CAS transacional - so libera
 * se a linha AINDA estiver QUEUED no momento do update, evitando corrida com
 * `markGatewayExecutionTransportStarted`) e apenas CONTA reservas RUNNING vencidas, sem
 * jamais mutar essas ultimas. Tenant-scoped quando `organizationId` e informado; relogio
 * e limite de lote injetaveis para teste deterministico e execucao incremental segura.
 */
export async function reapExpiredGatewayReservations(options: ReapOptions = {}): Promise<ReapResult> {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_QUEUED_STALE_MS;
  const staleBefore = new Date(now.getTime() - staleAfterMs);
  const batchLimit = options.batchLimit ?? DEFAULT_REAPER_BATCH_LIMIT;
  const tenantFilter = options.organizationId ? { organizationId: options.organizationId } : {};

  const queuedCandidates = await prisma.aIExecutionLog.findMany({
    where: { status: "QUEUED", startedAt: { lt: staleBefore }, ...tenantFilter },
    take: batchLimit,
    select: { id: true },
  });

  const releasedExecutionLogIds: string[] = [];
  for (const candidate of queuedCandidates) {
    const claimed = await prisma.$transaction(async (tx) => {
      // CAS: so procede se a linha ainda estiver QUEUED agora - se outro reaper ou o
      // proprio gateway.ts (markGatewayExecutionTransportStarted) ja a moveu, a
      // contagem afetada e 0 e nada mais e tocado (nenhuma liberacao dupla, idempotente).
      const claim = await tx.aIExecutionLog.updateMany({
        where: { id: candidate.id, status: "QUEUED" },
        data: { status: "FAILED", estimatedCost: 0, errorCode: "TIMEOUT", completedAt: now },
      });
      if (claim.count !== 1) return false;
      await tx.aIPendingAction.updateMany({
        where: { affectedEntityType: "AIExecutionLog", affectedEntityId: candidate.id, status: "EXECUTING" },
        data: { status: "EXPIRED", result: { errorCode: "TIMEOUT" } },
      });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    if (claimed) releasedExecutionLogIds.push(candidate.id);
  }

  const ambiguousCandidates = await prisma.aIExecutionLog.findMany({
    where: { status: "RUNNING", startedAt: { lt: staleBefore }, ...tenantFilter },
    take: batchLimit,
    select: { id: true },
  });

  return { releasedExecutionLogIds, ambiguousExecutionLogIds: ambiguousCandidates.map((row) => row.id) };
}
