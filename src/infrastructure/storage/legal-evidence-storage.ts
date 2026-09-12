import { createConfiguredFileStorage } from "./design-file-storage";

/**
 * Reaproveita o `FileStorageProvider` genérico já existente (`design-file-storage.ts`) — mesma
 * classe, mesmo contrato `put`/`read`/`size`, só uma instância própria (`.rede-storage/legal-evidence`).
 * `LegalEvidenceDocument` guarda apenas `storageProvider`+`storageKey`+`checksum`+`sizeBytes`
 * (metadado); o binário nunca entra no Postgres.
 */
export const legalEvidenceStorage = createConfiguredFileStorage("legal-evidence");
