import { afterAll, describe, expect, it } from "vitest";
import { createDemoLandStudy, getLatestLandStudyForProject } from "./land-service";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";

/**
 * Fechamento da 9K.1 (revisão pós-fechamento): `getLatestLandStudyForProject` substitui
 * `getLatestLandStudyForOrganization` nas rotas que exibem o terreno de UM projeto ativo
 * (`viabilidade/page.tsx`, `legado/page.tsx`). A versão anterior buscava "o terreno mais recente de
 * toda a organização" — com a troca de contexto real da 9K.1, isso podia mostrar o terreno de um
 * projeto na tela de outro projeto da mesma organização. Este teste prova, com dados reais (dois
 * projetos, dois terrenos, um terceiro projeto sem terreno), que isso não acontece mais.
 *
 * Fixture isolada, organização própria — nunca escreve na organização semeada
 * `rede-nucleo-de-negocios` (mesma convenção de `src/application/workspace/database.integration.test.ts`).
 */
async function isolatedIdentity(label: string): Promise<AuthContext> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organization = await prisma.organization.create({ data: { name: `9K.1 land-scope ${label} ${suffix}`, slug: `9k1-land-${label}-${suffix}` } });
  const user = await prisma.user.create({ data: { name: `9K.1 land-scope ${label}`, email: `9k1-land-${label}-${suffix}@test.local`, passwordHash: "integration-test" } });
  await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id, role: "OWNER" } });
  return { sessionId: `test-${user.id}`, userId: user.id, userName: user.name, userEmail: user.email, organizationId: organization.id, organizationName: organization.name, organizationSlug: organization.slug, role: "OWNER" };
}

async function linkLandToProject(landStudyId: string, projectId: string) {
  const study = await prisma.landStudy.findUniqueOrThrow({ where: { id: landStudyId }, select: { landAssetId: true } });
  await prisma.landAsset.update({ where: { id: study.landAssetId }, data: { projectId } });
}

describe.skipIf(!process.env.DATABASE_URL).sequential("getLatestLandStudyForProject (fechamento 9K.1, revisão pós-fechamento)", () => {
  let orgIdToCleanUp: string | undefined;

  afterAll(async () => {
    if (orgIdToCleanUp) await prisma.organization.delete({ where: { id: orgIdToCleanUp } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("Projeto A mostra só Terreno A; Projeto B mostra só Terreno B; Projeto C (sem terreno) mostra vazio — nunca A ou B", async () => {
    const context = await isolatedIdentity("scoping");
    orgIdToCleanUp = context.organizationId;

    const projectA = await prisma.project.create({ data: { organizationId: context.organizationId, name: "Projeto A", city: "São Paulo", state: "SP", createdById: context.userId, updatedById: context.userId } });
    const projectB = await prisma.project.create({ data: { organizationId: context.organizationId, name: "Projeto B", city: "Curitiba", state: "PR", createdById: context.userId, updatedById: context.userId } });
    const projectC = await prisma.project.create({ data: { organizationId: context.organizationId, name: "Projeto C sem terreno", city: "Recife", state: "PE", createdById: context.userId, updatedById: context.userId } });

    // Terreno B criado DEPOIS de A e vinculado a B — se a função caísse em "mais recente da
    // organização" (o bug original), o Projeto A erradamente devolveria o Terreno B.
    const landA = await createDemoLandStudy(context);
    await linkLandToProject(landA.landStudyId, projectA.id);

    const landB = await createDemoLandStudy(context);
    await linkLandToProject(landB.landStudyId, projectB.id);

    const resultA = await getLatestLandStudyForProject(context.organizationId, projectA.id);
    const resultB = await getLatestLandStudyForProject(context.organizationId, projectB.id);
    const resultC = await getLatestLandStudyForProject(context.organizationId, projectC.id);

    expect(resultA?.landStudyId).toBe(landA.landStudyId);
    expect(resultB?.landStudyId).toBe(landB.landStudyId);
    expect(resultA?.landStudyId).not.toBe(resultB?.landStudyId);
    expect(resultC).toBeNull();
  });

  it("isolamento multi-tenant: nunca retorna o terreno de um projeto de OUTRA organização", async () => {
    const ownerContext = await isolatedIdentity("tenant-owner");
    const project = await prisma.project.create({ data: { organizationId: ownerContext.organizationId, name: "Projeto do dono", city: "São Paulo", state: "SP", createdById: ownerContext.userId, updatedById: ownerContext.userId } });
    const land = await createDemoLandStudy(ownerContext);
    await linkLandToProject(land.landStudyId, project.id);

    const otherContext = await isolatedIdentity("tenant-intruder");
    try {
      const leaked = await getLatestLandStudyForProject(otherContext.organizationId, project.id);
      expect(leaked).toBeNull();
    } finally {
      await prisma.organization.delete({ where: { id: otherContext.organizationId } }).catch(() => {});
      await prisma.organization.delete({ where: { id: ownerContext.organizationId } }).catch(() => {});
    }
  });
});
