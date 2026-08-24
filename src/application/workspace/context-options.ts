import { prisma } from "@/infrastructure/database/prisma";
import type { CompanyType } from "@prisma/client";

/**
 * Árvore de opções para o Seletor de Contexto (Fase 9K.1, ordem de serviço §7).
 *
 * Escopo estrito por `organizationId` — nunca lê além do tenant do usuário autenticado (mesmo
 * princípio de isolamento multi-tenant já documentado em `operational-context.ts`, plano §AO). O
 * RBAC atual (`prisma/schema.prisma`, `MembershipRole`) não modela visibilidade abaixo do nível de
 * organização — não existe hoje ACL por projeto/empresa/grupo (confirmado em
 * `src/domain/workspace/capabilities.ts`) — então "somente opções autorizadas" nesta sprint
 * significa "somente dentro da organização autenticada". Uma ACL mais fina fica registrada como
 * pendência para sprint futura (ver relatório de entrega da 9K.1).
 *
 * Projetos sem `companyId` (campo opcional no schema) e empresas sem `economicGroupId` (também
 * opcional) aparecem sob um agrupamento "Sem grupo" / "Sem empresa vinculada" — nunca ficam
 * invisíveis no seletor.
 */

export interface ContextOptionProject {
  id: string;
  name: string;
  city: string;
  state: string;
}

export interface ContextOptionCompany {
  id: string;
  name: string;
  type: CompanyType;
  projects: ContextOptionProject[];
}

export interface ContextOptionGroup {
  id: string | null;
  name: string;
  companies: ContextOptionCompany[];
}

export async function getContextSelectorOptions(organizationId: string): Promise<ContextOptionGroup[]> {
  const [groups, companies] = await Promise.all([
    prisma.economicGroup.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    prisma.company.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      include: { projects: { orderBy: { name: "asc" }, select: { id: true, name: true, city: true, state: true } } },
    }),
  ]);

  const companiesByGroup = new Map<string | null, ContextOptionCompany[]>();
  for (const company of companies) {
    const key = company.economicGroupId;
    const bucket = companiesByGroup.get(key) ?? [];
    bucket.push({ id: company.id, name: company.name, type: company.type, projects: company.projects });
    companiesByGroup.set(key, bucket);
  }

  const result: ContextOptionGroup[] = groups.map((group) => ({
    id: group.id,
    name: group.name,
    companies: companiesByGroup.get(group.id) ?? [],
  }));

  const ungrouped = companiesByGroup.get(null) ?? [];
  if (ungrouped.length > 0) result.push({ id: null, name: "Sem grupo econômico", companies: ungrouped });

  const projectsWithoutCompany = await prisma.project.findMany({
    where: { organizationId, companyId: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, city: true, state: true },
  });
  if (projectsWithoutCompany.length > 0) {
    result.push({
      id: "__no_company__",
      name: "Empreendimentos sem empresa vinculada",
      companies: [{ id: "__no_company__", name: "Sem empresa/SPE vinculada", type: "SPE" as CompanyType, projects: projectsWithoutCompany }],
    });
  }

  return result;
}
