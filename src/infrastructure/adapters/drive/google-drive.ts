import { createHash, randomUUID } from "node:crypto";
import type { RetryableErrorClass } from "@/domain/integrations";

export const DRIVE_CODE = "GOOGLE_DRIVE_V3";
export const DRIVE_API = "https://www.googleapis.com/drive/v3/";
export const MAX_DRIVE_RESPONSE = 2 * 1024 * 1024;
export class DriveError extends Error {
  readonly correlationId = randomUUID();
  constructor(readonly errorClass: RetryableErrorClass, readonly reason: string, readonly retryAfterMs: number | null = null) {
    super(`Google Drive: ${reason}.`);
  }
}
export type DriveConfiguration = { mode: "DISABLED" | "MOCK" | "REAL"; driveId: string; folderId?: string };
export type DriveTransport = { request(url: string, token: string, signal?: AbortSignal): Promise<{ status: number; url: string; body: Uint8Array; retryAfter?: string | null }> };
export type DriveItem = { id: string; version: string; available: boolean; modifiedAt: string; name?: string; mimeType?: string; size?: number; checksum?: string; webUrl?: string };
type Cursor = { scope: string; phase: "FILES" | "CHANGES"; token: string; start?: string };
export type DrivePage = { items: DriveItem[]; cursor: string; hasMore: boolean };
function fail(reason = "INVALID_RESPONSE"): never { throw new DriveError("VALIDATION", reason); }
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const identifier = (v: unknown): string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,256}$/.test(v) ? v : fail("INVALID_IDENTIFIER");
const pageToken = (v: unknown): string => typeof v === "string" && v.length > 0 && v.length <= 4096 && !/[\x00-\x1f]/.test(v) ? v : fail("INVALID_CURSOR");
export const driveHash = (v: string) => createHash("sha256").update(v).digest("hex");
export function driveConfiguration(value: unknown): DriveConfiguration {
  const v = object(value);
  if (!["DISABLED", "MOCK", "REAL"].includes(String(v.mode))) fail("INVALID_CONFIGURATION");
  if (v.driveId === "MY_DRIVE" && !v.folderId) fail("PERSONAL_DRIVE_REQUIRES_FOLDER");
  return { mode: v.mode as DriveConfiguration["mode"], driveId: identifier(v.driveId), ...(v.folderId == null ? {} : { folderId: identifier(v.folderId) }) };
}
export function driveScope(organizationId: string, installationId: string, configuration: DriveConfiguration) {
  return driveHash(JSON.stringify([organizationId, installationId, configuration.mode, configuration.driveId, configuration.folderId ?? null]));
}
export const fetchDriveTransport: DriveTransport = { async request(url, token, signal) {
  // Only constructed Google API URLs enter this transport, never file URLs from responses.
  if (!url.startsWith(DRIVE_API)) fail("UNSAFE_URL");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, redirect: "error", signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    if (reader) try {
      while (true) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > MAX_DRIVE_RESPONSE) fail("RESPONSE_TOO_LARGE"); chunks.push(r.value); }
    } finally { await reader.cancel().catch(() => undefined); }
    const body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    return { status: response.status, url: response.url, body, retryAfter: response.headers.get("retry-after") };
  } catch (error) { if (error instanceof DriveError) throw error; throw new DriveError("NETWORK", "TRANSPORT_UNAVAILABLE"); }
  finally { clearTimeout(timer); }
} };
const fields = "id,driveId,name,mimeType,size,version,modifiedTime,md5Checksum,parents,trashed";

export class GoogleDriveAdapter {
  constructor(readonly configuration: DriveConfiguration, readonly scope: string, private readonly credential: { accessToken: string; expiresAt: number }, private readonly transport: DriveTransport = fetchDriveTransport) {}
  private async get(path: string, params: Record<string, string>) {
    if (this.configuration.mode !== "REAL") fail("REAL_MODE_REQUIRED");
    if (!this.credential.accessToken || this.credential.expiresAt <= Date.now()) throw new DriveError("AUTHENTICATION", "CREDENTIAL_EXPIRED");
    const url = new URL(path, DRIVE_API); for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let response: Awaited<ReturnType<DriveTransport["request"]>>;
    try { response = await this.transport.request(url.href, this.credential.accessToken); }
    catch (e) { if (e instanceof DriveError) throw e; throw new DriveError("NETWORK", "TRANSPORT_UNAVAILABLE"); }
    if (response.url !== url.href) fail("RESPONSE_REDIRECTED");
    if (response.body.length > MAX_DRIVE_RESPONSE) fail("RESPONSE_TOO_LARGE");
    if (response.status === 401) throw new DriveError("AUTHENTICATION", "AUTHENTICATION_FAILED");
    if (response.status === 403) {
      let limited = false;
      try { const error = object(JSON.parse(new TextDecoder().decode(response.body))).error; const errors = object(error).errors; limited = Array.isArray(errors) && errors.some(e => ["rateLimitExceeded", "userRateLimitExceeded"].includes(String(object(e).reason))); } catch { /* Do not expose provider bodies. */ }
      if (limited) throw new DriveError("RATE_LIMIT", "RATE_LIMITED", 10_000);
      throw new DriveError("AUTHORIZATION", "ACCESS_DENIED");
    }
    if (response.status === 429) throw new DriveError("RATE_LIMIT", "RATE_LIMITED", Math.max(1000, Math.min(60_000, Number(response.retryAfter) * 1000 || 10_000)));
    if (response.status >= 500) throw new DriveError("PROVIDER", "PROVIDER_UNAVAILABLE");
    if (response.status === 410) fail("CURSOR_RESCAN_REQUIRED");
    if (response.status !== 200 || response.body.length > MAX_DRIVE_RESPONSE) fail();
    try { return object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body))); }
    catch (e) { if (e instanceof DriveError) throw e; return fail(); }
  }
  private file(raw: unknown): DriveItem {
    const v = object(raw); const id = identifier(v.id);
    if (this.configuration.driveId !== "MY_DRIVE" && v.driveId !== this.configuration.driveId) fail("CROSSED_DRIVE");
    if (typeof v.modifiedTime !== "string" || !Number.isFinite(Date.parse(v.modifiedTime))) fail();
    if (typeof v.version !== "string" || !/^\d+$/.test(v.version)) fail();
    if (!Array.isArray(v.parents) || !v.parents.every(p => typeof p === "string")) fail();
    const base = { id, version: v.version, modifiedAt: new Date(v.modifiedTime).toISOString() };
    if (v.trashed === true || (this.configuration.folderId && !v.parents.includes(this.configuration.folderId)) || (this.configuration.driveId === "MY_DRIVE" && v.driveId !== undefined)) return { ...base, available: false };
    if (typeof v.name !== "string" || !v.name || v.name.length > 1024 || typeof v.mimeType !== "string" || v.mimeType.length > 256) fail();
    if (v.md5Checksum !== undefined && (typeof v.md5Checksum !== "string" || !/^[a-f0-9]{32}$/.test(v.md5Checksum))) fail();
    const size = v.size == null ? undefined : Number(v.size);
    if (size !== undefined && (!Number.isSafeInteger(size) || size < 0 || typeof v.size !== "string")) fail();
    // Construct a restricted viewer URL; never persist provider-supplied arbitrary/public URLs.
    return { ...base, available: true, name: v.name, mimeType: v.mimeType, ...(size === undefined ? {} : { size }), ...(v.md5Checksum ? { checksum: v.md5Checksum as string } : {}), webUrl: `https://drive.google.com/file/d/${id}/view` };
  }
  async pull(encoded: string | null): Promise<DrivePage> {
    let cursor: Cursor;
    if (encoded) {
      try {
        if (encoded.length > 16_384) fail("INVALID_CURSOR");
        const parsed = object(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
        if (parsed.scope !== this.scope || !["FILES", "CHANGES"].includes(String(parsed.phase))) fail("CURSOR_SCOPE_MISMATCH");
        cursor = { scope: this.scope, phase: parsed.phase as Cursor["phase"], token: parsed.phase === "FILES" && parsed.token === "" ? "" : pageToken(parsed.token), ...(parsed.phase === "FILES" ? { start: pageToken(parsed.start) } : {}) };
      } catch (e) { if (e instanceof DriveError) throw e; return fail("INVALID_CURSOR"); }
    } else {
      const start = await this.get("changes/startPageToken", { ...(this.configuration.driveId === "MY_DRIVE" ? {} : { driveId: this.configuration.driveId }), supportsAllDrives: "true" });
      cursor = { scope: this.scope, phase: "FILES", token: "", start: pageToken(start.startPageToken) };
    }
    const personal = this.configuration.driveId === "MY_DRIVE";
    const common = { ...(personal ? {} : { driveId: this.configuration.driveId }), supportsAllDrives: "true", includeItemsFromAllDrives: personal ? "false" : "true", pageSize: "100" };
    if (cursor.phase === "FILES") {
      const result = await this.get("files", { ...common, corpora: personal ? "user" : "drive", spaces: "drive", q: `trashed = false${this.configuration.folderId ? ` and '${this.configuration.folderId}' in parents` : ""}`, fields: `nextPageToken,incompleteSearch,files(${fields})`, ...(cursor.token ? { pageToken: cursor.token } : {}) });
      if (!Array.isArray(result.files) || result.files.length > 100 || result.incompleteSearch === true) fail("INCOMPLETE_LISTING");
      const next: Cursor = result.nextPageToken !== undefined ? { ...cursor, token: pageToken(result.nextPageToken) } : { scope: this.scope, phase: "CHANGES", token: cursor.start! };
      return { items: result.files.map(f => this.file(f)), cursor: Buffer.from(JSON.stringify(next)).toString("base64url"), hasMore: true };
    }
    const result = await this.get("changes", { ...common, ...(personal ? { restrictToMyDrive: "true" } : {}), pageToken: cursor.token, includeRemoved: "true", fields: `nextPageToken,newStartPageToken,changes(fileId,removed,time,changeType,file(${fields}))` });
    if (!Array.isArray(result.changes) || result.changes.length > 100) fail();
    const items: DriveItem[] = [];
    for (const raw of result.changes) {
      const change = object(raw);
      if (change.changeType === "drive") throw new DriveError("AUTHORIZATION", "DRIVE_SCOPE_CHANGED");
      if (change.changeType !== "file" || typeof change.removed !== "boolean") fail();
      const id = identifier(change.fileId);
      if (typeof change.time !== "string" || !Number.isFinite(Date.parse(change.time))) fail();
      if (change.removed) items.push({ id, available: false, modifiedAt: new Date(change.time).toISOString(), version: `removed:${new Date(change.time).toISOString()}` });
      else { const file = this.file(change.file); if (file.id !== id) fail("CROSSED_FILE"); items.push(file); }
    }
    const hasMore = result.nextPageToken !== undefined;
    const next = { ...cursor, token: pageToken(hasMore ? result.nextPageToken : result.newStartPageToken) };
    return { items, cursor: Buffer.from(JSON.stringify(next)).toString("base64url"), hasMore };
  }
}
