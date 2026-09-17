"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileLock2, ListChecks, Milestone } from "lucide-react";
import type { OperationsWorkspaceView } from "@/application/operations/operations-service";
import {
  approveOperationalBaselineAction,
  approveOperationalScheduleAction,
  createOfficialBudgetAction,
  createOperationalScheduleAction,
  prepareLatestOperationalBaselineAction,
  requestBaselineApprovalAction,
} from "@/app/actions/operations";

export function OperationsOperabilityPanel({ workspace }: { workspace: OperationsWorkspaceView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const act = (op: () => Promise<{ ok: boolean; error?: string }>) => startTransition(async () => { const result = await op(); if (!result.ok) alert(result.error ?? "Não foi possível concluir."); else router.refresh(); });
  const projectId = workspace.structure?.projectId;

  function createSchedule() {
    if (!workspace.budget) return;
    const start = prompt("Início do cronograma (AAAA-MM-DD):", new Date().toISOString().slice(0,10)); if (!start) return;
    const end = prompt("Fim do cronograma (AAAA-MM-DD):"); if (!end) return;
    act(() => createOperationalScheduleAction({ budgetId: workspace.budget!.id, startDate: new Date(`${start}T00:00:00Z`), endDate: new Date(`${end}T00:00:00Z`), method: "S_CURVE" }));
  }

  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">OPERAÇÃO HUMANA · 10C.1</span><h2>Fluxo da Base, Orçamento e Cronograma</h2><p>O usuário autorizado conduz cada mudança de estado; bases aprovadas permanecem versionadas e rastreáveis.</p></div><div className="panel-actions">
      {!workspace.baseline && projectId && <button className="button button-primary" disabled={pending} onClick={() => act(() => prepareLatestOperationalBaselineAction(projectId))}><FileLock2 size={15}/> Preparar Base</button>}
      {workspace.baseline?.status === "PREPARING" && <button className="button button-primary" disabled={pending} onClick={() => act(() => requestBaselineApprovalAction(workspace.baseline!.id))}><ListChecks size={15}/> Solicitar aprovação</button>}
      {workspace.baseline?.status === "UNDER_APPROVAL" && <button className="button button-primary" disabled={pending} onClick={() => act(() => approveOperationalBaselineAction(workspace.baseline!.id))}><CheckCircle2 size={15}/> Aprovar Base</button>}
      {workspace.baseline?.status === "APPROVED" && !workspace.budget && <button className="button button-primary" disabled={pending} onClick={() => act(() => createOfficialBudgetAction(workspace.baseline!.id))}>Criar Orçamento Oficial</button>}
      {workspace.budget && ["OFFICIAL","APPROVED"].includes(workspace.budget.status) && !workspace.schedule && <button className="button button-primary" disabled={pending} onClick={createSchedule}><Milestone size={15}/> Criar cronograma</button>}
      {workspace.schedule && ["DRAFT","UNDER_REVIEW"].includes(workspace.schedule.status) && <button className="button button-primary" disabled={pending} onClick={() => act(() => approveOperationalScheduleAction(workspace.schedule!.id))}><CheckCircle2 size={15}/> Aprovar cronograma</button>}
    </div></div>
  </section>;
}
