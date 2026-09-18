"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, CirclePlus, UserPlus } from "lucide-react";
import type { PeoplePerformanceWorkspaceView } from "@/application/people-performance/people-performance-service";
import {
  addCausalEvidenceAction,
  addCausalHypothesisAction,
  addCorrectiveActionEvidenceAction,
  addExternalDependencyAction,
  allocateRootCauseAction,
  createCorrectiveActionAction,
  createDepartmentAction,
  createPerformanceVarianceAction,
  createPersonProfileAction,
  createPositionAction,
  startRootCauseInvestigationAction,
  transitionCausalHypothesisAction,
  transitionCorrectiveActionAction,
  transitionExternalDependencyAction,
  transitionPerformanceVarianceAction,
} from "@/app/actions/people";
import styles from "./sales-operability-panel.module.css";

type ModalState =
  | { type: "variance" }
  | { type: "department" }
  | { type: "position" }
  | { type: "person" }
  | { type: "investigation"; varianceId: string; label: string }
  | { type: "hypothesis"; investigationId: string; label: string }
  | { type: "evidence"; hypothesisId: string; label: string }
  | { type: "allocation"; investigationId: string; hypothesisId: string; label: string; currentRate: number }
  | { type: "dependency"; investigationId: string; label: string }
  | { type: "action"; investigationId: string; label: string }
  | { type: "actionEvidence"; actionId: string; label: string }
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

    if (modal.type === "variance") {
      const code = String(data.get("code") ?? "").trim();
      const title = String(data.get("title") ?? "").trim();
      const type = String(data.get("type") ?? "CASH") as "CASH" | "COMMITMENT" | "PHYSICAL" | "PRODUCTIVITY" | "QUALITY" | "DEADLINE";
      if (!code || !title) return setFeedback({ type: "error", text: "Preencha código e título do desvio." });
      const referenceFrom = new Date(String(data.get("referenceFrom")) + "T00:00:00Z");
      const referenceTo = new Date(String(data.get("referenceTo")) + "T00:00:00Z");
      const dueValue = String(data.get("dueDate") ?? "");
      return run(() => createPerformanceVarianceAction({
        projectId: workspace.projectId, code, title, type,
        plannedAmount: Number(data.get("plannedAmount") || 0),
        committedAmount: Number(data.get("committedAmount") || 0),
        measuredAmount: Number(data.get("measuredAmount") || 0),
        actualAmount: Number(data.get("actualAmount") || 0),
        forecastAmount: Number(data.get("forecastAmount") || 0),
        plannedProgress: Number(data.get("plannedProgress") || 0),
        actualProgress: Number(data.get("actualProgress") || 0),
        referenceFrom, referenceTo,
        dueDate: dueValue ? new Date(dueValue + "T00:00:00Z") : null,
      }), "Desvio de desempenho registrado.");
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

    if (modal.type === "evidence") {
      const evidenceType = String(data.get("evidenceType") ?? "DOCUMENT").trim();
      const title = String(data.get("title") ?? "").trim();
      const sourceRef = String(data.get("sourceRef") ?? "").trim();
      const description = String(data.get("description") ?? "").trim() || null;
      const supports = String(data.get("supports") ?? "true") === "true";
      if (!title || !sourceRef) return setFeedback({ type: "error", text: "Informe título e referência da evidência." });
      return run(() => addCausalEvidenceAction(modal.hypothesisId, { evidenceType, title, sourceRef, description, supports }), "Evidência causal vinculada.");
    }

    if (modal.type === "allocation") {
      const contributionRate = Number(data.get("contributionRate") || 0) / 100;
      const amountImpactValue = String(data.get("amountImpact") ?? "").trim();
      const rationale = String(data.get("rationale") ?? "").trim();
      const validate = String(data.get("validate") ?? "false") === "true";
      if (!(contributionRate > 0 && contributionRate <= 1)) return setFeedback({ type: "error", text: "Informe contribuição entre 0% e 100%." });
      if (!rationale) return setFeedback({ type: "error", text: "Informe a justificativa da alocação." });
      return run(() => allocateRootCauseAction({
        investigationId: modal.investigationId,
        hypothesisId: modal.hypothesisId,
        contributionRate,
        amountImpact: amountImpactValue ? Number(amountImpactValue) : null,
        rationale,
        validate,
      }), validate ? "Causa alocada e validada." : "Causa alocada.");
    }

    if (modal.type === "dependency") {
      const name = String(data.get("name") ?? "").trim();
      const description = String(data.get("description") ?? "").trim();
      const owner = String(data.get("owner") ?? "").trim() || null;
      const evidenceRef = String(data.get("evidenceRef") ?? "").trim() || null;
      const dueDateValue = String(data.get("dueDate") ?? "");
      if (!name || !description) return setFeedback({ type: "error", text: "Informe nome e descrição da dependência." });
      return run(() => addExternalDependencyAction({
        investigationId: modal.investigationId,
        name,
        description,
        owner,
        evidenceRef,
        dueDate: dueDateValue ? new Date(`${dueDateValue}T00:00:00Z`) : null,
      }), "Dependência externa registrada.");
    }

    if (modal.type === "actionEvidence") {
      const title = String(data.get("title") ?? "").trim();
      const sourceRef = String(data.get("sourceRef") ?? "").trim();
      const notes = String(data.get("notes") ?? "").trim() || null;
      if (!title || !sourceRef) return setFeedback({ type: "error", text: "Informe título e referência da evidência." });
      return run(() => addCorrectiveActionEvidenceAction(modal.actionId, title, sourceRef, notes), "Evidência de conclusão vinculada.");
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
    <div className="panel-heading"><div><span className="eyebrow">PESSOAS E DESEMPENHO</span><h2>Estrutura, causas e ações</h2><p>Cadastre a estrutura organizacional, investigue desvios e acompanhe ações corretivas da equipe.</p></div><div className="panel-actions"><button className="button button-secondary" disabled={pending || !workspace.permissions.canAnalyze} onClick={() => setModal({ type: "variance" })}>Registrar desvio</button><button className="button button-secondary" disabled={pending || !workspace.permissions.canManagePeople} onClick={() => setModal({ type: "department" })}><Building2 size={15}/> Departamento</button><button className="button button-secondary" disabled={pending || !workspace.permissions.canManagePeople} onClick={() => setModal({ type: "position" })}><CirclePlus size={15}/> Cargo</button><button className="button button-primary" disabled={pending || !workspace.permissions.canManagePeople} onClick={() => setModal({ type: "person" })}><UserPlus size={15}/> Pessoa</button></div></div>
    {feedback && <div className={feedback.type === "error" ? styles.error : styles.success}>{feedback.text}</div>}
    <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Desvio</th><th>Situação</th><th>Investigação</th><th>Ação</th></tr></thead><tbody>{workspace.varianceCases.map((item) => {
      const investigation = item.investigation;
      const acceptedWithEvidence = Boolean(investigation?.hypotheses.some((hypothesis) => hypothesis.status === "ACCEPTED" && hypothesis.evidence > 0));
      const allocationComplete = Boolean(investigation && Math.abs(investigation.allocatedCauseRate - 1) < 0.000001 && investigation.allCauseAllocationsValidated);
      const dependenciesClosed = Boolean(investigation && investigation.dependencies.every((dependency) => ["RESOLVED", "CANCELLED"].includes(dependency.status)));
      const actionsClosed = Boolean(investigation && investigation.actions.length > 0 && investigation.actions.every((action) => ["VERIFIED", "CANCELLED"].includes(action.status)));
      return <tr key={item.id}><td><strong>{item.code} · {item.title}</strong></td><td>
        <div>{VARIANCE_STATUS[item.status] ?? item.status}</div>
        <div className="panel-actions">
          {item.status === "UNCLASSIFIED" && <button className="text-button" disabled={pending || !workspace.permissions.canManageRootCause} onClick={() => run(() => transitionPerformanceVarianceAction(item.id, "UNDER_ANALYSIS"), "Análise do desvio iniciada.")}>Iniciar análise</button>}
          {item.status === "UNDER_ANALYSIS" && <button className="text-button" disabled={pending || !workspace.permissions.canManageRootCause || !acceptedWithEvidence} title={!acceptedWithEvidence ? "Aceite ao menos uma hipótese com evidência." : undefined} onClick={() => run(() => transitionPerformanceVarianceAction(item.id, "CLASSIFIED"), "Desvio classificado.")}>Classificar</button>}
          {item.status === "CLASSIFIED" && <button className="text-button" disabled={pending || !workspace.permissions.canManageRootCause || !allocationComplete} title={!allocationComplete ? "A alocação das causas deve totalizar 100% e estar validada." : undefined} onClick={() => run(() => transitionPerformanceVarianceAction(item.id, "VALIDATED"), "Desvio validado.")}>Validar</button>}
          {item.status === "VALIDATED" && <button className="text-button" disabled={pending || !workspace.permissions.canManageRootCause || !dependenciesClosed || !actionsClosed} title={!dependenciesClosed ? "Resolva ou cancele todas as dependências externas." : !actionsClosed ? "Verifique ou cancele todas as ações corretivas." : undefined} onClick={() => run(() => transitionPerformanceVarianceAction(item.id, "CLOSED"), "Desvio encerrado.")}>Encerrar</button>}
        </div>
      </td><td>
        {!investigation ? "Não iniciada" : <div style={{ display: "grid", gap: 8 }}>
          <strong>{investigation.problemStatement}</strong>
          <small>Causas alocadas: {(investigation.allocatedCauseRate * 100).toFixed(0)}% · {investigation.allCauseAllocationsValidated ? "validadas" : "pendentes de validação"}</small>
          {investigation.hypotheses.map((hypothesis) => <div key={hypothesis.id} className="model-note"><div style={{ width: "100%" }}>
            <strong>{hypothesis.category} · {hypothesis.status}</strong><p>{hypothesis.description}</p><small>Evidências: {hypothesis.evidence}{hypothesis.allocation ? ` · contribuição ${(hypothesis.allocation.contributionRate * 100).toFixed(0)}% · ${hypothesis.allocation.validated ? "validada" : "não validada"}` : ""}</small>
            <div className="panel-actions">
              <button className="text-button" disabled={pending || !workspace.permissions.canManageRootCause} onClick={() => setModal({ type: "evidence", hypothesisId: hypothesis.id, label: hypothesis.description })}>Evidência</button>
              {hypothesis.status === "PROPOSED" && <button className="text-button" disabled={pending || !workspace.permissions.canManageRootCause} onClick={() => run(() => transitionCausalHypothesisAction(hypothesis.id, "UNDER_REVIEW"), "Hipótese enviada para revisão.")}>Revisar</button>}
              {hypothesis.status === "UNDER_REVIEW" && <button className="text-button" disabled={pending || !workspace.permissions.canManageRootCause || hypothesis.evidence === 0} onClick={() => run(() => transitionCausalHypothesisAction(hypothesis.id, "ACCEPTED"), "Hipótese aceita.")}>Aceitar</button>}
              {["PROPOSED","UNDER_REVIEW"].includes(hypothesis.status) && <button className="text-button" disabled={pending || !workspace.permissions.canManageRootCause} onClick={() => run(() => transitionCausalHypothesisAction(hypothesis.id, "REJECTED"), "Hipótese rejeitada.")}>Rejeitar</button>}
              {hypothesis.status === "ACCEPTED" && <button className="text-button" disabled={pending || !workspace.permissions.canManageRootCause} onClick={() => setModal({ type: "allocation", investigationId: investigation.id, hypothesisId: hypothesis.id, label: hypothesis.description, currentRate: hypothesis.allocation?.contributionRate ?? 0 })}>{hypothesis.allocation ? "Revisar alocação" : "Alocar causa"}</button>}
            </div>
          </div></div>)}
          {investigation.dependencies.map((dependency) => <div key={dependency.id}><small><strong>Dependência:</strong> {dependency.name} · {dependency.status}{dependency.owner ? ` · ${dependency.owner}` : ""}</small>{["OPEN","MONITORED"].includes(dependency.status) && <div className="panel-actions">
            {dependency.status === "OPEN" && <button className="text-button" disabled={pending || !workspace.permissions.canManageRootCause} onClick={() => run(() => transitionExternalDependencyAction(dependency.id, "MONITORED"), "Dependência colocada em monitoramento.")}>Monitorar</button>}
            <button className="text-button" disabled={pending || !workspace.permissions.canManageRootCause} onClick={() => run(() => transitionExternalDependencyAction(dependency.id, "RESOLVED"), "Dependência resolvida.")}>Resolver</button>
            <button className="text-button" disabled={pending || !workspace.permissions.canManageRootCause} onClick={() => run(() => transitionExternalDependencyAction(dependency.id, "CANCELLED"), "Dependência cancelada.")}>Cancelar</button>
          </div>}</div>)}
        </div>}
      </td><td>{!investigation ? <button className="button button-secondary" disabled={pending || !workspace.permissions.canManageRootCause} onClick={() => setModal({ type: "investigation", varianceId: item.id, label: `${item.code} · ${item.title}` })}>Investigar causa</button> : <div className="panel-actions"><button className="button button-secondary" disabled={pending || !workspace.permissions.canManageRootCause} onClick={() => setModal({ type: "hypothesis", investigationId: investigation.id, label: `${item.code} · ${item.title}` })}>Hipótese</button><button className="button button-secondary" disabled={pending || !workspace.permissions.canManageRootCause} onClick={() => setModal({ type: "dependency", investigationId: investigation.id, label: `${item.code} · ${item.title}` })}>Dependência</button><button className="button button-secondary" disabled={pending || !workspace.permissions.canManageRootCause} onClick={() => setModal({ type: "action", investigationId: investigation.id, label: `${item.code} · ${item.title}` })}>Nova ação</button></div>}</td></tr>;
    })}{workspace.varianceCases.length === 0 && <tr><td colSpan={4}>Nenhum desvio registrado. Os desvios podem ser registrados manualmente ou gerados pela análise de eficiência.</td></tr>}</tbody></table></div>
    {actions.length > 0 && <div className="data-table-scroll" style={{ marginTop: 18 }}><table className="data-table"><thead><tr><th>Ação corretiva</th><th>Prioridade</th><th>Situação</th><th>Próxima etapa</th></tr></thead><tbody>{actions.map((action) => <tr key={action.id}><td><strong>{action.title}</strong><small>{action.evidence} evidência(s)</small></td><td>{PRIORITY[action.priority] ?? action.priority}</td><td>{ACTION_STATUS[action.status] ?? action.status}</td><td><div className="panel-actions">
      {action.status === "DRAFT" && <button className="button button-secondary" disabled={pending || !workspace.permissions.canManageRootCause} onClick={() => run(() => transitionCorrectiveActionAction(action.id, "PENDING_APPROVAL"), "Ação enviada para aprovação.")}>Enviar para aprovação</button>}
      {action.status === "PENDING_APPROVAL" && <button className="button button-secondary" disabled={pending || !workspace.permissions.canApproveAction} onClick={() => run(() => transitionCorrectiveActionAction(action.id, "ACTIVE"), "Ação aprovada e ativada.")}>Aprovar e ativar</button>}
      {action.status === "ACTIVE" && <button className="button button-secondary" disabled={pending || !workspace.permissions.canManageRootCause} onClick={() => run(() => transitionCorrectiveActionAction(action.id, "COMPLETED"), "Ação concluída.")}>Concluir</button>}
      {["ACTIVE","COMPLETED"].includes(action.status) && <button className="text-button" disabled={pending || !workspace.permissions.canManageRootCause} onClick={() => setModal({ type: "actionEvidence", actionId: action.id, label: action.title })}>Adicionar evidência</button>}
      {action.status === "COMPLETED" && <button className="button button-secondary" disabled={pending || action.evidence === 0 || !workspace.permissions.canVerifyAction} onClick={() => run(() => transitionCorrectiveActionAction(action.id, "VERIFIED"), "Ação verificada.")}>Verificar</button>}
    </div></td></tr>)}</tbody></table></div>}

    {modal && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setModal(null); }}><div className={styles.modal} role="dialog" aria-modal="true"><div className={styles.modalHeader}><div><h3>{modal.type === "variance" ? "Registrar desvio de desempenho" : modal.type === "department" ? "Novo departamento" : modal.type === "position" ? "Novo cargo" : modal.type === "person" ? "Nova pessoa" : modal.type === "investigation" ? "Iniciar investigação" : modal.type === "hypothesis" ? "Nova hipótese causal" : modal.type === "evidence" ? "Vincular evidência causal" : modal.type === "allocation" ? "Alocar causa raiz" : modal.type === "dependency" ? "Nova dependência externa" : modal.type === "actionEvidence" ? "Evidência da ação corretiva" : "Nova ação corretiva"}</h3><p>{"label" in modal ? modal.label : "Cadastre os dados necessários para esta etapa."}</p></div><button className={styles.closeButton} type="button" disabled={pending} onClick={() => setModal(null)} aria-label="Fechar">×</button></div><form className={styles.form} onSubmit={submit}><div className={styles.formGrid}>
      {modal.type === "variance" && <>
        <div className={styles.field}><label>Código</label><input name="code" autoFocus required placeholder="Ex.: DESV-001" /></div>
        <div className={styles.field + " " + styles.fieldFull}><label>Título</label><input name="title" required placeholder="Ex.: Desvio de custo da estrutura" /></div>
        <div className={styles.field}><label>Tipo</label><select name="type" defaultValue="CASH"><option value="CASH">Caixa</option><option value="COMMITMENT">Compromissos</option><option value="PHYSICAL">Avanço físico</option><option value="PRODUCTIVITY">Produtividade</option><option value="QUALITY">Qualidade</option><option value="DEADLINE">Prazo</option></select></div>
        <div className={styles.field}><label>Planejado (R$)</label><input name="plannedAmount" type="number" step="0.01" defaultValue="0" /></div>
        <div className={styles.field}><label>Comprometido (R$)</label><input name="committedAmount" type="number" step="0.01" defaultValue="0" /></div>
        <div className={styles.field}><label>Medido (R$)</label><input name="measuredAmount" type="number" step="0.01" defaultValue="0" /></div>
        <div className={styles.field}><label>Realizado (R$)</label><input name="actualAmount" type="number" step="0.01" defaultValue="0" /></div>
        <div className={styles.field}><label>Previsão final (R$)</label><input name="forecastAmount" type="number" step="0.01" defaultValue="0" /></div>
        <div className={styles.field}><label>Avanço planejado (%)</label><input name="plannedProgress" type="number" step="0.01" defaultValue="0" /></div>
        <div className={styles.field}><label>Avanço real (%)</label><input name="actualProgress" type="number" step="0.01" defaultValue="0" /></div>
        <div className={styles.field}><label>Período inicial</label><input name="referenceFrom" type="date" required /></div>
        <div className={styles.field}><label>Período final</label><input name="referenceTo" type="date" required /></div>
        <div className={styles.field}><label>Prazo para tratamento</label><input name="dueDate" type="date" /></div>
      </>}
      {modal.type === "department" && <><div className={styles.field}><label htmlFor="department-code">Código</label><input id="department-code" name="code" autoFocus required /></div><div className={styles.field}><label htmlFor="department-name">Nome</label><input id="department-name" name="name" required /></div><div className={styles.field}><label htmlFor="department-parent">Departamento superior</label><select id="department-parent" name="parentId" defaultValue=""><option value="">Sem departamento superior</option>{workspace.departments.map((department) => <option key={department.id} value={department.id}>{department.code} · {department.name}</option>)}</select></div><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="department-description">Descrição</label><textarea id="department-description" name="description" /></div></>}
      {modal.type === "position" && <><div className={styles.field}><label htmlFor="position-code">Código</label><input id="position-code" name="code" autoFocus required /></div><div className={styles.field}><label htmlFor="position-title">Título do cargo</label><input id="position-title" name="title" required /></div><div className={styles.field}><label htmlFor="position-department">Departamento</label><select id="position-department" name="departmentId" defaultValue=""><option value="">Sem departamento</option>{workspace.departments.map((department) => <option key={department.id} value={department.id}>{department.code} · {department.name}</option>)}</select></div><div className={styles.field}><label htmlFor="position-level">Nível</label><input id="position-level" name="level" placeholder="Ex.: Coordenação, Gerência, Diretoria" /></div></>}
      {modal.type === "person" && <><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="person-name">Nome completo</label><input id="person-name" name="fullName" autoFocus required /></div><div className={styles.field}><label htmlFor="person-preferred">Nome preferencial</label><input id="person-preferred" name="preferredName" /></div><div className={styles.field}><label htmlFor="person-professional-id">Registro profissional</label><input id="person-professional-id" name="professionalId" /></div><div className={styles.field}><label htmlFor="person-email">E-mail</label><input id="person-email" name="email" type="email" /></div><div className={styles.field}><label htmlFor="person-phone">Telefone</label><input id="person-phone" name="phone" /></div></>}
      {modal.type === "investigation" && <><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="investigation-problem">Problema a investigar</label><textarea id="investigation-problem" name="problemStatement" autoFocus required /></div><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="investigation-scope">Escopo</label><textarea id="investigation-scope" name="scope" placeholder="Opcional: delimite área, período ou processo analisado." /></div></>}
      {modal.type === "hypothesis" && <><div className={styles.field}><label htmlFor="hypothesis-category">Categoria</label><select id="hypothesis-category" name="category" defaultValue="OTHER"><option value="PROCESS">Processo</option><option value="PEOPLE">Pessoas</option><option value="PLANNING">Planejamento</option><option value="SUPPLIER">Fornecedor</option><option value="TECHNICAL">Técnica</option><option value="COMMERCIAL">Comercial</option><option value="LEGAL">Jurídica</option><option value="EXTERNAL">Externa</option><option value="OTHER">Outra</option></select></div><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="hypothesis-description">Descrição</label><textarea id="hypothesis-description" name="description" autoFocus required /></div></>}
      {modal.type === "evidence" && <><div className={styles.field}><label>Tipo da evidência</label><input name="evidenceType" defaultValue="DOCUMENT" required /></div><div className={styles.field}><label>Título</label><input name="title" autoFocus required /></div><div className={`${styles.field} ${styles.fieldFull}`}><label>Referência / origem</label><input name="sourceRef" required placeholder="Ex.: documento, medição, URL interna ou protocolo" /></div><div className={`${styles.field} ${styles.fieldFull}`}><label>Descrição</label><textarea name="description" /></div><div className={styles.field}><label>Relação</label><select name="supports" defaultValue="true"><option value="true">Sustenta a hipótese</option><option value="false">Contraria a hipótese</option></select></div></>}
      {modal.type === "allocation" && <><div className={styles.field}><label>Contribuição (%)</label><input name="contributionRate" type="number" min="0.01" max="100" step="0.01" defaultValue={modal.currentRate ? modal.currentRate * 100 : ""} required autoFocus /></div><div className={styles.field}><label>Impacto financeiro (opcional)</label><input name="amountImpact" type="number" step="0.01" /></div><div className={`${styles.field} ${styles.fieldFull}`}><label>Justificativa</label><textarea name="rationale" required /></div><div className={styles.field}><label>Validação</label><select name="validate" defaultValue="true"><option value="true">Salvar e validar causa</option><option value="false">Salvar sem validar</option></select></div></>}
      {modal.type === "dependency" && <><div className={styles.field}><label>Nome</label><input name="name" autoFocus required /></div><div className={styles.field}><label>Responsável externo</label><input name="owner" /></div><div className={`${styles.field} ${styles.fieldFull}`}><label>Descrição</label><textarea name="description" required /></div><div className={styles.field}><label>Prazo</label><input name="dueDate" type="date" /></div><div className={styles.field}><label>Referência de evidência</label><input name="evidenceRef" /></div></>}
      {modal.type === "actionEvidence" && <><div className={styles.field}><label>Título</label><input name="title" autoFocus required /></div><div className={styles.field}><label>Referência / origem</label><input name="sourceRef" required /></div><div className={`${styles.field} ${styles.fieldFull}`}><label>Observações</label><textarea name="notes" /></div></>}
      {modal.type === "action" && <><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="action-title">Título da ação</label><input id="action-title" name="title" autoFocus required /></div><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="action-description">Descrição</label><textarea id="action-description" name="description" required /></div><div className={styles.field}><label htmlFor="action-priority">Prioridade</label><select id="action-priority" name="priority" defaultValue="MEDIUM"><option value="LOW">Baixa</option><option value="MEDIUM">Média</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></div><div className={styles.field}><label htmlFor="action-due-date">Prazo</label><input id="action-due-date" name="dueDate" type="date" /></div></>}
    </div>{feedback?.type === "error" && <div className={styles.error}>{feedback.text}</div>}<div className={styles.modalActions}><button type="button" className="button button-secondary" disabled={pending} onClick={() => setModal(null)}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending}>{pending ? "Salvando..." : "Confirmar"}</button></div></form></div></div>}
  </section>;
}