"use client";

import { useState } from "react";
import { AlertTriangle, BadgeCheck, Building2, Database, GitCompareArrows, ShieldQuestion, Sparkles, Target } from "lucide-react";
import type { DataIntelligenceWorkspace } from "@/application/data-intelligence/data-intelligence-service";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlPrecise = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

type Area = "visao" | "carteira" | "comparativos" | "previsto" | "qualidade" | "orcamento";
const areas: Array<{ key: Area; label: string }> = [
  { key: "visao", label: "Visão Geral" },
  { key: "carteira", label: "Carteira de Empreendimentos" },
  { key: "comparativos", label: "Comparativos" },
  { key: "previsto", label: "Previsto x Realizado" },
  { key: "qualidade", label: "Qualidade dos Dados" },
  { key: "orcamento", label: "Orçamento Inteligente" },
];

const confidenceLabel: Record<string, string> = { HIGH: "Alta", MEDIUM: "Média", LOW: "Baixa" };
const biasLabel: Record<string, string> = { OPTIMISTIC: "Otimista (superestimou)", PESSIMISTIC: "Pessimista (subestimou)", NEUTRAL: "Neutro" };
const statusLabel: Record<string, string> = { DRAFT: "Rascunho", REVIEW: "Em revisão", APPROVED: "Aprovada", REJECTED: "Rejeitada", SUPERSEDED: "Substituída", ACTIVE: "Ativa" };
const severityLabel: Record<string, string> = { INFO: "Informativo", WARNING: "Atenção", CRITICAL: "Crítico" };

function ConfidenceBadge({ level }: { level: string }) {
  return <span className={`status-pill ${level === "HIGH" ? "positive-value" : level === "LOW" ? "negative-value" : ""}`}>Confiança {confidenceLabel[level] ?? level}</span>;
}

export function DataIntelligenceView({ workspace }: { workspace: DataIntelligenceWorkspace }) {
  const [area, setArea] = useState<Area>("visao");
  const openIssues = workspace.dataQuality.openIssues.length;
  const proposalsInReview = workspace.autoBudgetProposals.filter((p) => p.status === "REVIEW").length;

  return <div className="view-stack">
    <div className="scenario-switch" aria-label="Áreas de Inteligência de Dados">{areas.map((item) => <button key={item.key} className={area === item.key ? "is-active" : ""} onClick={() => setArea(item.key)}>{item.label}</button>)}</div>

    {area === "visao" && <>
      <section className="metrics-grid">
        <article className="metric-card"><div><span>Fatos analíticos</span><Database size={17} /></div><strong>{workspace.facts.length}</strong><small>Ligados ao registro operacional de origem</small></article>
        <article className="metric-card"><div><span>Métricas versionadas</span><Sparkles size={17} /></div><strong>{workspace.metrics.length}</strong><small>Catálogo único, sem fórmula duplicada</small></article>
        <article className="metric-card"><div><span>Comparativos calculados</span><GitCompareArrows size={17} /></div><strong>{workspace.benchmarks.length}</strong><small>Com amostra, confiança e exceções visíveis</small></article>
        <article className="metric-card"><div><span>Achados de qualidade em aberto</span><AlertTriangle size={17} /></div><strong>{openIssues}</strong><small>Não bloqueia automaticamente; exige revisão</small></article>
        <article className="metric-card"><div><span>Propostas em revisão</span><Target size={17} /></div><strong>{proposalsInReview}</strong><small>Orçamento Inteligente — sugestão, não base aprovada</small></article>
        <article className="metric-card"><div><span>Contratos analíticos ativos</span><BadgeCheck size={17} /></div><strong>{workspace.contracts.filter((c) => c.status === "ACTIVE").length}</strong><small>Entre OLTP e a camada analítica</small></article>
      </section>
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">FATO → NORMALIZAÇÃO → COMPARABILIDADE → MÉTRICA → BENCHMARK → CONFIANÇA</span><h2>Contratos Analíticos</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Chave</th><th>Nome</th><th>Módulo de origem</th><th>Grão</th><th>Situação</th></tr></thead><tbody>{workspace.contracts.map((c) => <tr key={c.id}><td><strong>{c.key}</strong> · v{c.version}</td><td>{c.name}</td><td>{c.sourceModule}</td><td>{c.grain}</td><td><span className="status-pill">{statusLabel[c.status] ?? c.status}</span></td></tr>)}</tbody></table></div></article>
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">DEFINIÇÃO ÚNICA, SEM FÓRMULA LOCAL</span><h2>Catálogo de Métricas</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Métrica</th><th>Unidade</th><th>Agregação</th><th>Definição</th></tr></thead><tbody>{workspace.metrics.map((m) => <tr key={m.id}><td><strong>{m.name}</strong> · v{m.version}</td><td>{m.unit}</td><td>{m.aggregation}</td><td>{m.definition}</td></tr>)}</tbody></table></div></article>
      <div className="model-note"><ShieldQuestion size={20} /><div><strong>Camada semântica determinística</strong><p>UI e REDE AI consultam este catálogo e o motor de benchmark; nenhuma fórmula é recalculada livremente em componente de tela.</p></div></div>
    </>}

    {area === "carteira" && <>
      {!workspace.portfolio && <div className="model-note"><Building2 size={20} /><div><strong>Sem corte de portfólio ainda</strong><p>Execute a Atualização para gerar o primeiro corte.</p></div></div>}
      {workspace.portfolio && <>
        <section className="metrics-grid">
          <article className="metric-card"><div><span>Financeiro</span></div><strong>{workspace.portfolio.scorecard.financeiro.value != null ? pct.format(workspace.portfolio.scorecard.financeiro.value) : "—"}</strong><small>{workspace.portfolio.scorecard.financeiro.note}</small></article>
          <article className="metric-card"><div><span>Comercial</span></div><strong>{pct.format(workspace.portfolio.scorecard.comercial.value ?? 0)}</strong><small>{workspace.portfolio.scorecard.comercial.note}</small></article>
          <article className="metric-card"><div><span>Engenharia</span></div><strong>{pct.format(workspace.portfolio.scorecard.engenharia.value ?? 0)}</strong><small>{workspace.portfolio.scorecard.engenharia.note}</small></article>
          <article className="metric-card"><div><span>Jurídico</span></div><strong>{workspace.portfolio.scorecard.juridico.value}</strong><small>{workspace.portfolio.scorecard.juridico.note}</small></article>
          <article className="metric-card"><div><span>Capital</span></div><strong>{workspace.portfolio.scorecard.capital.value != null ? brl.format(workspace.portfolio.scorecard.capital.value) : "—"}</strong><small>{workspace.portfolio.scorecard.capital.note}</small></article>
          <article className="metric-card"><div><span>Qualidade dos dados</span></div><strong>{workspace.portfolio.scorecard.dados.value}</strong><small>{workspace.portfolio.scorecard.dados.note}</small></article>
        </section>
        <article className="panel"><div className="panel-heading"><div><span className="eyebrow">GRUPO → EMPRESA → SPE → EMPREENDIMENTO</span><h2>Orçado, contratado e medido</h2></div></div><div className="scenario-table"><div className="table-row table-head"><span>Orçado</span><span>Contratado (com aditivos)</span><span>Medido</span></div><div className="table-row"><strong>{brl.format(workspace.portfolio.metrics.orcado)}</strong><strong>{brl.format(workspace.portfolio.metrics.contratado)}</strong><strong>{brl.format(workspace.portfolio.metrics.medido)}</strong></div></div></article>
        <div className="model-note"><Building2 size={20} /><div><strong>Scorecard multidimensional</strong><p>Sete dimensões separadas, sem nota única opaca — cada uma mostra o corte, a fonte e a nota de contexto.</p></div></div>
      </>}
    </>}

    {area === "comparativos" && <>
      {workspace.benchmarks.length === 0 && <div className="model-note"><GitCompareArrows size={20} /><div><strong>Nenhum comparativo calculado ainda</strong><p>Execute a Atualização para gerar o primeiro comparativo por item econômico.</p></div></div>}
      {workspace.benchmarks.map((b) => <article className="panel" key={b.id}><div className="panel-heading"><div><span className="eyebrow">GATE DE COMPARABILIDADE + ÍNDICE DE SIMILARIDADE + NÍVEL DE CONFIANÇA</span><h2>{b.metricName} — {b.unit}</h2></div><ConfidenceBadge level={b.confidenceLevel} /></div>
        <div className="scenario-table"><div className="table-row table-head"><span>Amostra elegível</span><span>Mediana</span><span>P25 – P75</span><span>Desvio-padrão</span></div><div className="table-row"><strong>{b.sampleSize}</strong><strong>{b.median != null ? brl.format(b.median) : "—"}</strong><strong>{b.p25 != null && b.p75 != null ? `${brl.format(b.p25)} – ${brl.format(b.p75)}` : "—"}</strong><strong>{b.stdDev != null ? brl.format(b.stdDev) : "—"}</strong></div></div>
        <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Fonte</th><th>Valor bruto</th><th>Valor normalizado</th><th>Índice de similaridade</th><th>Elegível</th><th>Motivo</th></tr></thead><tbody>{b.members.map((m) => <tr key={m.id}><td>{m.sourceEntityType}</td><td>{brlPrecise.format(m.rawValue)}</td><td>{m.eligible ? brlPrecise.format(m.normalizedValue) : "—"}</td><td>{m.eligible ? pct.format(m.similarityScore) : "—"}</td><td>{m.eligible ? "Sim" : "Não"}</td><td>{m.exclusionReason ?? "—"}</td></tr>)}</tbody></table></div>
        {b.outliers.length > 0 && <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Ponto fora do padrão</th><th>Método</th><th>Score</th><th>Decisão</th><th>Justificativa</th></tr></thead><tbody>{b.outliers.map((o) => <tr key={o.id}><td>Membro {o.id.slice(-6)}</td><td>{o.method}</td><td>{o.score.toFixed(2)}</td><td>{o.decision}</td><td>{o.rationale ?? "Pendente de investigação"}</td></tr>)}</tbody></table></div>}
      </article>)}
      <div className="model-note"><ShieldQuestion size={20} /><div><strong>Amostra pequena nunca vira confiança alta</strong><p>Um único ponto comparável — mesmo exato — recebe nível de confiança baixo. Preço observado externo e preço realmente pago aparecem lado a lado, sem um substituir o outro.</p></div></div>
    </>}

    {area === "previsto" && <>
      {workspace.forecastEvaluations.length === 0 && <div className="model-note"><Target size={20} /><div><strong>Nenhuma avaliação ainda</strong><p>Execute a Atualização para comparar previsto e realizado dos contratos ativos.</p></div></div>}
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">A PREVISÃO ORIGINAL NUNCA É REESCRITA</span><h2>Previsto x Realizado por contrato</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Origem</th><th>Previsto</th><th>Realizado</th><th>Erro absoluto</th><th>Erro %</th><th>Viés</th><th>Estágio</th></tr></thead><tbody>{workspace.forecastEvaluations.map((e) => <tr key={e.id}><td>{e.forecastSourceType}</td><td>{brl.format(e.predictedValue)}</td><td>{e.actualValue != null ? brl.format(e.actualValue) : "Aguardando realizado"}</td><td>{e.absoluteError != null ? brl.format(e.absoluteError) : "—"}</td><td>{e.percentError != null ? pct.format(e.percentError) : "—"}</td><td>{e.bias ? biasLabel[e.bias] : "—"}</td><td>{e.horizonStage}</td></tr>)}</tbody></table></div></article>
      {workspace.biasSummary.count > 0 && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">FATUAL, NÃO ACUSATÓRIO</span><h2>Padrão de viés</h2></div></div><div className="scenario-table"><div className="table-row table-head"><span>Avaliações</span><span>Otimistas</span><span>Pessimistas</span><span>Neutras</span><span>Erro % médio</span></div><div className="table-row"><strong>{workspace.biasSummary.count}</strong><strong>{workspace.biasSummary.optimisticCount}</strong><strong>{workspace.biasSummary.pessimisticCount}</strong><strong>{workspace.biasSummary.neutralCount}</strong><strong>{workspace.biasSummary.averagePercentError != null ? pct.format(workspace.biasSummary.averagePercentError) : "—"}</strong></div></div></article>}
    </>}

    {area === "qualidade" && <>
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">REGRA → EXECUÇÃO → ACHADO → REVISÃO HUMANA</span><h2>Execuções de qualidade</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Regra</th><th>Dimensão</th><th>Severidade</th><th>Avaliados</th><th>Falhas</th><th>Resultado</th></tr></thead><tbody>{workspace.dataQuality.runs.map((r) => <tr key={r.id}><td><strong>{r.ruleName}</strong></td><td>{r.dimension}</td><td>{severityLabel[r.severity] ?? r.severity}</td><td>{r.rowsEvaluated}</td><td>{r.rowsFailed}</td><td><span className={`status-pill ${r.passed ? "positive-value" : "negative-value"}`}>{r.passed ? "Sem achados" : "Com achados"}</span></td></tr>)}</tbody></table></div></article>
      {workspace.dataQuality.openIssues.length > 0 && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">NADA É CORRIGIDO SILENCIOSAMENTE</span><h2>Achados em aberto</h2></div></div><div className="scenario-table">{workspace.dataQuality.openIssues.map((issue) => <div className="table-row" key={issue.id}><strong>{issue.ruleName}</strong><span>{issue.entityType}</span><span>{severityLabel[issue.severity] ?? issue.severity}</span><span>{issue.message}</span></div>)}</div></article>}
    </>}

    {area === "orcamento" && <>
      {workspace.autoBudgetProposals.length === 0 && <div className="model-note"><Target size={20} /><div><strong>Nenhuma proposta ainda</strong><p>O Orçamento Inteligente produz sugestão, nunca base aprovada automaticamente.</p></div></div>}
      {workspace.autoBudgetProposals.map((p) => <article className="panel" key={p.id}><div className="panel-heading"><div><span className="eyebrow">SUGESTÃO ≠ BASE APROVADA</span><h2>{p.name}</h2></div><span className="status-pill">{statusLabel[p.status] ?? p.status}</span></div>
        <p style={{ marginBottom: "0.75rem" }}>{p.rationale}</p>
        <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Item</th><th>Quantidade</th><th>Custo sugerido</th><th>Faixa</th><th>Confiança</th><th>Revisão humana</th></tr></thead><tbody>{p.lines.map((line) => <tr key={line.id}><td>{line.description}</td><td>{line.quantity} {line.unit}</td><td>{brl.format(line.suggestedUnitCost)}/{line.unit}</td><td>{line.rangeLow != null && line.rangeHigh != null ? `${brl.format(line.rangeLow)} – ${brl.format(line.rangeHigh)}` : "—"}</td><td><ConfidenceBadge level={line.confidenceLevel} /></td><td>{line.reviewedUnitCost != null ? `${brl.format(line.reviewedUnitCost)}/${line.unit} — ${line.reviewNote ?? ""}` : "Aguardando revisão"}</td></tr>)}</tbody></table></div>
        {Array.isArray(p.lines[0]?.exceptions) && (p.lines[0]!.exceptions as string[]).length > 0 && <div className="model-note"><AlertTriangle size={20} /><div><strong>Exceções</strong><p>{(p.lines[0]!.exceptions as string[]).join(" ")}</p></div></div>}
      </article>)}
    </>}
  </div>;
}
