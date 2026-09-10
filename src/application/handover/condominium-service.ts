import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import {
  createCondominiumSetupSchema,
  transitionCondominiumSetupSchema,
  type CreateCondominiumSetupInput,
  type TransitionCondominiumSetupInput,
} from "@/domain/handover/schemas";

/**
 * Fase 9R — Chaves: implantação do condomínio. Evento único de constituição e
 * transferência de responsabilidade da incorporadora para o condomínio — não é gestão
 * contínua (fora do escopo da 9R). Reaproveita `Supplier` (9C) para a administradora.
 */

const mutableRoles = new Set(["OWNER", "ADMIN", "ANALYST"]);
const TERMINAL_STATUSES = new Set(["IMPLEMENTED", "CANCELLED"]);
const json = (value: unknown) => value as Prisma.InputJsonValue;

function assertMutable(context: Pick<AuthContext, "role">) {
  if (!mutableRoles.has(context.role)) throw new Error("Seu perfil não pode alterar a implantação do condomínio.");
}

/** Mesma convenção de `repasse-service.ts`: `correlationId` sempre gerado no servidor, `metadata` allowlisted, `before`/`after` só com estado da entidade. */
const audit = (
  context: Pick<AuthContext, "organizationId" | "userId">,
  projectId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  after: unknown,
  extra: { before?: unknown; correlationId: string },
) => ({
  organizationId: context.organizationId, userId: context.userId, projectId, action, entityType, entityId,
  after: after === undefined ? undefined : json(after),
  ...(extra.before !== undefined ? { before: json(extra.before) } : {}),
  metadata: json({ correlationId: extra.correlationId, operationType: action }),
});
const newCorrelationId = () => randomUUID();

async function projectForTenant(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  return project;
}
async function supplierForTenant(organizationId: string, supplierId: string) {
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, organizationId } });
  if (!supplier) throw new Error("Fornecedor não encontrado nesta organização.");
  return supplier;
}
async function condominiumSetupForTenant(organizationId: string, condominiumSetupId: string) {
  const setup = await prisma.condominiumSetup.findFirst({ where: { id: condominiumSetupId, organizationId } });
  if (!setup) throw new Error("Implantação de condomínio não encontrada nesta organização.");
  return setup;
}

export async function createCondominiumSetup(context: AuthContext, raw: CreateCondominiumSetupInput) {
  assertMutable(context);
  const input = createCondominiumSetupSchema.parse(raw);
  const project = await projectForTenant(context.organizationId, input.projectId);
  if (input.administratorSupplierId) await supplierForTenant(context.organizationId, input.administratorSupplierId);
  const existing = await prisma.condominiumSetup.findUnique({ where: { projectId: project.id } });
  if (existing) throw new Error("Este empreendimento já tem uma implantação de condomínio registrada.");
  const setup = await prisma.condominiumSetup.create({
    data: {
      organizationId: context.organizationId, projectId: project.id, responsibleId: input.responsibleId,
      administratorSupplierId: input.administratorSupplierId ?? null, notes: input.notes ?? null, createdById: context.userId,
    },
  });
  await prisma.auditLog.create({
    data: audit(context, project.id, "CONDOMINIUM_SETUP_CREATED", "CondominiumSetup", setup.id,
      { status: setup.status, administratorSupplierId: setup.administratorSupplierId }, { correlationId: newCorrelationId() }),
  });
  return setup;
}

/** IMPLEMENTED e CANCELLED são terminais — nenhuma transição sai deles (evita reabrir uma transferência já concluída). */
export async function transitionCondominiumSetup(context: AuthContext, raw: TransitionCondominiumSetupInput) {
  assertMutable(context);
  const input = transitionCondominiumSetupSchema.parse(raw);
  const setup = await condominiumSetupForTenant(context.organizationId, input.condominiumSetupId);
  if (TERMINAL_STATUSES.has(setup.status)) throw new Error("Esta implantação de condomínio já está em estado terminal e não pode mudar de status.");
  if (input.administratorSupplierId) await supplierForTenant(context.organizationId, input.administratorSupplierId);
  if (input.status === "IMPLEMENTED" && !input.transferredAt) throw new Error("Informe a data de transferência de responsabilidade para marcar como implantado.");

  const result = await prisma.condominiumSetup.updateMany({
    where: { id: setup.id, status: setup.status },
    data: {
      status: input.status,
      administratorSupplierId: input.administratorSupplierId === undefined ? undefined : input.administratorSupplierId,
      constitutedAt: input.constitutedAt === undefined ? undefined : input.constitutedAt,
      transferredAt: input.transferredAt === undefined ? undefined : input.transferredAt,
      notes: input.notes === undefined ? undefined : input.notes,
    },
  });
  if (result.count === 0) throw new Error("O status mudou — outra operação o alterou primeiro.");
  await prisma.auditLog.create({
    data: audit(context, setup.projectId, "CONDOMINIUM_SETUP_TRANSITIONED", "CondominiumSetup", setup.id,
      { status: input.status, transferredAt: input.transferredAt ?? null }, { before: { status: setup.status }, correlationId: newCorrelationId() }),
  });
  return prisma.condominiumSetup.findUniqueOrThrow({ where: { id: setup.id } });
}

export async function getCondominiumSetupForProject(context: Pick<AuthContext, "organizationId">, projectId: string) {
  await projectForTenant(context.organizationId, projectId);
  return prisma.condominiumSetup.findUnique({ where: { projectId } });
}
