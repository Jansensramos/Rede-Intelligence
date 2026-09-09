import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { migrationManifest, verifyMigrationManifest } from './release-manifest.mjs';
describe('9Q.2A recovery and manifest safety', () => {
  it.each(['not-a-url-password=hidden', 'postgresql://user:hidden@remote.invalid/main'])('refuses unsafe backup input with sanitized output', value => {
    const result = spawnSync(process.execPath, ['scripts/backup-local-database.mjs', 'DATABASE_URL'], { env: { ...process.env, DATABASE_URL: value }, encoding: 'utf8', windowsHide: true });
    expect(result.status).toBe(1); expect(result.stdout + result.stderr).not.toContain('hidden'); expect(result.stderr).toContain('recusado');
  });
  it('detects old migration edits and extra migrations', () => {
    const actual = migrationManifest(); const expected = JSON.parse(readFileSync('docs/PHASE_9Q2A_MIGRATION_MANIFEST.json', 'utf8'));
    expect(verifyMigrationManifest(expected, actual)).toBe(true); expect(verifyMigrationManifest(expected, [...actual, { name: 'unexpected', checksum: 'bad' }])).toBe(false);
    expect(verifyMigrationManifest(expected, actual.map((row, index) => index === 0 ? { ...row, checksum: 'bad' } : row))).toBe(false);
  });
});
