export class DatabaseUrlSafetyError extends Error {}
export function assertNotArchivedDatabase(rawUrl: unknown, label?: string): string | undefined;
export function assertTestDatabaseUrl(rawUrl: string | undefined): string;
