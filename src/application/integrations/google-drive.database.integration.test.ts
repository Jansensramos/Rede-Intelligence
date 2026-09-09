import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { integrationSecretVault } from "@/infrastructure/security/secret-vault";
import { createGoogleDriveInstallation, configureGoogleDriveInstallation, googleDriveProviderForInstallation, syncGoogleDriveInstallation } from "./google-drive-service";
import { storeInstallationCredential } from "./integrations-service";

describe.sequential("Google Drive 9P.3B — durable scoped synchronization", () => {
  let context: { organizationId: string; userId: string; role: "OWNER" }; let projectId: string;
  const installations: string[] = []; const refs: string[] = [];
  const config = { mode: "REAL" as const, driveId: "drive-test", folderId: "folder-test" };
  const file = (id = "file-test", version = "1") => ({ id, version, driveId: "drive-test", name: "Test reference", mimeType: "application/pdf", parents: ["folder-test"], modifiedTime: "2026-09-06T10:00:00Z" });
  beforeAll(async () => {
    const member = await prisma.organizationMembership.findFirstOrThrow({ where: { organization: { slug: "rede-nucleo-de-negocios" }, user: { email: "admin@rede.local" } } });
    context = { organizationId: member.organizationId, userId: member.userId, role: "OWNER" };
    projectId = (await prisma.project.findFirstOrThrow({ where: { organizationId: context.organizationId } })).id;
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await prisma.connectorInstallation.updateMany({ where: { id: { in: installations } }, data: { status: "PAUSED" } });
    for (const id of installations) { const c = await prisma.credentialReference.findUnique({ where: { installationId: id } }); if (c) refs.push(c.secretRef); }
    await prisma.credentialReference.deleteMany({ where: { installationId: { in: installations } } });
    for (const ref of refs) await integrationSecretVault.revoke(ref);
    await prisma.$disconnect();
  });
  async function installed(mode: "MOCK" | "REAL" = "REAL") {
    const i = await createGoogleDriveInstallation(context, { name: `Drive QA ${randomUUID()}`, projectId, driveId: config.driveId, folderId: config.folderId }); installations.push(i.id);
    if (mode === "REAL") await storeInstallationCredential(context, i.id, { method: "OAUTH2", secret: JSON.stringify({ accessToken: "synthetic-local-token", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), scopes: ["https://www.googleapis.com/auth/drive.metadata.readonly"] }) });
    await configureGoogleDriveInstallation(context, i.id, { ...config, mode }); return i.id;
  }
  function api(values: unknown[]) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (!values.length) throw new Error("Unexpected controlled request");
      const response = new Response(JSON.stringify(values.shift()), { status: 200 }); Object.defineProperty(response, "url", { value: String(input) }); return response;
    });
  }
  it("composes vault + real adapter, saves versions, paginates, and replays without mutating cursor or history", async () => {
    const id = await installed();
    const pages = [{ startPageToken: "start" }, { files: [file()], nextPageToken: "p2" }, { files: [] }, { changes: [{ fileId: "file-test", removed: false, time: "2026-09-06T10:00:00Z", changeType: "file", file: file("file-test", "2") }], newStartPageToken: "end" }];
    const calls = api([...pages]);
    await expect(syncGoogleDriveInstallation(context, id)).resolves.toMatchObject({ status: "SUCCEEDED", mode: "REAL" });
    expect(calls).toHaveBeenCalledTimes(4);
    const versions = await prisma.driveDocumentVersion.findMany({ where: { installationId: id } }); expect(versions).toHaveLength(2);
    const current = await prisma.connectorDocumentReference.findFirstOrThrow({ where: { installationId: id } }); expect(current).toMatchObject({ externalVersionId: "2", checksum: null, referenceMode: "REFERENCE" });
    const before = await prisma.integrationCursor.findFirstOrThrow({ where: { installationId: id, capability: "GOOGLE_DRIVE_DOCUMENTS" } });
    calls.mockRestore(); api([...pages]); await syncGoogleDriveInstallation(context, id, "REPLAY");
    expect(await prisma.integrationCursor.findUnique({ where: { id: before.id } })).toEqual(before);
    expect(await prisma.driveDocumentVersion.count({ where: { installationId: id } })).toBe(2);
    await expect(prisma.driveDocumentVersion.update({ where: { id: versions[0].id }, data: { available: false } })).rejects.toThrow();
    await expect(prisma.driveDocumentVersion.delete({ where: { id: versions[0].id } })).rejects.toThrow();
    await expect(prisma.$executeRaw`TRUNCATE drive_document_versions`).rejects.toThrow();
  });
  it("rolls back a failed page and its cursor, then resumes without lost or duplicate versions", async () => {
    const id = await installed();
    // An interrupted local run must not poison the next isolated QA execution.
    await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS drive_qa_reject ON drive_document_versions");
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS drive_qa_reject()");
    await prisma.$executeRawUnsafe("CREATE FUNCTION drive_qa_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.external_file_id = 'reject-drive-page' THEN RAISE EXCEPTION 'controlled QA failure'; END IF; RETURN NEW; END $$");
    await prisma.$executeRawUnsafe("CREATE TRIGGER drive_qa_reject BEFORE INSERT ON drive_document_versions FOR EACH ROW EXECUTE FUNCTION drive_qa_reject()");
    const pages = [{ startPageToken: "start" }, { files: [file(), file("reject-drive-page")] }, { changes: [], newStartPageToken: "end" }];
    const calls = api([...pages]);
    try {
      await expect(syncGoogleDriveInstallation(context, id)).rejects.toMatchObject({ reason: "PAGE_APPLICATION_FAILED" });
      expect(await prisma.driveDocumentVersion.count({ where: { installationId: id } })).toBe(0);
      expect(await prisma.connectorDocumentReference.count({ where: { installationId: id } })).toBe(0);
      expect(await prisma.integrationCursor.count({ where: { installationId: id, capability: "GOOGLE_DRIVE_DOCUMENTS" } })).toBe(0);
    } finally { await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS drive_qa_reject ON drive_document_versions"); await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS drive_qa_reject()"); }
    calls.mockRestore(); api([...pages]); await syncGoogleDriveInstallation(context, id);
    expect(await prisma.driveDocumentVersion.count({ where: { installationId: id } })).toBe(2);
  });
  it("tombstones access loss, retains history, and invalidates viewer links on scope change", async () => {
    const id = await installed(); const first = api([{ startPageToken: "start" }, { files: [file()] }, { changes: [], newStartPageToken: "end" }]);
    await syncGoogleDriveInstallation(context, id); first.mockRestore();
    const second = api([{ changes: [{ fileId: "file-test", removed: true, changeType: "file", time: "2026-09-06T11:00:00Z" }], newStartPageToken: "removed" }]);
    await syncGoogleDriveInstallation(context, id); second.mockRestore();
    expect(await prisma.connectorDocumentReference.findFirst({ where: { installationId: id } })).toMatchObject({ webUrl: null });
    expect(await prisma.driveDocumentVersion.count({ where: { installationId: id } })).toBe(2);
    await configureGoogleDriveInstallation(context, id, { ...config, folderId: "other-folder" });
    expect(await prisma.driveDocumentVersion.count({ where: { installationId: id } })).toBe(2);
  });
  it("rejects foreign tenant, viewer, disabled and absent credentials before transport", async () => {
    const id = await installed(); const transport = { request: vi.fn() };
    await expect(googleDriveProviderForInstallation({ ...context, organizationId: "foreign" }, id, transport)).rejects.toThrow();
    await expect(googleDriveProviderForInstallation({ ...context, role: "VIEWER" }, id, transport)).rejects.toThrow();
    await configureGoogleDriveInstallation(context, id, { ...config, mode: "DISABLED" });
    await expect(googleDriveProviderForInstallation(context, id, transport)).rejects.toThrow();
    await configureGoogleDriveInstallation(context, id, config);
    const credential = await prisma.credentialReference.findUniqueOrThrow({ where: { installationId: id } }); refs.push(credential.secretRef);
    await prisma.credentialReference.delete({ where: { id: credential.id } });
    await expect(googleDriveProviderForInstallation(context, id, transport)).rejects.toMatchObject({ errorClass: "AUTHENTICATION" });
    expect(transport.request).not.toHaveBeenCalled();
  });
  it("MOCK needs no credentials or I/O and remains explicitly simulated", async () => {
    const id = await installed("MOCK"); const fetch = vi.spyOn(globalThis, "fetch");
    await expect(syncGoogleDriveInstallation(context, id)).resolves.toMatchObject({ mode: "MOCK", itemsRead: 0 }); expect(fetch).not.toHaveBeenCalled();
    expect(await prisma.driveDocumentVersion.count({ where: { installationId: id } })).toBe(0);
  });
  it("serializes concurrent runs without duplicate pages or cursor regression", async () => {
    const id = await installed(); api([{ startPageToken: "start" }, { files: [file()] }, { changes: [], newStartPageToken: "end" }, { changes: [], newStartPageToken: "end" }]);
    const results = await Promise.allSettled([syncGoogleDriveInstallation(context, id), syncGoogleDriveInstallation(context, id)]);
    expect(results.some(r => r.status === "fulfilled")).toBe(true);
    expect(await prisma.driveDocumentVersion.count({ where: { installationId: id } })).toBe(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ reason: "SYNC_ALREADY_RUNNING" });
  });
  it("does not reuse a resolved provider after pausing or expiring its credential", async () => {
    const id = await installed(); const transport = { request: vi.fn() };
    const provider = await googleDriveProviderForInstallation(context, id, transport);
    await configureGoogleDriveInstallation(context, id, { ...config, mode: "DISABLED" });
    await expect(provider.pull(null)).rejects.toMatchObject({ reason: "INSTALLATION_CHANGED" });
    await configureGoogleDriveInstallation(context, id, config);
    await prisma.credentialReference.update({ where: { installationId: id }, data: { expiresAt: new Date(0) } });
    await expect(googleDriveProviderForInstallation(context, id, transport)).rejects.toMatchObject({ errorClass: "AUTHENTICATION" });
    expect(transport.request).not.toHaveBeenCalled();
  });
  it("retains a committed first page when the next response fails, then resumes at that exact cursor", async () => {
    const id = await installed(); const first = api([{ startPageToken: "start" }, { files: [file()], nextPageToken: "second" }, { files: "invalid" }]);
    await expect(syncGoogleDriveInstallation(context, id)).rejects.toThrow();
    expect(await prisma.driveDocumentVersion.count({ where: { installationId: id } })).toBe(1);
    const cursor = await prisma.integrationCursor.findFirstOrThrow({ where: { installationId: id, capability: "GOOGLE_DRIVE_DOCUMENTS" } });
    expect(JSON.parse(Buffer.from(cursor.cursorValue!, "base64url").toString()).token).toBe("second");
    first.mockRestore(); const next = api([{ files: [file("second-file")] }, { changes: [], newStartPageToken: "end" }]);
    await syncGoogleDriveInstallation(context, id);
    expect(new URL(String(next.mock.calls[0][0])).searchParams.get("pageToken")).toBe("second");
    expect(await prisma.driveDocumentVersion.count({ where: { installationId: id } })).toBe(2);
  });
  it("FULL rescan withdraws missing references without deleting their version history", async () => {
    const id = await installed(); const initial = api([{ startPageToken: "start" }, { files: [file()] }, { changes: [], newStartPageToken: "end" }]);
    await syncGoogleDriveInstallation(context, id); initial.mockRestore();
    api([{ startPageToken: "new-start" }, { files: [] }, { changes: [], newStartPageToken: "new-end" }]);
    await syncGoogleDriveInstallation(context, id, "FULL");
    expect(await prisma.connectorDocumentReference.findFirst({ where: { installationId: id } })).toMatchObject({ webUrl: null });
    expect(await prisma.driveDocumentVersion.count({ where: { installationId: id } })).toBe(2);
  });
  it("cancelled worker cannot commit the fetched page", async () => {
    const id = await installed(); const controller = new AbortController();
    const calls = api([{ startPageToken: "start" }, { files: [file()] }]);
    const original = calls.getMockImplementation()!;
    calls.mockImplementation(async (...args) => { const result = await original(...args); if (calls.mock.calls.length === 2) controller.abort(); return result; });
    await expect(syncGoogleDriveInstallation(context, id, "INCREMENTAL", controller.signal)).rejects.toThrow();
    expect(await prisma.driveDocumentVersion.count({ where: { installationId: id } })).toBe(0);
    expect(await prisma.integrationCursor.count({ where: { installationId: id } })).toBe(0);
  });
  it("resumes an interrupted FULL scan and withdraws missing files only after all pages commit", async () => {
    const id = await installed(); const initial = api([{ startPageToken: "s" }, { files: [file(), file("missing-file")] }, { changes: [], newStartPageToken: "e" }]);
    await syncGoogleDriveInstallation(context, id); initial.mockRestore();
    const interrupted = api([{ startPageToken: "new" }, { files: [file()], nextPageToken: "resume" }, { files: "invalid" }]);
    await expect(syncGoogleDriveInstallation(context, id, "FULL")).rejects.toThrow(); interrupted.mockRestore();
    expect((await prisma.connectorDocumentReference.findFirstOrThrow({ where: { installationId: id, externalFileId: "missing-file" } })).webUrl).not.toBeNull();
    api([{ files: [] }, { changes: [], newStartPageToken: "finished" }]);
    await syncGoogleDriveInstallation(context, id);
    expect((await prisma.connectorDocumentReference.findFirstOrThrow({ where: { installationId: id, externalFileId: "missing-file" } })).webUrl).toBeNull();
    expect((await prisma.connectorDocumentReference.findFirstOrThrow({ where: { installationId: id, externalFileId: "file-test" } })).webUrl).not.toBeNull();
  });
});
