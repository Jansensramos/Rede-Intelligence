import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { RuntimeConfig } from "@/infrastructure/config/runtime-config";
import { runtimeConfig } from "@/infrastructure/config/runtime-config";

export interface StorageIdentity { organizationId: string; projectId: string; domain: string; entityId: string; version: string | number; }
export interface StorageObject extends StorageIdentity { provider: string; bucket: string; key: string; checksum: string; size: number; mimeType: string; createdAt: Date; metadata?: Record<string, string>; }
export interface StoragePutInput extends StorageIdentity { fileName: string; bytes: Uint8Array; mimeType: string; metadata?: Record<string, string>; }
export interface SignedStorageUrl { url: string; expiresAt: Date; }

export interface StorageProvider {
  readonly name: string;
  put(input: StoragePutInput): Promise<StorageObject>;
  get(object: StorageObject): Promise<Uint8Array>;
  delete(object: StorageObject): Promise<void>;
  exists(object: StorageObject): Promise<boolean>;
  metadata(object: StorageObject): Promise<StorageObject>;
  signedReadUrl(object: StorageObject, ttlSeconds?: number): Promise<SignedStorageUrl>;
  signedUploadUrl(input: Omit<StoragePutInput, "bytes">, ttlSeconds?: number): Promise<SignedStorageUrl>;
  healthCheck(): Promise<void>;
}

export function safeStorageSegment(value: string) {
  const clean = value.normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/\.{2,}/g, ".").slice(0, 120);
  if (!clean || clean === "." || clean === "..") throw new Error("Segmento de storage inválido.");
  return clean;
}

function storageKey(input: StorageIdentity & { fileName: string }) {
  const extension = safeStorageSegment(path.extname(input.fileName).toLowerCase() || ".bin");
  return [input.organizationId, input.projectId, input.domain, input.entityId, String(input.version), `${randomBytes(12).toString("hex")}${extension}`].map(safeStorageSegment).join("/");
}

export function assertStorageAuthorization(input: { object: StorageObject; organizationId: string; projectId: string; capabilityGranted: boolean }) {
  if (!input.capabilityGranted || input.object.organizationId !== input.organizationId || input.object.projectId !== input.projectId) throw new Error("Acesso ao arquivo não autorizado.");
  const prefix = `${safeStorageSegment(input.organizationId)}/${safeStorageSegment(input.projectId)}/`;
  if (!input.object.key.startsWith(prefix)) throw new Error("Objeto fora do namespace autorizado.");
}

export class LocalStorageProvider implements StorageProvider {
  readonly name = "LOCAL_PRIVATE_V2";
  readonly bucket = "local-private";
  constructor(private readonly root: string) { this.root = path.resolve(root); }
  private resolve(key: string) {
    if (path.isAbsolute(key) || key.includes("\\")) throw new Error("Chave de storage inválida.");
    const target = path.resolve(this.root, key);
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new Error("Chave de storage fora do namespace permitido.");
    return target;
  }
  async put(input: StoragePutInput) {
    const key = storageKey(input); const target = this.resolve(key); const checksum = createHash("sha256").update(input.bytes).digest("hex"); const createdAt = new Date();
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, input.bytes, { flag: "wx", mode: 0o600 });
    const object: StorageObject = { organizationId: input.organizationId, projectId: input.projectId, domain: input.domain, entityId: input.entityId, version: input.version, provider: this.name, bucket: this.bucket, key, checksum, size: input.bytes.length, mimeType: input.mimeType, createdAt, metadata: input.metadata };
    await writeFile(`${target}.metadata.json`, JSON.stringify(object), { flag: "wx", mode: 0o600 });
    return object;
  }
  async get(object: StorageObject) { return new Uint8Array(await readFile(this.resolve(object.key))); }
  async delete(object: StorageObject) { await rm(this.resolve(object.key)); await rm(`${this.resolve(object.key)}.metadata.json`, { force: true }); }
  async exists(object: StorageObject) { try { await stat(this.resolve(object.key)); return true; } catch { return false; } }
  async metadata(object: StorageObject) { await stat(this.resolve(object.key)); return object; }
  async signedReadUrl(): Promise<SignedStorageUrl> { throw new Error("URL assinada não é exposta pelo storage local; use leitura autenticada do backend."); }
  async signedUploadUrl(): Promise<SignedStorageUrl> { throw new Error("Upload assinado não é exposto pelo storage local; use upload autenticado do backend."); }
  async healthCheck() { await mkdir(this.root, { recursive: true }); await stat(this.root); }
}

export class CloudObjectStorageProvider implements StorageProvider {
  readonly name = "S3_COMPATIBLE_PRIVATE_V1";
  private readonly client: S3Client;
  constructor(private readonly options: { bucket: string; region: string; endpoint?: string; accessKeyId: string; secretAccessKey: string; forcePathStyle?: boolean }) {
    this.client = new S3Client({ region: options.region, endpoint: options.endpoint, forcePathStyle: options.forcePathStyle, credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey } });
  }
  async put(input: StoragePutInput) {
    const key = storageKey(input); const checksum = createHash("sha256").update(input.bytes).digest("hex"); const createdAt = new Date();
    const metadata = { organization: input.organizationId, project: input.projectId, domain: input.domain, entity: input.entityId, version: String(input.version), sha256: checksum, ...input.metadata };
    await this.client.send(new PutObjectCommand({ Bucket: this.options.bucket, Key: key, Body: input.bytes, ContentType: input.mimeType, Metadata: metadata }));
    return { organizationId: input.organizationId, projectId: input.projectId, domain: input.domain, entityId: input.entityId, version: input.version, provider: this.name, bucket: this.options.bucket, key, checksum, size: input.bytes.length, mimeType: input.mimeType, createdAt, metadata };
  }
  async get(object: StorageObject) { const result = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: object.key })); if (!result.Body) throw new Error("Objeto sem conteúdo."); return new Uint8Array(await result.Body.transformToByteArray()); }
  async delete(object: StorageObject) { await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: object.key })); }
  async exists(object: StorageObject) { try { await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: object.key })); return true; } catch (error) { if (error && typeof error === "object" && "$metadata" in error && (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false; throw error; } }
  async metadata(object: StorageObject) { const head = await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: object.key })); return { ...object, size: head.ContentLength ?? object.size, mimeType: head.ContentType ?? object.mimeType, metadata: head.Metadata ?? object.metadata }; }
  async signedReadUrl(object: StorageObject, ttlSeconds = 300) { return { url: await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.options.bucket, Key: object.key }), { expiresIn: ttlSeconds }), expiresAt: new Date(Date.now() + ttlSeconds * 1000) }; }
  async signedUploadUrl(input: Omit<StoragePutInput, "bytes">, ttlSeconds = 300) { const key = storageKey(input); return { url: await getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.options.bucket, Key: key, ContentType: input.mimeType }), { expiresIn: ttlSeconds }), expiresAt: new Date(Date.now() + ttlSeconds * 1000) }; }
  async healthCheck() { await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: ".rede-health" })).catch((error) => { const code = error && typeof error === "object" && "$metadata" in error ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode : undefined; if (code !== 404) throw error; }); }
}

export function createStorageProvider(config: RuntimeConfig = runtimeConfig()): StorageProvider {
  if (config.STORAGE_PROVIDER === "local") return new LocalStorageProvider(config.STORAGE_LOCAL_ROOT ?? path.join(process.cwd(), ".rede-storage"));
  return new CloudObjectStorageProvider({ bucket: config.STORAGE_BUCKET!, region: config.STORAGE_REGION!, endpoint: config.STORAGE_ENDPOINT, accessKeyId: config.STORAGE_ACCESS_KEY_ID!, secretAccessKey: config.STORAGE_SECRET_ACCESS_KEY!, forcePathStyle: config.STORAGE_FORCE_PATH_STYLE === "true" });
}

let singleton: StorageProvider | undefined;
export function storageProvider() { return singleton ??= createStorageProvider(); }
export function resetStorageProviderForTests() { singleton = undefined; }
