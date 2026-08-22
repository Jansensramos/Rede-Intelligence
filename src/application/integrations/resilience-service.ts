import { prisma } from "@/infrastructure/database/prisma";
import {
  applyProviderRetryAfter,
  checkCircuitBreaker,
  closedCircuitBreakerState,
  emptyRateLimitState,
  evaluateRateLimit,
  recordCircuitBreakerFailure,
  recordCircuitBreakerSuccess,
  type CircuitBreakerPolicy,
  type CircuitBreakerState,
  type RateLimitPolicy,
  type RateLimitState,
} from "@/domain/integrations";

function rateLimitStateFromRow(row: { windowStart: Date; requestCount: number; blockedUntil: Date | null } | null): RateLimitState {
  if (!row) return emptyRateLimitState();
  return { windowStartMs: row.windowStart.getTime(), requestCount: row.requestCount, blockedUntilMs: row.blockedUntil?.getTime() ?? null };
}

async function persistRateLimitState(organizationId: string, scopeKey: string, state: RateLimitState) {
  await prisma.integrationRateLimitState.upsert({
    where: { organizationId_scopeKey: { organizationId, scopeKey } },
    update: { windowStart: new Date(state.windowStartMs), requestCount: state.requestCount, blockedUntil: state.blockedUntilMs ? new Date(state.blockedUntilMs) : null },
    create: { organizationId, scopeKey, windowStart: new Date(state.windowStartMs), requestCount: state.requestCount, blockedUntil: state.blockedUntilMs ? new Date(state.blockedUntilMs) : null },
  });
}

/** Avalia e consome uma unidade de rate limit local persistido (plano §12/§17), por escopo (provider/installation/apiClient/capability). */
export async function checkAndConsumeRateLimit(organizationId: string, scopeKey: string, policy: RateLimitPolicy, now = new Date()) {
  const row = await prisma.integrationRateLimitState.findUnique({ where: { organizationId_scopeKey: { organizationId, scopeKey } } });
  const decision = evaluateRateLimit(rateLimitStateFromRow(row), policy, now.getTime());
  await persistRateLimitState(organizationId, scopeKey, decision.state);
  return decision;
}

/** Aplica um `Retry-After` real reportado por um provider externo (HTTP 429), sobrepondo o cálculo local. */
export async function applyProviderRateLimitSignal(organizationId: string, scopeKey: string, retryAfterMs: number, now = new Date()) {
  const row = await prisma.integrationRateLimitState.findUnique({ where: { organizationId_scopeKey: { organizationId, scopeKey } } });
  const next = applyProviderRetryAfter(rateLimitStateFromRow(row), retryAfterMs, now.getTime());
  await persistRateLimitState(organizationId, scopeKey, next);
  return next;
}

function circuitBreakerStateFromRow(row: { status: "CLOSED" | "OPEN" | "HALF_OPEN"; consecutiveFailures: number; openedAt: Date | null; halfOpenProbeInFlight: boolean } | null): CircuitBreakerState {
  if (!row) return closedCircuitBreakerState();
  return { status: row.status, consecutiveFailures: row.consecutiveFailures, openedAtMs: row.openedAt?.getTime() ?? null, halfOpenProbeInFlight: row.halfOpenProbeInFlight };
}

async function persistCircuitBreakerState(organizationId: string, scopeKey: string, state: CircuitBreakerState) {
  await prisma.integrationCircuitBreakerState.upsert({
    where: { organizationId_scopeKey: { organizationId, scopeKey } },
    update: { status: state.status, consecutiveFailures: state.consecutiveFailures, openedAt: state.openedAtMs ? new Date(state.openedAtMs) : null, halfOpenProbeInFlight: state.halfOpenProbeInFlight },
    create: { organizationId, scopeKey, status: state.status, consecutiveFailures: state.consecutiveFailures, openedAt: state.openedAtMs ? new Date(state.openedAtMs) : null, halfOpenProbeInFlight: state.halfOpenProbeInFlight },
  });
}

/** Decide, com o estado persistido, se uma chamada ao provider identificado por `scopeKey` pode prosseguir agora. */
export async function checkCircuitBreakerGate(organizationId: string, scopeKey: string, policy: CircuitBreakerPolicy, now = new Date()) {
  const row = await prisma.integrationCircuitBreakerState.findUnique({ where: { organizationId_scopeKey: { organizationId, scopeKey } } });
  const decision = checkCircuitBreaker(circuitBreakerStateFromRow(row), policy, now.getTime());
  await persistCircuitBreakerState(organizationId, scopeKey, decision.state);
  return decision;
}

/** Registra o resultado (sucesso/falha) de uma chamada real ao provider, atualizando o circuito. */
export async function recordCircuitBreakerOutcome(organizationId: string, scopeKey: string, success: boolean, policy: CircuitBreakerPolicy, now = new Date()) {
  const row = await prisma.integrationCircuitBreakerState.findUnique({ where: { organizationId_scopeKey: { organizationId, scopeKey } } });
  const state = circuitBreakerStateFromRow(row);
  const next = success ? recordCircuitBreakerSuccess(state) : recordCircuitBreakerFailure(state, policy, now.getTime());
  await persistCircuitBreakerState(organizationId, scopeKey, next);
  return next;
}
