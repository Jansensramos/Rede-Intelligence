import { createConfiguredFileStorage } from "./design-file-storage";

/**
 * Reaproveita o `FileStorageProvider` genérico já existente (`design-file-storage.ts`) — mesma
 * classe, mesmo contrato `put`/`read`/`size`, só uma segunda instância com raiz própria
 * (`.rede-storage/contracts`). Nenhum storage novo foi criado: `ContractDocument` guarda apenas
 * `storageProvider`+`storageKey`+`checksum`+`fileSize` (metadado); o binário do documento nunca
 * entra no Postgres.
 */
export const contractFileStorage = createConfiguredFileStorage("contracts");
