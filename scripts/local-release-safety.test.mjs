import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { migrationManifest, verifyMigrationManifest } from './release-manifest.mjs';
describe('9Q.2A recovery and manifest safety', () => {
  it.each(['not-a-url-password=hidden', 'postgresql://user:hidden@remote.invalid/main'])('refuses unsafe backup input with sanitized output', value => {
    const result = spawnSync(process.execPath, ['scripts/backup-local-database.mjs', 'DATABASE_URL'], { env: { ...process.env, DATABASE_URL: value }, encoding: 'utf8', windowsHide: true });
    expect(result.status).toBe(1); expect(result.stdout + result.stderr).not.toContain('hidden'); expect(result.stderr).toContain('recusado');
  });
  // Achado alto da reauditoria 9Q.2B: backup-local-database.mjs tinha uma checagem
  // "archived" duplicada e mais fraca (não cobria "archive"/"archival"); agora usa a
  // mesma política central do runtime (scripts/database-url-safety.mjs). Exercita o
  // processo real via subprocess, não uma reimplementação.
  it.each([
    'postgresql://user:hidden@127.0.0.1:55432/rede_intelligence_test_archived_20260904',
    'postgresql://user:hidden@127.0.0.1:55432/rede_intelligence_archive',
    'postgresql://user:hidden@127.0.0.1:55432/rede_intelligence_archival',
  ])('backup-local-database.mjs refuses an archived-looking database (%s) before touching pg_dump/createdb/pg_restore', value => {
    const result = spawnSync(process.execPath, ['scripts/backup-local-database.mjs', 'DATABASE_URL'], { env: { ...process.env, DATABASE_URL: value }, encoding: 'utf8', windowsHide: true });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain('hidden');
    expect(result.stdout + result.stderr).not.toContain(value);
    expect(result.stderr).toContain('recusado');
  });
  it('detects old migration edits and extra migrations', () => {
    const actual = migrationManifest(); const expected = JSON.parse(readFileSync('docs/PHASE_9Q2A_MIGRATION_MANIFEST.json', 'utf8'));
    expect(verifyMigrationManifest(expected, actual)).toBe(true); expect(verifyMigrationManifest(expected, [...actual, { name: 'unexpected', checksum: 'bad' }])).toBe(false);
    expect(verifyMigrationManifest(expected, actual.map((row, index) => index === 0 ? { ...row, checksum: 'bad' } : row))).toBe(false);
  });
  it('keeps the migration manifest length equal to the real migration count on disk', () => {
    const actual = migrationManifest(); const manifest = JSON.parse(readFileSync('docs/PHASE_9Q2A_MIGRATION_MANIFEST.json', 'utf8'));
    expect(manifest.length).toBe(actual.length);
  });
  it('detects a missing migration (manifest ahead of what actually exists on disk)', () => {
    const actual = migrationManifest(); const expected = JSON.parse(readFileSync('docs/PHASE_9Q2A_MIGRATION_MANIFEST.json', 'utf8'));
    expect(verifyMigrationManifest(expected, actual.slice(0, -1))).toBe(false);
  });
  it('worker.ts refuses to start (non-zero exit, refusal message, no DB touched) when local configuration is inconsistent', () => {
    const env = { ...process.env, DATABASE_URL: 'postgresql://localhost/rede_intelligence', SESSION_SECRET: '', INTEGRATION_SECRET_KEY: '' };
    const result = spawnSync(process.execPath, ['--import', './scripts/patch-node-os.mjs', '--import', 'tsx', 'scripts/worker.ts'], { env, encoding: 'utf8', windowsHide: true, timeout: 20_000 });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('Worker bloqueado');
  });
  // Achado Bloqueador da reauditoria 9Q.2B: DATABASE_URL do worker não tinha nenhuma
  // proteção contra banco arquivado — só TEST_DATABASE_URL era coberta. O guard vive no
  // bootstrap do PrismaClient (importado antes de qualquer outra checagem do worker),
  // então o processo real precisa recusar mesmo antes de "Worker bloqueado".
  it('worker.ts refuses to start with an archived-looking DATABASE_URL, before any other check', () => {
    const env = { ...process.env, DATABASE_URL: 'postgresql://user:hidden@localhost/rede_intelligence_archived_20260904', SESSION_SECRET: 'x'.repeat(32), INTEGRATION_SECRET_KEY: 'y'.repeat(32) };
    const result = spawnSync(process.execPath, ['--import', './scripts/patch-node-os.mjs', '--import', 'tsx', 'scripts/worker.ts'], { env, encoding: 'utf8', windowsHide: true, timeout: 20_000 });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('arquivado');
    expect(result.stdout + result.stderr).not.toContain('hidden');
  });
  // Only the master release contract's expectation table is checked here: it is the one
  // document meant to state a bare current-state count with no surrounding commentary.
  // Other docs (9Q2A contract, Go/No-Go matrix, campaign checkpoints) legitimately quote
  // an old number *as prose discussing the divergence itself* — flagging those would be a
  // false positive against text that already documents the discrepancy correctly.
  it.each([
    'docs/PHASE_9Q_RELEASE_CONTRACT.md',
  ])('flags a stale hardcoded migration count in the living contract %s (vs. the real count on disk)', path => {
    const realCount = migrationManifest().length;
    const text = readFileSync(path, 'utf8');
    const stale = [...text.matchAll(/\b(\d{1,3})\s+migrations?\b/gi)]
      .map(match => Number(match[1]))
      .filter(count => count !== realCount);
    expect(stale, `${path} cites migration count(s) ${JSON.stringify(stale)} that diverge from the real count (${realCount}) — update the doc or confirm it is a dated historical reference, not a current-state claim.`).toEqual([]);
  });
});
