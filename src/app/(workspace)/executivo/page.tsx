import { requireAuthContext } from "@/application/auth/session";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { getExecutiveProjectOverview, getExecutivePortfolioOverview } from "@/application/executive/executive-service";
import { getDecisionInsights, listSimulableSalesUnits } from "@/application/executive-insights/executive-insights-service";
import { GestaoExecutivaView } from "@/components/areas/gestao-executiva-view";

/**
 * Fase 9K.2 — Gestão Executiva (ordem de serviço §1/§6/§AG): porta de entrada principal. Lê o
 * empreendimento ativo do contexto operacional (9K.0/9K.1) e, quando o contexto permitir nível de
 * grupo/empresa com mais de um empreendimento, também a carteira consolidada (ordem de serviço §6/
 * §8) — nunca os 15 workspaces de módulo inteiros de uma vez (ordem de serviço §18/§AS).
 */
export default async function ExecutivoPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;

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
