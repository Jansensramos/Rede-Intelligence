import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hash } from "bcryptjs";
import { MembershipRole } from "@prisma/client";
import { createDemoLandStudy, getLandStudyForOrganization, saveUrbanScenarioSnapshot } from "./land-service";
import { prisma } from "@/infrastructure/database/prisma";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let organizationId = "";
let otherOrganizationId = "";
let userId = "";
let landStudyId = "";
let firstVersionId = "";

beforeAll(async () => {
  const passwordHash = await hash("Land@Test1", 4);
  const user = await prisma.user.create({ data: { email: `land-${suffix}@test.local`, name: "Land Tester", passwordHash } });
  const organization = await prisma.organization.create({ data: { name: `Land Org ${suffix}`, slug: `land-org-${suffix}` } });
  const other = await prisma.organization.create({ data: { name: `Other Land Org ${suffix}`, slug: `other-land-${suffix}` } });
  await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id, role: MembershipRole.OWNER } });
  organizationId = organization.id;
  otherOrganizationId = other.id;
  userId = user.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe.sequential("REDE Land persistence", () => {
  it("persists LandAsset, sources, scenarios, envelopes, alternatives and a locked snapshot", async () => {
    const view = await createDemoLandStudy({ organizationId, userId });
    landStudyId = view.landStudyId;
    firstVersionId = view.versionId;
    const persisted = await prisma.landStudyVersion.findUnique({ where: { id: view.versionId }, include: { sources: true, scenarios: { include: { restrictions: true, envelope: true } }, options: true, reverseZoningRuns: true, gapAnalyses: true, upliftAnalyses: true } });
    expect(persisted?.versionStatus).toBe("SNAPSHOT");
    expect(persisted?.sources.length).toBeGreaterThanOrEqual(4);
    expect(persisted?.scenarios).toHaveLength(2);
    expect(persisted?.scenarios.every((scenario) => scenario.envelope)).toBe(true);
    expect(persisted?.options).toHaveLength(4);
    expect(persisted?.reverseZoningRuns).toHaveLength(1);
    expect(persisted?.gapAnalyses).toHaveLength(1);
    expect(persisted?.upliftAnalyses).toHaveLength(1);
  }, 30_000);

  it("creates a new immutable version and audits every manual change", async () => {
    const next = await saveUrbanScenarioSnapshot({ organizationId, userId }, {
      landStudyId,
      expectedVersionNumber: 1,
      justification: "Teste de alteração manual auditável.",
      parameters: { maximumFAR: 6.2, occupancyRate: 54, permeabilityRate: 21, maximumHeight: 60, maximumFloors: 19, frontSetback: 15, rearSetback: 6, sideSetback: 7.5, betweenBuildings: 10, parkingRequirement: 0.6, residentialDensity: 950 },
      product: { targetUnits: 1325, averageUnitArea: 46, numberOfTowers: 12, unitsPerFloor: 8, floors: 15, efficiency: 76, parkingRatio: 0.6 },
    });
    expect(next.versionNumber).toBe(2);
    const audits = await prisma.landAuditLog.findMany({ where: { landStudyId } });
    expect(audits.some((audit) => audit.parameter === "maximumFAR" && audit.justification.includes("auditável"))).toBe(true);
    expect(audits.some((audit) => audit.parameter === "product")).toBe(true);
  }, 30_000);

  it("blocks mutation of the snapshot and its artifacts", async () => {
    await expect(prisma.landStudyVersion.update({ where: { id: firstVersionId }, data: { regulatoryConfidence: 1 } })).rejects.toThrow(/immutable/i);
    const option = await prisma.landOptionRecord.findFirstOrThrow({ where: { landStudyVersionId: firstVersionId } });
    await expect(prisma.landOptionRecord.update({ where: { id: option.id }, data: { rank: 99 } })).rejects.toThrow(/immutable/i);
  });

  it("prevents organization IDOR on land study reads", async () => {
    expect(await getLandStudyForOrganization(organizationId, landStudyId)).not.toBeNull();
    expect(await getLandStudyForOrganization(otherOrganizationId, landStudyId)).toBeNull();
  });
});
