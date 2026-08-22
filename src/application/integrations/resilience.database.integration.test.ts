import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { applyProviderRateLimitSignal, checkAndConsumeRateLimit, checkCircuitBreakerGate, recordCircuitBreakerOutcome } from "./resilience-service";

describe("Rate limit e circuit breaker persistidos (PostgreSQL real)", () => {
  let organizationId: string;

  beforeAll(async () => {
    const membership = await prisma.organizationMembership.findFirstOrThrow({ where: { organization: { slug: "rede-nucleo-de-negocios" } } });
    organizationId = membership.organizationId;
  });

  it("persiste o estado de rate limit entre chamadas e bloqueia ao exceder a janela", async () => {
    const scopeKey = `test:rate-limit:${randomUUID()}`;
    const policy = { limit: 2, windowMs: 60_000 };
    const now = Date.now();
    const first = await checkAndConsumeRateLimit(organizationId, scopeKey, policy, new Date(now));
    const second = await checkAndConsumeRateLimit(organizationId, scopeKey, policy, new Date(now + 1));
    const third = await checkAndConsumeRateLimit(organizationId, scopeKey, policy, new Date(now + 2));
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    const row = await prisma.integrationRateLimitState.findUniqueOrThrow({ where: { organizationId_scopeKey: { organizationId, scopeKey } } });
    expect(row.requestCount).toBe(2);
  });

  it("aplica Retry-After real de um provider (HTTP 429) sobre o estado persistido", async () => {
    const scopeKey = `test:retry-after:${randomUUID()}`;
    const now = Date.now();
    await applyProviderRateLimitSignal(organizationId, scopeKey, 5000, new Date(now));
    const decision = await checkAndConsumeRateLimit(organizationId, scopeKey, { limit: 100, windowMs: 60_000 }, new Date(now + 100));
    expect(decision.allowed).toBe(false);
  });

  it("circuit breaker abre após falhas consecutivas, bloqueia, e recupera via HALF_OPEN → CLOSED", async () => {
    const scopeKey = `test:circuit:${randomUUID()}`;
    const policy = { failureThreshold: 3, cooldownMs: 5000 };
    const t0 = Date.now();
    for (let i = 0; i < 3; i += 1) await recordCircuitBreakerOutcome(organizationId, scopeKey, false, policy, new Date(t0));
    const blocked = await checkCircuitBreakerGate(organizationId, scopeKey, policy, new Date(t0 + 10));
    expect(blocked.allow).toBe(false);

    const halfOpen = await checkCircuitBreakerGate(organizationId, scopeKey, policy, new Date(t0 + policy.cooldownMs + 10));
    expect(halfOpen.allow).toBe(true);
    const row = await prisma.integrationCircuitBreakerState.findUniqueOrThrow({ where: { organizationId_scopeKey: { organizationId, scopeKey } } });
    expect(row.status).toBe("HALF_OPEN");

    await recordCircuitBreakerOutcome(organizationId, scopeKey, true, policy, new Date(t0 + policy.cooldownMs + 20));
    const recovered = await prisma.integrationCircuitBreakerState.findUniqueOrThrow({ where: { organizationId_scopeKey: { organizationId, scopeKey } } });
    expect(recovered.status).toBe("CLOSED");
    expect(recovered.consecutiveFailures).toBe(0);
  });

  it("provider indisponível não derruba o REDE: chamadas concorrentes ficam apenas bloqueadas, nunca lançam exceção", async () => {
    const scopeKey = `test:outage:${randomUUID()}`;
    const policy = { failureThreshold: 1, cooldownMs: 60_000 };
    await recordCircuitBreakerOutcome(organizationId, scopeKey, false, policy, new Date());
    const attempts = await Promise.all([1, 2, 3].map(() => checkCircuitBreakerGate(organizationId, scopeKey, policy, new Date())));
    expect(attempts.every((item) => item.allow === false)).toBe(true);
  });
});
