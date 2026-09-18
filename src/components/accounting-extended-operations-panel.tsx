"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCcw, RotateCcw, Scale } from "lucide-react";
import type { AccountingWorkspaceView } from "@/application/accounting/accounting-service";
import {
  createAccountingReconciliationAction,
  reopenAccountingPeriodAction,
  reverseAccountingEntryAction,
} from "@/app/actions/accounting-extended";
import styles from "./sales-operability-panel.module.css";

type ModalState =
  | { type: "reconcile" }
  | { type: "reverse" }
  | { type: "reopen" }
  | null;

type ActionResult = { ok: boolean; error?: string };

export function AccountingExtendedOperationsPanel({
  workspace,
}: {
  workspace: AccountingWorkspaceView;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>(null);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const openPeriods = workspace.periods.filter((period) =>
    ["OPEN", "UNDER_REVIEW", "REOPENED", "ADJUSTMENT"].includes(period.status),
  );
  const closedPeriods = workspace.periods.filter((period) => period.status === "CLOSED");
  const postedEntries = workspace.entries.filter((entry) => entry.status === "POSTED");

  const run = (operation: () => Promise<ActionResult>, success: string) => {
    setFeedback(null);
    startTransition(async () => {
      const result = await operation();
      if (!result.ok) {
        setFeedback({ type: "error", text: result.error ?? "Não foi possível concluir a operação." });
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

    if (modal.type === "reconcile") {
      const periodId = String(data.get("periodId") ?? "");
      const type = String(data.get("type") ?? "").trim();
      const sourceType = String(data.get("sourceType") ?? "").trim();
      const sourceId = String(data.get("sourceId") ?? "").trim();
      if (!periodId || !type || !sourceType || !sourceId) {
        return setFeedback({ type: "error", text: "Informe período, tipo e referência da fonte." });
      }
      const evidenceText = String(data.get("evidence") ?? "").trim();
      return run(
        () => createAccountingReconciliationAction({
          periodId,
          projectId: workspace.projectId,
          type,
          sourceType,
          sourceId,
          sourceAmount: Number(data.get("sourceAmount") || 0),
          ledgerAmount: Number(data.get("ledgerAmount") || 0),
          materiality: Number(data.get("materiality") || 0),
          evidence: {
            note: evidenceText || "Conciliação registrada pela superfície humana.",
            recordedFrom: "ACCOUNTING_OPERABILITY",
          },
        }),
        "Conciliação contábil registrada.",
      );
    }

    if (modal.type === "reverse") {
      const entryId = String(data.get("entryId") ?? "");
      const periodId = String(data.get("periodId") ?? "");
      const approvedById = String(data.get("approvedById") ?? "");
      const reason = String(data.get("reason") ?? "").trim();
      if (!entryId || !periodId || !approvedById || !reason) {
        return setFeedback({ type: "error", text: "Informe lançamento, período, aprovador segregado e motivo." });
      }
      return run(
        () => reverseAccountingEntryAction(entryId, { periodId, reason, approvedById }),
        "Lançamento estornado com trilha de auditoria.",
      );
    }

    const periodId = String(data.get("periodId") ?? "");
    const authorizedById = String(data.get("authorizedById") ?? "");
    const reason = String(data.get("reason") ?? "").trim();
    if (!periodId || !authorizedById || !reason) {
      return setFeedback({ type: "error", text: "Informe período, autorizador segregado e motivo." });
    }
    return run(
      () => reopenAccountingPeriodAction(periodId, reason, authorizedById),
      "Período reaberto com autorização segregada.",
    );
  };

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">CONTROLADORIA OPERACIONAL</span>
          <h2>Conciliação, estorno e reabertura</h2>
          <p>Complete a jornada contábil com tratamento auditável de divergências, correções e reabertura segregada.</p>
        </div>
        <div className="panel-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={pending || !workspace.permissions.canReview || workspace.periods.length === 0}
            onClick={() => setModal({ type: "reconcile" })}
          >
            <Scale size={15} /> Conciliar
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={pending || !workspace.permissions.canReverse || postedEntries.length === 0 || openPeriods.length === 0}
            onClick={() => setModal({ type: "reverse" })}
          >
            <RotateCcw size={15} /> Estornar
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={pending || !workspace.permissions.canReopen || closedPeriods.length === 0}
            onClick={() => setModal({ type: "reopen" })}
          >
            <RefreshCcw size={15} /> Reabrir período
          </button>
        </div>
      </div>

      {feedback && (
        <div className={feedback.type === "error" ? styles.error : styles.success}>
          {feedback.text}
        </div>
      )}

      <div className="data-table-scroll">
        <table className="data-table">
          <thead><tr><th>Conciliação</th><th>Período</th><th>Situação</th><th>Diferença</th></tr></thead>
          <tbody>
            {workspace.reconciliations.slice(0, 12).map((item) => (
              <tr key={item.id}>
                <td><strong>{item.type}</strong></td>
                <td>{item.period}</td>
                <td>{item.status}</td>
                <td>{item.difference.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td>
              </tr>
            ))}
            {workspace.reconciliations.length === 0 && <tr><td colSpan={4}>Nenhuma conciliação registrada.</td></tr>}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setModal(null); }}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Operação contábil avançada">
            <div className={styles.modalHeader}>
              <div>
                <h3>{modal.type === "reconcile" ? "Registrar conciliação" : modal.type === "reverse" ? "Estornar lançamento" : "Reabrir período"}</h3>
                <p>As operações respeitam segregação de função e as validações do domínio contábil.</p>
              </div>
              <button className={styles.closeButton} type="button" disabled={pending} onClick={() => setModal(null)} aria-label="Fechar">×</button>
            </div>

            <form className={styles.form} onSubmit={submit}>
              <div className={styles.formGrid}>
                {modal.type === "reconcile" && (
                  <>
                    <PeriodSelect periods={workspace.periods} name="periodId" label="Período" />
                    <Field label="Tipo de conciliação"><input name="type" required autoFocus placeholder="BANCO, FORNECEDORES, RECEBÍVEIS..." /></Field>
                    <Field label="Tipo da fonte"><input name="sourceType" required placeholder="BankStatement, Payable..." /></Field>
                    <Field label="ID / referência da fonte"><input name="sourceId" required /></Field>
                    <Field label="Valor da fonte"><input name="sourceAmount" type="number" step="0.01" required /></Field>
                    <Field label="Valor no razão"><input name="ledgerAmount" type="number" step="0.01" required /></Field>
                    <Field label="Materialidade"><input name="materiality" type="number" min="0" step="0.01" required /></Field>
                    <div className={`${styles.field} ${styles.fieldFull}`}>
                      <label htmlFor="accounting-reconcile-evidence">Evidência / observação</label>
                      <textarea id="accounting-reconcile-evidence" name="evidence" />
                    </div>
                  </>
                )}

                {modal.type === "reverse" && (
                  <>
                    <Field label="Lançamento">
                      <select name="entryId" required autoFocus defaultValue="">
                        <option value="" disabled>Selecione</option>
                        {postedEntries.map((entry) => <option key={entry.id} value={entry.id}>{entry.entryNumber} · {entry.description}</option>)}
                      </select>
                    </Field>
                    <PeriodSelect periods={openPeriods} name="periodId" label="Período do estorno" />
                    <ApproverSelect workspace={workspace} name="approvedById" label="Aprovador segregado" />
                    <div className={`${styles.field} ${styles.fieldFull}`}>
                      <label htmlFor="accounting-reverse-reason">Motivo</label>
                      <textarea id="accounting-reverse-reason" name="reason" required />
                    </div>
                  </>
                )}

                {modal.type === "reopen" && (
                  <>
                    <PeriodSelect periods={closedPeriods} name="periodId" label="Período fechado" />
                    <ApproverSelect workspace={workspace} name="authorizedById" label="Autorizador segregado" />
                    <div className={`${styles.field} ${styles.fieldFull}`}>
                      <label htmlFor="accounting-reopen-reason">Motivo da reabertura</label>
                      <textarea id="accounting-reopen-reason" name="reason" required autoFocus />
                    </div>
                  </>
                )}
              </div>

              {feedback?.type === "error" && <div className={styles.error}>{feedback.text}</div>}
              <div className={styles.modalActions}>
                <button type="button" className="button button-secondary" disabled={pending} onClick={() => setModal(null)}>Cancelar</button>
                <button type="submit" className="button button-primary" disabled={pending}>{pending ? "Processando..." : "Confirmar"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className={styles.field}><label>{label}</label>{children}</div>;
}

function PeriodSelect({
  periods,
  name,
  label,
}: {
  periods: AccountingWorkspaceView["periods"];
  name: string;
  label: string;
}) {
  return (
    <Field label={label}>
      <select name={name} required defaultValue="">
        <option value="" disabled>Selecione</option>
        {periods.map((period) => (
          <option key={period.id} value={period.id}>
            {new Date(period.referenceMonth).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })} · {period.status}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ApproverSelect({
  workspace,
  name,
  label,
}: {
  workspace: AccountingWorkspaceView;
  name: string;
  label: string;
}) {
  return (
    <Field label={label}>
      <select name={name} required defaultValue="">
        <option value="" disabled>Selecione outra pessoa</option>
        {workspace.approvers.map((item) => <option key={item.userId} value={item.userId}>{item.name} · {item.role}</option>)}
      </select>
    </Field>
  );
}
