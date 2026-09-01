import { createHash, randomBytes } from "node:crypto";
import { runtimeConfig, type RuntimeConfig } from "@/infrastructure/config/runtime-config";
import { createAwsSecretsManagerAdapter } from "./aws-security-adapters";
import { LocalEncryptedSecretVault, type SecretVaultProvider } from "./local-secret-vault";

function safeNameSegment(value: string) {
  const normalized = value.normalize("NFKC").replace(/[^a-zA-Z0-9/_+=.@-]/g, "-").replace(/\.{2,}/g, ".").slice(0, 120);
  if (!normalized || normalized === "." || normalized === "..") throw new Error("Identificador de segredo inválido.");
  return normalized;
}

export class AwsSecretsManagerSecretVault implements SecretVaultProvider {
  readonly name = "AWS_SECRETS_MANAGER_V1";

  constructor(
    private readonly adapter: Pick<ReturnType<typeof createAwsSecretsManagerAdapter>, "create" | "read" | "revoke">,
    private readonly prefix: string,
    private readonly kmsKeyId: string,
  ) {}

  async store(input: { organizationId: string; installationId: string; secret: string }) {
    const name = [this.prefix, safeNameSegment(input.organizationId), `${safeNameSegment(input.installationId)}-${randomBytes(12).toString("hex")}`]
      .map(safeNameSegment)
      .join("/");
    const secretRef = await this.adapter.create({ name, value: input.secret, kmsKeyId: this.kmsKeyId, description: "Credencial de integração gerenciada pelo REDE Intelligence." });
    return { secretRef, fingerprint: createHash("sha256").update(input.secret).digest("hex").slice(0, 16) };
  }

  read(secretRef: string) { return this.adapter.read(secretRef); }
  revoke(secretRef: string) { return this.adapter.revoke(secretRef); }
}

type SecretsManagerVaultAdapter = Pick<ReturnType<typeof createAwsSecretsManagerAdapter>, "create" | "read" | "revoke">;

export function createIntegrationSecretVault(
  config: RuntimeConfig = runtimeConfig(),
  createAdapter: (region: string) => SecretsManagerVaultAdapter = createAwsSecretsManagerAdapter,
): SecretVaultProvider {
  if (config.NODE_ENV !== "production") return new LocalEncryptedSecretVault();
  if (config.SECRET_PROVIDER !== "external" || !config.AWS_REGION || !config.SECRETS_MANAGER_PREFIX || !config.KMS_KEY_ID) {
    throw new Error("Configuração de produção incompleta: SECRET_PROVIDER, AWS_REGION, SECRETS_MANAGER_PREFIX, KMS_KEY_ID.");
  }
  return new AwsSecretsManagerSecretVault(createAdapter(config.AWS_REGION), config.SECRETS_MANAGER_PREFIX, config.KMS_KEY_ID);
}

let selectedProvider: SecretVaultProvider | undefined;
function selected() { return selectedProvider ??= createIntegrationSecretVault(); }

export const integrationSecretVault: SecretVaultProvider = {
  get name() { return selected().name; },
  store: (input) => selected().store(input),
  read: (reference) => selected().read(reference),
  revoke: (reference) => selected().revoke(reference),
};

export function resetIntegrationSecretVaultForTests() { selectedProvider = undefined; }
