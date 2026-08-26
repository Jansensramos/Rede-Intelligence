/**
 * Fase 9N — Capital & Funding: necessidade de capital, propostas registradas, comparação
 * determinística A/B/C, garantias/covenants/condições e cronograma de desembolso/serviço da
 * dívida. Server Component puro de apresentação — todo cálculo já veio pronto da camada de
 * aplicação (`capital-queries.ts`); aqui só formata. Sem interatividade além de `<details>`
 * nativo (expandir/recolher proposta), então nenhuma mutação acontece a partir desta tela ainda —
 * as ações (aprovar, confirmar desembolso, avaliar covenant) já existem em `capital-service.ts` e
 * ficam para uma sprint de UI de mutação.
 */
import { Coins } from "lucide-react";
import type { CapitalExecutiveSummary, FundingWorkspaceProposal } from "@/application/capital/capital-queries";
import type { ProposalComparisonResult } from "@/domain/capital/types";
import { MetricCard } from "@/components/ui";

// `MetricCard` exige um `LucideIcon` por cartão; esta área ainda não tem um ícone dedicado por
// KPI (nenhum outro módulo faz isso para cada card também — ver `financial-view.tsx`), então usa
// um único ícone genérico para todos os cartões desta tela.
const CoinsIconFallback = Coins;

function money(value: number | string | null | undefined) {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function pct(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function date(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

const PROPOSAL_STATUS_LABEL: Record<string, string> = { DRAFT: "Rascunho", SUBMITTED: "Submetida", UNDER_REVIEW: "Em análise", APPROVED: "Aprovada", REJECTED: "Rejeitada", EXPIRED: "Expirada", WITHDRAWN: "Retirada" };
const DISBURSEMENT_STATUS_LABEL: Record<string, string> = { PLANNED: "Planejado", REQUESTED: "Solicitado", APPROVED: "Aprovado p/ liberação", DISBURSED: "Desembolsado", CANCELLED: "Cancelado" };
const COVENANT_STATUS_LABEL: Record<string, string> = { OK: "OK", WARNING: "Atenção", BREACHED: "Violado", WAIVED: "Dispensado" };
const CONDITION_STATUS_LABEL: Record<string, string> = { PENDING: "Pendente", SATISFIED: "Satisfeita", WAIVED: "Dispensada", REJECTED: "Rejeitada" };
const GUARANTEE_STATUS_LABEL: Record<string, string> = { PENDING: "Pendente", FORMALIZED: "Formalizada", ACTIVE: "Ativa", RELEASED: "Liberada" };

function statusTone(ok: boolean) {
  return ok ? "metric-positive" : "metric-negative";
}

function CapitalNeedSection({ summary }: { summary: CapitalExecutiveSummary }) {
  const need = summary.capitalNeed;
  const deficitRows = need.monthlyCurve.filter((row) => Number(row.deficit) > 0);
  return (
    <section className="view-stack">
      <h3>Necessidade de Capital</h3>
      {!need.hasOfficialCalculation ? (
        <p className="ds-data-table-empty">Sem viabilidade calculada para este empreendimento ainda — cadastre/aprove a Base (REDE Engine) antes de estruturar funding.</p>
      ) : (
        <>
          <section className="metrics-grid">
            <MetricCard label="Necessidade total de capital" value={money(need.totalCapitalNeed)} meta={`Pico no mês ${need.peakExposureMonth}`} icon={CoinsIconFallback} />
            <MetricCard label="Equity aportado" value={money(need.equityContributed)} meta="Aportes reais (intercompany APORTE)" icon={CoinsIconFallback} />
            <MetricCard label="Funding desembolsado" value={money(need.fundingDisbursed)} meta={need.unconfirmedDisbursementCount > 0 ? `${need.unconfirmedDisbursementCount} desembolso(s) ainda não conciliado(s)` : "Confirmado por transação bancária conciliada"} icon={CoinsIconFallback} />
            <MetricCard label="Funding ainda necessário" value={money(need.fundingStillNeeded)} meta={need.fullyCovered ? "Necessidade coberta" : "Ainda em aberto"} tone={need.fullyCovered ? "positive" : "negative"} icon={CoinsIconFallback} />
          </section>
          {deficitRows.length > 0 && (
            <details>
              <summary>Curva mensal de déficit ({deficitRows.length} mês(es) com caixa negativo)</summary>
              <div className="ds-data-table-wrap">
                <table className="ds-data-table">
                  <thead><tr><th>Mês</th><th>Fase</th><th style={{ textAlign: "right" }}>Caixa do projeto</th><th style={{ textAlign: "right" }}>Déficit</th></tr></thead>
                  <tbody>
                    {deficitRows.map((row) => (
                      <tr key={row.month}><td>{row.month}</td><td>{row.phase}</td><td style={{ textAlign: "right" }}>{money(row.projectCashBalance)}</td><td style={{ textAlign: "right" }}>{money(row.deficit)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function ExecutiveSummarySection({ summary }: { summary: CapitalExecutiveSummary }) {
  return (
    <section className="metrics-grid">
      <MetricCard label="Funding contratado (aprovado)" value={money(summary.fundingContratado)} meta="Soma das propostas APROVADAS" icon={CoinsIconFallback} />
      <MetricCard label="Saldo a liberar" value={money(summary.saldoALiberar)} meta="Desembolsos ainda não confirmados" icon={CoinsIconFallback} />
      <MetricCard label="Custo médio ponderado" value={summary.custoMedio !== null ? pct(summary.custoMedio) : "—"} meta="Taxa nominal ponderada pelo valor contratado" icon={CoinsIconFallback} />
      <MetricCard
        label="Próxima liberação"
        value={summary.proximaLiberacao ? money(summary.proximaLiberacao.expectedAmount) : "—"}
        meta={summary.proximaLiberacao ? `Previsto para ${date(summary.proximaLiberacao.expectedDate)}` : "Nenhuma liberação pendente"}
        icon={CoinsIconFallback}
      />
      <MetricCard label="Covenants em risco" value={String(summary.covenantsEmRisco)} meta="Atenção ou violado" tone={summary.covenantsEmRisco > 0 ? "negative" : "positive"} icon={CoinsIconFallback} />
      <MetricCard label="Condições pendentes" value={String(summary.condicoesPendentes)} meta="Condições precedentes ainda não satisfeitas" tone={summary.condicoesPendentes > 0 ? "negative" : "positive"} icon={CoinsIconFallback} />
    </section>
  );
}

function ProposalDetail({ proposal }: { proposal: FundingWorkspaceProposal }) {
  const snapshot = proposal.decisionSnapshot as ProposalComparisonResult | null;
  return (
    <div className="view-stack" style={{ paddingLeft: "1rem", marginTop: "0.5rem" }}>
      <p>
        <strong>{proposal.kind}</strong> · {pct(proposal.annualNominalRate.toString())} a.a. ({proposal.indexer}
        {proposal.indexerRateSnapshot ? ` + ${pct(proposal.spreadRate.toString())}` : ""}) · {proposal.termMonths} meses, carência {proposal.graceMonths} · {proposal.amortizationSystem}
      </p>
      {proposal.notes && <p>{proposal.notes}</p>}

      {snapshot && (
        <div className="metrics-grid">
          <MetricCard label="CET (efetivo anualizado)" value={snapshot.effectiveAnnualCost ? pct(snapshot.effectiveAnnualCost) : "—"} meta="TIR do fluxo líquido de fees" icon={CoinsIconFallback} />
          <MetricCard label="Custo total do financiamento" value={money(snapshot.totalCost)} meta="Juros + fees ao longo do prazo" icon={CoinsIconFallback} />
          <MetricCard label="Pico de dívida" value={money(snapshot.peakDebt)} meta="Maior saldo devedor projetado" icon={CoinsIconFallback} />
          <MetricCard label="DSCR médio" value={snapshot.averageDebtServiceCoverage ? `${Number(snapshot.averageDebtServiceCoverage).toFixed(2)}x` : "—"} meta="NOI / serviço da dívida" icon={CoinsIconFallback} />
        </div>
      )}
      {snapshot && snapshot.riskFlags.length > 0 && (
        <ul>{snapshot.riskFlags.map((flag) => <li key={flag} className="metric-negative">{flag}</li>)}</ul>
      )}

      <details>
        <summary>Garantias ({proposal.guarantees.length})</summary>
        <ul>
          {proposal.guarantees.map((g) => (
            <li key={g.id}>{g.type} — {g.description}{g.amount ? ` (${money(g.amount.toString())})` : ""} — <em>{GUARANTEE_STATUS_LABEL[g.status] ?? g.status}</em></li>
          ))}
          {proposal.guarantees.length === 0 && <li>Nenhuma garantia cadastrada.</li>}
        </ul>
      </details>

      <details>
        <summary>Covenants ({proposal.covenants.length})</summary>
        {proposal.covenants.map((c) => (
          <div key={c.id} style={{ marginBottom: "0.5rem" }}>
            <p><strong>{c.code}</strong> — {c.description} ({c.metric} {c.thresholdOperator} {c.thresholdValue}, {c.periodicity}) — <em className={c.status === "BREACHED" ? "metric-negative" : c.status === "WARNING" ? "metric-negative" : "metric-positive"}>{COVENANT_STATUS_LABEL[c.status] ?? c.status}</em>{c.nextTestDate ? ` · próximo teste ${date(c.nextTestDate)}` : ""}</p>
            {c.evaluations.length > 0 && (
              <table className="ds-data-table">
                <thead><tr><th>Data</th><th>Valor observado</th><th>Resultado</th></tr></thead>
                <tbody>{c.evaluations.map((e) => <tr key={e.id}><td>{date(e.testedAt)}</td><td>{e.observedValue}</td><td>{COVENANT_STATUS_LABEL[e.result] ?? e.result}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        ))}
        {proposal.covenants.length === 0 && <p>Nenhum covenant cadastrado.</p>}
      </details>

      <details>
        <summary>Condições precedentes ({proposal.conditions.length})</summary>
        <ul>
          {proposal.conditions.map((c) => (
            <li key={c.id}>
              <strong>{c.code}</strong> — {c.description} — <em className={c.status === "PENDING" ? "metric-negative" : "metric-positive"}>{CONDITION_STATUS_LABEL[c.status] ?? c.status}</em>
              {c.dueAt ? ` · prazo ${date(c.dueAt)}` : ""}
            </li>
          ))}
          {proposal.conditions.length === 0 && <li>Nenhuma condição precedente cadastrada.</li>}
        </ul>
      </details>

      <details>
        <summary>Cronograma de desembolso ({proposal.disbursements.length})</summary>
        <table className="ds-data-table">
          <thead><tr><th>#</th><th>Previsto</th><th>Status</th><th>Confirmado por</th></tr></thead>
          <tbody>
            {proposal.disbursements.map((d) => (
              <tr key={d.id}>
                <td>{d.sequence}</td>
                <td>{money(d.expectedAmount.toString())} em {date(d.expectedDate)}</td>
                <td>{DISBURSEMENT_STATUS_LABEL[d.status] ?? d.status}</td>
                <td>{d.bankTransaction ? `${money(d.bankTransaction.amount.toString())} · ${date(d.bankTransaction.occurredAt)} · ${d.bankTransaction.status}` : "—"}</td>
              </tr>
            ))}
            {proposal.disbursements.length === 0 && <tr><td colSpan={4}>Nenhum desembolso planejado.</td></tr>}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function ComparisonSection({ comparison }: { comparison: ProposalComparisonResult[] }) {
  if (comparison.length === 0) return null;
  return (
    <section className="view-stack">
      <h3>Comparação de propostas em decisão (A vs B vs C)</h3>
      <div className="ds-data-table-wrap">
        <table className="ds-data-table">
          <thead>
            <tr><th>Financiador</th><th style={{ textAlign: "right" }}>Custo nominal</th><th style={{ textAlign: "right" }}>CET</th><th style={{ textAlign: "right" }}>Custo total</th><th style={{ textAlign: "right" }}>Pico de dívida</th><th style={{ textAlign: "right" }}>DSCR médio</th><th style={{ textAlign: "right" }}>Margem c/ financiamento</th><th style={{ textAlign: "right" }}>TIR c/ financiamento</th></tr>
          </thead>
          <tbody>
            {comparison.map((item) => (
              <tr key={item.proposalId}>
                <td>{item.providerName}</td>
                <td style={{ textAlign: "right" }}>{pct(item.nominalAnnualCost)}</td>
                <td style={{ textAlign: "right" }}>{item.effectiveAnnualCost ? pct(item.effectiveAnnualCost) : "—"}</td>
                <td style={{ textAlign: "right" }}>{money(item.totalCost)}</td>
                <td style={{ textAlign: "right" }}>{money(item.peakDebt)}</td>
                <td style={{ textAlign: "right" }}>{item.averageDebtServiceCoverage ? `${Number(item.averageDebtServiceCoverage).toFixed(2)}x` : "—"}</td>
                <td style={{ textAlign: "right" }}>{pct(item.impact.marginOnVgvWithFinancing)}</td>
                <td style={{ textAlign: "right" }}>{item.impact.annualIrrWithFinancing ? pct(item.impact.annualIrrWithFinancing) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {comparison.some((item) => item.riskFlags.length > 0) && (
        <ul>
          {comparison.filter((item) => item.riskFlags.length > 0).map((item) => (
            <li key={item.proposalId} className="metric-negative">{item.providerName}: {item.riskFlags.join(" ")}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CapitalFundingView({ summary, proposals, comparison }: { summary: CapitalExecutiveSummary; proposals: FundingWorkspaceProposal[]; comparison: ProposalComparisonResult[] }) {
  if (!summary.capitalNeed.hasOfficialCalculation && proposals.length === 0) {
    return (
      <div className="view-stack">
        <p className="ds-data-table-empty">Nenhum dado de Capital & Funding ainda para este empreendimento: calcule a viabilidade (REDE Engine) e registre uma proposta de funding para começar.</p>
      </div>
    );
  }

  return (
    <div className="view-stack">
      <CapitalNeedSection summary={summary} />
      <ExecutiveSummarySection summary={summary} />
      <ComparisonSection comparison={comparison} />

      <section className="view-stack">
        <h3>Propostas registradas ({proposals.length})</h3>
        {proposals.length === 0 ? (
          <p className="ds-data-table-empty">Nenhuma proposta de funding registrada ainda.</p>
        ) : (
          <div className="view-stack">
            {proposals.map((proposal) => (
              <details key={proposal.id} className="ds-data-table-wrap">
                <summary>
                  <strong>{proposal.code}</strong> v{proposal.version} — {proposal.providerName} — {money(proposal.amount.toString())} — <span className={statusTone(proposal.status === "APPROVED")}>{PROPOSAL_STATUS_LABEL[proposal.status] ?? proposal.status}</span>
                </summary>
                <ProposalDetail proposal={proposal} />
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
