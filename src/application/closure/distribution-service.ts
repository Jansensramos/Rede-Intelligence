import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { validateDistributionAgainstAvailable, type EvidenceValue } from "@/domain/closure/result";
import {
  createProjectClosureDistributionSchema, approveProjectClosureDistributionSchema,
  type CreateProjectClosureDistributionInput, type ApproveProjectClosureDistributionInput,
} from "@/domain/closure/schemas";

/**
 * Fase 9S — distribuição final simples (decisão 8: sem waterfall/hurdle/carry).
 * Nenhuma transferência bancária real é disparada — só o registro da decisão e da
 * evidência (decisão do escopo, item 5). Aportes e devoluções são registrados nesta
 * fase exclusivamente por aqui (decisão 6) — nunca inferidos.
 */

const mutableRoles = new Set(["OWNER", "ADMIN", "ANALYST"]);
const approverRoles = new Set(["OWNER", "ADMIN"]);
const json = (value: unknown) => value as Prisma.InputJsonValue;

function assertMutable(context: Pick<AuthContext, "role">) {
  if (!mutableRoles.has(context.role)) throw new Error("Seu perfil não pode registrar distribuições do encerramento.");
}
function assertApprover(context: Pick<AuthContext, "role">) {
  if (!approverRoles.has(context.role)) throw new Error("Seu perfil não pode aprovar distribuições do encerramento.");
}

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

async function closureResultForTenant(organizationId: string, closureResultId: string) {
  const result = await prisma.projectClosureResult.findFirst({ where: { id: closureResultId, organizationId } });
  if (!result) throw new Error("Encerramento não encontrado nesta organização.");
  return result;
}
async function distributionForTenant(organizationId: string, distributionId: string) {
  const distribution = await prisma.projectClosureDistribution.findFirst({ where: { id: distributionId, organizationId } });
  if (!distribution) throw new Error("Distribuição não encontrada nesta organização.");
  return distribution;
}

function toEvidenceValue(value: Prisma.Decimal | null): EvidenceValue {
  return value === null ? { status: "SEM_EVIDENCIA", value: null } : { status: "COM_EVIDENCIA", value: value.toString() };
}

/** Soma `APPROVED` já existente, por natureza — usada para validar a nova solicitação contra o disponível.
 * Exportada para reuso em `closure-service.ts` (revalidação agregada na aprovação final — correção Alto #3). */
export async function loadDistributionTotals(client: Prisma.TransactionClient | typeof prisma, organizationId: string, projectId: string, closureResultId: string) {
  const [contributed, returned, resultBased] = await Promise.all([
    client.projectClosureDistribution.aggregate({ where: { organizationId, projectId, nature: "CAPITAL_CONTRIBUTION", status: "APPROVED" }, _sum: { amount: true } }),
    client.projectClosureDistribution.aggregate({ where: { organizationId, projectId, nature: "CAPITAL_RETURN", status: "APPROVED" }, _sum: { amount: true } }),
    client.projectClosureDistribution.aggregate({ where: { organizationId, closureResultId, nature: { in: ["REMUNERATION", "RESULT_DISTRIBUTION", "RETENTION", "PROVISION"] }, status: "APPROVED" }, _sum: { amount: true } }),
  ]);
  return {
    existingApprovedCapitalContributed: (contributed._sum.amount ?? new Prisma.Decimal(0)).toString(),
    existingApprovedCapitalReturned: (returned._sum.amount ?? new Prisma.Decimal(0)).toString(),
    existingApprovedResultBased: (resultBased._sum.amount ?? new Prisma.Decimal(0)).toString(),
  };
}

export async function createProjectClosureDistribution(context: AuthContext, raw: CreateProjectClosureDistributionInput) {
  assertMutable(context);
  const input = createProjectClosureDistributionSchema.parse(raw);
  const closureResult = await closureResultForTenant(context.organizationId, input.closureResultId);
  if (closureResult.status !== "DRAFT" && closureResult.status !== "FINAL") throw new Error("Estado de encerramento inválido para registrar distribuição.");

  const totals = await loadDistributionTotals(prisma, context.organizationId, closureResult.projectId, closureResult.id);
  const validation = validateDistributionAgainstAvailable({
    nature: input.nature, amount: input.amount, ...totals, realizedResult: toEvidenceValue(closureResult.realizedResult),
  });
  if (!validation.allowed) throw new Error(validation.reason ?? "Distribuição recusada.");

  const correlationId = newCorrelationId();
  const created = await prisma.projectClosureDistribution.create({
    data: {
      organizationId: context.organizationId, projectId: closureResult.projectId, closureResultId: closureResult.id, status: "DRAFT",
      beneficiaryName: input.beneficiaryName, beneficiaryTaxId: input.beneficiaryTaxId, beneficiaryType: input.beneficiaryType,
      nature: input.nature, amount: input.amount, eventDate: input.eventDate, sourceType: input.sourceType, sourceId: input.sourceId,
      evidenceRefs: json(input.evidenceRefs), correlationId, createdById: context.userId,
    },
  });
  await prisma.auditLog.create({
    data: audit(context, closureResult.projectId, "PROJECT_CLOSURE_DISTRIBUTION_CREATED", "ProjectClosureDistribution", created.id,
      { nature: created.nature, amount: created.amount.toString(), beneficiaryType: created.beneficiaryType }, { correlationId }),
  });
  return created;
}

function isTransientWriteConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}
function jitterDelay(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 60)));
}
const APPROVE_MAX_ATTEMPTS = 3;

/** Erro classificado (mesmo padrão de `ClosurePreparationError` em `closure-service.ts` —
 * não reexportado de lá para evitar import circular entre os dois serviços). `reasonCode`
 * estático e seguro, `correlationId` sempre gerado no servidor. */
export class DistributionApprovalError extends Error {
  constructor(message: string, readonly reasonCode: "CONCURRENCY_CONFLICT", readonly correlationId: string) {
    super(message);
    this.name = "DistributionApprovalError";
  }
}

/** Aprovação — CAS + revalidação do teto dentro da transação Serializable (mesma disciplina de
 * concorrência do encerramento), com retry limitado só para conflito serializável real (P2034) —
 * nunca para uma recusa de negócio (segregação de função, teto excedido, estado inválido), que
 * nunca é transiente e nunca deve ser reexecutada. */
export async function approveProjectClosureDistribution(context: AuthContext, raw: ApproveProjectClosureDistributionInput) {
  assertApprover(context);
  const input = approveProjectClosureDistributionSchema.parse(raw);
  const distribution = await distributionForTenant(context.organizationId, input.distributionId);
  const correlationId = newCorrelationId();

  for (let attempt = 1; attempt <= APPROVE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const current = await tx.projectClosureDistribution.findUniqueOrThrow({ where: { id: distribution.id } });
        if (current.status === "APPROVED") return current; // idempotente
        if (current.status !== "DRAFT") throw new Error("Somente uma distribuição em rascunho pode ser aprovada.");
        if (current.createdById === context.userId) throw new Error("Quem registrou a distribuição não pode ser o mesmo a aprová-la — segregação de função obrigatória.");

        const closureResult = await tx.projectClosureResult.findUniqueOrThrow({ where: { id: current.closureResultId } });
        const totals = await loadDistributionTotals(tx, context.organizationId, current.projectId, current.closureResultId);
        const validation = validateDistributionAgainstAvailable({
          nature: current.nature, amount: current.amount.toString(), ...totals, realizedResult: toEvidenceValue(closureResult.realizedResult),
        });
        if (!validation.allowed) throw new Error(validation.reason ?? "Distribuição recusada na revalidação.");

        const result = await tx.projectClosureDistribution.updateMany({ where: { id: current.id, status: "DRAFT" }, data: { status: "APPROVED", approvedById: context.userId, approvedAt: new Date() } });
        if (result.count === 0) throw new Error("A distribuição mudou de estado — outra operação a alterou primeiro.");
        await tx.auditLog.create({
          data: audit(context, current.projectId, "PROJECT_CLOSURE_DISTRIBUTION_APPROVED", "ProjectClosureDistribution", current.id,
            { nature: current.nature, amount: current.amount.toString() }, { before: { status: current.status }, correlationId }),
        });
        return tx.projectClosureDistribution.findUniqueOrThrow({ where: { id: current.id } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
    } catch (error) {
      if (!isTransientWriteConflict(error)) throw error; // erro desconhecido propaga imediatamente, nunca reclassificado
      // Mesma correção do bug encontrado na autorrevisão adversarial de `prepareProjectClosureResult`:
      // no esgotamento do retry, o conflito de serialização deve virar erro classificado, nunca o
      // `PrismaClientKnownRequestError` bruto do Prisma.
      if (attempt === APPROVE_MAX_ATTEMPTS) {
        throw new DistributionApprovalError("Não foi possível concluir a aprovação da distribuição após múltiplas tentativas — conflito de concorrência persistente.", "CONCURRENCY_CONFLICT", correlationId);
      }
      await jitterDelay(attempt);
    }
  }
  throw new DistributionApprovalError("Não foi possível concluir a aprovação da distribuição após múltiplas tentativas — conflito de concorrência persistente.", "CONCURRENCY_CONFLICT", correlationId);
}

export async function listProjectClosureDistributions(context: Pick<AuthContext, "organizationId">, closureResultId: string) {
  await closureResultForTenant(context.organizationId, closureResultId);
  return prisma.projectClosureDistribution.findMany({ where: { organizationId: context.organizationId, closureResultId }, orderBy: { createdAt: "desc" } });
}
