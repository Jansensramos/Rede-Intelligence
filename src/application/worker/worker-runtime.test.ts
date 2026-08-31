import type { IntegrationJob } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { DurableWorker, type WorkerDependencies } from "./worker-runtime";

const job = { id: "job-1", organizationId: "org-1", installationId: null, jobType: "TEST", priority: "NORMAL", status: "RUNNING", payload: {}, attemptCount: 1, maxAttempts: 3, leaseOwner: "owner", leaseExpiresAt: new Date(), scheduledAt: new Date(), startedAt: new Date(), finishedAt: null, lastError: null, correlationId: "corr-1", createdAt: new Date() } as IntegrationJob;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(assertion: () => boolean, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (!assertion()) { if (Date.now() >= deadline) throw new Error("Tempo esgotado aguardando condição do teste."); await sleep(2); }
}

function dependencies(overrides: Partial<WorkerDependencies> = {}): WorkerDependencies {
  return {
    claim: vi.fn(async () => null), dispatch: vi.fn(async () => undefined), complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined), heartbeat: vi.fn(async () => undefined), ...overrides,
  };
}

describe("worker durável", () => {
  it("mantém lease e não libera retry enquanto handler não cooperativo segue vivo", async () => {
    let claimed = false; let release!: () => void;
    const deps = dependencies({
      claim: vi.fn(async () => claimed ? null : (claimed = true, job)),
      dispatch: vi.fn(async () => new Promise<void>((resolve) => { release = resolve; })),
    });
    const worker = new DurableWorker({ concurrency: 1, pollMs: 1, leaseMs: 3_000, jobTimeoutMs: 20 }, deps);
    const running = worker.run();
    await waitFor(() => worker.activeCount === 1 && Boolean(release));
    await sleep(45);
    expect(deps.fail).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.claim).toHaveBeenCalledTimes(1);
    worker.requestStop(); release(); await running;
    expect(deps.fail).toHaveBeenCalledTimes(1);
    expect(deps.fail).toHaveBeenCalledWith(job.id, "PROVIDER", expect.stringMatching(/^WORKER_JOB_TIMEOUT_/));
  });

  it("solicita aborto e só falha depois que o handler confirma término", async () => {
    let claimed = false; let handlerSettled = false;
    const holder: { worker?: DurableWorker } = {};
    const deps = dependencies({
      claim: vi.fn(async () => claimed ? null : (claimed = true, job)),
      dispatch: vi.fn(async (_job, signal) => new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => { handlerSettled = true; holder.worker!.requestStop(); reject(signal.reason); }, { once: true }))),
      fail: vi.fn(async () => { expect(handlerSettled).toBe(true); }),
    });
    const worker = new DurableWorker({ concurrency: 1, pollMs: 1, leaseMs: 3_000, jobTimeoutMs: 20 }, deps); holder.worker = worker;
    await worker.run();
    expect(deps.fail).toHaveBeenCalledTimes(1);
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it("retry posterior não sobrepõe execução nem duplica efeito", async () => {
    let claims = 0; let dispatches = 0; let activeEffects = 0; let maxActiveEffects = 0; let effects = 0;
    const holder: { worker?: DurableWorker } = {};
    const deps = dependencies({
      claim: vi.fn(async () => claims++ < 2 ? job : null),
      dispatch: vi.fn(async (_job, signal) => {
        dispatches += 1; activeEffects += 1; maxActiveEffects = Math.max(maxActiveEffects, activeEffects);
        try {
          if (dispatches === 1) await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
          else { effects += 1; holder.worker!.requestStop(); }
        } finally { activeEffects -= 1; }
      }),
    });
    const worker = new DurableWorker({ concurrency: 1, pollMs: 1, leaseMs: 3_000, jobTimeoutMs: 20 }, deps); holder.worker = worker;
    await worker.run();
    expect(dispatches).toBe(2); expect(maxActiveEffects).toBe(1); expect(effects).toBe(1);
    expect(deps.fail).toHaveBeenCalledTimes(1); expect(deps.complete).toHaveBeenCalledTimes(1);
  });

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

  it("renova heartbeat/lease durante execução normal longa", async () => {
    let claimed = false; const holder: { worker?: DurableWorker } = {};
    const deps = dependencies({
      claim: vi.fn(async () => claimed ? null : (claimed = true, job)),
      dispatch: vi.fn(async () => { await sleep(1_050); holder.worker!.requestStop(); }),
    });
    const worker = new DurableWorker({ concurrency: 1, pollMs: 1, leaseMs: 3_000, jobTimeoutMs: 2_000 }, deps); holder.worker = worker;
    await worker.run();
    expect(deps.heartbeat).toHaveBeenCalled(); expect(deps.complete).toHaveBeenCalledTimes(1); expect(deps.fail).not.toHaveBeenCalled();
  });
});
