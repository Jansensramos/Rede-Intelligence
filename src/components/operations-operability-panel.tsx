"use client";

import { FormEvent, useState, useTransition } from "react";
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
import styles from "./sales-operability-panel.module.css";

export function OperationsOperabilityPanel({ workspace }: { workspace: OperationsWorkspaceView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const projectId = workspace.structure?.projectId;

  const act = (op: () => Promise<{ ok: boolean; error?: string }>, success: string) => startTransition(async () => {
    setFeedback(null);
    const result = await op();
    if (!result.ok) setFeedback({ type: "error", text: result.error ?? "Não foi possível concluir." });
    else {
      setScheduleOpen(false);
      setFeedback({ type: "success", text: success });
      router.refresh();
    }
  });

  function createSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace.budget) return;
    const data = new FormData(event.currentTarget);
    const start = String(data.get("startDate") ?? "");
    const end = String(data.get("endDate") ?? "");
    if (!start || !end) return setFeedback({ type: "error", text: "Informe início e término do cronograma." });
    if (new Date(`${end}T00:00:00Z`) < new Date(`${start}T00:00:00Z`)) return setFeedback({ type: "error", text: "O término não pode ser anterior ao início." });
    act(() => createOperationalScheduleAction({ budgetId: workspace.budget!.id, startDate: new Date(`${start}T00:00:00Z`), endDate: new Date(`${end}T00:00:00Z`), method: "S_CURVE" }), "Cronograma criado com sucesso.");
  }

  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">PLANEJAMENTO E OPERAÇÃO</span><h2>Base, orçamento e cronograma</h2><p>Conduza a aprovação da base do empreendimento, formalize o orçamento oficial e mantenha o cronograma rastreável.</p></div><div className="panel-actions">
      {!workspace.baseline && projectId && <button className="button button-primary" disabled={pending} onClick={() => act(() => prepareLatestOperationalBaselineAction(projectId), "Base preparada para revisão.")}><FileLock2 size={15}/> Preparar base</button>}
      {workspace.baseline?.status === "PREPARING" && <button className="button button-primary" disabled={pending} onClick={() => act(() => requestBaselineApprovalAction(workspace.baseline!.id), "Base enviada para aprovação.")}><ListChecks size={15}/> Solicitar aprovação</button>}
      {workspace.baseline?.status === "UNDER_APPROVAL" && <button className="button button-primary" disabled={pending} onClick={() => act(() => approveOperationalBaselineAction(workspace.baseline!.id), "Base aprovada.")}><CheckCircle2 size={15}/> Aprovar base</button>}
      {workspace.baseline?.status === "APPROVED" && !workspace.budget && <button className="button button-primary" disabled={pending} onClick={() => act(() => createOfficialBudgetAction(workspace.baseline!.id), "Orçamento oficial criado.")}>Criar orçamento oficial</button>}
      {workspace.budget && ["OFFICIAL","APPROVED"].includes(workspace.budget.status) && !workspace.schedule && <button className="button button-primary" disabled={pending} onClick={() => setScheduleOpen(true)}><Milestone size={15}/> Criar cronograma</button>}
      {workspace.schedule && ["DRAFT","UNDER_REVIEW"].includes(workspace.schedule.status) && <button className="button button-primary" disabled={pending} onClick={() => act(() => approveOperationalScheduleAction(workspace.schedule!.id), "Cronograma aprovado.")}><CheckCircle2 size={15}/> Aprovar cronograma</button>}
    </div></div>
    {feedback && <div className={feedback.type === "error" ? styles.error : styles.success}>{feedback.text}</div>}

    {scheduleOpen && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setScheduleOpen(false); }}><div className={styles.modal} role="dialog" aria-modal="true" aria-label="Criar cronograma"><div className={styles.modalHeader}><div><h3>Criar cronograma</h3><p>Defina o período oficial que será utilizado para o acompanhamento do empreendimento.</p></div><button className={styles.closeButton} type="button" disabled={pending} onClick={() => setScheduleOpen(false)} aria-label="Fechar">×</button></div><form className={styles.form} onSubmit={createSchedule}><div className={styles.formGrid}><div className={styles.field}><label htmlFor="schedule-start">Início</label><input id="schedule-start" name="startDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} autoFocus required /></div><div className={styles.field}><label htmlFor="schedule-end">Término</label><input id="schedule-end" name="endDate" type="date" required /></div><div className={`${styles.field} ${styles.fieldFull}`}><span className={styles.help}>O cronograma será criado pelo método de curva S e poderá seguir o fluxo de aprovação operacional.</span></div></div>{feedback?.type === "error" && <div className={styles.error}>{feedback.text}</div>}<div className={styles.modalActions}><button type="button" className="button button-secondary" disabled={pending} onClick={() => setScheduleOpen(false)}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending}>{pending ? "Criando..." : "Criar cronograma"}</button></div></form></div></div>}
  </section>;
}
