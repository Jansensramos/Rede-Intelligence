"use client";

import { useState } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, Clock3, Gauge, Landmark, Play, ShieldCheck, Target, TrendingUp } from "lucide-react";
import type { MarketProductWorkspaceView } from "@/application/market-product";
import { createCustomLaunchScenarioAction, createLaunchTriggerAction, decideLaunchAction, generateLaunchScenariosAction, registerMacroObservationAction } from "@/app/actions/launch-intelligence";
import { MACRO_INDICATOR_REGISTRY, launchMetric } from "@/domain/launch-intelligence";

type View = MarketProductWorkspaceView["launchIntelligence"];
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const recommendationLabel: Record<string, string> = { FAVORABLE_TO_LAUNCH: "FAVORÁVEL PARA LANÇAMENTO", LAUNCH_WITH_CONDITIONS: "LANÇAR COM CONDIÇÕES", PHASE: "FASEAR", REVIEW_PRODUCT_PRICE: "REVISAR PRODUTO/PREÇO", WAIT: "AGUARDAR", INSUFFICIENT_EVIDENCE: "SEM EVIDÊNCIA SUFICIENTE" };
const scenarioLabel: Record<string, string> = { BASE: "Base", FAVORABLE: "Favorável", STRESSED: "Estressado", CUSTOM: "Personalizado" };
const freshnessLabel: Record<string, string> = { UPDATED: "Atualizado", AGING: "Envelhecendo", STALE: "Desatualizado", NO_EVIDENCE: "Sem evidência" };
const confidenceLabel: Record<string, string> = { HIGH: "Alta", MEDIUM: "Média", LOW: "Baixa" };
const decisionLabel: Record<string, string> = { LAUNCH: "Lançar", LAUNCH_WITH_CONDITIONS: "Lançar com condições", PHASE: "Fasear", REVIEW_PRODUCT_PRICE: "Revisar produto/preço", WAIT: "Aguardar", REJECT: "Não lançar" };
const operatorLabel: Record<string, string> = { LT: "menor que", LTE: "menor ou igual a", GT: "maior que", GTE: "maior ou igual a", BETWEEN: "entre" };

function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function metrics(value: unknown) { return record(record(value).metrics); }

export function MacroIntelligenceView({ view, onChange }: { view: View; onChange: (workspace: MarketProductWorkspaceView) => void }) {
  const [code, setCode] = useState<keyof typeof MACRO_INDICATOR_REGISTRY>("SELIC");
  const [value, setValue] = useState("");
  const [source, setSource] = useState("");
  const [referenceDate, setReferenceDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  if (!view) return <div className="empty-state">O empreendimento atual não pôde ser carregado.</div>;
  const definition = MACRO_INDICATOR_REGISTRY[code];
  const projectId = view.project.id;
  const projectState = view.project.state;

  async function save() {
    setBusy(true); setFeedback(null);
    const response = await registerMacroObservationAction(projectId, { code, rawValue: Number(value), rawUnit: definition.unit, normalizationKey: "IDENTITY", referenceDate, collectedAt: new Date(), regionLevel: "STATE", regionCode: `BR-${projectState}`, sourceProvider: source, sourceMethod: "Cadastro manual", confidenceLevel: "MEDIUM", provenance: { method: "manual", declaredByUser: true } });
    if (response.ok) { onChange(response.data); setValue(""); setSource(""); setFeedback("Observação registrada com histórico e proveniência preservados."); } else setFeedback(response.error);
    setBusy(false);
  }

  return <div className="view-stack">
    <section className="metrics-grid">
      <article className="metric-card"><div><span>Indicadores com evidência</span><BarChart3 size={17} /></div><strong>{view.macro.filter((item) => item.observation).length}</strong><small>Preferência organizacional, depois global</small></article>
      <article className="metric-card"><div><span>Atualizados</span><CheckCircle2 size={17} /></div><strong>{view.macro.filter((item) => item.observation?.freshness === "UPDATED").length}</strong><small>Dentro da frequência esperada</small></article>
      <article className="metric-card"><div><span>Desatualizados</span><Clock3 size={17} /></div><strong>{view.macro.filter((item) => item.observation?.freshness === "STALE").length}</strong><small>Nunca tratados como zero</small></article>
      <article className="metric-card"><div><span>Região</span><Landmark size={17} /></div><strong>{view.project.state}</strong><small>{view.project.city}</small></article>
    </section>
    <div className="model-note"><ShieldCheck size={20} /><div><strong>Leitura com proveniência e atualização explícitas</strong><p>Observações desatualizadas, incompatíveis com a geografia ou sem unidade canônica não alimentam gatilhos nem recomendações.</p></div></div>
    <article className="panel"><div className="panel-heading"><div><span className="eyebrow">INDICADORES MACROECONÔMICOS</span><h2>Contexto econômico disponível</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Indicador</th><th>Valor</th><th>Referência</th><th>Atualização</th><th>Fonte</th><th>Escopo</th><th>Revisão</th></tr></thead><tbody>
      {view.macro.map((item) => <tr key={item.code}><td><strong>{item.label}</strong></td><td>{item.observation ? `${pct.format(item.observation.value)} ${item.observation.unit}` : "SEM EVIDÊNCIA"}</td><td>{item.observation ? new Date(item.observation.referenceDate).toLocaleDateString("pt-BR") : "—"}</td><td><span className={`status-pill ${item.observation?.freshness === "UPDATED" ? "positive-value" : item.observation?.freshness === "STALE" ? "negative-value" : ""}`}>{freshnessLabel[item.observation?.freshness ?? "NO_EVIDENCE"]}</span></td><td>{item.observation?.sourceProvider ?? "—"}</td><td>{item.precedence === "ORGANIZATION" ? "Organização" : item.precedence === "GLOBAL" ? "Global" : "—"}</td><td>{item.observation ? `v${item.observation.revision}${item.observation.isCorrection ? " · correção" : ""}` : "—"}</td></tr>)}
      {view.macro.length === 0 && <tr><td colSpan={7}>Nenhuma observação macroeconômica cadastrada. O sistema não fabricará valores.</td></tr>}
    </tbody></table></div></article>
    {view.capabilities.manageObservations && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">CADASTRO ORGANIZACIONAL</span><h2>Registrar observação com fonte declarada</h2></div></div><div className="form-grid">
      <label>Indicador<select value={code} onChange={(event) => setCode(event.target.value as keyof typeof MACRO_INDICATOR_REGISTRY)}>{Object.entries(MACRO_INDICATOR_REGISTRY).map(([key, item]) => <option key={key} value={key}>{item.label} · {item.unit}</option>)}</select></label>
      <label>Valor em {definition.unit}<input type="number" step="any" value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <label>Data de referência<input type="date" value={referenceDate} onChange={(event) => setReferenceDate(event.target.value)} /></label>
      <label>Fonte declarada<input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Ex.: Banco Central do Brasil" /></label>
      <div className="form-actions"><button className="button button-primary" disabled={busy || !value || source.trim().length < 2} onClick={save}>{busy ? "Registrando..." : "Registrar observação"}</button></div>
    </div></article>}
    {feedback && <div className="model-note"><AlertTriangle size={20} /><div><strong>Atualização</strong><p>{feedback}</p></div></div>}
  </div>;
}

export function LaunchTimingView({ view, onChange }: { view: View; onChange: (workspace: MarketProductWorkspaceView) => void }) {
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState<string | null>(null);
  const [decision, setDecision] = useState("LAUNCH_WITH_CONDITIONS"); const [rationale, setRationale] = useState("");
  const [customName, setCustomName] = useState("Sensibilidade personalizada"); const [price, setPrice] = useState("0"); const [cost, setCost] = useState("0"); const [sales, setSales] = useState("0");
  const [triggerMetric, setTriggerMetric] = useState("MARGEM_VGV"); const [triggerThreshold, setTriggerThreshold] = useState("20");
  if (!view) return <div className="empty-state">O empreendimento atual não pôde ser carregado.</div>;
  const latest = view.latestEvaluation;
  const scenarios = view.scenarios.filter((item) => item.status === "LOCKED");
  const latestMetrics = metrics(latest?.economicImpactSnapshot);
  const selectedDecision = latest?.decisions?.[0];
  const recommendation = latest ? recommendationLabel[latest.recommendation] ?? latest.recommendation : "SEM AVALIAÇÃO";
  const tone = latest?.recommendation === "FAVORABLE_TO_LAUNCH" ? "decision-positive" : latest?.recommendation === "WAIT" || latest?.recommendation === "REVIEW_PRODUCT_PRICE" ? "decision-critical" : "decision-warning";

  async function run(action: () => Promise<{ ok: true; data: MarketProductWorkspaceView } | { ok: false; error: string }>, success: string) { setBusy(true); setFeedback(null); const response = await action(); if (response.ok) { onChange(response.data); setFeedback(success); } else setFeedback(response.error); setBusy(false); }
  const generate = () => run(() => generateLaunchScenariosAction({ projectId: view.project.id, rationale: "Atualização determinística dos cenários macroeconômicos e de momento de lançamento." }), "Cenários Base, Favorável e Estressado recalculados.");
  const custom = () => run(() => createCustomLaunchScenarioAction({ projectId: view.project.id, name: customName, rationale: "Sensibilidade personalizada informada pelo usuário, sem alteração da base oficial.", adjustments: { priceRate: 1 + Number(price) / 100, constructionCostRate: 1 + Number(cost) / 100, salesVelocityRate: 1 + Number(sales) / 100, fundingRateDeltaPercentagePoints: 0 } }), "Cenário personalizado calculado e preservado.");
  const decide = () => latest && run(() => decideLaunchAction(view.project.id, { evaluationId: latest.id, humanDecision: decision as "LAUNCH" | "LAUNCH_WITH_CONDITIONS" | "PHASE" | "REVIEW_PRODUCT_PRICE" | "WAIT" | "REJECT", rationale, evidenceRefs: [latest.id] }), "Decisão humana registrada na memória imutável.");
  const trigger = () => run(() => createLaunchTriggerAction({ projectId: view.project.id, code: `${triggerMetric}-${Date.now()}`, metricKey: triggerMetric as "MARGEM_VGV", operator: "LT", thresholdValue: Number(triggerThreshold), rationale: "Revisar a recomendação quando o indicador ficar abaixo do limite definido." }), "Gatilho configurado. Ele gera sinal, nunca executa lançamento.");

  return <div className="view-stack">
    <article className={`recommendation-card ${tone}`}><div><span className="eyebrow">RECOMENDAÇÃO DETERMINÍSTICA ATUAL</span><h2>{recommendation}</h2><p>{latest ? `Confiança ${confidenceLabel[latest.confidenceLevel]} · calculado em ${new Date(latest.calculatedAt).toLocaleString("pt-BR")}` : "Gere os cenários para avaliar o momento de lançamento."}</p></div><Target size={32} /></article>
    <section className="metrics-grid">
      <article className="metric-card"><div><span>VGV projetado</span><TrendingUp size={17} /></div><strong>{typeof latestMetrics.vgv === "string" ? brl.format(Number(latestMetrics.vgv)) : "—"}</strong><small>Cenário Base · REDE Engine</small></article>
      <article className="metric-card"><div><span>Margem sobre VGV</span><Gauge size={17} /></div><strong>{typeof latestMetrics.marginOnVgv === "string" ? `${pct.format(Number(latestMetrics.marginOnVgv) * 100)}%` : "—"}</strong><small>Não altera a base aprovada</small></article>
      <article className="metric-card"><div><span>Necessidade de capital</span><Landmark size={17} /></div><strong>{typeof latestMetrics.fundingNeed === "string" ? brl.format(Number(latestMetrics.fundingNeed)) : "—"}</strong><small>Projeção, não proposta de funding</small></article>
      <article className="metric-card"><div><span>Gatilhos ativos</span><Play size={17} /></div><strong>{view.triggers.filter((item) => item.trigger.status === "ACTIVE").length}</strong><small>{view.triggers.filter((item) => item.result.matched).length} limite(s) atingido(s)</small></article>
    </section>
    {feedback && <div className="model-note"><AlertTriangle size={20} /><div><strong>Atualização</strong><p>{feedback}</p></div></div>}
    {view.capabilities.createScenarios && <div className="model-note"><BarChart3 size={20} /><div><strong>Atualizar cenários de lançamento</strong><p>Reutiliza a Viabilidade oficial, o mercado 9J, a Engenharia 9M e o Capital 9N. Nenhum cálculo sobrescreve orçamento, base aprovada ou funding.</p><button className="button button-primary" disabled={busy} onClick={generate}>{busy ? "Calculando..." : "Gerar Base, Favorável e Estressado"}</button></div></div>}
    <article className="panel"><div className="panel-heading"><div><span className="eyebrow">CENÁRIOS IMUTÁVEIS</span><h2>Impacto econômico comparável</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Cenário</th><th>Versão</th><th>Recomendação</th><th>VGV</th><th>Margem</th><th>TIR</th><th>Confiança</th></tr></thead><tbody>
      {scenarios.map((scenario) => { const evaluation = scenario.evaluations[0]; const m = metrics(evaluation?.economicImpactSnapshot); return <tr key={scenario.id}><td><strong>{scenarioLabel[scenario.kind]}</strong></td><td>v{scenario.version}</td><td>{evaluation ? recommendationLabel[evaluation.recommendation] : "—"}</td><td>{typeof m.vgv === "string" ? brl.format(Number(m.vgv)) : "—"}</td><td>{typeof m.marginOnVgv === "string" ? `${pct.format(Number(m.marginOnVgv) * 100)}%` : "—"}</td><td>{typeof m.annualIrr === "string" ? `${pct.format(Number(m.annualIrr) * 100)}%` : "—"}</td><td>{evaluation ? confidenceLabel[evaluation.confidenceLevel] : "—"}</td></tr>; })}
      {scenarios.length === 0 && <tr><td colSpan={7}>Nenhum cenário calculado ainda.</td></tr>}
    </tbody></table></div></article>
    {latest && <div className="risk-cards">
      <article className="risk-card positive"><header><span className="risk-icon"><CheckCircle2 size={18} /></span><div><span>FATORES FAVORÁVEIS</span><h3>O que sustenta o lançamento</h3></div></header><div className="panel-heading"><ul>{strings(latest.favorableFactors).map((item) => <li key={item}>{item}</li>)}{strings(latest.favorableFactors).length === 0 && <li>Nenhum fator favorável confirmado.</li>}</ul></div></article>
      <article className="risk-card critical"><header><span className="risk-icon"><AlertTriangle size={18} /></span><div><span>RISCOS E EVIDÊNCIAS AUSENTES</span><h3>O que exige ação</h3></div></header><div className="panel-heading"><ul>{[...strings(latest.criticalFactors), ...strings(latest.unfavorableFactors), ...strings(latest.missingEvidence).map((item) => `Sem evidência: ${item}`)].map((item) => <li key={item}>{item}</li>)}</ul></div></article>
    </div>}
    {latest && <div className="model-note"><Target size={20} /><div><strong>Condições para mudar a recomendação</strong><ul>{strings(latest.conditionsForChange).map((item) => <li key={item}>{item}</li>)}</ul></div></div>}
    {view.capabilities.createScenarios && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">SENSIBILIDADE</span><h2>Cenário personalizado sem alterar a base oficial</h2></div></div><div className="form-grid"><label>Nome<input value={customName} onChange={(event) => setCustomName(event.target.value)} /></label><label>Preço (%)<input type="number" value={price} onChange={(event) => setPrice(event.target.value)} /></label><label>Custo (%)<input type="number" value={cost} onChange={(event) => setCost(event.target.value)} /></label><label>Velocidade de vendas (%)<input type="number" value={sales} onChange={(event) => setSales(event.target.value)} /></label><div className="form-actions"><button className="button button-secondary" disabled={busy} onClick={custom}>Calcular sensibilidade</button></div></div></article>}
    {view.capabilities.manageTriggers && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">GATILHOS DETERMINÍSTICOS</span><h2>Condição para revisão da recomendação</h2></div></div><div className="form-grid"><label>Métrica<select value={triggerMetric} onChange={(event) => setTriggerMetric(event.target.value)}><option value="MARGEM_VGV">Margem sobre VGV</option><option value="VSO">VSO</option><option value="INCC">INCC</option><option value="AFFORDABILITY_RATIO">Compatibilidade com a renda</option></select></label><label>Disparar quando abaixo de<input type="number" step="any" value={triggerThreshold} onChange={(event) => setTriggerThreshold(event.target.value)} /></label><div className="form-actions"><button className="button button-secondary" disabled={busy} onClick={trigger}>Criar gatilho</button></div></div></article>}
    <article className="panel"><div className="panel-heading"><div><span className="eyebrow">GATILHOS CONFIGURADOS</span><h2>Sinais ativos e elegibilidade da evidência</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Código</th><th>Métrica</th><th>Regra</th><th>Estado</th><th>Avaliação</th></tr></thead><tbody>{view.triggers.map(({ trigger: item, result }) => <tr key={item.id}><td>{item.code}</td><td>{launchMetric(item.metricKey)?.label ?? item.metricKey}</td><td>{operatorLabel[item.operator] ?? item.operator} {String(item.thresholdValue)}{item.operator === "BETWEEN" && item.thresholdValueEnd != null ? ` e ${String(item.thresholdValueEnd)}` : ""} {item.unit}</td><td>{item.status === "ACTIVE" ? "Ativo" : "Pausado"}</td><td><span className={`status-pill ${result.matched ? "negative-value" : result.eligible ? "positive-value" : ""}`}>{result.reason}</span></td></tr>)}{view.triggers.length === 0 && <tr><td colSpan={5}>Nenhum gatilho configurado.</td></tr>}</tbody></table></div></article>
    <article className="panel"><div className="panel-heading"><div><span className="eyebrow">DECISÃO HUMANA</span><h2>Memória oficial da decisão</h2></div></div>{selectedDecision ? <div className="model-note"><ShieldCheck size={20} /><div><strong>{decisionLabel[selectedDecision.humanDecision]}</strong><p>{selectedDecision.rationale} · {new Date(selectedDecision.decidedAt).toLocaleString("pt-BR")}</p></div></div> : latest && view.capabilities.decide ? <div className="form-grid"><label>Decisão<select value={decision} onChange={(event) => setDecision(event.target.value)}>{Object.entries(decisionLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Justificativa<textarea rows={3} value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="Registre a decisão e seus fundamentos..." /></label><div className="form-actions"><button className="button button-primary" disabled={busy || rationale.trim().length < 8} onClick={decide}>Registrar decisão imutável</button></div></div> : <div className="empty-state">{latest ? "Seu perfil não possui alçada para registrar a decisão." : "Gere um cenário antes de decidir."}</div>}</article>
  </div>;
}
