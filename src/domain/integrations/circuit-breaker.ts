/**
 * Circuit breaker provider-neutral (plano 9H §12): CLOSED → OPEN → HALF_OPEN →
 * CLOSED/OPEN. Falha do provider nunca derruba o REDE nem apaga dado já
 * sincronizado — apenas para de tentar até o cooldown expirar.
 */
export type CircuitBreakerStatus = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerState {
  status: CircuitBreakerStatus;
  consecutiveFailures: number;
  openedAtMs: number | null;
  halfOpenProbeInFlight: boolean;
}

export interface CircuitBreakerPolicy {
  failureThreshold: number;
  cooldownMs: number;
}

export const closedCircuitBreakerState = (): CircuitBreakerState => ({ status: "CLOSED", consecutiveFailures: 0, openedAtMs: null, halfOpenProbeInFlight: false });

export type CircuitBreakerDecision = { allow: true; state: CircuitBreakerState } | { allow: false; state: CircuitBreakerState; retryAfterMs: number };

/** Decide, em `nowMs`, se uma nova chamada ao provider pode prosseguir. */
export function checkCircuitBreaker(state: CircuitBreakerState, policy: CircuitBreakerPolicy, nowMs: number): CircuitBreakerDecision {
  if (state.status === "CLOSED") return { allow: true, state };
  if (state.status === "OPEN") {
    const cooldownElapsed = state.openedAtMs != null && nowMs - state.openedAtMs >= policy.cooldownMs;
    if (!cooldownElapsed) return { allow: false, state, retryAfterMs: state.openedAtMs != null ? policy.cooldownMs - (nowMs - state.openedAtMs) : policy.cooldownMs };
    return { allow: true, state: { ...state, status: "HALF_OPEN", halfOpenProbeInFlight: true } };
  }
  // HALF_OPEN: apenas uma sonda por vez; chamadas concorrentes aguardam o resultado da sonda.
  if (state.halfOpenProbeInFlight) return { allow: false, state, retryAfterMs: policy.cooldownMs };
  return { allow: true, state: { ...state, halfOpenProbeInFlight: true } };
}

/** Registra sucesso: fecha o circuito e zera falhas — recuperação explícita, nunca silenciosa. */
export function recordCircuitBreakerSuccess(state: CircuitBreakerState): CircuitBreakerState {
  void state; // sucesso sempre fecha o circuito, independentemente do estado anterior
  return closedCircuitBreakerState();
}

/** Registra falha: abre o circuito ao atingir o limiar (a partir de CLOSED) ou imediatamente ao falhar em HALF_OPEN. */
export function recordCircuitBreakerFailure(state: CircuitBreakerState, policy: CircuitBreakerPolicy, nowMs: number): CircuitBreakerState {
  if (state.status === "HALF_OPEN") return { status: "OPEN", consecutiveFailures: state.consecutiveFailures + 1, openedAtMs: nowMs, halfOpenProbeInFlight: false };
  const consecutiveFailures = state.consecutiveFailures + 1;
  if (consecutiveFailures >= policy.failureThreshold) return { status: "OPEN", consecutiveFailures, openedAtMs: nowMs, halfOpenProbeInFlight: false };
  return { status: "CLOSED", consecutiveFailures, openedAtMs: null, halfOpenProbeInFlight: false };
}
