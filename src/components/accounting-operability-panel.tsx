"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookCheck, LockKeyhole } from "lucide-react";
import type { AccountingWorkspaceView } from "@/application/accounting/accounting-service";
import { closeAccountingPeriodAction, postAccountingEventAction } from "@/app/actions/accounting";
import styles from "./sales-operability-panel.module.css";

type ModalState =
  | { type: "post"; eventId: string; label: string }
  | { type: "close"; periodId: string; label: string }
  | null;

type ActionResult = { ok: boolean; error?: string };

const EVENT_STATUS: Record<string, string> = {
  PENDING: "Pendente", CLASSIFIED: "Classificado", POSTED: "Contabilizado", REVERSED: "Revertido", CANCELLED: "Cancelado",
};
const PERIOD_STATUS: Record<string, string> = {
  OPEN: "Aberto", UNDER_REVIEW: "Em revisão", ADJUSTMENT: "Em ajuste", CLOSED: "Fechado", REOPENED: "Reaberto",
};

export function AccountingOperabilityPanel({ workspace }: { workspace: AccountingWorkspaceView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [modal, setModal] = useState<ModalState>(null);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const classified = workspace.events.filter((event) => event.status === "CLASSIFIED");
  const closable = workspace.periods.filter((period) => ["OPEN", "UNDER_REVIEW", "REOPENED", "ADJUSTMENT"].includes(period.status));

  const run = (op: () => Promise<ActionResult>, success: string) => {
    setFeedback(null);
    startTransition(async () => {
      const result = await op();
      if (!result.ok) return setFeedback({ type: "error", text: result.error ?? "Não foi possível concluir a operação." });
      setModal(null);
      setFeedback({ type: "success", text: success });
      router.refresh();
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!modal) return;
    const data = new FormData(event.currentTarget);
    if (modal.type === "post") {
      const description = String(data.get("description") ?? "").trim() || undefined;
      return run(() => postAccountingEventAction(modal.eventId, description), "Evento contabilizado com sucesso.");
    }
    const checklistConfirmed = data.get("checklistConfirmed") === "on";
    if (!checklistConfirmed) return setFeedback({ type: "error", text: "Confirme a revisão do checklist antes de fechar o período." });
    return run(() => closeAccountingPeriodAction(modal.periodId), "Período fechado com sucesso.");
  };

  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">CONTABILIDADE E CONTROLADORIA</span><h2>Contabilização e fechamento</h2><p>Revise eventos classificados, contabilize lançamentos e conduza o fechamento mensal com rastreabilidade.</p></div></div>
    {feedback && <div className={feedback.type === "error" ? styles.error : styles.success}>{feedback.text}</div>}
    <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Tipo</th><th>Registro</th><th>Situação</th><th>Ação</th></tr></thead><tbody>
      {classified.slice(0,12).map(event => <tr key={event.id}><td>Evento</td><td><strong>{event.sourceModule} · {event.sourceType}</strong><small>{event.sourceId} · {event.netAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</small></td><td>{EVENT_STATUS[event.status] ?? event.status}</td><td><button className="button button-secondary" disabled={pending || !workspace.permissions.canPost} onClick={() => setModal({ type: "post", eventId: event.id, label: `${event.sourceModule} · ${event.sourceType}` })}><BookCheck size={15}/> Contabilizar</button></td></tr>)}
      {closable.slice(0,8).map(period => { const label = new Date(period.referenceMonth).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }); return <tr key={period.id}><td>Período</td><td><strong>{label}</strong></td><td>{PERIOD_STATUS[period.status] ?? period.status}</td><td><button className="button button-primary" disabled={pending || !workspace.permissions.canClose} onClick={() => setModal({ type: "close", periodId: period.id, label })}><LockKeyhole size={15}/> Fechar período</button></td></tr>; })}
      {classified.length === 0 && closable.length === 0 && <tr><td colSpan={4}>Nenhum evento classificado ou período disponível para ação.</td></tr>}
    </tbody></table></div>

    {modal && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setModal(null); }}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={modal.type === "post" ? "Contabilizar evento" : "Fechar período"}>
        <div className={styles.modalHeader}><div><h3>{modal.type === "post" ? "Contabilizar evento" : "Fechar período contábil"}</h3><p>{modal.label}</p></div><button className={styles.closeButton} type="button" disabled={pending} onClick={() => setModal(null)} aria-label="Fechar">×</button></div>
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.formGrid}>
            {modal.type === "post" && <div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="accounting-description">Histórico / descrição do lançamento</label><textarea id="accounting-description" name="description" autoFocus placeholder="Opcional: registre o histórico que deve acompanhar a contabilização." /></div>}
            {modal.type === "close" && <div className={`${styles.field} ${styles.fieldFull}`}><label><input name="checklistConfirmed" type="checkbox" /> Confirmo que o checklist de fechamento foi revisado e está completo.</label><span className={styles.help}>O fechamento mantém o histórico e as validações do domínio contábil.</span></div>}
          </div>
          {feedback?.type === "error" && <div className={styles.error}>{feedback.text}</div>}
          <div className={styles.modalActions}><button type="button" className="button button-secondary" disabled={pending} onClick={() => setModal(null)}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending}>{pending ? "Processando..." : modal.type === "post" ? "Contabilizar" : "Confirmar fechamento"}</button></div>
        </form>
      </div>
    </div>}
  </section>;
}