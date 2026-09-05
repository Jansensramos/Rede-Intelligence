import type { IntegrationJob } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { DurableWorker, type WorkerDependencies } from "./worker-runtime";
import { SignatureReconciliationError, type SignatureReconciliationFailureReason } from "@/domain/sales/signature-provider";
import { decideRetry, type RetryableErrorClass } from "@/domain/integrations";
import { ClicksignProviderError, ClicksignSignatureProvider, type ClicksignEvidenceFailureReason } from "@/infrastructure/adapters/signature/clicksign-signature-provider";

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
  it.each(Object.entries({
    STRUCTURE_INVALID: "VALIDATION", DOCUMENT_NOT_CLOSED: "BUSINESS_RULE", SIGNED_LINK_PENDING: "PROVIDER",
    CONTENT_HOST_FORBIDDEN: "VALIDATION", CONTENT_REDIRECTED: "VALIDATION", DOWNLOAD_UNAVAILABLE: "PROVIDER",
    PDF_INVALID: "VALIDATION", SIGNATURE_EVIDENCE_PENDING: "PROVIDER", SIGNATURE_EVIDENCE_INVALID: "VALIDATION",
    SIGNATURE_EVIDENCE_AMBIGUOUS: "VALIDATION", SIGNER_MISMATCH: "VALIDATION",
  } satisfies Record<ClicksignEvidenceFailureReason, RetryableErrorClass>))("classifica reason code real do adapter %s e remove mensagem bruta", async (reason, expectedClass) => {
    const failure = new ClicksignProviderError("CONFLICT", "corr-adapter", null, reason as ClicksignEvidenceFailureReason);
    failure.message = "raw-event signer-private person@example.test https://private.test/?token=secret";
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let claimed = false;
    const deps = dependencies({ claim: vi.fn(async () => claimed ? null : (claimed = true, job)), dispatch: vi.fn(async () => { worker.requestStop(); throw failure; }) });
    const worker = new DurableWorker({ concurrency: 1, pollMs: 1, leaseMs: 3_000 }, deps);
    try {
      await worker.run();
      expect(deps.fail).toHaveBeenCalledWith(job.id, expectedClass, `Assinatura recusada: ${reason}. Correlação: corr-adapter.`, null);
      expect(JSON.stringify(logSpy.mock.calls)).not.toMatch(/raw-event|signer-private|person@|https:|secret/);
      expect(deps.complete).not.toHaveBeenCalled();
    } finally { logSpy.mockRestore(); }
  });

  it("adapter → worker: DOCUMENT_NOT_CLOSED é permanente e correlação legada não expõe inbox no início ou falha", async () => {
    const provider = new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: "test-only" }, {
      request: async (input) => ({ status: 200, headers: { "content-type": "application/vnd.api+json" }, finalUrl: input.url, body: new TextEncoder().encode(JSON.stringify(input.url.endsWith("/documents") ? { data: [{ id: "doc-test" }] } : { data: { id: "doc-test", attributes: { status: "running" } } })) }),
    });
    const legacyJob = { ...job, correlationId: "clicksign:private-inbox-id" };
    const infoSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let claimed = false;
    const deps = dependencies({ claim: vi.fn(async () => claimed ? null : (claimed = true, legacyJob)), dispatch: vi.fn(async () => {
      try { await provider.reconcileSignatures({ externalId: "env-test", expectedExternalPartyIds: ["signer-private"] }); }
      finally { worker.requestStop(); }
    }) });
    const worker = new DurableWorker({ concurrency: 1, pollMs: 1, leaseMs: 3_000 }, deps);
    try {
      await worker.run();
      expect(deps.fail).toHaveBeenCalledWith(job.id, "BUSINESS_RULE", expect.stringContaining("DOCUMENT_NOT_CLOSED"), null);
      expect(decideRetry({ errorClass: "BUSINESS_RULE", attemptCount: 1 }).action).toBe("DEAD_LETTER");
      expect(JSON.stringify([infoSpy.mock.calls, errorSpy.mock.calls])).not.toMatch(/private-inbox-id|signer-private|env-test|doc-test|test-only/);
    } finally { infoSpy.mockRestore(); errorSpy.mockRestore(); }
  });
  it.each(Object.entries({
    LOCAL_STATE_INELIGIBLE: "BUSINESS_RULE", LOCAL_PARTY_ID_INVALID: "VALIDATION", SOURCE_INBOX_INVALID: "VALIDATION",
    PROVIDER_RECONCILIATION_UNAVAILABLE: "VALIDATION", SIGNATURE_EVIDENCE_PENDING: "PROVIDER",
    SIGNATURE_EVIDENCE_INVALID: "VALIDATION", SIGNATURE_EVIDENCE_AMBIGUOUS: "VALIDATION",
    SIGNER_MISMATCH: "VALIDATION", DOCUMENT_NOT_CLOSED: "BUSINESS_RULE",
  } satisfies Record<SignatureReconciliationFailureReason, RetryableErrorClass>))(
    "classifica explicitamente reconciliação %s, com retry somente para evidência pendente", async (reason, expectedClass) => {
      const reasonCode = reason as SignatureReconciliationFailureReason;
      const failure = new SignatureReconciliationError("PROVIDER", "corr-reconciliation", reasonCode, 2_000);
      failure.message = "raw-sensitive-event signer-private person@example.test https://private.test/?token=secret";
      const logSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      let claimed = false;
      const deps = dependencies({
        claim: vi.fn(async () => claimed ? null : (claimed = true, job)),
        dispatch: vi.fn(async () => { worker.requestStop(); throw failure; }),
      });
      const worker = new DurableWorker({ concurrency: 1, pollMs: 1, leaseMs: 3_000 }, deps);
      try {
        await worker.run();
        const safeMessage = `Reconciliação recusada: ${reasonCode}. Correlação: corr-reconciliation.`;
        if (reasonCode === "SIGNATURE_EVIDENCE_PENDING") expect(deps.fail).toHaveBeenCalledWith(job.id, expectedClass, safeMessage, 2_000);
        else expect(deps.fail).toHaveBeenCalledWith(job.id, expectedClass, safeMessage);
        expect(deps.complete).not.toHaveBeenCalled();
        expect(JSON.stringify(logSpy.mock.calls)).toContain(reasonCode);
        expect(JSON.stringify(logSpy.mock.calls)).toContain("corr-reconciliation");
        expect(JSON.stringify(logSpy.mock.calls)).not.toMatch(/raw-sensitive|signer-private|person@|https:|secret/);
        const retry = decideRetry({ errorClass: expectedClass, attemptCount: 1, retryAfterMs: 2_000 });
        expect(retry.action).toBe(reasonCode === "SIGNATURE_EVIDENCE_PENDING" ? "RETRY" : "DEAD_LETTER");
        expect(decideRetry({ errorClass: expectedClass, attemptCount: 100 }).action).toBe("DEAD_LETTER");
      } finally { logSpy.mockRestore(); }
    },
  );
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
