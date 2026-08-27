"use client";

/**
 * Fase 9N.1 — Capital & Funding operacional. Necessidade de capital, propostas (criar, editar,
 * submeter, comparar, aprovar/rejeitar, versionar), desembolsos (com o bloqueio de confirmação
 * sem `BankTransaction` CREDIT+RECONCILED), covenants (avaliação append-only) e condições
 * precedentes. Toda mutação chama `src/app/actions/capital.ts`, que só resolve o `AuthContext` e
 * delega para `application/capital/capital-service.ts` — nenhuma regra de negócio nasce aqui, o
 * backend é a autoridade (RBAC incluso: um botão escondido nunca é a única defesa).
 *
 * Props chegam já serializadas (Decimal/Date → string) porque cruzam a fronteira Server→Client —
 * ver o `JSON.parse(JSON.stringify(...))` em `app/(workspace)/capital-funding/page.tsx`.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Coins } from "lucide-react";
import type { CapitalExecutiveSummary } from "@/application/capital/capital-queries";
import type { ProposalComparisonResult } from "@/domain/capital/types";
import { MetricCard } from "@/components/ui";
import {
  approveFundingDisbursementReleaseAction,
  approveFundingProposalAction,
  confirmFundingDisbursementAction,
  createFundingProposalAction,
  evaluateFundingCovenantAction,
  moveFundingProposalToReviewAction,
  rejectFundingProposalAction,
  requestFundingDisbursementAction,
  rescheduleFundingDebtServiceAction,
  reviseFundingProposalAction,
  submitFundingProposalAction,
  updateFundingConditionStatusAction,
} from "@/app/actions/capital";

const CoinsIconFallback = Coins;
const MUTABLE_STATUSES = new Set(["DRAFT", "SUBMITTED", "UNDER_REVIEW"]);

function money(value: number | string | null | undefined) {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function pct(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}
function date(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

const PROPOSAL_STATUS_LABEL: Record<string, string> = { DRAFT: "Rascunho", SUBMITTED: "Enviada", UNDER_REVIEW: "Em análise", APPROVED: "Aprovada", REJECTED: "Rejeitada", EXPIRED: "Expirada", WITHDRAWN: "Retirada" };
const DISBURSEMENT_STATUS_LABEL: Record<string, string> = { PLANNED: "Planejado", REQUESTED: "Solicitado", APPROVED: "Aprovado p/ liberação", DISBURSED: "Desembolsado", CANCELLED: "Cancelado" };
const COVENANT_STATUS_LABEL: Record<string, string> = { OK: "OK", WARNING: "Atenção", BREACHED: "Violado", WAIVED: "Dispensado" };
const CONDITION_STATUS_LABEL: Record<string, string> = { PENDING: "Pendente", SATISFIED: "Satisfeita", WAIVED: "Dispensada", REJECTED: "Rejeitada" };
const GUARANTEE_STATUS_LABEL: Record<string, string> = { PENDING: "Pendente", FORMALIZED: "Formalizada", ACTIVE: "Ativa", RELEASED: "Liberada" };
const KIND_LABEL: Record<string, string> = { EQUITY_PROPRIO: "Equity próprio", INVESTIDOR: "Investidor", MUTUO: "Mútuo", BANCO: "Banco", FINANCIAMENTO_PRODUCAO: "Financiamento à produção", SBPE: "SBPE", FGTS: "FGTS", CRI: "CRI", SECURITIZACAO: "Securitização", FUNDO: "Fundo", MEZANINO: "Mezanino", PERMUTA_FINANCEIRA: "Permuta financeira", PERMUTA_ECONOMICA: "Permuta econômica", HIBRIDO: "Híbrido", OUTRO: "Outro" };
const INDEXER_LABEL: Record<string, string> = { CDI: "CDI", IPCA: "IPCA", IGPM: "IGP-M", TR: "TR", SELIC: "SELIC", PRE_FIXADO: "Pré-fixado", OUTRO: "Outro" };
const AMORT_LABEL: Record<string, string> = { PRICE: "PRICE", SAC: "SAC", BULLET: "BULLET" };
const GUARANTEE_TYPE_LABEL: Record<string, string> = { GARANTIA_REAL: "Garantia real", CESSAO_FIDUCIARIA: "Cessão fiduciária", RECEBIVEIS: "Recebíveis", QUOTAS_ACOES: "Quotas/Ações", AVAL_FIANCA: "Aval/Fiança", CONTA_VINCULADA: "Conta vinculada", OUTRA: "Outra" };
const CONDITION_CATEGORY_LABEL: Record<string, string> = { DOCUMENTO: "Documento", LICENCA: "Licença", REGISTRO: "Registro", GARANTIA: "Garantia", SEGURO: "Seguro", APORTE: "Aporte", VENDA_MINIMA: "Venda mínima", OBRA_MINIMA: "Obra mínima", OUTRO: "Outro" };
/** Só os status de `BankTransaction` que aparecem nesta tela (vínculo de desembolso) — mesma disciplina de not vazar enum pra UI. */
const BANK_TRANSACTION_STATUS_LABEL: Record<string, string> = { RECEIVED: "Recebida", CANDIDATE: "Candidata", RECONCILED: "Conciliada", MANUAL_REVIEW: "Em revisão manual", UNRECONCILED: "Não conciliada", DISPUTED: "Contestada" };

function statusTone(ok: boolean) {
  return ok ? "metric-positive" : "metric-negative";
}

// ---------------------------------------------------------------------------
// Tipos client-safe (Decimal/Date já viraram string no round-trip de serialização)
// ---------------------------------------------------------------------------

export interface ClientGuarantee { id: string; type: string; description: string; amount: string | null; beneficiary: string | null; status: string; evidenceDocumentIds: string[] }
export interface ClientEvaluation { id: string; testedAt: string; observedValue: string; result: string; evidence: Record<string, unknown> | null }
export interface ClientCovenant { id: string; code: string; description: string; metric: string; thresholdOperator: string; thresholdValue: string; periodicity: string; nextTestDate: string | null; status: string; lastCheckedAt: string | null; lastValue: string | null; evaluations: ClientEvaluation[] }
export interface ClientCondition { id: string; code: string; category: string; description: string; status: string; dueAt: string | null; responsibleId: string | null; sourceType: string | null; sourceId: string | null; evidence: Record<string, unknown> | null; satisfiedAt: string | null }
export interface ClientBankTxnRef { id: string; amount: string; occurredAt: string; status: string; direction: string }
export interface ClientDisbursement { id: string; sequence: number; expectedDate: string; expectedAmount: string; status: string; bankTransactionId: string | null; actualDate: string | null; actualAmount: string | null; bankTransaction: ClientBankTxnRef | null }
export interface ClientFinancialEvent { id: string; scheduleVersion: number; installmentNumber: number; status: string; payload: { month: number; disbursement: string; openingBalance: string; interest: string; amortization: string; fees: string; installment: string; closingBalance: string } }
export interface ClientProposal {
  id: string; code: string; version: number; previousVersionId: string | null; status: string;
  providerName: string; kind: string; amount: string; currency: string;
  indexer: string; spreadRate: string; indexerRateSnapshot: string | null; annualNominalRate: string;
  termMonths: number; graceMonths: number; amortizationSystem: string;
  upfrontFeeRate: string; recurringFeeRateAnnual: string; iofRate: string | null;
  validUntil: string | null; notes: string | null; rejectionReason: string | null;
  decisionSnapshot: ProposalComparisonResult | null;
  guarantees: ClientGuarantee[]; covenants: ClientCovenant[]; conditions: ClientCondition[]; disbursements: ClientDisbursement[]; financialEvents: ClientFinancialEvent[];
}
export interface ClientEligibleTxn { id: string; amount: string; occurredAt: string; description: string; bankAccount: { agency: string; accountNumber: string; institution: { name: string } | null } }
export interface CapitalCapabilities { manageProposal: boolean; approve: boolean; manageCovenant: boolean; manageCondition: boolean }

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Necessidade de capital + resumo executivo (leitura — inalterado desde a versão só-leitura)
// ---------------------------------------------------------------------------

function CapitalNeedSection({ summary }: { summary: CapitalExecutiveSummary }) {
  const need = summary.capitalNeed;
  const deficitRows = need.monthlyCurve.filter((row) => Number(row.deficit) > 0);
  return (
    <section className="view-stack">
      <h3>Necessidade de Capital</h3>
      {!need.hasOfficialCalculation ? (
        <p className="ds-data-table-empty">Sem viabilidade calculada para este empreendimento ainda — cadastre/aprove a Base (REDE Engine) antes de estruturar o financiamento.</p>
      ) : (
        <>
          <section className="metrics-grid">
            <MetricCard label="Necessidade total de capital" value={money(need.totalCapitalNeed)} meta={`Pico no mês ${need.peakExposureMonth}`} icon={CoinsIconFallback} />
            <MetricCard label="Equity aportado" value={money(need.equityContributed)} meta="Aportes reais (intercompany APORTE)" icon={CoinsIconFallback} />
            <MetricCard label="Financiamento desembolsado" value={money(need.fundingDisbursed)} meta={need.unconfirmedDisbursementCount > 0 ? `${need.unconfirmedDisbursementCount} desembolso(s) ainda não conciliado(s)` : "Confirmado por transação bancária conciliada"} icon={CoinsIconFallback} />
            <MetricCard label="Financiamento ainda necessário" value={money(need.fundingStillNeeded)} meta={need.fullyCovered ? "Necessidade coberta" : "Ainda em aberto"} tone={need.fullyCovered ? "positive" : "negative"} icon={CoinsIconFallback} />
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
      <MetricCard label="Financiamento contratado (aprovado)" value={money(summary.fundingContratado)} meta="Soma das propostas APROVADAS" icon={CoinsIconFallback} />
      <MetricCard label="Saldo a liberar" value={money(summary.saldoALiberar)} meta="Desembolsos ainda não confirmados" icon={CoinsIconFallback} />
      <MetricCard label="Custo médio ponderado" value={summary.custoMedio !== null ? pct(summary.custoMedio) : "Sem dados"} meta="Taxa nominal ponderada pelo valor contratado" icon={CoinsIconFallback} />
      <MetricCard
        label="Próxima liberação"
        value={summary.proximaLiberacao ? money(summary.proximaLiberacao.expectedAmount) : "Nenhuma"}
        meta={summary.proximaLiberacao ? `Previsto para ${date(summary.proximaLiberacao.expectedDate)}` : "Nenhuma liberação pendente"}
        icon={CoinsIconFallback}
      />
      <MetricCard label="Cláusulas financeiras (covenants) em risco" value={String(summary.covenantsEmRisco)} meta="Atenção ou violado" tone={summary.covenantsEmRisco > 0 ? "negative" : "positive"} icon={CoinsIconFallback} />
      <MetricCard label="Condições pendentes" value={String(summary.condicoesPendentes)} meta="Condições precedentes ainda não satisfeitas" tone={summary.condicoesPendentes > 0 ? "negative" : "positive"} icon={CoinsIconFallback} />
    </section>
  );
}

function ComparisonSection({ comparison }: { comparison: ProposalComparisonResult[] }) {
  if (comparison.length === 0) return null;
  return (
    <section className="view-stack">
      <h3>Comparação de propostas em decisão (A vs B vs C)</h3>
      <p className="ds-data-table-empty" style={{ margin: 0 }}>
        Simulação em memória — nunca altera a Base Aprovada nem as propostas. Decisão é humana: nenhuma proposta é marcada automaticamente como &quot;melhor&quot;.
      </p>
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
      <small className="ds-data-table-empty" style={{ margin: 0 }}>DSCR pode aparecer negativo ou sem significado tradicional durante os meses de obra, quando o NOI do empreendimento ainda não existe — isso não é um erro do sistema, é a fase do empreendimento.</small>
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

// ---------------------------------------------------------------------------
// Formulário de proposta (criação e nova versão) — campos econômicos + linhas dinâmicas de
// garantia/covenant/condição. Edição EM LINHA (DRAFT/SUBMITTED/UNDER_REVIEW) só toca os campos
// econômicos: `reviseFundingProposal` no backend ignora garantias/covenants/condições fora da
// criação/versionamento (ver `capital-service.ts`) — a UI não finge suportar o que o serviço não faz.
// ---------------------------------------------------------------------------

type GuaranteeRow = { type: string; description: string; amount: string; beneficiary: string };
type CovenantRow = { code: string; description: string; metric: string; thresholdOperator: string; thresholdValue: string; periodicity: string; nextTestDate: string };
type ConditionRow = { code: string; category: string; description: string; dueAt: string; responsibleId: string };

function ProposalEconomicFields({ defaults }: { defaults?: Partial<ClientProposal> }) {
  return (
    <>
      <label>Financiador<input name="providerName" placeholder="Ex.: Banco XYZ" required defaultValue={defaults?.providerName} /></label>
      <label>Tipo<select name="kind" defaultValue={defaults?.kind ?? "BANCO"}>{Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label>Valor<input name="amount" type="number" step="0.01" min="0.01" required defaultValue={defaults?.amount} /></label>
      <label>Moeda<input name="currency" defaultValue={defaults?.currency ?? "BRL"} maxLength={3} /></label>
      <label>Indexador<select name="indexer" defaultValue={defaults?.indexer ?? "CDI"}>{Object.entries(INDEXER_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label>Spread (% a.a.)<input name="spreadRate" type="number" step="0.0001" min="0" required defaultValue={defaults?.spreadRate} /></label>
      <label>Taxa do indexador capturada (% a.a.)<input name="indexerRateSnapshot" type="number" step="0.0001" min="0" defaultValue={defaults?.indexerRateSnapshot ?? ""} placeholder="vazio se PRE_FIXADO" /></label>
      <label>Prazo (meses)<input name="termMonths" type="number" min="1" required defaultValue={defaults?.termMonths} /></label>
      <label>Carência (meses)<input name="graceMonths" type="number" min="0" required defaultValue={defaults?.graceMonths ?? 0} /></label>
      <label>Amortização<select name="amortizationSystem" defaultValue={defaults?.amortizationSystem ?? "PRICE"}>{Object.entries(AMORT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label>Taxa de estruturação (%)<input name="upfrontFeeRate" type="number" step="0.0001" min="0" defaultValue={defaults?.upfrontFeeRate ?? "0"} /></label>
      <label>Taxa recorrente anual (%)<input name="recurringFeeRateAnnual" type="number" step="0.0001" min="0" defaultValue={defaults?.recurringFeeRateAnnual ?? "0"} /></label>
      <label>IOF (%)<input name="iofRate" type="number" step="0.0001" min="0" defaultValue={defaults?.iofRate ?? ""} /></label>
      <label>Validade da proposta<input name="validUntil" type="date" defaultValue={defaults?.validUntil?.slice(0, 10) ?? ""} /></label>
      <label style={{ gridColumn: "span 3" }}>Observações<textarea name="notes" rows={2} defaultValue={defaults?.notes ?? ""} /></label>
    </>
  );
}

function GuaranteeEditor({ rows, setRows }: { rows: GuaranteeRow[]; setRows: (rows: GuaranteeRow[]) => void }) {
  return (
    <div className="ds-data-table-wrap">
      <strong>Garantias</strong>
      {rows.map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <select value={row.type} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, type: e.target.value } : r)))}>{Object.entries(GUARANTEE_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <input placeholder="Descrição" value={row.description} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, description: e.target.value } : r)))} style={{ flex: 1, minWidth: 160 }} />
          <input placeholder="Valor (opcional)" type="number" step="0.01" value={row.amount} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))} style={{ width: 130 }} />
          <input placeholder="Beneficiário (opcional)" value={row.beneficiary} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, beneficiary: e.target.value } : r)))} style={{ width: 160 }} />
          <button type="button" className="text-button" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remover</button>
        </div>
      ))}
      <button type="button" className="text-button" onClick={() => setRows([...rows, { type: "OUTRA", description: "", amount: "", beneficiary: "" }])}>+ Adicionar garantia</button>
    </div>
  );
}

function CovenantEditor({ rows, setRows }: { rows: CovenantRow[]; setRows: (rows: CovenantRow[]) => void }) {
  return (
    <div className="ds-data-table-wrap">
      <strong>Cláusulas financeiras</strong>
      {rows.map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input placeholder="Código (ex.: DSCR)" value={row.code} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, code: e.target.value } : r)))} style={{ width: 110 }} />
          <input placeholder="Descrição" value={row.description} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, description: e.target.value } : r)))} style={{ flex: 1, minWidth: 160 }} />
          <input placeholder="Métrica" value={row.metric} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, metric: e.target.value } : r)))} style={{ width: 110 }} />
          <select value={row.thresholdOperator} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, thresholdOperator: e.target.value } : r)))}>{[">=", "<=", ">", "<", "="].map((op) => <option key={op} value={op}>{op}</option>)}</select>
          <input placeholder="Valor limite" value={row.thresholdValue} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, thresholdValue: e.target.value } : r)))} style={{ width: 100 }} />
          <input placeholder="Periodicidade" value={row.periodicity} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, periodicity: e.target.value } : r)))} style={{ width: 120 }} />
          <input type="date" value={row.nextTestDate} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, nextTestDate: e.target.value } : r)))} />
          <button type="button" className="text-button" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remover</button>
        </div>
      ))}
      <button type="button" className="text-button" onClick={() => setRows([...rows, { code: "", description: "", metric: "", thresholdOperator: ">=", thresholdValue: "", periodicity: "TRIMESTRAL", nextTestDate: "" }])}>+ Adicionar cláusula financeira</button>
    </div>
  );
}

function ConditionEditor({ rows, setRows }: { rows: ConditionRow[]; setRows: (rows: ConditionRow[]) => void }) {
  return (
    <div className="ds-data-table-wrap">
      <strong>Condições precedentes</strong>
      {rows.map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input placeholder="Código (ex.: CP-01)" value={row.code} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, code: e.target.value } : r)))} style={{ width: 110 }} />
          <select value={row.category} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, category: e.target.value } : r)))}>{Object.entries(CONDITION_CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <input placeholder="Descrição" value={row.description} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, description: e.target.value } : r)))} style={{ flex: 1, minWidth: 160 }} />
          <input type="date" value={row.dueAt} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, dueAt: e.target.value } : r)))} />
          <input placeholder="Responsável (ID, opcional)" value={row.responsibleId} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, responsibleId: e.target.value } : r)))} style={{ width: 160 }} />
          <button type="button" className="text-button" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remover</button>
        </div>
      ))}
      <button type="button" className="text-button" onClick={() => setRows([...rows, { code: "", category: "DOCUMENTO", description: "", dueAt: "", responsibleId: "" }])}>+ Adicionar condição</button>
    </div>
  );
}

function buildCoreFieldsFromForm(form: FormData) {
  const numOrUndef = (key: string) => { const v = form.get(key); return v && String(v).trim() !== "" ? String(v) : undefined; };
  return {
    providerName: String(form.get("providerName")),
    kind: form.get("kind") as never,
    amount: String(form.get("amount")),
    currency: String(form.get("currency") || "BRL"),
    indexer: form.get("indexer") as never,
    spreadRate: String(form.get("spreadRate")),
    indexerRateSnapshot: numOrUndef("indexerRateSnapshot") ?? null,
    termMonths: Number(form.get("termMonths")),
    graceMonths: Number(form.get("graceMonths")),
    amortizationSystem: form.get("amortizationSystem") as never,
    paymentFrequency: "MONTHLY" as const,
    upfrontFeeRate: String(form.get("upfrontFeeRate") || "0"),
    recurringFeeRateAnnual: String(form.get("recurringFeeRateAnnual") || "0"),
    iofRate: numOrUndef("iofRate") ?? null,
    validUntil: numOrUndef("validUntil") ? new Date(`${form.get("validUntil")}T00:00:00.000Z`) : null,
    notes: numOrUndef("notes") ?? null,
  };
}

function rowsToGuarantees(rows: GuaranteeRow[]) {
  return rows.filter((r) => r.description.trim()).map((r) => ({ type: r.type as never, description: r.description, amount: r.amount || null, beneficiary: r.beneficiary || null, evidenceDocumentIds: [] }));
}
function rowsToCovenants(rows: CovenantRow[]) {
  return rows.filter((r) => r.code.trim() && r.description.trim()).map((r) => ({ code: r.code, description: r.description, metric: r.metric, thresholdOperator: r.thresholdOperator as never, thresholdValue: r.thresholdValue, periodicity: r.periodicity, nextTestDate: r.nextTestDate ? new Date(`${r.nextTestDate}T00:00:00.000Z`) : null }));
}
function rowsToConditions(rows: ConditionRow[]) {
  return rows.filter((r) => r.code.trim() && r.description.trim()).map((r) => ({ code: r.code, category: r.category as never, description: r.description, dueAt: r.dueAt ? new Date(`${r.dueAt}T00:00:00.000Z`) : null, responsibleId: r.responsibleId || null }));
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function CapitalFundingView({
  projectId,
  summary,
  proposals,
  comparison,
  eligibleBankTransactions,
  capabilities,
}: {
  projectId: string;
  summary: CapitalExecutiveSummary;
  proposals: ClientProposal[];
  comparison: ProposalComparisonResult[];
  eligibleBankTransactions: ClientEligibleTxn[];
  capabilities: CapitalCapabilities;
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createGuarantees, setCreateGuarantees] = useState<GuaranteeRow[]>([]);
  const [createCovenants, setCreateCovenants] = useState<CovenantRow[]>([]);
  const [createConditions, setCreateConditions] = useState<ConditionRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [versioningId, setVersioningId] = useState<string | null>(null);
  const [versionGuarantees, setVersionGuarantees] = useState<GuaranteeRow[]>([]);
  const [versionCovenants, setVersionCovenants] = useState<CovenantRow[]>([]);
  const [versionConditions, setVersionConditions] = useState<ConditionRow[]>([]);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [confirmingDisbursementId, setConfirmingDisbursementId] = useState<string | null>(null);
  const [evaluatingCovenantId, setEvaluatingCovenantId] = useState<string | null>(null);
  const [updatingConditionId, setUpdatingConditionId] = useState<string | null>(null);
  const [conditionEvidence, setConditionEvidence] = useState("");

  async function withFeedback<T>(operation: () => Promise<ActionResult<T>>, successMessage: (data: T) => string) {
    setBusy(true); setFeedback(null);
    const result = await operation();
    setBusy(false);
    if (!result.ok) { setFeedback({ tone: "error", text: result.error }); return null; }
    setFeedback({ tone: "ok", text: successMessage(result.data) });
    router.refresh();
    return result.data;
  }

  async function submitCreate(form: FormData) {
    const core = buildCoreFieldsFromForm(form);
    await withFeedback(() => createFundingProposalAction({
      projectId, code: String(form.get("code")), ...core,
      guarantees: rowsToGuarantees(createGuarantees), covenants: rowsToCovenants(createCovenants), conditions: rowsToConditions(createConditions),
    }), () => "Proposta registrada em rascunho.");
    setShowCreateForm(false); setCreateGuarantees([]); setCreateCovenants([]); setCreateConditions([]);
  }

  async function submitEdit(proposal: ClientProposal, form: FormData) {
    const core = buildCoreFieldsFromForm(form);
    await withFeedback(() => reviseFundingProposalAction(proposal.id, core), () => "Proposta atualizada.");
    setEditingId(null);
  }

  async function submitNewVersion(proposal: ClientProposal, form: FormData) {
    const core = buildCoreFieldsFromForm(form);
    await withFeedback(() => reviseFundingProposalAction(proposal.id, {
      ...core, guarantees: rowsToGuarantees(versionGuarantees), covenants: rowsToCovenants(versionCovenants), conditions: rowsToConditions(versionConditions),
    }), (data) => `Nova versão criada (v${data.version}).`);
    setVersioningId(null); setVersionGuarantees([]); setVersionCovenants([]); setVersionConditions([]);
  }

  function startVersioning(proposal: ClientProposal) {
    setVersioningId(proposal.id);
    setVersionGuarantees(proposal.guarantees.map((g) => ({ type: g.type, description: g.description, amount: g.amount ?? "", beneficiary: g.beneficiary ?? "" })));
    setVersionCovenants(proposal.covenants.map((c) => ({ code: c.code, description: c.description, metric: c.metric, thresholdOperator: c.thresholdOperator, thresholdValue: c.thresholdValue, periodicity: c.periodicity, nextTestDate: c.nextTestDate?.slice(0, 10) ?? "" })));
    setVersionConditions(proposal.conditions.map((c) => ({ code: c.code, category: c.category, description: c.description, dueAt: c.dueAt?.slice(0, 10) ?? "", responsibleId: c.responsibleId ?? "" })));
  }

  async function submitReject(proposal: ClientProposal, form: FormData) {
    await withFeedback(() => rejectFundingProposalAction(proposal.id, String(form.get("reason"))), () => "Proposta rejeitada.");
    setRejectingId(null);
  }

  async function submitConfirmDisbursement(disbursementId: string, form: FormData) {
    await withFeedback(() => confirmFundingDisbursementAction({ disbursementId, bankTransactionId: String(form.get("bankTransactionId")) }), () => "Desembolso confirmado a partir da transação bancária conciliada.");
    setConfirmingDisbursementId(null);
  }

  async function submitEvaluateCovenant(covenantId: string, form: FormData) {
    const evidenceNote = String(form.get("evidenceNote") || "").trim();
    await withFeedback(() => evaluateFundingCovenantAction({
      covenantId, testedAt: new Date(`${form.get("testedAt")}T00:00:00.000Z`), observedValue: String(form.get("observedValue")), result: form.get("result") as never,
      evidence: evidenceNote ? { note: evidenceNote } : null,
    }), () => "Avaliação registrada no histórico (append-only).");
    setEvaluatingCovenantId(null);
  }

  async function submitConditionStatus(conditionId: string, status: "SATISFIED" | "WAIVED" | "REJECTED") {
    const evidenceNote = conditionEvidence.trim();
    await withFeedback(() => updateFundingConditionStatusAction({ conditionId, status, evidence: evidenceNote ? { note: evidenceNote } : null }), () => "Condição atualizada.");
    setUpdatingConditionId(null); setConditionEvidence("");
  }

  if (!summary.capitalNeed.hasOfficialCalculation && proposals.length === 0) {
    return (
      <div className="view-stack">
        <p className="ds-data-table-empty">Nenhum dado de Capital e Financiamento ainda para este empreendimento: calcule a viabilidade (REDE Engine) e registre uma proposta de financiamento para começar.</p>
        {capabilities.manageProposal && (
          <button className="button button-primary" onClick={() => setShowCreateForm(true)} style={{ width: "fit-content" }}>Nova proposta</button>
        )}
        {showCreateForm && (
          <form className="ds-data-table-wrap" style={{ padding: 20, display: "grid", gap: 10, gridTemplateColumns: "repeat(3, 1fr)" }} action={submitCreate}>
            <label>Código<input name="code" placeholder="Ex.: PROP-01" required /></label>
            <ProposalEconomicFields />
            <div style={{ gridColumn: "span 3" }}><GuaranteeEditor rows={createGuarantees} setRows={setCreateGuarantees} /></div>
            <div style={{ gridColumn: "span 3" }}><CovenantEditor rows={createCovenants} setRows={setCreateCovenants} /></div>
            <div style={{ gridColumn: "span 3" }}><ConditionEditor rows={createConditions} setRows={setCreateConditions} /></div>
            <button className="button button-primary" disabled={busy} type="submit">Registrar proposta</button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="view-stack">
      {feedback && <div className="model-note" role="status"><div><strong>Capital e Financiamento</strong><p className={feedback.tone === "error" ? "metric-negative" : undefined}>{feedback.text}</p></div></div>}

      <CapitalNeedSection summary={summary} />
      <ExecutiveSummarySection summary={summary} />
      <ComparisonSection comparison={comparison} />

      <section className="view-stack">
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Propostas registradas ({proposals.length})</h3>
          {capabilities.manageProposal && <button className="button button-secondary" onClick={() => setShowCreateForm((v) => !v)}>{showCreateForm ? "Cancelar" : "Nova proposta"}</button>}
        </header>

        {showCreateForm && (
          <form className="ds-data-table-wrap" style={{ padding: 20, display: "grid", gap: 10, gridTemplateColumns: "repeat(3, 1fr)" }} action={submitCreate}>
            <label>Código<input name="code" placeholder="Ex.: PROP-01" required /></label>
            <ProposalEconomicFields />
            <div style={{ gridColumn: "span 3" }}><GuaranteeEditor rows={createGuarantees} setRows={setCreateGuarantees} /></div>
            <div style={{ gridColumn: "span 3" }}><CovenantEditor rows={createCovenants} setRows={setCreateCovenants} /></div>
            <div style={{ gridColumn: "span 3" }}><ConditionEditor rows={createConditions} setRows={setCreateConditions} /></div>
            <button className="button button-primary" disabled={busy} type="submit">Registrar proposta</button>
          </form>
        )}

        {proposals.length === 0 ? (
          <p className="ds-data-table-empty">Nenhuma proposta de financiamento registrada ainda.</p>
        ) : (
          <div className="view-stack">
            {proposals.map((proposal) => {
              const mutable = MUTABLE_STATUSES.has(proposal.status);
              const snapshot = proposal.decisionSnapshot;
              return (
                <details key={proposal.id} className="ds-data-table-wrap">
                  <summary>
                    <strong>{proposal.code}</strong> v{proposal.version} — {proposal.providerName} — {money(proposal.amount)} — <span className={statusTone(proposal.status === "APPROVED")}>{PROPOSAL_STATUS_LABEL[proposal.status] ?? proposal.status}</span>
                    {proposal.previousVersionId && <em> · nova versão de proposta anterior</em>}
                  </summary>

                  <div className="view-stack" style={{ paddingLeft: "1rem", marginTop: "0.5rem" }}>
                    <p>
                      <strong>{KIND_LABEL[proposal.kind] ?? proposal.kind}</strong> · {pct(proposal.annualNominalRate)} a.a. ({INDEXER_LABEL[proposal.indexer] ?? proposal.indexer}{proposal.indexerRateSnapshot ? ` + ${pct(proposal.spreadRate)}` : ""}) · {proposal.termMonths} meses, carência {proposal.graceMonths} · {AMORT_LABEL[proposal.amortizationSystem] ?? proposal.amortizationSystem}
                      {proposal.validUntil && ` · validade ${date(proposal.validUntil)}`}
                    </p>
                    {proposal.notes && <p>{proposal.notes}</p>}
                    {proposal.status === "REJECTED" && proposal.rejectionReason && <p className="metric-negative">Motivo da rejeição: {proposal.rejectionReason}</p>}
                    {!mutable && <p className="ds-data-table-empty" style={{ margin: 0 }}>Termos econômicos congelados ({PROPOSAL_STATUS_LABEL[proposal.status] ?? proposal.status}) — qualquer alteração relevante cria uma nova versão, nunca sobrescreve esta.</p>}

                    {snapshot && (
                      <div className="metrics-grid">
                        <MetricCard label="CET (efetivo anualizado)" value={snapshot.effectiveAnnualCost ? pct(snapshot.effectiveAnnualCost) : "—"} meta="TIR do fluxo líquido de fees" icon={CoinsIconFallback} />
                        <MetricCard label="Custo total do financiamento" value={money(snapshot.totalCost)} meta="Juros + fees ao longo do prazo" icon={CoinsIconFallback} />
                        <MetricCard label="Pico de dívida" value={money(snapshot.peakDebt)} meta="Maior saldo devedor projetado" icon={CoinsIconFallback} />
                        <MetricCard label="DSCR médio" value={snapshot.averageDebtServiceCoverage ? `${Number(snapshot.averageDebtServiceCoverage).toFixed(2)}x` : "—"} meta="NOI / serviço da dívida — pode ficar negativo/sem sentido durante a obra" icon={CoinsIconFallback} />
                      </div>
                    )}
                    {snapshot && snapshot.riskFlags.length > 0 && <ul>{snapshot.riskFlags.map((flag) => <li key={flag} className="metric-negative">{flag}</li>)}</ul>}

                    {/* Ações de ciclo de vida */}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {capabilities.manageProposal && mutable && editingId !== proposal.id && (
                        <button className="text-button" disabled={busy} onClick={() => setEditingId(proposal.id)}>Editar campos econômicos</button>
                      )}
                      {capabilities.manageProposal && proposal.status === "DRAFT" && (
                        <button className="text-button" disabled={busy} onClick={() => withFeedback(() => submitFundingProposalAction(proposal.id), () => "Proposta enviada.")}>Enviar</button>
                      )}
                      {capabilities.manageProposal && proposal.status === "SUBMITTED" && (
                        <button className="text-button" disabled={busy} onClick={() => withFeedback(() => moveFundingProposalToReviewAction(proposal.id), () => "Proposta em análise.")}>Colocar em análise</button>
                      )}
                      {capabilities.approve && (proposal.status === "SUBMITTED" || proposal.status === "UNDER_REVIEW") && (
                        <button className="text-button" disabled={busy} onClick={() => withFeedback(() => approveFundingProposalAction(proposal.id), () => "Proposta aprovada — serviço da dívida materializado no Financeiro.")}>Aprovar</button>
                      )}
                      {capabilities.approve && (proposal.status === "SUBMITTED" || proposal.status === "UNDER_REVIEW") && rejectingId !== proposal.id && (
                        <button className="text-button" disabled={busy} onClick={() => setRejectingId(proposal.id)}>Rejeitar</button>
                      )}
                      {capabilities.manageProposal && !mutable && (
                        <button className="text-button" disabled={busy} onClick={() => startVersioning(proposal)}>Criar nova versão</button>
                      )}
                      {capabilities.approve && proposal.status === "APPROVED" && (
                        <button className="text-button" disabled={busy} onClick={() => withFeedback(() => rescheduleFundingDebtServiceAction(proposal.id), (data) => `Serviço da dívida reagendado (versão ${data.scheduleVersion}). Parcelas pagas preservadas.`)}>Reagendar serviço da dívida</button>
                      )}
                    </div>

                    {rejectingId === proposal.id && (
                      <form className="ds-data-table-wrap" style={{ display: "flex", gap: 6 }} action={(form) => submitReject(proposal, form)}>
                        <input name="reason" placeholder="Motivo da rejeição" required style={{ flex: 1 }} />
                        <button className="text-button" disabled={busy} type="submit">Confirmar rejeição</button>
                        <button className="text-button" type="button" onClick={() => setRejectingId(null)}>Cancelar</button>
                      </form>
                    )}

                    {editingId === proposal.id && (
                      <form className="ds-data-table-wrap" style={{ padding: 16, display: "grid", gap: 10, gridTemplateColumns: "repeat(3, 1fr)" }} action={(form) => submitEdit(proposal, form)}>
                        <ProposalEconomicFields defaults={proposal} />
                        <div style={{ gridColumn: "span 3", display: "flex", gap: 8 }}>
                          <button className="button button-primary" disabled={busy} type="submit">Salvar</button>
                          <button className="text-button" type="button" onClick={() => setEditingId(null)}>Cancelar</button>
                        </div>
                      </form>
                    )}

                    {versioningId === proposal.id && (
                      <form className="ds-data-table-wrap" style={{ padding: 16, display: "grid", gap: 10, gridTemplateColumns: "repeat(3, 1fr)" }} action={(form) => submitNewVersion(proposal, form)}>
                        <p style={{ gridColumn: "span 3" }} className="ds-data-table-empty">Cria a versão {proposal.version + 1} desta proposta (código {proposal.code}) — a versão atual nunca é sobrescrita.</p>
                        <ProposalEconomicFields defaults={proposal} />
                        <div style={{ gridColumn: "span 3" }}><GuaranteeEditor rows={versionGuarantees} setRows={setVersionGuarantees} /></div>
                        <div style={{ gridColumn: "span 3" }}><CovenantEditor rows={versionCovenants} setRows={setVersionCovenants} /></div>
                        <div style={{ gridColumn: "span 3" }}><ConditionEditor rows={versionConditions} setRows={setVersionConditions} /></div>
                        <div style={{ gridColumn: "span 3", display: "flex", gap: 8 }}>
                          <button className="button button-primary" disabled={busy} type="submit">Criar versão {proposal.version + 1}</button>
                          <button className="text-button" type="button" onClick={() => setVersioningId(null)}>Cancelar</button>
                        </div>
                      </form>
                    )}

                    {/* Garantias */}
                    <details>
                      <summary>Garantias ({proposal.guarantees.length})</summary>
                      <ul>
                        {proposal.guarantees.map((g) => (
                          <li key={g.id}>{GUARANTEE_TYPE_LABEL[g.type] ?? g.type} — {g.description}{g.amount ? ` (${money(g.amount)})` : ""}{g.beneficiary ? ` · beneficiário: ${g.beneficiary}` : ""} — <em>{GUARANTEE_STATUS_LABEL[g.status] ?? g.status}</em>{g.evidenceDocumentIds.length > 0 ? ` · ${g.evidenceDocumentIds.length} evidência(s) vinculada(s)` : ""}</li>
                        ))}
                        {proposal.guarantees.length === 0 && <li>Nenhuma garantia cadastrada.</li>}
                      </ul>
                      {mutable && <small className="ds-data-table-empty">Garantias são definidas no registro da proposta; para alterá-las depois, use &quot;Criar nova versão&quot;.</small>}
                    </details>

                    {/* Covenants */}
                    <details>
                      <summary>Cláusulas financeiras ({proposal.covenants.length})</summary>
                      {proposal.covenants.map((c) => (
                        <div key={c.id} style={{ marginBottom: "0.5rem" }}>
                          <p>
                            <strong>{c.code}</strong> — {c.description} ({c.metric} {c.thresholdOperator} {c.thresholdValue}, {c.periodicity}) — <em className={c.status === "BREACHED" || c.status === "WARNING" ? "metric-negative" : "metric-positive"}>{COVENANT_STATUS_LABEL[c.status] ?? c.status}</em>{c.nextTestDate ? ` · próximo teste ${date(c.nextTestDate)}` : ""}
                            {capabilities.manageCovenant && evaluatingCovenantId !== c.id && <button className="text-button" style={{ marginLeft: 8 }} disabled={busy} onClick={() => setEvaluatingCovenantId(c.id)}>Registrar avaliação</button>}
                          </p>
                          {evaluatingCovenantId === c.id && (
                            <form style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }} action={(form) => submitEvaluateCovenant(c.id, form)}>
                              <input name="testedAt" type="date" defaultValue={today()} required />
                              <input name="observedValue" placeholder="Valor observado" required style={{ width: 120 }} />
                              <select name="result" defaultValue="OK">{Object.entries(COVENANT_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                              <input name="evidenceNote" placeholder="Evidência (opcional)" style={{ flex: 1, minWidth: 140 }} />
                              <button className="text-button" disabled={busy} type="submit">Salvar avaliação</button>
                              <button className="text-button" type="button" onClick={() => setEvaluatingCovenantId(null)}>Cancelar</button>
                            </form>
                          )}
                          {c.evaluations.length > 0 && (
                            <table className="ds-data-table">
                              <thead><tr><th>Data</th><th>Valor observado</th><th>Resultado</th></tr></thead>
                              <tbody>{c.evaluations.map((e) => <tr key={e.id}><td>{date(e.testedAt)}</td><td>{e.observedValue}</td><td>{COVENANT_STATUS_LABEL[e.result] ?? e.result}</td></tr>)}</tbody>
                            </table>
                          )}
                        </div>
                      ))}
                      {proposal.covenants.length === 0 && <p>Nenhuma cláusula financeira cadastrada.</p>}
                    </details>

                    {/* Condições precedentes */}
                    <details>
                      <summary>Condições precedentes ({proposal.conditions.length})</summary>
                      <ul>
                        {proposal.conditions.map((c) => (
                          <li key={c.id} style={{ marginBottom: 6 }}>
                            <strong>{c.code}</strong> ({CONDITION_CATEGORY_LABEL[c.category] ?? c.category}) — {c.description} — <em className={c.status === "PENDING" ? "metric-negative" : "metric-positive"}>{CONDITION_STATUS_LABEL[c.status] ?? c.status}</em>
                            {c.dueAt ? ` · prazo ${date(c.dueAt)}` : ""}
                            {c.responsibleId ? ` · responsável ${c.responsibleId}` : ""}
                            {c.satisfiedAt ? ` · cumprida em ${date(c.satisfiedAt)}` : ""}
                            {capabilities.manageCondition && c.status === "PENDING" && updatingConditionId !== c.id && (
                              <button className="text-button" style={{ marginLeft: 8 }} disabled={busy} onClick={() => { setUpdatingConditionId(c.id); setConditionEvidence(""); }}>Atualizar</button>
                            )}
                            {updatingConditionId === c.id && (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                                <input placeholder="Evidência (opcional)" value={conditionEvidence} onChange={(e) => setConditionEvidence(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
                                <button className="text-button" disabled={busy} type="button" onClick={() => submitConditionStatus(c.id, "SATISFIED")}>Marcar cumprida</button>
                                <button className="text-button" disabled={busy} type="button" onClick={() => submitConditionStatus(c.id, "WAIVED")}>Dispensar</button>
                                <button className="text-button" type="button" onClick={() => setUpdatingConditionId(null)}>Cancelar</button>
                              </div>
                            )}
                          </li>
                        ))}
                        {proposal.conditions.length === 0 && <li>Nenhuma condição precedente cadastrada.</li>}
                      </ul>
                    </details>

                    {/* Desembolsos */}
                    <details open>
                      <summary>Cronograma de desembolso ({proposal.disbursements.length})</summary>
                      <table className="ds-data-table">
                        <thead><tr><th>#</th><th>Previsto</th><th>Status</th><th>Confirmado por</th><th>Ação</th></tr></thead>
                        <tbody>
                          {proposal.disbursements.map((d) => (
                            <tr key={d.id}>
                              <td>{d.sequence}</td>
                              <td>{money(d.expectedAmount)} em {date(d.expectedDate)}</td>
                              <td>{DISBURSEMENT_STATUS_LABEL[d.status] ?? d.status}</td>
                              <td>{d.bankTransaction ? `${money(d.bankTransaction.amount)} · ${date(d.bankTransaction.occurredAt)} · ${BANK_TRANSACTION_STATUS_LABEL[d.bankTransaction.status] ?? d.bankTransaction.status}` : "—"}</td>
                              <td>
                                {capabilities.manageProposal && d.status === "PLANNED" && <button className="text-button" disabled={busy} onClick={() => withFeedback(() => requestFundingDisbursementAction(d.id), () => "Desembolso solicitado.")}>Solicitar</button>}
                                {capabilities.approve && d.status === "REQUESTED" && <button className="text-button" disabled={busy} onClick={() => withFeedback(() => approveFundingDisbursementReleaseAction(d.id), () => "Liberação aprovada.")}>Aprovar liberação</button>}
                                {capabilities.approve && (d.status === "APPROVED" || d.status === "REQUESTED") && confirmingDisbursementId !== d.id && (
                                  eligibleBankTransactions.length === 0 ? (
                                    <span className="metric-negative" style={{ fontSize: "var(--text-xs)" }}>Desembolso ainda não confirmado pelo Financeiro.</span>
                                  ) : (
                                    <button className="text-button" disabled={busy} onClick={() => setConfirmingDisbursementId(d.id)}>Confirmar</button>
                                  )
                                )}
                                {confirmingDisbursementId === d.id && (
                                  <form style={{ display: "flex", gap: 6 }} action={(form) => submitConfirmDisbursement(d.id, form)}>
                                    <select name="bankTransactionId" required defaultValue="">
                                      <option value="" disabled>Transação bancária de crédito conciliada</option>
                                      {eligibleBankTransactions.map((t) => (
                                        <option key={t.id} value={t.id}>{money(t.amount)} · {date(t.occurredAt)} · {t.bankAccount.institution?.name ?? "—"} ag {t.bankAccount.agency}</option>
                                      ))}
                                    </select>
                                    <button className="text-button" disabled={busy} type="submit">Confirmar</button>
                                    <button className="text-button" type="button" onClick={() => setConfirmingDisbursementId(null)}>Cancelar</button>
                                  </form>
                                )}
                              </td>
                            </tr>
                          ))}
                          {proposal.disbursements.length === 0 && <tr><td colSpan={5}>Nenhum desembolso planejado.</td></tr>}
                        </tbody>
                      </table>
                    </details>

                    {/* Serviço da dívida */}
                    {proposal.financialEvents.length > 0 && (
                      <details>
                        <summary>Serviço da dívida ({proposal.financialEvents.length} parcela(s))</summary>
                        <table className="ds-data-table">
                          <thead><tr><th>Versão</th><th>Parcela</th><th style={{ textAlign: "right" }}>Juros</th><th style={{ textAlign: "right" }}>Amortização</th><th style={{ textAlign: "right" }}>Tarifas</th><th style={{ textAlign: "right" }}>Total</th><th>Status</th></tr></thead>
                          <tbody>
                            {proposal.financialEvents.map((e) => (
                              <tr key={e.id}>
                                <td>{e.scheduleVersion}</td>
                                <td>{e.installmentNumber}</td>
                                <td style={{ textAlign: "right" }}>{money(e.payload.interest)}</td>
                                <td style={{ textAlign: "right" }}>{money(e.payload.amortization)}</td>
                                <td style={{ textAlign: "right" }}>{money(e.payload.fees)}</td>
                                <td style={{ textAlign: "right" }}>{money(e.payload.installment)}</td>
                                <td>{e.status === "PROCESSED" ? "Lançado no Financeiro" : e.status === "REVERSED" ? "Revertido (reagendado)" : e.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <small className="ds-data-table-empty">Cada parcela vira uma conta a pagar no Financeiro (origem: Financiamento) — o pagamento em si é registrado lá, nunca aqui.</small>
                      </details>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
