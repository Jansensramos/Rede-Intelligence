import type { IntegrationJob } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { DurableWorker, type WorkerDependencies } from "./worker-runtime";

const job = { id: "job-1", organizationId: "org-1", installationId: null, jobType: "TEST", priority: "NORMAL", status: "RUNNING", payload: {}, attemptCount: 1, maxAttempts: 3, leaseOwner: "owner", leaseExpiresAt: new Date(), scheduledAt: new Date(), startedAt: new Date(), finishedAt: null, lastError: null, correlationId: "corr-1", createdAt: new Date() } as IntegrationJob;

function dependencies(overrides: Partial<WorkerDependencies> = {}): WorkerDependencies {
  return {
    claim: vi.fn(async () => null), dispatch: vi.fn(async () => undefined), complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined), heartbeat: vi.fn(async () => undefined), ...overrides,
  };
}

describe("worker durável", () => {
  it("reivindica, executa e completa uma única vez, drenando no shutdown", async () => {
    let claimed = false;
    const holder: { worker?: DurableWorker } = {};
    const deps = dependencies({
      claim: vi.fn(async () => claimed ? null : (claimed = true, job)),
      dispatch: vi.fn(async () => { holder.worker!.requestStop(); }),
    });
    const worker = new DurableWorker({ concurrency: 1, pollMs: 1, leaseMs: 3_000 }, deps);
    holder.worker = worker;
    await worker.run();
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.complete).toHaveBeenCalledTimes(1);
    expect(deps.fail).not.toHaveBeenCalled();
    expect(worker.activeCount).toBe(0);
  });

  it("registra falha e não completa quando o handler falha", async () => {
    let claimed = false;
    const holder: { worker?: DurableWorker } = {};
    const deps = dependencies({
      claim: vi.fn(async () => claimed ? null : (claimed = true, job)),
      dispatch: vi.fn(async () => { holder.worker!.requestStop(); throw new Error("payload inválido"); }),
    });
    const worker = new DurableWorker({ concurrency: 1, pollMs: 1, leaseMs: 3_000 }, deps);
    holder.worker = worker;
    await worker.run();
    expect(deps.fail).toHaveBeenCalledTimes(1);
    expect(deps.complete).not.toHaveBeenCalled();
  });
});
