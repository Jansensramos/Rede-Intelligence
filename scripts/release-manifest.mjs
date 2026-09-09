import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
export function migrationManifest(root = process.cwd()) {
  return readdirSync(join(root, 'prisma/migrations'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => {
    const text = readFileSync(join(root, 'prisma/migrations', d.name, 'migration.sql'), 'utf8').replaceAll('\r\n', '\n');
    return { name: d.name, checksum: createHash('sha256').update(text).digest('hex'), windowsChecksum: createHash('sha256').update(text.replaceAll('\n', '\r\n')).digest('hex') };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
export function verifyMigrationManifest(expected, actual) {
  return Array.isArray(expected) && expected.length > 0 && JSON.stringify(expected) === JSON.stringify(actual);
}
