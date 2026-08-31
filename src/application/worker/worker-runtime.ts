import { randomUUID } from "node:crypto";
import type { IntegrationJob } from "@prisma/client";
import { claimNextJobAcrossOrganizations, completeJob, failJob, heartbeatJob } from "@/application/integrations/job-runner";
import type { RetryableErrorClass } from "@/domain/integrations";
import { logger } from "@/infrastructure/observability/logger";
import { dispatchJob } from "./job-dispatcher";

export interface WorkerDependencies {
  claim: (owner: string, leaseMs: number) => Promise<IntegrationJob | null>;
  dispatch: (job: IntegrationJob) => Promise<void>;
  complete: (jobId: string, owner: string) => Promise<unknown>;
  fail: (jobId: string, errorClass: RetryableErrorClass, message: string) => Promise<unknown>;
  heartbeat: (jobId: string, owner: string, leaseMs: number) => Promise<unknown>;
}

const defaults: WorkerDependencies = { claim: claimNextJobAcrossOrganizations, dispatch: dispatchJob, complete: completeJob, fail: failJob, heartbeat: heartbeatJob };
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const classify = (error: unknown): RetryableErrorClass => error instanceof TypeError ? "NETWORK" : "VALIDATION";

export class DurableWorker {
  readonly owner = `${process.env.COMPUTERNAME ?? "worker"}:${process.pid}:${randomUUID()}`;
  private stopping = false;
  private readonly active = new Set<Promise<void>>();
  lastHeartbeatAt: Date | null = null;

  constructor(private readonly options: { concurrency: number; pollMs: number; leaseMs: number }, private readonly dependencies: WorkerDependencies = defaults) {}

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
    const context = { component: "worker", jobId: job.id, organizationId: job.organizationId, correlationId: job.correlationId, event: job.jobType };
    const interval = setInterval(() => void this.dependencies.heartbeat(job.id, this.owner, this.options.leaseMs), Math.max(1_000, Math.floor(this.options.leaseMs / 3)));
    try {
      logger.info("Job iniciado.", context);
      await this.dependencies.dispatch(job);
      await this.dependencies.complete(job.id, this.owner);
      logger.info("Job concluído.", context);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida.";
      await this.dependencies.fail(job.id, classify(error), message);
      logger.error("Job falhou.", { ...context, errorClass: classify(error), error });
    } finally {
      clearInterval(interval);
    }
  }
}
