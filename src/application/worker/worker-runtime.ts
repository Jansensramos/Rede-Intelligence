import { randomUUID } from "node:crypto";
import type { IntegrationJob } from "@prisma/client";
import { claimNextJobAcrossOrganizations, completeJob, failJob, heartbeatJob } from "@/application/integrations/job-runner";
import type { RetryableErrorClass } from "@/domain/integrations";
import { logger } from "@/infrastructure/observability/logger";
import { dispatchJob } from "./job-dispatcher";
import { ClicksignProviderError, type ClicksignEvidenceFailureReason, type ClicksignErrorClass } from "@/infrastructure/adapters/signature/clicksign-signature-provider";
import { SignatureReconciliationError, type SignatureReconciliationFailureReason } from "@/domain/sales/signature-provider";

const reconciliationJobClasses = {
  LOCAL_STATE_INELIGIBLE: "BUSINESS_RULE",
  LOCAL_PARTY_ID_INVALID: "VALIDATION",
  SOURCE_INBOX_INVALID: "VALIDATION",
  PROVIDER_RECONCILIATION_UNAVAILABLE: "VALIDATION",
  SIGNATURE_EVIDENCE_PENDING: "PROVIDER",
  SIGNATURE_EVIDENCE_INVALID: "VALIDATION",
  SIGNATURE_EVIDENCE_AMBIGUOUS: "VALIDATION",
  SIGNER_MISMATCH: "VALIDATION",
  DOCUMENT_NOT_CLOSED: "BUSINESS_RULE",
} satisfies Record<SignatureReconciliationFailureReason, RetryableErrorClass>;

const clicksignEvidenceJobClasses = {
  STRUCTURE_INVALID: "VALIDATION", DOCUMENT_NOT_CLOSED: "BUSINESS_RULE",
  SIGNED_LINK_PENDING: "PROVIDER", CONTENT_HOST_FORBIDDEN: "VALIDATION", CONTENT_REDIRECTED: "VALIDATION",
  DOWNLOAD_UNAVAILABLE: "PROVIDER", PDF_INVALID: "VALIDATION", SIGNATURE_EVIDENCE_PENDING: "PROVIDER",
  SIGNATURE_EVIDENCE_INVALID: "VALIDATION", SIGNATURE_EVIDENCE_AMBIGUOUS: "VALIDATION", SIGNER_MISMATCH: "VALIDATION",
} satisfies Record<ClicksignEvidenceFailureReason, RetryableErrorClass>;
const clicksignJobClasses = {
  AUTHENTICATION: "AUTHENTICATION", AUTHORIZATION: "AUTHORIZATION", RATE_LIMIT: "RATE_LIMIT",
  CONFLICT: "BUSINESS_RULE", VALIDATION: "VALIDATION", NOT_FOUND: "VALIDATION",
  TIMEOUT: "PROVIDER", PROVIDER: "PROVIDER", UNEXPECTED: "VALIDATION",
} satisfies Record<ClicksignErrorClass, RetryableErrorClass>;

export interface WorkerDependencies {
  claim: (owner: string, leaseMs: number) => Promise<IntegrationJob | null>;
  dispatch: (job: IntegrationJob, signal: AbortSignal) => Promise<void>;
  complete: (jobId: string, owner: string) => Promise<unknown>;
  fail: (jobId: string, errorClass: RetryableErrorClass, message: string, retryAfterMs?: number | null) => Promise<unknown>;
  heartbeat: (jobId: string, owner: string, leaseMs: number) => Promise<unknown>;
}

const defaults: WorkerDependencies = { claim: claimNextJobAcrossOrganizations, dispatch: dispatchJob, complete: completeJob, fail: failJob, heartbeat: heartbeatJob };
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const classify = (error: unknown): RetryableErrorClass => {
  if (error instanceof SignatureReconciliationError) return reconciliationJobClasses[error.reasonCode];
  if (error instanceof ClicksignProviderError) {
    return error.reasonCode === null ? clicksignJobClasses[error.errorClass] : clicksignEvidenceJobClasses[error.reasonCode];
  }
  if (error instanceof TypeError) return "NETWORK";
  if (error instanceof Error && (/^WORKER_JOB_TIMEOUT_/.test(error.message) || error.name === "AbortError")) return "PROVIDER";
  return "VALIDATION";
};

export class DurableWorker {
  readonly owner = `${process.env.COMPUTERNAME ?? "worker"}:${process.pid}:${randomUUID()}`;
  private stopping = false;
  private readonly active = new Set<Promise<void>>();
  lastHeartbeatAt: Date | null = null;

  constructor(private readonly options: { concurrency: number; pollMs: number; leaseMs: number; jobTimeoutMs?: number }, private readonly dependencies: WorkerDependencies = defaults) {}

  requestStop() { this.stopping = true; }
  get activeCount() { return this.active.size; }

  async run() {
    logger.info("Worker iniciado.", { component: "worker", event: "started" });
    while (!this.stopping) {
      this.lastHeartbeatAt = new Date();
      while (!this.stopping && this.active.size < this.options.concurrency) {
        const job = await this.dependencies.claim(this.owner, this.options.leaseMs);
        if (!job) break;
        const task = this.execute(job).finally(() => this.active.delete(task));
        this.active.add(task);
      }
      if (!this.stopping) await delay(this.options.pollMs);
    }
    await Promise.allSettled(this.active);
    logger.info("Worker encerrado com drenagem concluída.", { component: "worker", event: "stopped" });
  }

  private async execute(job: IntegrationJob) {
    const startedAt = Date.now();
    // Legacy jobs may embed inbox IDs in correlationId. Emit only a fresh opaque correlation.
    const context = { component: "worker", jobId: job.id, organizationId: job.organizationId, correlationId: randomUUID(), event: job.jobType };
    const interval = setInterval(() => void this.dependencies.heartbeat(job.id, this.owner, this.options.leaseMs), Math.max(1_000, Math.floor(this.options.leaseMs / 3)));
    try {
      logger.info("Job iniciado.", context);
      const timeoutMs = this.options.jobTimeoutMs ?? 120_000;
      const controller = new AbortController();
      let timedOut = false;
      let dispatchError: unknown;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(new Error(`WORKER_JOB_TIMEOUT_${timeoutMs}`)); }, timeoutMs);
      try {
        // Segurança deliberada: após solicitar aborto, aguardamos a promise REAL do
        // handler. Heartbeat e lease permanecem ativos. Handler não cooperativo que
        // nunca termina mantém o job RUNNING (fail closed) e nunca libera retry.
        await this.dependencies.dispatch(job, controller.signal);
      } catch (error) {
        dispatchError = error;
      } finally {
        clearTimeout(timeout);
      }
      if (timedOut) throw new Error(`WORKER_JOB_TIMEOUT_${timeoutMs}`, { cause: dispatchError });
      if (dispatchError) throw dispatchError;
      await this.dependencies.complete(job.id, this.owner);
      logger.info("Job concluído.", { ...context, durationMs: Date.now() - startedAt, status: "succeeded" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida.";
      if (error instanceof SignatureReconciliationError) {
        const safeMessage = `Reconciliação recusada: ${error.reasonCode}. Correlação: ${error.correlationId}.`;
        if (error.reasonCode === "SIGNATURE_EVIDENCE_PENDING" && error.retryAfterMs != null) await this.dependencies.fail(job.id, classify(error), safeMessage, error.retryAfterMs);
        else await this.dependencies.fail(job.id, classify(error), safeMessage);
        logger.error("Reconciliação falhou.", { ...context, correlationId: error.correlationId, reasonCode: error.reasonCode, errorClass: classify(error) });
        return;
      }
      if (error instanceof ClicksignProviderError) {
        const errorClass = classify(error);
        const safeMessage = `Assinatura recusada: ${error.reasonCode ?? error.errorClass}. Correlação: ${error.correlationId}.`;
        await this.dependencies.fail(job.id, errorClass, safeMessage, error.retryAfterMs);
        logger.error("Assinatura falhou.", { ...context, correlationId: error.correlationId, reasonCode: error.reasonCode, errorClass });
        return;
      }
      await this.dependencies.fail(job.id, classify(error), message);
      logger.error("Job falhou.", { ...context, durationMs: Date.now() - startedAt, status: "failed", errorClass: classify(error), error });
    } finally {
      clearInterval(interval);
    }
  }
}
