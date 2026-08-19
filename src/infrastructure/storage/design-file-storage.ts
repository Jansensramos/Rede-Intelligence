import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

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

function safeSegment(value: string) {
  const cleaned = value.normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/\.{2,}/g, ".").slice(0, 120);
  if (!cleaned || cleaned === "." || cleaned === "..") throw new Error("Segmento de storage inválido.");
  return cleaned;
}

export class LocalPrivateFileStorage implements FileStorageProvider {
  readonly name = "LOCAL_PRIVATE_V1";
  private readonly root: string;

  constructor(root = process.env.DESIGN_STORAGE_ROOT ?? path.join(process.cwd(), ".rede-storage", "design")) {
    this.root = path.resolve(root);
  }

  private resolveKey(key: string) {
    const target = path.resolve(this.root, key);
    if (target !== this.root && !target.startsWith(`${this.root}${path.sep}`)) throw new Error("Chave de storage fora do namespace permitido.");
    return target;
  }

  async put(input: { organizationId: string; packageId: string; fileName: string; bytes: Uint8Array }) {
    const checksum = createHash("sha256").update(input.bytes).digest("hex");
    const extension = path.extname(input.fileName).toLowerCase();
    const nonce = randomBytes(8).toString("hex");
    const key = path.posix.join(safeSegment(input.organizationId), safeSegment(input.packageId), `${checksum}-${nonce}${safeSegment(extension || ".bin")}`);
    const target = this.resolveKey(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.bytes, { flag: "wx", mode: 0o600 });
    return { provider: this.name, key, checksum, size: input.bytes.length };
  }

  async read(key: string) {
    return new Uint8Array(await readFile(this.resolveKey(key)));
  }

  async size(key: string) {
    return (await stat(this.resolveKey(key))).size;
  }
}

export const designFileStorage = new LocalPrivateFileStorage();
