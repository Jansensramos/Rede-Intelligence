"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  Building2,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Gauge,
  Gavel,
  LayoutDashboard,
  Landmark,
  Layers3,
  Menu,
  MapPinned,
  FolderArchive,
  Presentation,
  PanelLeftClose,
  Plus,
  Radar,
  Scale,
  SlidersHorizontal,
  Settings2,
  ShieldAlert,
  Sparkles,
  ShoppingCart,
  TableProperties,
  TrendingUp,
} from "lucide-react";
import { CashFlowChart } from "./cash-flow-chart";
import { ProjectEditor } from "./project-editor";
import { RedeMark } from "./rede-mark";
import { ScoreSummary } from "./score-summary";
import { SensitivityView } from "./sensitivity-view";
import { RedTeamSummary, RedTeamView } from "./red-team-view";
import { LandIntelligenceView } from "./land-intelligence-view";
import { InvestmentSuiteView } from "./investment-suite-view";
import { RedeAIView } from "./rede-ai-view";
import { DesignIntelligenceView } from "./design-intelligence-view";
import { BudgetEditor } from "./BudgetEditor";
import { OperationsView } from "./operations-view";
import { FinancialView } from "./financial-view";
import { ProcurementView } from "./procurement-view";
import { logoutAction } from "@/app/actions/auth";
import { createStudyAction, createStudyVersionAction } from "@/app/actions/studies";
import { reassessInvestmentCaseAction } from "@/app/actions/investment";
import type { PersistedStudyView, WorkspaceIdentity } from "@/application/studies/contracts";
import type { LandWorkspaceView } from "@/domain/land";
import type { InvestmentCaseWorkspace } from "@/domain/investment";
import type { AIBootstrapView } from "@/domain/ai";
import type { DesignWorkspaceView } from "@/domain/design";
import type { BudgetWorkspaceView } from "@/application/budget/budget-service";
import type { OperationsWorkspaceView } from "@/application/operations/operations-service";
import type { FinancialWorkspaceView } from "@/application/financial-ops/financial-service";
import type { ProcurementWorkspaceView } from "@/application/procurement/procurement-service";
import { DEMO_PROJECT } from "@/domain/financial/demo";
import { calculateAllScenarios } from "@/domain/financial/engine";
import { SCENARIOS } from "@/domain/financial/scenarios";
import type { ProjectAssumptions, ScenarioKey } from "@/domain/financial/types";
import { analyzeRisk, type FindingSeverity } from "@/domain/risk/rules";

type ViewKey = "overview" | "assumptions" | "land" | "design" | "budget" | "procurement" | "financial" | "scenarios" | "sensitivity" | "redteam" | "committee" | "studio" | "dataroom" | "ai" | "cashflow" | "risks" | "audit";
type EditorMode = "create" | "version";

const viewItems: { key: ViewKey; label: string; icon: typeof Gauge }[] = [
  { key: "overview", label: "Visão executiva", icon: LayoutDashboard },
  { key: "assumptions", label: "Premissas", icon: Settings2 },
  { key: "land", label: "Terreno & Potencial", icon: MapPinned },
  { key: "design", label: "Design Intelligence", icon: Layers3 },
  { key: "budget", label: "Orçamento", icon: CircleDollarSign },
  { key: "procurement", label: "Suprimentos e Contratos", icon: ShoppingCart },
  { key: "financial", label: "Financeiro", icon: Landmark },
  { key: "scenarios", label: "Cenários", icon: BarChart3 },
  { key: "sensitivity", label: "Sensibilidade", icon: SlidersHorizontal },
  { key: "redteam", label: "REDE Red Team", icon: Radar },
  { key: "committee", label: "Investment Committee", icon: Gavel },
  { key: "studio", label: "REDE Studio", icon: Presentation },
  { key: "dataroom", label: "Data Room", icon: FolderArchive },
  { key: "ai", label: "REDE AI", icon: Sparkles },
  { key: "cashflow", label: "Fluxo de caixa", icon: TableProperties },
  { key: "risks", label: "Riscos & alertas", icon: ShieldAlert },
  { key: "audit", label: "Trilha de cálculo", icon: BookOpenCheck },
];

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const compactCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const brl = (value: string) => currency.format(Number(value));
const compactBrl = (value: string) => compactCurrency.format(Number(value));
const percentage = (value: string | null) => value === null ? "—" : `${number.format(Number(value) * 100)}%`;

function statusClass(severity: FindingSeverity) {
  return severity === "critical" ? "critical" : severity === "warning" ? "warning" : "positive";
}

function MetricCard({ label, value, meta, tone, icon: Icon }: { label: string; value: string; meta: string; tone?: "positive" | "negative" | "neutral"; icon: typeof Gauge }) {
  return (
    <article className="metric-card">
      <div><span>{label}</span><Icon size={17} /></div>
      <strong>{value}</strong>
      <small className={tone ? `metric-${tone}` : ""}>{meta}</small>
    </article>
  );
}
function SectionTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <header className="section-title">
      <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2>{description && <p>{description}</p>}</div>
      {action}
    </header>
  );
}

function AssumptionSummary({ project, onEdit }: { project: ProjectAssumptions; onEdit: () => void }) {
  const groups = [
    { title: "Produto", items: [["Terreno", `${number.format(Number(project.landAreaM2))} m²`], ["Unidades", project.units.toString()], ["Área privativa", `${project.privateAreaPerUnitM2} m² / un.`], ["Eficiência", `${project.efficiencyRate}%`], ["Preço", brl(project.unitPrice)]] },
    { title: "Estrutura de custos", items: [["Terreno", brl(project.landPrice)], ["Obra", `${brl(project.constructionCostPerM2)} / m²`], ["Indiretos", `${project.indirectCostsRate}%`], ["Contingência", `${project.contingencyRate}%`], ["Comissão + MKT", `${Number(project.commissionRate) + Number(project.marketingRate)}%`]] },
    { title: "Cronograma e vendas", items: [["Aprovação", `${project.approvalMonths} meses`], ["Obra", `${project.constructionMonths} meses`], ["Velocidade", `${project.salesVelocityUnitsMonth} un. / mês`], ["Entrada", `${project.downPaymentRate}%`], ["Entrega", `${project.onDeliveryRate}%`]] },
    { title: "Capital e política", items: [["Funding", brl(project.financingLimit)], ["Custo", `${project.annualFinancingRate}% a.a.`], ["Margem mín.", `${project.policy.minimumMarginRate}%`], ["TIR mín.", `${project.policy.minimumIrrRate}% a.a.`], ["Exposição máx.", brl(project.policy.maximumExposure)]] },
  ];
  return (
    <>
      <SectionTitle eyebrow="PREMISSAS ATIVAS" title="Uma fonte para todos os cálculos" description="Valores do caso base. Cenários aplicam deltas sem alterar este snapshot." action={<button className="button button-primary" onClick={onEdit}><Settings2 size={16} /> Editar premissas</button>} />
      <div className="assumption-groups">
        {groups.map((group) => <article className="assumption-card" key={group.title}><h3>{group.title}</h3><dl>{group.items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></article>)}
      </div>
      <div className="model-note"><ClipboardCheck size={20} /><div><strong>Hipóteses declaradas do Engine v1</strong><p>Terreno no mês zero, curva S padronizada, tributo sobre recebimentos e financiamento usado para cobrir déficits até o limite. Inflação, distrato, inadimplência e permuta ainda não estão modelados.</p></div></div>
    </>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "RE";
}

export function IntelligenceWorkspace({ initialStudy, initialLand, initialInvestment, initialAI, initialDesign, initialBudget, initialOperations, initialFinancial, initialProcurement, identity }: { initialStudy: PersistedStudyView; initialLand: LandWorkspaceView; initialInvestment: InvestmentCaseWorkspace; initialAI: AIBootstrapView; initialDesign: DesignWorkspaceView; initialBudget: BudgetWorkspaceView | null; initialOperations: OperationsWorkspaceView; initialFinancial: FinancialWorkspaceView; initialProcurement: ProcurementWorkspaceView; identity: WorkspaceIdentity }) {
  const [study, setStudy] = useState<PersistedStudyView>(initialStudy);
  const [landWorkspace, setLandWorkspace] = useState<LandWorkspaceView>(initialLand);
  const [investmentWorkspace, setInvestmentWorkspace] = useState<InvestmentCaseWorkspace>(initialInvestment);
  const [designWorkspace, setDesignWorkspace] = useState<DesignWorkspaceView>(initialDesign);
  const [budgetWorkspace, setBudgetWorkspace] = useState<BudgetWorkspaceView | null>(initialBudget);
  const [project, setProject] = useState<ProjectAssumptions>(initialStudy.assumptions);
  const [scenario, setScenario] = useState<ScenarioKey>("base");
  const [view, setView] = useState<ViewKey>("overview");
  const [editorProject, setEditorProject] = useState<ProjectAssumptions | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("version");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState<string | undefined>();
  const [aiOriginModule, setAiOriginModule] = useState<ViewKey>("overview");

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view]);

  const results = useMemo(() => calculateAllScenarios(project), [project]);
  const result = results[scenario];
  const score = study.analytics.scores[scenario];
  const recommendation = useMemo(() => analyzeRisk(result), [result]);
  const criticalCount = recommendation.findings.filter((item) => item.severity === "critical").length;
  const warningCount = recommendation.findings.filter((item) => item.severity === "warning").length;
  const redTeamCriticalCount = study.redTeam?.findings.filter((finding) => finding.severity === "CRITICAL").length ?? 0;

  async function saveProject(value: ProjectAssumptions) {
    const response = editorMode === "create" || !study.studyId
      ? await createStudyAction(value)
      : await createStudyVersionAction(study.projectId, study.studyId, value);
    if (!response.ok) throw new Error(response.error);
    setStudy(response.data);
    setProject(response.data.assumptions);
    const reassessment = await reassessInvestmentCaseAction(investmentWorkspace.id, response.data.studyVersionId, landWorkspace.versionId || null);
    if (reassessment.ok) setInvestmentWorkspace(reassessment.data);
    setEditorProject(null);
    setScenario("base");
    setView("overview");
  }

  async function updateBudgetItem(itemId: string, updates: { description?: string; quantity?: number; unitCost?: number }) {
    if (!budgetWorkspace) return;
    const response = await fetch(`/api/budgets/${budgetWorkspace.id}/items/${itemId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const payload = await response.json() as { success?: boolean; data?: BudgetWorkspaceView; error?: string };
    if (!response.ok || !payload.data) throw new Error(payload.error ?? "Não foi possível atualizar o item.");
    setBudgetWorkspace(payload.data);
  }

  async function deleteBudgetItem(itemId: string) {
    if (!budgetWorkspace) return;
    const response = await fetch(`/api/budgets/${budgetWorkspace.id}/items/${itemId}`, { method: "DELETE" });
    const payload = await response.json() as { success?: boolean; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Não foi possível excluir o item.");
    const refreshed = await fetch(`/api/budgets/${budgetWorkspace.id}`);
    const refreshedPayload = await refreshed.json() as { data?: BudgetWorkspaceView; error?: string };
    if (!refreshed.ok || !refreshedPayload.data) throw new Error(refreshedPayload.error ?? "Não foi possível recarregar o orçamento.");
    setBudgetWorkspace(refreshedPayload.data);
  }

  function navigate(next: ViewKey) {
    setView(next);
    setSidebarOpen(false);
  }

  function openAI(prompt?: string) {
    if (view !== "ai") setAiOriginModule(view);
    setAiPrompt(prompt);
    setView("ai");
    setSidebarOpen(false);
  }

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
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand"><RedeMark /><button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Fechar menu"><PanelLeftClose size={18} /></button></div>
        <div className="portfolio-label">ANÁLISE ATIVA</div>
        <button className="active-project">
          <span className="project-monogram">RH</span>
          <span><strong>{project.projectName}</strong><small>{project.city} · {project.state}</small></span>
          <ChevronDown size={15} />
        </button>
        <nav className="main-nav" aria-label="Navegação principal">
          {viewItems.map((item) => <button key={item.key} className={view === item.key ? "is-active" : ""} onClick={() => item.key === "ai" ? openAI() : navigate(item.key)}><item.icon size={17} /><span>{item.label}</span>{item.key === "risks" && criticalCount > 0 && <b>{criticalCount}</b>}{item.key === "redteam" && redTeamCriticalCount > 0 && <b>{redTeamCriticalCount}</b>}</button>)}
        </nav>
        <button className="sidebar-module sidebar-ai-live" onClick={() => openAI("Explique este projeto.")}><span>COPILOTO ATIVO</span><Sparkles size={18} /><div><strong>Pergunte ao REDE</strong><small>Contexto estruturado</small></div><span className="soon">AI</span></button>
        <div className="sidebar-footer"><button><Building2 size={17} /><span>{identity.organizationName}</span></button><div className="user-avatar">{initials(identity.userName)}</div></div>
      </aside>

      {sidebarOpen && <button className="sidebar-overlay" aria-label="Fechar menu" onClick={() => setSidebarOpen(false)} />}

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-left"><button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu"><Menu size={20} /></button><span>Portfólio</span><i>/</i><strong>{project.projectName}</strong></div>
          <div className="topbar-actions"><button className="ai-context-trigger" onClick={() => openAI(`Explique esta tela: ${view}.`)}><Sparkles size={14} /> Explicar esta tela</button><span className="engine-chip"><i /> ENGINE v1.0</span><button className="button button-secondary new-study" onClick={() => { setEditorMode("create"); setEditorProject({ ...structuredClone(DEMO_PROJECT), projectName: "Novo empreendimento", city: "", state: "SP", landPrice: "0", financingLimit: "0" }); }}><Plus size={16} /> Novo estudo</button><form action={logoutAction} className="logout-form"><button className="avatar-button" title="Sair" aria-label={`Sair da conta de ${identity.userName}`}>{initials(identity.userName)}</button></form></div>
        </header>

        <div className="workspace-content">
          <div className="project-heading">
{view === "land" && landWorkspace?.snapshot ? (
  <div>
    <span className="eyebrow">TERRENO : {landWorkspace.snapshot.landAsset.city}</span>
    {/* ... resto do conteúdo de terreno ... */}
  </div>
) : view === "land" ? (
  <div className="placeholder">Carregando dados de terreno...</div>
) : null}
            {view !== "land" && <div className="scenario-switch" aria-label="Cenário ativo">{(["conservative", "base", "aggressive"] as ScenarioKey[]).map((key) => <button key={key} className={scenario === key ? "is-active" : ""} onClick={() => setScenario(key)}>{SCENARIOS[key].label}</button>)}</div>}
          </div>

          {view === "overview" && (
            <div className="view-stack">
              <section className={`decision-banner ${decisionTone}`}>
                <div className="decision-icon">{recommendation.status === "AVANCAR" ? <Check size={21} /> : <AlertTriangle size={21} />}</div>
                <div><span>RECOMENDAÇÃO DO MOTOR · CENÁRIO {result.scenarioLabel.toUpperCase()}</span><strong>{recommendation.label}</strong><p>Motivo dominante: {recommendation.dominantReason}.</p></div>
                <button onClick={() => setView("risks")}>Ver evidências <ArrowRight size={16} /></button>
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
                  <div className="panel-heading"><div><span className="eyebrow">CAIXA MENSAL</span><h2>Curva de exposição e recuperação</h2></div><button className="text-button" onClick={() => setView("cashflow")}>Ver fluxo completo <ArrowRight size={15} /></button></div>
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
                  <div className="finding-list">{recommendation.findings.filter((item) => item.severity !== "positive").slice(0, 3).map((finding) => <button key={finding.id} onClick={() => setView("risks")} className="finding-row"><span className={`finding-marker ${statusClass(finding.severity)}`}><AlertTriangle size={15} /></span><span><strong>{finding.title}</strong><small>{finding.evidence}</small></span><ArrowRight size={16} /></button>)}</div>
                </article>
                <ScoreSummary score={score} onOpen={() => setView("sensitivity")} />
              </section>

              <RedTeamSummary report={study.redTeam} onOpen={() => setView("redteam")} />

              <section className="panel scenario-strip">
                <div className="panel-heading"><div><span className="eyebrow">DOWNSIDE × UPSIDE</span><h2>Comparação rápida de cenários</h2></div><button className="text-button" onClick={() => setView("scenarios")}>Abrir análise <ArrowRight size={15} /></button></div>
                <div className="scenario-table compact-table"><div className="table-row table-head"><span>Cenário</span><span>VGV</span><span>Lucro</span><span>Margem</span><span>TIR</span><span>Exposição</span></div>{(["conservative", "base", "aggressive"] as ScenarioKey[]).map((key) => { const item = results[key]; return <button key={key} onClick={() => setScenario(key)} className={`table-row ${scenario === key ? "selected" : ""}`}><span><i className={`scenario-dot dot-${key}`} />{SCENARIOS[key].label}</span><strong>{compactBrl(item.metrics.vgv)}</strong><strong>{compactBrl(item.metrics.profit)}</strong><strong>{percentage(item.metrics.marginOnVgv)}</strong><strong>{percentage(item.metrics.annualIrr)}</strong><strong>{compactBrl(item.metrics.maximumCashExposure)}</strong></button>; })}</div>
              </section>
            </div>
          )}

          {view === "assumptions" && <AssumptionSummary project={project} onEdit={() => { setEditorMode("version"); setEditorProject(project); }} />}

          {view === "land" && <LandIntelligenceView initialLand={landWorkspace} onLandChange={(nextLand) => { setLandWorkspace(nextLand); void reassessInvestmentCaseAction(investmentWorkspace.id, study.studyVersionId, nextLand.versionId).then((response) => { if (response.ok) setInvestmentWorkspace(response.data); }); }} />}

          {view === "design" && <DesignIntelligenceView initialWorkspace={designWorkspace} onWorkspaceChange={setDesignWorkspace} onAskAI={(prompt) => openAI(prompt)} />}

          {view === "budget" && (budgetWorkspace ? (
            <div className="view-stack">
              <SectionTitle eyebrow="GESTÃO OPERACIONAL" title="Base Aprovada, Orçamento e Cronograma" description="Referências separadas, versionadas e rastreáveis para a execução do empreendimento." />
              <OperationsView workspace={initialOperations} />
              <SectionTitle eyebrow="ESTRUTURA ANALÍTICA" title={`${budgetWorkspace.name} · v${budgetWorkspace.version}`} description="Itens persistidos por empreendimento, organização e versão." />
              <BudgetEditor
                budgetId={budgetWorkspace.id}
                projectName={budgetWorkspace.projectName}
                lineItems={budgetWorkspace.lineItems}
                totalBudget={budgetWorkspace.totalBudget}
                summary={budgetWorkspace.summary}
                onUpdateItem={updateBudgetItem}
                onDeleteItem={deleteBudgetItem}
                readOnly={["APPROVED", "OFFICIAL", "SUPERSEDED", "CLOSED", "ARCHIVED"].includes(budgetWorkspace.status)}
              />
            </div>
          ) : (
            <div className="empty-state"><CircleDollarSign size={18} /> Nenhum orçamento cadastrado para este empreendimento.</div>
          ))}

          {view === "financial" && (
            <div className="view-stack">
              <SectionTitle eyebrow="FINANCEIRO E TESOURARIA" title="Contas a Pagar, Contas a Receber e Caixa" description="Obrigação → conta → parcela → pagamento → conciliação → realizado, rastreável por SPE e centro de custo." />
              <FinancialView workspace={initialFinancial} />
            </div>
          )}

          {view === "procurement" && (
            <div className="view-stack">
              <SectionTitle eyebrow="SUPRIMENTOS, CONTRATOS E MEDIÇÕES" title="Do planejamento à execução contratual" description="Necessidade → requisição → cotação → contrato → medição → obrigação, sem dupla contagem." />
              <ProcurementView workspace={initialProcurement} />
            </div>
          )}

          {view === "scenarios" && (
            <div className="view-stack">
              <SectionTitle eyebrow="CENÁRIOS PADRÃO" title="O projeto sob três condições" description="Deltas documentados e aplicados sobre o mesmo caso base." />
              <div className="scenario-cards">{(["conservative", "base", "aggressive"] as ScenarioKey[]).map((key) => { const item = results[key]; const rec = analyzeRisk(item); return <article key={key} className={`scenario-card ${scenario === key ? "is-selected" : ""}`} onClick={() => setScenario(key)}><div className="scenario-card-head"><span className={`scenario-icon scenario-${key}`}><BarChart3 size={19} /></span><div><span className="eyebrow">CENÁRIO</span><h3>{SCENARIOS[key].label}</h3></div>{scenario === key && <span className="active-label"><Check size={13} /> ATIVO</span>}</div><p>{SCENARIOS[key].description}</p><div className="scenario-deltas">{SCENARIOS[key].changes.map((change) => <span key={change}>{change}</span>)}</div><dl><div><dt>VGV</dt><dd>{compactBrl(item.metrics.vgv)}</dd></div><div><dt>Lucro</dt><dd>{compactBrl(item.metrics.profit)}</dd></div><div><dt>Margem</dt><dd>{percentage(item.metrics.marginOnVgv)}</dd></div><div><dt>Exposição</dt><dd>{compactBrl(item.metrics.maximumCashExposure)}</dd></div></dl><footer className={rec.status === "NAO_AVANCAR" ? "critical" : "warning"}>{rec.label}</footer></article>; })}</div>
              <article className="panel"><div className="panel-heading"><div><span className="eyebrow">COMPARATIVO</span><h2>Indicadores por cenário</h2></div></div><div className="scenario-table"><div className="table-row table-head"><span>Indicador</span><span>Conservador</span><span>Base</span><span>Agressivo</span></div>{[
                ["VGV", "vgv", compactBrl], ["Receita líquida", "netRevenue", compactBrl], ["Custo total", "totalCost", compactBrl], ["Lucro", "profit", compactBrl], ["Margem / VGV", "marginOnVgv", percentage], ["ROI", "roi", percentage], ["TIR anual", "annualIrr", percentage], ["VPL", "npv", compactBrl], ["Exposição máxima", "maximumCashExposure", compactBrl],
              ].map(([label, metric, formatter]) => <div className="table-row" key={label as string}><strong>{label as string}</strong>{(["conservative", "base", "aggressive"] as ScenarioKey[]).map((key) => <span key={key}>{(formatter as (value: string | null) => string)(results[key].metrics[metric as keyof typeof result.metrics] as string | null)}</span>)}</div>)}</div></article>
            </div>
          )}

          {view === "sensitivity" && <SensitivityView sensitivity={study.analytics.sensitivity} score={score} scoreScenarioLabel={SCENARIOS[scenario].label} />}

          {view === "redteam" && <RedTeamView report={study.redTeam} />}

          {view === "committee" && <InvestmentSuiteView mode="committee" initialWorkspace={investmentWorkspace} onWorkspaceChange={setInvestmentWorkspace} />}

          {view === "studio" && <InvestmentSuiteView mode="studio" initialWorkspace={investmentWorkspace} onWorkspaceChange={setInvestmentWorkspace} />}

          {view === "dataroom" && <InvestmentSuiteView mode="dataroom" initialWorkspace={investmentWorkspace} onWorkspaceChange={setInvestmentWorkspace} />}

          {view === "ai" && <RedeAIView initialBootstrap={initialAI} currentModule={aiOriginModule} initialPrompt={aiPrompt} onPromptConsumed={() => setAiPrompt(undefined)} onNavigate={(module) => navigate(module as ViewKey)} />}

          {view === "cashflow" && (
            <div className="view-stack">
              <SectionTitle eyebrow={`CENÁRIO ${result.scenarioLabel.toUpperCase()}`} title="Fluxo de caixa mensal" description="Valores do projeto antes e depois do funding. Passe para outro cenário no seletor acima." />
              <article className="panel"><CashFlowChart rows={result.cashFlow} /></article>
              <article className="panel flow-table-panel"><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Mês</th><th>Fase</th><th>Vendas</th><th>Recebimentos</th><th>Obra + ind.</th><th>Custos comerciais</th><th>Fluxo operacional</th><th>Funding</th><th>Fluxo equity</th><th>Acum. equity</th></tr></thead><tbody>{result.cashFlow.map((row) => <tr key={row.month}><td>M{row.month}</td><td><span className={`phase phase-${row.phase}`}>{row.phase}</span></td><td>{row.unitsSold === "0" ? "—" : `${number.format(Number(row.unitsSold))} un.`}</td><td>{compactBrl(row.receipts)}</td><td>{compactCurrency.format(Number(row.constructionCost) + Number(row.indirectCosts))}</td><td>{compactCurrency.format(Number(row.marketing) + Number(row.commission) + Number(row.taxes))}</td><td className={Number(row.operatingNet) < 0 ? "negative-value" : "positive-value"}>{compactBrl(row.operatingNet)}</td><td>{Number(row.financingDraw) > 0 ? compactBrl(row.financingDraw) : "—"}</td><td className={Number(row.equityFlow) < 0 ? "negative-value" : "positive-value"}>{compactBrl(row.equityFlow)}</td><td>{compactBrl(row.cumulativeEquityCash)}</td></tr>)}</tbody></table></div></article>
            </div>
          )}

          {view === "risks" && (
            <div className="view-stack">
              <SectionTitle eyebrow="REGRAS DETERMINÍSTICAS" title="Riscos, evidências e ações" description="Primeira camada objetiva antes do REDE Red Team. Não substitui revisão profissional." />
              <section className={`recommendation-card ${decisionTone}`}><div><span className="eyebrow">RECOMENDAÇÃO</span><h2>{recommendation.label}</h2><p>Motivo dominante: {recommendation.dominantReason}.</p></div><div className="recommendation-count"><strong>{criticalCount + warningCount}</strong><span>pontos para revisão</span></div></section>
              <div className="risk-cards">{recommendation.findings.map((finding) => <article key={finding.id} className={`risk-card ${statusClass(finding.severity)}`}><header><span className="risk-icon">{finding.severity === "positive" ? <Check size={18} /> : <AlertTriangle size={18} />}</span><div><span>{finding.category.toUpperCase()} · {finding.classification.toUpperCase()}</span><h3>{finding.title}</h3></div></header><div className="risk-evidence"><strong>Evidência</strong><p>{finding.evidence}</p></div><div className="risk-action"><strong>Ação recomendada</strong><p>{finding.action}</p></div></article>)}</div>
            </div>
          )}

          {view === "audit" && (
            <div className="view-stack">
              <SectionTitle eyebrow="CALCULATION AUDIT TRAIL" title="Como cada número foi formado" description={`Engine ${result.engineVersion} · cenário ${result.scenarioLabel} · ${result.auditTrail.length} fórmulas essenciais rastreadas.`} />
              <div className="audit-list">{result.auditTrail.map((item, index) => <article className="audit-card" key={item.id}><span className="audit-index">{String(index + 1).padStart(2, "0")}</span><div className="audit-main"><div className="audit-title"><div><span>{item.classification.toUpperCase()}</span><h3>{item.label}</h3></div><strong>{item.result}</strong></div><div className="formula"><code>{item.formula}</code></div><div className="audit-inputs">{item.inputs.map((input) => <div key={input.label}><span>{input.label} · {input.source}</span><strong>{input.value}</strong></div>)}</div></div></article>)}</div>
            </div>
          )}
        </div>
      </main>

      {editorProject && <ProjectEditor initial={editorProject} onClose={() => setEditorProject(null)} onSave={saveProject} />}
    </div>
  );
}
