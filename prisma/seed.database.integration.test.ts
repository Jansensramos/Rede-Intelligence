import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { START_BUTANTA_PROJECT } from "@/domain/financial/demo";
import { evaluateUnitDeliveryReadiness } from "@/application/handover/delivery-gate-service";

/**
 * Correção focal de CI (2026-09-10) — o run do GitHub Actions falhou em
 * `prisma db seed` porque `prisma/seed.ts` chamava `markUnitDelivered` para a
 * unidade demonstrativa TOR-A-1301 sem uma `SalesUnitInspection` genuinamente
 * elegível: a vistoria fixture tinha `scheduledAt` fixo no calendário
 * ("2026-09-20"), que o gate técnico corrigido da 9R (achado Alto da
 * reauditoria) rejeita como futuro sempre que o seed roda antes dessa data —
 * exatamente o caso de um runner de CI partindo de um banco vazio.
 *
 * Este teste reproduz o cenário real do CI: 36 migrations aplicadas num banco
 * Postgres totalmente vazio, seguidas do `prisma db seed` real (sem mocks),
 * contra um banco físico isolado e descartável — nunca o banco de teste
 * compartilhado pelo resto da suíte (que outros arquivos de teste já povoam;
 * resetá-lo aqui corromperia as fixtures deles).
 *
 * Requer que o usuário conectado (ou `BACKUP_ADMIN_USER`/`BACKUP_ADMIN_PASSWORD`,
 * mesma convenção de `scripts/backup-local-database.mjs`) tenha `CREATEDB` —
 * verdadeiro por padrão no serviço Postgres do CI (usuário `postgres`), mas não
 * no usuário `rede_app` local sem credenciais administrativas explícitas. Sem
 * elas localmente, este describe é pulado (mesma convenção de
 * `describe.skipIf(!process.env.DATABASE_URL)` já usada no resto do projeto) —
 * nunca falha por ausência de privilégio, só por defeito real.
 */

interface AdminConnection {
  adminUrl: string;
  probeUrlFor: (databaseName: string) => string;
  appUser: string;
}

function resolveAdminConnection(): AdminConnection {
  const base = new URL(process.env.DATABASE_URL!);
  const appUser = decodeURIComponent(base.username);
  const adminUser = process.env.BACKUP_ADMIN_USER ?? appUser;
  const adminPassword = process.env.BACKUP_ADMIN_PASSWORD ?? decodeURIComponent(base.password);
  const admin = new URL(base.toString());
  admin.username = encodeURIComponent(adminUser);
  admin.password = encodeURIComponent(adminPassword);
  admin.pathname = "/postgres";
  const probeUrlFor = (databaseName: string) => {
    const probe = new URL(base.toString());
    probe.pathname = `/${databaseName}`;
    return probe.toString();
  };
  return { adminUrl: admin.toString(), probeUrlFor, appUser };
}

async function createEmptyDatabase(admin: AdminConnection, name: string) {
  const client = new PrismaClient({ datasources: { db: { url: admin.adminUrl } } });
  try {
    await client.$executeRawUnsafe(`CREATE DATABASE "${name}" OWNER "${admin.appUser}"`);
  } finally {
    await client.$disconnect();
  }
}

async function dropDatabase(admin: AdminConnection, name: string) {
  const client = new PrismaClient({ datasources: { db: { url: admin.adminUrl } } });
  try {
    await client.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
  } finally {
    await client.$disconnect();
  }
}

function runNode(args: string[], env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, args, { cwd: process.cwd(), env: { ...process.env, ...env }, encoding: "utf8", timeout: 180_000 });
}

const requireFromHere = createRequire(import.meta.url);

function runMigrateDeploy(databaseUrl: string) {
  const prismaCli = requireFromHere.resolve("prisma/build/index.js");
  return runNode([prismaCli, "migrate", "deploy"], { DATABASE_URL: databaseUrl });
}

function runSeed(databaseUrl: string, extraEnv: Record<string, string | undefined> = {}) {
  return runNode(["--import", "./scripts/patch-node-os.mjs", "--import", "tsx", "prisma/seed.ts"], {
    DATABASE_URL: databaseUrl,
    DEMO_SEED_PASSWORD: randomUUID(),
    INTEGRATION_SECRET_KEY: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
    ...extraEnv,
  });
}

const probeDbName = `rede_ci_seed_probe_${randomUUID().replaceAll("-", "")}`;
let admin: AdminConnection | null = null;
let dbReady = false;
let skipReason = "";

try {
  admin = resolveAdminConnection();
  await createEmptyDatabase(admin, probeDbName);
  dbReady = true;
} catch (error) {
  // Só pula quando o motivo é comprovadamente falta de privilégio CREATEDB
  // (SQLSTATE 42501, confirmado por introspecção real contra este mesmo
  // Postgres) — qualquer outra causa (rede, sintaxe, nome já existente) é um
  // defeito real e deve propagar, nunca virar um skip silencioso.
  const isPermissionDenied = (error as { code?: string; meta?: { code?: string } }).code === "P2010" && (error as { meta?: { code?: string } }).meta?.code === "42501";
  if (!isPermissionDenied) throw error;
  skipReason = "sem privilégio CREATEDB local (defina BACKUP_ADMIN_USER/BACKUP_ADMIN_PASSWORD para exercer este teste localmente; o CI já roda como um usuário com CREATEDB)";
}

describe.skipIf(!dbReady)(`Correção focal de CI 9R — seed real em banco vazio após as 36 migrations${dbReady ? "" : ` (pulado: ${skipReason})`}`, () => {
  let probeUrl: string;
  let probeClient: PrismaClient;

  beforeAll(async () => {
    probeUrl = admin!.probeUrlFor(probeDbName);
    const migrated = runMigrateDeploy(probeUrl);
    if (migrated.status !== 0) throw new Error(`prisma migrate deploy falhou no banco de sondagem: ${migrated.stdout}\n${migrated.stderr}`);
    probeClient = new PrismaClient({ datasources: { db: { url: probeUrl } } });
  }, 120_000);

  afterAll(async () => {
    await probeClient?.$disconnect();
    if (admin) await dropDatabase(admin, probeDbName);
  }, 60_000);

  async function findDemoFixture() {
    const organization = await probeClient.organization.findUniqueOrThrow({ where: { slug: "rede-nucleo-de-negocios" } });
    const project = await probeClient.project.findUniqueOrThrow({ where: { organizationId_name: { organizationId: organization.id, name: START_BUTANTA_PROJECT.projectName } } });
    const unit = await probeClient.salesUnit.findUniqueOrThrow({ where: { projectId_code: { projectId: project.id, code: "TOR-A-1301" } } });
    const sale = await probeClient.sale.findFirstOrThrow({ where: { salesUnitId: unit.id, status: { not: "CANCELLED" } } });
    return { organization, project, unit, sale };
  }

  it("primeira execução: seed aprovado, unidade entregue somente depois da vistoria válida, gate técnico/jurídico/financeiro APTO no termo", async () => {
    const seeded = runSeed(probeUrl);
    expect(seeded.status, `seed falhou:\n${seeded.stdout}\n${seeded.stderr}`).toBe(0);

    const { organization, project, unit, sale } = await findDemoFixture();

    const inspection = await probeClient.salesUnitInspection.findFirstOrThrow({ where: { salesUnitId: unit.id, saleId: sale.id } });
    expect(inspection.salesUnitId).toBe(unit.id);
    expect(inspection.saleId).toBe(sale.id);
    expect(inspection.outcome).toBe("ACCEPTED");
    expect(inspection.nextInspectionAt).toBeNull();
    expect(inspection.scheduledAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(JSON.stringify(inspection.checklist)).toContain("_seedFixture"); // marcada explicitamente como fixture de seed (regra 3 da correção)

    const deliveredUnit = await probeClient.salesUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(deliveredUnit.status).toBe("ENTREGUE");

    const deliveryLogs = await probeClient.auditLog.findMany({ where: { organizationId: organization.id, entityType: "SalesUnit", entityId: unit.id, action: "SALES_UNIT_DELIVERED" } });
    expect(deliveryLogs).toHaveLength(1);
    const snapshot = deliveryLogs[0].after as { deliveryGateSnapshot?: { technical: { status: string }; legal: { status: string }; financial: { status: string } } };
    expect(snapshot.deliveryGateSnapshot?.technical.status).toBe("APTO");
    expect(snapshot.deliveryGateSnapshot?.legal.status).toBe("APTO");
    expect(snapshot.deliveryGateSnapshot?.financial.status).toBe("APTO");

    const readiness = await evaluateUnitDeliveryReadiness(probeClient, organization.id, project.id, unit.id, sale.id);
    expect(readiness.overall).toBe("APTO");
  }, 240_000);

  it("segunda execução do seed no mesmo banco: idempotente — exatamente uma vistoria equivalente, uma entrega, nenhuma duplicação de termo/AuditLog", async () => {
    const { organization, unit, sale } = await findDemoFixture();
    const inspectionsBefore = await probeClient.salesUnitInspection.count({ where: { salesUnitId: unit.id, saleId: sale.id } });
    const deliveryLogsBefore = await probeClient.auditLog.count({ where: { organizationId: organization.id, entityType: "SalesUnit", entityId: unit.id, action: "SALES_UNIT_DELIVERED" } });

    const seededAgain = runSeed(probeUrl);
    expect(seededAgain.status, `segunda execução do seed falhou:\n${seededAgain.stdout}\n${seededAgain.stderr}`).toBe(0);

    const inspectionsAfter = await probeClient.salesUnitInspection.count({ where: { salesUnitId: unit.id, saleId: sale.id } });
    const deliveryLogsAfter = await probeClient.auditLog.count({ where: { organizationId: organization.id, entityType: "SalesUnit", entityId: unit.id, action: "SALES_UNIT_DELIVERED" } });
    expect(inspectionsAfter).toBe(inspectionsBefore);
    expect(inspectionsAfter).toBe(1);
    expect(deliveryLogsAfter).toBe(deliveryLogsBefore);
    expect(deliveryLogsAfter).toBe(1);

    const deliveredUnit = await probeClient.salesUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(deliveredUnit.status).toBe("ENTREGUE");
  }, 240_000);

  it("produção continua recusando o seed demonstrativo — nenhum dado é criado, mesma proteção pré-existente", () => {
    const refused = runSeed(probeUrl, { NODE_ENV: "production" });
    expect(refused.status).not.toBe(0);
    expect(`${refused.stdout}${refused.stderr}`).toMatch(/proibido em produção/);
  });

  it("nenhum dado de outro tenant satisfaz o gate — a vistoria real da fixture nunca é encontrada com o organizationId de outro tenant", async () => {
    const { project, unit, sale } = await findDemoFixture();
    const foreignOrganizationId = `foreign-org-${randomUUID()}`;
    const readiness = await evaluateUnitDeliveryReadiness(probeClient, foreignOrganizationId, project.id, unit.id, sale.id);
    expect(readiness.technical.status).toBe("SEM_EVIDENCIA");
    expect(readiness.technical.snapshot.inspectionId).toBeNull();
  });
});
