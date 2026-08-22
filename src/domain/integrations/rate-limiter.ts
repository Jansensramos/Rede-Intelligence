/**
 * Rate limit provider-neutral (plano 9H §12/§17): janela fixa + `blockedUntil`
 * explícito. Estado é explícito e serializável (persistido em
 * `IntegrationRateLimitState`) para funcionar entre processos/requests sem
 * depender de um serviço externo (Redis etc.).
 */
export interface RateLimitState {
  windowStartMs: number;
  requestCount: number;
  blockedUntilMs: number | null;
}

export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

export const emptyRateLimitState = (): RateLimitState => ({ windowStartMs: 0, requestCount: 0, blockedUntilMs: null });

export type RateLimitDecision =
  | { allowed: true; state: RateLimitState }
  | { allowed: false; state: RateLimitState; retryAfterMs: number; errorClass: "RATE_LIMIT" };

/**
 * Avalia se uma nova requisição é permitida em `nowMs`, dado o estado anterior.
 * Nunca lança: retorna sempre uma decisão explícita + o próximo estado a persistir.
 */
export function evaluateRateLimit(state: RateLimitState, policy: RateLimitPolicy, nowMs: number): RateLimitDecision {
  if (state.blockedUntilMs != null && nowMs < state.blockedUntilMs) {
    return { allowed: false, state, retryAfterMs: state.blockedUntilMs - nowMs, errorClass: "RATE_LIMIT" };
  }
  const windowExpired = nowMs - state.windowStartMs >= policy.windowMs;
  const windowStartMs = windowExpired ? nowMs : state.windowStartMs;
  const requestCount = windowExpired ? 1 : state.requestCount + 1;
  if (requestCount > policy.limit) {
    const retryAfterMs = policy.windowMs - (nowMs - windowStartMs);
    return { allowed: false, state: { windowStartMs, requestCount: requestCount - 1, blockedUntilMs: nowMs + retryAfterMs }, retryAfterMs, errorClass: "RATE_LIMIT" };
  }
  return { allowed: true, state: { windowStartMs, requestCount, blockedUntilMs: null } };
}

/** Aplica um `Retry-After` explícito reportado pelo provider (HTTP 429), sobrepondo o cálculo local. */
export function applyProviderRetryAfter(state: RateLimitState, retryAfterMs: number, nowMs: number): RateLimitState {
  return { ...state, blockedUntilMs: nowMs + Math.max(0, retryAfterMs) };
}
