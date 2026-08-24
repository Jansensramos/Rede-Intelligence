import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/application/auth/session";
import { createStudy } from "@/application/studies/study-service";
import { DEMO_PROJECT } from "@/domain/financial/demo";
import { resolveOperationalContext } from "./operational-context";
import { prisma } from "@/infrastructure/database/prisma";

/**
 * Fechamento da 9K.0 (gate 4 "Banco de dev e testes"): fixture isolada, dedicada só ao teste do
 * gate 2 abaixo — nunca escreve na organização semeada `rede-nucleo-de-negocios`. É exatamente
 * essa escrita direta na organização compartilhada (por outra suíte, em outra sessão) que causou
 * o bug original: um projeto de teste virando "o mais recente" e desviando a Home. Reproduzir o
 * mesmo tipo de poluição aqui, mas dentro de uma organização só deste teste, prova a correção sem
 * arriscar poluir a organização que o dev/smoke test usa.
 */
async function isolatedIdentity(label: string): Promise<AuthContext> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organization = await prisma.organization.create({ data: { name: `9K.0 ${label} ${suffix}`, slug: `9k0-${label}-${suffix}` } });
  const user = await prisma.user.create({ data: { name: `9K.0 ${label}`, email: `9k0-${label}-${suffix}@test.local`, passwordHash: "integration-test" } });
  await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id, role: "OWNER" } });
  return { sessionId: `test-${user.id}`, userId: user.id, userName: user.name, userEmail: user.email, organizationId: organization.id, organizationName: organization.name, organizationSlug: organization.slug, role: "OWNER" };
}

describe.skipIf(!process.env.DATABASE_URL).sequential("contexto operacional multiempresa (9K.0)", () => {
  let context: AuthContext;
  let atlasContext: AuthContext;
  let projectId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: "rede-nucleo-de-negocios" } });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "admin@rede.local" } });
    const project = await prisma.project.findUniqueOrThrow({ where: { organizationId_name: { organizationId: organization.id, name: "START BUTANTÃ" } } });
    projectId = project.id;
    context = { sessionId: "test", userId: user.id, userName: user.name, userEmail: user.email, organizationId: organization.id, organizationName: organization.name, organizationSlug: organization.slug, role: "OWNER" };

    const atlas = await prisma.organization.findUniqueOrThrow({ where: { slug: "grupo-atlas" } });
    atlasContext = { ...context, organizationId: atlas.id, organizationName: atlas.name, organizationSlug: atlas.slug };
  });

  afterAll(async () => prisma.$disconnect());

  it("resolve o projeto mais antigo da organização (fallback determinístico) sem depender de nome fixo", async () => {
    // Não assume que o fallback é necessariamente "START BUTANTÃ": um banco de desenvolvimento de
    // longa duração pode ter acumulado mais de um projeto legítimo em `rede-nucleo-de-negocios`
    // (ex.: fixtures de suítes diferentes ao longo do tempo — ver comentário em
    // `operational-context.ts`, prioridade C). O contrato verificado aqui é o real: o mesmo critério
    // (`createdAt` asc, `id` como desempate) que a implementação documenta, não um nome específico.
    const expected = await prisma.project.findFirst({ where: { organizationId: context.organizationId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const resolved = await resolveOperationalContext(context);
    expect(resolved.project?.id).toBe(expected?.id);
    expect(resolved.organization.id).toBe(context.organizationId);
  });

  it("fechamento 9K.0 (gate 2): um ViabilityStudy mais recente NÃO desvia a resolução do projeto ativo", async () => {
    // Reproduz o bug relatado dentro de uma organização isolada (gate 4: nunca poluir
    // `rede-nucleo-de-negocios`, mesmo em teste): cria um primeiro projeto (o "oficial"), espera
    // para garantir `createdAt` estritamente maior, e cria um segundo projeto com estudo mais
    // recentemente atualizado. Antes do fechamento, `resolveOperationalContext` delegava a
    // `getLatestStudyForOrganization` (ordenado por `ViabilityStudy.updatedAt desc`) e passaria a
    // resolver o segundo projeto. Agora resolve por `Project.createdAt asc` — o primeiro sempre
    // vence, mesmo sendo "mais velho" que a atividade mais recente.
    const isolated = await isolatedIdentity("gate2");
    try {
      const official = await createStudy(isolated, { ...DEMO_PROJECT, projectName: `Oficial ${Date.now()}` });
      await new Promise((resolve) => setTimeout(resolve, 1100)); // garante createdAt estritamente maior (granularidade de segundo)
      const pollutingStudy = await createStudy(isolated, { ...DEMO_PROJECT, projectName: `Poluição de teste ${Date.now()}` });
      expect(pollutingStudy.projectId).not.toBe(official.projectId);

      const resolved = await resolveOperationalContext(isolated);
      expect(resolved.project?.id).toBe(official.projectId);
      expect(resolved.project?.id).not.toBe(pollutingStudy.projectId);
    } finally {
      await prisma.organization.delete({ where: { id: isolated.organizationId } }).catch(() => {
        // Restrict em Project/ViabilityStudy impede cascade — mesma convenção já usada pelas
        // outras suítes deste repositório (ex.: `application/ai/database.integration.test.ts`):
        // organizações de teste isoladas ficam órfãs em vez de forçar uma ordem de deleção
        // manual através de dezenas de tabelas relacionadas. Nunca influencia outro teste porque
        // cada organização de teste é única e nunca é lida por nome fixo.
      });
    }
  }, 30_000);

  it("aceita seleção explícita de projeto (fundação para a futura Central Executiva)", async () => {
    const resolved = await resolveOperationalContext(context, { projectId });
    expect(resolved.project?.id).toBe(projectId);
  });

  it("nunca resolve um projeto de outra organização, mesmo com o id correto (isolamento por tenant)", async () => {
    const resolved = await resolveOperationalContext(atlasContext, { projectId });
    expect(resolved.project).toBeNull();
  });

  it("uma organização sem estudo ativo resolve projeto nulo em vez de lançar", async () => {
    const empty = await prisma.organization.create({
      data: { name: "Organização sem projetos 9K.0", slug: `sem-projetos-9k0-${Date.now()}` },
    });
    try {
      const resolved = await resolveOperationalContext({ ...context, organizationId: empty.id, organizationName: empty.name, organizationSlug: empty.slug });
      expect(resolved.project).toBeNull();
      expect(resolved.company).toBeNull();
      expect(resolved.economicGroup).toBeNull();
    } finally {
      await prisma.organization.delete({ where: { id: empty.id } });
    }
  });

  it("computa capacidades a partir do papel do usuário autenticado", async () => {
    const resolved = await resolveOperationalContext(context);
    expect(resolved.capabilities.role).toBe("OWNER");
    expect(resolved.capabilities.WORKSPACE_APPROVE).toBe(true);

    const viewerResolved = await resolveOperationalContext({ ...context, role: "VIEWER" });
    expect(viewerResolved.capabilities.WORKSPACE_APPROVE).toBe(false);
    expect(viewerResolved.capabilities.WORKSPACE_VIEW).toBe(true);
  });

  it("resolve a cadeia Grupo → Empresa quando o projeto está vinculado a uma company", async () => {
    const resolved = await resolveOperationalContext(context, { projectId });
    if (resolved.company) {
      expect(resolved.company.id).toBeTruthy();
      expect(resolved.company.type).toBeTruthy();
    } else {
      // Base demonstrativa pode não vincular o projeto a uma Company — comportamento válido,
      // já que `Project.companyId` é opcional no schema.
      expect(resolved.economicGroup).toBeNull();
    }
  });
});
