import { requireAuthContext } from "@/application/auth/session";
import { getLatestStudyForProject } from "@/application/studies/study-service";
import { getLatestLandStudyForOrganization } from "@/application/land/land-service";
import { ensureInvestmentCase } from "@/application/investment/investment-service";
import { getPeoplePerformanceWorkspace } from "@/application/people-performance/people-performance-service";
import { getAccountingWorkspace } from "@/application/accounting/accounting-service";
import { getIntegrationsWorkspace } from "@/application/integrations/integrations-service";
import { getDataIntelligenceWorkspace } from "@/application/data-intelligence/data-intelligence-service";
import { buildMarketProductWorkspaceView, getMarketProductWorkspace } from "@/application/market-product";
import { resolveOperationalContext } from "@/application/workspace/operational-context";
import { IntelligenceWorkspace } from "@/components/intelligence-workspace";

/**
 * Fase 9K.0 (plano §1 "Remover dependência do projeto hardcoded" e §2 "Desmontar o bootstrap
 * monolítico"; fechamento da 9K.0, gate 2 "Contexto Operacional Canônico").
 *
 * Ordem importa aqui: o **projeto** é resolvido primeiro, de forma determinística e nunca a partir
 * de atividade de `ViabilityStudy` (ver `resolveOperationalContext` para a cadeia de prioridade
 * completa — seleção explícita → preferência de sessão reservada → fallback pelo projeto mais
 * antigo da organização). Só depois de já ter um projeto resolvido é que buscamos o estudo ativo
 * *daquele projeto específico* (`getLatestStudyForProject`). Isso é o inverso da primeira versão
 * desta tela, que resolvia "o estudo mais recentemente atualizado da organização" e inferia o
 * projeto a partir dele — o que fazia a Home trocar de projeto sozinha sempre que qualquer
 * `ViabilityStudy` de qualquer origem (inclusive testes de integração, que compartilham o mesmo
 * Postgres de desenvolvimento) fosse tocado mais recentemente que o projeto de demonstração.
 *
 * Dos 15 workspaces que este arquivo buscava de uma vez (mais o estudo, 16 chamadas ao todo — ver
 * diagnóstico do plano §A.1), 8 continuam eager aqui: Estudo, Terreno, Investment Case, Pessoas,
 * Contabilidade, Integrações, Inteligência de Dados e Mercado/Produto — são os únicos que a Visão
 * Executiva atual (aba "overview") lê diretamente. Os outros 8 (Design/BIM, Orçamento, Operações,
 * Financeiro, Suprimentos, Jurídico, Comercial, REDE AI) passam a ser buscados sob demanda pelo
 * componente cliente quando a aba correspondente é aberta pela primeira vez — ver
 * `src/app/actions/workspace-loader.ts` e `src/components/intelligence-workspace.tsx`. 8 + 8 = 16,
 * o mesmo total de antes; a diferença é que 8 delas não bloqueiam mais o primeiro carregamento.
 */
export default async function Home() {
  const context = await requireAuthContext();

  const operationalContext = await resolveOperationalContext(context);
  const project = operationalContext.project;
  if (!project) throw new Error("Execute o seed para carregar um empreendimento demonstrativo, ou crie um novo estudo.");

  const initialStudy = await getLatestStudyForProject(context.organizationId, project.id);
  if (!initialStudy) throw new Error("Este empreendimento ainda não tem um estudo ativo. Crie um estudo ou execute o seed.");

  const [initialLand, initialInvestment, initialPeoplePerformance, initialAccounting, initialIntegrations, initialDataIntelligence, marketProductWorkspace] = await Promise.all([
    getLatestLandStudyForOrganization(context.organizationId),
    ensureInvestmentCase(context, project.id),
    getPeoplePerformanceWorkspace(context, project.id),
    getAccountingWorkspace(context, project.id),
    getIntegrationsWorkspace(context, project.id),
    getDataIntelligenceWorkspace(context, project.id),
    getMarketProductWorkspace(context),
  ]);
  if (!initialLand) throw new Error("Execute o seed para carregar o estudo territorial demonstrativo.");
  const initialMarketProduct = buildMarketProductWorkspaceView(marketProductWorkspace);

  return (
    <IntelligenceWorkspace
      initialStudy={initialStudy}
      initialLand={initialLand}
      initialInvestment={initialInvestment}
      initialPeoplePerformance={initialPeoplePerformance}
      initialAccounting={initialAccounting}
      initialIntegrations={initialIntegrations}
      initialDataIntelligence={initialDataIntelligence}
      initialMarketProduct={initialMarketProduct}
      operationalContext={operationalContext}
      role={context.role}
      identity={{ userName: context.userName, organizationName: context.organizationName }}
    />
  );
}
