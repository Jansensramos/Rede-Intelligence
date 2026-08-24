import { requireAuthContext } from "@/application/auth/session";
import { getLatestStudyForProject } from "@/application/studies/study-service";
import { getPeoplePerformanceWorkspace } from "@/application/people-performance/people-performance-service";
import { getAccountingWorkspace } from "@/application/accounting/accounting-service";
import { getIntegrationsWorkspace } from "@/application/integrations/integrations-service";
import { getDataIntelligenceWorkspace } from "@/application/data-intelligence/data-intelligence-service";
import { buildMarketProductWorkspaceView, getMarketProductWorkspace } from "@/application/market-product";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { GestaoExecutivaView } from "@/components/areas/gestao-executiva-view";

/**
 * Fase 9K.1 — Gestão Executiva (ordem de serviço §1): primeira área, porta de entrada principal.
 * Mesmo conjunto de workspaces que a antiga "overview" já lia diretamente (ver 9K.0,
 * `src/app/legado/page.tsx`) — nada de Design/Orçamento/Financeiro/Suprimentos/Jurídico/Comercial
 * aqui, eles vivem nas próprias áreas (ordem de serviço §16).
 */
export default async function ExecutivoPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;
  const projectId = context.project.id;

  const [study, peoplePerformance, accounting, integrations, dataIntelligence, marketProductWorkspace] = await Promise.all([
    getLatestStudyForProject(authContext.organizationId, projectId),
    getPeoplePerformanceWorkspace(authContext, projectId),
    getAccountingWorkspace(authContext, projectId),
    getIntegrationsWorkspace(authContext, projectId),
    getDataIntelligenceWorkspace(authContext, projectId),
    getMarketProductWorkspace(authContext),
  ]);
  if (!study) throw new Error("Este empreendimento ainda não tem um estudo ativo. Crie um estudo em Viabilidade ou execute o seed.");

  return (
    <GestaoExecutivaView
      study={study}
      peoplePerformance={peoplePerformance}
      accounting={accounting}
      integrations={integrations}
      dataIntelligence={dataIntelligence}
      marketProduct={buildMarketProductWorkspaceView(marketProductWorkspace)}
    />
  );
}
