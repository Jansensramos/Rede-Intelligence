import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContextSelectorOptions } from "./context-options";
import { prisma } from "@/infrastructure/database/prisma";

/**
 * Fase 9K.1, ordem de serviço §7 "Seletor de Contexto" e §15 (testes: "usuário não visualiza
 * empresa/projeto sem permissão"). Fixture isolada, própria organização — nunca escreve na
 * organização semeada `rede-nucleo-de-negocios` (mesma convenção de isolamento de
 * `src/application/workspace/database.integration.test.ts`, 9K.0).
 */
describe.skipIf(!process.env.DATABASE_URL).sequential("Seletor de Contexto: Grupo → Empresa/SPE → Empreendimento (9K.1)", () => {
  let organizationId: string;
  let otherOrganizationId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const organization = await prisma.organization.create({ data: { name: `9K.1 ctx-switcher ${suffix}`, slug: `9k1-ctx-${suffix}` } });
    organizationId = organization.id;
    const user = await prisma.user.create({ data: { name: "9K.1 fixture", email: `9k1-ctx-${suffix}@test.local`, passwordHash: "integration-test" } });

    const group = await prisma.economicGroup.create({ data: { organizationId, name: "Grupo Alfa", createdById: user.id } });
    const companyInGroup = await prisma.company.create({ data: { organizationId, economicGroupId: group.id, name: "Alfa SPE 01", legalName: "Alfa SPE 01 Ltda", type: "SPE", createdById: user.id } });
    const companyWithoutGroup = await prisma.company.create({ data: { organizationId, name: "Beta Incorporadora", legalName: "Beta Incorporadora Ltda", type: "INCORPORATOR", createdById: user.id } });

    await prisma.project.create({ data: { organizationId, companyId: companyInGroup.id, name: `Projeto com grupo ${suffix}`, city: "São Paulo", state: "SP", createdById: user.id, updatedById: user.id } });
    await prisma.project.create({ data: { organizationId, companyId: companyWithoutGroup.id, name: `Projeto sem grupo ${suffix}`, city: "Curitiba", state: "PR", createdById: user.id, updatedById: user.id } });
    await prisma.project.create({ data: { organizationId, name: `Projeto sem empresa ${suffix}`, city: "Recife", state: "PE", createdById: user.id, updatedById: user.id } });

    const otherOrganization = await prisma.organization.create({ data: { name: `9K.1 ctx-switcher outra org ${suffix}`, slug: `9k1-ctx-outra-${suffix}` } });
    otherOrganizationId = otherOrganization.id;
    await prisma.project.create({ data: { organizationId: otherOrganizationId, name: `Projeto de outra organização ${suffix}`, city: "Belo Horizonte", state: "MG", createdById: user.id, updatedById: user.id } });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => {});
    await prisma.organization.delete({ where: { id: otherOrganizationId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("lista o grupo com sua empresa/SPE e empreendimento", async () => {
    const groups = await getContextSelectorOptions(organizationId);
    const grupoAlfa = groups.find((group) => group.name === "Grupo Alfa");
    expect(grupoAlfa).toBeDefined();
    expect(grupoAlfa!.companies.map((company) => company.name)).toContain("Alfa SPE 01");
    const company = grupoAlfa!.companies.find((item) => item.name === "Alfa SPE 01");
    expect(company!.projects.some((project) => project.city === "São Paulo")).toBe(true);
  });

  it("agrupa empresas sem grupo econômico sob 'Sem grupo econômico'", async () => {
    const groups = await getContextSelectorOptions(organizationId);
    const ungrouped = groups.find((group) => group.id === null);
    expect(ungrouped).toBeDefined();
    expect(ungrouped!.companies.map((company) => company.name)).toContain("Beta Incorporadora");
  });

  it("agrupa empreendimentos sem empresa vinculada, sem deixá-los invisíveis", async () => {
    const groups = await getContextSelectorOptions(organizationId);
    const noCompanyGroup = groups.find((group) => group.id === "__no_company__");
    expect(noCompanyGroup).toBeDefined();
    const projects = noCompanyGroup!.companies.flatMap((company) => company.projects);
    expect(projects.some((project) => project.city === "Recife")).toBe(true);
  });

  it("nunca lista grupos, empresas ou empreendimentos de outra organização (isolamento multi-tenant)", async () => {
    const groups = await getContextSelectorOptions(organizationId);
    const allProjectCities = groups.flatMap((group) => group.companies.flatMap((company) => company.projects.map((project) => project.city)));
    expect(allProjectCities).not.toContain("Belo Horizonte");

    const otherGroups = await getContextSelectorOptions(otherOrganizationId);
    const otherCities = otherGroups.flatMap((group) => group.companies.flatMap((company) => company.projects.map((project) => project.city)));
    expect(otherCities).toEqual(["Belo Horizonte"]);
  });
});
