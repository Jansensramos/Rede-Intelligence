"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  Boxes,
  Building2,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Database,
  Gauge,
  Gavel,
  HandCoins,
  LayoutDashboard,
  Landmark,
  Layers3,
  Menu,
  MapPinned,
  FolderArchive,
  Presentation,
  PanelLeftClose,
  Plug,
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
  Users,
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
import { LegalView } from "./legal-view";
import { SalesView } from "./sales-view";
import { PeoplePerformanceView } from "./people-performance-view";
import { AccountingView } from "./accounting-view";
import { IntegrationsView } from "./integrations-view";
import { DataIntelligenceView } from "./data-intelligence-view";
import { MarketIntelligenceView } from "./market-intelligence-view";
import { ProductIntelligenceView } from "./product-intelligence-view";
import { logoutAction } from "@/app/actions/auth";
import { createStudyAction, createStudyVersionAction } from "@/app/actions/studies";
import { decideProductScenarioAction, generateProductScenariosAction } from "@/app/actions/market-product";
import { reassessInvestmentCaseAction } from "@/app/actions/investment";
import { refreshAIBootstrapAction } from "@/app/actions/ai";
import {
  loadBudgetAreaAction,
  loadDesignWorkspaceAction,
  loadFinancialWorkspaceAction,
  loadLegalWorkspaceAction,
  loadProcurementWorkspaceAction,
  loadSalesWorkspaceAction,
} from "@/app/actions/workspace-loader";
import { EmptyState, ErrorState, Loading, MetricCard, SectionTitle } from "@/components/ui";
import { OPERATIONAL_AREAS, TRANSVERSAL_AREAS, type LegacyViewKey } from "@/domain/workspace/areas";
import type { OperationalContext } from "@/application/workspace/operational-context";
import type { PersistedStudyView, WorkspaceIdentity } from "@/application/studies/contracts";
import type { LandWorkspaceView } from "@/domain/land";
import type { InvestmentCaseWorkspace } from "@/domain/investment";
import type { AIBootstrapView } from "@/domain/ai";
import type { DesignWorkspaceView } from "@/domain/design";
import type { BudgetWorkspaceView } from "@/application/budget/budget-service";
import type { OperationsWorkspaceView } from "@/application/operations/operations-service";
import type { FinancialWorkspaceView } from "@/application/financial-ops/financial-service";
import type { ProcurementWorkspaceView } from "@/application/procurement/procurement-service";
import type { LegalWorkspaceView } from "@/application/legal/legal-service";
import type { SalesWorkspaceView } from "@/application/sales/sales-service";
import type { PeoplePerformanceWorkspaceView } from "@/application/people-performance/people-performance-service";
import type { AccountingWorkspaceView } from "@/application/accounting/accounting-service";
import type { IntegrationsWorkspaceView } from "@/application/integrations/integrations-service";
import type { DataIntelligenceWorkspace } from "@/application/data-intelligence/data-intelligence-service";
import type { MarketProductWorkspaceView } from "@/application/market-product";
import type { MembershipRole } from "@prisma/client";
import { DEMO_PROJECT } from "@/domain/financial/demo";
import { calculateAllScenarios } from "@/domain/financial/engine";
import { SCENARIOS } from "@/domain/financial/scenarios";
import type { ProjectAssumptions, ScenarioKey } from "@/domain/financial/types";
import { analyzeRisk, type FindingSeverity } from "@/domain/risk/rules";

type ViewKey = "overview" | "assumptions" | "land" | "design" | "budget" | "procurement" | "legal" | "financial" | "accounting" | "integrations" | "sales" | "people" | "scenarios" | "sensitivity" | "redteam" | "committee" | "studio" | "dataroom" | "ai" | "cashflow" | "risks" | "audit" | "dataIntelligence" | "marketIntelligence" | "productIntelligence";
type EditorMode = "create" | "version";

const viewItems: { key: ViewKey; label: string; icon: typeof Gauge }[] = [
  { key: "overview", label: "Visão executiva", icon: LayoutDashboard },
  { key: "assumptions", label: "Premissas", icon: Settings2 },
  { key: "land", label: "Terreno & Potencial", icon: MapPinned },
  { key: "design", label: "Design Intelligence", icon: Layers3 },
  { key: "budget", label: "Orçamento", icon: CircleDollarSign },
  { key: "procurement", label: "Suprimentos e Contratos", icon: ShoppingCart },
  { key: "legal", label: "Jurídico e Diligência", icon: Scale },
  { key: "financial", label: "Financeiro", icon: Landmark },
  { key: "accounting", label: "Contabilidade e Controladoria", icon: BookOpenCheck },
  { key: "integrations", label: "Central de Integrações", icon: Plug },
  { key: "dataIntelligence", label: "Inteligência de Dados", icon: Database },
  { key: "marketIntelligence", label: "Inteligência de Mercado", icon: Radar },
  { key: "productIntelligence", label: "Inteligência de Produto", icon: Boxes },
  { key: "sales", label: "Vendas e Recebíveis", icon: HandCoins },
  { key: "people", label: "Pessoas e Eficiência", icon: Users },
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

/* MetricCard e SectionTitle foram extraídos para src/components/ui/ (Fase 9K.0, plano §C). */

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

/**
 * Áreas carregadas sob demanda (Fase 9K.0, plano §2 e §AS). A Visão Executiva atual (aba
 * "overview") não lê nenhuma delas — ver `src/app/actions/workspace-loader.ts`.
 */
type LazyViewKey = "design" | "budget" | "financial" | "procurement" | "legal" | "sales" | "ai";
const LAZY_VIEW_KEYS: readonly LazyViewKey[] = ["design", "budget", "financial", "procurement", "legal", "sales", "ai"];

interface LazyWorkspaceData {
  design?: DesignWorkspaceView;
  budget?: BudgetWorkspaceView | null;
  operations?: OperationsWorkspaceView;
  financial?: FinancialWorkspaceView;
  procurement?: ProcurementWorkspaceView;
  legal?: LegalWorkspaceView;
  sales?: SalesWorkspaceView;
  ai?: AIBootstrapView;
}

function isLazyViewKey(view: ViewKey): view is LazyViewKey {
  return (LAZY_VIEW_KEYS as readonly string[]).includes(view);
}

export function IntelligenceWorkspace({ initialStudy, initialLand, initialInvestment, initialPeoplePerformance, initialAccounting, initialIntegrations, initialDataIntelligence, initialMarketProduct, operationalContext, role, identity }: { initialStudy: PersistedStudyView; initialLand: LandWorkspaceView; initialInvestment: InvestmentCaseWorkspace; initialPeoplePerformance: PeoplePerformanceWorkspaceView; initialAccounting: AccountingWorkspaceView; initialIntegrations: IntegrationsWorkspaceView; initialDataIntelligence: DataIntelligenceWorkspace; initialMarketProduct: MarketProductWorkspaceView; operationalContext: OperationalContext; role: MembershipRole; identity: WorkspaceIdentity }) {
  const [study, setStudy] = useState<PersistedStudyView>(initialStudy);
  const [landWorkspace, setLandWorkspace] = useState<LandWorkspaceView>(initialLand);
  const [investmentWorkspace, setInvestmentWorkspace] = useState<InvestmentCaseWorkspace>(initialInvestment);
  const [integrationsWorkspace, setIntegrationsWorkspace] = useState<IntegrationsWorkspaceView>(initialIntegrations);
  const [marketProductWorkspace, setMarketProductWorkspace] = useState<MarketProductWorkspaceView>(initialMarketProduct);
  const [project, setProject] = useState<ProjectAssumptions>(initialStudy.assumptions);
  const [scenario, setScenario] = useState<ScenarioKey>("base");
  const [view, setView] = useState<ViewKey>("overview");
  const [editorProject, setEditorProject] = useState<ProjectAssumptions | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("version");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState<string | undefined>();
  const [aiOriginModule, setAiOriginModule] = useState<ViewKey>("overview");

  const [lazyData, setLazyData] = useState<LazyWorkspaceData>({});
  const [lazyLoaded, setLazyLoaded] = useState<Partial<Record<LazyViewKey, boolean>>>({});
  const [lazyError, setLazyError] = useState<Partial<Record<LazyViewKey, string>>>({});

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

  const requestedLazyViews = useRef<Set<LazyViewKey>>(new Set());

  const loadLazyView = useCallback(async (key: LazyViewKey) => {
    requestedLazyViews.current.add(key);
    setLazyError((prev) => (prev[key] === undefined ? prev : { ...prev, [key]: undefined }));
    try {
      switch (key) {
        case "design": {
          const response = await loadDesignWorkspaceAction(study.projectId);
          if (!response.ok) throw new Error(response.error);
          setLazyData((prev) => ({ ...prev, design: response.data }));
          break;
        }
        case "budget": {
          const response = await loadBudgetAreaAction(study.projectId, results.base.metrics.vgv);
          if (!response.ok) throw new Error(response.error);
          setLazyData((prev) => ({ ...prev, budget: response.data.budget, operations: response.data.operations }));
          break;
        }
        case "financial": {
          const response = await loadFinancialWorkspaceAction(study.projectId);
          if (!response.ok) throw new Error(response.error);
          setLazyData((prev) => ({ ...prev, financial: response.data }));
          break;
        }
        case "procurement": {
          const response = await loadProcurementWorkspaceAction(study.projectId);
          if (!response.ok) throw new Error(response.error);
          setLazyData((prev) => ({ ...prev, procurement: response.data }));
          break;
        }
        case "legal": {
          const response = await loadLegalWorkspaceAction(study.projectId);
          if (!response.ok) throw new Error(response.error);
          setLazyData((prev) => ({ ...prev, legal: response.data }));
          break;
        }
        case "sales": {
          const response = await loadSalesWorkspaceAction(study.projectId);
          if (!response.ok) throw new Error(response.error);
          setLazyData((prev) => ({ ...prev, sales: response.data }));
          break;
        }
        case "ai": {
          // Fase 9K.0 (fechamento, gate 3): mesmo projectId do OperationalContext (study.projectId),
          // nunca uma segunda resolução independente dentro do REDE AI.
          const response = await refreshAIBootstrapAction(study.projectId);
          if (!response.ok) throw new Error(response.error);
          setLazyData((prev) => ({ ...prev, ai: response.data }));
          break;
        }
      }
      setLazyLoaded((prev) => ({ ...prev, [key]: true }));
    } catch (error) {
      setLazyError((prev) => ({ ...prev, [key]: error instanceof Error ? error.message : "Não foi possível carregar esta área." }));
    }
  }, [study.projectId, results]);

  useEffect(() => {
    if (!isLazyViewKey(view)) return;
    if (requestedLazyViews.current.has(view)) return;
    void loadLazyView(view);
  }, [view, loadLazyView]);

  const groupedNav = useMemo(() => {
    const byKey = new Map(viewItems.map((item) => [item.key as LegacyViewKey, item]));
    return [...OPERATIONAL_AREAS, ...TRANSVERSAL_AREAS]
      .map((area) => ({ area, items: area.viewKeys.map((key) => byKey.get(key)).filter((item): item is (typeof viewItems)[number] => Boolean(item)) }))
      .filter((group) => group.items.length > 0);
  }, []);

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
    const budgetWorkspace = lazyData.budget;
    if (!budgetWorkspace) return;
    const response = await fetch(`/api/budgets/${budgetWorkspace.id}/items/${itemId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const payload = await response.json() as { success?: boolean; data?: BudgetWorkspaceView; error?: string };
    if (!response.ok || !payload.data) throw new Error(payload.error ?? "Não foi possível atualizar o item.");
    setLazyData((prev) => ({ ...prev, budget: payload.data }));
  }

  async function deleteBudgetItem(itemId: string) {
    const budgetWorkspace = lazyData.budget;
    if (!budgetWorkspace) return;
    const response = await fetch(`/api/budgets/${budgetWorkspace.id}/items/${itemId}`, { method: "DELETE" });
    const payload = await response.json() as { success?: boolean; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Não foi possível excluir o item.");
    const refreshed = await fetch(`/api/budgets/${budgetWorkspace.id}`);
    const refreshedPayload = await refreshed.json() as { data?: BudgetWorkspaceView; error?: string };
    if (!refreshed.ok || !refreshedPayload.data) throw new Error(refreshedPayload.error ?? "Não foi possível recarregar o orçamento.");
    setLazyData((prev) => ({ ...prev, budget: refreshedPayload.data }));
  }

  async function handleGenerateProductScenarios() {
    if (!marketProductWorkspace.marketArea) throw new Error("Nenhuma área de mercado configurada.");
    const response = await generateProductScenariosAction({
      marketAreaId: marketProductWorkspace.marketArea.id,
      landAssetId: marketProductWorkspace.marketArea.landAssetId ?? undefined,
      projectId: marketProductWorkspace.marketArea.projectId ?? undefined,
      standard: "MEDIO",
    });
    if (!response.ok) throw new Error(response.error);
    setMarketProductWorkspace(response.data);
  }

  async function handleDecideProductScenario(scenarioId: string, decision: "APPROVED" | "REJECTED", decisionRationale: string) {
    const response = await decideProductScenarioAction({ scenarioId, decision, decisionRationale });
    if (!response.ok) throw new Error(response.error);
    setMarketProductWorkspace(response.data);
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
          {groupedNav.map(({ area, items }) => (
            <Fragment key={area.id}>
              <div className="ds-nav-group-label">{area.label}</div>
              {items.map((item) => <button key={item.key} className={view === item.key ? "is-active" : ""} onClick={() => item.key === "ai" ? openAI() : navigate(item.key)}><item.icon size={17} /><span>{item.label}</span>{item.key === "risks" && criticalCount > 0 && <b>{criticalCount}</b>}{item.key === "redteam" && redTeamCriticalCount > 0 && <b>{redTeamCriticalCount}</b>}</button>)}
            </Fragment>
          ))}
        </nav>
        <button className="sidebar-module sidebar-ai-live" onClick={() => openAI("Explique este projeto.")}><span>COPILOTO ATIVO</span><Sparkles size={18} /><div><strong>Pergunte ao REDE</strong><small>Contexto estruturado</small></div><span className="soon">AI</span></button>
        <div className="sidebar-footer"><button><Building2 size={17} /><span>{identity.organizationName}</span></button><div className="user-avatar">{initials(identity.userName)}</div></div>
      </aside>

      {sidebarOpen && <button className="sidebar-overlay" aria-label="Fechar menu" onClick={() => setSidebarOpen(false)} />}

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-left"><button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu"><Menu size={20} /></button><span>{operationalContext.company?.name ?? operationalContext.organization.name}</span><i>/</i><strong>{project.projectName}</strong></div>
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
                <div className="panel-heading"><div><span className="eyebrow">PESSOAS E EFICIÊNCIA</span><h2>Capacidade, desvios e ações do empreendimento</h2></div><button className="text-button" onClick={() => setView("people")}>Abrir gestão <ArrowRight size={15} /></button></div>
                <div className="scenario-table compact-table"><div className="table-row table-head"><span>Profissionais</span><span>Equipes</span><span>Alocações</span><span>Desvios ativos</span><span>Ações ativas</span><span>Custo mensal</span></div><div className="table-row"><strong>{initialPeoplePerformance.summary.people}</strong><strong>{initialPeoplePerformance.summary.teams}</strong><strong>{initialPeoplePerformance.summary.allocations}</strong><strong>{initialPeoplePerformance.summary.activeVarianceCases}</strong><strong>{initialPeoplePerformance.summary.activeActions}</strong><strong>{initialPeoplePerformance.summary.totalMonthlyCost === null ? "Restrito" : currency.format(initialPeoplePerformance.summary.totalMonthlyCost)}</strong></div></div>
              </section>

              <section className="panel scenario-strip">
                <div className="panel-heading"><div><span className="eyebrow">CONTABILIDADE E CONTROLADORIA</span><h2>Razão, resultado, estoque, fiscal e fechamento</h2></div><button className="text-button" onClick={() => setView("accounting")}>Abrir contabilidade <ArrowRight size={15} /></button></div>
                <div className="scenario-table compact-table"><div className="table-row table-head"><span>Receita contábil</span><span>Custo reconhecido</span><span>Margem bruta</span><span>Estoque</span><span>Tributos</span><span>Divergências</span></div><div className="table-row"><strong>{currency.format(initialAccounting.summary.recognizedRevenue)}</strong><strong>{currency.format(initialAccounting.summary.accountedCost)}</strong><strong>{currency.format(initialAccounting.summary.grossMargin)}</strong><strong>{currency.format(initialAccounting.summary.inventory)}</strong><strong>{currency.format(initialAccounting.summary.taxesDue)}</strong><strong>{initialAccounting.summary.divergences}</strong></div></div>
              </section>

              <section className="panel scenario-strip">
                <div className="panel-heading"><div><span className="eyebrow">CENTRAL DE INTEGRAÇÕES</span><h2>Conectores, proveniência e sincronização</h2></div><button className="text-button" onClick={() => setView("integrations")}>Abrir integrações <ArrowRight size={15} /></button></div>
                <div className="scenario-table compact-table"><div className="table-row table-head"><span>Instalações</span><span>Críticas</span><span>Atenção</span><span>Conflitos abertos</span><span>Quarentena</span><span>Credenciais expirando</span></div><div className="table-row"><strong>{integrationsWorkspace.summary.installations}</strong><strong>{integrationsWorkspace.summary.criticalInstallations}</strong><strong>{integrationsWorkspace.summary.attentionInstallations}</strong><strong>{integrationsWorkspace.summary.openConflicts}</strong><strong>{integrationsWorkspace.summary.pendingQuarantine}</strong><strong>{integrationsWorkspace.summary.expiringCredentials}</strong></div></div>
              </section>

              <section className="panel scenario-strip">
                <div className="panel-heading"><div><span className="eyebrow">INTELIGÊNCIA DE DADOS</span><h2>Comparativos, previsto x realizado e qualidade dos dados</h2></div><button className="text-button" onClick={() => setView("dataIntelligence")}>Abrir Inteligência de Dados <ArrowRight size={15} /></button></div>
                <div className="scenario-table compact-table"><div className="table-row table-head"><span>Fatos analíticos</span><span>Comparativos</span><span>Confiança do último</span><span>Erro % médio (previsto x realizado)</span><span>Achados de qualidade abertos</span><span>Orçamento Inteligente</span></div><div className="table-row"><strong>{initialDataIntelligence.facts.length}</strong><strong>{initialDataIntelligence.benchmarks.length}</strong><strong>{initialDataIntelligence.benchmarks[0] ? { HIGH: "Alta", MEDIUM: "Média", LOW: "Baixa" }[initialDataIntelligence.benchmarks[0].confidenceLevel] ?? initialDataIntelligence.benchmarks[0].confidenceLevel : "—"}</strong><strong>{initialDataIntelligence.biasSummary.averagePercentError != null ? `${(initialDataIntelligence.biasSummary.averagePercentError * 100).toFixed(1)}%` : "—"}</strong><strong>{initialDataIntelligence.dataQuality.openIssues.length}</strong><strong>{initialDataIntelligence.autoBudgetProposals[0]?.status ?? "—"}</strong></div></div>
              </section>

              <section className="panel scenario-strip">
                <div className="panel-heading"><div><span className="eyebrow">MERCADO LOCAL</span><h2>Preço, pressão competitiva e velocidade da região</h2></div><button className="text-button" onClick={() => setView("marketIntelligence")}>Abrir Inteligência de Mercado <ArrowRight size={15} /></button></div>
                <div className="scenario-table compact-table"><div className="table-row table-head"><span>Preço médio da região</span><span>Estoque ativo</span><span>Velocidade de vendas</span><span>Nível de Confiança</span></div><div className="table-row"><strong>{marketProductWorkspace.overview && marketProductWorkspace.overview.priceStats.median > 0 ? `${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(marketProductWorkspace.overview.priceStats.median)}/m²` : "—"}</strong><strong>{marketProductWorkspace.overview ? marketProductWorkspace.overview.competitors.filter((c) => c.eligible).length : 0} concorrentes</strong><strong>{marketProductWorkspace.overview ? `${number.format(marketProductWorkspace.overview.aggregateVsoPercentage * 100)}% a.m.` : "—"}</strong><strong>{marketProductWorkspace.overview ? { HIGH: "Alta", MEDIUM: "Média", LOW: "Baixa" }[marketProductWorkspace.overview.confidence.level] : "—"}</strong></div></div>
              </section>

              <section className="panel scenario-strip">
                <div className="panel-heading"><div><span className="eyebrow">PRODUTO EM ESTUDO</span><h2>Cenário recomendado, delta de VGV e status de aprovação</h2></div><button className="text-button" onClick={() => setView("productIntelligence")}>Abrir Inteligência de Produto <ArrowRight size={15} /></button></div>
                <div className="scenario-table compact-table"><div className="table-row table-head"><span>Cenário recomendado</span><span>VGV projetado</span><span>Margem projetada</span><span>Status</span></div><div className="table-row"><strong>{marketProductWorkspace.scenarios.find((s) => s.kind === "BASE")?.name ?? "Nenhum cenário gerado"}</strong><strong>{marketProductWorkspace.scenarios.find((s) => s.kind === "BASE") ? compactBrl(marketProductWorkspace.scenarios.find((s) => s.kind === "BASE")!.targetVgv.toString()) : "—"}</strong><strong>{(() => { const base = marketProductWorkspace.scenarios.find((s) => s.kind === "BASE"); const metrics = base?.engineResultsJson as { metrics?: { marginOnVgv?: string } } | null; return metrics?.metrics?.marginOnVgv ? percentage(metrics.metrics.marginOnVgv) : "—"; })()}</strong><strong>{marketProductWorkspace.scenarios.find((s) => s.kind === "BASE") ? { DRAFT: "Rascunho", UNDER_REVIEW: "Em Análise", RECOMMENDED: "Recomendado", APPROVED: "Aprovado", REJECTED: "Rejeitado", SUPERSEDED: "Substituído" }[marketProductWorkspace.scenarios.find((s) => s.kind === "BASE")!.status] : "—"}</strong></div></div>
              </section>

              <section className="panel scenario-strip">
                <div className="panel-heading"><div><span className="eyebrow">DOWNSIDE × UPSIDE</span><h2>Comparação rápida de cenários</h2></div><button className="text-button" onClick={() => setView("scenarios")}>Abrir análise <ArrowRight size={15} /></button></div>
                <div className="scenario-table compact-table"><div className="table-row table-head"><span>Cenário</span><span>VGV</span><span>Lucro</span><span>Margem</span><span>TIR</span><span>Exposição</span></div>{(["conservative", "base", "aggressive"] as ScenarioKey[]).map((key) => { const item = results[key]; return <button key={key} onClick={() => setScenario(key)} className={`table-row ${scenario === key ? "selected" : ""}`}><span><i className={`scenario-dot dot-${key}`} />{SCENARIOS[key].label}</span><strong>{compactBrl(item.metrics.vgv)}</strong><strong>{compactBrl(item.metrics.profit)}</strong><strong>{percentage(item.metrics.marginOnVgv)}</strong><strong>{percentage(item.metrics.annualIrr)}</strong><strong>{compactBrl(item.metrics.maximumCashExposure)}</strong></button>; })}</div>
              </section>
            </div>
          )}

          {view === "assumptions" && <AssumptionSummary project={project} onEdit={() => { setEditorMode("version"); setEditorProject(project); }} />}

          {view === "land" && <LandIntelligenceView initialLand={landWorkspace} onLandChange={(nextLand) => { setLandWorkspace(nextLand); void reassessInvestmentCaseAction(investmentWorkspace.id, study.studyVersionId, nextLand.versionId).then((response) => { if (response.ok) setInvestmentWorkspace(response.data); }); }} />}

          {view === "design" && (
            lazyError.design ? <ErrorState message={lazyError.design} onRetry={() => loadLazyView("design")} /> :
            !lazyLoaded.design || !lazyData.design ? <Loading label="Carregando Design Intelligence…" /> :
            <DesignIntelligenceView initialWorkspace={lazyData.design} onWorkspaceChange={(next) => setLazyData((prev) => ({ ...prev, design: next }))} onAskAI={(prompt) => openAI(prompt)} />
          )}

          {view === "budget" && (
            lazyError.budget ? <ErrorState message={lazyError.budget} onRetry={() => loadLazyView("budget")} /> :
            !lazyLoaded.budget ? <Loading label="Carregando Orçamento e Operações…" /> :
            lazyData.budget ? (
              <div className="view-stack">
                <SectionTitle eyebrow="GESTÃO OPERACIONAL" title="Base Aprovada, Orçamento e Cronograma" description="Referências separadas, versionadas e rastreáveis para a execução do empreendimento." />
                {lazyData.operations && <OperationsView workspace={lazyData.operations} />}
                <SectionTitle eyebrow="ESTRUTURA ANALÍTICA" title={`${lazyData.budget.name} · v${lazyData.budget.version}`} description="Itens persistidos por empreendimento, organização e versão." />
                <BudgetEditor
                  budgetId={lazyData.budget.id}
                  projectName={lazyData.budget.projectName}
                  lineItems={lazyData.budget.lineItems}
                  totalBudget={lazyData.budget.totalBudget}
                  summary={lazyData.budget.summary}
                  onUpdateItem={updateBudgetItem}
                  onDeleteItem={deleteBudgetItem}
                  readOnly={["APPROVED", "OFFICIAL", "SUPERSEDED", "CLOSED", "ARCHIVED"].includes(lazyData.budget.status)}
                />
              </div>
            ) : (
              <EmptyState icon={CircleDollarSign} title="Nenhum orçamento cadastrado" description="Este empreendimento ainda não tem um orçamento oficial cadastrado." />
            )
          )}

          {view === "financial" && (
            lazyError.financial ? <ErrorState message={lazyError.financial} onRetry={() => loadLazyView("financial")} /> :
            !lazyLoaded.financial || !lazyData.financial ? <Loading label="Carregando Financeiro…" /> : (
              <div className="view-stack">
                <SectionTitle eyebrow="FINANCEIRO E TESOURARIA" title="Contas a Pagar, Contas a Receber e Caixa" description="Obrigação → conta → parcela → pagamento → conciliação → realizado, rastreável por SPE e centro de custo." />
                <FinancialView workspace={lazyData.financial} />
              </div>
            )
          )}

          {view === "accounting" && (
            <div className="view-stack">
              <SectionTitle eyebrow="CONTÁBIL, FISCAL E CONTROLADORIA" title="Fato operacional → Política → Razão → Resultado" description="Competência e caixa separados, partidas dobradas, estoque, tributos e consolidação sem criar uma segunda verdade financeira." />
              <AccountingView workspace={initialAccounting} />
            </div>
          )}

          {view === "dataIntelligence" && (
            <div className="view-stack">
              <SectionTitle eyebrow="INTELIGÊNCIA DE DADOS" title="Fato → normalização → comparabilidade → métrica → benchmark → confiança → recomendação → explicação → revisão humana" description="O histórico operacional do REDE vira ativo proprietário: contratos analíticos, métricas versionadas, comparativos com amostra e confiança visíveis, previsto x realizado, qualidade dos dados, carteira de empreendimentos e Orçamento Inteligente — sempre como sugestão, nunca como base aprovada automaticamente." />
              <DataIntelligenceView workspace={initialDataIntelligence} />
            </div>
          )}

          {view === "marketIntelligence" && (
            <div className="view-stack">
              <SectionTitle eyebrow="INTELIGÊNCIA DE MERCADO" title="Área de influência, demografia, renda, oferta e preços" description="Neste terreno e nesta localização: o que o mercado mostra, com proveniência e nível de confiança explícitos." />
              <MarketIntelligenceView workspace={marketProductWorkspace} />
            </div>
          )}

          {view === "productIntelligence" && (
            <div className="view-stack">
              <SectionTitle eyebrow="INTELIGÊNCIA DE PRODUTO" title="O que construir, para quem, em qual configuração e em qual faixa de preço" description="Três cenários sempre comparáveis, simulados no REDE Engine, com decisão humana obrigatória e memória imutável." />
              <ProductIntelligenceView workspace={marketProductWorkspace} role={role} onGenerate={handleGenerateProductScenarios} onDecide={handleDecideProductScenario} />
            </div>
          )}

          {view === "integrations" && (
            <div className="view-stack">
              <SectionTitle eyebrow="CENTRAL DE INTEGRAÇÕES" title="Conectores, sincronização e proveniência" description="Grupo, empresa, SPE e empreendimento em uma visão só: quem é o dono do dado, de onde veio, quando foi atualizado e se está em conflito." />
              <IntegrationsView initialWorkspace={integrationsWorkspace} projectId={study.projectId} onWorkspaceChange={setIntegrationsWorkspace} />
            </div>
          )}

          {view === "procurement" && (
            lazyError.procurement ? <ErrorState message={lazyError.procurement} onRetry={() => loadLazyView("procurement")} /> :
            !lazyLoaded.procurement || !lazyData.procurement ? <Loading label="Carregando Suprimentos…" /> : (
              <div className="view-stack">
                <SectionTitle eyebrow="SUPRIMENTOS, CONTRATOS E MEDIÇÕES" title="Do planejamento à execução contratual" description="Necessidade → requisição → cotação → contrato → medição → obrigação, sem dupla contagem." />
                <ProcurementView workspace={lazyData.procurement} />
              </div>
            )
          )}

          {view === "legal" && (
            lazyError.legal ? <ErrorState message={lazyError.legal} onRetry={() => loadLazyView("legal")} /> :
            !lazyLoaded.legal || !lazyData.legal ? <Loading label="Carregando Jurídico…" /> : (
              <div className="view-stack">
                <SectionTitle eyebrow="JURÍDICO, DILIGÊNCIA E OBRIGAÇÕES" title="Central Jurídica do Empreendimento" description="Imóvel, evidências, riscos, licenças, prazos e impactos conectados à decisão, ao cronograma e ao Financeiro." />
                <LegalView workspace={lazyData.legal} />
              </div>
            )
          )}

          {view === "sales" && (
            lazyError.sales ? <ErrorState message={lazyError.sales} onRetry={() => loadLazyView("sales")} /> :
            !lazyLoaded.sales || !lazyData.sales ? <Loading label="Carregando Vendas e Recebíveis…" /> : (
              <div className="view-stack">
                <SectionTitle eyebrow="VENDAS, CLIENTES E RECEBÍVEIS" title="Unidade → Tabela → Proposta → Reserva → Venda → Contrato → Recebíveis" description="Estoque, preço, comissão, entrega e pós-venda conectados ao Financeiro (9B) sem financeiro paralelo nem dupla contagem." />
                <SalesView workspace={lazyData.sales} />
              </div>
            )
          )}

          {view === "people" && (
            <div className="view-stack">
              <SectionTitle eyebrow="PESSOAS, ADMINISTRAÇÃO E EFICIÊNCIA" title="Estrutura → Capacidade → Desempenho → Causa-raiz → Ação" description="Leitura integrada ao orçamento, cronograma, medições e realizado, com remuneração restrita e economia somente quando validada." />
              <PeoplePerformanceView workspace={initialPeoplePerformance} />
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

          {view === "ai" && (
            lazyError.ai ? <ErrorState message={lazyError.ai} onRetry={() => loadLazyView("ai")} /> :
            !lazyLoaded.ai || !lazyData.ai ? <Loading label="Carregando REDE AI…" /> :
            <RedeAIView initialBootstrap={lazyData.ai} projectId={study.projectId} currentModule={aiOriginModule} initialPrompt={aiPrompt} onPromptConsumed={() => setAiPrompt(undefined)} onNavigate={(module) => navigate(module as ViewKey)} />
          )}

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
