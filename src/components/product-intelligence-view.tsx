"use client";

import { useState } from "react";
import type { MembershipRole } from "@prisma/client";
import { AlertTriangle, BadgeCheck, Building2, CircleDollarSign, GitCompareArrows, Layers3, ShieldQuestion, Sparkles, Wallet } from "lucide-react";
import type { MarketProductWorkspaceView } from "@/application/market-product";
import { hasMarketProductCapability } from "@/domain/market-product";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const compactBrl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const brlPrecise = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const kindLabel: Record<string, string> = { CONSERVATIVE: "Conservador", BASE: "Base (Recomendado)", AGGRESSIVE: "Potencial", CUSTOM: "Personalizado" };
const statusLabel: Record<string, string> = { DRAFT: "Rascunho", UNDER_REVIEW: "Em Análise", RECOMMENDED: "Recomendado", APPROVED: "Aprovado", REJECTED: "Rejeitado", SUPERSEDED: "Substituído" };
const confidenceLabel: Record<string, string> = { HIGH: "Alta", MEDIUM: "Média", LOW: "Baixa" };

type Area = "visao" | "cenarios" | "mix" | "precos" | "simulacao" | "memoria";
const areas: { key: Area; label: string }[] = [
  { key: "visao", label: "Visão Geral" },
  { key: "cenarios", label: "Cenários de Produto" },
  { key: "mix", label: "Mix e Tipologias" },
  { key: "precos", label: "Preços e Tickets" },
  { key: "simulacao", label: "Simulação Econômica" },
  { key: "memoria", label: "Memória da Decisão" },
];

interface EngineMetrics { vgv: string; marginOnVgv: string; profit: string; annualIrr: string | null; maximumCashExposure: string; roi: string | null }
function engineMetricsOf(engineResultsJson: unknown): EngineMetrics | null {
  if (!engineResultsJson || typeof engineResultsJson !== "object") return null;
  const metrics = (engineResultsJson as { metrics?: EngineMetrics }).metrics;
  return metrics ?? null;
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "APPROVED" ? "positive-value" : status === "REJECTED" ? "negative-value" : "";
  return <span className={`status-pill ${tone}`}>{statusLabel[status] ?? status}</span>;
}

// Cenários formulados a partir de mercado de demonstração herdam essa origem — nunca podem ser
// apresentados como uma recomendação baseada em coleta real de mercado.
function DemoDataBanner() {
  return (
    <div className="model-note">
      <AlertTriangle size={20} />
      <div>
        <strong>Cenário formulado sobre dados de demonstração</strong>
        <p>A evidência de mercado usada para gerar estes cenários é sintética (seed START BUTANTÃ) — não é coleta real. Trate os números como ilustrativos até que fontes reais sejam conectadas.</p>
      </div>
    </div>
  );
}

export function ProductIntelligenceView({
  workspace,
  role,
  onGenerate,
  onDecide,
}: {
  workspace: MarketProductWorkspaceView;
  role: MembershipRole;
  onGenerate: () => Promise<void>;
  onDecide: (scenarioId: string, decision: "APPROVED" | "REJECTED", rationale: string) => Promise<void>;
}) {
  const [area, setArea] = useState<Area>("visao");
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(workspace.scenarios.find((s) => s.kind === "BASE")?.id ?? workspace.scenarios[0]?.id ?? null);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const canRecommend = hasMarketProductCapability(role, "PRODUCT_RECOMMEND");
  const canApprove = hasMarketProductCapability(role, "PRODUCT_APPROVE");

  const scenarios = workspace.scenarios;
  const selected = scenarios.find((s) => s.id === selectedScenarioId) ?? null;
  const openStatuses = ["DRAFT", "UNDER_REVIEW", "RECOMMENDED"];

  async function handleGenerate() {
    setBusy(true);
    setFeedback(null);
    try {
      await onGenerate();
      setFeedback("Cenários de produto gerados com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível gerar os cenários.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDecide(decision: "APPROVED" | "REJECTED") {
    if (!selected) return;
    if (rationale.trim().length < 8) { setFeedback("A justificativa precisa ter pelo menos 8 caracteres."); return; }
    setBusy(true);
    setFeedback(null);
    try {
      await onDecide(selected.id, decision, rationale.trim());
      setFeedback(`Cenário "${selected.name}" ${decision === "APPROVED" ? "aprovado" : "rejeitado"} com sucesso.`);
      setRationale("");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível registrar a decisão.");
    } finally {
      setBusy(false);
    }
  }

  if (!workspace.marketArea) {
    return <div className="empty-state"><Building2 size={18} /> Configure primeiro uma área de mercado na aba Inteligência de Mercado antes de gerar cenários de produto.</div>;
  }

  return (
    <div className="view-stack">
      <div className="scenario-switch" aria-label="Áreas de Inteligência de Produto">
        {areas.map((item) => <button key={item.key} className={area === item.key ? "is-active" : ""} onClick={() => setArea(item.key)}>{item.label}</button>)}
      </div>

      {feedback && <div className="model-note"><ShieldQuestion size={20} /><div><strong>Atualização</strong><p>{feedback}</p></div></div>}

      {scenarios.some((s) => s.isDemo) && <DemoDataBanner />}

      {area === "visao" && <>
        <section className="metrics-grid">
          <article className="metric-card"><div><span>Cenários formulados</span><Layers3 size={17} /></div><strong>{scenarios.length}</strong><small>Conservador, Base e Potencial</small></article>
          <article className="metric-card"><div><span>Cenário recomendado</span><Sparkles size={17} /></div><strong>{scenarios.find((s) => s.kind === "BASE")?.name ?? "—"}</strong><small>Status: {statusLabel[scenarios.find((s) => s.kind === "BASE")?.status ?? ""] ?? "—"}</small></article>
          <article className="metric-card"><div><span>VGV do cenário Base</span><CircleDollarSign size={17} /></div><strong>{scenarios.find((s) => s.kind === "BASE") ? compactBrl.format(Number(scenarios.find((s) => s.kind === "BASE")!.targetVgv)) : "—"}</strong><small>Projeção do REDE Engine</small></article>
          <article className="metric-card"><div><span>Nível de Confiança</span><BadgeCheck size={17} /></div><strong>{scenarios.find((s) => s.kind === "BASE") ? confidenceLabel[scenarios.find((s) => s.kind === "BASE")!.confidenceLevel] : "—"}</strong><small>Combinação de mercado, zoneamento e custo</small></article>
        </section>
        {canRecommend && <div className="model-note"><Sparkles size={20} /><div><strong>Gerar novos cenários de produto</strong><p>Reprocessa os 3 cenários obrigatórios (Conservador, Base, Potencial) a partir da evidência de mercado e do envelope urbanístico vigente.</p><button className="button button-primary" disabled={busy} onClick={handleGenerate}>{busy ? "Gerando..." : "Gerar cenários de produto"}</button></div></div>}
        {scenarios.length === 0 && !canRecommend && <div className="empty-state">Nenhum cenário de produto foi gerado ainda. Um perfil com a capacidade de recomendar produto precisa executar a geração.</div>}
      </>}

      {area === "cenarios" && <article className="panel">
        <div className="panel-heading"><div><span className="eyebrow">COMPARAÇÃO OBRIGATÓRIA DE 3 CENÁRIOS</span><h2>Conservador · Base (Recomendado) · Potencial</h2></div></div>
        <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Dimensão</th>{scenarios.map((s) => <th key={s.id}>{kindLabel[s.kind] ?? s.kind}</th>)}</tr></thead><tbody>
          <tr><td>Status</td>{scenarios.map((s) => <td key={s.id}><StatusBadge status={s.status} /></td>)}</tr>
          <tr><td>Total de unidades</td>{scenarios.map((s) => <td key={s.id}>{s.totalUnits}</td>)}</tr>
          <tr><td>Área privativa média</td>{scenarios.map((s) => <td key={s.id}>{number.format(Number(s.averageUnitAreaM2))} m²</td>)}</tr>
          <tr><td>Preço médio/m²</td>{scenarios.map((s) => <td key={s.id}>{brlPrecise.format(Number(s.averagePricePerSqm))}</td>)}</tr>
          <tr><td>VGV total estimado</td>{scenarios.map((s) => <td key={s.id}><strong>{compactBrl.format(Number(s.targetVgv))}</strong></td>)}</tr>
          <tr><td>Velocidade de vendas</td>{scenarios.map((s) => <td key={s.id}>{number.format(Number(s.expectedVelocityUnitsMonth))} un./mês</td>)}</tr>
          <tr><td>Prazo de vendas</td>{scenarios.map((s) => <td key={s.id}>{s.estimatedSalesDurationMonths} meses</td>)}</tr>
          <tr><td>Margem sobre VGV</td>{scenarios.map((s) => { const m = engineMetricsOf(s.engineResultsJson); return <td key={s.id}>{m ? pct.format(Number(m.marginOnVgv)) : "—"}</td>; })}</tr>
          <tr><td>TIR anual</td>{scenarios.map((s) => { const m = engineMetricsOf(s.engineResultsJson); return <td key={s.id}>{m?.annualIrr ? pct.format(Number(m.annualIrr)) : "—"}</td>; })}</tr>
          <tr><td>Exposição máxima de caixa</td>{scenarios.map((s) => { const m = engineMetricsOf(s.engineResultsJson); return <td key={s.id}>{m ? compactBrl.format(Number(m.maximumCashExposure)) : "—"}</td>; })}</tr>
          <tr><td>Nível de Confiança</td>{scenarios.map((s) => <td key={s.id}>{confidenceLabel[s.confidenceLevel] ?? s.confidenceLevel}</td>)}</tr>
          <tr><td>Selecionar</td>{scenarios.map((s) => <td key={s.id}><button className={`button ${selectedScenarioId === s.id ? "button-primary" : "button-secondary"}`} onClick={() => setSelectedScenarioId(s.id)}>{selectedScenarioId === s.id ? "Selecionado" : "Selecionar"}</button></td>)}</tr>
        </tbody></table></div>
      </article>}

      {area === "mix" && <>
        {!selected && <div className="empty-state">Selecione um cenário na aba Cenários de Produto.</div>}
        {selected && <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">{kindLabel[selected.kind] ?? selected.kind}</span><h2>Mix e Tipologias — {selected.name}</h2></div></div>
          <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Tipologia</th><th>Dormitórios</th><th>Suítes</th><th>Vagas</th><th>Área privativa</th><th>Unidades</th><th>% do Mix</th><th>Preço/m² alvo</th><th>Ticket alvo</th><th>Vendas esperadas</th></tr></thead><tbody>
            {selected.mixLines.map((line) => <tr key={line.id}><td><strong>{line.name}</strong></td><td>{line.bedrooms}</td><td>{line.suites}</td><td>{line.parkingSpaces}</td><td>{number.format(Number(line.privateAreaM2))} m²</td><td>{line.unitCount}</td><td>{pct.format(Number(line.mixPercentage))}</td><td>{brlPrecise.format(Number(line.targetPricePerSqm))}</td><td>{brl.format(Number(line.targetUnitPrice))}</td><td>{line.expectedMonthlySales !== null ? `${number.format(Number(line.expectedMonthlySales))} un./mês` : "—"}</td></tr>)}
          </tbody></table></div>
        </article>}
      </>}

      {area === "precos" && <>
        {!selected && <div className="empty-state">Selecione um cenário na aba Cenários de Produto.</div>}
        {selected && <>
          <section className="metrics-grid">
            <article className="metric-card"><div><span>Preço médio/m²</span><Wallet size={17} /></div><strong>{brlPrecise.format(Number(selected.averagePricePerSqm))}</strong><small>Cenário {kindLabel[selected.kind]}</small></article>
            <article className="metric-card"><div><span>Ticket médio</span></div><strong>{brl.format(Number(selected.averageTicket))}</strong><small>Preço médio por unidade</small></article>
            <article className="metric-card"><div><span>VGV total</span></div><strong>{compactBrl.format(Number(selected.targetVgv))}</strong><small>Projeção total do cenário</small></article>
          </section>
          <div className="model-note"><ShieldQuestion size={20} /><div><strong>Justificativa de preço</strong><p>{selected.rationale}</p></div></div>
        </>}
      </>}

      {area === "simulacao" && <>
        {!selected && <div className="empty-state">Selecione um cenário na aba Cenários de Produto.</div>}
        {selected && (() => {
          const m = engineMetricsOf(selected.engineResultsJson);
          if (!m) return <div className="empty-state">Este cenário ainda não foi simulado no REDE Engine.</div>;
          return <section className="metrics-grid">
            <article className="metric-card"><div><span>VGV</span><GitCompareArrows size={17} /></div><strong>{compactBrl.format(Number(m.vgv))}</strong><small>Valor Geral de Vendas</small></article>
            <article className="metric-card"><div><span>Lucro projetado</span></div><strong>{compactBrl.format(Number(m.profit))}</strong><small>Resultado após custos e tributos</small></article>
            <article className="metric-card"><div><span>Margem sobre VGV</span></div><strong>{pct.format(Number(m.marginOnVgv))}</strong><small>Rentabilidade sobre a receita</small></article>
            <article className="metric-card"><div><span>TIR anual</span></div><strong>{m.annualIrr ? pct.format(Number(m.annualIrr)) : "—"}</strong><small>Taxa Interna de Retorno</small></article>
            <article className="metric-card"><div><span>Exposição máxima de caixa</span></div><strong>{compactBrl.format(Number(m.maximumCashExposure))}</strong><small>Necessidade de capital de giro</small></article>
            <article className="metric-card"><div><span>ROI</span></div><strong>{m.roi ? pct.format(Number(m.roi)) : "—"}</strong><small>Retorno sobre o capital investido</small></article>
          </section>;
        })()}
        <div className="model-note"><ShieldQuestion size={20} /><div><strong>Explicabilidade da recomendação</strong><ul>{selected && Array.isArray(selected.explainabilityJson) && (selected.explainabilityJson as { question: string; answer: string }[]).map((item, index) => <li key={index}><strong>{item.question}</strong> {item.answer}</li>)}</ul></div></div>
      </>}

      {area === "memoria" && <>
        {canApprove && selected && openStatuses.includes(selected.status) && <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">APROVAÇÃO HUMANA OBRIGATÓRIA</span><h2>Decidir sobre &ldquo;{selected.name}&rdquo;</h2></div></div>
          <div className="form-grid">
            <label>Justificativa da decisão<textarea value={rationale} onChange={(event) => setRationale(event.target.value)} rows={3} placeholder="Explique por que este cenário está sendo aprovado ou rejeitado..." /></label>
            <div className="form-actions">
              <button className="button button-primary" disabled={busy} onClick={() => handleDecide("APPROVED")}>Aprovar cenário</button>
              <button className="button button-secondary" disabled={busy} onClick={() => handleDecide("REJECTED")}>Rejeitar cenário</button>
            </div>
          </div>
        </article>}
        {!canApprove && <div className="model-note"><ShieldQuestion size={20} /><div><strong>Aprovação restrita</strong><p>Seu perfil pode visualizar a Memória da Decisão, mas não aprovar ou rejeitar cenários de produto.</p></div></div>}
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">MEMÓRIA IMUTÁVEL DA DECISÃO</span><h2>Histórico de aprovações e rejeições</h2></div></div>
          <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Cenário</th><th>Decisão</th><th>Data</th><th>Justificativa</th></tr></thead><tbody>
            {scenarios.flatMap((s) => (s.decisions ?? []).map((decision) => <tr key={decision.id}><td>{s.name}</td><td><StatusBadge status={decision.decision} /></td><td>{new Date(decision.decidedAt).toLocaleString("pt-BR")}</td><td>{decision.decisionRationale}</td></tr>))}
            {scenarios.every((s) => (s.decisions ?? []).length === 0) && <tr><td colSpan={4}>Nenhuma decisão registrada ainda.</td></tr>}
          </tbody></table></div>
        </article>
      </>}
    </div>
  );
}
