import { randomUUID } from "node:crypto";
import { Prisma, type IntegrationJob, type IntegrationJobStatus, type JobPriority } from "@prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import { decideRetry, type RetryableErrorClass } from "@/domain/integrations";

const json = (value: unknown) => value as Prisma.InputJsonValue;

/**
 * Boundary de execução durável para `IntegrationJob` usando o PostgreSQL atual
 * como fila local (plano §11/§14): claim atômico via
 * `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)`, o mesmo idioma
 * usado por filas de job em Postgres em produção (ex.: `pgboss`, `graphile-worker`).
 * Não instala Redis/RabbitMQ — é a fundação/contract; um worker dedicado fora
 * do processo web pode reutilizar exatamente estas funções.
 */
export async function enqueueJob(input: {
  organizationId: string;
  installationId?: string | null;
  jobType: string;
  priority?: JobPriority;
  payload: unknown;
  scheduledAt?: Date;
  maxAttempts?: number;
  correlationId?: string;
}) {
  return prisma.integrationJob.create({
    data: {
      organizationId: input.organizationId,
      installationId: input.installationId ?? null,
      jobType: input.jobType,
      priority: input.priority ?? "NORMAL",
      payload: json(input.payload),
      scheduledAt: input.scheduledAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? 5,
      correlationId: input.correlationId ?? randomUUID(),
    },
  });
}

/**
 * Reivindica atomicamente o próximo job elegível (QUEUED com `scheduledAt` vencido,
 * ou RUNNING com lease expirada — recuperação de worker morto) para `leaseOwner`.
 * Concorrência segura: `FOR UPDATE SKIP LOCKED` garante que dois workers nunca
 * reivindicam o mesmo job.
 */
export async function claimNextJob(organizationId: string, leaseOwner: string, leaseDurationMs = 30_000): Promise<IntegrationJob | null> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
  // Datas são passadas como ISO string + cast explícito ::timestamp: a coluna é `timestamp`
  // sem timezone, e vincular um objeto Date do JS diretamente faz o Postgres reinterpretar
  // o valor no timezone da sessão (deslocando o horário) em vez de comparar em UTC puro.
  const nowIso = now.toISOString();
  const leaseExpiresAtIso = leaseExpiresAt.toISOString();
  const rows = await prisma.$queryRaw<IntegrationJob[]>`
    UPDATE integration_jobs
    SET status = 'RUNNING', lease_owner = ${leaseOwner}, lease_expires_at = ${leaseExpiresAtIso}::timestamp, started_at = COALESCE(started_at, ${nowIso}::timestamp), attempt_count = attempt_count + 1
    WHERE id = (
      SELECT id FROM integration_jobs
      WHERE organization_id = ${organizationId}
        AND status NOT IN ('SUCCEEDED', 'CANCELLED', 'DEAD_LETTER')
        AND (
          (status = 'QUEUED' AND scheduled_at <= ${nowIso}::timestamp)
          OR (status = 'RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at < ${nowIso}::timestamp)
        )
      ORDER BY CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'NORMAL' THEN 1 ELSE 2 END, scheduled_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING
      id, organization_id AS "organizationId", installation_id AS "installationId", job_type AS "jobType",
      priority, status, payload, attempt_count AS "attemptCount", max_attempts AS "maxAttempts",
      lease_owner AS "leaseOwner", lease_expires_at AS "leaseExpiresAt", scheduled_at AS "scheduledAt",
      started_at AS "startedAt", finished_at AS "finishedAt", last_error AS "lastError",
      correlation_id AS "correlationId", created_at AS "createdAt";
  `;
  return rows[0] ?? null;
}

/** Claim global para o worker dedicado. O tenant vem sempre do próprio job e é
 * revalidado pelo dispatcher antes de qualquer acesso de negócio. */
export async function claimNextJobAcrossOrganizations(leaseOwner: string, leaseDurationMs = 30_000): Promise<IntegrationJob | null> {
  const nowIso = new Date().toISOString();
  const leaseExpiresAtIso = new Date(Date.now() + leaseDurationMs).toISOString();
  const rows = await prisma.$queryRaw<IntegrationJob[]>`
    UPDATE integration_jobs
    SET status = 'RUNNING', lease_owner = ${leaseOwner}, lease_expires_at = ${leaseExpiresAtIso}::timestamp,
        started_at = COALESCE(started_at, ${nowIso}::timestamp), attempt_count = attempt_count + 1
    WHERE id = (
      SELECT id FROM integration_jobs
      WHERE status NOT IN ('SUCCEEDED', 'CANCELLED', 'DEAD_LETTER')
        AND job_type IN ('SYNC_INSTALLATION', 'POLL_INSTALLATION', 'DELIVER_WEBHOOKS', 'PROCESS_DESIGN_FILE', 'PROCESS_SIGNATURE_WEBHOOK', 'SEND_TRANSACTIONAL_EMAIL', 'FINANCIAL_PROVIDER')
        AND ((status = 'QUEUED' AND scheduled_at <= ${nowIso}::timestamp)
          OR (status = 'RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at < ${nowIso}::timestamp))
      ORDER BY CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'NORMAL' THEN 1 ELSE 2 END, scheduled_at ASC
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    RETURNING id, organization_id AS "organizationId", installation_id AS "installationId", job_type AS "jobType",
      priority, status, payload, attempt_count AS "attemptCount", max_attempts AS "maxAttempts",
      lease_owner AS "leaseOwner", lease_expires_at AS "leaseExpiresAt", scheduled_at AS "scheduledAt",
      started_at AS "startedAt", finished_at AS "finishedAt", last_error AS "lastError",
      correlation_id AS "correlationId", created_at AS "createdAt";
  `;
  return rows[0] ?? null;
}

export async function heartbeatJob(jobId: string, leaseOwner: string, leaseDurationMs = 30_000) {
  return prisma.integrationJob.updateMany({
    where: { id: jobId, status: "RUNNING", leaseOwner },
    data: { leaseExpiresAt: new Date(Date.now() + leaseDurationMs) },
  });
}

export async function completeJob(jobId: string, leaseOwner?: string) {
  if (leaseOwner) return prisma.integrationJob.updateMany({ where: { id: jobId, status: "RUNNING", leaseOwner }, data: { status: "SUCCEEDED", finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } });
  return prisma.integrationJob.update({ where: { id: jobId }, data: { status: "SUCCEEDED", finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } });
}

export type JobFailureOutcome = { action: "RETRY"; nextAttempt: number; scheduledAt: Date } | { action: "DEAD_LETTER" };

/** Falha um job: retryable vira novo QUEUED com backoff; permanente ou esgotado vira DEAD_LETTER + IntegrationDeadLetter. */
export async function failJob(jobId: string, errorClass: RetryableErrorClass, message: string, retryAfterMs?: number | null): Promise<JobFailureOutcome> {
  const job = await prisma.integrationJob.findUniqueOrThrow({ where: { id: jobId } });
  const decision = decideRetry({ errorClass, attemptCount: job.attemptCount, retryAfterMs, policy: { baseDelayMs: 1000, maxDelayMs: 5 * 60_000, maxAttempts: job.maxAttempts, jitterRatio: 0.2 } });
  if (decision.action === "RETRY") {
    const scheduledAt = new Date(Date.now() + decision.delayMs);
    await prisma.integrationJob.update({ where: { id: jobId }, data: { status: "QUEUED", scheduledAt, lastError: message, leaseOwner: null, leaseExpiresAt: null } });
    return { action: "RETRY", nextAttempt: decision.nextAttempt, scheduledAt };
  }
  await prisma.$transaction([
    prisma.integrationJob.update({ where: { id: jobId }, data: { status: "DEAD_LETTER", finishedAt: new Date(), lastError: message, leaseOwner: null, leaseExpiresAt: null } }),
    prisma.integrationDeadLetter.create({ data: { organizationId: job.organizationId, sourceType: "JOB", sourceId: job.id, installationId: job.installationId, reason: message, errorClass, payload: job.payload ?? undefined } }),
  ]);
  return { action: "DEAD_LETTER" };
}

export const jobRunnerInternals = { json };
export type { IntegrationJobStatus };
