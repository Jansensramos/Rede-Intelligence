import { createConfiguredFileStorage } from "./design-file-storage";

/**
 * Reaproveita o `FileStorageProvider` genérico já existente (mesmo contrato de
 * `contract-file-storage.ts`/`design-file-storage.ts`) — nenhum storage novo. O
 * `PostSaleUpdate` guarda apenas `storageKey`/`checksum`/`fileName`/`mimeType`/
 * `fileSize` (metadado); o binário da evidência antes/depois nunca entra no Postgres.
 */
export const postSaleEvidenceStorage = createConfiguredFileStorage("post-sale-evidence");
