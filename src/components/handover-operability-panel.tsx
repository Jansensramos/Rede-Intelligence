"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Building2, MessageSquareWarning } from "lucide-react";
import type { SalesWorkspaceView } from "@/application/sales/sales-service";
import {
  addPostSaleEvidenceAction,
  assignPostSaleSupplierAction,
  cancelBankFinancingDisbursementAction,
  createBankFinancingDisbursementAction,
  createCondominiumSetupAction,
  markPostSaleRecurrenceAction,
  recordBankFinancingDisbursementReceivedAction,
  reconcileBankFinancingDisbursementAction,
  requestBankFinancingDisbursementAction,
  setPostSaleCostAction,
  transitionCondominiumSetupAction,
} from "@/app/actions/handover";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const statusLabel: Record<string, string> = {
  PENDING: "Pendente",
  REQUESTED: "Solicitado",
  DISBURSED: "Liberado pelo banco",
  RECONCILED: "Conciliado",
  DIVERGENT: "Divergente",
  CANCELLED: "Cancelado",
  PLANNED: "Planejada",
  IN_PROGRESS: "Em andamento",
  IMPLEMENTED: "Implantado",
  OPEN: "Aberta",
  WAITING_CUSTOMER: "Aguardando cliente",
  RESOLVED: "Resolvida",
  CLOSED: "Encerrada",
  FINANCING: "Financiamento",
  FGTS: "FGTS",
  SUBSIDY: "Subsídio",
  OTHER: "Outro",
};
function Status({ value }: { value: string }) {
  return <span className="status-pill">{statusLabel[value] ?? value.replaceAll("_", " ")}</span>;
}

export function HandoverOperabilityPanel({ workspace }: { workspace: SalesWorkspaceView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showDisbursementForm, setShowDisbursementForm] = useState(false);
  const [receivedId, setReceivedId] = useState<string | null>(null);
  const [reconcileId, setReconcileId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [showCondoForm, setShowCondoForm] = useState(false);
  const [assistanceId, setAssistanceId] = useState<string | null>(null);
  const [evidenceRequestId, setEvidenceRequestId] = useState<string | null>(null);

  const today = () => new Date().toISOString().slice(0, 10);

  const run = (operation: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setFeedback(null);
    startTransition(async () => {
      const result = await operation();
      if (!result.ok) return setFeedback(result.error ?? "Não foi possível concluir.");
      setFeedback(success);
      setReceivedId(null);
      setReconcileId(null);
      setCancelId(null);
      setAssistanceId(null);
      router.refresh();
    });
  };

  function createDisbursement(form: FormData) {
    run(() => createBankFinancingDisbursementAction({
      saleId: String(form.get("saleId")),
      financialInstitutionId: String(form.get("financialInstitutionId")),
      disbursementType: String(form.get("disbursementType")) as "FINANCING" | "FGTS" | "SUBSIDY" | "OTHER",
      expectedAmount: String(form.get("expectedAmount")),
      bankReference: String(form.get("bankReference") || "") || null,
      notes: String(form.get("notes") || "") || null,
    }), "Repasse bancário criado.");
    setShowDisbursementForm(false);
  }

  function recordReceived(disbursementId: string, form: FormData) {
    run(() => recordBankFinancingDisbursementReceivedAction({
      disbursementId,
      disbursedAmount: String(form.get("disbursedAmount")),
      disbursedAt: new Date(String(form.get("disbursedAt")) + "T12:00:00.000Z"),
      bankReference: String(form.get("bankReference") || "") || null,
    }), "Liberação bancária registrada.");
  }

  function reconcile(disbursementId: string, form: FormData) {
    run(() => reconcileBankFinancingDisbursementAction({
      disbursementId,
      installmentId: String(form.get("installmentId")),
      bankAccountId: String(form.get("bankAccountId")),
      referenceNumber: String(form.get("referenceNumber") || "") || null,
    }), "Repasse conciliado com o recebível.");
  }

  function cancel(disbursementId: string, form: FormData) {
    run(() => cancelBankFinancingDisbursementAction({
      disbursementId,
      reason: String(form.get("reason")),
    }), "Repasse cancelado.");
  }

  function createCondo(form: FormData) {
    run(() => createCondominiumSetupAction({
      projectId: workspace.projectId,
      responsibleId: workspace.currentUserId,
      administratorSupplierId: String(form.get("administratorSupplierId") || "") || null,
      notes: String(form.get("notes") || "") || null,
    }), "Implantação do condomínio criada.");
    setShowCondoForm(false);
  }

  function transitionCondo(status: "IN_PROGRESS" | "IMPLEMENTED" | "CANCELLED", form?: FormData) {
    if (!workspace.condominiumSetup) return;
    run(() => transitionCondominiumSetupAction({
      condominiumSetupId: workspace.condominiumSetup!.id,
      status,
      constitutedAt: form?.get("constitutedAt") ? new Date(String(form.get("constitutedAt")) + "T12:00:00.000Z") : undefined,
      transferredAt: status === "IMPLEMENTED" && form?.get("transferredAt") ? new Date(String(form.get("transferredAt")) + "T12:00:00.000Z") : undefined,
      notes: String(form?.get("notes") || "") || undefined,
    }), status === "IMPLEMENTED" ? "Condomínio implantado e responsabilidade transferida." : status === "IN_PROGRESS" ? "Implantação do condomínio iniciada." : "Implantação cancelada.");
  }

  async function addEvidence(requestId: string, form: FormData) {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setFeedback("Selecione um arquivo de evidência.");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const evidenceKind = String(form.get("evidenceKind")) as "BEFORE" | "AFTER";
    const note = String(form.get("note") || "").trim();

    startTransition(async () => {
      setFeedback(null);
      const result = await addPostSaleEvidenceAction({
        requestId,
        evidenceKind,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        note: note || null,
        bytes,
      });
      if (!result.ok) return setFeedback(result.error ?? "Não foi possível adicionar a evidência.");
      setFeedback("Evidência registrada com checksum e trilha de auditoria.");
      setEvidenceRequestId(null);
      router.refresh();
    });
  }

  function updateAssistance(requestId: string, form: FormData) {
    startTransition(async () => {
      setFeedback(null);
      const supplierId = String(form.get("supplierId") || "");
      const estimatedCost = String(form.get("estimatedCost") || "");
      const actualCost = String(form.get("actualCost") || "");
      const recurrenceOfId = String(form.get("recurrenceOfId") || "");

      const supplierResult = await assignPostSaleSupplierAction({ requestId, supplierId: supplierId || null });
      if (!supplierResult.ok) return setFeedback(supplierResult.error ?? "Não foi possível atribuir o fornecedor.");

      const costResult = await setPostSaleCostAction({
        requestId,
        estimatedCost: estimatedCost ? estimatedCost : null,
        actualCost: actualCost ? actualCost : null,
      });
      if (!costResult.ok) return setFeedback(costResult.error ?? "Não foi possível atualizar o custo.");

      if (recurrenceOfId) {
        const recurrenceResult = await markPostSaleRecurrenceAction({ requestId, recurrenceOfId });
        if (!recurrenceResult.ok) return setFeedback(recurrenceResult.error ?? "Não foi possível marcar a reincidência.");
      }

      setFeedback("Assistência técnica atualizada.");
      setAssistanceId(null);
      router.refresh();
    });
  }

  return <div className="view-stack">
    {feedback && <div className="model-note"><AlertTriangle size={20}/><div><strong>Operação comercial</strong><p>{feedback}</p></div></div>}

    <article className="panel">
      <div className="panel-heading"><div><span className="eyebrow">REPASSE BANCÁRIO</span><h2>Financiamento, FGTS e subsídio do comprador — conciliação com o recebível</h2><p>O recebimento conciliado entra no Financeiro pela mesma parcela oficial da venda.</p></div><button className="button button-primary" disabled={pending || workspace.financialInstitutions.length === 0 || workspace.sales.every((sale) => sale.status !== "APPROVED")} onClick={() => setShowDisbursementForm((value) => !value)}>{showDisbursementForm ? "Fechar" : "Novo repasse"}</button></div>

      {showDisbursementForm && <form className="form-grid" action={createDisbursement}>
        <label>Venda<select name="saleId" defaultValue="" required><option value="" disabled>Selecione</option>{workspace.sales.filter((sale) => sale.status === "APPROVED").map((sale) => <option key={sale.id} value={sale.id}>{sale.unit} · {sale.contractNumber ?? sale.id} · {sale.buyers.join(", ")}</option>)}</select></label>
        <label>Instituição<select name="financialInstitutionId" defaultValue="" required><option value="" disabled>Selecione</option>{workspace.financialInstitutions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Tipo<select name="disbursementType" defaultValue="FINANCING"><option value="FINANCING">Financiamento</option><option value="FGTS">FGTS</option><option value="SUBSIDY">Subsídio</option><option value="OTHER">Outro</option></select></label>
        <label>Valor esperado<input name="expectedAmount" type="number" min="0.01" step="0.01" required /></label>
        <label>Referência bancária<input name="bankReference" /></label>
        <label>Observações<input name="notes" /></label>
        <div className="form-actions"><button className="button button-primary" disabled={pending} type="submit">Criar repasse</button></div>
      </form>}

      {workspace.financialInstitutions.length === 0 && <p className="empty-state">Nenhuma instituição financeira cadastrada. Cadastre uma conta bancária/instituição no Financeiro antes de criar o repasse.</p>}

      <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Unidade</th><th>Instituição</th><th>Tipo</th><th>Esperado</th><th>Liberado</th><th>Situação</th><th>Ação</th></tr></thead><tbody>
        {workspace.bankFinancingDisbursements.map((item) => {
          const sale = workspace.sales.find((saleItem) => saleItem.id === item.saleId);
          return <tr key={item.id}><td><strong>{item.unit}</strong></td><td>{item.institution}</td><td>{statusLabel[item.disbursementType] ?? item.disbursementType}</td><td>{brl.format(item.expectedAmount)}</td><td>{item.disbursedAmount !== null ? brl.format(item.disbursedAmount) : "—"}</td><td>{item.status === "DIVERGENT" ? <span className="negative-value"><AlertTriangle size={14}/> {statusLabel[item.status] ?? item.status}</span> : <Status value={item.status}/>}</td><td>
            <div className="panel-actions">
              {item.status === "PENDING" && <button className="text-button" disabled={pending} onClick={() => run(() => requestBankFinancingDisbursementAction({ disbursementId: item.id, requestedAt: new Date() }), "Repasse solicitado ao banco.")}>Solicitar</button>}
              {["PENDING","REQUESTED"].includes(item.status) && <button className="text-button" disabled={pending} onClick={() => setReceivedId(receivedId === item.id ? null : item.id)}>Registrar liberação</button>}
              {["DISBURSED","DIVERGENT"].includes(item.status) && <button className="text-button" disabled={pending || workspace.bankAccounts.length === 0 || !sale?.receivableInstallments.length} onClick={() => setReconcileId(reconcileId === item.id ? null : item.id)}>Conciliar</button>}
              {item.status !== "RECONCILED" && item.status !== "CANCELLED" && <button className="text-button" disabled={pending} onClick={() => setCancelId(cancelId === item.id ? null : item.id)}>Cancelar</button>}
            </div>
            {receivedId === item.id && <form className="form-grid" action={(form) => recordReceived(item.id, form)}><label>Valor liberado<input name="disbursedAmount" type="number" min="0.01" step="0.01" defaultValue={item.expectedAmount} required /></label><label>Data<input name="disbursedAt" type="date" defaultValue={today()} required /></label><label>Referência<input name="bankReference" /></label><div className="form-actions"><button className="button button-primary" type="submit" disabled={pending}>Registrar</button></div></form>}
            {reconcileId === item.id && sale && <form className="form-grid" action={(form) => reconcile(item.id, form)}><label>Parcela do recebível<select name="installmentId" defaultValue="" required><option value="" disabled>Selecione</option>{sale.receivableInstallments.filter((installment) => !["RECEBIDA","CANCELADA","RENEGOCIADA"].includes(installment.status)).map((installment) => <option key={installment.id} value={installment.id}>Parcela {installment.number} · {date.format(new Date(installment.dueDate))} · {brl.format(installment.currentAmount)}</option>)}</select></label><label>Conta de destino<select name="bankAccountId" defaultValue="" required><option value="" disabled>Selecione</option>{workspace.bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.institution} · ag. {account.agency} · {account.accountNumber}</option>)}</select></label><label>Referência<input name="referenceNumber" /></label><div className="form-actions"><button className="button button-primary" type="submit" disabled={pending}>Conciliar</button></div></form>}
            {cancelId === item.id && <form className="form-grid" action={(form) => cancel(item.id, form)}><label>Motivo<input name="reason" required /></label><div className="form-actions"><button className="button button-secondary" type="submit" disabled={pending}>Confirmar cancelamento</button></div></form>}
          </td></tr>;
        })}
        {workspace.bankFinancingDisbursements.length === 0 && <tr><td colSpan={7}>Nenhum repasse bancário registrado neste empreendimento.</td></tr>}
      </tbody></table></div>
    </article>

    <article className="panel">
      <div className="panel-heading"><div><span className="eyebrow">CHAVES — CONDOMÍNIO</span><h2>Implantação e transferência de responsabilidade</h2></div>{!workspace.condominiumSetup && <button className="button button-primary" disabled={pending} onClick={() => setShowCondoForm((value) => !value)}>{showCondoForm ? "Fechar" : "Iniciar implantação"}</button>}</div>
      {showCondoForm && <form className="form-grid" action={createCondo}><label>Administradora<select name="administratorSupplierId" defaultValue=""><option value="">Ainda não definida</option>{workspace.suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Observações<input name="notes" /></label><div className="form-actions"><button className="button button-primary" type="submit" disabled={pending}>Criar implantação</button></div></form>}
      {workspace.condominiumSetup ? <div className="model-note"><Building2 size={20}/><div style={{ width: "100%" }}><strong>Administradora: {workspace.condominiumSetup.administrator ?? "não definida"}</strong><p>Constituído em {workspace.condominiumSetup.constitutedAt ? date.format(new Date(workspace.condominiumSetup.constitutedAt)) : "—"} · Transferido em {workspace.condominiumSetup.transferredAt ? date.format(new Date(workspace.condominiumSetup.transferredAt)) : "—"}</p><Status value={workspace.condominiumSetup.status}/>
        {workspace.condominiumSetup.status === "PLANNED" && <div className="panel-actions"><button className="button button-secondary" disabled={pending} onClick={() => transitionCondo("IN_PROGRESS")}>Iniciar implantação</button></div>}
        {workspace.condominiumSetup.status === "IN_PROGRESS" && <form className="form-grid" action={(form) => transitionCondo("IMPLEMENTED", form)}><label>Constituição<input name="constitutedAt" type="date" defaultValue={today()} /></label><label>Transferência<input name="transferredAt" type="date" defaultValue={today()} required /></label><label>Observações<input name="notes" /></label><div className="form-actions"><button className="button button-primary" disabled={pending} type="submit">Concluir implantação</button><button className="button button-secondary" disabled={pending} type="button" onClick={() => transitionCondo("CANCELLED")}>Cancelar implantação</button></div></form>}
      </div></div> : !showCondoForm && <p className="empty-state">Nenhuma implantação de condomínio registrada neste empreendimento.</p>}
    </article>

    <article className="panel">
      <div className="panel-heading"><div><span className="eyebrow">ASSISTÊNCIA TÉCNICA</span><h2>Fornecedor responsável, custo, reincidência e SLA</h2></div></div>
      {workspace.postSaleRequests.map((item) => <div className="model-note" key={item.id}><MessageSquareWarning size={20}/><div style={{ width: "100%" }}><strong>{item.unit} · {item.customer}</strong><p>{item.category.replaceAll("_"," ")} · Fornecedor: {item.supplier ?? "não atribuído"} · Custo: {item.actualCost !== null ? brl.format(item.actualCost) : item.estimatedCost !== null ? brl.format(item.estimatedCost) + " (estimado)" : "—"}{item.recurrenceOfId ? " · Reincidência" : ""}</p><Status value={item.status}/>{item.slaViolated && <span className="negative-value"><AlertTriangle size={14}/> SLA vencido</span>}
        <div className="panel-actions"><button className="text-button" disabled={pending} onClick={() => setAssistanceId(assistanceId === item.id ? null : item.id)}>Configurar assistência</button><button className="text-button" disabled={pending} onClick={() => setEvidenceRequestId(evidenceRequestId === item.id ? null : item.id)}>Adicionar evidência</button></div>
        {evidenceRequestId === item.id && <form className="form-grid" action={(form) => void addEvidence(item.id, form)}>
          <label>Momento<select name="evidenceKind" defaultValue="BEFORE"><option value="BEFORE">Antes do reparo</option><option value="AFTER">Depois do reparo</option></select></label>
          <label>Arquivo<input name="file" type="file" accept="image/*,.pdf" required /></label>
          <label style={{ gridColumn: "1 / -1" }}>Observação<textarea name="note" rows={2} placeholder="Contexto da evidência (opcional)" /></label>
          <div className="form-actions"><button className="button button-primary" type="submit" disabled={pending}>Registrar evidência</button><button className="button button-secondary" type="button" onClick={() => setEvidenceRequestId(null)}>Cancelar</button></div>
        </form>}
        {assistanceId === item.id && <form className="form-grid" action={(form) => updateAssistance(item.id, form)}>
          <label>Fornecedor<select name="supplierId" defaultValue=""><option value="">Sem fornecedor</option>{workspace.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
          <label>Custo estimado<input name="estimatedCost" type="number" min="0" step="0.01" defaultValue={item.estimatedCost ?? ""} /></label>
          <label>Custo realizado<input name="actualCost" type="number" min="0" step="0.01" defaultValue={item.actualCost ?? ""} /></label>
          <label>Reincidência de<select name="recurrenceOfId" defaultValue=""><option value="">Não é reincidência</option>{workspace.postSaleRequests.filter((other) => other.id !== item.id).map((other) => <option key={other.id} value={other.id}>{other.unit} · {other.customer} · {other.category.replaceAll("_"," ")}</option>)}</select></label>
          <div className="form-actions"><button className="button button-primary" type="submit" disabled={pending}>Salvar assistência</button></div>
        </form>}
      </div></div>)}
      {workspace.postSaleRequests.length === 0 && <p className="empty-state">Nenhuma solicitação de pós-venda neste empreendimento.</p>}
    </article>
  </div>;
}
