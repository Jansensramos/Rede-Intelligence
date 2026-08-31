import type { RuntimeConfig } from "@/infrastructure/config/runtime-config";
import { runtimeConfig } from "@/infrastructure/config/runtime-config";

export interface SecretProvider {
  readonly name: string;
  get(name: string): Promise<string>;
}

export class EnvironmentSecretProvider implements SecretProvider {
  readonly name = "ENVIRONMENT_DEVELOPMENT_ONLY";
  constructor(private readonly environment: Record<string, string | undefined> = process.env) {}
  async get(name: string) {
    if (!/^[A-Z][A-Z0-9_]+$/.test(name)) throw new Error("Nome de segredo inválido.");
    const value = this.environment[name]?.trim();
    if (!value) throw new Error(`Segredo obrigatório ausente: ${name}.`);
    return value;
  }
}

export interface ExternalSecretAdapter { read(reference: string): Promise<string>; }
export class ExternalSecretProvider implements SecretProvider {
  readonly name = "EXTERNAL_SECRET_MANAGER";
  constructor(private readonly adapter?: ExternalSecretAdapter) {}
  async get(reference: string) {
    if (!this.adapter) throw new Error("Adapter de Secret Manager/KMS não configurado.");
    return this.adapter.read(reference);
  }
}

export interface KmsProvider {
  readonly name: string;
  encrypt(plaintext: Uint8Array, context: Record<string, string>): Promise<Uint8Array>;
  decrypt(ciphertext: Uint8Array, context: Record<string, string>): Promise<Uint8Array>;
}

export class ExternalKmsProvider implements KmsProvider {
  readonly name = "EXTERNAL_KMS";
  async encrypt(): Promise<Uint8Array> { throw new Error("Adapter KMS externo não configurado."); }
  async decrypt(): Promise<Uint8Array> { throw new Error("Adapter KMS externo não configurado."); }
}

export function createSecretProvider(config: RuntimeConfig = runtimeConfig(), environment: Record<string, string | undefined> = process.env): SecretProvider {
  if (config.SECRET_PROVIDER === "environment") {
    if (config.NODE_ENV === "production") throw new Error("EnvironmentSecretProvider é proibido em produção.");
    return new EnvironmentSecretProvider(environment);
  }
  return new ExternalSecretProvider();
}
