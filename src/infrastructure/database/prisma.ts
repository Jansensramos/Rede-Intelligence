import { PrismaClient } from "@prisma/client";
import { assertNotArchivedDatabase } from "../../../scripts/database-url-safety.mjs";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Choke point real: qualquer código que precise do banco importa este módulo, então
// checar aqui — antes de `new PrismaClient` — cobre web, worker e scripts mesmo que
// algum chamador não tenha passado por `parseRuntimeConfig` primeiro (achado
// Bloqueador da reauditoria 9Q.2B).
assertNotArchivedDatabase(process.env.DATABASE_URL, "DATABASE_URL");

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  transactionOptions: { maxWait: 10_000, timeout: 15_000 },
});

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
