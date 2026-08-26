import { requireAuthContext } from "@/application/auth/session";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { compareOpenFundingProposals, getCapitalExecutiveSummary, getFundingProposalsForProject } from "@/application/capital/capital-queries";
import { CapitalFundingView } from "@/components/areas/capital-funding-view";
import { SectionTitle } from "@/components/ui";

/** Fase 9N — área operacional Capital & Funding: necessidade de capital, propostas, comparação, garantias/covenants/condições, cronograma. */
export default async function CapitalFundingPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;

  const [summary, proposals, comparison] = await Promise.all([
    getCapitalExecutiveSummary(authContext, context.project.id),
    getFundingProposalsForProject(authContext, context.project.id),
    compareOpenFundingProposals(authContext, context.project.id),
  ]);

  return (
    <div className="view-stack">
      <SectionTitle
        eyebrow="CAPITAL & FUNDING"
        title="Necessidade de Capital e Estruturação de Funding"
        description="Necessidade de capital → propostas → comparação determinística → aprovação → cronograma de desembolso → serviço da dívida no Financeiro. Simulações nunca alteram a Base Aprovada."
      />
      <CapitalFundingView summary={summary} proposals={proposals} comparison={comparison} />
    </div>
  );
}
