import { describe, expect, it, vi } from "vitest";
import { DRIVE_API, DriveError, GoogleDriveAdapter, MAX_DRIVE_RESPONSE, driveConfiguration, driveScope, fetchDriveTransport, type DriveTransport } from "./google-drive";

const config = { mode: "REAL" as const, driveId: "drive-1", folderId: "folder-1" };
const file = (id = "file-1", version = "1") => ({ id, version, driveId: "drive-1", name: "Document", mimeType: "application/pdf", parents: ["folder-1"], modifiedTime: "2026-09-06T10:00:00Z", size: "50" });
function fixture(values: unknown[]) {
  const calls: string[] = [];
  const transport: DriveTransport = { request: vi.fn(async (url) => {
    calls.push(url); if (!values.length) throw new Error("Unexpected call");
    return { status: 200, url, body: new TextEncoder().encode(JSON.stringify(values.shift())) };
  }) };
  const adapter = new GoogleDriveAdapter(config, driveScope("org", "installation", config), { accessToken: "synthetic-token", expiresAt: Date.now() + 60_000 }, transport);
  return { adapter, calls, transport };
}
describe("Google Drive 9P.3B — scoped metadata transport", () => {
  it("scopes personal Drive to an explicit folder and uses the user changes stream", async () => {
    const personal = driveConfiguration({ mode: "REAL", driveId: "MY_DRIVE", folderId: "folder-1" });
    const calls: string[] = [];
    const personalFile = { ...file(), driveId: undefined };
    const responses = [{ startPageToken: "start" }, { files: [personalFile] }, { changes: [], newStartPageToken: "end" }];
    const adapter = new GoogleDriveAdapter(personal, "personal-scope", { accessToken: "test", expiresAt: Date.now() + 60_000 }, { request: async url => { calls.push(url); return { status: 200, url, body: new TextEncoder().encode(JSON.stringify(responses.shift())) }; } });
    const first = await adapter.pull(null); expect(first.items[0].available).toBe(true); await adapter.pull(first.cursor);
    expect(calls.every(url => !new URL(url).searchParams.has("driveId"))).toBe(true);
    expect(new URL(calls[1]).searchParams.get("corpora")).toBe("user");
    expect(new URL(calls[2]).searchParams.get("restrictToMyDrive")).toBe("true");
    expect(() => driveConfiguration({ mode: "REAL", driveId: "MY_DRIVE" })).toThrow();
  });
  it("captures changes before listing, paginates files, then reconciles changes during the scan", async () => {
    const f = fixture([{ startPageToken: "start" }, { files: [file()], nextPageToken: "files-next" }, { files: [] }, { changes: [{ fileId: "file-1", removed: false, time: "2026-09-06T10:00:01Z", changeType: "file", file: file("file-1", "2") }], nextPageToken: "changes-next" }, { changes: [], newStartPageToken: "end" }]);
    const a = await f.adapter.pull(null); const b = await f.adapter.pull(a.cursor); const c = await f.adapter.pull(b.cursor); const d = await f.adapter.pull(c.cursor);
    expect([a.hasMore, b.hasMore, c.hasMore, d.hasMore]).toEqual([true, true, true, false]);
    expect(c.items[0].version).toBe("2"); expect(a.items[0].checksum).toBeUndefined();
    expect(f.calls.map(url => new URL(url).pathname)).toEqual(["/drive/v3/changes/startPageToken", "/drive/v3/files", "/drive/v3/files", "/drive/v3/changes", "/drive/v3/changes"]);
    expect(new URL(f.calls[3]).searchParams.get("pageToken")).toBe("start");
    expect(f.calls.every(url => new URL(url).searchParams.get("driveId") === "drive-1")).toBe(true);
  });
  it("rejects cross-tenant, cross-installation and changed-scope cursors before I/O", async () => {
    const f = fixture([{ startPageToken: "start" }, { files: [] }]); const first = await f.adapter.pull(null);
    for (const scope of [driveScope("other", "installation", config), driveScope("org", "other", config), driveScope("org", "installation", { ...config, folderId: "other" })]) {
      const request = vi.fn(); const adapter = new GoogleDriveAdapter(config, scope, { accessToken: "test", expiresAt: Date.now() + 1000 }, { request });
      await expect(adapter.pull(first.cursor)).rejects.toMatchObject({ reason: "CURSOR_SCOPE_MISMATCH" }); expect(request).not.toHaveBeenCalled();
    }
  });
  it.each([
    { ...file(), driveId: "other" }, { ...file(), modifiedTime: "bad" }, { ...file(), md5Checksum: "not-a-checksum" },
    { ...file(), version: 9007199254740993 }, { ...file(), size: "-1" }, { ...file(), size: "9007199254740993" },
  ])("fails closed for invalid file metadata", async raw => {
    await expect(fixture([{ startPageToken: "start" }, { files: [raw] }]).adapter.pull(null)).rejects.toBeInstanceOf(DriveError);
  });
  it("does not follow viewer URLs and strips metadata for files moved out of folder", async () => {
    const f = fixture([{ startPageToken: "start" }, { files: [{ ...file(), parents: ["other"], webViewLink: "https://evil.test" }] }]);
    expect((await f.adapter.pull(null)).items).toEqual([{ id: "file-1", version: "1", available: false, modifiedAt: "2026-09-06T10:00:00.000Z" }]);
  });
  it.each([401, 403, 429, 503, 410, 302])("sanitizes HTTP failure %s", async status => {
    const adapter = new GoogleDriveAdapter(config, "scope", { accessToken: "SECRET", expiresAt: Date.now() + 60_000 }, { request: async url => ({ status, url, body: new TextEncoder().encode("SECRET private-response") }) });
    const error = await adapter.pull(null).catch(e => e);
    expect(error).toBeInstanceOf(DriveError); expect(String(error)).not.toMatch(/SECRET|private-response/);
  });
  it("rejects final URL changes and oversized controlled responses", async () => {
    for (const altered of [{ url: "https://evil.test", body: new Uint8Array() }, { body: new Uint8Array(MAX_DRIVE_RESPONSE + 1) }]) {
      const adapter = new GoogleDriveAdapter(config, "scope", { accessToken: "test", expiresAt: Date.now() + 1000 }, { request: async url => ({ status: 200, url, ...altered }) });
      await expect(adapter.pull(null)).rejects.toBeInstanceOf(DriveError);
    }
  });
  it("distinguishes a Google 403 quota response from an access denial", async () => {
    const adapter = new GoogleDriveAdapter(config, "scope", { accessToken: "test", expiresAt: Date.now() + 1000 }, { request: async url => ({ status: 403, url, body: new TextEncoder().encode(JSON.stringify({ error: { errors: [{ reason: "userRateLimitExceeded" }] } })) }) });
    await expect(adapter.pull(null)).rejects.toMatchObject({ errorClass: "RATE_LIMIT", reason: "RATE_LIMITED" });
  });
  it("rejects expired credentials, disabled mode and invalid configuration without transport", async () => {
    const request = vi.fn();
    await expect(new GoogleDriveAdapter(config, "scope", { accessToken: "test", expiresAt: 0 }, { request }).pull(null)).rejects.toMatchObject({ errorClass: "AUTHENTICATION" });
    await expect(new GoogleDriveAdapter({ ...config, mode: "DISABLED" }, "scope", { accessToken: "test", expiresAt: Date.now() + 1000 }, { request }).pull(null)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled(); expect(() => driveConfiguration({ ...config, driveId: "../other" })).toThrow();
  });
  it("native transport uses only GET, bounded response and redirect error", async () => {
    const response = new Response("{}", { status: 200 }); Object.defineProperty(response, "url", { value: `${DRIVE_API}files` });
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    try { await fetchDriveTransport.request(`${DRIVE_API}files`, "test"); expect(fetch).toHaveBeenCalledWith(`${DRIVE_API}files`, expect.objectContaining({ method: "GET", redirect: "error", headers: { Authorization: "Bearer test", Accept: "application/json" } })); }
    finally { fetch.mockRestore(); }
  });
});
