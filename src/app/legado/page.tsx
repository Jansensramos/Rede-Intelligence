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
 * Navegação legada (Fase 9K.1, ordem de serviço §13 "Não apagar workspaces atuais" e teste
 * "navegação legacy continua acessível onde necessário"). Conteúdo idêntico ao antigo
 * `src/app/page.tsx` da 9K.0 — mesmo bootstrap, mesmo componente `IntelligenceWorkspace`, mesma
 * sidebar plana de 24 abas. `/` agora redireciona para `/executivo` (rotas por Grandes Áreas); esta
 * rota fica como acesso direto de continuidade durante a migração progressiva das telas legadas
 * para os primitivos de design system (plano §X), sem forçar todo mundo a trocar de fluxo no dia 1.
 */
export default async function LegacyHome() {
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
