import { z } from "zod";
import { assertNotArchivedDatabase } from "../../../scripts/database-url-safety.mjs";

const environmentSchema = z.enum(["development", "test", "production"]);

const baseSchema = z.object({
  NODE_ENV: environmentSchema.default("development"),
  DATABASE_URL: z.string().min(1),
  APP_PUBLIC_URL: z.string().url().optional(),
  WEBHOOK_BASE_URL: z.string().url().optional(),
  SESSION_COOKIE_NAME: z.string().min(1).default("rede_session"),
  SESSION_SECRET: z.string().min(32).optional(),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_ROOT: z.string().min(1).optional(),
  STORAGE_BUCKET: z.string().min(1).optional(),
  STORAGE_REGION: z.string().min(1).optional(),
  STORAGE_ENDPOINT: z.string().url().optional(),
  STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  STORAGE_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false"),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  MALWARE_SCANNER_PROVIDER: z.enum(["noop", "external"]).default("noop"),
  SECRET_PROVIDER: z.enum(["environment", "external"]).default("environment"),
  KMS_PROVIDER: z.enum(["local", "external"]).default("local"),
  AWS_REGION: z.string().min(1).optional(),
  SECRETS_MANAGER_PREFIX: z.string().min(1).max(200).optional(),
  SECRETS_MANAGER_PREFLIGHT_SECRET_ID: z.string().min(1).max(512).optional(),
  KMS_KEY_ID: z.string().min(1).max(2048).optional(),
  ALERTING_PROVIDER: z.enum(["local", "external"]).default("local"),
  ALERTING_EXTERNAL_ENDPOINT: z.string().url().optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  WORKER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
  WORKER_LEASE_MS: z.coerce.number().int().min(5_000).max(900_000).default(30_000),
  WORKER_JOB_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(120_000),
});

export type RuntimeConfig = z.infer<typeof baseSchema>;

function productionIssues(config: RuntimeConfig) {
  const missing: string[] = [];
  if (!config.APP_PUBLIC_URL) missing.push("APP_PUBLIC_URL");
  if (!config.WEBHOOK_BASE_URL) missing.push("WEBHOOK_BASE_URL");
  if (!config.SESSION_SECRET) missing.push("SESSION_SECRET");
  if (config.STORAGE_PROVIDER !== "s3") missing.push("STORAGE_PROVIDER=s3");
  for (const key of ["STORAGE_BUCKET", "STORAGE_REGION", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"] as const) {
    if (!config[key]) missing.push(key);
  }
  if (config.MALWARE_SCANNER_PROVIDER === "noop") missing.push("MALWARE_SCANNER_PROVIDER");
  if (config.SECRET_PROVIDER !== "external") missing.push("SECRET_PROVIDER=external");
  if (config.KMS_PROVIDER !== "external") missing.push("KMS_PROVIDER=external");
  for (const key of ["AWS_REGION", "SECRETS_MANAGER_PREFIX", "SECRETS_MANAGER_PREFLIGHT_SECRET_ID", "KMS_KEY_ID"] as const) {
    if (!config[key]) missing.push(key);
  }
  if (config.ALERTING_PROVIDER !== "external") missing.push("ALERTING_PROVIDER=external");
  if (!config.ALERTING_EXTERNAL_ENDPOINT) missing.push("ALERTING_EXTERNAL_ENDPOINT");
  return missing;
}

export function parseRuntimeConfig(environment: Record<string, string | undefined> = process.env): RuntimeConfig {
  const result = baseSchema.safeParse(environment);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || "configuração"))];
    throw new Error(`Configuração inválida: ${names.join(", ")}. Valores não foram exibidos.`);
  }
  // Bloqueia DATABASE_URL apontando para um banco arquivado antes de qualquer outra
  // etapa de boot (web, worker, preflight) — achado Bloqueador da reauditoria 9Q.2B:
  // esta checagem antes só existia para TEST_DATABASE_URL.
  assertNotArchivedDatabase(result.data.DATABASE_URL, "DATABASE_URL");
  if (result.data.NODE_ENV === "production") {
    const missing = productionIssues(result.data);
    if (missing.length) throw new Error(`Configuração de produção incompleta: ${missing.join(", ")}. Valores não foram exibidos.`);
  }
  return result.data;
}

let cached: RuntimeConfig | undefined;
export function runtimeConfig() { return cached ??= parseRuntimeConfig(); }
export function clearRuntimeConfigCacheForTests() { cached = undefined; }
