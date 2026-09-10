import { createHash } from "node:crypto";
import { createErrorReporter } from "@/infrastructure/observability/alert-dispatcher";
import { logger } from "@/infrastructure/observability/logger";
import { safeReleaseIdentity } from "@/domain/release/local-readiness";
import type { ErrorReporterProvider } from "@/infrastructure/observability/providers";

/**
 * Instrumentação produtiva mínima e explícita do alerting (achado A1 da correção
 * 9Q.2B): dispara exatamente nas transições persistidas que já significam "alguém
 * precisa saber agora" — dead-letter definitivo, quarentena definitiva, falha fatal
 * do worker — nunca em toda exceção genérica, e nunca dentro de rota de readiness
 * (que é consultada a cada poll de health check).
 */
export type AlertCategory = "DEAD_LETTER" | "QUARANTINE" | "WORKER_FATAL";

export interface OperationalAlertEvent {
  category: AlertCategory;
  severity: "critical" | "warning";
  /** Código curto do evento (ex.: jobType, errorClass) — nunca o payload bruto. */
  code: string;
  organizationId: string;
  correlationId: string;
}

const DEDUP_WINDOW_MS = 5 * 60_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_WINDOW = 10;

const recentlyEmitted = new Map<string, number>();
const rateLimitWindows = new Map<string, { windowStart: number; count: number }>();
let suppressedByDedup = 0;
let suppressedByRateLimit = 0;
let transportFailures = 0;

function tenantRef(organizationId: string) {
  return createHash("sha256").update(organizationId).digest("hex").slice(0, 16);
}

function withinWindow(map: Map<string, number>, key: string, nowMs: number, windowMs: number): boolean {
  const last = map.get(key);
  return last !== undefined && nowMs - last < windowMs;
}

let reporterOverride: ErrorReporterProvider | undefined;
/** Só para teste: injeta um reporter fake em vez de resolver via `createErrorReporter()`. */
export function setOperationalAlertReporterForTests(reporter: ErrorReporterProvider | undefined) { reporterOverride = reporter; }
export function resetOperationalAlertStateForTests() {
  recentlyEmitted.clear(); rateLimitWindows.clear(); cachedReporter = undefined;
  suppressedByDedup = 0; suppressedByRateLimit = 0; transportFailures = 0;
}
export function operationalAlertCounters() { return { suppressedByDedup, suppressedByRateLimit, transportFailures }; }

// Cacheado: o circuit breaker do transporte (estado em memória) só protege de fato se
// a mesma instância for reutilizada entre chamadas de `emitOperationalAlert` — criar uma
// instância nova a cada alerta (como `createErrorReporter()` faz sozinho) zeraria o
// estado do circuito a cada chamada e o breaker nunca abriria de verdade.
let cachedReporter: ErrorReporterProvider | undefined;

function resolveReporter(): ErrorReporterProvider | undefined {
  if (reporterOverride) return reporterOverride;
  if (cachedReporter) return cachedReporter;
  try { return (cachedReporter = createErrorReporter()); }
  catch {
    // ALERTING_PROVIDER=local fora de produção, ou não configurado: nenhum transporte
    // externo é chamado — comportamento esperado, não um erro a propagar.
    return undefined;
  }
}

/**
 * Emite (no máximo) um alerta por evento equivalente dentro da janela de dedup, e no
 * máximo `RATE_LIMIT_MAX_PER_WINDOW` por categoria+tenant por minuto. Nunca lança —
 * chamar isto nunca pode desfazer ou atrasar indefinidamente a transação que já foi
 * persistida; falha de transporte é registrada de forma sanitizada e contabilizada.
 */
export async function emitOperationalAlert(event: OperationalAlertEvent, now: () => number = Date.now): Promise<{ emitted: boolean; reason?: "DEDUPLICATED" | "RATE_LIMITED" | "DISABLED" | "TRANSPORT_FAILED" }> {
  const reporter = resolveReporter();
  if (!reporter) return { emitted: false, reason: "DISABLED" };

  const ref = tenantRef(event.organizationId);
  const nowMs = now();
  // Decisão explícita (reauditoria 9Q.2B, item 10): a chave de dedup é
  // tenant+categoria+code — NÃO inclui a execução/correlationId. Duas falhas de
  // importação genuinamente distintas para o mesmo tenant+capability dentro da janela
  // de 5 min são deliberadamente tratadas como o mesmo "evento lógico" e geram um único
  // alerta — é a proteção anti-tempestade (import-service.ts já limita a 1 alerta por
  // importação, não por linha; isto evita empilhar um alerta por importação repetida
  // com a mesma causa). Testado explicitamente em
  // `operational-alerts.test.ts` ("dedup por tenant+categoria+code, não por execução").
  const dedupKey = `${event.category}:${event.code}:${ref}`;
  if (withinWindow(recentlyEmitted, dedupKey, nowMs, DEDUP_WINDOW_MS)) { suppressedByDedup += 1; return { emitted: false, reason: "DEDUPLICATED" }; }

  const rateKey = `${event.category}:${ref}`;
  const window = rateLimitWindows.get(rateKey);
  if (window && nowMs - window.windowStart < RATE_LIMIT_WINDOW_MS) {
    if (window.count >= RATE_LIMIT_MAX_PER_WINDOW) { suppressedByRateLimit += 1; return { emitted: false, reason: "RATE_LIMITED" }; }
    window.count += 1;
  } else {
    rateLimitWindows.set(rateKey, { windowStart: nowMs, count: 1 });
  }
  recentlyEmitted.set(dedupKey, nowMs);

  const identity = safeReleaseIdentity(process.env);
  const payload = {
    category: event.category,
    severity: event.severity,
    timestamp: new Date(nowMs).toISOString(),
    correlationId: event.correlationId,
    tenantRef: ref,
    code: event.code,
    environment: process.env.NODE_ENV ?? "unknown",
    releaseId: identity.commit ?? "unknown",
  };
  try {
    await reporter.capture(new Error(`Alerta operacional: ${event.category}`), payload);
    return { emitted: true };
  } catch (error) {
    transportFailures += 1;
    logger.error("Falha ao entregar alerta operacional; a transação de origem já estava persistida e não é desfeita.", {
      component: "operational-alerts",
      event: event.category,
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    return { emitted: false, reason: "TRANSPORT_FAILED" };
  }
}
