import type { IntegrationJob } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { DriveError } from "@/infrastructure/adapters/drive/google-drive";
import { DurableWorker, type WorkerDependencies } from "./worker-runtime";
import { decideRetry } from "@/domain/integrations";

describe("Google Drive worker boundary", () => {
  it.each(["AUTHENTICATION", "AUTHORIZATION", "VALIDATION", "RATE_LIMIT", "PROVIDER", "NETWORK"] as const)("classifies %s without losing correlation or retry delay", async errorClass => {
    const error = new DriveError(errorClass, "CONTROLLED_FAILURE", errorClass === "RATE_LIMIT" ? 10_000 : null);
    const job = { id: "drive-job", organizationId: "drive-org", jobType: "SYNC_INSTALLATION", correlationId: "legacy", payload: {} } as IntegrationJob;
    let claimed = false;
    const deps: WorkerDependencies = { claim: vi.fn(async () => claimed ? null : (claimed = true, job)), dispatch: vi.fn(async () => { worker.requestStop(); throw error; }), complete: vi.fn(), fail: vi.fn(), heartbeat: vi.fn() };
    const worker = new DurableWorker({ concurrency: 1, pollMs: 1, leaseMs: 3000 }, deps);
    await worker.run();
    expect(deps.fail).toHaveBeenCalledWith(job.id, errorClass, `CONTROLLED_FAILURE; correlation=${error.correlationId}`, error.retryAfterMs);
    expect(deps.complete).not.toHaveBeenCalled();
    expect(decideRetry({ errorClass, attemptCount: 1 }).action).toBe(["AUTHENTICATION", "AUTHORIZATION", "VALIDATION"].includes(errorClass) ? "DEAD_LETTER" : "RETRY");
  });
});
