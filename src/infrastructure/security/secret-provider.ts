import type { RuntimeConfig } from "@/infrastructure/config/runtime-config";
import { runtimeConfig } from "@/infrastructure/config/runtime-config";
import { createAwsKmsAdapter, createAwsSecretsManagerAdapter } from "./aws-security-adapters";

export interface SecretProvider {
  readonly name: string;
  get(name: string): Promise<string>;
  healthCheck(reference: string): Promise<void>;
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
  async healthCheck(reference: string) { await this.get(reference); }
}

export interface ExternalSecretAdapter { read(reference: string): Promise<string>; healthCheck(reference: string): Promise<void>; }
export class ExternalSecretProvider implements SecretProvider {
  readonly name = "EXTERNAL_SECRET_MANAGER";
  constructor(private readonly adapter?: ExternalSecretAdapter) {}
  async get(reference: string) {
    if (!this.adapter) throw new Error("Adapter de Secret Manager não configurado.");
    return this.adapter.read(reference);
  }
  async healthCheck(reference: string) {
    if (!this.adapter) throw new Error("Adapter de Secret Manager não configurado.");
    await this.adapter.healthCheck(reference);
  }
}

export interface KmsProvider {
  readonly name: string;
  encrypt(plaintext: Uint8Array, context: Record<string, string>): Promise<Uint8Array>;
  decrypt(ciphertext: Uint8Array, context: Record<string, string>): Promise<Uint8Array>;
  healthCheck(): Promise<void>;
}

export type KmsAdapter = KmsProvider;

export class ExternalKmsProvider implements KmsProvider {
  readonly name = "EXTERNAL_KMS";
  constructor(private readonly adapter?: KmsAdapter) {}
  async encrypt(plaintext: Uint8Array, context: Record<string, string>) {
    if (!this.adapter) throw new Error("Adapter KMS externo não configurado.");
    return this.adapter.encrypt(plaintext, context);
  }
  async decrypt(ciphertext: Uint8Array, context: Record<string, string>) {
    if (!this.adapter) throw new Error("Adapter KMS externo não configurado.");
    return this.adapter.decrypt(ciphertext, context);
  }
  async healthCheck() {
    if (!this.adapter) throw new Error("Adapter KMS externo não configurado.");
    await this.adapter.healthCheck();
  }
}

export function createSecretProvider(config: RuntimeConfig = runtimeConfig(), environment: Record<string, string | undefined> = process.env): SecretProvider {
  if (config.SECRET_PROVIDER === "environment") {
    if (config.NODE_ENV === "production") throw new Error("EnvironmentSecretProvider é proibido em produção.");
    return new EnvironmentSecretProvider(environment);
  }
  if (!config.AWS_REGION) throw new Error("Configuração obrigatória ausente: AWS_REGION.");
  return new ExternalSecretProvider(createAwsSecretsManagerAdapter(config.AWS_REGION));
}

export function createKmsProvider(config: RuntimeConfig = runtimeConfig()): KmsProvider {
  if (config.KMS_PROVIDER !== "external") throw new Error("KMS local não é exposto por este provider de produção.");
  if (!config.AWS_REGION || !config.KMS_KEY_ID) throw new Error("Configuração obrigatória ausente: AWS_REGION, KMS_KEY_ID.");
  return new ExternalKmsProvider(createAwsKmsAdapter(config.AWS_REGION, config.KMS_KEY_ID));
}
