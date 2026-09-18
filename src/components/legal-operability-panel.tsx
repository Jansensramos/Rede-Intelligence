"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Gavel, Landmark, RotateCcw } from "lucide-react";
import type { LegalWorkspaceView } from "@/application/legal/legal-service";
import {
  createDueDiligenceCaseAction,
  recordLegalDecisionAction,
  reverseLegalFinancialEventAction,
  sendLegalObligationToFinanceAction,
} from "@/app/actions/legal";
import styles from "./sales-operability-panel.module.css";

type ModalState =
  | { type: "diligence" }
  | { type: "decision"; caseId: string; label: string }
  | { type: "reverse"; obligationId: string; label: string }
  | null;

type ActionResult = { ok: boolean; error?: string };

const DILIGENCE_STATUS: Record<string, string> = {
  DRAFT: "Rascunho", IN_PROGRESS: "Em andamento", UNDER_REVIEW: "Em revisão", COMPLETED: "Concluída", SUPERSEDED: "Substituída", CANCELLED: "Cancelada",
};
const OBLIGATION_STATUS: Record<string, string> = {
  DRAFT: "Rascunho", ACTIVE: "Ativa", DUE_SOON: "Vence em breve", OVERDUE: "Vencida", FULFILLED: "Cumprida", WAIVED: "Dispensada", CANCELLED: "Cancelada",
};

export function LegalOperabilityPanel({ workspace, canWrite, canApprove }: { workspace: LegalWorkspaceView; canWrite: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [modal, setModal] = useState<ModalState>(null);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const run = (op: () => Promise<ActionResult>, success: string) => {
    setFeedback(null);
    startTransition(async () => {
      const result = await op();
      if (!result.ok) return setFeedback({ type: "error", text: result.error ?? "Não foi possível concluir a operação jurídica." });
      setModal(null);
      setFeedback({ type: "success", text: success });
      router.refresh();
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!modal) return;
    const data = new FormData(event.currentTarget);

    if (modal.type === "diligence") {
      const code = String(data.get("code") ?? "").trim();
      const title = String(data.get("title") ?? "").trim();
      const scope = String(data.get("scope") ?? "").trim();
      if (!code || !title || !scope) return setFeedback({ type: "error", text: "Preencha código, título e escopo da diligência." });
      return run(() => createDueDiligenceCaseAction({ projectId: workspace.projectId, code, title, scope }), "Diligência criada com sucesso.");
    }

    if (modal.type === "decision") {
      const decision = String(data.get("decision") ?? "") as "PROCEED" | "PROCEED_WITH_CONDITIONS" | "HOLD" | "DO_NOT_PROCEED" | "INSUFFICIENT_EVIDENCE";
      const conclusion = String(data.get("conclusion") ?? "").trim();
      if (!decision || !conclusion) return setFeedback({ type: "error", text: "Selecione a decisão e registre a conclusão jurídica." });
      return run(() => recordLegalDecisionAction(modal.caseId, { decision, conclusion }), "Decisão jurídica registrada.");
    }

    const reason = String(data.get("reason") ?? "").trim();
    if (!reason) return setFeedback({ type: "error", text: "Informe o motivo da reversão." });
    return run(() => reverseLegalFinancialEventAction(modal.obligationId, reason), "Integração financeira revertida.");
  };

  return <section className="panel">
    {!canWrite && !canApprove && <div className="model-note"><div><strong>Modo de leitura</strong><p>Seu perfil pode consultar o Jurídico, mas não alterar nem aprovar registros.</p></div></div>}
    <div className="panel-heading"><div><span className="eyebrow">JURÍDICO</span><h2>Operações jurídicas</h2><p>Abra diligências, registre decisões e acompanhe obrigações com reflexo financeiro.</p></div><button className="button button-primary" disabled={pending || !canWrite} onClick={() => setModal({ type: "diligence" })}><FilePlus2 size={16}/> Nova diligência</button></div>
    {feedback && <div className={feedback.type === "error" ? styles.error : styles.success}>{feedback.text}</div>}
    <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Tipo</th><th>Registro</th><th>Situação</th><th>Ação</th></tr></thead><tbody>
      {workspace.cases.filter((item) => item.status !== "COMPLETED").slice(0,10).map((item) => <tr key={item.id}><td>Diligência</td><td><strong>{item.code} · {item.title}</strong></td><td>{DILIGENCE_STATUS[item.status] ?? item.status}</td><td><button className="button button-secondary" disabled={pending || !canApprove} onClick={() => setModal({ type: "decision", caseId: item.id, label: `${item.code} · ${item.title}` })}><Gavel size={15}/> Registrar decisão</button></td></tr>)}
      {workspace.obligations.slice(0,10).map((item) => { const processed = item.financialEvents?.some((event) => event.status === "PROCESSED"); const label = `${item.code} · ${item.title}`; return <tr key={item.id}><td>Obrigação</td><td><strong>{label}</strong></td><td>{OBLIGATION_STATUS[item.status] ?? item.status}</td><td>{processed ? <button className="button button-secondary" disabled={pending || !canApprove} onClick={() => setModal({ type: "reverse", obligationId: item.id, label })}><RotateCcw size={15}/> Reverter financeiro</button> : <button className="button button-secondary" disabled={pending || !canApprove || !item.amount} onClick={() => run(() => sendLegalObligationToFinanceAction(item.id), "Obrigação enviada ao Financeiro.")}><Landmark size={15}/> Enviar ao Financeiro</button>}</td></tr>})}
      {workspace.cases.length === 0 && workspace.obligations.length === 0 && <tr><td colSpan={4}>Nenhum registro jurídico. Use “Nova diligência” para iniciar.</td></tr>}
    </tbody></table></div>

    {modal && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setModal(null); }}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={modal.type === "diligence" ? "Nova diligência" : modal.type === "decision" ? "Registrar decisão" : "Reverter financeiro"}>
        <div className={styles.modalHeader}><div><h3>{modal.type === "diligence" ? "Nova diligência" : modal.type === "decision" ? "Registrar decisão jurídica" : "Reverter integração financeira"}</h3><p>{modal.type === "diligence" ? "Registre o escopo que será analisado e preserve a rastreabilidade da decisão." : modal.label}</p></div><button className={styles.closeButton} type="button" disabled={pending} onClick={() => setModal(null)} aria-label="Fechar">×</button></div>
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.formGrid}>
            {modal.type === "diligence" && <><div className={styles.field}><label htmlFor="legal-code">Código</label><input id="legal-code" name="code" defaultValue={`DD-${Date.now().toString().slice(-6)}`} autoFocus required /></div><div className={styles.field}><label htmlFor="legal-title">Título</label><input id="legal-title" name="title" required /></div><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="legal-scope">Escopo</label><textarea id="legal-scope" name="scope" required /></div></>}
            {modal.type === "decision" && <><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="legal-decision">Decisão</label><select id="legal-decision" name="decision" defaultValue="PROCEED_WITH_CONDITIONS" required><option value="PROCEED">Prosseguir</option><option value="PROCEED_WITH_CONDITIONS">Prosseguir com condições</option><option value="HOLD">Aguardar / suspender</option><option value="DO_NOT_PROCEED">Não prosseguir</option><option value="INSUFFICIENT_EVIDENCE">Evidência insuficiente</option></select></div><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="legal-conclusion">Conclusão jurídica</label><textarea id="legal-conclusion" name="conclusion" autoFocus required /></div></>}
            {modal.type === "reverse" && <div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="legal-reverse-reason">Motivo da reversão</label><textarea id="legal-reverse-reason" name="reason" autoFocus required /><span className={styles.help}>A reversão fica registrada no histórico da obrigação.</span></div>}
          </div>
          {feedback?.type === "error" && <div className={styles.error}>{feedback.text}</div>}
          <div className={styles.modalActions}><button type="button" className="button button-secondary" disabled={pending} onClick={() => setModal(null)}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending}>{pending ? "Salvando..." : "Confirmar"}</button></div>
        </form>
      </div>
    </div>}
  </section>;
}