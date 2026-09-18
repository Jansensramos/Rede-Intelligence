"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, CalendarRange, Coins } from "lucide-react";
import type { PeoplePerformanceWorkspaceView } from "@/application/people-performance/people-performance-service";
import {
  createEmploymentRelationshipAction,
  createWorkAllocationAction,
  recordRelationshipCostAction,
} from "@/app/actions/people-extended";
import styles from "./sales-operability-panel.module.css";

type ModalState =
  | { type: "relationship" }
  | { type: "allocation" }
  | { type: "cost" }
  | null;

type ActionResult = { ok: boolean; error?: string };

export function PeopleStructureOperationsPanel({
  workspace,
}: {
  workspace: PeoplePerformanceWorkspaceView;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>(null);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

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

    if (modal.type === "relationship") {
      const personId = String(data.get("personId") ?? "");
      const companyId = String(data.get("companyId") ?? "");
      const startDate = String(data.get("startDate") ?? "");
      const endDate = String(data.get("endDate") ?? "");
      const weeklyHours = String(data.get("weeklyHours") ?? "").trim();
      if (!personId || !companyId || !startDate) {
        return setFeedback({ type: "error", text: "Informe pessoa, empresa e data de início." });
      }
      return run(
        () => createEmploymentRelationshipAction({
          personId,
          companyId,
          positionId: String(data.get("positionId") ?? "") || null,
          departmentId: String(data.get("departmentId") ?? "") || null,
          managerId: null,
          type: String(data.get("relationshipType") ?? "EMPLOYEE") as "EMPLOYEE" | "CONTRACTOR" | "PARTNER" | "INTERN" | "TEMPORARY" | "OUTSOURCED",
          startDate: new Date(`${startDate}T00:00:00Z`),
          endDate: endDate ? new Date(`${endDate}T00:00:00Z`) : null,
          weeklyHours: weeklyHours ? Number(weeklyHours) : null,
        }),
        "Vínculo profissional criado.",
      );
    }

    if (modal.type === "allocation") {
      const relationshipId = String(data.get("relationshipId") ?? "");
      const criterion = String(data.get("criterion") ?? "PERCENTAGE") as "PERCENTAGE" | "HOURS" | "FIXED_AMOUNT";
      const startDate = String(data.get("startDate") ?? "");
      const endDate = String(data.get("endDate") ?? "");
      if (!relationshipId || !startDate) {
        return setFeedback({ type: "error", text: "Informe profissional e data de início." });
      }
      const rate = String(data.get("allocationRate") ?? "").trim();
      const hours = String(data.get("allocatedHours") ?? "").trim();
      const amount = String(data.get("allocatedAmount") ?? "").trim();
      return run(
        () => createWorkAllocationAction({
          projectId: workspace.projectId,
          relationshipId,
          criterion,
          allocationRate: criterion === "PERCENTAGE" && rate ? Number(rate) / 100 : null,
          allocatedHours: criterion === "HOURS" && hours ? Number(hours) : null,
          allocatedAmount: criterion === "FIXED_AMOUNT" && amount ? Number(amount) : null,
          startDate: new Date(`${startDate}T00:00:00Z`),
          endDate: endDate ? new Date(`${endDate}T00:00:00Z`) : null,
          overAllocationJustification: String(data.get("justification") ?? "").trim() || null,
        }),
        "Alocação registrada no empreendimento.",
      );
    }

    const relationshipId = String(data.get("relationshipId") ?? "");
    const referenceMonth = String(data.get("referenceMonth") ?? "");
    const baseCost = Number(data.get("baseCost") || 0);
    const source = String(data.get("source") ?? "").trim();
    if (!relationshipId || !referenceMonth || !(baseCost >= 0) || !source) {
      return setFeedback({ type: "error", text: "Informe profissional, competência, custo base e fonte." });
    }
    return run(
      () => recordRelationshipCostAction({
        relationshipId,
        referenceMonth: new Date(`${referenceMonth}-01T00:00:00Z`),
        baseCost,
        burdenCost: Number(data.get("burdenCost") || 0),
        benefitsCost: Number(data.get("benefitsCost") || 0),
        otherCost: Number(data.get("otherCost") || 0),
        source,
        notes: String(data.get("notes") ?? "").trim() || null,
      }),
      "Custo mensal do vínculo registrado.",
    );
  };

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ESTRUTURA E CAPACIDADE</span>
          <h2>Vínculos, alocações e custo da equipe</h2>
          <p>Complete a operação de Pessoas ligando profissionais às empresas, aos empreendimentos e ao custo mensal realizado.</p>
        </div>
        <div className="panel-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={pending || !workspace.permissions.canManagePeople}
            onClick={() => setModal({ type: "relationship" })}
          >
            <BriefcaseBusiness size={15} /> Criar vínculo
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={pending || !workspace.permissions.canManageAllocation || workspace.people.length === 0}
            onClick={() => setModal({ type: "allocation" })}
          >
            <CalendarRange size={15} /> Alocar no projeto
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={pending || !workspace.permissions.canManageCompensation || workspace.people.length === 0}
            onClick={() => setModal({ type: "cost" })}
          >
            <Coins size={15} /> Registrar custo
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
          <thead>
            <tr><th>Profissional</th><th>Empresa</th><th>Departamento / cargo</th><th>Jornada</th><th>Custo mensal</th></tr>
          </thead>
          <tbody>
            {workspace.people.slice(0, 20).map((person) => (
              <tr key={person.relationshipId}>
                <td><strong>{person.name}</strong><small>{person.relationshipType}</small></td>
                <td>{person.company}</td>
                <td>{person.department}<small>{person.position}</small></td>
                <td>{person.weeklyHours !== null ? `${person.weeklyHours} h/semana` : "Não informada"}</td>
                <td>{person.compensationRestricted ? "Restrito" : person.monthlyCost !== null ? person.monthlyCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "Sem custo registrado"}</td>
              </tr>
            ))}
            {workspace.people.length === 0 && <tr><td colSpan={5}>Nenhum vínculo profissional ativo.</td></tr>}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setModal(null); }}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Operação de Pessoas">
            <div className={styles.modalHeader}>
              <div>
                <h3>{modal.type === "relationship" ? "Criar vínculo profissional" : modal.type === "allocation" ? "Alocar profissional" : "Registrar custo mensal"}</h3>
                <p>Os dados ficam vinculados ao domínio de Pessoas e à trilha de auditoria.</p>
              </div>
              <button className={styles.closeButton} type="button" disabled={pending} onClick={() => setModal(null)} aria-label="Fechar">×</button>
            </div>

            <form className={styles.form} onSubmit={submit}>
              <div className={styles.formGrid}>
                {modal.type === "relationship" && (
                  <>
                    <Field label="Pessoa">
                      <select name="personId" required autoFocus defaultValue="">
                        <option value="" disabled>Selecione</option>
                        {workspace.profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Empresa">
                      <select name="companyId" required defaultValue="">
                        <option value="" disabled>Selecione</option>
                        {workspace.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Tipo de vínculo">
                      <select name="relationshipType" defaultValue="EMPLOYEE">
                        <option value="EMPLOYEE">Empregado</option>
                        <option value="CONTRACTOR">Prestador</option>
                        <option value="PARTNER">Sócio</option>
                        <option value="INTERN">Estagiário</option>
                        <option value="TEMPORARY">Temporário</option>
                        <option value="OUTSOURCED">Terceirizado</option>
                      </select>
                    </Field>
                    <Field label="Departamento">
                      <select name="departmentId" defaultValue="">
                        <option value="">Sem departamento</option>
                        {workspace.departments.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Cargo">
                      <select name="positionId" defaultValue="">
                        <option value="">Sem cargo</option>
                        {workspace.positions.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.title}</option>)}
                      </select>
                    </Field>
                    <Field label="Horas semanais"><input name="weeklyHours" type="number" min="0" step="0.5" /></Field>
                    <Field label="Início"><input name="startDate" type="date" required /></Field>
                    <Field label="Término"><input name="endDate" type="date" /></Field>
                  </>
                )}

                {modal.type === "allocation" && (
                  <>
                    <RelationshipSelect workspace={workspace} />
                    <Field label="Critério">
                      <select name="criterion" defaultValue="PERCENTAGE">
                        <option value="PERCENTAGE">Percentual</option>
                        <option value="HOURS">Horas</option>
                        <option value="FIXED_AMOUNT">Valor fixo</option>
                      </select>
                    </Field>
                    <Field label="% de alocação"><input name="allocationRate" type="number" min="0" max="100" step="0.01" /></Field>
                    <Field label="Horas alocadas"><input name="allocatedHours" type="number" min="0" step="0.5" /></Field>
                    <Field label="Valor alocado"><input name="allocatedAmount" type="number" min="0" step="0.01" /></Field>
                    <Field label="Início"><input name="startDate" type="date" required /></Field>
                    <Field label="Término"><input name="endDate" type="date" /></Field>
                    <div className={`${styles.field} ${styles.fieldFull}`}>
                      <label htmlFor="people-allocation-justification">Justificativa de sobrealocação, se aplicável</label>
                      <textarea id="people-allocation-justification" name="justification" />
                    </div>
                  </>
                )}

                {modal.type === "cost" && (
                  <>
                    <RelationshipSelect workspace={workspace} />
                    <Field label="Competência"><input name="referenceMonth" type="month" required /></Field>
                    <Field label="Custo base"><input name="baseCost" type="number" min="0" step="0.01" required /></Field>
                    <Field label="Encargos"><input name="burdenCost" type="number" min="0" step="0.01" /></Field>
                    <Field label="Benefícios"><input name="benefitsCost" type="number" min="0" step="0.01" /></Field>
                    <Field label="Outros custos"><input name="otherCost" type="number" min="0" step="0.01" /></Field>
                    <Field label="Fonte"><input name="source" required placeholder="Folha, contrato, BPO..." /></Field>
                    <div className={`${styles.field} ${styles.fieldFull}`}>
                      <label htmlFor="people-cost-notes">Observações</label>
                      <textarea id="people-cost-notes" name="notes" />
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

function RelationshipSelect({ workspace }: { workspace: PeoplePerformanceWorkspaceView }) {
  return (
    <Field label="Profissional">
      <select name="relationshipId" required defaultValue="">
        <option value="" disabled>Selecione</option>
        {workspace.people.map((item) => <option key={item.relationshipId} value={item.relationshipId}>{item.name} · {item.company}</option>)}
      </select>
    </Field>
  );
}
