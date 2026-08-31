import { logger, type LogContext } from "./logger";

export interface ErrorReporterProvider { capture(error: unknown, context?: LogContext): Promise<void>; }
export interface MetricsProvider { increment(name: string, value?: number, dimensions?: Record<string, string>): void; timing(name: string, durationMs: number, dimensions?: Record<string, string>): void; }

export class LocalErrorReporter implements ErrorReporterProvider {
  async capture(error: unknown, context: LogContext = {}) { logger.error("Erro capturado pelo reporter local.", { ...context, error }); }
}
export class LocalMetricsProvider implements MetricsProvider {
  increment(name: string, value = 1, dimensions: Record<string, string> = {}) { logger.info("Métrica operacional.", { component: "metrics", event: name, value, ...dimensions }); }
  timing(name: string, durationMs: number, dimensions: Record<string, string> = {}) { logger.info("Métrica operacional de duração.", { component: "metrics", event: name, durationMs, ...dimensions }); }
}

export const errorReporter: ErrorReporterProvider = new LocalErrorReporter();
export const metrics: MetricsProvider = new LocalMetricsProvider();
