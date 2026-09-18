"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCcw, RotateCcw, Scale } from "lucide-react";
import type { AccountingWorkspaceView } from "@/application/accounting/accounting-service";
import {
  createAccountingReconciliationAction,
  reopenAccountingPeriodAction,
  reverseAccountingEntryAction,
} from "@/app/actions/accounting";
import styles from "./sales-operability-panel.module.css";

type Modal =
  | { type: "reverse"; entryId: string; periodId: string; label: string }
  | { type: "reopen"; periodId: string; label: string }
  | { type: "reconcile" }
  | null;

export function AccountingGovernanceOperabilityPanel({ workspace }: { workspace: AccountingWorkspaceView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [modal, setModal] = useState<Modal>(null);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const run = (operation: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setFeedback(null);
    startTransition(async () => {
      const result = await operation();
      if (!result.ok) {
        setFeedback({ type: "error", text: result.error ?? "Não foi possível concluir a operação contábil." });
        return;
      }
      setModal(null);
      setFeedback({ type: "success", text: success });
      router.refresh();
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!modal) return;
    const data = new FormData(event.currentTarget);

    if (modal.type === "reverse") {
      const reason = String(data.get("reason") ?? "").trim();
      const approvedById = String(data.get("approvedById") ?? "");
      if (!reason || !approvedById) return setFeedback({ type: "error", text: "Informe motivo e aprovador segregado." });
      return run(() => reverseAccountingEntryAction({ entryId: modal.entryId, periodId: modal.periodId, reason, approvedById }), "Lançamento estornado com trilha de auditoria.");
    }

    if (modal.type === "reopen") {
      const reason = String(data.get("reason") ?? "").trim();
      const authorizedById = String(data.get("authorizedById") ?? "");
      if (!reason || !authorizedById) return setFeedback({ type: "error", text: "Informe motivo e autorizador segregado." });
      return run(() => reopenAccountingPeriodAction({ periodId: modal.periodId, reason, authorizedById }), "Período reaberto.");
    }

    const periodId = String(data.get("periodId") ?? "");
    const type = String(data.get("type") ?? "").trim();
    const sourceType = String(data.get("sourceType") ?? "").trim();
    const sourceId = String(data.get("sourceId") ?? "").trim();
    const sourceAmount = Number(data.get("sourceAmount") ?? 0);
    const ledgerAmount = Number(data.get("ledgerAmount") ?? 0);
    const materiality = Number(data.get("materiality") ?? 0);
    const note = String(data.get("note") ?? "").trim();
    if (!periodId || !type || !sourceType || !sourceId || !Number.isFinite(sourceAmount) || !Number.isFinite(ledgerAmount) || !Number.isFinite(materiality)) {
      return setFeedback({ type: "error", text: "Revise os dados da conciliação." });
    }
    return run(() => createAccountingReconciliationAction({ periodId, projectId: workspace.projectId, type, sourceType, sourceId, sourceAmount, ledgerAmount, materiality, evidence: { note } }), "Conciliação registrada.");
  };

  const postedEntries = workspace.entries.filter((entry) => entry.status === "POSTED");
  const closedPeriods = workspace.periods.filter((period) => period.status === "CLOSED");

  return <section className="panel">
    <div className="panel-heading">
      <div><span className="eyebrow">GOVERNANÇA CONTÁBIL</span><h2>Estornos, reaberturas e conciliações</h2><p>Operações sensíveis permanecem segregadas, auditáveis e vinculadas ao período contábil correto.</p></div>
      <button className="button button-primary" disabled={pending || !workspace.permissions.canReconcile || workspace.periods.length === 0} onClick={() => setModal({ type: "reconcile" })}><Scale size={15}/> Nova conciliação</button>
    </div>

    {feedback && <div className={feedback.type === "error" ? styles.error : styles.success}>{feedback.text}</div>}

    <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Tipo</th><th>Registro</th><th>Situação</th><th>Ação</th></tr></thead><tbody>
      {postedEntries.slice(0, 12).map((entry) => <tr key={entry.id}><td>Lançamento</td><td><strong>{entry.entryNumber}</strong><small>{entry.description}</small></td><td>Postado</td><td><button className="button button-secondary" disabled={pending || !workspace.permissions.canReverse || workspace.approvers.length === 0} onClick={() => setModal({ type: "reverse", entryId: entry.id, periodId: entry.periodId, label: entry.entryNumber })}><RotateCcw size={15}/> Estornar</button></td></tr>)}
      {closedPeriods.slice(0, 8).map((period) => <tr key={period.id}><td>Período</td><td><strong>{new Date(period.referenceMonth).toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric", timeZone: "UTC" })}</strong></td><td>Fechado</td><td><button className="button button-secondary" disabled={pending || !workspace.permissions.canReopen || workspace.approvers.length === 0} onClick={() => setModal({ type: "reopen", periodId: period.id, label: period.referenceMonth })}><RefreshCcw size={15}/> Reabrir</button></td></tr>)}
      {postedEntries.length === 0 && closedPeriods.length === 0 && <tr><td colSpan={4}>Sem lançamentos postados ou períodos fechados para governança.</td></tr>}
    </tbody></table></div>

    {modal && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setModal(null); }}><div className={styles.modal} role="dialog" aria-modal="true">
      <div className={styles.modalHeader}><div><h3>{modal.type === "reverse" ? "Estornar lançamento" : modal.type === "reopen" ? "Reabrir período" : "Nova conciliação"}</h3><p>{modal.type === "reconcile" ? "Compare a fonte operacional com o razão e registre a evidência." : "A operação exige segregação de função."}</p></div><button type="button" className={styles.closeButton} disabled={pending} onClick={() => setModal(null)}>×</button></div>
      <form className={styles.form} onSubmit={submit}><div className={styles.formGrid}>
        {(modal.type === "reverse" || modal.type === "reopen") && <>
          <div className={styles.field}><label>Registro</label><input readOnly value={modal.label} /></div>
          <div className={styles.field}><label>Aprovador / autorizador</label><select name={modal.type === "reverse" ? "approvedById" : "authorizedById"} required defaultValue=""><option value="" disabled>Selecione outro usuário</option>{workspace.approvers.map((item) => <option key={item.userId} value={item.userId}>{item.name} · {item.role}</option>)}</select></div>
          <div className={styles.field + " " + styles.fieldFull}><label>Motivo</label><textarea name="reason" required /></div>
        </>}
        {modal.type === "reconcile" && <>
          <div className={styles.field}><label>Período</label><select name="periodId" required defaultValue=""><option value="" disabled>Selecione</option>{workspace.periods.map((item) => <option key={item.id} value={item.id}>{new Date(item.referenceMonth).toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric", timeZone: "UTC" })} · {item.status}</option>)}</select></div>
          <div className={styles.field}><label>Tipo de conciliação</label><input name="type" placeholder="FINANCEIRO_X_CONTABIL" required /></div>
          <div className={styles.field}><label>Tipo da fonte</label><input name="sourceType" placeholder="FinancialClosure" required /></div>
          <div className={styles.field}><label>Identificador da fonte</label><input name="sourceId" required /></div>
          <div className={styles.field}><label>Valor da fonte</label><input name="sourceAmount" type="number" step="0.01" required /></div>
          <div className={styles.field}><label>Valor no razão</label><input name="ledgerAmount" type="number" step="0.01" required /></div>
          <div className={styles.field}><label>Materialidade</label><input name="materiality" type="number" min="0" step="0.01" defaultValue="0" required /></div>
          <div className={styles.field + " " + styles.fieldFull}><label>Evidência / observação</label><textarea name="note" /></div>
        </>}
      </div><div className={styles.modalActions}><button type="button" className="button button-secondary" disabled={pending} onClick={() => setModal(null)}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending}>{pending ? "Processando..." : "Confirmar"}</button></div></form>
    </div></div>}
  </section>;
}
