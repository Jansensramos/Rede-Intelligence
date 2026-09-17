"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, CirclePlus, UserPlus } from "lucide-react";
import type { PeoplePerformanceWorkspaceView } from "@/application/people-performance/people-performance-service";
import {
  addCausalHypothesisAction,
  createCorrectiveActionAction,
  createDepartmentAction,
  createPersonProfileAction,
  createPositionAction,
  startRootCauseInvestigationAction,
  transitionCorrectiveActionAction,
} from "@/app/actions/people";
import styles from "./sales-operability-panel.module.css";

type ModalState =
  | { type: "department" }
  | { type: "position" }
  | { type: "person" }
  | { type: "investigation"; varianceId: string; label: string }
  | { type: "hypothesis"; investigationId: string; label: string }
  | { type: "action"; investigationId: string; label: string }
  | null;

type ActionResult = { ok: boolean; error?: string };
type RootCauseCategory = "PROCESS" | "PEOPLE" | "PLANNING" | "SUPPLIER" | "TECHNICAL" | "COMMERCIAL" | "LEGAL" | "EXTERNAL" | "OTHER";

const VARIANCE_STATUS: Record<string, string> = {
  UNCLASSIFIED: "Não classificado",
  UNDER_ANALYSIS: "Em análise",
  CLASSIFIED: "Classificado",
  VALIDATED: "Validado",
  CLOSED: "Encerrado",
};
const ACTION_STATUS: Record<string, string> = {
  DRAFT: "Rascunho",
  PENDING_APPROVAL: "Aguardando aprovação",
  ACTIVE: "Ativa",
  BLOCKED: "Bloqueada",
  COMPLETED: "Concluída",
  VERIFIED: "Verificada",
  CANCELLED: "Cancelada",
};
const PRIORITY: Record<string, string> = { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta", CRITICAL: "Crítica" };

export function PeopleOperabilityPanel({ workspace }: { workspace: PeoplePerformanceWorkspaceView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [modal, setModal] = useState<ModalState>(null);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

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

    if (modal.type === "department") {
      const code = String(data.get("code") ?? "").trim();
      const name = String(data.get("name") ?? "").trim();
      const parentId = String(data.get("parentId") ?? "").trim() || null;
      const description = String(data.get("description") ?? "").trim() || null;
      if (!code || !name) return setFeedback({ type: "error", text: "Preencha código e nome do departamento." });
      return run(() => createDepartmentAction({ code, name, parentId, description }), "Departamento criado com sucesso.");
    }

    if (modal.type === "position") {
      const code = String(data.get("code") ?? "").trim();
      const title = String(data.get("title") ?? "").trim();
      const departmentId = String(data.get("departmentId") ?? "").trim() || null;
      const level = String(data.get("level") ?? "").trim() || null;
      if (!code || !title) return setFeedback({ type: "error", text: "Preencha código e título do cargo." });
      return run(() => createPositionAction({ code, title, departmentId, level }), "Cargo criado com sucesso.");
    }

    if (modal.type === "person") {
      const fullName = String(data.get("fullName") ?? "").trim();
      const preferredName = String(data.get("preferredName") ?? "").trim() || null;
      const professionalId = String(data.get("professionalId") ?? "").trim() || null;
      const email = String(data.get("email") ?? "").trim() || null;
      const phone = String(data.get("phone") ?? "").trim() || null;
      if (!fullName) return setFeedback({ type: "error", text: "Informe o nome completo." });
      return run(() => createPersonProfileAction({ fullName, preferredName, professionalId, email, phone }), "Pessoa cadastrada com sucesso.");
    }

    if (modal.type === "investigation") {
      const problemStatement = String(data.get("problemStatement") ?? "").trim();
      const scope = String(data.get("scope") ?? "").trim() || undefined;
      if (!problemStatement) return setFeedback({ type: "error", text: "Descreva o problema que será investigado." });
      return run(() => startRootCauseInvestigationAction(modal.varianceId, problemStatement, scope), "Investigação iniciada.");
    }

    if (modal.type === "hypothesis") {
      const category = String(data.get("category") ?? "OTHER") as RootCauseCategory;
      const description = String(data.get("description") ?? "").trim();
      if (!description) return setFeedback({ type: "error", text: "Descreva a hipótese causal." });
      return run(() => addCausalHypothesisAction(modal.investigationId, category, description), "Hipótese registrada.");
    }

    const title = String(data.get("title") ?? "").trim();
    const description = String(data.get("description") ?? "").trim();
    const priority = String(data.get("priority") ?? "MEDIUM") as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    const dueDateValue = String(data.get("dueDate") ?? "");
    const dueDate = dueDateValue ? new Date(`${dueDateValue}T00:00:00Z`) : null;
    if (!title || !description) return setFeedback({ type: "error", text: "Preencha título e descrição da ação corretiva." });
    return run(() => createCorrectiveActionAction(modal.investigationId, title, description, priority, dueDate), "Ação corretiva criada.");
  };

  const actions = workspace.varianceCases.flatMap((item) => item.investigation?.actions ?? []);

  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">PESSOAS E DESEMPENHO</span><h2>Estrutura, causas e ações</h2><p>Cadastre a estrutura organizacional, investigue desvios e acompanhe ações corretivas da equipe.</p></div><div className="panel-actions"><button className="button button-secondary" disabled={pending || !workspace.permissions.canManagePeople} onClick={() => setModal({ type: "department" })}><Building2 size={15}/> Departamento</button><button className="button button-secondary" disabled={pending || !workspace.permissions.canManagePeople} onClick={() => setModal({ type: "position" })}><CirclePlus size={15}/> Cargo</button><button className="button button-primary" disabled={pending || !workspace.permissions.canManagePeople} onClick={() => setModal({ type: "person" })}><UserPlus size={15}/> Pessoa</button></div></div>
    {feedback && <div className={feedback.type === "error" ? styles.error : styles.success}>{feedback.text}</div>}
    <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Desvio</th><th>Situação</th><th>Investigação</th><th>Ação</th></tr></thead><tbody>{workspace.varianceCases.map((item) => <tr key={item.id}><td><strong>{item.code} · {item.title}</strong></td><td>{VARIANCE_STATUS[item.status] ?? item.status}</td><td>{item.investigation ? item.investigation.problemStatement : "Não iniciada"}</td><td>{!item.investigation ? <button className="button button-secondary" disabled={pending} onClick={() => setModal({ type: "investigation", varianceId: item.id, label: `${item.code} · ${item.title}` })}>Investigar causa</button> : <div className="panel-actions"><button className="button button-secondary" disabled={pending} onClick={() => setModal({ type: "hypothesis", investigationId: item.investigation!.id, label: `${item.code} · ${item.title}` })}>Hipótese</button><button className="button button-secondary" disabled={pending} onClick={() => setModal({ type: "action", investigationId: item.investigation!.id, label: `${item.code} · ${item.title}` })}>Nova ação</button></div>}</td></tr>)}{workspace.varianceCases.length === 0 && <tr><td colSpan={4}>Nenhum desvio registrado. Os desvios são gerados pela análise de eficiência.</td></tr>}</tbody></table></div>
    {actions.length > 0 && <div className="data-table-scroll" style={{ marginTop: 18 }}><table className="data-table"><thead><tr><th>Ação corretiva</th><th>Prioridade</th><th>Situação</th><th>Próxima etapa</th></tr></thead><tbody>{actions.map((action) => <tr key={action.id}><td>{action.title}</td><td>{PRIORITY[action.priority] ?? action.priority}</td><td>{ACTION_STATUS[action.status] ?? action.status}</td><td>{action.status === "DRAFT" && <button className="button button-secondary" disabled={pending} onClick={() => run(() => transitionCorrectiveActionAction(action.id, "PENDING_APPROVAL"), "Ação enviada para aprovação.")}>Enviar para aprovação</button>}{action.status === "PENDING_APPROVAL" && <button className="button button-secondary" disabled={pending} onClick={() => run(() => transitionCorrectiveActionAction(action.id, "ACTIVE"), "Ação aprovada e ativada.")}>Aprovar e ativar</button>}{action.status === "ACTIVE" && <button className="button button-secondary" disabled={pending} onClick={() => run(() => transitionCorrectiveActionAction(action.id, "COMPLETED"), "Ação concluída.")}>Concluir</button>}{action.status === "COMPLETED" && <button className="button button-secondary" disabled={pending || action.evidence === 0} onClick={() => run(() => transitionCorrectiveActionAction(action.id, "VERIFIED"), "Ação verificada.")}>Verificar</button>}</td></tr>)}</tbody></table></div>}

    {modal && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setModal(null); }}><div className={styles.modal} role="dialog" aria-modal="true"><div className={styles.modalHeader}><div><h3>{modal.type === "department" ? "Novo departamento" : modal.type === "position" ? "Novo cargo" : modal.type === "person" ? "Nova pessoa" : modal.type === "investigation" ? "Iniciar investigação" : modal.type === "hypothesis" ? "Nova hipótese causal" : "Nova ação corretiva"}</h3><p>{"label" in modal ? modal.label : "Cadastre os dados necessários para esta etapa."}</p></div><button className={styles.closeButton} type="button" disabled={pending} onClick={() => setModal(null)} aria-label="Fechar">×</button></div><form className={styles.form} onSubmit={submit}><div className={styles.formGrid}>
      {modal.type === "department" && <><div className={styles.field}><label htmlFor="department-code">Código</label><input id="department-code" name="code" autoFocus required /></div><div className={styles.field}><label htmlFor="department-name">Nome</label><input id="department-name" name="name" required /></div><div className={styles.field}><label htmlFor="department-parent">Departamento superior</label><select id="department-parent" name="parentId" defaultValue=""><option value="">Sem departamento superior</option>{workspace.departments.map((department) => <option key={department.id} value={department.id}>{department.code} · {department.name}</option>)}</select></div><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="department-description">Descrição</label><textarea id="department-description" name="description" /></div></>}
      {modal.type === "position" && <><div className={styles.field}><label htmlFor="position-code">Código</label><input id="position-code" name="code" autoFocus required /></div><div className={styles.field}><label htmlFor="position-title">Título do cargo</label><input id="position-title" name="title" required /></div><div className={styles.field}><label htmlFor="position-department">Departamento</label><select id="position-department" name="departmentId" defaultValue=""><option value="">Sem departamento</option>{workspace.departments.map((department) => <option key={department.id} value={department.id}>{department.code} · {department.name}</option>)}</select></div><div className={styles.field}><label htmlFor="position-level">Nível</label><input id="position-level" name="level" placeholder="Ex.: Coordenação, Gerência, Diretoria" /></div></>}
      {modal.type === "person" && <><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="person-name">Nome completo</label><input id="person-name" name="fullName" autoFocus required /></div><div className={styles.field}><label htmlFor="person-preferred">Nome preferencial</label><input id="person-preferred" name="preferredName" /></div><div className={styles.field}><label htmlFor="person-professional-id">Registro profissional</label><input id="person-professional-id" name="professionalId" /></div><div className={styles.field}><label htmlFor="person-email">E-mail</label><input id="person-email" name="email" type="email" /></div><div className={styles.field}><label htmlFor="person-phone">Telefone</label><input id="person-phone" name="phone" /></div></>}
      {modal.type === "investigation" && <><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="investigation-problem">Problema a investigar</label><textarea id="investigation-problem" name="problemStatement" autoFocus required /></div><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="investigation-scope">Escopo</label><textarea id="investigation-scope" name="scope" placeholder="Opcional: delimite área, período ou processo analisado." /></div></>}
      {modal.type === "hypothesis" && <><div className={styles.field}><label htmlFor="hypothesis-category">Categoria</label><select id="hypothesis-category" name="category" defaultValue="OTHER"><option value="PROCESS">Processo</option><option value="PEOPLE">Pessoas</option><option value="PLANNING">Planejamento</option><option value="SUPPLIER">Fornecedor</option><option value="TECHNICAL">Técnica</option><option value="COMMERCIAL">Comercial</option><option value="LEGAL">Jurídica</option><option value="EXTERNAL">Externa</option><option value="OTHER">Outra</option></select></div><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="hypothesis-description">Descrição</label><textarea id="hypothesis-description" name="description" autoFocus required /></div></>}
      {modal.type === "action" && <><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="action-title">Título da ação</label><input id="action-title" name="title" autoFocus required /></div><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="action-description">Descrição</label><textarea id="action-description" name="description" required /></div><div className={styles.field}><label htmlFor="action-priority">Prioridade</label><select id="action-priority" name="priority" defaultValue="MEDIUM"><option value="LOW">Baixa</option><option value="MEDIUM">Média</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></div><div className={styles.field}><label htmlFor="action-due-date">Prazo</label><input id="action-due-date" name="dueDate" type="date" /></div></>}
    </div>{feedback?.type === "error" && <div className={styles.error}>{feedback.text}</div>}<div className={styles.modalActions}><button type="button" className="button button-secondary" disabled={pending} onClick={() => setModal(null)}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending}>{pending ? "Salvando..." : "Confirmar"}</button></div></form></div></div>}
  </section>;
}