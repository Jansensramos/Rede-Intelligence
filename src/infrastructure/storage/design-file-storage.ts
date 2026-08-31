import path from "node:path";
import { LocalStorageProvider, storageProvider, type StorageObject, type StorageProvider } from "./storage-provider";

export interface StoredDesignFile {
  provider: string;
  key: string;
  checksum: string;
  size: number;
}

export interface FileStorageProvider {
  readonly name: string;
  put(input: { organizationId: string; packageId: string; fileName: string; bytes: Uint8Array }): Promise<StoredDesignFile>;
  read(key: string): Promise<Uint8Array>;
  size(key: string): Promise<number>;
}

export class LocalPrivateFileStorage implements FileStorageProvider {
  readonly name: string;
  private readonly provider: StorageProvider;

  constructor(root = process.env.DESIGN_STORAGE_ROOT ?? path.join(process.cwd(), ".rede-storage", "design")) {
    this.provider = new LocalStorageProvider(root);
    this.name = this.provider.name;
  }
  async put(input: { organizationId: string; packageId: string; fileName: string; bytes: Uint8Array }) {
    const stored = await this.provider.put({ organizationId: input.organizationId, projectId: input.packageId, domain: "design", entityId: input.packageId, version: "current", fileName: input.fileName, bytes: input.bytes, mimeType: "application/octet-stream" });
    return { provider: stored.provider, key: stored.key, checksum: stored.checksum, size: stored.size };
  }
  async read(key: string) { return this.provider.get(legacyObject(this.provider, key)); }
  async size(key: string) { return (await this.provider.metadata(legacyObject(this.provider, key))).size; }
}

function legacyObject(provider: StorageProvider, key: string): StorageObject {
  return { provider: provider.name, bucket: "configured", key, organizationId: "legacy", projectId: "legacy", domain: "legacy", entityId: "legacy", version: "legacy", checksum: "", size: 0, mimeType: "application/octet-stream", createdAt: new Date(0) };
}

class ConfiguredFileStorage implements FileStorageProvider {
  constructor(private readonly domain: string) {}
  get name() { return "CONFIGURED_PRIVATE_STORAGE"; }
  private get provider() { return storageProvider(); }
  async put(input: { organizationId: string; packageId: string; fileName: string; bytes: Uint8Array }) { const stored = await this.provider.put({ organizationId: input.organizationId, projectId: input.packageId, domain: this.domain, entityId: input.packageId, version: "current", fileName: input.fileName, bytes: input.bytes, mimeType: "application/octet-stream" }); return { provider: stored.provider, key: stored.key, checksum: stored.checksum, size: stored.size }; }
  async read(key: string) { return this.provider.get(legacyObject(this.provider, key)); }
  async size(key: string) { return (await this.provider.metadata(legacyObject(this.provider, key))).size; }
}

export function createConfiguredFileStorage(domain: string): FileStorageProvider { return new ConfiguredFileStorage(domain); }
export const designFileStorage: FileStorageProvider = createConfiguredFileStorage("design");
