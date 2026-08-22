"use client";

import { useState } from "react";
import { AlertTriangle, BadgeDollarSign, Gauge, Network, ShieldCheck, Target, Users } from "lucide-react";
import type { PeoplePerformanceWorkspaceView } from "@/application/people-performance/people-performance-service";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
type Area = "visao" | "pessoas" | "equipes" | "custos" | "eficiencia" | "causas" | "acoes" | "incentivos";
const areas: Array<{ key: Area; label: string }> = [
  { key: "visao", label: "Visão Geral" },
  { key: "pessoas", label: "Pessoas e Estrutura" },
  { key: "equipes", label: "Equipes e Capacidade" },
  { key: "custos", label: "Custos Administrativos" },
  { key: "eficiencia", label: "Eficiência" },
  { key: "causas", label: "Causa-raiz" },
  { key: "acoes", label: "Ações" },
  { key: "incentivos", label: "Incentivos" },
];

const labels: Record<string, string> = {
  ACTIVE: "Ativo", CLOSED: "Encerrado", DRAFT: "Rascunho", COMPLETED: "Concluído", VERIFIED: "Verificado", BLOCKED: "Bloqueado",
  UNCLASSIFIED: "Não classificado", UNDER_ANALYSIS: "Em análise", CLASSIFIED: "Classificado", VALIDATED: "Validado", CALCULATED: "Calculada",
  HIGH: "Alta", MEDIUM: "Média", LOW: "Baixa", CRITICAL: "Crítica", EMPLOYEE: "Empregado", CONTRACTOR: "Prestador", PARTNER: "Sócio",
  INTERN: "Estagiário", TEMPORARY: "Temporário", OUTSOURCED: "Terceirizado", PERCENTAGE: "Percentual", HOURS: "Horas", FIXED_AMOUNT: "Valor fixo",
};

function Status({ value }: { value: string }) { return <span className="status-pill">{labels[value] ?? value.replaceAll("_", " ")}</span>; }

export function PeoplePerformanceView({ workspace }: { workspace: PeoplePerformanceWorkspaceView }) {
  const [area, setArea] = useState<Area>("visao");
  const actions = workspace.varianceCases.flatMap((item) => item.investigation?.actions ?? []);
  return <div className="view-stack">
    <div className="scenario-switch" aria-label="Áreas de Pessoas e Eficiência">{areas.map((item) => <button key={item.key} className={area === item.key ? "is-active" : ""} onClick={() => setArea(item.key)}>{item.label}</button>)}</div>

    {area === "visao" && <>
      <section className="metrics-grid">
        <article className="metric-card"><div><span>Profissionais ativos</span><Users size={17} /></div><strong>{workspace.summary.people}</strong><small>{workspace.summary.departments} departamentos · {workspace.summary.positions} cargos</small></article>
        <article className="metric-card"><div><span>Equipes</span><Network size={17} /></div><strong>{workspace.summary.teams}</strong><small>{workspace.summary.allocations} alocações vigentes</small></article>
        <article className="metric-card"><div><span>Desvios em aberto</span><AlertTriangle size={17} /></div><strong>{workspace.summary.activeVarianceCases}</strong><small>{workspace.summary.activeActions} ações em curso</small></article>
        <article className="metric-card"><div><span>Custo mensal</span><BadgeDollarSign size={17} /></div><strong>{workspace.summary.totalMonthlyCost === null ? "Restrito" : brl.format(workspace.summary.totalMonthlyCost)}</strong><small>{workspace.permissions.canViewCompensation ? "Acesso autorizado" : "Dados individuais protegidos por capacidade"}</small></article>
      </section>
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">CADEIA DE DESEMPENHO</span><h2>Base Aprovada → Projeção → Medido → Realizado → Causa → Ação</h2></div></div><div className="scenario-table">
        <div className="table-row table-head"><span>Controle</span><span>Quantidade</span><span>Regra</span></div>
        <div className="table-row"><strong>Desvios em análise</strong><span>{workspace.summary.activeVarianceCases}</span><span>Desembolso menor não é economia sem avanço físico equivalente</span></div>
        <div className="table-row"><strong>Ações ativas</strong><span>{workspace.summary.activeActions}</span><span>Conclusão exige evidência; verificação é segregada</span></div>
        <div className="table-row"><strong>Simulações de incentivo</strong><span>{workspace.incentive.simulations.length}</span><span>Somente sobre economia validada na Fase 9C; nenhum pagamento é criado</span></div>
      </div></article>
    </>}

    {area === "pessoas" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">ESTRUTURA ORGANIZACIONAL</span><h2>Pessoas, vínculos históricos, cargos e departamentos</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Profissional</th><th>Empresa</th><th>Departamento</th><th>Cargo</th><th>Vínculo</th><th>Jornada</th><th>Custo mensal</th></tr></thead><tbody>{workspace.people.map((item) => <tr key={item.relationshipId}><td><strong>{item.name}</strong></td><td>{item.company}</td><td>{item.department}</td><td>{item.position}</td><td>{labels[item.relationshipType] ?? item.relationshipType}</td><td>{item.weeklyHours === null ? "—" : `${item.weeklyHours} h/sem.`}</td><td>{item.monthlyCost === null ? <span className="status-pill"><ShieldCheck size={12} /> Restrito</span> : brl.format(item.monthlyCost)}</td></tr>)}</tbody></table></div></article>}

    {area === "equipes" && <>
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">EQUIPES</span><h2>Composição vigente</h2></div></div>{workspace.teams.map((team) => <div className="model-note" key={team.id}><Network size={20} /><div><strong>{team.code} · {team.name}</strong><p>{team.members.join(", ") || "Sem integrantes"}</p><Status value={team.type} /></div></div>)}</article>
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">CAPACIDADE</span><h2>Alocações por empreendimento, centro de custo e atividade</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Profissional</th><th>Equipe</th><th>Centro de custo</th><th>Atividade</th><th>Critério</th><th>Alocação</th></tr></thead><tbody>{workspace.allocations.map((item) => <tr key={item.id}><td><strong>{item.person}</strong></td><td>{item.team ?? "—"}</td><td>{item.costCenter ?? "—"}</td><td>{item.scheduleActivity ?? "—"}</td><td>{labels[item.criterion] ?? item.criterion}</td><td className={item.overAllocated ? "negative-value" : ""}>{item.rate !== null ? percent.format(item.rate) : item.hours !== null ? `${item.hours} h` : "Valor fixo"}{item.overAllocated ? " · justificada" : ""}</td></tr>)}</tbody></table></div></article>
    </>}

    {area === "custos" && <><div className="model-note"><ShieldCheck size={20} /><div><strong>Remuneração individual protegida</strong><p>Custos individuais só são retornados para capacidades administrativas. A auditoria registra alteração sem copiar valores sensíveis.</p></div></div><article className="panel"><div className="panel-heading"><div><span className="eyebrow">ADMINISTRAÇÃO</span><h2>Planejado, realizado e rateio rastreável</h2></div></div><div className="scenario-table"><div className="table-row table-head"><span>Plano</span><span>Planejado</span><span>Realizado</span><span>Rateio</span></div>{workspace.administrativeCosts.map((item) => <div className="table-row" key={item.id}><strong>{item.name} · v{item.version}</strong><span>{brl.format(item.planned)}</span><span>{brl.format(item.actual)}</span><span>{item.latestProofZero === null ? "Não executado" : item.latestProofZero ? "Prova de zero confirmada" : `Residual ${brl.format(item.latestResidual ?? 0)}`}</span></div>)}</div></article></>}

    {area === "eficiencia" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">EFICIÊNCIA COM EVIDÊNCIA</span><h2>Planejado, comprometido, medido, realizado e projeção</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Caso</th><th>Planejado</th><th>Realizado</th><th>Avanço planejado</th><th>Avanço real</th><th>Desvio de caixa</th><th>Economia?</th><th>Situação</th></tr></thead><tbody>{workspace.varianceCases.map((item) => <tr key={item.id}><td><strong>{item.code}</strong><small> · {item.title}</small></td><td>{brl.format(item.plannedAmount)}</td><td>{brl.format(item.actualAmount)}</td><td>{percent.format(item.plannedProgress)}</td><td>{percent.format(item.actualProgress)}</td><td>{brl.format(item.cashVariance)}</td><td className={item.savingEligible ? "positive-value" : "negative-value"}>{item.savingEligible ? "Validada" : "Não"}</td><td><Status value={item.status} /></td></tr>)}</tbody></table></div></article>}

    {area === "causas" && <div className="view-stack">{workspace.varianceCases.map((item) => <article className="panel" key={item.id}><div className="panel-heading"><div><span className="eyebrow">{item.code} · {labels[item.status] ?? item.status}</span><h2>{item.title}</h2></div><strong>{item.investigation ? percent.format(item.investigation.allocatedCauseRate) : "0%"} explicado</strong></div>{item.investigation ? <><div className="model-note"><Target size={20} /><div><strong>Problema investigado</strong><p>{item.investigation.problemStatement}</p></div></div><div className="scenario-table"><div className="table-row table-head"><span>Hipótese</span><span>Categoria</span><span>Confiança</span><span>Evidências</span></div>{item.investigation.hypotheses.map((hypothesis) => <div className="table-row" key={hypothesis.id}><strong>{hypothesis.description}</strong><span>{labels[hypothesis.category] ?? hypothesis.category}</span><Status value={hypothesis.confidence} /><span>{hypothesis.evidence}</span></div>)}</div></> : <div className="empty-state">Investigação ainda não iniciada.</div>}</article>)}</div>}

    {area === "acoes" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">PLANO DE AÇÃO</span><h2>Responsabilidade, prazo, estado e evidência</h2></div></div><div className="scenario-table"><div className="table-row table-head"><span>Ação</span><span>Prioridade</span><span>Prazo</span><span>Evidências</span><span>Situação</span></div>{actions.map((item) => <div className="table-row" key={item.id}><strong>{item.title}</strong><Status value={item.priority} /><span>{item.dueDate ? new Date(item.dueDate).toLocaleDateString("pt-BR") : "—"}</span><span>{item.evidence}</span><Status value={item.status} /></div>)}</div></article>}

    {area === "incentivos" && <><div className="model-note"><Gauge size={20} /><div><strong>Simulação, não folha nem pagamento</strong><p>O pool usa exclusivamente `ValidatedSaving`, desconta implementação/reversões e aplica a política versionada. O valor pagável permanece zero nesta fase.</p></div></div><article className="panel"><div className="panel-heading"><div><span className="eyebrow">SIMULAÇÕES</span><h2>Economia validada → base elegível → pool simulado</h2></div></div><div className="scenario-table"><div className="table-row table-head"><span>Simulação</span><span>Política</span><span>Economia validada</span><span>Base elegível</span><span>Pool</span><span>Pagamento</span></div>{workspace.incentive.simulations.map((item) => <div className="table-row" key={item.id}><strong>{item.name}</strong><span>{item.policy}</span><span>{brl.format(item.validatedSavingAmount)}</span><span>{brl.format(item.eligibleBase)}</span><span>{brl.format(item.simulatedPool)}</span><span>{item.paymentCreated ? "Criado" : "Não criado"}</span></div>)}</div></article></>}
  </div>;
}
