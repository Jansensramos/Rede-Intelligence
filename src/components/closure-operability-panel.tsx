"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, CheckCircle2, RotateCcw, WalletCards } from "lucide-react";
import {
  approveProjectClosureDistributionAction,
  approveProjectClosureResultAction,
  createProjectClosureDistributionAction,
  listProjectClosureDistributionsAction,
  prepareProjectClosureResultAction,
  reopenProjectClosureResultAction,
} from "@/app/actions/closure";
import styles from "./sales-operability-panel.module.css";

type LatestClosure = { id: string; status: string; version: number } | null;
type Gate = { overall: string; operational: { status: string }; contractual: { status: string }; legal: { status: string }; financial: { status: string }; accounting: { status: string } };
type DistributionRow = { id: string; beneficiaryName: string; amount: unknown; status: string };
type ModalState = { type: "distribution" } | { type: "approve-distribution" } | { type: "reopen" } | null;
type ActionResult = { ok: boolean; error?: string };

const CLOSURE_STATUS: Record<string, string> = { DRAFT: "Em preparação", FINAL: "Encerrado", REOPENED: "Reaberto", CANCELLED: "Cancelado" };
const GATE_STATUS: Record<string, string> = { READY: "Apto", NOT_READY: "Pendente", PENDING: "Pendente", BLOCKED: "Bloqueado", OK: "Apto", APTO: "Apto", INAPTO: "Pendente" };
const gateLabel = (value: string) => GATE_STATUS[value] ?? value.replaceAll("_", " ");

export function ClosureOperabilityPanel({ projectId, latest, gate, canWrite, canApprove, canReopen }: { projectId: string; latest: LatestClosure; gate: Gate; canWrite: boolean; canApprove: boolean; canReopen: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [modal, setModal] = useState<ModalState>(null);
  const [distributions, setDistributions] = useState<DistributionRow[]>([]);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const run = (op: () => Promise<ActionResult>, success: string) => {
    setFeedback(null);
    startTransition(async () => {
      const result = await op();
      if (!result.ok) return setFeedback({ type: "error", text: result.error ?? "Não foi possível concluir a operação de encerramento." });
      setModal(null); setFeedback({ type: "success", text: success }); router.refresh();
    });
  };

  const openApproveDistribution = () => {
    if (!latest) return;
    setFeedback(null);
    startTransition(async () => {
      const listed = await listProjectClosureDistributionsAction(latest.id);
      if (!listed.ok) return setFeedback({ type: "error", text: listed.error });
      const pendingRows = listed.data.filter((row) => row.status === "DRAFT");
      if (pendingRows.length === 0) return setFeedback({ type: "error", text: "Não há distribuição em rascunho para aprovar." });
      setDistributions(pendingRows as DistributionRow[]); setModal({ type: "approve-distribution" });
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!modal || !latest) return;
    const data = new FormData(event.currentTarget);

    if (modal.type === "distribution") {
      const beneficiaryName = String(data.get("beneficiaryName") ?? "").trim();
      const beneficiaryTaxId = String(data.get("beneficiaryTaxId") ?? "").trim();
      const beneficiaryType = String(data.get("beneficiaryType") ?? "PARTNER") as "OWNER" | "PARTNER" | "INVESTOR";
      const nature = String(data.get("nature") ?? "RESULT_DISTRIBUTION") as "CAPITAL_CONTRIBUTION" | "CAPITAL_RETURN" | "REMUNERATION" | "RESULT_DISTRIBUTION" | "RETENTION" | "PROVISION";
      const amount = Number(data.get("amount"));
      const sourceId = String(data.get("sourceId") ?? "").trim();
      if (!beneficiaryName || !beneficiaryTaxId || !sourceId || !Number.isFinite(amount) || amount <= 0) return setFeedback({ type: "error", text: "Revise beneficiário, documento, valor e referência da distribuição." });
      return run(() => createProjectClosureDistributionAction({ closureResultId: latest.id, beneficiaryName, beneficiaryTaxId, beneficiaryType, nature, amount, eventDate: new Date(), sourceType: "MANUAL_REFERENCE", sourceId, evidenceRefs: [{ type: "MANUAL_REFERENCE", id: sourceId }] }), "Distribuição registrada em rascunho.");
    }

    if (modal.type === "approve-distribution") {
      const distributionId = String(data.get("distributionId") ?? "");
      if (!distributionId) return setFeedback({ type: "error", text: "Selecione a distribuição que será aprovada." });
      return run(() => approveProjectClosureDistributionAction({ distributionId }), "Distribuição aprovada.");
    }

    const reason = String(data.get("reason") ?? "").trim();
    const evidence = String(data.get("evidence") ?? "").trim();
    if (!reason || !evidence) return setFeedback({ type: "error", text: "Informe a justificativa e a evidência da reabertura." });
    return run(() => reopenProjectClosureResultAction({ closureResultId: latest.id, reason, evidenceRefs: [{ type: "MANUAL_REFERENCE", reference: evidence }] }), "Encerramento reaberto com sucesso.");
  };

  return <section className="panel">
    {!canWrite && !canApprove && <div className="model-note"><div><strong>Modo de leitura</strong><p>Seu perfil pode consultar o encerramento, mas não preparar, distribuir, aprovar ou reabrir resultados.</p></div></div>}
    <div className="panel-heading"><div><span className="eyebrow">ENCERRAMENTO DO EMPREENDIMENTO</span><h2>Fechamento e distribuição de resultados</h2><p>Consolide as pendências operacionais, contratuais, jurídicas, financeiras e contábeis antes do encerramento definitivo.</p></div><div className="panel-actions">
      {!latest && <button className="button button-primary" disabled={pending || !canWrite} onClick={() => run(() => prepareProjectClosureResultAction({ projectId }), "Preparação do encerramento iniciada.")}><Archive size={15}/> Preparar encerramento</button>}
      {latest?.status === "DRAFT" && <><button className="button button-secondary" disabled={pending || !canWrite} onClick={() => setModal({ type: "distribution" })}><WalletCards size={15}/> Nova distribuição</button><button className="button button-secondary" disabled={pending || !canApprove} onClick={openApproveDistribution}>Aprovar distribuição</button><button className="button button-primary" disabled={pending || !canApprove || gate.overall !== "APTO"} onClick={() => run(() => approveProjectClosureResultAction({ closureResultId: latest.id }), "Encerramento aprovado.")}><CheckCircle2 size={15}/> Aprovar encerramento</button></>}
      {latest?.status === "FINAL" && <button className="button button-secondary" disabled={pending || !canReopen} onClick={() => setModal({ type: "reopen" })}><RotateCcw size={15}/> Reabrir</button>}
    </div></div>
    {feedback && <div className={feedback.type === "error" ? styles.error : styles.success}>{feedback.text}</div>}
    <div className="scenario-deltas"><span>Situação geral: <strong>{gateLabel(gate.overall)}</strong></span><span>Operacional: {gateLabel(gate.operational.status)}</span><span>Contratual: {gateLabel(gate.contractual.status)}</span><span>Jurídico: {gateLabel(gate.legal.status)}</span><span>Financeiro: {gateLabel(gate.financial.status)}</span><span>Contábil: {gateLabel(gate.accounting.status)}</span>{latest && <span>Versão: {latest.version} · {CLOSURE_STATUS[latest.status] ?? gateLabel(latest.status)}</span>}</div>

    {modal && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setModal(null); }}><div className={styles.modal} role="dialog" aria-modal="true"><div className={styles.modalHeader}><div><h3>{modal.type === "distribution" ? "Nova distribuição" : modal.type === "approve-distribution" ? "Aprovar distribuição" : "Reabrir encerramento"}</h3><p>{modal.type === "distribution" ? "Registre o beneficiário, a natureza, o valor e a evidência de origem." : modal.type === "approve-distribution" ? "Selecione um lançamento em rascunho para aprovação." : "A reabertura exige justificativa e evidência rastreável."}</p></div><button className={styles.closeButton} type="button" disabled={pending} onClick={() => setModal(null)} aria-label="Fechar">×</button></div><form className={styles.form} onSubmit={submit}><div className={styles.formGrid}>
      {modal.type === "distribution" && <><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="beneficiary-name">Beneficiário</label><input id="beneficiary-name" name="beneficiaryName" autoFocus required /></div><div className={styles.field}><label htmlFor="beneficiary-tax-id">CPF / CNPJ</label><input id="beneficiary-tax-id" name="beneficiaryTaxId" required /></div><div className={styles.field}><label htmlFor="beneficiary-type">Tipo de beneficiário</label><select id="beneficiary-type" name="beneficiaryType" defaultValue="PARTNER"><option value="OWNER">Proprietário</option><option value="PARTNER">Sócio</option><option value="INVESTOR">Investidor</option></select></div><div className={styles.field}><label htmlFor="distribution-nature">Natureza</label><select id="distribution-nature" name="nature" defaultValue="RESULT_DISTRIBUTION"><option value="RESULT_DISTRIBUTION">Distribuição de resultado</option><option value="CAPITAL_RETURN">Devolução de capital</option><option value="CAPITAL_CONTRIBUTION">Aporte de capital</option><option value="REMUNERATION">Remuneração</option><option value="RETENTION">Retenção</option><option value="PROVISION">Provisão</option></select></div><div className={styles.field}><label htmlFor="distribution-amount">Valor</label><input id="distribution-amount" name="amount" type="number" min="0.01" step="0.01" required /></div><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="distribution-source-id">Documento ou referência de origem</label><input id="distribution-source-id" name="sourceId" required /></div></>}
      {modal.type === "approve-distribution" && <div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="distribution-id">Distribuição em rascunho</label><select id="distribution-id" name="distributionId" defaultValue="" required><option value="" disabled>Selecione</option>{distributions.map((row) => <option key={row.id} value={row.id}>{row.beneficiaryName} · {Number(row.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</option>)}</select></div>}
      {modal.type === "reopen" && <><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="reopen-reason">Justificativa da reabertura</label><textarea id="reopen-reason" name="reason" autoFocus required /></div><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="reopen-evidence">Evidência / referência</label><input id="reopen-evidence" name="evidence" required /></div></>}
    </div>{feedback?.type === "error" && <div className={styles.error}>{feedback.text}</div>}<div className={styles.modalActions}><button type="button" className="button button-secondary" disabled={pending} onClick={() => setModal(null)}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending}>{pending ? "Processando..." : "Confirmar"}</button></div></form></div></div>}
  </section>;
}