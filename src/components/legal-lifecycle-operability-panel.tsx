"use client";

import { FormEvent, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileSearch, Gavel, Landmark, Scale } from "lucide-react";
import type { LegalWorkspaceView } from "@/application/legal/legal-service";
import {
  acknowledgeLegalAlertAction,
  createLegalAuthorityProcessAction,
  createLegalDocumentRequestAction,
  createLegalFindingAction,
  createLegalLicenseAction,
  createLegalObligationAction,
  resolveLegalAlertAction,
  updateLegalAuthorityProcessStatusAction,
  updateLegalDocumentRequestStatusAction,
  updateLegalFindingStatusAction,
  updateLegalLicenseStatusAction,
  updateLegalObligationStatusAction,
} from "@/app/actions/legal";
import styles from "./sales-operability-panel.module.css";

type Modal =
  | { type: "document"; caseId: string; label: string }
  | { type: "finding"; caseId: string; label: string }
  | { type: "license" }
  | { type: "process" }
  | { type: "obligation" }
  | null;

type Result = { ok: boolean; error?: string };

export function LegalLifecycleOperabilityPanel({
  workspace,
  canWrite,
  canApprove,
}: {
  workspace: LegalWorkspaceView;
  canWrite: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [modal, setModal] = useState<Modal>(null);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const run = (operation: () => Promise<Result>, success: string) => {
    setFeedback(null);
    startTransition(async () => {
      const result = await operation();
      if (!result.ok) {
        setFeedback({ type: "error", text: result.error ?? "Não foi possível concluir a operação jurídica." });
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

    if (modal.type === "document") {
      const code = text(data, "code");
      const documentType = text(data, "documentType");
      const title = text(data, "title");
      const due = text(data, "dueAt");
      if (!code || !documentType || !title) return setFeedback({ type: "error", text: "Preencha código, tipo e título do documento." });
      return run(() => createLegalDocumentRequestAction(modal.caseId, {
        code,
        documentType,
        title,
        dueAt: due ? new Date(due + "T00:00:00Z") : null,
      }), "Pedido documental criado.");
    }

    if (modal.type === "finding") {
      const code = text(data, "code");
      const category = text(data, "category");
      const title = text(data, "title");
      const description = text(data, "description");
      const recommendation = text(data, "recommendation");
      const target = text(data, "targetDate");
      if (!code || !category || !title || !description || !recommendation) return setFeedback({ type: "error", text: "Preencha os dados obrigatórios do achado." });
      return run(() => createLegalFindingAction(modal.caseId, {
        code,
        category,
        severity: String(data.get("severity") ?? "MEDIUM") as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
        title,
        description,
        recommendation,
        targetDate: target ? new Date(target + "T00:00:00Z") : null,
      }), "Achado jurídico registrado.");
    }

    if (modal.type === "license") {
      const code = text(data, "code");
      const type = text(data, "licenseType");
      const title = text(data, "title");
      const authority = text(data, "authority");
      const expires = text(data, "expiresAt");
      if (!code || !type || !title || !authority) return setFeedback({ type: "error", text: "Preencha código, tipo, título e órgão." });
      return run(() => createLegalLicenseAction({
        projectId: workspace.projectId,
        code,
        type,
        title,
        authority,
        processNumber: text(data, "processNumber") || null,
        expiresAt: expires ? new Date(expires + "T00:00:00Z") : null,
        renewalLeadDays: Number(data.get("renewalLeadDays") ?? 90),
      }), "Licença cadastrada.");
    }

    if (modal.type === "process") {
      const code = text(data, "code");
      const authority = text(data, "authority");
      const processNumber = text(data, "processNumber");
      const subject = text(data, "subject");
      const expected = text(data, "expectedDecisionAt");
      if (!code || !authority || !processNumber || !subject) return setFeedback({ type: "error", text: "Preencha código, órgão, processo e assunto." });
      return run(() => createLegalAuthorityProcessAction({
        projectId: workspace.projectId,
        code,
        authority,
        processNumber,
        subject,
        expectedDecisionAt: expected ? new Date(expected + "T00:00:00Z") : null,
      }), "Processo administrativo cadastrado.");
    }

    const code = text(data, "code");
    const type = text(data, "obligationType");
    const title = text(data, "title");
    const description = text(data, "description");
    const dueAt = text(data, "dueAt");
    const amountRaw = text(data, "amount");
    if (!code || !type || !title || !description || !dueAt) return setFeedback({ type: "error", text: "Preencha os dados obrigatórios da obrigação." });
    return run(() => createLegalObligationAction({
      projectId: workspace.projectId,
      code,
      type,
      title,
      description,
      criticality: String(data.get("criticality") ?? "MEDIUM") as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
      dueAt: new Date(dueAt + "T00:00:00Z"),
      amount: amountRaw ? Number(amountRaw) : null,
      supplierId: text(data, "supplierId") || null,
      companyId: text(data, "companyId") || null,
    }), "Obrigação jurídica cadastrada.");
  };

  const requests = workspace.cases.flatMap((item) => item.documentRequests.map((request) => ({ ...request, caseTitle: item.title })));
  const findings = workspace.cases.flatMap((item) => item.findings.map((finding) => ({ ...finding, caseTitle: item.title })));

  return <section className="panel">
    <div className="panel-heading">
      <div><span className="eyebrow">CICLO JURÍDICO COMPLETO</span><h2>Documentos, achados, licenças, processos e obrigações</h2><p>Gerencie os registros jurídicos especializados já existentes no domínio, com status e auditoria.</p></div>
      <div className="panel-actions">
        <button className="button button-secondary" disabled={pending || !canWrite || workspace.cases.length === 0} onClick={() => setModal({ type: "document", caseId: workspace.cases[0]!.id, label: workspace.cases[0]!.title })}><FileSearch size={15}/> Pedido documental</button>
        <button className="button button-secondary" disabled={pending || !canWrite || workspace.cases.length === 0} onClick={() => setModal({ type: "finding", caseId: workspace.cases[0]!.id, label: workspace.cases[0]!.title })}><AlertTriangle size={15}/> Achado</button>
        <button className="button button-secondary" disabled={pending || !canWrite} onClick={() => setModal({ type: "license" })}><Landmark size={15}/> Licença</button>
        <button className="button button-secondary" disabled={pending || !canWrite} onClick={() => setModal({ type: "process" })}><Scale size={15}/> Processo</button>
        <button className="button button-primary" disabled={pending || !canWrite} onClick={() => setModal({ type: "obligation" })}><Gavel size={15}/> Obrigação</button>
      </div>
    </div>

    {feedback && <div className={feedback.type === "error" ? styles.error : styles.success}>{feedback.text}</div>}

    <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Frente</th><th>Registro</th><th>Situação</th><th>Ação</th></tr></thead><tbody>
      {requests.slice(0, 8).map((item) => <tr key={"doc-" + item.id}><td>Documento</td><td><strong>{item.code} · {item.title}</strong><small>{item.caseTitle}</small></td><td>{item.status}</td><td><select disabled={pending || !canWrite} value={item.status} onChange={(event) => run(() => updateLegalDocumentRequestStatusAction(item.id, event.target.value as Parameters<typeof updateLegalDocumentRequestStatusAction>[1]), "Status documental atualizado.")}>{documentStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}</select></td></tr>)}
      {findings.slice(0, 8).map((item) => <tr key={"finding-" + item.id}><td>Achado</td><td><strong>{item.code} · {item.title}</strong><small>{item.severity} · {item.caseTitle}</small></td><td>{item.status}</td><td><select disabled={pending || !canWrite} value={item.status} onChange={(event) => run(() => updateLegalFindingStatusAction(item.id, event.target.value as Parameters<typeof updateLegalFindingStatusAction>[1]), "Status do achado atualizado.")}>{findingStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}</select></td></tr>)}
      {workspace.licenses.slice(0, 8).map((item) => <tr key={"license-" + item.id}><td>Licença</td><td><strong>{item.code} · {item.title}</strong><small>{item.authority}</small></td><td>{item.status}</td><td><select disabled={pending || !canWrite} value={item.status} onChange={(event) => run(() => updateLegalLicenseStatusAction(item.id, event.target.value as Parameters<typeof updateLegalLicenseStatusAction>[1]), "Status da licença atualizado.")}>{licenseStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}</select></td></tr>)}
      {workspace.processes.slice(0, 8).map((item) => <tr key={"process-" + item.id}><td>Processo</td><td><strong>{item.code} · {item.subject}</strong><small>{item.authority} · {item.processNumber}</small></td><td>{item.status}</td><td><select disabled={pending || !canWrite} value={item.status} onChange={(event) => run(() => updateLegalAuthorityProcessStatusAction(item.id, event.target.value as Parameters<typeof updateLegalAuthorityProcessStatusAction>[1]), "Status do processo atualizado.")}>{processStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}</select></td></tr>)}
      {workspace.obligations.slice(0, 8).map((item) => <tr key={"obligation-" + item.id}><td>Obrigação</td><td><strong>{item.code} · {item.title}</strong><small>{item.criticality}</small></td><td>{item.status}</td><td><select disabled={pending || (!canWrite && !canApprove)} value={item.status} onChange={(event) => run(() => updateLegalObligationStatusAction(item.id, event.target.value as Parameters<typeof updateLegalObligationStatusAction>[1]), "Status da obrigação atualizado.")}>{obligationStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}</select></td></tr>)}
      {workspace.alerts.slice(0, 6).map((item) => <tr key={"alert-" + item.id}><td>Alerta</td><td><strong>{item.title}</strong><small>{item.message}</small></td><td>{item.status}</td><td><div className="panel-actions">{item.status === "OPEN" && <button className="text-button" disabled={pending || !canWrite} onClick={() => run(() => acknowledgeLegalAlertAction(item.id), "Alerta reconhecido.")}>Reconhecer</button>}<button className="text-button" disabled={pending || !canWrite} onClick={() => run(() => resolveLegalAlertAction(item.id), "Alerta resolvido.")}>Resolver</button></div></td></tr>)}
    </tbody></table></div>

    {modal && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setModal(null); }}><div className={styles.modal} role="dialog" aria-modal="true">
      <div className={styles.modalHeader}><div><h3>{modalTitle(modal.type)}</h3><p>{"label" in modal && modal.label ? modal.label : "Registro jurídico auditável."}</p></div><button type="button" className={styles.closeButton} disabled={pending} onClick={() => setModal(null)}>×</button></div>
      <form className={styles.form} onSubmit={submit}><div className={styles.formGrid}>
        {modal.type === "document" && <><Field label="Código"><input name="code" required /></Field><Field label="Tipo"><input name="documentType" required /></Field><Field label="Título" full><input name="title" required /></Field><Field label="Prazo"><input name="dueAt" type="date" /></Field></>}
        {modal.type === "finding" && <><Field label="Código"><input name="code" required /></Field><Field label="Categoria"><input name="category" required /></Field><Field label="Severidade"><select name="severity" defaultValue="MEDIUM"><option value="LOW">Baixa</option><option value="MEDIUM">Média</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></Field><Field label="Prazo"><input name="targetDate" type="date" /></Field><Field label="Título" full><input name="title" required /></Field><Field label="Descrição" full><textarea name="description" required /></Field><Field label="Recomendação" full><textarea name="recommendation" required /></Field></>}
        {modal.type === "license" && <><Field label="Código"><input name="code" required /></Field><Field label="Tipo"><input name="licenseType" required /></Field><Field label="Título" full><input name="title" required /></Field><Field label="Órgão"><input name="authority" required /></Field><Field label="Nº processo"><input name="processNumber" /></Field><Field label="Validade"><input name="expiresAt" type="date" /></Field><Field label="Antecedência renovação (dias)"><input name="renewalLeadDays" type="number" min="0" defaultValue="90" /></Field></>}
        {modal.type === "process" && <><Field label="Código"><input name="code" required /></Field><Field label="Órgão"><input name="authority" required /></Field><Field label="Nº processo"><input name="processNumber" required /></Field><Field label="Decisão esperada"><input name="expectedDecisionAt" type="date" /></Field><Field label="Assunto" full><textarea name="subject" required /></Field></>}
        {modal.type === "obligation" && <><Field label="Código"><input name="code" required /></Field><Field label="Tipo"><input name="obligationType" required /></Field><Field label="Título" full><input name="title" required /></Field><Field label="Criticidade"><select name="criticality" defaultValue="MEDIUM"><option value="LOW">Baixa</option><option value="MEDIUM">Média</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></Field><Field label="Vencimento"><input name="dueAt" type="date" required /></Field><Field label="Valor"><input name="amount" type="number" min="0" step="0.01" /></Field><Field label="Favorecido"><select name="supplierId" defaultValue=""><option value="">Não informado</option>{workspace.suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Empresa / SPE"><select name="companyId" defaultValue=""><option value="">Não informada</option>{workspace.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Descrição" full><textarea name="description" required /></Field></>}
      </div><div className={styles.modalActions}><button type="button" className="button button-secondary" disabled={pending} onClick={() => setModal(null)}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending}>{pending ? "Salvando..." : "Confirmar"}</button></div></form>
    </div></div>}
  </section>;
}

function text(data: FormData, key: string) {
  return String(data.get(key) ?? "").trim();
}

function Field({ label, children, full = false }: { label: string; children: ReactNode; full?: boolean }) {
  return <div className={full ? styles.field + " " + styles.fieldFull : styles.field}><label>{label}</label>{children}</div>;
}

function modalTitle(type: NonNullable<Modal>["type"]) {
  return ({
    document: "Novo pedido documental",
    finding: "Novo achado jurídico",
    license: "Nova licença",
    process: "Novo processo administrativo",
    obligation: "Nova obrigação jurídica",
  } as const)[type];
}

const documentStatusOptions = ["REQUESTED", "RECEIVED", "UNDER_REVIEW", "COMPLIANT", "NON_COMPLIANT", "WAIVED", "EXPIRED", "RESOLVED", "CANCELLED"] as const;
const findingStatusOptions = ["UNDER_REVIEW", "COMPLIANT", "NON_COMPLIANT", "WAIVED", "RESOLVED", "CANCELLED"] as const;
const licenseStatusOptions = ["NOT_STARTED", "IN_PREPARATION", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "APPROVED_WITH_CONDITIONS", "REJECTED", "SUSPENDED", "EXPIRED", "RENEWAL_REQUIRED"] as const;
const processStatusOptions = ["IN_PREPARATION", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "APPROVED_WITH_CONDITIONS", "REJECTED", "SUSPENDED", "EXPIRED", "RENEWAL_REQUIRED"] as const;
const obligationStatusOptions = ["ACTIVE", "DUE_SOON", "OVERDUE", "FULFILLED", "WAIVED", "CANCELLED"] as const;
