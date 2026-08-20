"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, ChevronRight, CircleDollarSign, Landmark, Network, TrendingUp } from "lucide-react";
import type { OperationsWorkspaceView } from "@/application/operations/operations-service";
import { createBudgetRevisionAction, justifyBudgetVarianceAction } from "@/app/actions/operations";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const month = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" });

function statusLabel(status: string) {
  return ({ PREPARING: "Em preparação", UNDER_APPROVAL: "Em aprovação", APPROVED: "Aprovada", SUPERSEDED: "Substituída", DRAFT: "Rascunho", OFFICIAL: "Oficial", CLOSED: "Encerrado", UNDER_REVIEW: "Em revisão" } as Record<string, string>)[status] ?? status;
}

function levelLabel(level: string) {
  return ({ INFORMATIVO: "Informativo", ATENCAO: "Atenção", RELEVANTE: "Relevante", CRITICO: "Crítico" } as Record<string, string>)[level] ?? level;
}

export function OperationsView({ workspace }: { workspace: OperationsWorkspaceView }) {
  const router = useRouter();
  const [section, setSection] = useState<"ponte" | "cronograma" | "estrutura">("ponte");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const maxOutflow = useMemo(() => Math.max(1, ...workspace.cashFlow.map((row) => row.outflow)), [workspace.cashFlow]);
  const difference = (workspace.budget?.total ?? 0) - (workspace.baseline?.total ?? 0);
  const differencePercentage = workspace.baseline?.total ? (difference / workspace.baseline.total) * 100 : 0;
  const criticalItems = workspace.bridge.filter((row) => row.level === "CRITICO" || row.level === "RELEVANTE").length;

  async function createRevision() {
    if (!workspace.budget) return;
    const reason = window.prompt("Informe o motivo formal da revisão do Orçamento Oficial:");
    if (!reason) return;
    setBusy(true); setFeedback(null);
    const result = await createBudgetRevisionAction(workspace.budget.id, reason);
    setBusy(false);
    if (!result.ok) return setFeedback(result.error);
    setFeedback(`Orçamento Revisado v${result.data.version} criado como rascunho.`);
    router.refresh();
  }

  async function justify(row: OperationsWorkspaceView["bridge"][number]) {
    if (!workspace.budget) return;
    const reason = window.prompt(`Justificativa para o desvio em ${row.category}:`);
    if (!reason) return;
    setBusy(true); setFeedback(null);
    const result = await justifyBudgetVarianceAction({ budgetId: workspace.budget.id, category: row.category, reason, baselineValue: row.baseline, budgetValue: row.budget });
    setBusy(false);
    setFeedback(result.ok ? "Justificativa registrada na trilha de auditoria." : result.error);
  }

  return (
    <div className="operations-module">
      {feedback && <div className="model-note" role="status"><div><strong>Gestão operacional</strong><p>{feedback}</p></div></div>}
      <div className="operations-kpis">
        <button onClick={() => setSection("ponte")}><Landmark size={18} /><span>Base Aprovada</span><strong>{workspace.baseline ? money.format(workspace.baseline.total) : "Não criada"}</strong><small>{workspace.baseline ? `${statusLabel(workspace.baseline.status)} · v${workspace.baseline.version}` : "Aguardando aprovação"}</small></button>
        <button onClick={() => setSection("ponte")}><CircleDollarSign size={18} /><span>Orçamento Oficial</span><strong>{workspace.budget ? money.format(workspace.budget.total) : "Não criado"}</strong><small>{workspace.budget ? `${statusLabel(workspace.budget.status)} · v${workspace.budget.version}` : "Aguardando Base"}</small></button>
        <button onClick={() => setSection("ponte")}><TrendingUp size={18} /><span>Diferença vs Base</span><strong className={difference > 0 ? "operation-negative" : "operation-positive"}>{difference >= 0 ? "+" : ""}{money.format(difference)}</strong><small>{differencePercentage >= 0 ? "+" : ""}{percent.format(differencePercentage)}%</small></button>
        <button onClick={() => setSection("cronograma")}><CalendarRange size={18} /><span>Prazo planejado</span><strong>{workspace.indicators.durationMonths} meses</strong><small>{workspace.schedule ? statusLabel(workspace.schedule.status) : "Cronograma não criado"}</small></button>
        <button onClick={() => setSection("cronograma")}><CircleDollarSign size={18} /><span>Próximos 90 dias</span><strong>{money.format(workspace.indicators.next90Days)}</strong><small>Fluxo projetado</small></button>
        <button onClick={() => setSection("cronograma")}><TrendingUp size={18} /><span>Maior desembolso</span><strong>{money.format(workspace.indicators.peakOutflow)}</strong><small>{workspace.indicators.peakPeriod ? month.format(new Date(`${workspace.indicators.peakPeriod}-01T00:00:00Z`)) : "Sem distribuição"}</small></button>
      </div>

      <nav className="operations-tabs" aria-label="Visões operacionais">
        <button className={section === "ponte" ? "active" : ""} onClick={() => setSection("ponte")}>Ponte do Orçamento</button>
        <button className={section === "cronograma" ? "active" : ""} onClick={() => setSection("cronograma")}>Cronograma Físico-Financeiro</button>
        <button className={section === "estrutura" ? "active" : ""} onClick={() => setSection("estrutura")}>Estrutura Operacional</button>
      </nav>

      {section === "ponte" && <section className="operations-panel">
        <header><div><span className="eyebrow">RASTREABILIDADE ECONÔMICA</span><h3>Base Aprovada × Orçamento Oficial</h3><p>{criticalItems} categoria(s) com desvio relevante ou crítico, conforme política da organização.</p></div>{workspace.budget?.status === "OFFICIAL" && <button className="button button-secondary" disabled={busy} onClick={createRevision}>Criar revisão</button>}</header>
        <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Categoria</th><th>Base Aprovada</th><th>Orçamento Oficial</th><th>Diferença</th><th>Desvio</th><th>Materialidade</th><th>Explicação</th></tr></thead><tbody>
          {workspace.bridge.map((row) => <tr key={row.category}><td><strong>{row.category}</strong></td><td>{money.format(row.baseline)}</td><td>{money.format(row.budget)}</td><td className={row.difference > 0 ? "operation-negative" : "operation-positive"}>{row.difference >= 0 ? "+" : ""}{money.format(row.difference)}</td><td>{row.percentage === null ? "Nova verba" : `${row.percentage >= 0 ? "+" : ""}${percent.format(row.percentage)}%`}</td><td><span className={`materiality materiality-${row.level.toLowerCase()}`}>{levelLabel(row.level)}</span></td><td><button className="text-button" disabled={busy} onClick={() => justify(row)}>Justificar</button></td></tr>)}
          {workspace.bridge.length === 0 && <tr><td colSpan={7} className="operations-empty">Crie a Base Aprovada e o Orçamento Oficial para visualizar a ponte.</td></tr>}
        </tbody><tfoot><tr><td>Total</td><td>{money.format(workspace.baseline?.total ?? 0)}</td><td>{money.format(workspace.budget?.total ?? 0)}</td><td>{money.format(difference)}</td><td>{percent.format(differencePercentage)}%</td><td>Prova-zero</td><td>Auditável</td></tr></tfoot></table></div>
      </section>}

      {section === "cronograma" && <section className="operations-panel">
        <header><div><span className="eyebrow">CICLO COMPLETO</span><h3>Curva de desembolso planejado</h3><p>Avanço físico e desembolso financeiro são armazenados separadamente por atividade.</p></div></header>
        <div className="disbursement-chart" role="img" aria-label="Desembolso mensal planejado">
          {workspace.cashFlow.map((row) => <div className="disbursement-column" key={row.period}><div className="disbursement-value">{money.format(row.outflow)}</div><div className="disbursement-track"><span style={{ height: `${Math.max(3, (row.outflow / maxOutflow) * 100)}%` }} /></div><small>{month.format(new Date(`${row.period}-01T00:00:00Z`))}</small></div>)}
          {workspace.cashFlow.length === 0 && <div className="operations-empty">Aprove o Orçamento Oficial e crie o cronograma para gerar o fluxo projetado.</div>}
        </div>
        {workspace.cashFlow.length > 0 && <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Mês</th><th>Entradas previstas</th><th>Saídas previstas</th><th>Saldo do mês</th><th>Acumulado</th></tr></thead><tbody>{workspace.cashFlow.map((row) => <tr key={row.period}><td>{month.format(new Date(`${row.period}-01T00:00:00Z`))}</td><td>{money.format(row.inflow)}</td><td>{money.format(row.outflow)}</td><td>{money.format(row.net)}</td><td>{money.format(row.accumulated)}</td></tr>)}</tbody></table></div>}
      </section>}

      {section === "estrutura" && <section className="operations-panel">
        <header><div><span className="eyebrow">ESTRUTURA OPERACIONAL</span><h3>{workspace.structure?.projectName ?? "Empreendimento"}</h3><p>{workspace.structure?.company ? `${workspace.structure.company.name} · ${workspace.structure.company.groupName ?? "Grupo não informado"}` : "SPE ainda não vinculada"}</p></div></header>
        <div className="operations-structure">
          <article><Network size={20} /><h4>Fases, torres e etapas</h4>{workspace.structure?.operatingUnits.map((unit) => <div key={unit.id}><span>{unit.code}</span><strong>{unit.name}</strong><small>{unit.type}</small><ChevronRight size={14} /></div>)}{!workspace.structure?.operatingUnits.length && <p>Nenhuma unidade operacional cadastrada.</p>}</article>
          <article><CircleDollarSign size={20} /><h4>Centros de Custo</h4>{workspace.structure?.costCenters.map((center) => <div key={center.id}><span>{center.code}</span><strong>{center.name}</strong><small>{center.managerialAccount ?? "Conta gerencial a definir"}</small><ChevronRight size={14} /></div>)}{!workspace.structure?.costCenters.length && <p>Nenhum centro de custo cadastrado.</p>}</article>
        </div>
      </section>}
    </div>
  );
}
