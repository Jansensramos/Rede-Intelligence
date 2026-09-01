import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Referência opaca a um segredo armazenado fora do banco (Fase 9H §7.1). Prisma
 * guarda apenas `secretRef` + `fingerprint` (hash não reversível); o segredo em si
 * nunca entra em `CredentialReference`, log ou payload de auditoria.
 */
export interface SecretVaultProvider {
  readonly name: string;
  store(input: { organizationId: string; installationId: string; secret: string }): Promise<{ secretRef: string; fingerprint: string }>;
  read(secretRef: string): Promise<string>;
  revoke(secretRef: string): Promise<void>;
}

const ALGORITHM = "aes-256-gcm";

function safeSegment(value: string) {
  const cleaned = value.normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/\.{2,}/g, ".").slice(0, 120);
  if (!cleaned || cleaned === "." || cleaned === "..") throw new Error("Segmento de storage inválido.");
  return cleaned;
}

/**
 * ATENÇÃO — implementação de DESENVOLVIMENTO, não um secret manager de produção:
 * - chave mestra vem de `INTEGRATION_SECRET_KEY` (variável de ambiente local),
 *   sem KMS/HSM, sem rotação automática de chave mestra e sem quorum de acesso;
 * - segredo cifrado (AES-256-GCM) fica em disco local (`.rede-storage/secrets`,
 *   gitignored) — não em um serviço gerenciado com controle de acesso próprio;
 * - não há auditoria de LEITURA do segredo (apenas de escrita, via AuditLog do
 *   chamador) nem revogação centralizada fora desta aplicação.
 * A composição de produção em `secret-vault.ts` seleciona AWS Secrets Manager
 * com KMS; esta implementação permanece restrita a desenvolvimento e teste.
 */
export class LocalEncryptedSecretVault implements SecretVaultProvider {
  readonly name = "LOCAL_ENCRYPTED_V1";
  private readonly root: string;
  private readonly passphrase: string | undefined;
  private readonly environment: string | undefined;

  constructor(root = process.env.INTEGRATION_SECRET_STORAGE_ROOT ?? path.join(process.cwd(), ".rede-storage", "secrets")) {
    this.root = path.resolve(root);
    this.environment = process.env.NODE_ENV;
    this.passphrase = process.env.INTEGRATION_SECRET_KEY;
  }

  private encryptionKey() {
    if (this.environment === "production") throw new Error("LocalEncryptedSecretVault é proibido em produção; configure KMS/Secret Manager externo.");
    if (!this.passphrase) throw new Error("INTEGRATION_SECRET_KEY é obrigatória para usar o cofre local.");
    return scryptSync(this.passphrase, "rede-secret-vault-v1", 32);
  }

  private resolveKey(secretRef: string) {
    const target = path.resolve(this.root, `${secretRef}.bin`);
    if (target !== this.root && !target.startsWith(`${this.root}${path.sep}`)) throw new Error("Referência de segredo fora do namespace permitido.");
    return target;
  }

  async store(input: { organizationId: string; installationId: string; secret: string }) {
    const nonce = randomBytes(8).toString("hex");
    const secretRef = path.posix.join(safeSegment(input.organizationId), `${safeSegment(input.installationId)}-${nonce}`);
    const target = this.resolveKey(secretRef);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(input.secret, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    await writeFile(target, Buffer.concat([iv, tag, ciphertext]), { flag: "wx", mode: 0o600 });
    const fingerprint = createHash("sha256").update(input.secret).digest("hex").slice(0, 16);
    return { secretRef, fingerprint };
  }

  async read(secretRef: string) {
    const buffer = await readFile(this.resolveKey(secretRef));
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const ciphertext = buffer.subarray(28);
    const decipher = createDecipheriv(ALGORITHM, this.encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }

  async revoke(secretRef: string) {
    await rm(this.resolveKey(secretRef), { force: true });
  }
}
