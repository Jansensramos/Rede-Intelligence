"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, CirclePlus, UserPlus, Wrench } from "lucide-react";
import type { PeoplePerformanceWorkspaceView } from "@/application/people-performance/people-performance-service";
import {
  addCausalHypothesisAction,
  createCorrectiveActionAction,
  createDepartmentAction,
  createPerformanceVarianceAction,
  createPersonProfileAction,
  createPositionAction,
  startRootCauseInvestigationAction,
  transitionCorrectiveActionAction,
} from "@/app/actions/people";

export function PeopleOperabilityPanel({ workspace }: { workspace: PeoplePerformanceWorkspaceView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const act = (op: () => Promise<{ ok: boolean; error?: string }>) => startTransition(async () => { const result = await op(); if (!result.ok) window.alert(result.error ?? "Não foi possível concluir."); else router.refresh(); });

  const newDepartment = () => { const code = prompt("Código do departamento:"); if (!code) return; const name = prompt("Nome do departamento:"); if (!name) return; act(() => createDepartmentAction({ code, name })); };
  const newPosition = () => { const code = prompt("Código do cargo:"); if (!code) return; const title = prompt("Título do cargo:"); if (!title) return; const departmentId = prompt("ID do departamento (opcional):") || null; act(() => createPositionAction({ code, title, departmentId })); };
  const newPerson = () => { const fullName = prompt("Nome completo:"); if (!fullName) return; const email = prompt("E-mail (opcional):") || null; const phone = prompt("Telefone (opcional):") || null; act(() => createPersonProfileAction({ fullName, email, phone })); };
  const newVariance = () => {
    const title = prompt("Título do desvio de desempenho:"); if (!title) return;
    const planned = Number(prompt("Valor planejado:", "0")); const actual = Number(prompt("Valor realizado:", "0"));
    const plannedProgress = Number(prompt("Avanço planejado (0 a 1):", "0")); const actualProgress = Number(prompt("Avanço realizado (0 a 1):", "0"));
    const from = prompt("Data inicial (AAAA-MM-DD):", new Date().toISOString().slice(0,10)); const to = prompt("Data final (AAAA-MM-DD):", new Date().toISOString().slice(0,10)); if (!from || !to) return;
    act(() => createPerformanceVarianceAction({ projectId: workspace.projectId, code: `DV-${Date.now().toString().slice(-6)}`, title, type: "COST", plannedAmount: planned, committedAmount: actual, measuredAmount: actual, actualAmount: actual, forecastAmount: actual, plannedProgress, actualProgress, referenceFrom: new Date(`${from}T00:00:00Z`), referenceTo: new Date(`${to}T00:00:00Z`) }));
  };

  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">OPERAÇÃO HUMANA · 10C.1</span><h2>Cadastros, desvios e ações de Pessoas</h2><p>Cadastre estrutura organizacional e abra o ciclo humano de análise de desempenho e ação corretiva.</p></div><div className="panel-actions"><button className="button button-secondary" disabled={pending} onClick={newDepartment}><Building2 size={15}/> Departamento</button><button className="button button-secondary" disabled={pending} onClick={newPosition}><CirclePlus size={15}/> Cargo</button><button className="button button-secondary" disabled={pending} onClick={newPerson}><UserPlus size={15}/> Pessoa</button><button className="button button-primary" disabled={pending} onClick={newVariance}><Wrench size={15}/> Novo desvio</button></div></div>
    <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Desvio</th><th>Situação</th><th>Investigação</th><th>Ação humana</th></tr></thead><tbody>{workspace.varianceCases.map((item) => <tr key={item.id}><td><strong>{item.code} · {item.title}</strong></td><td>{item.status}</td><td>{item.investigation ? item.investigation.problemStatement : "Não iniciada"}</td><td>{!item.investigation ? <button className="button button-secondary" disabled={pending} onClick={() => { const problem = prompt("Problema a investigar:"); if (problem) act(() => startRootCauseInvestigationAction(item.id, problem)); }}>Investigar causa</button> : <div className="panel-actions"><button className="button button-secondary" disabled={pending} onClick={() => { const description = prompt("Hipótese causal:"); if (description) act(() => addCausalHypothesisAction(item.investigation!.id, "OTHER", description)); }}>Hipótese</button><button className="button button-secondary" disabled={pending} onClick={() => { const title = prompt("Título da ação corretiva:"); if (!title) return; const description = prompt("Descrição da ação:"); if (description) act(() => createCorrectiveActionAction(item.investigation!.id, title, description, "MEDIUM")); }}>Nova ação</button></div>}</td></tr>)}{workspace.varianceCases.length === 0 && <tr><td colSpan={4}>Nenhum desvio registrado.</td></tr>}</tbody></table></div>
    {workspace.varianceCases.flatMap((item) => item.investigation?.actions ?? []).length > 0 && <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Ação corretiva</th><th>Prioridade</th><th>Status</th><th>Próxima etapa</th></tr></thead><tbody>{workspace.varianceCases.flatMap((item) => item.investigation?.actions ?? []).map((action) => <tr key={action.id}><td>{action.title}</td><td>{action.priority}</td><td>{action.status}</td><td>{action.status === "DRAFT" && <button className="button button-secondary" disabled={pending} onClick={() => act(() => transitionCorrectiveActionAction(action.id, "ACTIVE"))}>Ativar</button>}{action.status === "ACTIVE" && <button className="button button-secondary" disabled={pending} onClick={() => act(() => transitionCorrectiveActionAction(action.id, "COMPLETED"))}>Concluir</button>}</td></tr>)}</tbody></table></div>}
  </section>;
}
