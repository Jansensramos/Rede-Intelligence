import { afterEach, describe, expect, it, vi } from "vitest";
import { emitOperationalAlert, operationalAlertCounters, resetOperationalAlertStateForTests, setOperationalAlertReporterForTests } from "./operational-alerts";
import type { ErrorReporterProvider } from "@/infrastructure/observability/providers";

function fakeReporter() {
  const capture = vi.fn<(error: unknown, context?: Record<string, unknown>) => Promise<void>>(async () => undefined);
  return { provider: { capture } as unknown as ErrorReporterProvider, capture };
}

describe("emitOperationalAlert — payload mínimo, dedup, rate limit", () => {
  afterEach(() => { setOperationalAlertReporterForTests(undefined); resetOperationalAlertStateForTests(); });

  it("payload nunca inclui o organizationId bruto, só o tenantRef em hash", async () => {
    const { provider, capture } = fakeReporter();
    setOperationalAlertReporterForTests(provider);
    await emitOperationalAlert({ category: "DEAD_LETTER", severity: "critical", code: "X", organizationId: "org-sensivel-123", correlationId: "c1" });
    const context = capture.mock.calls[0][1] as Record<string, unknown>;
    expect(JSON.stringify(context)).not.toContain("org-sensivel-123");
    expect(context.tenantRef).toMatch(/^[a-f0-9]{16}$/);
    expect(Object.keys(context).sort()).toEqual(["category", "code", "correlationId", "environment", "releaseId", "severity", "tenantRef", "timestamp"]);
  });

  it("respeita o rate limit por categoria+tenant e conta os suprimidos", async () => {
    const { provider } = fakeReporter();
    setOperationalAlertReporterForTests(provider);
    let now = 0;
    for (let i = 0; i < 10; i += 1) {
      now += 1000; // fora da janela de dedup (5 min) para cada código distinto, dentro da janela de rate limit (1 min)
      await emitOperationalAlert({ category: "QUARANTINE", severity: "warning", code: `code-${i}`, organizationId: "org-a", correlationId: `c${i}` }, () => now);
    }
    now += 1000;
    const result = await emitOperationalAlert({ category: "QUARANTINE", severity: "warning", code: "code-11th", organizationId: "org-a", correlationId: "c11" }, () => now);
    expect(result).toEqual({ emitted: false, reason: "RATE_LIMITED" });
    expect(operationalAlertCounters().suppressedByRateLimit).toBe(1);
  });

  it("reabre a janela de rate limit depois de 60s", async () => {
    const { provider, capture } = fakeReporter();
    setOperationalAlertReporterForTests(provider);
    let now = 0;
    for (let i = 0; i < 10; i += 1) { now += 1000; await emitOperationalAlert({ category: "QUARANTINE", severity: "warning", code: `code-${i}`, organizationId: "org-a", correlationId: `c${i}` }, () => now); }
    now += 61_000; // além da janela de 60s
    const result = await emitOperationalAlert({ category: "QUARANTINE", severity: "warning", code: "code-depois", organizationId: "org-a", correlationId: "c-depois" }, () => now);
    expect(result.emitted).toBe(true);
    expect(capture).toHaveBeenCalledTimes(11);
  });

  it("nunca lança mesmo sem reporter fake injetado (cai no LocalErrorReporter em ambiente não-produção)", async () => {
    const result = await emitOperationalAlert({ category: "WORKER_FATAL", severity: "critical", code: "X", organizationId: "SYSTEM", correlationId: "c1" });
    // Em ambiente de teste, ALERTING_PROVIDER=local => LocalErrorReporter é usado (não "external"),
    // então createErrorReporter() não lança — o resultado é "emitted", não "DISABLED"; o que este
    // teste comprova é que emitOperationalAlert nunca lança mesmo sem reporter fake configurado.
    expect(result.emitted).toBe(true);
  });

  // Teste oficial da janela de dedup de 5 minutos (item 8 da correção 9Q.2B) — antes só
  // verificado por sonda manual fora da suíte.
  it("deduplica o mesmo evento lógico (categoria+code+tenant) dentro da janela de 5 min, e volta a emitir depois", async () => {
    const { provider, capture } = fakeReporter();
    setOperationalAlertReporterForTests(provider);
    let now = 0;
    const first = await emitOperationalAlert({ category: "DEAD_LETTER", severity: "critical", code: "MESMO", organizationId: "org-x", correlationId: "c1" }, () => now);
    now += 4 * 60_000; // 4 min depois — ainda dentro da janela de 5 min
    const second = await emitOperationalAlert({ category: "DEAD_LETTER", severity: "critical", code: "MESMO", organizationId: "org-x", correlationId: "c2" }, () => now);
    now += 61_000; // agora em 5min01s — além da janela
    const third = await emitOperationalAlert({ category: "DEAD_LETTER", severity: "critical", code: "MESMO", organizationId: "org-x", correlationId: "c3" }, () => now);
    expect(first).toEqual({ emitted: true });
    expect(second).toEqual({ emitted: false, reason: "DEDUPLICATED" });
    expect(third).toEqual({ emitted: true });
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("dedup de 5 min não mistura categorias nem tenants diferentes — cada combinação tem sua própria janela", async () => {
    const { provider, capture } = fakeReporter();
    setOperationalAlertReporterForTests(provider);
    const now = 0;
    const sameTenantDifferentCategory = await emitOperationalAlert({ category: "DEAD_LETTER", severity: "critical", code: "X", organizationId: "org-x", correlationId: "c1" }, () => now);
    const otherCategory = await emitOperationalAlert({ category: "QUARANTINE", severity: "warning", code: "X", organizationId: "org-x", correlationId: "c2" }, () => now);
    const otherTenant = await emitOperationalAlert({ category: "DEAD_LETTER", severity: "critical", code: "X", organizationId: "org-y", correlationId: "c3" }, () => now);
    expect(sameTenantDifferentCategory.emitted).toBe(true);
    expect(otherCategory.emitted).toBe(true);
    expect(otherTenant.emitted).toBe(true);
    expect(capture).toHaveBeenCalledTimes(3);
  });

  // Decisão explícita documentada em operational-alerts.ts (item 10 da correção 9Q.2B):
  // dedup por tenant+categoria+code, não por execução/correlationId — preserva a
  // proteção anti-tempestade da 9Q.2A quando a mesma causa se repete.
  it("dedup por tenant+categoria+code, não por execução: duas importações distintas do mesmo capability dentro da janela geram só 1 alerta (decisão testada)", async () => {
    const { provider, capture } = fakeReporter();
    setOperationalAlertReporterForTests(provider);
    const now = 0;
    const run1 = await emitOperationalAlert({ category: "QUARANTINE", severity: "warning", code: "IMPORT:CONTACTS", organizationId: "org-x", correlationId: "run-1" }, () => now);
    const run2 = await emitOperationalAlert({ category: "QUARANTINE", severity: "warning", code: "IMPORT:CONTACTS", organizationId: "org-x", correlationId: "run-2" }, () => now);
    expect(run1.emitted).toBe(true);
    expect(run2).toEqual({ emitted: false, reason: "DEDUPLICATED" });
    expect(capture).toHaveBeenCalledTimes(1);
  });

  // Item 6 da correção 9Q.2B: o reporter cacheado (necessário para o circuit breaker
  // persistir entre chamadas) não deve reter um endpoint/config de uma "geração"
  // anterior depois de um reset — cada geração usa a config vigente no momento em que
  // resolveReporter() a constrói pela primeira vez.
  it("cache do reporter não mistura configurações entre gerações: reset + override troca de destino sem reter o anterior", async () => {
    const generationA = fakeReporter();
    setOperationalAlertReporterForTests(generationA.provider);
    await emitOperationalAlert({ category: "DEAD_LETTER", severity: "critical", code: "A", organizationId: "org-a", correlationId: "c1" });
    expect(generationA.capture).toHaveBeenCalledTimes(1);

    resetOperationalAlertStateForTests();
    const generationB = fakeReporter();
    setOperationalAlertReporterForTests(generationB.provider);
    await emitOperationalAlert({ category: "DEAD_LETTER", severity: "critical", code: "A", organizationId: "org-a", correlationId: "c2" });
    // A geração B não vê o histórico de dedup nem o reporter da geração A.
    expect(generationB.capture).toHaveBeenCalledTimes(1);
    expect(generationA.capture).toHaveBeenCalledTimes(1);
  });
});
