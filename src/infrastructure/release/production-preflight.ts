import { randomUUID } from "node:crypto";
import type { RuntimeConfig } from "@/infrastructure/config/runtime-config";
import { parseRuntimeConfig } from "@/infrastructure/config/runtime-config";
import { prisma } from "@/infrastructure/database/prisma";
import { logger } from "@/infrastructure/observability/logger";
import {
  classifyProductionDependencyFailure,
  ProductionDependencyError,
  type ProductionDependencyFailureKind,
} from "@/infrastructure/security/production-dependency-error";
import { createKmsProvider, createSecretProvider } from "@/infrastructure/security/secret-provider";
import { storageProvider } from "@/infrastructure/storage/storage-provider";
import { createMalwareScanner } from "@/infrastructure/storage/upload-policy";

export type PreflightFailureKind = ProductionDependencyFailureKind;
export interface ProductionDependencyDiagnostic {
  service: string;
  kind: ProductionDependencyFailureKind;
  errorClass: string;
}
export interface ProductionPreflightResult {
  ok: boolean;
  correlationId: string;
  configurationErrors: string[];
  unavailableServices: string[];
  checkedServices: string[];
  dependencyFailures: ProductionDependencyDiagnostic[];
}

export interface ProductionPreflightDependencies {
  database(): Promise<void>;
  storage(): Promise<void>;
  secretManager(config: RuntimeConfig): Promise<void>;
  kms(config: RuntimeConfig): Promise<void>;
  malwareScanner(): Promise<void>;
}

function defaultDependencies(): ProductionPreflightDependencies {
  return {
    database: async () => { await prisma.$queryRaw`SELECT 1`; },
    storage: async () => { await storageProvider().healthCheck(); },
    secretManager: async (config) => { await createSecretProvider(config).healthCheck(config.SECRETS_MANAGER_PREFLIGHT_SECRET_ID!); },
    kms: async (config) => { await createKmsProvider(config).healthCheck(); },
    malwareScanner: async () => {
      const result = await createMalwareScanner("production", "external").scan({ bytes: new Uint8Array(), fileName: "preflight.txt", checksum: "preflight" });
      if (!result.clean) {
        throw new ProductionDependencyError(
          "MALWARE_SCANNER_PROVIDER",
          "SERVICE_UNAVAILABLE",
          "ScannerUnavailableError",
          "Scanner antimalware externo indisponível.",
        );
      }
    },
  };
}

export async function runProductionPreflight(
  environment: Record<string, string | undefined>,
  dependencies?: ProductionPreflightDependencies,
): Promise<ProductionPreflightResult> {
  const correlationId = randomUUID();
  let config: RuntimeConfig;
  try {
    config = parseRuntimeConfig({ ...environment, NODE_ENV: "production" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Configuração inválida.";
    logger.error("Preflight recusado por configuração inválida.", { component: "production-preflight", event: "configuration_invalid", correlationId, errorClass: error instanceof Error ? error.name : "UnknownError" });
    return {
      ok: false,
      correlationId,
      configurationErrors: [message],
      unavailableServices: [],
      checkedServices: [],
      dependencyFailures: [{ service: "CONFIGURATION", kind: "INVALID_CONFIGURATION", errorClass: error instanceof Error ? error.name : "UnknownError" }],
    };
  }

  const services = dependencies ?? defaultDependencies();
  const checks: Array<[string, () => Promise<void>]> = [
    ["DATABASE_URL", services.database],
    ["STORAGE_PROVIDER", services.storage],
    ["SECRET_PROVIDER", () => services.secretManager(config)],
    ["KMS_PROVIDER", () => services.kms(config)],
    ["MALWARE_SCANNER_PROVIDER", services.malwareScanner],
  ];
  const unavailableServices: string[] = [];
  const checkedServices: string[] = [];
  const dependencyFailures: ProductionDependencyDiagnostic[] = [];
  for (const [name, check] of checks) {
    try {
      await check();
      checkedServices.push(name);
    } catch (error) {
      const failure = classifyProductionDependencyFailure(error);
      if (failure.kind === "SERVICE_UNAVAILABLE") unavailableServices.push(name);
      dependencyFailures.push({ service: name, kind: failure.kind, errorClass: failure.errorClass });
      logger.error("Dependência obrigatória recusou o preflight.", {
        component: "production-preflight",
        event: "dependency_failed",
        correlationId,
        dependency: name,
        failureKind: failure.kind,
        errorClass: failure.errorClass,
      });
    }
  }
  return { ok: dependencyFailures.length === 0, correlationId, configurationErrors: [], unavailableServices, checkedServices, dependencyFailures };
}
