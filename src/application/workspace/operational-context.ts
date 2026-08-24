import type { CompanyType } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { computeWorkspaceCapabilities, type WorkspaceCapabilitySet } from "@/domain/workspace/capabilities";
import { prisma } from "@/infrastructure/database/prisma";

/**
 * Fundação de contexto operacional (Fase 9K.0, plano §1 "Remover dependência do projeto
 * hardcoded" e §AO "Multi-tenancy"; fechamento da 9K.0, gate 2 "Contexto Operacional Canônico").
 *
 * Substitui a busca por nome fixo de projeto (`START_BUTANTA_PROJECT.projectName`) que existia em
 * `src/app/page.tsx` por uma resolução sobre a hierarquia já existente no schema:
 * Organization → EconomicGroup → Company (SPE é só um `CompanyType`, não um model separado) →
 * Project. Nenhuma tabela nova, nenhuma migration.
 *
 * Resolve **Project**, nunca Study. A primeira versão desta função (entregue antes do fechamento
 * da 9K.0) usava `getLatestStudyForOrganization` como fallback — isto é, escolhia o projeto pelo
 * `ViabilityStudy` mais recentemente atualizado em toda a organização. Isso quebrou no smoke test:
 * um `ViabilityStudy` criado por um teste de integração (que grava no mesmo Postgres do dev, ver
 * `docs/` fase 9H) ficou "mais recente" que o projeto de demonstração, e a Home passou a exibir o
 * projeto de teste. "Registro mais recente" não é "contexto operacional ativo" — a atividade de
 * qualquer processo (inclusive um teste) não deveria conseguir mudar silenciosamente o que a
 * aplicação considera o empreendimento ativo do usuário.
 *
 * Prioridade de resolução do projeto (determinística, nesta ordem):
 *
 *   A. `selection.projectId` explícito — vindo de navegação real (rota, ação, comando). Hoje
 *      nenhuma tela ainda envia isto (a Central Executiva com seletor é 9K.1+), mas o parâmetro já
 *      existe e é tenant-safe (sempre revalidado contra `organizationId`). Se o id não existir ou
 *      pertencer a outra organização, a resolução devolve `project: null` e PARA — nunca cai para
 *      o fallback C. Substituir silenciosamente um projectId pedido explicitamente por "outro
 *      projeto qualquer da organização" seria pior que devolver "não encontrado": esconderia um id
 *      inválido ou de outro tenant atrás dos dados de um projeto diferente, sem nenhum sinal de que
 *      o pedido não foi atendido. C só entra quando NENHUMA seleção explícita foi feita.
 *   B. projeto ativo persistido para o usuário/sessão — reservado. Não existe hoje nenhum campo
 *      seguro para isto: `User`, `OrganizationMembership` e `Session` não têm coluna de preferência
 *      (conferido no schema; ver `prisma/schema.prisma`). Criar essa coluna é fora de escopo desta
 *      sprint ("não criar nova entidade/schema nesta sprint" — instrução explícita do fechamento).
 *      Este nível fica documentado como pendência estrutural da 9K.1, quando a UI de seleção
 *      existir e puder decidir onde persistir a escolha (cookie de sessão vs. coluna de usuário).
 *   C. fallback determinístico, só quando não há seleção (A) nem preferência (B): o projeto mais
 *      **antigo** (`createdAt` ascendente, com `id` como desempate) entre os da organização.
 *      `Project.createdAt` nunca muda depois de criado — ao contrário de `ViabilityStudy.updatedAt`,
 *      não é afetado por nenhuma atividade posterior (edição de premissas, testes, etc.). Não é
 *      necessariamente "o projeto de demonstração oficial": bases de desenvolvimento de longa
 *      duração podem acumular mais de um projeto legítimo na mesma organização (por exemplo, mais
 *      de um fixture usado por diferentes suítes de teste ao longo do tempo) — o contrato de C não é
 *      "sempre volta ao projeto X", é "sempre volta ao mesmo projeto, de forma estável, enquanto
 *      nenhum projeto mais antigo for criado". Não é "o projeto certo" no sentido de produto (isso é
 *      trabalho da 9K.1, com seleção real do usuário) — é apenas estável e não-surpreendente.
 *   D. nunca resolvido a partir de `ViabilityStudy` — nem por `createdAt`, nem por `updatedAt`.
 *
 * Depois de resolvido o projeto, o estudo ativo *daquele projeto específico* é responsabilidade de
 * `getLatestStudyForProject` (`src/application/studies/study-service.ts`) — ordenar por recência
 * ali é legítimo porque já não decide o projeto, só a versão do estudo dentro dele.
 */

export interface OperationalContextOrganization {
  id: string;
  name: string;
  slug: string;
}

export interface OperationalContextEconomicGroup {
  id: string;
  name: string;
}

export interface OperationalContextCompany {
  id: string;
  name: string;
  type: CompanyType;
}

export interface OperationalContextProject {
  id: string;
  name: string;
  city: string;
  state: string;
}

export interface OperationalContext {
  organization: OperationalContextOrganization;
  economicGroup: OperationalContextEconomicGroup | null;
  company: OperationalContextCompany | null;
  project: OperationalContextProject | null;
  user: { id: string; name: string; role: AuthContext["role"] };
  capabilities: WorkspaceCapabilitySet;
}

export interface OperationalContextSelection {
  /** Prioridade A: projetoId explícito vindo de navegação/ação real. Sempre revalidado por tenant. */
  projectId?: string;
}

export async function resolveOperationalContext(
  authContext: AuthContext,
  selection?: OperationalContextSelection,
): Promise<OperationalContext> {
  const project = await resolveActiveProject(authContext.organizationId, selection);

  return {
    organization: {
      id: authContext.organizationId,
      name: authContext.organizationName,
      slug: authContext.organizationSlug,
    },
    economicGroup: project?.company?.economicGroup
      ? { id: project.company.economicGroup.id, name: project.company.economicGroup.name }
      : null,
    company: project?.company ? { id: project.company.id, name: project.company.name, type: project.company.type } : null,
    project: project ? { id: project.id, name: project.name, city: project.city, state: project.state } : null,
    user: { id: authContext.userId, name: authContext.userName, role: authContext.role },
    capabilities: computeWorkspaceCapabilities(authContext.role),
  };
}

type ProjectWithCompany = NonNullable<Awaited<ReturnType<typeof findProjectById>>>;

function findProjectById(id: string, organizationId: string) {
  return prisma.project.findFirst({
    where: { id, organizationId },
    include: { company: { include: { economicGroup: true } } },
  });
}

async function resolveActiveProject(
  organizationId: string,
  selection?: OperationalContextSelection,
): Promise<ProjectWithCompany | null> {
  // A. seleção explícita (navegação/ação real) — sempre revalidada contra o tenant. Se o projectId
  // não existir OU pertencer a outra organização, devolve null e PARA aqui — nunca cai para o
  // fallback C. Substituir silenciosamente por outro projeto da organização quando alguém pediu um
  // projectId específico seria mais perigoso que devolver "não encontrado": esconderia um id
  // inválido, expirado ou de outro tenant atrás de dados de um projeto diferente, sem nenhum sinal
  // de que a seleção pedida não foi atendida. Quem chama (ex.: uma futura rota `/[projectId]`) deve
  // tratar `project: null` como 404, não como "use o padrão".
  if (selection?.projectId) {
    return findProjectById(selection.projectId, organizationId);
  }

  // B. preferência persistida do usuário/sessão — reservado, sem mecanismo seguro ainda (ver
  // comentário acima). Nada a fazer aqui hoje; quando existir, entra antes de C.

  // C. fallback determinístico: projeto mais antigo da organização, nunca por atividade de Study.
  return prisma.project.findFirst({
    where: { organizationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { company: { include: { economicGroup: true } } },
  });
}
