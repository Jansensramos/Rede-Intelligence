"use client";

/**
 * Fase 9K.1 — Gestão Executiva (§1): primeira área, porta de entrada principal. Conteúdo idêntico
 * ao antigo `view === "overview"` de `intelligence-workspace.tsx` — só a casca mudou (rota real em
 * vez de estado de componente). A reconstrução por exceção (Visão Executiva de verdade) é a 9K.2;
 * aqui só garantimos que a Gestão Executiva aparece primeiro e funciona como área principal.
 *
 * Links "Abrir X" / "Ver Y" que antes trocavam `view` local agora navegam para a rota real da
 * Grande Área correspondente — o mesmo destino de antes, só que via URL de verdade.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDownRight, ArrowRight, Building2, Check, CircleDollarSign, Gauge, Scale, Sparkles, TrendingUp } from "lucide-react";
import { CashFlowChart } from "@/components/cash-flow-chart";
import { RedTeamSummary } from "@/components/red-team-view";
import { ScoreSummary } from "@/components/score-summary";
import { MetricCard } from "@/components/ui";
import { analyzeRisk, type FindingSeverity } from "@/domain/risk/rules";
import { calculateAllScenarios } from "@/domain/financial/engine";
import { SCENARIOS } from "@/domain/financial/scenarios";
import type { ScenarioKey } from "@/domain/financial/types";
import type { PersistedStudyView } from "@/application/studies/contracts";
import type { PeoplePerformanceWorkspaceView } from "@/application/people-performance/people-performance-service";
import type { AccountingWorkspaceView } from "@/application/accounting/accounting-service";
import type { IntegrationsWorkspaceView } from "@/application/integrations/integrations-service";
import type { DataIntelligenceWorkspace } from "@/application/data-intelligence/data-intelligence-service";
import type { MarketProductWorkspaceView } from "@/application/market-product";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const compactCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const brl = (value: string) => currency.format(Number(value));
const compactBrl = (value: string) => compactCurrency.format(Number(value));
const percentage = (value: string | null) => (value === null ? "—" : `${number.format(Number(value) * 100)}%`);
function statusClass(severity: FindingSeverity) {
  return severity === "critical" ? "critical" : severity === "warning" ? "warning" : "positive";
}

export function GestaoExecutivaView({
  study,
  peoplePerformance,
  accounting,
  integrations,
  dataIntelligence,
  marketProduct,
}: {
  study: PersistedStudyView;
  peoplePerformance: PeoplePerformanceWorkspaceView;
  accounting: AccountingWorkspaceView;
  integrations: IntegrationsWorkspaceView;
  dataIntelligence: DataIntelligenceWorkspace;
  marketProduct: MarketProductWorkspaceView;
}) {
  const router = useRouter();
  const [scenario, setScenario] = useState<ScenarioKey>("base");
  const project = study.assumptions;

  const results = useMemo(() => calculateAllScenarios(project), [project]);
  const result = results[scenario];
  const score = study.analytics.scores[scenario];
  const recommendation = useMemo(() => analyzeRisk(result), [result]);
  const criticalCount = recommendation.findings.filter((item) => item.severity === "critical").length;
  const warningCount = recommendation.findings.filter((item) => item.severity === "warning").length;

  const decisionTone = recommendation.status === "NAO_AVANCAR" ? "decision-critical" : recommendation.status === "AVANCAR_COM_AJUSTES" ? "decision-warning" : "decision-positive";
  const maxCost = Number(result.metrics.totalCost);
  const costSegments = [
    { label: "Construção", value: Number(result.metrics.constructionCost), color: "#173d4f" },
    { label: "Terreno", value: Number(result.metrics.landCost), color: "#b98a43" },
    { label: "Comercial e tributos", value: Number(result.metrics.commission) + Number(result.metrics.marketing) + Number(result.metrics.taxes), color: "#789194" },
    { label: "Demais custos", value: Number(result.metrics.indirectCosts) + Number(result.metrics.contingency) + Number(result.metrics.financingCost), color: "#d9d2c4" },
  ];
  let angle = 0;
  const donut = `conic-gradient(${costSegments.map((segment) => { const start = angle; angle += (segment.value / maxCost) * 360; return `${segment.color} ${start}deg ${angle}deg`; }).join(",")})`;

  return (
    <div className="view-stack">
      <div className="project-heading">
        <div className="scenario-switch" aria-label="Cenário ativo">
          {(["conservative", "base", "aggressive"] as ScenarioKey[]).map((key) => (
            <button key={key} className={scenario === key ? "is-active" : ""} onClick={() => setScenario(key)}>{SCENARIOS[key].label}</button>
          ))}
        </div>
      </div>

      <section className={`decision-banner ${decisionTone}`}>
        <div className="decision-icon">{recommendation.status === "AVANCAR" ? <Check size={21} /> : <AlertTriangle size={21} />}</div>
        <div><span>RECOMENDAÇÃO DO MOTOR · CENÁRIO {result.scenarioLabel.toUpperCase()}</span><strong>{recommendation.label}</strong><p>Motivo dominante: {recommendation.dominantReason}.</p></div>
        <button onClick={() => router.push("/viabilidade?f=risks")}>Ver evidências <ArrowRight size={16} /></button>
      </section>

      <section className="metrics-grid">
        <MetricCard label="VGV" value={compactBrl(result.metrics.vgv)} meta={`${brl(result.assumptions.unitPrice)} por unidade`} icon={Building2} />
        <MetricCard label="Margem sobre VGV" value={percentage(result.metrics.marginOnVgv)} meta={`Política: ≥ ${project.policy.minimumMarginRate}%`} tone={Number(result.metrics.marginOnVgv) * 100 >= Number(project.policy.minimumMarginRate) ? "positive" : "negative"} icon={Gauge} />
        <MetricCard label="ROI do equity" value={percentage(result.metrics.roi)} meta={`Política: ≥ ${project.policy.minimumRoiRate}%`} tone={result.metrics.roi && Number(result.metrics.roi) * 100 >= Number(project.policy.minimumRoiRate) ? "positive" : "negative"} icon={TrendingUp} />
        <MetricCard label="TIR anual" value={percentage(result.metrics.annualIrr)} meta={`Política: ≥ ${project.policy.minimumIrrRate}% a.a.`} tone={result.metrics.annualIrr && Number(result.metrics.annualIrr) * 100 >= Number(project.policy.minimumIrrRate) ? "positive" : "negative"} icon={Sparkles} />
        <MetricCard label="Exposição máxima" value={compactBrl(result.metrics.maximumCashExposure)} meta={`Pico no mês ${result.metrics.maximumExposureMonth}`} tone={Number(result.metrics.maximumCashExposure) <= Number(project.policy.maximumExposure) ? "positive" : "negative"} icon={ArrowDownRight} />
        <MetricCard label="Capital próprio" value={compactBrl(result.metrics.equityCapitalRequired)} meta={`${brl(result.assumptions.financingLimit)} de funding`} icon={CircleDollarSign} />
        <MetricCard label="VPL" value={compactBrl(result.metrics.npv)} meta={`Desconto: ${result.assumptions.annualDiscountRate}% a.a.`} tone={Number(result.metrics.npv) >= 0 ? "positive" : "negative"} icon={Scale} />
      </section>

      <section className="overview-main-grid">
        <article className="panel chart-panel">
          <div className="panel-heading"><div><span className="eyebrow">CAIXA MENSAL</span><h2>Curva de exposição e recuperação</h2></div><button className="text-button" onClick={() => router.push("/viabilidade?f=cashflow")}>Ver fluxo completo <ArrowRight size={15} /></button></div>
          <CashFlowChart rows={result.cashFlow} />
          <div className="chart-stat-row"><div><span>Mês crítico</span><strong>M{result.metrics.maximumExposureMonth}</strong></div><div><span>Payback</span><strong>{result.metrics.paybackMonth === null ? "Não atingido" : `M${result.metrics.paybackMonth}`}</strong></div><div><span>Break-even</span><strong>{result.metrics.breakEvenUnits} un. · {percentage(result.metrics.breakEvenRate)}</strong></div></div>
        </article>

        <article className="panel cost-panel">
          <div className="panel-heading"><div><span className="eyebrow">ESTRUTURA</span><h2>Composição do custo</h2></div><strong className="panel-total">{compactBrl(result.metrics.totalCost)}</strong></div>
          <div className="cost-visual"><div className="cost-donut" style={{ background: donut }}><div><strong>{percentage(new String(Number(result.metrics.totalCost) / Number(result.metrics.vgv)).toString())}</strong><span>do VGV</span></div></div></div>
          <div className="cost-legend">{costSegments.map((segment) => <div key={segment.label}><i style={{ background: segment.color }} /><span>{segment.label}</span><strong>{compactCurrency.format(segment.value)}</strong></div>)}</div>
        </article>
      </section>

      <section className="overview-bottom-grid">
        <article className="panel risks-panel">
          <div className="panel-heading"><div><span className="eyebrow">PRIMEIRA LEITURA</span><h2>Riscos que pedem decisão</h2></div><div className="risk-totals"><span className="risk-critical">{criticalCount} críticos</span><span>{warningCount} alertas</span></div></div>
          <div className="finding-list">{recommendation.findings.filter((item) => item.severity !== "positive").slice(0, 3).map((finding) => <button key={finding.id} onClick={() => router.push("/viabilidade?f=risks")} className="finding-row"><span className={`finding-marker ${statusClass(finding.severity)}`}><AlertTriangle size={15} /></span><span><strong>{finding.title}</strong><small>{finding.evidence}</small></span><ArrowRight size={16} /></button>)}</div>
        </article>
        <ScoreSummary score={score} onOpen={() => router.push("/viabilidade?f=sensitivity")} />
      </section>

      <RedTeamSummary report={study.redTeam} onOpen={() => router.push("/viabilidade?f=redteam")} />

      <section className="panel scenario-strip">
        <div className="panel-heading"><div><span className="eyebrow">PESSOAS E EFICIÊNCIA</span><h2>Capacidade, desvios e ações do empreendimento</h2></div><button className="text-button" onClick={() => router.push("/pessoas")}>Abrir gestão <ArrowRight size={15} /></button></div>
        <div className="scenario-table compact-table"><div className="table-row table-head"><span>Profissionais</span><span>Equipes</span><span>Alocações</span><span>Desvios ativos</span><span>Ações ativas</span><span>Custo mensal</span></div><div className="table-row"><strong>{peoplePerformance.summary.people}</strong><strong>{peoplePerformance.summary.teams}</strong><strong>{peoplePerformance.summary.allocations}</strong><strong>{peoplePerformance.summary.activeVarianceCases}</strong><strong>{peoplePerformance.summary.activeActions}</strong><strong>{peoplePerformance.summary.totalMonthlyCost === null ? "Restrito" : currency.format(peoplePerformance.summary.totalMonthlyCost)}</strong></div></div>
      </section>

      <section className="panel scenario-strip">
        <div className="panel-heading"><div><span className="eyebrow">CONTABILIDADE E CONTROLADORIA</span><h2>Razão, resultado, estoque, fiscal e fechamento</h2></div><button className="text-button" onClick={() => router.push("/contabilidade-controladoria")}>Abrir contabilidade <ArrowRight size={15} /></button></div>
        <div className="scenario-table compact-table"><div className="table-row table-head"><span>Receita contábil</span><span>Custo reconhecido</span><span>Margem bruta</span><span>Estoque</span><span>Tributos</span><span>Divergências</span></div><div className="table-row"><strong>{currency.format(accounting.summary.recognizedRevenue)}</strong><strong>{currency.format(accounting.summary.accountedCost)}</strong><strong>{currency.format(accounting.summary.grossMargin)}</strong><strong>{currency.format(accounting.summary.inventory)}</strong><strong>{currency.format(accounting.summary.taxesDue)}</strong><strong>{accounting.summary.divergences}</strong></div></div>
      </section>

      <section className="panel scenario-strip">
        <div className="panel-heading"><div><span className="eyebrow">CENTRAL DE INTEGRAÇÕES</span><h2>Conectores, proveniência e sincronização</h2></div><button className="text-button" onClick={() => router.push("/integracoes")}>Abrir integrações <ArrowRight size={15} /></button></div>
        <div className="scenario-table compact-table"><div className="table-row table-head"><span>Instalações</span><span>Críticas</span><span>Atenção</span><span>Conflitos abertos</span><span>Quarentena</span><span>Credenciais expirando</span></div><div className="table-row"><strong>{integrations.summary.installations}</strong><strong>{integrations.summary.criticalInstallations}</strong><strong>{integrations.summary.attentionInstallations}</strong><strong>{integrations.summary.openConflicts}</strong><strong>{integrations.summary.pendingQuarantine}</strong><strong>{integrations.summary.expiringCredentials}</strong></div></div>
      </section>

      <section className="panel scenario-strip">
        <div className="panel-heading"><div><span className="eyebrow">INTELIGÊNCIA DE DADOS</span><h2>Comparativos, previsto x realizado e qualidade dos dados</h2></div><button className="text-button" onClick={() => router.push("/inteligencia-dados")}>Abrir Inteligência de Dados <ArrowRight size={15} /></button></div>
        <div className="scenario-table compact-table"><div className="table-row table-head"><span>Fatos analíticos</span><span>Comparativos</span><span>Confiança do último</span><span>Erro % médio (previsto x realizado)</span><span>Achados de qualidade abertos</span><span>Orçamento Inteligente</span></div><div className="table-row"><strong>{dataIntelligence.facts.length}</strong><strong>{dataIntelligence.benchmarks.length}</strong><strong>{dataIntelligence.benchmarks[0] ? { HIGH: "Alta", MEDIUM: "Média", LOW: "Baixa" }[dataIntelligence.benchmarks[0].confidenceLevel] ?? dataIntelligence.benchmarks[0].confidenceLevel : "—"}</strong><strong>{dataIntelligence.biasSummary.averagePercentError != null ? `${(dataIntelligence.biasSummary.averagePercentError * 100).toFixed(1)}%` : "—"}</strong><strong>{dataIntelligence.dataQuality.openIssues.length}</strong><strong>{dataIntelligence.autoBudgetProposals[0]?.status ?? "—"}</strong></div></div>
      </section>

      <section className="panel scenario-strip">
        <div className="panel-heading"><div><span className="eyebrow">MERCADO LOCAL</span><h2>Preço, pressão competitiva e velocidade da região</h2></div><button className="text-button" onClick={() => router.push("/mercado-produto?f=mercado")}>Abrir Inteligência de Mercado <ArrowRight size={15} /></button></div>
        <div className="scenario-table compact-table"><div className="table-row table-head"><span>Preço médio da região</span><span>Estoque ativo</span><span>Velocidade de vendas</span><span>Nível de Confiança</span></div><div className="table-row"><strong>{marketProduct.overview && marketProduct.overview.priceStats.median > 0 ? `${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(marketProduct.overview.priceStats.median)}/m²` : "—"}</strong><strong>{marketProduct.overview ? marketProduct.overview.competitors.filter((c) => c.eligible).length : 0} concorrentes</strong><strong>{marketProduct.overview ? `${number.format(marketProduct.overview.aggregateVsoPercentage * 100)}% a.m.` : "—"}</strong><strong>{marketProduct.overview ? { HIGH: "Alta", MEDIUM: "Média", LOW: "Baixa" }[marketProduct.overview.confidence.level] : "—"}</strong></div></div>
      </section>

      <section className="panel scenario-strip">
        <div className="panel-heading"><div><span className="eyebrow">PRODUTO EM ESTUDO</span><h2>Cenário recomendado, delta de VGV e status de aprovação</h2></div><button className="text-button" onClick={() => router.push("/mercado-produto?f=produto")}>Abrir Inteligência de Produto <ArrowRight size={15} /></button></div>
        <div className="scenario-table compact-table"><div className="table-row table-head"><span>Cenário recomendado</span><span>VGV projetado</span><span>Margem projetada</span><span>Status</span></div><div className="table-row"><strong>{marketProduct.scenarios.find((s) => s.kind === "BASE")?.name ?? "Nenhum cenário gerado"}</strong><strong>{marketProduct.scenarios.find((s) => s.kind === "BASE") ? compactBrl(marketProduct.scenarios.find((s) => s.kind === "BASE")!.targetVgv.toString()) : "—"}</strong><strong>{(() => { const base = marketProduct.scenarios.find((s) => s.kind === "BASE"); const metrics = base?.engineResultsJson as { metrics?: { marginOnVgv?: string } } | null; return metrics?.metrics?.marginOnVgv ? percentage(metrics.metrics.marginOnVgv) : "—"; })()}</strong><strong>{marketProduct.scenarios.find((s) => s.kind === "BASE") ? { DRAFT: "Rascunho", UNDER_REVIEW: "Em Análise", RECOMMENDED: "Recomendado", APPROVED: "Aprovado", REJECTED: "Rejeitado", SUPERSEDED: "Substituído" }[marketProduct.scenarios.find((s) => s.kind === "BASE")!.status] : "—"}</strong></div></div>
      </section>

      <section className="panel scenario-strip">
        <div className="panel-heading"><div><span className="eyebrow">DOWNSIDE × UPSIDE</span><h2>Comparação rápida de cenários</h2></div><button className="text-button" onClick={() => router.push("/viabilidade?f=scenarios")}>Abrir análise <ArrowRight size={15} /></button></div>
        <div className="scenario-table compact-table"><div className="table-row table-head"><span>Cenário</span><span>VGV</span><span>Lucro</span><span>Margem</span><span>TIR</span><span>Exposição</span></div>{(["conservative", "base", "aggressive"] as ScenarioKey[]).map((key) => { const item = results[key]; return <button key={key} onClick={() => setScenario(key)} className={`table-row ${scenario === key ? "selected" : ""}`}><span><i className={`scenario-dot dot-${key}`} />{SCENARIOS[key].label}</span><strong>{compactBrl(item.metrics.vgv)}</strong><strong>{compactBrl(item.metrics.profit)}</strong><strong>{percentage(item.metrics.marginOnVgv)}</strong><strong>{percentage(item.metrics.annualIrr)}</strong><strong>{compactBrl(item.metrics.maximumCashExposure)}</strong></button>; })}</div>
      </section>
    </div>
  );
}
