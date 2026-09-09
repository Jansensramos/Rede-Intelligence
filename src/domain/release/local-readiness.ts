import { parseRuntimeConfig } from "@/infrastructure/config/runtime-config";

export const RELEASE_SCOPE = "9Q.2A_LOCAL" as const;
export const DEFERRED_GATES = ["CLOUD", "REAL_APIS", "PRODUCTION_RECOVERY", "PRODUCTION_ALERTS", "HUMAN_RELEASE_APPROVAL"] as const;
export type ReleaseCheck = { code: string; ok: boolean };
export function configurationChecks(env: Record<string, string | undefined>): ReleaseCheck[] {
  const checks: ReleaseCheck[] = [];
  try { parseRuntimeConfig(env); checks.push({ code: "RUNTIME_CONFIGURATION", ok: true }); }
  catch { checks.push({ code: "RUNTIME_CONFIGURATION", ok: false }); }
  let localDatabase = false;
  try { const u = new URL(env.DATABASE_URL ?? ""); localDatabase = ["postgresql:", "postgres:"].includes(u.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) && [...u.searchParams.keys()].every(key => ["schema", "connection_limit", "pool_timeout", "sslmode"].includes(key)); } catch { /* No values in diagnostics. */ }
  checks.push({ code: "LOCAL_DATABASE", ok: localDatabase });
  for (const key of ["SESSION_SECRET", "INTEGRATION_SECRET_KEY"] as const) checks.push({ code: key, ok: (env[key]?.length ?? 0) >= 32 });
  checks.push({ code: "LOCAL_DEPENDENCIES", ok: (env.STORAGE_PROVIDER ?? "local") === "local" && (env.SECRET_PROVIDER ?? "environment") === "environment" && (env.KMS_PROVIDER ?? "local") === "local" && (env.MALWARE_SCANNER_PROVIDER ?? "noop") === "noop" });
  checks.push({ code: "NON_PRODUCTION", ok: env.NODE_ENV !== "production" });
  return checks;
}
export function safeReleaseIdentity(env: Record<string, string | undefined>) {
  const sha = env.REDE_RELEASE_SHA;
  const build = env.REDE_BUILD_ID;
  return { commit: sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null, build: build && /^[0-9a-f]{64}$/.test(build) ? build : null };
}
export function releaseDecision(checks: ReleaseCheck[]) {
  return { scope: RELEASE_SCOPE, localReady: checks.length > 0 && checks.every(check => check.ok), productionReady: false as const, checks, deferred: DEFERRED_GATES };
}
// This checkpoint deliberately contains no way to attest external readiness.
export function productionTrafficBlocked(env: Record<string, string | undefined>) { return env.NODE_ENV === "production"; }

export const ONBOARDING_STEPS = ["ORGANIZATION", "USERS_ROLES", "FIRST_PROJECT", "INITIAL_DATA", "FIRST_FEASIBILITY", "APPROVED_BASELINE", "FIRST_EXECUTIVE_RITUAL", "LOCAL_INTEGRATION", "SUPPORT_RECOVERY", "LOCAL_ACCEPTANCE"] as const;
export type OnboardingStep = typeof ONBOARDING_STEPS[number];
export const ONBOARDING_LABELS: Record<OnboardingStep, string> = {
  ORGANIZATION: "Organização e responsáveis", USERS_ROLES: "Usuários, papéis e primeiro acesso", FIRST_PROJECT: "Primeiro empreendimento", INITIAL_DATA: "Importação e validação inicial", FIRST_FEASIBILITY: "Primeira viabilidade", APPROVED_BASELINE: "Primeira Base Aprovada", FIRST_EXECUTIVE_RITUAL: "Primeiro rito executivo", LOCAL_INTEGRATION: "Primeira integração local", SUPPORT_RECOVERY: "Suporte e recuperação", LOCAL_ACCEPTANCE: "Aceite do ensaio local",
};
