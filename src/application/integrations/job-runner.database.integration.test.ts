import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { claimNextJob, completeJob, enqueueJob, failJob } from "./job-runner";
import { operationalAlertCounters, resetOperationalAlertStateForTests, setOperationalAlertReporterForTests } from "@/application/observability/operational-alerts";
import type { ErrorReporterProvider } from "@/infrastructure/observability/providers";

describe("Job execution boundary (PostgreSQL real, FOR UPDATE SKIP LOCKED)", () => {
  let organizationId: string;

  beforeAll(async () => {
    const membership = await prisma.organizationMembership.findFirstOrThrow({ where: { organization: { slug: "rede-nucleo-de-negocios" } } });
    organizationId = membership.organizationId;
    // Isolamento: `claimNextJob` não filtra por jobType (um worker real consome qualquer tipo),
    // então jobs QUEUED deixados por outras suítes (ex.: SYNC_INSTALLATION da API v1) ou por uma
    // execução anterior interrompida competiriam pelo claim. A fila é efêmera — limpar é seguro.
    await prisma.integrationJob.deleteMany({ where: { organizationId } });
  });

  it("enfileira, reivindica e completa um job (claim → execute → complete)", async () => {
    const job = await enqueueJob({ organizationId, jobType: "TEST_JOB", payload: { demo: true } });
    const claimed = await claimNextJob(organizationId, "worker-a");
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.status).toBe("RUNNING");
    expect(claimed?.attemptCount).toBe(1);
    await completeJob(job.id);
    const finished = await prisma.integrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(finished.status).toBe("SUCCEEDED");
    expect(finished.finishedAt).not.toBeNull();
  });

  it("concorrência segura: dois workers reivindicando ao mesmo tempo nunca pegam o mesmo job", async () => {
    const correlationId = randomUUID();
    await enqueueJob({ organizationId, jobType: "TEST_JOB_CONCURRENCY", payload: {}, correlationId });
    const [a, b] = await Promise.all([claimNextJob(organizationId, "worker-a"), claimNextJob(organizationId, "worker-b")]);
    const claimedIds = [a?.id, b?.id].filter(Boolean);
    expect(new Set(claimedIds).size).toBe(claimedIds.length); // nunca o mesmo id nos dois
    expect(claimedIds).toHaveLength(1); // só havia um job disponível
  });

  it("falha retryable volta para QUEUED com backoff, incrementando a tentativa", async () => {
    const job = await enqueueJob({ organizationId, jobType: "TEST_JOB_RETRY", payload: {}, maxAttempts: 5 });
    await claimNextJob(organizationId, "worker-a");
    const outcome = await failJob(job.id, "NETWORK", "timeout simulado");
    expect(outcome.action).toBe("RETRY");
    const row = await prisma.integrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("QUEUED");
    expect(row.scheduledAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.lastError).toContain("timeout");
  });

  it("erro permanente vai direto para DEAD_LETTER e preserva o job para diagnóstico (nunca some)", async () => {
    const job = await enqueueJob({ organizationId, jobType: "TEST_JOB_PERMANENT", payload: { x: 1 } });
    await claimNextJob(organizationId, "worker-a");
    const outcome = await failJob(job.id, "AUTHENTICATION", "credencial inválida");
    expect(outcome.action).toBe("DEAD_LETTER");
    const row = await prisma.integrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("DEAD_LETTER");
    const deadLetter = await prisma.integrationDeadLetter.findFirstOrThrow({ where: { sourceType: "JOB", sourceId: job.id } });
    expect(deadLetter.errorClass).toBe("AUTHENTICATION");
  });

  it("esgota max attempts e também vai para DEAD_LETTER mesmo sendo erro retryable", async () => {
    const job = await enqueueJob({ organizationId, jobType: "TEST_JOB_MAX_ATTEMPTS", payload: {}, maxAttempts: 1 });
    await claimNextJob(organizationId, "worker-a"); // attemptCount vira 1
    const outcome = await failJob(job.id, "NETWORK", "esgotado");
    expect(outcome.action).toBe("DEAD_LETTER");
  });

  it("recupera um job travado com lease expirada (worker morto) sem perder o trabalho", async () => {
    const job = await enqueueJob({ organizationId, jobType: "TEST_JOB_STALE_LEASE", payload: {} });
    await claimNextJob(organizationId, "worker-crashed", -1); // lease já expirada (duração negativa)
    const reclaimed = await claimNextJob(organizationId, "worker-b", 30_000);
    expect(reclaimed?.id).toBe(job.id);
    expect(reclaimed?.attemptCount).toBe(2); // reivindicado duas vezes: worker morto + recuperação
  });

  describe("alerta operacional em dead-letter (call site produtivo, achado A1 da correção 9Q.2B)", () => {
    afterEach(() => { setOperationalAlertReporterForTests(undefined); resetOperationalAlertStateForTests(); });

    it("dead-letter definitivo emite exatamente um alerta, depois do commit", async () => {
      const capture = vi.fn<(error: unknown, context?: Record<string, unknown>) => Promise<void>>(async () => undefined);
      setOperationalAlertReporterForTests({ capture } as unknown as ErrorReporterProvider);
      const job = await enqueueJob({ organizationId, jobType: "TEST_JOB_ALERT", payload: {} });
      await claimNextJob(organizationId, "worker-a");
      const outcome = await failJob(job.id, "AUTHENTICATION", "credencial inválida");
      expect(outcome.action).toBe("DEAD_LETTER");
      expect(capture).toHaveBeenCalledOnce();
      const [, context] = capture.mock.calls[0];
      expect(context).toMatchObject({ category: "DEAD_LETTER", severity: "critical" });
      // Nenhum ID bruto desnecessário nem PII: só a referência de tenant em hash.
      expect(context).not.toHaveProperty("organizationId");
      expect((context as unknown as { tenantRef: string }).tenantRef).not.toBe(organizationId);
      expect((context as unknown as { tenantRef: string }).tenantRef).toMatch(/^[a-f0-9]{16}$/);
    });

    it("retry intermediário (não terminal) não emite alerta", async () => {
      const capture = vi.fn<(error: unknown, context?: Record<string, unknown>) => Promise<void>>(async () => undefined);
      setOperationalAlertReporterForTests({ capture } as unknown as ErrorReporterProvider);
      const job = await enqueueJob({ organizationId, jobType: "TEST_JOB_ALERT_RETRY", payload: {}, maxAttempts: 5 });
      await claimNextJob(organizationId, "worker-a");
      const outcome = await failJob(job.id, "NETWORK", "timeout simulado");
      expect(outcome.action).toBe("RETRY");
      expect(capture).not.toHaveBeenCalled();
    });

    it("sucesso não emite alerta", async () => {
      const capture = vi.fn<(error: unknown, context?: Record<string, unknown>) => Promise<void>>(async () => undefined);
      setOperationalAlertReporterForTests({ capture } as unknown as ErrorReporterProvider);
      const job = await enqueueJob({ organizationId, jobType: "TEST_JOB_ALERT_SUCCESS", payload: {} });
      await claimNextJob(organizationId, "worker-a");
      await completeJob(job.id);
      expect(capture).not.toHaveBeenCalled();
    });

    it("repetição equivalente dentro da janela de dedup não duplica o alerta", async () => {
      const capture = vi.fn<(error: unknown, context?: Record<string, unknown>) => Promise<void>>(async () => undefined);
      setOperationalAlertReporterForTests({ capture } as unknown as ErrorReporterProvider);
      const jobA = await enqueueJob({ organizationId, jobType: "TEST_JOB_DEDUP", payload: {} });
      await claimNextJob(organizationId, "worker-a");
      await failJob(jobA.id, "AUTHENTICATION", "credencial inválida");
      const jobB = await enqueueJob({ organizationId, jobType: "TEST_JOB_DEDUP", payload: {} });
      await claimNextJob(organizationId, "worker-a");
      await failJob(jobB.id, "AUTHENTICATION", "credencial inválida");
      expect(capture).toHaveBeenCalledOnce();
      expect(operationalAlertCounters().suppressedByDedup).toBeGreaterThanOrEqual(1);
    });

    it("tenants diferentes não compartilham a deduplicação", async () => {
      const capture = vi.fn<(error: unknown, context?: Record<string, unknown>) => Promise<void>>(async () => undefined);
      setOperationalAlertReporterForTests({ capture } as unknown as ErrorReporterProvider);
      const otherMembership = await prisma.organizationMembership.findFirstOrThrow({ where: { organizationId: { not: organizationId }, isActive: true } });
      const jobA = await enqueueJob({ organizationId, jobType: "TEST_JOB_TENANT_DEDUP", payload: {} });
      await claimNextJob(organizationId, "worker-a");
      await failJob(jobA.id, "AUTHENTICATION", "credencial inválida");
      const jobB = await enqueueJob({ organizationId: otherMembership.organizationId, jobType: "TEST_JOB_TENANT_DEDUP", payload: {} });
      await claimNextJob(otherMembership.organizationId, "worker-a");
      await failJob(jobB.id, "AUTHENTICATION", "credencial inválida");
      expect(capture).toHaveBeenCalledTimes(2);
    });

    it("falha do transporte de alerta não reverte o dead-letter já persistido, e é contabilizada", async () => {
      const capture = vi.fn<(error: unknown, context?: Record<string, unknown>) => Promise<void>>(async () => { throw new Error("destino de alerta indisponível"); });
      setOperationalAlertReporterForTests({ capture } as unknown as ErrorReporterProvider);
      const job = await enqueueJob({ organizationId, jobType: "TEST_JOB_ALERT_TRANSPORT_FAILS", payload: {} });
      await claimNextJob(organizationId, "worker-a");
      const outcome = await failJob(job.id, "AUTHENTICATION", "credencial inválida");
      expect(outcome.action).toBe("DEAD_LETTER"); // não lançou, não reverteu
      const row = await prisma.integrationJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(row.status).toBe("DEAD_LETTER");
      expect(operationalAlertCounters().transportFailures).toBeGreaterThanOrEqual(1);
    });

    it("provider local/disabled não chama nenhum transporte", async () => {
      setOperationalAlertReporterForTests(undefined); // força resolveReporter() a decidir sozinho (ambiente de teste => local/disabled)
      const job = await enqueueJob({ organizationId, jobType: "TEST_JOB_ALERT_DISABLED", payload: {} });
      await claimNextJob(organizationId, "worker-a");
      const outcome = await failJob(job.id, "AUTHENTICATION", "credencial inválida");
      expect(outcome.action).toBe("DEAD_LETTER"); // continua funcionando sem alerting configurado
    });
  });
});
