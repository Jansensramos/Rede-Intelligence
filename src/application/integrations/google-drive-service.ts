import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { integrationSecretVault } from "@/infrastructure/security/secret-vault";
import { assertIntegrationCapability } from "@/domain/integrations";
import { DRIVE_CODE, DriveError, GoogleDriveAdapter, driveConfiguration, driveHash, driveScope, type DriveTransport, type DrivePage, type DriveItem } from "@/infrastructure/adapters/drive/google-drive";
import { applyProviderRateLimitSignal, checkAndConsumeRateLimit, checkCircuitBreakerGate, recordCircuitBreakerOutcome } from "./resilience-service";
import { registerConnectorDefinition, createConnectorInstallation } from "./integrations-service";

type Context = Pick<AuthContext, "organizationId" | "userId" | "role">;
const json = (v: unknown) => v as Prisma.InputJsonValue;
async function authorize(context: Context, capability: "INTEGRATION_CONFIGURE" | "INTEGRATION_SYNC", tx = prisma) {
  assertIntegrationCapability(context.role, capability);
  const member = await tx.organizationMembership.findFirst({ where: { organizationId: context.organizationId, userId: context.userId, isActive: true, user: { isActive: true } } });
  if (!member) throw new DriveError("AUTHORIZATION", "MEMBERSHIP_UNAVAILABLE");
  assertIntegrationCapability(member.role, capability);
}
export async function createGoogleDriveInstallation(context: Context, input: { name: string; projectId: string; driveId: string; folderId?: string }) {
  await authorize(context, "INTEGRATION_CONFIGURE");
  const configuration = driveConfiguration({ ...input, mode: "DISABLED" });
  await registerConnectorDefinition({ code: DRIVE_CODE, name: "Google Drive", provider: "GOOGLE_DRIVE", category: "OTHER", authMethod: "OAUTH2", capabilities: [{ code: "DOCUMENTS", direction: "INBOUND" }], adapterVersion: "1.0.0", contractVersion: "3.0", sandboxAvailable: false });
  return createConnectorInstallation(context, { name: input.name, projectId: input.projectId, connectorDefinitionCode: DRIVE_CODE, direction: "INBOUND", configuration });
}
export async function configureGoogleDriveInstallation(context: Context, installationId: string, raw: unknown) {
  await authorize(context, "INTEGRATION_CONFIGURE");
  const configuration = driveConfiguration(raw);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM connector_installations WHERE id=${installationId} AND organization_id=${context.organizationId} FOR UPDATE`;
    const installation = await tx.connectorInstallation.findFirst({ where: { id: installationId, organizationId: context.organizationId, connectorDefinition: { code: DRIVE_CODE } } });
    if (!installation) throw new DriveError("AUTHORIZATION", "INSTALLATION_UNAVAILABLE");
    const before = driveConfiguration(installation.configuration);
    const scopeChanged = driveScope(context.organizationId, installationId, before) !== driveScope(context.organizationId, installationId, configuration);
    if (scopeChanged || configuration.mode === "DISABLED") {
      // Old revisions remain in the append-only ledger; current links cannot outlive their scope.
      await tx.connectorDocumentReference.updateMany({ where: { installationId, organizationId: context.organizationId }, data: { webUrl: null } });
    }
    const updated = await tx.connectorInstallation.update({ where: { id: installationId }, data: { configuration: json(configuration), status: configuration.mode === "DISABLED" ? "PAUSED" : "ACTIVE" } });
    await tx.auditLog.create({ data: { organizationId: context.organizationId, userId: context.userId, projectId: installation.projectId, action: "GOOGLE_DRIVE_CONFIGURED", entityType: "ConnectorInstallation", entityId: installationId, before: json(before), after: json({ ...configuration, scopeChanged, scope: driveScope(context.organizationId, installationId, configuration) }) } });
    return { id: updated.id, status: updated.status, mode: configuration.mode };
  });
}

export async function getGoogleDriveConfiguration(context: Context, installationId: string) {
  await authorize(context, "INTEGRATION_CONFIGURE");
  const installation = await prisma.connectorInstallation.findFirst({ where: { id: installationId, organizationId: context.organizationId, connectorDefinition: { code: DRIVE_CODE } } });
  if (!installation) throw new DriveError("AUTHORIZATION", "INSTALLATION_UNAVAILABLE");
  return driveConfiguration(installation.configuration);
}

/** Internal composition boundary. Actions/jobs pass only IDs, never credentials or providers. */
export async function googleDriveProviderForInstallation(context: Context, installationId: string, transport?: DriveTransport, signal?: AbortSignal) {
  await authorize(context, "INTEGRATION_SYNC");
  const installation = await prisma.connectorInstallation.findFirst({ where: { id: installationId, organizationId: context.organizationId, status: "ACTIVE", connectorDefinition: { code: DRIVE_CODE } }, include: { credential: true } });
  if (!installation) throw new DriveError("AUTHORIZATION", "INSTALLATION_UNAVAILABLE");
  const configuration = driveConfiguration(installation.configuration);
  const configurationScope = driveScope(context.organizationId, installationId, configuration);
  // A different OAuth credential must bootstrap its own user changes stream.
  const scope = configuration.mode === "REAL" ? driveHash(`${configurationScope}:${installation.credential?.id}:${installation.credential?.fingerprint}`) : configurationScope;
  if (configuration.mode === "DISABLED") throw new DriveError("BUSINESS_RULE", "DISABLED");
  const fingerprint = driveHash(JSON.stringify([installation.configuration, installation.credential?.id, installation.credential?.updatedAt]));
  if (configuration.mode === "MOCK") return { scope, fingerprint, configuration, mode: configuration.mode, pull: async (): Promise<DrivePage> => ({ items: [], cursor: `mock:${scope}`, hasMore: false }) };
  if (!installation.credential || installation.credential.status !== "ACTIVE" || (installation.credential.expiresAt && installation.credential.expiresAt <= new Date())) throw new DriveError("AUTHENTICATION", "CREDENTIAL_UNAVAILABLE");
  let bundle: { accessToken: string; expiresAt: string; scopes: string[] };
  try {
    bundle = JSON.parse(await integrationSecretVault.read(installation.credential.secretRef));
    if (typeof bundle.accessToken !== "string" || !bundle.accessToken || /[\r\n]/.test(bundle.accessToken) || !Number.isFinite(Date.parse(bundle.expiresAt)) || Date.parse(bundle.expiresAt) <= Date.now() || !Array.isArray(bundle.scopes) || !bundle.scopes.some(s => ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/drive.metadata.readonly"].includes(s))) throw new Error();
  } catch { throw new DriveError("AUTHENTICATION", "CREDENTIAL_INVALID_OR_EXPIRED"); }
  const rateScope = `google-drive:${installationId}`;
  const circuitPolicy = { failureThreshold: 5, cooldownMs: 60_000 };
  // Guard each HTTP request, including all initial-listing and changes pages.
  const baseTransport = transport ?? (await import("@/infrastructure/adapters/drive/google-drive")).fetchDriveTransport;
  const guarded: DriveTransport = { async request(url, token) {
    signal?.throwIfAborted();
    const currentInstallation = await prisma.connectorInstallation.findFirst({ where: { id: installationId, organizationId: context.organizationId, status: "ACTIVE", connectorDefinition: { code: DRIVE_CODE } } });
    if (!currentInstallation || driveScope(context.organizationId, installationId, driveConfiguration(currentInstallation.configuration)) !== configurationScope) throw new DriveError("BUSINESS_RULE", "INSTALLATION_CHANGED");
    const currentCredential = await prisma.credentialReference.findFirst({ where: { id: installation.credential!.id, installationId, organizationId: context.organizationId, status: "ACTIVE", updatedAt: installation.credential!.updatedAt } });
    if (!currentCredential || (currentCredential.expiresAt && currentCredential.expiresAt <= new Date())) throw new DriveError("AUTHENTICATION", "CREDENTIAL_CHANGED");
    const rate = await checkAndConsumeRateLimit(context.organizationId, rateScope, { limit: 100, windowMs: 60_000 });
    if (!rate.allowed) throw new DriveError("RATE_LIMIT", "LOCAL_RATE_LIMIT", rate.retryAfterMs);
    const gate = await checkCircuitBreakerGate(context.organizationId, rateScope, circuitPolicy);
    if (!gate.allow) throw new DriveError("PROVIDER", "CIRCUIT_OPEN", gate.retryAfterMs);
    try {
      const response = await baseTransport.request(url, token, signal);
      await recordCircuitBreakerOutcome(context.organizationId, rateScope, response.status < 500 && response.status !== 429, circuitPolicy);
      if (response.status === 429) await applyProviderRateLimitSignal(context.organizationId, rateScope, 10_000);
      return response;
    } catch (error) { await recordCircuitBreakerOutcome(context.organizationId, rateScope, false, circuitPolicy); if (error instanceof DriveError) throw error; throw new DriveError("NETWORK", "TRANSPORT_UNAVAILABLE"); }
  } };
  const adapter = new GoogleDriveAdapter(configuration, scope, { accessToken: bundle.accessToken, expiresAt: Date.parse(bundle.expiresAt) }, guarded);
  return { scope, fingerprint, configuration, mode: configuration.mode, pull: (cursor: string | null) => adapter.pull(cursor) };
}

async function applyItem(tx: Prisma.TransactionClient, context: Context, installation: { id: string; projectId: string | null; companyId: string | null }, scope: string, item: DriveItem, runId: string) {
  const where = { installationId_externalFileId: { installationId: installation.id, externalFileId: item.id } };
  const existing = await tx.connectorDocumentReference.findUnique({ where });
  if (!item.available && !existing) return;
  const revisionKey = driveHash(JSON.stringify(item));
  const versionKey = { installationId: installation.id, scope, externalFileId: item.id, revisionKey };
  if (!await tx.driveDocumentVersion.findUnique({ where: { installationId_scope_externalFileId_revisionKey: versionKey } })) {
    await tx.driveDocumentVersion.create({ data: { ...versionKey, organizationId: context.organizationId, available: item.available, metadata: json(item) } });
  }
  if (existing?.modifiedAtSource && existing.modifiedAtSource > new Date(item.modifiedAt)) return;
  if (item.available) {
    const data = { name: item.name!, mimeType: item.mimeType, size: item.size !== undefined && item.size <= 2_147_483_647 ? item.size : null, checksum: item.checksum ?? null, externalVersionId: item.version, webUrl: item.webUrl!, modifiedAtSource: new Date(item.modifiedAt) };
    await tx.connectorDocumentReference.upsert({ where, update: data, create: { ...data, organizationId: context.organizationId, installationId: installation.id, provider: "GOOGLE_DRIVE", externalFileId: item.id, companyId: installation.companyId, projectId: installation.projectId, referenceMode: "REFERENCE" } });
  } else if (existing) await tx.connectorDocumentReference.update({ where, data: { webUrl: null, modifiedAtSource: new Date(item.modifiedAt) } });
  await tx.integrationSyncItem.create({ data: { organizationId: context.organizationId, syncRunId: runId, externalType: "DRIVE_FILE", externalId: item.id, result: "APPLIED", checksum: item.checksum ?? null } });
}

export async function syncGoogleDriveInstallation(context: Context, installationId: string, mode: "INCREMENTAL" | "FULL" | "REPLAY" = "INCREMENTAL", signal?: AbortSignal) {
  if (!["INCREMENTAL", "FULL", "REPLAY"].includes(mode)) throw new DriveError("VALIDATION", "INVALID_MODE");
  signal?.throwIfAborted();
  const provider = await googleDriveProviderForInstallation(context, installationId, undefined, signal);
  const owner = randomUUID();
  const leaseKey = { installationId, capability: "GOOGLE_DRIVE_LEASE", partitionKey: "default" };
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM connector_installations WHERE id=${installationId} AND organization_id=${context.organizationId} FOR UPDATE`;
    const lease = await tx.integrationCursor.findUnique({ where: { installationId_capability_partitionKey: leaseKey } });
    if (lease?.cursorValue && JSON.parse(lease.cursorValue).expires > Date.now()) throw new DriveError("RATE_LIMIT", "SYNC_ALREADY_RUNNING", 10_000);
    const cursorValue = JSON.stringify({ owner, expires: Date.now() + 90_000 });
    await tx.integrationCursor.upsert({ where: { installationId_capability_partitionKey: leaseKey }, update: { cursorValue }, create: { ...leaseKey, organizationId: context.organizationId, cursorValue } });
  });
  const run = await prisma.integrationSyncRun.create({ data: { organizationId: context.organizationId, installationId, mode, direction: "INBOUND", status: "RUNNING", triggeredById: context.userId, correlationId: owner } });
  let replayCursor: string | null = null; let applied = 0;
  try {
    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      const page = await prisma.$transaction(async tx => {
        signal?.throwIfAborted();
        await tx.$queryRaw`SELECT id FROM connector_installations WHERE id=${installationId} AND organization_id=${context.organizationId} FOR UPDATE`;
        const lease = await tx.integrationCursor.findUnique({ where: { installationId_capability_partitionKey: leaseKey } });
        if (!lease?.cursorValue || JSON.parse(lease.cursorValue).owner !== owner) throw new DriveError("BUSINESS_RULE", "LEASE_LOST");
        const current = await tx.connectorInstallation.findFirst({ where: { id: installationId, organizationId: context.organizationId, status: "ACTIVE" }, include: { credential: true } });
        if (!current || driveHash(JSON.stringify([current.configuration, current.credential?.id, current.credential?.updatedAt])) !== provider.fingerprint) throw new DriveError("BUSINESS_RULE", "INSTALLATION_CHANGED");
        await tx.$queryRaw`SELECT id FROM organization_memberships WHERE organization_id=${context.organizationId} AND user_id=${context.userId} FOR SHARE`;
        const member = await tx.organizationMembership.findFirst({ where: { organizationId: context.organizationId, userId: context.userId, isActive: true, user: { isActive: true } } });
        if (!member) throw new DriveError("AUTHORIZATION", "MEMBERSHIP_UNAVAILABLE");
        assertIntegrationCapability(member.role, "INTEGRATION_SYNC");
        const key = { installationId, capability: "GOOGLE_DRIVE_DOCUMENTS", partitionKey: provider.scope };
        const saved = await tx.integrationCursor.findUnique({ where: { installationId_capability_partitionKey: key } });
        const scanKey = { installationId, capability: "GOOGLE_DRIVE_SCAN", partitionKey: provider.scope };
        let scan = await tx.integrationCursor.findUnique({ where: { installationId_capability_partitionKey: scanKey } });
        if (mode !== "REPLAY" && provider.mode === "REAL" && (!saved?.cursorValue || (mode === "FULL" && pageNumber === 0))) {
          scan = await tx.integrationCursor.upsert({ where: { installationId_capability_partitionKey: scanKey }, update: { cursorValue: run.startedAt.toISOString() }, create: { ...scanKey, organizationId: context.organizationId, cursorValue: run.startedAt.toISOString() } });
        }
        // FULL explicitly resets the stream. Locking and CAS prevent concurrent stale pages.
        const cursor = mode === "REPLAY" ? replayCursor : mode === "FULL" && pageNumber === 0 ? null : saved?.cursorValue ?? null;
        const result = await provider.pull(cursor);
        signal?.throwIfAborted();
        if (result.hasMore && result.cursor === cursor) throw new DriveError("VALIDATION", "CURSOR_NOT_PROGRESSING");
        if (mode !== "REPLAY") {
          for (const item of result.items) await applyItem(tx, context, current, provider.scope, item, run.id);
          await tx.integrationCursor.upsert({ where: { installationId_capability_partitionKey: key }, update: { cursorValue: result.cursor, lastSuccessAt: new Date() }, create: { ...key, organizationId: context.organizationId, cursorValue: result.cursor, lastSuccessAt: new Date() } });
          if (!result.hasMore && scan?.cursorValue && provider.mode === "REAL") {
            const seen = await tx.integrationSyncItem.findMany({ where: { syncRun: { installationId, organizationId: context.organizationId, startedAt: { gte: new Date(scan.cursorValue) } } }, select: { externalId: true } });
            const missing = await tx.connectorDocumentReference.findMany({ where: { installationId, webUrl: { not: null }, externalFileId: { notIn: seen.map(i => i.externalId) } } });
            for (const ref of missing) await applyItem(tx, context, current, provider.scope, { id: ref.externalFileId, available: false, version: `rescan:${run.id}`, modifiedAt: new Date().toISOString() }, run.id);
            await tx.integrationCursor.delete({ where: { id: scan.id } });
          }
        }
        await tx.integrationCursor.update({ where: { installationId_capability_partitionKey: leaseKey }, data: { cursorValue: JSON.stringify({ owner, expires: Date.now() + 90_000 }) } });
        await tx.auditLog.create({ data: { organizationId: context.organizationId, userId: context.userId, projectId: current.projectId, action: mode === "REPLAY" ? "GOOGLE_DRIVE_REPLAY_PAGE" : "GOOGLE_DRIVE_PAGE_APPLIED", entityType: "IntegrationSyncRun", entityId: run.id, after: json({ mode: provider.mode, page: pageNumber, items: result.items.length, hasMore: result.hasMore }) } });
        return result;
      }, { timeout: 60_000, maxWait: 10_000 });
      replayCursor = page.cursor; applied += page.items.length;
      if (!page.hasMore) {
        await prisma.integrationSyncRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", itemsRead: applied, itemsApplied: mode === "REPLAY" ? 0 : applied, cursorAfter: mode === "REPLAY" ? undefined : page.cursor, finishedAt: new Date() } });
        if (mode !== "REPLAY") await prisma.connectorInstallation.updateMany({ where: { id: installationId, organizationId: context.organizationId, status: "ACTIVE", configuration: { equals: json(provider.configuration) } }, data: { lastSyncAt: new Date(), healthStatus: provider.mode === "REAL" ? "HEALTHY" : "UNKNOWN" } });
        return { id: run.id, status: "SUCCEEDED" as const, mode: provider.mode, itemsRead: applied };
      }
    }
    throw new DriveError("RATE_LIMIT", "PAGE_BUDGET_REACHED", 60_000);
  } catch (error) {
    const safe = error instanceof DriveError ? error : new DriveError("VALIDATION", "PAGE_APPLICATION_FAILED");
    await prisma.integrationSyncRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), errorSummary: `${safe.reason}; correlation=${safe.correlationId}` } });
    await prisma.connectorInstallation.updateMany({ where: { id: installationId, organizationId: context.organizationId, status: "ACTIVE", configuration: { equals: json(provider.configuration) } }, data: { healthStatus: "DOWN" } });
    throw safe;
  } finally {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM connector_installations WHERE id=${installationId} AND organization_id=${context.organizationId} FOR UPDATE`;
      const lease = await tx.integrationCursor.findUnique({ where: { installationId_capability_partitionKey: leaseKey } });
      if (lease?.cursorValue && JSON.parse(lease.cursorValue).owner === owner) await tx.integrationCursor.delete({ where: { id: lease.id } });
    });
  }
}
