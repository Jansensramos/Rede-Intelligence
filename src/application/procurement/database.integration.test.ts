import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { createMeasurement, createOperationalContract, getProcurementWorkspace, approveMeasurementAndGenerateObligation, transitionMeasurement, transitionOperationalContract } from "./procurement-service";
import { createSupplier } from "@/application/financial-ops/financial-service";
import { currentContractValue } from "@/domain/procurement/engine";

const token = randomUUID().slice(0, 8);
let testContractId: string | null = null;
let testMeasurementId: string | null = null;

describe.skipIf(!process.env.DATABASE_URL).sequential("Fase 9C contra PostgreSQL real", () => {
  let context: AuthContext;
  let projectId: string;
  let companyId: string;
  let supplierId: string;
  let budgetLineItemId: string;
  let economicItemId: string | null;
  let costCenterId: string | null;

  beforeAll(async () => {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: "rede-nucleo-de-negocios" } });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "admin@rede.local" } });
    const project = await prisma.project.findUniqueOrThrow({ where: { organizationId_name: { organizationId: organization.id, name: "START BUTANTÃ" } } });
    const line = await prisma.budgetLineItem.findFirstOrThrow({ where: { budget: { projectId: project.id, status: "OFFICIAL" }, totalCost: { gt: 0 } } });
    context = { sessionId: "test", userId: user.id, userName: user.name, userEmail: user.email, organizationId: organization.id, organizationName: organization.name, organizationSlug: organization.slug, role: "OWNER" };
    projectId = project.id; companyId = project.companyId!; budgetLineItemId = line.id; economicItemId = line.economicItemId; costCenterId = line.costCenterId;
    const supplier = await createSupplier(context, { name: `Fornecedor Teste ${token}`, taxId: `TEST-${token}` });
    supplierId = supplier.id;
  });

  afterAll(async () => {
    try {
      if (testMeasurementId) {
        const events = await prisma.financialIntegrationEvent.findMany({ where: { measurementId: testMeasurementId } });
        const payableIds = events.flatMap((event) => event.payableAccountId ? [event.payableAccountId] : []);
        const obligationIds = events.flatMap((event) => event.financialObligationId ? [event.financialObligationId] : []);
        await prisma.financialIntegrationEvent.deleteMany({ where: { measurementId: testMeasurementId } });
        await prisma.payableInstallment.deleteMany({ where: { payableAccountId: { in: payableIds } } });
        await prisma.payableAccount.deleteMany({ where: { id: { in: payableIds } } });
        await prisma.financialObligation.deleteMany({ where: { id: { in: obligationIds } } });
        await prisma.measurementLine.deleteMany({ where: { measurementId: testMeasurementId } });
        await prisma.measurementAdjustment.deleteMany({ where: { measurementId: testMeasurementId } });
        await prisma.measurementCertificate.deleteMany({ where: { id: testMeasurementId } });
      }
      if (testContractId) { await prisma.operationalContractItem.deleteMany({ where: { contractId: testContractId } }); await prisma.operationalContract.deleteMany({ where: { id: testContractId } }); }
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
    } finally { await prisma.$disconnect(); }
  });

  it("mantém fornecedor único por tenant e bloqueia acesso cruzado", async () => {
    await expect(createSupplier(context, { name: "Duplicado", taxId: `TEST-${token}` })).rejects.toThrow();
    const atlas = await prisma.organization.findUniqueOrThrow({ where: { slug: "grupo-atlas" } });
    await expect(getProcurementWorkspace({ organizationId: atlas.id }, projectId)).rejects.toThrow("não encontrado nesta organização");
  });

  it("preserva orçamento, contrato, medição, obrigação e pagamento como estágios distintos", async () => {
    const workspace = await getProcurementWorkspace(context, projectId);
    expect(workspace.summary.budget).toBeGreaterThan(0);
    expect(workspace.summary.contracted).toBeGreaterThan(0);
    expect(workspace.summary.updatedProjection).toBeGreaterThanOrEqual(workspace.summary.contracted);
    expect(workspace.summary.obligated).toBeGreaterThanOrEqual(workspace.summary.paid);
  });

  it("calcula contrato original + aditivo - supressão sem sobrescrever o original", async () => {
    const contract = await prisma.operationalContract.findUniqueOrThrow({ where: { projectId_number: { projectId, number: "CT-2026-001" } }, include: { amendments: true } });
    expect(Number(contract.originalAmount)).toBe(930000);
    expect(currentContractValue(contract.originalAmount, contract.amendments).toNumber()).toBe(980000);
  });

  it("Medição de R$ 200 mil gera exatamente uma obrigação, inclusive em replay", async () => {
    const contract = await createOperationalContract(context, { projectId, companyId, supplierId, number: `CT-TEST-${token}`, title: "Contrato de integração 9C→9B", type: "SERVICE", billingModel: "MEASUREMENT", scope: "Teste isolado e repetível", startsAt: new Date("2026-09-01T00:00:00Z"), endsAt: new Date("2027-09-01T00:00:00Z"), responsibleId: context.userId, items: [{ code: "01", economicItemId, budgetLineItemId, costCenterId, description: "Serviço mensurável", quantity: "1000", unit: "un", unitPrice: "1000" }] });
    testContractId = contract.id;
    for (const next of ["UNDER_REVIEW", "IN_APPROVAL", "APPROVED", "ACTIVE"] as const) await transitionOperationalContract(context, contract.id, next);
    const item = await prisma.operationalContractItem.findFirstOrThrow({ where: { contractId: contract.id } });
    const measurement = await createMeasurement(context, { contractId: contract.id, number: 1, competenceDate: new Date("2026-10-01T00:00:00Z"), periodStart: new Date("2026-09-01T00:00:00Z"), periodEnd: new Date("2026-09-30T00:00:00Z"), issuedAt: new Date("2026-10-01T00:00:00Z"), dueDate: new Date("2026-10-15T00:00:00Z"), lines: [{ contractItemId: item.id, periodQuantity: "200" }] });
    testMeasurementId = measurement.id;
    for (const next of ["SUBMITTED", "IN_TECHNICAL_REVIEW", "TECHNICALLY_APPROVED", "IN_APPROVAL"] as const) await transitionMeasurement(context, measurement.id, next);
    const first = await approveMeasurementAndGenerateObligation(context, measurement.id);
    const second = await approveMeasurementAndGenerateObligation(context, measurement.id);
    expect(second.id).toBe(first.id);
    expect(await prisma.financialIntegrationEvent.count({ where: { measurementId: measurement.id, eventType: "MEASUREMENT_APPROVED" } })).toBe(1);
    const obligation = await prisma.financialObligation.findUniqueOrThrow({ where: { id: first.financialObligationId! } });
    expect(Number(obligation.amount)).toBe(200000);
    expect(await prisma.payableAccount.count({ where: { obligationId: obligation.id } })).toBe(1);
  });
});
