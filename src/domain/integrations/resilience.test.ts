import { describe, expect, it } from "vitest";
import {
  applyProviderRetryAfter,
  calculateBackoffDelayMs,
  checkCircuitBreaker,
  closedCircuitBreakerState,
  decideRetry,
  emptyRateLimitState,
  evaluateRateLimit,
  isRetryableErrorClass,
  recordCircuitBreakerFailure,
  recordCircuitBreakerSuccess,
} from ".";

describe("retry/backoff determinístico", () => {
  it("classifica erro permanente e nunca repete", () => {
    expect(isRetryableErrorClass("AUTHENTICATION")).toBe(false);
    expect(isRetryableErrorClass("VALIDATION")).toBe(false);
    expect(isRetryableErrorClass("NETWORK")).toBe(true);
    expect(isRetryableErrorClass("RATE_LIMIT")).toBe(true);
    expect(decideRetry({ errorClass: "AUTHENTICATION", attemptCount: 0 })).toEqual({ action: "DEAD_LETTER", reason: "PERMANENT_ERROR" });
  });

  it("calcula backoff exponencial crescente e nunca ultrapassa o teto", () => {
    const noJitter = () => 0.5; // fixa o jitter para determinismo
    const d1 = calculateBackoffDelayMs(1, undefined, noJitter);
    const d2 = calculateBackoffDelayMs(2, undefined, noJitter);
    const d3 = calculateBackoffDelayMs(3, undefined, noJitter);
    expect(d2).toBeGreaterThan(d1);
    expect(d3).toBeGreaterThan(d2);
    const dHuge = calculateBackoffDelayMs(30, undefined, noJitter);
    expect(dHuge).toBeLessThanOrEqual(5 * 60_000);
  });

  it("respeita Retry-After do provider em vez do backoff calculado", () => {
    const decision = decideRetry({ errorClass: "RATE_LIMIT", attemptCount: 1, retryAfterMs: 12_345 });
    expect(decision).toMatchObject({ action: "RETRY", nextAttempt: 2, delayMs: 12_345 });
  });

  it("vai para dead-letter ao esgotar max attempts, mesmo sendo retryable", () => {
    const policy = { baseDelayMs: 100, maxDelayMs: 1000, maxAttempts: 3, jitterRatio: 0 };
    expect(decideRetry({ errorClass: "NETWORK", attemptCount: 3, policy })).toEqual({ action: "DEAD_LETTER", reason: "MAX_ATTEMPTS_EXCEEDED" });
  });
});

describe("rate limit local por janela fixa", () => {
  const policy = { limit: 3, windowMs: 1000 };

  it("permite até o limite e bloqueia com Retry-After explícito depois", () => {
    let state = emptyRateLimitState();
    const now = 1_000_000;
    for (let i = 0; i < 3; i += 1) {
      const decision = evaluateRateLimit(state, policy, now + i);
      expect(decision.allowed).toBe(true);
      state = decision.state;
    }
    const blocked = evaluateRateLimit(state, policy, now + 3);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.errorClass).toBe("RATE_LIMIT");
      expect(blocked.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("libera automaticamente depois que a janela expira", () => {
    let state = emptyRateLimitState();
    const now = 2_000_000;
    for (let i = 0; i < 3; i += 1) state = evaluateRateLimit(state, policy, now + i).state;
    const afterWindow = evaluateRateLimit(state, policy, now + policy.windowMs + 10);
    expect(afterWindow.allowed).toBe(true);
  });

  it("aplica blockedUntil reportado pelo provider (HTTP 429 real)", () => {
    const now = 3_000_000;
    const state = applyProviderRetryAfter(emptyRateLimitState(), 5000, now);
    const decision = evaluateRateLimit(state, policy, now + 100);
    expect(decision.allowed).toBe(false);
  });
});

describe("circuit breaker CLOSED → OPEN → HALF_OPEN → CLOSED/OPEN", () => {
  const policy = { failureThreshold: 3, cooldownMs: 10_000 };

  it("abre depois do limiar de falhas consecutivas e bloqueia novas chamadas", () => {
    let state = closedCircuitBreakerState();
    for (let i = 0; i < 3; i += 1) state = recordCircuitBreakerFailure(state, policy, 0);
    expect(state.status).toBe("OPEN");
    const decision = checkCircuitBreaker(state, policy, 100);
    expect(decision.allow).toBe(false);
  });

  it("passa para HALF_OPEN após o cooldown e permite uma sonda", () => {
    let state = closedCircuitBreakerState();
    for (let i = 0; i < 3; i += 1) state = recordCircuitBreakerFailure(state, policy, 0);
    const decision = checkCircuitBreaker(state, policy, policy.cooldownMs + 1);
    expect(decision.allow).toBe(true);
    expect(decision.state.status).toBe("HALF_OPEN");
  });

  it("recupera para CLOSED quando a sonda em HALF_OPEN tem sucesso (provider indisponível → recuperação)", () => {
    let state = closedCircuitBreakerState();
    for (let i = 0; i < 3; i += 1) state = recordCircuitBreakerFailure(state, policy, 0);
    state = checkCircuitBreaker(state, policy, policy.cooldownMs + 1).state;
    expect(state.status).toBe("HALF_OPEN");
    state = recordCircuitBreakerSuccess(state);
    expect(state).toEqual(closedCircuitBreakerState());
  });

  it("reabre imediatamente se a sonda em HALF_OPEN falhar de novo", () => {
    let state = closedCircuitBreakerState();
    for (let i = 0; i < 3; i += 1) state = recordCircuitBreakerFailure(state, policy, 0);
    state = checkCircuitBreaker(state, policy, policy.cooldownMs + 1).state;
    state = recordCircuitBreakerFailure(state, policy, policy.cooldownMs + 2);
    expect(state.status).toBe("OPEN");
  });
});
