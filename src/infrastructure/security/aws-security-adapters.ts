import {
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { DecryptCommand, DescribeKeyCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import type { ExternalSecretAdapter, KmsAdapter } from "./secret-provider";
import { invalidProductionDependencyConfiguration, wrapProductionDependencyFailure } from "./production-dependency-error";

function requiredReference(value: string, label: string, dependency: string, maximumLength = 2048) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength || /[\u0000-\u001f]/.test(normalized)) {
    throw invalidProductionDependencyConfiguration(dependency, `${label} inválido.`);
  }
  return normalized;
}

function requiredRegion(value: string, dependency: string) {
  const region = requiredReference(value, "Região AWS", dependency, 100);
  if (!/^[a-z0-9-]+$/.test(region)) throw invalidProductionDependencyConfiguration(dependency, "Região AWS inválida.");
  return region;
}

export class AwsSecretsManagerAdapter implements ExternalSecretAdapter {
  constructor(private readonly client: SecretsManagerClient) {}

  async read(reference: string) {
    try {
      const result = await this.client.send(new GetSecretValueCommand({ SecretId: requiredReference(reference, "Referência de segredo", "AWS_SECRETS_MANAGER", 512) }));
      if (result.SecretString !== undefined) return result.SecretString;
      if (result.SecretBinary !== undefined) return Buffer.from(result.SecretBinary).toString("utf8");
      throw new Error("Conteúdo do segredo ausente.");
    } catch (error) {
      throw wrapProductionDependencyFailure(error, "AWS_SECRETS_MANAGER", "Não foi possível resolver o segredo no gerenciador externo.");
    }
  }

  async healthCheck(reference: string) {
    try {
      await this.client.send(new DescribeSecretCommand({ SecretId: requiredReference(reference, "Referência de preflight", "AWS_SECRETS_MANAGER", 512) }));
    } catch (error) {
      throw wrapProductionDependencyFailure(error, "AWS_SECRETS_MANAGER", "Falha ao verificar o Secret Manager externo.");
    }
  }

  async create(input: { name: string; value: string; kmsKeyId: string; description: string }) {
    try {
      const result = await this.client.send(new CreateSecretCommand({
        Name: requiredReference(input.name, "Nome do segredo", "AWS_SECRETS_MANAGER", 512),
        SecretString: input.value,
        KmsKeyId: requiredReference(input.kmsKeyId, "Chave KMS", "AWS_SECRETS_MANAGER"),
        Description: input.description,
        Tags: [{ Key: "managed-by", Value: "rede-intelligence" }],
      }));
      return result.ARN ?? input.name;
    } catch (error) {
      throw wrapProductionDependencyFailure(error, "AWS_SECRETS_MANAGER", "Não foi possível armazenar a credencial no gerenciador externo.");
    }
  }

  async revoke(reference: string) {
    try {
      await this.client.send(new DeleteSecretCommand({ SecretId: requiredReference(reference, "Referência de segredo", "AWS_SECRETS_MANAGER", 512), RecoveryWindowInDays: 7 }));
    } catch (error) {
      throw wrapProductionDependencyFailure(error, "AWS_SECRETS_MANAGER", "Não foi possível revogar a credencial no gerenciador externo.");
    }
  }
}

export class AwsKmsAdapter implements KmsAdapter {
  readonly name = "AWS_KMS";
  constructor(private readonly client: KMSClient, private readonly keyId: string) {}

  async healthCheck() {
    try {
      await this.client.send(new DescribeKeyCommand({ KeyId: requiredReference(this.keyId, "Chave KMS", "AWS_KMS") }));
    } catch (error) {
      throw wrapProductionDependencyFailure(error, "AWS_KMS", "Falha ao verificar o KMS externo.");
    }
  }

  async encrypt(plaintext: Uint8Array, context: Record<string, string>) {
    try {
      const result = await this.client.send(new EncryptCommand({ KeyId: requiredReference(this.keyId, "Chave KMS", "AWS_KMS"), Plaintext: plaintext, EncryptionContext: context }));
      if (!result.CiphertextBlob) throw new Error("Resposta KMS sem conteúdo cifrado.");
      return new Uint8Array(result.CiphertextBlob);
    } catch (error) {
      throw wrapProductionDependencyFailure(error, "AWS_KMS", "Não foi possível cifrar o conteúdo no KMS externo.");
    }
  }

  async decrypt(ciphertext: Uint8Array, context: Record<string, string>) {
    try {
      const result = await this.client.send(new DecryptCommand({ KeyId: requiredReference(this.keyId, "Chave KMS", "AWS_KMS"), CiphertextBlob: ciphertext, EncryptionContext: context }));
      if (!result.Plaintext) throw new Error("Resposta KMS sem conteúdo decifrado.");
      return new Uint8Array(result.Plaintext);
    } catch (error) {
      throw wrapProductionDependencyFailure(error, "AWS_KMS", "Não foi possível decifrar o conteúdo no KMS externo.");
    }
  }
}

export function createAwsSecretsManagerAdapter(region: string) {
  return new AwsSecretsManagerAdapter(new SecretsManagerClient({ region: requiredRegion(region, "AWS_SECRETS_MANAGER") }));
}

export function createAwsKmsAdapter(region: string, keyId: string) {
  return new AwsKmsAdapter(new KMSClient({ region: requiredRegion(region, "AWS_KMS") }), keyId);
}
