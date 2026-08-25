import { notFound } from "next/navigation";
import { requireAuthContext } from "@/application/auth/session";
import { resolveOperationalContext } from "@/application/workspace/operational-context";
import { getExecutiveProjectOverview, getExecutivePortfolioOverview } from "@/application/executive/executive-service";
import { getDecisionInsights, listSimulableSalesUnits } from "@/application/executive-insights/executive-insights-service";
import { GestaoExecutivaView } from "@/components/areas/gestao-executiva-view";

/**
 * Fase 9K.2 — Central Executiva do Empreendimento (plano §AH), rota de drill-down a partir da
 * Carteira (ordem de serviço §6/§8/§11). Resolve o `projectId` explicitamente e revalida contra o
 * tenant do usuário (mesmo padrão de `resolveOperationalContext`, prioridade A) — nunca troca o
 * empreendimento ativo global (cookie da 9K.1): é só uma leitura, não uma navegação de contexto.
 */
export default async function ExecutivoProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const authContext = await requireAuthContext();
  const context = await resolveOperationalContext(authContext, { projectId });
  if (!context.project) notFound();

  const [overview, portfolio] = await Promise.all([
    getExecutiveProjectOverview(authContext, {
      id: context.project.id,
      name: context.project.name,
      city: context.project.city,
      state: context.project.state,
      companyId: context.company?.id ?? null,
      companyName: context.company?.name ?? null,
      economicGroupId: context.economicGroup?.id ?? null,
      economicGroupName: context.economicGroup?.name ?? null,
    }),
    getExecutivePortfolioOverview(authContext, context),
  ]);

  const scopeProjects = portfolio ? portfolio.entries.map((entry) => ({ id: entry.project.id })) : [{ id: context.project.id }];
  const [insights, simulableUnits] = await Promise.all([
    getDecisionInsights(authContext, { id: context.project.id, companyId: context.company?.id ?? null }, scopeProjects),
    listSimulableSalesUnits(authContext, context.project.id),
  ]);

  return <GestaoExecutivaView overview={overview} portfolio={portfolio} insights={insights} simulableUnits={simulableUnits} />;
}
