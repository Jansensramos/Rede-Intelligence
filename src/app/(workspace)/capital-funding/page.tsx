import { requireAuthContext } from "@/application/auth/session";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { compareOpenFundingProposals, getCapitalExecutiveSummary, getEligibleBankTransactionsForDisbursement, getFundingProposalsForProject } from "@/application/capital/capital-queries";
import { hasCapitalCapability } from "@/domain/capital/capabilities";
import { CapitalFundingView, type CapitalCapabilities, type ClientEligibleTxn, type ClientProposal } from "@/components/areas/capital-funding-view";
import { SectionTitle } from "@/components/ui";

/**
 * Fase 9N.1 — área operacional Capital & Funding: necessidade de capital, propostas, comparação,
 * garantias/covenants/condições, cronograma de desembolso, serviço da dívida.
 *
 * `proposals`/`eligibleBankTransactions` chegam da camada de aplicação com `Decimal`/`Date` reais
 * (Prisma) — `CapitalFundingView` é Client Component, então cruzam a fronteira Server→Client via
 * `JSON.parse(JSON.stringify(...))` (decimal.js e `Date` implementam `toJSON`, viram string/ISO
 * automaticamente). `summary`/`comparison` já são planos (`number`/`DecimalString`) na origem —
 * ver `capital-queries.ts` — não precisam do round-trip.
 */
export default async function CapitalFundingPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;

  const [summary, proposals, comparison, eligibleBankTransactions] = await Promise.all([
    getCapitalExecutiveSummary(authContext, context.project.id),
    getFundingProposalsForProject(authContext, context.project.id),
    compareOpenFundingProposals(authContext, context.project.id),
    getEligibleBankTransactionsForDisbursement(authContext, context.project.id),
  ]);

  const capabilities: CapitalCapabilities = {
    manageProposal: hasCapitalCapability(authContext.role, "CAPITAL_PROPOSAL_MANAGE"),
    approve: hasCapitalCapability(authContext.role, "CAPITAL_APPROVE"),
    manageCovenant: hasCapitalCapability(authContext.role, "CAPITAL_COVENANT_MANAGE"),
    manageCondition: hasCapitalCapability(authContext.role, "CAPITAL_CONDITION_MANAGE"),
  };

  const clientProposals: ClientProposal[] = JSON.parse(JSON.stringify(proposals));
  const clientEligibleTransactions: ClientEligibleTxn[] = JSON.parse(JSON.stringify(eligibleBankTransactions));

  return (
    <div className="view-stack">
      <SectionTitle
        eyebrow="CAPITAL E FINANCIAMENTO"
        title="Necessidade de Capital e Estruturação de Financiamento"
        description="Necessidade de capital → propostas → comparação determinística → aprovação → cronograma de desembolso → serviço da dívida no Financeiro. Simulações nunca alteram a Base Aprovada."
      />
      <CapitalFundingView
        projectId={context.project.id}
        summary={summary}
        proposals={clientProposals}
        comparison={comparison}
        eligibleBankTransactions={clientEligibleTransactions}
        capabilities={capabilities}
      />
    </div>
  );
}
