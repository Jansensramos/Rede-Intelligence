import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { migrationManifest, verifyMigrationManifest } from './release-manifest.mjs';
import { configurationChecks, releaseDecision, safeReleaseIdentity } from '../src/domain/release/local-readiness.ts';
// Environment is supplied only to this process. This command never reads or writes .env.
const checks = configurationChecks(process.env);
const identity = safeReleaseIdentity(process.env);
checks.push({ code: 'RELEASE_IDENTITY', ok: !!identity.commit && !!identity.build });
let manifest;
try {
  manifest = JSON.parse(readFileSync('docs/PHASE_9Q2A_MIGRATION_MANIFEST.json', 'utf8'));
  checks.push({ code: 'MIGRATION_FILES', ok: verifyMigrationManifest(manifest, migrationManifest()) });
} catch { checks.push({ code: 'MIGRATION_FILES', ok: false }); }
if (checks.find(c => c.code === 'LOCAL_DATABASE')?.ok && manifest) {
  const db = new PrismaClient();
  try {
    const rows = await db.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`;
    const active = rows.filter(r => !r.rolled_back_at);
    checks.push({ code: 'DATABASE_MIGRATIONS', ok: active.length === manifest.length && active.every((r, i) => r.finished_at && r.migration_name === manifest[i].name && [manifest[i].checksum, manifest[i].windowsChecksum].includes(r.checksum)) });
  } catch { checks.push({ code: 'DATABASE_MIGRATIONS', ok: false }); }
  finally { await db.$disconnect(); }
} else checks.push({ code: 'DATABASE_MIGRATIONS', ok: false });
const result = { ...releaseDecision(checks), identity, correlationId: randomUUID(), checkedAt: new Date().toISOString() };
console.log(JSON.stringify(result)); process.exitCode = result.localReady ? 0 : 1;
