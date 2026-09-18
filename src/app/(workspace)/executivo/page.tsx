import { requireAuthContext } from "@/application/auth/session";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { getExecutiveProjectOverview, getExecutivePortfolioOverview } from "@/application/executive/executive-service";
import { getDecisionInsights, listSimulableSalesUnits } from "@/application/executive-insights/executive-insights-service";
import { getProjectClosureOverview } from "@/application/closure/closure-service";
import { ClosureOperabilityPanel } from "@/components/closure-operability-panel";
import { GestaoExecutivaView } from "@/components/areas/gestao-executiva-view";
import { hasProtectedApprovalCapability, hasProtectedWriteCapability } from "@/domain/auth/write-capabilities";

/**
 * Fase 10C.1 — Gestão Executiva permanece como leitura e decisão; o encerramento
 * material do empreendimento é exposto aqui sem transformar o Executivo em tela de digitação geral.
 */
export default async function ExecutivoPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;

  const canWriteClosure = hasProtectedWriteCapability(authContext.role, "CLOSURE_WRITE");
  const canApproveClosure = hasProtectedApprovalCapability(authContext.role, "CLOSURE_APPROVE");
  const canReopenClosure = authContext.role === "OWNER";

  const [overview, portfolio, closure] = await Promise.all([
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
    getProjectClosureOverview(authContext, context.project.id),
  ]);

  const scopeProjects = portfolio ? portfolio.entries.map((entry) => ({ id: entry.project.id })) : [{ id: context.project.id }];
  const [insights, simulableUnits] = await Promise.all([
    getDecisionInsights(authContext, { id: context.project.id, companyId: context.company?.id ?? null }, scopeProjects),
    listSimulableSalesUnits(authContext, context.project.id),
  ]);

  return <div className="view-stack">
    <ClosureOperabilityPanel
      projectId={context.project.id}
      latest={closure.latest ? { id: closure.latest.id, status: closure.latest.status, version: closure.latest.version } : null}
      canWrite={canWriteClosure}
      canApprove={canApproveClosure}
      canReopen={canReopenClosure}
      gate={{
        overall: closure.gate.overall,
        operational: { status: closure.gate.operational.status },
        contractual: { status: closure.gate.contractual.status },
        legal: { status: closure.gate.legal.status },
        financial: { status: closure.gate.financial.status },
        accounting: { status: closure.gate.accounting.status },
      }}
    />
    <GestaoExecutivaView overview={overview} portfolio={portfolio} insights={insights} simulableUnits={simulableUnits} />
  </div>;
}
