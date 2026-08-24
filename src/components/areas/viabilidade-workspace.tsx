"use client";

/**
 * Fase 9K.1 — área Viabilidade (ordem de serviço §3): "abrir um ambiente que concentre tudo que o
 * usuário precisa para conduzir a viabilidade" — terreno, estudo, premissas, cenário, viabilidade,
 * investimento, score/sensibilidade e decisão em um único lugar, com sub-navegação por `?f=`
 * (ordem de serviço §5), não em abas técnicas desconectadas.
 *
 * Conteúdo idêntico ao que já existia em `intelligence-workspace.tsx` para estas 11 abas (land,
 * assumptions, scenarios, sensitivity, redteam, committee, studio, dataroom, cashflow, risks,
 * audit) — só a casca de navegação mudou. O motor de viabilidade não foi redesenhado.
 *
 * "Novo estudo" (criar um empreendimento do zero) e "Editar premissas" (nova versão do estudo
 * atual) migraram do topbar global (legado) para cá, porque é aqui que `study`/`investmentWorkspace`
 * /`landWorkspace` já estão carregados — evita reintroduzir o bootstrap de 15 workspaces que a
 * 9K.0 desmontou. Documentado no relatório de entrega da 9K.1.
 */
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, BarChart3, Check, ClipboardCheck, Plus, Settings2 } from "lucide-react";
import { CashFlowChart } from "@/components/cash-flow-chart";
import { LandIntelligenceView } from "@/components/land-intelligence-view";
import { InvestmentSuiteView } from "@/components/investment-suite-view";
import { ProjectEditor } from "@/components/project-editor";
import { RedTeamView } from "@/components/red-team-view";
import { SensitivityView } from "@/components/sensitivity-view";
import { SectionTitle, Tabs } from "@/components/ui";
import { createStudyAction, createStudyVersionAction } from "@/app/actions/studies";
import { reassessInvestmentCaseAction } from "@/app/actions/investment";
import { analyzeRisk } from "@/domain/risk/rules";
import { calculateAllScenarios } from "@/domain/financial/engine";
import { DEMO_PROJECT } from "@/domain/financial/demo";
import { SCENARIOS } from "@/domain/financial/scenarios";
import type { ProjectAssumptions, ScenarioKey } from "@/domain/financial/types";
import type { PersistedStudyView } from "@/application/studies/contracts";
import type { LandWorkspaceView } from "@/domain/land";
import type { InvestmentCaseWorkspace } from "@/domain/investment";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const compactCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const brl = (value: string) => currency.format(Number(value));
const compactBrl = (value: string) => compactCurrency.format(Number(value));
const percentage = (value: string | null) => (value === null ? "—" : `${number.format(Number(value) * 100)}%`);

type Funcao = "land" | "assumptions" | "scenarios" | "sensitivity" | "redteam" | "committee" | "studio" | "dataroom" | "cashflow" | "risks" | "audit";

const FUNCOES: { key: Funcao; label: string }[] = [
  { key: "land", label: "Terreno" },
  { key: "assumptions", label: "Premissas" },
  { key: "scenarios", label: "Cenários" },
  { key: "sensitivity", label: "Sensibilidade" },
  { key: "redteam", label: "Red Team" },
  { key: "committee", label: "Comitê" },
  { key: "studio", label: "Studio" },
  { key: "dataroom", label: "Data Room" },
  { key: "cashflow", label: "Fluxo de caixa" },
  { key: "risks", label: "Riscos" },
  { key: "audit", label: "Trilha de cálculo" },
];

type EditorMode = "create" | "version";

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

export function ViabilidadeWorkspace({
  initialStudy,
  initialLand,
  initialInvestment,
}: {
  initialStudy: PersistedStudyView;
  initialLand: LandWorkspaceView;
  initialInvestment: InvestmentCaseWorkspace;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const funcaoParam = searchParams.get("f") as Funcao | null;
  const funcao: Funcao = funcaoParam && FUNCOES.some((item) => item.key === funcaoParam) ? funcaoParam : "land";

  const [study, setStudy] = useState(initialStudy);
  const [landWorkspace, setLandWorkspace] = useState(initialLand);
  const [investmentWorkspace, setInvestmentWorkspace] = useState(initialInvestment);
  const [project, setProject] = useState<ProjectAssumptions>(initialStudy.assumptions);
  const [scenario, setScenario] = useState<ScenarioKey>("base");
  const [editorProject, setEditorProject] = useState<ProjectAssumptions | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("version");

  const results = useMemo(() => calculateAllScenarios(project), [project]);
  const result = results[scenario];
  const score = study.analytics.scores[scenario];
  const recommendation = useMemo(() => analyzeRisk(result), [result]);
  const criticalCount = recommendation.findings.filter((item) => item.severity === "critical").length;
  const warningCount = recommendation.findings.filter((item) => item.severity === "warning").length;
  const decisionTone = recommendation.status === "NAO_AVANCAR" ? "decision-critical" : recommendation.status === "AVANCAR_COM_AJUSTES" ? "decision-warning" : "decision-positive";

  function setFuncao(next: Funcao) {
    router.replace(`/viabilidade?f=${next}`, { scroll: false });
  }

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
    router.refresh();
  }

  return (
    <div className="view-stack">
      <SectionTitle
        eyebrow="VIABILIDADE"
        title="Terreno, premissas, cenários e decisão em um só lugar"
        description="Engine, score, sensibilidade, Red Team, comitê, Studio, Data Room, fluxo de caixa e trilha de cálculo — reorganizados, não redesenhados."
        action={
          <button className="button button-secondary" onClick={() => { setEditorMode("create"); setEditorProject({ ...structuredClone(DEMO_PROJECT), projectName: "Novo empreendimento", city: "", state: "SP", landPrice: "0", financingLimit: "0" }); }}>
            <Plus size={16} /> Novo estudo
          </button>
        }
      />

      <Tabs items={FUNCOES.map((item) => ({ key: item.key, label: item.label }))} activeKey={funcao} onChange={(key) => setFuncao(key as Funcao)} />

      {funcao !== "land" && (
        <div className="scenario-switch" aria-label="Cenário ativo">
          {(["conservative", "base", "aggressive"] as ScenarioKey[]).map((key) => <button key={key} className={scenario === key ? "is-active" : ""} onClick={() => setScenario(key)}>{SCENARIOS[key].label}</button>)}
        </div>
      )}

      {funcao === "land" && (
        <LandIntelligenceView
          initialLand={landWorkspace}
          onLandChange={(nextLand) => {
            setLandWorkspace(nextLand);
            void reassessInvestmentCaseAction(investmentWorkspace.id, study.studyVersionId, nextLand.versionId).then((response) => {
              if (response.ok) setInvestmentWorkspace(response.data);
            });
          }}
        />
      )}

      {funcao === "assumptions" && <AssumptionSummary project={project} onEdit={() => { setEditorMode("version"); setEditorProject(project); }} />}

      {funcao === "scenarios" && (
        <div className="view-stack">
          <SectionTitle eyebrow="CENÁRIOS PADRÃO" title="O projeto sob três condições" description="Deltas documentados e aplicados sobre o mesmo caso base." />
          <div className="scenario-cards">
            {(["conservative", "base", "aggressive"] as ScenarioKey[]).map((key) => {
              const item = results[key];
              const rec = analyzeRisk(item);
              return (
                <article key={key} className={`scenario-card ${scenario === key ? "is-selected" : ""}`} onClick={() => setScenario(key)}>
                  <div className="scenario-card-head"><span className={`scenario-icon scenario-${key}`}><BarChart3 size={19} /></span><div><span className="eyebrow">CENÁRIO</span><h3>{SCENARIOS[key].label}</h3></div>{scenario === key && <span className="active-label"><Check size={13} /> ATIVO</span>}</div>
                  <p>{SCENARIOS[key].description}</p>
                  <div className="scenario-deltas">{SCENARIOS[key].changes.map((change) => <span key={change}>{change}</span>)}</div>
                  <dl><div><dt>VGV</dt><dd>{compactBrl(item.metrics.vgv)}</dd></div><div><dt>Lucro</dt><dd>{compactBrl(item.metrics.profit)}</dd></div><div><dt>Margem</dt><dd>{percentage(item.metrics.marginOnVgv)}</dd></div><div><dt>Exposição</dt><dd>{compactBrl(item.metrics.maximumCashExposure)}</dd></div></dl>
                  <footer className={rec.status === "NAO_AVANCAR" ? "critical" : "warning"}>{rec.label}</footer>
                </article>
              );
            })}
          </div>
          <article className="panel">
            <div className="panel-heading"><div><span className="eyebrow">COMPARATIVO</span><h2>Indicadores por cenário</h2></div></div>
            <div className="scenario-table">
              <div className="table-row table-head"><span>Indicador</span><span>Conservador</span><span>Base</span><span>Agressivo</span></div>
              {[
                ["VGV", "vgv", compactBrl], ["Receita líquida", "netRevenue", compactBrl], ["Custo total", "totalCost", compactBrl], ["Lucro", "profit", compactBrl], ["Margem / VGV", "marginOnVgv", percentage], ["ROI", "roi", percentage], ["TIR anual", "annualIrr", percentage], ["VPL", "npv", compactBrl], ["Exposição máxima", "maximumCashExposure", compactBrl],
              ].map(([label, metric, formatter]) => (
                <div className="table-row" key={label as string}>
                  <strong>{label as string}</strong>
                  {(["conservative", "base", "aggressive"] as ScenarioKey[]).map((key) => <span key={key}>{(formatter as (value: string | null) => string)(results[key].metrics[metric as keyof typeof result.metrics] as string | null)}</span>)}
                </div>
              ))}
            </div>
          </article>
        </div>
      )}

      {funcao === "sensitivity" && <SensitivityView sensitivity={study.analytics.sensitivity} score={score} scoreScenarioLabel={SCENARIOS[scenario].label} />}

      {funcao === "redteam" && <RedTeamView report={study.redTeam} />}

      {funcao === "committee" && <InvestmentSuiteView mode="committee" initialWorkspace={investmentWorkspace} onWorkspaceChange={setInvestmentWorkspace} />}

      {funcao === "studio" && <InvestmentSuiteView mode="studio" initialWorkspace={investmentWorkspace} onWorkspaceChange={setInvestmentWorkspace} />}

      {funcao === "dataroom" && <InvestmentSuiteView mode="dataroom" initialWorkspace={investmentWorkspace} onWorkspaceChange={setInvestmentWorkspace} />}

      {funcao === "cashflow" && (
        <div className="view-stack">
          <SectionTitle eyebrow={`CENÁRIO ${result.scenarioLabel.toUpperCase()}`} title="Fluxo de caixa mensal" description="Valores do projeto antes e depois do funding. Passe para outro cenário no seletor acima." />
          <article className="panel"><CashFlowChart rows={result.cashFlow} /></article>
          <article className="panel flow-table-panel">
            <div className="data-table-scroll">
              <table className="data-table">
                <thead><tr><th>Mês</th><th>Fase</th><th>Vendas</th><th>Recebimentos</th><th>Obra + ind.</th><th>Custos comerciais</th><th>Fluxo operacional</th><th>Funding</th><th>Fluxo equity</th><th>Acum. equity</th></tr></thead>
                <tbody>
                  {result.cashFlow.map((row) => (
                    <tr key={row.month}>
                      <td>M{row.month}</td>
                      <td><span className={`phase phase-${row.phase}`}>{row.phase}</span></td>
                      <td>{row.unitsSold === "0" ? "—" : `${number.format(Number(row.unitsSold))} un.`}</td>
                      <td>{compactBrl(row.receipts)}</td>
                      <td>{compactCurrency.format(Number(row.constructionCost) + Number(row.indirectCosts))}</td>
                      <td>{compactCurrency.format(Number(row.marketing) + Number(row.commission) + Number(row.taxes))}</td>
                      <td className={Number(row.operatingNet) < 0 ? "negative-value" : "positive-value"}>{compactBrl(row.operatingNet)}</td>
                      <td>{Number(row.financingDraw) > 0 ? compactBrl(row.financingDraw) : "—"}</td>
                      <td className={Number(row.equityFlow) < 0 ? "negative-value" : "positive-value"}>{compactBrl(row.equityFlow)}</td>
                      <td>{compactBrl(row.cumulativeEquityCash)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      )}

      {funcao === "risks" && (
        <div className="view-stack">
          <SectionTitle eyebrow="REGRAS DETERMINÍSTICAS" title="Riscos, evidências e ações" description="Primeira camada objetiva antes do REDE Red Team. Não substitui revisão profissional." />
          <section className={`recommendation-card ${decisionTone}`}><div><span className="eyebrow">RECOMENDAÇÃO</span><h2>{recommendation.label}</h2><p>Motivo dominante: {recommendation.dominantReason}.</p></div><div className="recommendation-count"><strong>{criticalCount + warningCount}</strong><span>pontos para revisão</span></div></section>
          <div className="risk-cards">
            {recommendation.findings.map((finding) => (
              <article key={finding.id} className={`risk-card ${finding.severity === "critical" ? "critical" : finding.severity === "warning" ? "warning" : "positive"}`}>
                <header><span className="risk-icon">{finding.severity === "positive" ? <Check size={18} /> : <AlertTriangle size={18} />}</span><div><span>{finding.category.toUpperCase()} · {finding.classification.toUpperCase()}</span><h3>{finding.title}</h3></div></header>
                <div className="risk-evidence"><strong>Evidência</strong><p>{finding.evidence}</p></div>
                <div className="risk-action"><strong>Ação recomendada</strong><p>{finding.action}</p></div>
              </article>
            ))}
          </div>
        </div>
      )}

      {funcao === "audit" && (
        <div className="view-stack">
          <SectionTitle eyebrow="CALCULATION AUDIT TRAIL" title="Como cada número foi formado" description={`Engine ${result.engineVersion} · cenário ${result.scenarioLabel} · ${result.auditTrail.length} fórmulas essenciais rastreadas.`} />
          <div className="audit-list">
            {result.auditTrail.map((item, index) => (
              <article className="audit-card" key={item.id}>
                <span className="audit-index">{String(index + 1).padStart(2, "0")}</span>
                <div className="audit-main">
                  <div className="audit-title"><div><span>{item.classification.toUpperCase()}</span><h3>{item.label}</h3></div><strong>{item.result}</strong></div>
                  <div className="formula"><code>{item.formula}</code></div>
                  <div className="audit-inputs">{item.inputs.map((input) => <div key={input.label}><span>{input.label} · {input.source}</span><strong>{input.value}</strong></div>)}</div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {editorProject && <ProjectEditor initial={editorProject} onClose={() => setEditorProject(null)} onSave={saveProject} />}
    </div>
  );
}
