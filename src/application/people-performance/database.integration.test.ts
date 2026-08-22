import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { createPersonProfile, getPeoplePerformanceWorkspace, recordRelationshipCost } from "./people-performance-service";

const token = randomUUID().slice(0, 8);
let createdPersonId: string | null = null;

describe.skipIf(!process.env.DATABASE_URL).sequential("Fase 9F — pessoas, eficiência e causa-raiz contra PostgreSQL real", () => {
  let context: AuthContext;
  let projectId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: "rede-nucleo-de-negocios" } });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "admin@rede.local" } });
    const project = await prisma.project.findUniqueOrThrow({ where: { organizationId_name: { organizationId: organization.id, name: "START BUTANTÃ" } } });
    context = { sessionId: "test", userId: user.id, userName: user.name, userEmail: user.email, organizationId: organization.id, organizationName: organization.name, organizationSlug: organization.slug, role: "OWNER" };
    projectId = project.id;
  });

  afterAll(async () => {
    if (createdPersonId) {
      await prisma.auditLog.deleteMany({ where: { entityType: "PersonProfile", entityId: createdPersonId } });
      await prisma.personProfile.deleteMany({ where: { id: createdPersonId } });
    }
    await prisma.$disconnect();
  });

  it("Cenário crítico: R$ 350 mil planejados, R$ 200 mil realizados e 50% de avanço não vira economia", async () => {
    const workspace = await getPeoplePerformanceWorkspace(context, projectId);
    const variance = workspace.varianceCases.find((item) => item.code === "DESV-9F-001");
    expect(variance).toBeDefined();
    expect(variance?.plannedAmount).toBe(350000);
    expect(variance?.actualAmount).toBe(200000);
    expect(variance?.actualProgress).toBe(0.5);
    expect(variance?.cashVariance).toBe(150000);
    expect(variance?.savingEligible).toBe(false);
  });

  it("preserva causas parciais, evidências e soma causal de 100%", async () => {
    const workspace = await getPeoplePerformanceWorkspace(context, projectId);
    const investigation = workspace.varianceCases.find((item) => item.code === "DESV-9F-001")?.investigation;
    expect(investigation?.hypotheses).toHaveLength(3);
    expect(investigation?.hypotheses.every((item) => item.evidence > 0)).toBe(true);
    expect(investigation?.allocatedCauseRate).toBe(1);
    expect(investigation?.dependencies.length).toBeGreaterThan(0);
    expect(investigation?.actions.length).toBeGreaterThan(0);
  });

  it("comprova rateio administrativo sem residual", async () => {
    const workspace = await getPeoplePerformanceWorkspace(context, projectId);
    expect(workspace.administrativeCosts.some((item) => item.latestProofZero === true && item.latestResidual === 0)).toBe(true);
  });

  it("protege remuneração por capacidade e impede sua alteração por Analista", async () => {
    const viewer = await getPeoplePerformanceWorkspace({ ...context, role: "VIEWER" }, projectId);
    expect(viewer.summary.totalMonthlyCost).toBeNull();
    expect(viewer.people.every((item) => item.monthlyCost === null && item.compensationRestricted)).toBe(true);
    const relationship = await prisma.employmentRelationship.findFirstOrThrow({ where: { organizationId: context.organizationId } });
    await expect(recordRelationshipCost({ ...context, role: "ANALYST" }, { relationshipId: relationship.id, referenceMonth: new Date("2030-01-01"), baseCost: 1, source: "TEST" })).rejects.toThrow(/capacidade/);
    expect(await prisma.relationshipCostSnapshot.count({ where: { relationshipId: relationship.id, referenceMonth: new Date("2030-01-01") } })).toBe(0);
  });

  it("impede leitura cruzada entre organizações", async () => {
    const atlas = await prisma.organization.findUniqueOrThrow({ where: { slug: "grupo-atlas" } });
    const atlasUser = await prisma.user.findUniqueOrThrow({ where: { email: "analista@atlas.local" } });
    await expect(getPeoplePerformanceWorkspace({ organizationId: atlas.id, userId: atlasUser.id, role: "ANALYST" }, projectId)).rejects.toThrow("não encontrado nesta organização");
  });

  it("audita mutação sem registrar remuneração sensível", async () => {
    const person = await createPersonProfile(context, { fullName: `Profissional Teste ${token}`, professionalId: `TEST-${token}` });
    createdPersonId = person.id;
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "PersonProfile", entityId: person.id, action: "PERSON_PROFILE_CREATED" } });
    expect(JSON.stringify(audit.after)).toContain("Profissional Teste");
    expect(JSON.stringify(audit.after)).not.toMatch(/salary|remunera|baseCost|totalCost/i);
  });

  it("mantém incentivo como simulação vinculada e nunca como pagamento", async () => {
    const workspace = await getPeoplePerformanceWorkspace(context, projectId);
    expect(workspace.incentive.simulations.length).toBeGreaterThan(0);
    expect(workspace.incentive.simulations.every((item) => item.paymentCreated === false)).toBe(true);
    expect(workspace.incentive.simulations.every((item) => item.simulatedPool === 0 || item.validatedSavingId !== null)).toBe(true);
  });
});
