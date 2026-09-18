"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, CalendarRange, Coins } from "lucide-react";
import type { PeoplePerformanceWorkspaceView } from "@/application/people-performance/people-performance-service";
import {
  createEmploymentRelationshipAction,
  createWorkAllocationAction,
  recordRelationshipCostAction,
} from "@/app/actions/people";
import styles from "./sales-operability-panel.module.css";

type Modal = { type: "relationship" | "allocation" | "cost" } | null;

export function PeopleWorkforceOperabilityPanel({ workspace }: { workspace: PeoplePerformanceWorkspaceView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [modal, setModal] = useState<Modal>(null);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const run = (operation: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
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
      const companyId = String(data.get("companyId") ?? "");
      const personId = String(data.get("personId") ?? "");
      const type = String(data.get("type") ?? "EMPLOYEE") as "EMPLOYEE" | "CONTRACTOR" | "PARTNER" | "INTERN" | "TEMPORARY" | "OUTSOURCED";
      const startDate = new Date(String(data.get("startDate")) + "T00:00:00Z");
      const positionId = String(data.get("positionId") ?? "") || null;
      const departmentId = String(data.get("departmentId") ?? "") || null;
      const weeklyHoursRaw = String(data.get("weeklyHours") ?? "").trim();
      if (!companyId || !personId || Number.isNaN(startDate.getTime())) {
        return setFeedback({ type: "error", text: "Selecione pessoa, empresa e data inicial." });
      }
      return run(() => createEmploymentRelationshipAction({
        companyId,
        personId,
        type,
        startDate,
        positionId,
        departmentId,
        weeklyHours: weeklyHoursRaw ? Number(weeklyHoursRaw) : null,
      }), "Vínculo profissional criado.");
    }

    if (modal.type === "allocation") {
      const relationshipId = String(data.get("relationshipId") ?? "");
      const criterion = String(data.get("criterion") ?? "PERCENTAGE") as "PERCENTAGE" | "HOURS" | "FIXED_AMOUNT";
      const startDate = new Date(String(data.get("startDate")) + "T00:00:00Z");
      const costCenterId = String(data.get("costCenterId") ?? "") || null;
      const value = Number(data.get("value") ?? 0);
      const justification = String(data.get("justification") ?? "").trim() || null;
      if (!relationshipId || Number.isNaN(startDate.getTime()) || !Number.isFinite(value) || value <= 0) {
        return setFeedback({ type: "error", text: "Revise vínculo, data e valor da alocação." });
      }
      return run(() => createWorkAllocationAction({
        projectId: workspace.projectId,
        relationshipId,
        costCenterId,
        criterion,
        startDate,
        allocationRate: criterion === "PERCENTAGE" ? value / 100 : null,
        allocatedHours: criterion === "HOURS" ? value : null,
        allocatedAmount: criterion === "FIXED_AMOUNT" ? value : null,
        overAllocationJustification: justification,
      }), "Alocação criada.");
    }

    const relationshipId = String(data.get("relationshipId") ?? "");
    const referenceMonth = new Date(String(data.get("referenceMonth")) + "-01T00:00:00Z");
    const baseCost = Number(data.get("baseCost") ?? 0);
    const burdenCost = Number(data.get("burdenCost") ?? 0);
    const benefitsCost = Number(data.get("benefitsCost") ?? 0);
    const otherCost = Number(data.get("otherCost") ?? 0);
    const source = String(data.get("source") ?? "").trim();
    const notes = String(data.get("notes") ?? "").trim() || null;
    if (!relationshipId || Number.isNaN(referenceMonth.getTime()) || !source || baseCost < 0) {
      return setFeedback({ type: "error", text: "Revise vínculo, competência, custo base e fonte." });
    }
    return run(() => recordRelationshipCostAction({
      relationshipId,
      referenceMonth,
      baseCost,
      burdenCost,
      benefitsCost,
      otherCost,
      source,
      notes,
    }), "Custo do vínculo registrado.");
  };

  const unlinkedProfiles = workspace.workforce.profiles.filter(
    (profile) => !workspace.workforce.relationships.some((relationship) => relationship.personId === profile.id),
  );

  return <section className="panel">
    <div className="panel-heading">
      <div>
        <span className="eyebrow">FORÇA DE TRABALHO</span>
        <h2>Vínculos, alocações e custos</h2>
        <p>Conecte pessoas às empresas, aloque capacidade no empreendimento e registre custos com acesso restrito.</p>
      </div>
      <div className="panel-actions">
        <button className="button button-secondary" disabled={pending || !workspace.permissions.canManagePeople || unlinkedProfiles.length === 0 || workspace.workforce.companies.length === 0} onClick={() => setModal({ type: "relationship" })}><BriefcaseBusiness size={15}/> Novo vínculo</button>
        <button className="button button-secondary" disabled={pending || !workspace.permissions.canManageAllocations || workspace.workforce.relationships.length === 0} onClick={() => setModal({ type: "allocation" })}><CalendarRange size={15}/> Nova alocação</button>
        <button className="button button-primary" disabled={pending || !workspace.permissions.canManageCompensation || workspace.workforce.relationships.length === 0} onClick={() => setModal({ type: "cost" })}><Coins size={15}/> Registrar custo</button>
      </div>
    </div>

    {feedback && <div className={feedback.type === "error" ? styles.error : styles.success}>{feedback.text}</div>}

    <div className="data-table-scroll">
      <table className="data-table">
        <thead><tr><th>Pessoa</th><th>Empresa</th><th>Vínculo</th><th>Alocação no projeto</th></tr></thead>
        <tbody>
          {workspace.workforce.relationships.map((relationship) => {
            const allocations = workspace.allocations.filter((item) => item.person === relationship.person);
            return <tr key={relationship.id}>
              <td><strong>{relationship.person}</strong></td>
              <td>{relationship.company}</td>
              <td>{relationship.type}<small>{relationship.weeklyHours ? relationship.weeklyHours + " h/semana" : "Carga não informada"}</small></td>
              <td>{allocations.length ? allocations.map((item) => item.criterion + (item.rate !== null ? " " + (item.rate * 100).toFixed(0) + "%" : item.hours !== null ? " " + item.hours + "h" : "")).join(" · ") : "Sem alocação"}</td>
            </tr>;
          })}
          {workspace.workforce.relationships.length === 0 && <tr><td colSpan={4}>Nenhum vínculo ativo. Cadastre uma pessoa e depois crie o vínculo.</td></tr>}
        </tbody>
      </table>
    </div>

    {modal && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setModal(null); }}>
      <div className={styles.modal} role="dialog" aria-modal="true">
        <div className={styles.modalHeader}><div><h3>{modal.type === "relationship" ? "Novo vínculo profissional" : modal.type === "allocation" ? "Nova alocação" : "Registrar custo do vínculo"}</h3><p>Os registros ficam vinculados à organização e à trilha de auditoria.</p></div><button type="button" className={styles.closeButton} onClick={() => setModal(null)} disabled={pending}>×</button></div>
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.formGrid}>
            {modal.type === "relationship" && <>
              <div className={styles.field}><label>Pessoa</label><select name="personId" required defaultValue=""><option value="" disabled>Selecione</option>{unlinkedProfiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
              <div className={styles.field}><label>Empresa</label><select name="companyId" required defaultValue=""><option value="" disabled>Selecione</option>{workspace.workforce.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
              <div className={styles.field}><label>Tipo</label><select name="type" defaultValue="EMPLOYEE"><option value="EMPLOYEE">Empregado</option><option value="CONTRACTOR">Contratado</option><option value="PARTNER">Sócio</option><option value="INTERN">Estagiário</option><option value="TEMPORARY">Temporário</option><option value="OUTSOURCED">Terceirizado</option></select></div>
              <div className={styles.field}><label>Data inicial</label><input type="date" name="startDate" defaultValue={new Date().toISOString().slice(0, 10)} required /></div>
              <div className={styles.field}><label>Departamento</label><select name="departmentId" defaultValue=""><option value="">Sem departamento</option>{workspace.departments.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></div>
              <div className={styles.field}><label>Cargo</label><select name="positionId" defaultValue=""><option value="">Sem cargo</option>{workspace.positions.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.title}</option>)}</select></div>
              <div className={styles.field}><label>Horas semanais</label><input type="number" name="weeklyHours" min="0" step="0.5" /></div>
            </>}
            {modal.type === "allocation" && <>
              <div className={styles.field}><label>Vínculo</label><select name="relationshipId" required defaultValue=""><option value="" disabled>Selecione</option>{workspace.workforce.relationships.map((item) => <option key={item.id} value={item.id}>{item.person} · {item.company}</option>)}</select></div>
              <div className={styles.field}><label>Critério</label><select name="criterion" defaultValue="PERCENTAGE"><option value="PERCENTAGE">Percentual (%)</option><option value="HOURS">Horas</option><option value="FIXED_AMOUNT">Valor fixo</option></select></div>
              <div className={styles.field}><label>Valor</label><input name="value" type="number" min="0.01" step="0.01" required /></div>
              <div className={styles.field}><label>Data inicial</label><input name="startDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></div>
              <div className={styles.field}><label>Centro de custo</label><select name="costCenterId" defaultValue=""><option value="">Sem centro de custo</option>{workspace.workforce.costCenters.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></div>
              <div className={styles.field}><label>Justificativa de sobrealocação</label><textarea name="justification" placeholder="Preencha somente se houver sobrealocação consciente." /></div>
            </>}
            {modal.type === "cost" && <>
              <div className={styles.field}><label>Vínculo</label><select name="relationshipId" required defaultValue=""><option value="" disabled>Selecione</option>{workspace.workforce.relationships.map((item) => <option key={item.id} value={item.id}>{item.person} · {item.company}</option>)}</select></div>
              <div className={styles.field}><label>Competência</label><input name="referenceMonth" type="month" defaultValue={new Date().toISOString().slice(0, 7)} required /></div>
              <div className={styles.field}><label>Fonte</label><input name="source" defaultValue="Folha / contrato" required /></div>
              <div className={styles.field}><label>Custo base</label><input name="baseCost" type="number" min="0" step="0.01" required /></div>
              <div className={styles.field}><label>Encargos</label><input name="burdenCost" type="number" min="0" step="0.01" defaultValue="0" /></div>
              <div className={styles.field}><label>Benefícios</label><input name="benefitsCost" type="number" min="0" step="0.01" defaultValue="0" /></div>
              <div className={styles.field}><label>Outros custos</label><input name="otherCost" type="number" min="0" step="0.01" defaultValue="0" /></div>
              <div className={styles.field}><label>Observação</label><textarea name="notes" /></div>
            </>}
          </div>
          <div className={styles.modalActions}><button type="button" className="button button-secondary" disabled={pending} onClick={() => setModal(null)}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending}>{pending ? "Salvando..." : "Confirmar"}</button></div>
        </form>
      </div>
    </div>}
  </section>;
}
