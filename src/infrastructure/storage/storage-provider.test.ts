import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertStorageAuthorization, createStorageProvider, LocalStorageProvider } from "./storage-provider";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("storage privado tenant-safe", () => {
  it("grava e lê sob namespace organização/projeto sem aceitar traversal", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rede-storage-")); roots.push(root);
    const provider = new LocalStorageProvider(root);
    const object = await provider.put({ organizationId: "org-a", projectId: "projeto-a", domain: "design", entityId: "arquivo-1", version: 1, fileName: "planta.pdf", mimeType: "application/pdf", bytes: new Uint8Array([1, 2, 3]) });
    expect(object.key).toMatch(/^org-a\/projeto-a\/design\/arquivo-1\/1\//);
    expect(await provider.get(object)).toEqual(new Uint8Array([1, 2, 3]));
    await expect(provider.get({ ...object, key: "../../segredo" })).rejects.toThrow(/inválida|namespace/);
  });

  it("rejeita tenant, projeto ou capability divergentes antes de assinar", () => {
    const object = { organizationId: "org-a", projectId: "p-a", domain: "legal", entityId: "d-1", version: 1, provider: "fake", bucket: "private", key: "org-a/p-a/legal/d-1/1/a.pdf", checksum: "abc", size: 1, mimeType: "application/pdf", createdAt: new Date() };
    expect(() => assertStorageAuthorization({ object, organizationId: "org-a", projectId: "p-a", capabilityGranted: true })).not.toThrow();
    expect(() => assertStorageAuthorization({ object, organizationId: "org-b", projectId: "p-a", capabilityGranted: true })).toThrow(/não autorizado/);
    expect(() => assertStorageAuthorization({ object, organizationId: "org-a", projectId: "p-a", capabilityGranted: false })).toThrow(/não autorizado/);
  });

  it("separa provider local de produção", () => {
    const local = createStorageProvider({ NODE_ENV: "test", DATABASE_URL: "postgresql://test", SESSION_COOKIE_NAME: "rede", STORAGE_PROVIDER: "local", STORAGE_FORCE_PATH_STYLE: "false", STORAGE_SIGNED_URL_TTL_SECONDS: 300, MALWARE_SCANNER_PROVIDER: "noop", SECRET_PROVIDER: "environment", KMS_PROVIDER: "local", WORKER_CONCURRENCY: 1, WORKER_POLL_MS: 100, WORKER_LEASE_MS: 5000, WORKER_JOB_TIMEOUT_MS: 1000 });
    expect(local).toBeInstanceOf(LocalStorageProvider);
  });
});
