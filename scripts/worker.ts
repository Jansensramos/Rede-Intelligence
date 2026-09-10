import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { DurableWorker } from "../src/application/worker/worker-runtime";
import { prisma } from "../src/infrastructure/database/prisma";
import { logger } from "../src/infrastructure/observability/logger";
import { parseRuntimeConfig } from "../src/infrastructure/config/runtime-config";
import { configurationChecks } from "../src/domain/release/local-readiness";
import { localDatabaseReleaseCheck } from "../src/application/release/local-readiness-service";
import { emitOperationalAlert } from "../src/application/observability/operational-alerts";

const positiveInt = (name: string, fallback: number) => {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} deve ser inteiro positivo.`);
  return parsed;
};
if (configurationChecks(process.env).some(check => !check.ok)) throw new Error("Worker bloqueado: configuração local ou liberação operacional pendente.");
const config = parseRuntimeConfig();
const worker = new DurableWorker({ concurrency: config.WORKER_CONCURRENCY, pollMs: config.WORKER_POLL_MS, leaseMs: config.WORKER_LEASE_MS, jobTimeoutMs: config.WORKER_JOB_TIMEOUT_MS });
let queueAccessible = false;
const healthPort = positiveInt("WORKER_HEALTH_PORT", 3002);

const server = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  if (request.url === "/health/live" || request.url === "/live") return response.end(JSON.stringify({ status: "vivo", service: "worker", activeJobs: worker.activeCount }));
  if (request.url === "/health/ready" || request.url === "/ready") {
    try { queueAccessible = await localDatabaseReleaseCheck(); } catch { queueAccessible = false; }
    response.statusCode = queueAccessible ? 200 : 503;
    return response.end(JSON.stringify({ status: queueAccessible ? "pronto" : "indisponível", service: "worker", queue: queueAccessible ? "acessível" : "indisponível", lastHeartbeatAt: worker.lastHeartbeatAt?.toISOString() ?? null }));
  }
  response.statusCode = 404; return response.end(JSON.stringify({ status: "não encontrado" }));
});

let shutdownStarted = false;
async function shutdown(signal: string) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  logger.info("Sinal de encerramento recebido.", { component: "worker", event: signal });
  worker.requestStop();
  server.close();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
async function main() {
  if (!await localDatabaseReleaseCheck()) throw new Error("Worker bloqueado: integridade das migrations pendente.");
  server.listen(healthPort, "127.0.0.1", () => logger.info("Health do worker disponível.", { component: "worker", event: "health_listening", port: healthPort }));
  await worker.run();
  await prisma.$disconnect();
}

main().catch(async (error) => {
  logger.error("Worker encerrado por falha fatal.", { component: "worker", event: "fatal", error });
  // Falha fatal do processo inteiro, não de um tenant específico — best-effort, nunca
  // atrasa o encerramento (bounded pelo timeout do transporte).
  await emitOperationalAlert({ category: "WORKER_FATAL", severity: "critical", code: error instanceof Error ? error.name : "UnknownError", organizationId: "SYSTEM", correlationId: randomUUID() }).catch(() => undefined);
  await prisma.$disconnect();
  process.exitCode = 1;
});
