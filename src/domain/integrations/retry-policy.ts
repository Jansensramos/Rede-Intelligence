/**
 * Retry/backoff determinístico (plano 9H §11/§13). Erro permanente nunca é
 * repetido; erro retryable usa backoff exponencial com jitter e respeita
 * `Retry-After` do provider quando presente.
 */
export type RetryableErrorClass =
  | "AUTHENTICATION" | "AUTHORIZATION" | "RATE_LIMIT" | "VALIDATION" | "MAPPING"
  | "DUPLICATE" | "CONFLICT" | "NETWORK" | "PROVIDER" | "BUSINESS_RULE" | "STORAGE" | "UNKNOWN";

const PERMANENT: ReadonlySet<RetryableErrorClass> = new Set(["AUTHENTICATION", "AUTHORIZATION", "VALIDATION", "MAPPING", "DUPLICATE", "BUSINESS_RULE"]);

export function isRetryableErrorClass(errorClass: RetryableErrorClass): boolean {
  return !PERMANENT.has(errorClass);
}

export interface BackoffPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number;
  jitterRatio: number; // 0..1, fração da janela usada como jitter aleatório
}

export const DEFAULT_BACKOFF_POLICY: BackoffPolicy = { baseDelayMs: 1000, maxDelayMs: 5 * 60_000, maxAttempts: 8, jitterRatio: 0.2 };

/**
 * Delay determinístico para um dado `attempt` (1-indexado) — a parte aleatória de
 * jitter é isolada em `random` (injetável) para manter a função testável.
 */
export function calculateBackoffDelayMs(attempt: number, policy: BackoffPolicy = DEFAULT_BACKOFF_POLICY, random: () => number = Math.random): number {
  if (attempt < 1) throw new Error("A tentativa deve ser >= 1.");
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  const jitter = exponential * policy.jitterRatio * random();
  return Math.round(Math.min(policy.maxDelayMs, exponential - exponential * policy.jitterRatio / 2 + jitter));
}

export interface RetryDecisionInput {
  errorClass: RetryableErrorClass;
  attemptCount: number; // tentativas já realizadas (antes desta decisão)
  retryAfterMs?: number | null; // vindo do provider (ex.: header Retry-After)
  policy?: BackoffPolicy;
}

export type RetryDecision =
  | { action: "RETRY"; nextAttempt: number; delayMs: number }
  | { action: "DEAD_LETTER"; reason: "PERMANENT_ERROR" | "MAX_ATTEMPTS_EXCEEDED" };

export function decideRetry(input: RetryDecisionInput, random: () => number = Math.random): RetryDecision {
  const policy = input.policy ?? DEFAULT_BACKOFF_POLICY;
  if (!isRetryableErrorClass(input.errorClass)) return { action: "DEAD_LETTER", reason: "PERMANENT_ERROR" };
  const nextAttempt = input.attemptCount + 1;
  if (nextAttempt > policy.maxAttempts) return { action: "DEAD_LETTER", reason: "MAX_ATTEMPTS_EXCEEDED" };
  const delayMs = input.retryAfterMs != null && input.retryAfterMs > 0 ? Math.min(input.retryAfterMs, policy.maxDelayMs) : calculateBackoffDelayMs(nextAttempt, policy, random);
  return { action: "RETRY", nextAttempt, delayMs };
}
