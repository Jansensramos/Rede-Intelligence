import { Prisma } from "@prisma/client";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { configurationChecks, releaseDecision, safeReleaseIdentity, ONBOARDING_STEPS, type OnboardingStep } from "@/domain/release/local-readiness";
import expectedMigrations from "../../../docs/PHASE_9Q2A_MIGRATION_MANIFEST.json";

type Context = Pick<AuthContext, "organizationId" | "userId" | "role">;
export class ReadinessAccessError extends Error { constructor() { super("Seu perfil não possui acesso a esta operação."); } }
async function authorize(tx: Prisma.TransactionClient, context: Context) {
  const member = await tx.organizationMembership.findFirst({ where: { organizationId: context.organizationId, userId: context.userId, isActive: true, user: { isActive: true } }, select: { role: true } });
  if (!member || !["OWNER", "ADMIN"].includes(member.role) || !["OWNER", "ADMIN"].includes(context.role)) throw new ReadinessAccessError();
}
export async function localDatabaseReleaseCheck() {
  const check = configurationChecks(process.env).find(row => row.code === "LOCAL_DATABASE");
  if (!check?.ok) return false;
  try {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`;
    const active = rows.filter(row => !row.rolled_back_at);
    return active.length === expectedMigrations.length && active.every((row, index) => row.finished_at && row.migration_name === expectedMigrations[index].name && [expectedMigrations[index].checksum, expectedMigrations[index].windowsChecksum].includes(row.checksum));
  } catch { return false; }
}
async function facts(tx: Prisma.TransactionClient, organizationId: string) {
  const [projects, users, studies, baselines, integrations] = await Promise.all([
    tx.project.count({ where: { organizationId } }),
    tx.organizationMembership.count({ where: { organizationId, isActive: true, user: { isActive: true } } }),
    tx.viabilityStudy.count({ where: { project: { organizationId } } }),
    tx.operationalBaseline.count({ where: { organizationId, status: "APPROVED" } }),
    tx.connectorInstallation.findMany({ where: { organizationId }, select: { status: true, configuration: true } }),
  ]);
  const localIntegrations = integrations.filter(row => {
    const c = row.configuration as Record<string, unknown> | null;
    return row.status === "PAUSED" || c?.mode === "DISABLED" || c?.mode === "MOCK";
  }).length;
  return { projects, users, studies, baselines, localIntegrations };
}
async function records(tx: Prisma.TransactionClient, organizationId: string) {
  const result = await tx.auditLog.findMany({ where: { organizationId, entityType: "LocalOnboarding", action: "LOCAL_ONBOARDING_ATTESTED" }, select: { entityId: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 100 });
  return ONBOARDING_STEPS.map(step => ({ step, attestedAt: result.find(row => row.entityId === step)?.createdAt ?? null }));
}
export async function getLocalReadiness(context: Context) {
  await authorize(prisma, context);
  const checks = configurationChecks(process.env);
  checks.push({ code: "MIGRATION_INTEGRITY", ok: await localDatabaseReleaseCheck() });
  const identity = safeReleaseIdentity(process.env);
  checks.push({ code: "RELEASE_IDENTITY", ok: !!identity.commit && !!identity.build });
  return prisma.$transaction(async tx => {
    await authorize(tx, context);
    const organizationId = context.organizationId;
    const [jobCounts, deadLetters, quarantine, installations, oldestQueued, observed, onboarding] = await Promise.all([
      tx.integrationJob.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
      tx.integrationDeadLetter.count({ where: { organizationId, resolvedAt: null } }),
      tx.integrationQuarantineItem.count({ where: { organizationId, status: "PENDING" } }),
      tx.connectorInstallation.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
      tx.integrationJob.findFirst({ where: { organizationId, status: "QUEUED" }, orderBy: { scheduledAt: "asc" }, select: { scheduledAt: true } }),
      facts(tx, organizationId), records(tx, organizationId),
    ]);
    const overdueSeconds = oldestQueued ? Math.max(0, Math.floor((Date.now() - oldestQueued.scheduledAt.getTime()) / 1000)) : 0;
    return { ...releaseDecision(checks), identity, correlationId: randomUUID(), migrationCount: expectedMigrations.length, observed, onboarding, metrics: { jobs: jobCounts.map(row => ({ status: row.status, count: row._count._all })), installations: installations.map(row => ({ status: row.status, count: row._count._all })), deadLetters, quarantine, overdueSeconds }, alerts: [deadLetters > 0 ? "DEAD_LETTER_PENDING" : null, quarantine > 0 ? "QUARANTINE_PENDING" : null, overdueSeconds > 300 ? "QUEUE_OVERDUE" : null].filter(Boolean), providerHealth: "REAL_NOT_VERIFIED" };
  });
}
const attestation = z.object({ step: z.enum(ONBOARDING_STEPS), confirmed: z.literal(true) }).strict();
function factAvailable(step: OnboardingStep, observed: Awaited<ReturnType<typeof facts>>) {
  if (step === "USERS_ROLES") return observed.users > 0;
  if (step === "FIRST_PROJECT") return observed.projects > 0;
  if (step === "FIRST_FEASIBILITY") return observed.studies > 0;
  if (step === "APPROVED_BASELINE") return observed.baselines > 0;
  if (step === "LOCAL_INTEGRATION") return observed.localIntegrations > 0;
  return true;
}
export async function attestLocalOnboarding(context: Context, raw: unknown) {
  const input = attestation.safeParse(raw);
  if (!input.success) throw new Error("Confirmação local inválida.");
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id=${context.organizationId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM organization_memberships WHERE organization_id=${context.organizationId} AND user_id=${context.userId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM users WHERE id=${context.userId} FOR SHARE`;
    await authorize(tx, context);
    const observed = await facts(tx, context.organizationId);
    if (!factAvailable(input.data.step, observed)) throw new Error("Conclua o registro correspondente na plataforma antes de confirmar.");
    const current = await records(tx, context.organizationId);
    if (input.data.step === "LOCAL_ACCEPTANCE" && current.some(row => row.step !== "LOCAL_ACCEPTANCE" && !row.attestedAt)) throw new Error("Conclua as etapas anteriores antes do aceite local.");
    if (input.data.step === "LOCAL_ACCEPTANCE" && ONBOARDING_STEPS.some(step => !factAvailable(step, observed))) throw new Error("Revalide os registros do onboarding antes do aceite.");
    if (current.find(row => row.step === input.data.step)?.attestedAt) return { recorded: true, productionReady: false };
    await tx.auditLog.create({ data: { organizationId: context.organizationId, userId: context.userId, entityType: "LocalOnboarding", entityId: input.data.step, action: "LOCAL_ONBOARDING_ATTESTED", metadata: { scope: "9Q.2A_LOCAL", humanAttestation: true, externalEvidence: false } } });
    return { recorded: true, productionReady: false };
  });
}
