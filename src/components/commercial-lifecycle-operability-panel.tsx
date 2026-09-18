"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boxes, ClipboardCheck, HandCoins, LifeBuoy, TableProperties } from "lucide-react";
import type { SalesWorkspaceView } from "@/application/sales/sales-service";
import {
  activateSalesPriceTableAction,
  approveSalesCommissionAction,
  assignPostSaleSupplierAction,
  blockSalesUnitAction,
  createBrokerProfileAction,
  createPostSaleRequestAction,
  createSalesCommissionAction,
  createSalesCommissionPolicyAction,
  createSalesPriceTableAction,
  createSalesUnitAction,
  markPostSaleRecurrenceAction,
  markUnitDeliveredAction,
  recordInspectionOutcomeAction,
  scheduleInspectionAction,
  setPostSaleCostAction,
  transitionPostSaleRequestAction,
  unblockSalesUnitAction,
} from "@/app/actions/sales";
import styles from "./sales-operability-panel.module.css";

type ModalType =
  | "unit"
  | "block"
  | "priceTable"
  | "broker"
  | "commissionPolicy"
  | "commission"
  | "inspection"
  | "inspectionOutcome"
  | "postSale"
  | "postSaleManage";

type Modal = { type: ModalType; id?: string; label?: string } | null;
type Result = { ok: boolean; error?: string };

export function CommercialLifecycleOperabilityPanel({
  workspace,
  canWrite,
  canApprove,
}: {
  workspace: SalesWorkspaceView;
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
        setFeedback({ type: "error", text: result.error ?? "Não foi possível concluir a operação comercial." });
        return;
      }
      setModal(null);
      setFeedback({ type: "success", text: success });
      router.refresh();
    });
  };

  const approvedSales = workspace.sales.filter((sale) => sale.status === "APPROVED");
  const openPostSale = workspace.postSaleRequests.filter((item) => !["RESOLVED", "CLOSED"].includes(item.status));
  const availableSuppliersForBroker = workspace.suppliers.filter((supplier) => !workspace.brokers.some((broker) => broker.supplierId === supplier.id));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!modal) return;
    const data = new FormData(event.currentTarget);

    if (modal.type === "unit") {
      if (!workspace.companyId) return setFeedback({ type: "error", text: "O empreendimento precisa estar vinculado a uma empresa para cadastrar unidades." });
      const code = String(data.get("code") ?? "").trim();
      const typology = String(data.get("typology") ?? "").trim();
      const privateAreaM2 = Number(data.get("privateAreaM2") ?? 0);
      if (!code || !typology || privateAreaM2 <= 0) return setFeedback({ type: "error", text: "Informe código, tipologia e área privativa." });
      return run(() => createSalesUnitAction({
        projectId: workspace.projectId,
        companyId: workspace.companyId as string,
        code,
        floor: String(data.get("floor") ?? "").trim() || null,
        typology,
        privateAreaM2,
        totalAreaM2: Number(data.get("totalAreaM2") ?? 0) || null,
        parkingSpaces: Number(data.get("parkingSpaces") ?? 0),
        storageUnits: Number(data.get("storageUnits") ?? 0),
        position: String(data.get("position") ?? "").trim() || null,
      }), "Unidade comercial cadastrada.");
    }

    if (modal.type === "block") {
      const salesUnitId = String(data.get("salesUnitId") ?? "");
      const reason = String(data.get("reason") ?? "").trim();
      const origin = String(data.get("origin") ?? "COMERCIAL") as "PERMUTA" | "JURIDICO" | "DIRETORIA" | "INCORPORACAO" | "COMERCIAL" | "TECNICA" | "OUTRO";
      if (!salesUnitId || !reason) return setFeedback({ type: "error", text: "Selecione a unidade e informe o motivo." });
      return run(() => blockSalesUnitAction({ salesUnitId, origin, reason }), "Unidade bloqueada.");
    }

    if (modal.type === "priceTable") {
      if (!workspace.companyId) return setFeedback({ type: "error", text: "O empreendimento precisa estar vinculado a uma empresa." });
      const lines = workspace.units.flatMap((unit) => {
        const value = Number(data.get("price_" + unit.id) ?? 0);
        const minimum = Number(data.get("minimum_" + unit.id) ?? 0);
        return value > 0 ? [{ salesUnitId: unit.id, listPrice: value, minimumAuthorizedPrice: minimum > 0 ? minimum : null }] : [];
      });
      if (!lines.length) return setFeedback({ type: "error", text: "Informe preço para pelo menos uma unidade." });
      return run(() => createSalesPriceTableAction({
        projectId: workspace.projectId,
        companyId: workspace.companyId as string,
        validFrom: new Date(String(data.get("validFrom")) + "T00:00:00Z"),
        notes: String(data.get("notes") ?? "").trim() || null,
        lines,
      }), "Nova versão da tabela de preços criada.");
    }

    if (modal.type === "broker") {
      const supplierId = String(data.get("supplierId") ?? "");
      if (!supplierId) return setFeedback({ type: "error", text: "Selecione o fornecedor/corretor." });
      const rate = Number(data.get("defaultCommissionRate") ?? 0);
      return run(() => createBrokerProfileAction({
        supplierId,
        creci: String(data.get("creci") ?? "").trim() || null,
        defaultCommissionRate: rate >= 0 ? rate / 100 : null,
        channel: String(data.get("channel") ?? "").trim() || null,
      }), "Perfil de corretor criado.");
    }

    if (modal.type === "commissionPolicy") {
      const percentage = Number(data.get("percentage") ?? 0);
      if (percentage < 0) return setFeedback({ type: "error", text: "Percentual inválido." });
      return run(() => createSalesCommissionPolicyAction({
        projectId: workspace.projectId,
        triggerEvent: String(data.get("triggerEvent") ?? "SIGNATURE") as "SIGNATURE" | "DOWN_PAYMENT_PAID" | "RECEIPT" | "MILESTONE" | "OTHER",
        percentage: percentage / 100,
        basis: String(data.get("basis") ?? "SOLD_PRICE") as "SOLD_PRICE" | "RECEIVED_AMOUNT",
      }), "Política de comissão criada.");
    }

    if (modal.type === "commission") {
      const saleId = String(data.get("saleId") ?? "");
      const brokerSupplierId = String(data.get("brokerSupplierId") ?? "");
      const percentage = Number(data.get("percentage") ?? 0);
      const policyId = String(data.get("policyId") ?? "") || null;
      if (!saleId || !brokerSupplierId || percentage < 0) return setFeedback({ type: "error", text: "Revise venda, corretor e percentual." });
      return run(() => createSalesCommissionAction({
        saleId,
        brokerId: brokerSupplierId,
        policyId,
        basis: String(data.get("basis") ?? "SOLD_PRICE") as "SOLD_PRICE" | "RECEIVED_AMOUNT",
        percentage: percentage / 100,
        triggerEvent: String(data.get("triggerEvent") ?? "SIGNATURE") as "SIGNATURE" | "DOWN_PAYMENT_PAID" | "RECEIPT" | "MILESTONE" | "OTHER",
      }), "Comissão criada.");
    }

    if (modal.type === "inspection") {
      const saleId = String(data.get("saleId") ?? "");
      const sale = approvedSales.find((item) => item.id === saleId);
      if (!sale) return setFeedback({ type: "error", text: "Selecione uma venda aprovada." });
      return run(() => scheduleInspectionAction({
        salesUnitId: sale.salesUnitId,
        saleId: sale.id,
        scheduledAt: new Date(String(data.get("scheduledAt")) + "T12:00:00Z"),
        checklist: {},
      }), "Vistoria agendada.");
    }

    if (modal.type === "inspectionOutcome") {
      const outcome = String(data.get("outcome") ?? "ACCEPTED") as "ACCEPTED" | "ACCEPTED_WITH_PENDING" | "REJECTED";
      const next = String(data.get("nextInspectionAt") ?? "");
      return run(() => recordInspectionOutcomeAction({
        inspectionId: modal.id as string,
        outcome,
        pendingIssues: String(data.get("pendingIssues") ?? "").trim() ? [{ description: String(data.get("pendingIssues")) }] : [],
        nextInspectionAt: next ? new Date(next + "T12:00:00Z") : null,
      }), "Resultado da vistoria registrado.");
    }

    if (modal.type === "postSale") {
      const saleId = String(data.get("saleId") ?? "");
      const sale = approvedSales.find((item) => item.id === saleId);
      if (!sale || !sale.buyerCustomerId) return setFeedback({ type: "error", text: "A venda selecionada não possui comprador principal." });
      const description = String(data.get("description") ?? "").trim();
      if (!description) return setFeedback({ type: "error", text: "Descreva o chamado." });
      const sla = String(data.get("slaDueAt") ?? "");
      return run(() => createPostSaleRequestAction({
        salesUnitId: sale.salesUnitId,
        saleId: sale.id,
        customerId: sale.buyerCustomerId,
        category: String(data.get("category") ?? "ASSISTENCIA") as "GARANTIA" | "ASSISTENCIA" | "OCORRENCIA" | "OUTRO",
        description,
        slaDueAt: sla ? new Date(sla + "T12:00:00Z") : null,
      }), "Chamado de pós-venda aberto.");
    }

    const requestId = modal.id as string;
    const supplierId = String(data.get("supplierId") ?? "") || null;
    const estimatedCostRaw = String(data.get("estimatedCost") ?? "").trim();
    const actualCostRaw = String(data.get("actualCost") ?? "").trim();
    const status = String(data.get("status") ?? "");
    const recurrenceOfId = String(data.get("recurrenceOfId") ?? "");
    startTransition(async () => {
      setFeedback(null);
      if (supplierId) {
        const supplier = await assignPostSaleSupplierAction({ requestId, supplierId });
        if (!supplier.ok) return setFeedback({ type: "error", text: supplier.error ?? "Falha ao atribuir fornecedor." });
      }
      if (estimatedCostRaw || actualCostRaw) {
        const cost = await setPostSaleCostAction({
          requestId,
          estimatedCost: estimatedCostRaw ? Number(estimatedCostRaw) : undefined,
          actualCost: actualCostRaw ? Number(actualCostRaw) : undefined,
        });
        if (!cost.ok) return setFeedback({ type: "error", text: cost.error ?? "Falha ao registrar custo." });
      }
      if (recurrenceOfId) {
        const recurrence = await markPostSaleRecurrenceAction({ requestId, recurrenceOfId });
        if (!recurrence.ok) return setFeedback({ type: "error", text: recurrence.error ?? "Falha ao registrar reincidência." });
      }
      if (status) {
        const transition = await transitionPostSaleRequestAction({ requestId, status: status as "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED" });
        if (!transition.ok) return setFeedback({ type: "error", text: transition.error ?? "Falha ao atualizar status." });
      }
      setModal(null);
      setFeedback({ type: "success", text: "Chamado atualizado." });
      router.refresh();
    });
  };

  return <section className="panel">
    <div className="panel-heading">
      <div><span className="eyebrow">CICLO COMERCIAL COMPLETO</span><h2>Estoque, preço, comissão, vistoria e pós-venda</h2><p>Complete o ciclo operacional além da venda: cadastre estoque, governe preços, comissões, entrega e assistência.</p></div>
      <div className="panel-actions">
        <button className="button button-secondary" disabled={pending || !canWrite || !workspace.companyId} onClick={() => setModal({ type: "unit" })}><Boxes size={15}/> Unidade</button>
        <button className="button button-secondary" disabled={pending || !canWrite || workspace.units.length === 0} onClick={() => setModal({ type: "priceTable" })}><TableProperties size={15}/> Tabela de preços</button>
        <button className="button button-secondary" disabled={pending || !canApprove} onClick={() => setModal({ type: "commissionPolicy" })}><HandCoins size={15}/> Política comissão</button>
        <button className="button button-primary" disabled={pending || !canWrite || approvedSales.length === 0} onClick={() => setModal({ type: "postSale" })}><LifeBuoy size={15}/> Pós-venda</button>
      </div>
    </div>
    {feedback && <div className={feedback.type === "error" ? styles.error : styles.success}>{feedback.text}</div>}

    <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Frente</th><th>Registro</th><th>Situação</th><th>Ação</th></tr></thead><tbody>
      {workspace.units.slice(0, 12).map((unit) => <tr key={"unit-" + unit.id}><td>Unidade</td><td><strong>{unit.code}</strong><small>{unit.typology} · {unit.privateAreaM2} m²</small></td><td>{unit.status}</td><td>{unit.activeBlock ? <button className="button button-secondary" disabled={pending || !canWrite} onClick={() => run(() => unblockSalesUnitAction(unit.activeBlock!.id), "Unidade desbloqueada.")}>Desbloquear</button> : <button className="button button-secondary" disabled={pending || !canWrite || !["DISPONIVEL","EM_RESERVA","EM_PROPOSTA"].includes(unit.status)} onClick={() => setModal({ type: "block", id: unit.id, label: unit.code })}>Bloquear</button>}</td></tr>)}
      {workspace.priceTables.slice(0, 5).map((table) => <tr key={"table-" + table.id}><td>Tabela</td><td><strong>Versão {table.version}</strong><small>{table.lines} unidade(s)</small></td><td>{table.status}</td><td>{table.status !== "ACTIVE" && <button className="button button-secondary" disabled={pending || !canApprove} onClick={() => run(() => activateSalesPriceTableAction(table.id), "Tabela de preços ativada.")}>Ativar</button>}</td></tr>)}
      {workspace.commissions.filter((item) => item.status === "PENDING").slice(0, 8).map((commission) => <tr key={"commission-" + commission.id}><td>Comissão</td><td><strong>{commission.broker}</strong><small>Venda {commission.sale}</small></td><td>Pendente</td><td><button className="button button-secondary" disabled={pending || !canApprove} onClick={() => run(() => approveSalesCommissionAction(commission.id), "Comissão aprovada.")}>Aprovar</button></td></tr>)}
      {workspace.inspections.slice(0, 8).map((inspection) => <tr key={"inspection-" + inspection.id}><td>Vistoria</td><td><strong>{inspection.unit}</strong><small>{new Date(inspection.scheduledAt).toLocaleDateString("pt-BR")}</small></td><td>{inspection.outcome ?? "Agendada"}</td><td>{!inspection.outcome ? <button className="button button-secondary" disabled={pending || !canWrite} onClick={() => setModal({ type: "inspectionOutcome", id: inspection.id, label: inspection.unit })}><ClipboardCheck size={15}/> Resultado</button> : inspection.outcome === "ACCEPTED" ? <button className="button button-secondary" disabled={pending || !canApprove} onClick={() => run(() => markUnitDeliveredAction(inspection.salesUnitId), "Unidade marcada como entregue.")}>Entregar chaves</button> : null}</td></tr>)}
      {openPostSale.slice(0, 8).map((request) => <tr key={"post-" + request.id}><td>Pós-venda</td><td><strong>{request.unit} · {request.category}</strong><small>{request.customer}</small></td><td>{request.status}{request.slaViolated ? " · SLA vencido" : ""}</td><td><button className="button button-secondary" disabled={pending || !canWrite} onClick={() => setModal({ type: "postSaleManage", id: request.id, label: request.unit })}>Gerenciar</button></td></tr>)}
    </tbody></table></div>

    <div className="panel-actions" style={{ marginTop: 12 }}>
      <button className="button button-secondary" disabled={pending || !canWrite || workspace.units.length === 0} onClick={() => setModal({ type: "block" })}>Bloquear unidade</button>
      <button className="button button-secondary" disabled={pending || !canWrite || availableSuppliersForBroker.length === 0} onClick={() => setModal({ type: "broker" })}>Cadastrar corretor</button>
      <button className="button button-secondary" disabled={pending || !canWrite || approvedSales.length === 0 || workspace.brokers.length === 0} onClick={() => setModal({ type: "commission" })}>Criar comissão</button>
      <button className="button button-secondary" disabled={pending || !canWrite || approvedSales.length === 0} onClick={() => setModal({ type: "inspection" })}>Agendar vistoria</button>
    </div>

    {modal && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setModal(null); }}><div className={styles.modal} role="dialog" aria-modal="true">
      <div className={styles.modalHeader}><div><h3>{modalTitle(modal.type)}</h3><p>{modal.label ?? "Operação comercial auditável."}</p></div><button type="button" className={styles.closeButton} disabled={pending} onClick={() => setModal(null)}>×</button></div>
      <form className={styles.form} onSubmit={submit}><div className={styles.formGrid}>
        {modal.type === "unit" && <>
          <Field label="Código"><input name="code" required autoFocus /></Field><Field label="Tipologia"><input name="typology" required /></Field><Field label="Pavimento"><input name="floor" /></Field><Field label="Área privativa (m²)"><input name="privateAreaM2" type="number" min="0.01" step="0.01" required /></Field><Field label="Área total (m²)"><input name="totalAreaM2" type="number" min="0" step="0.01" /></Field><Field label="Vagas"><input name="parkingSpaces" type="number" min="0" step="1" defaultValue="0" /></Field><Field label="Depósitos"><input name="storageUnits" type="number" min="0" step="1" defaultValue="0" /></Field><Field label="Posição"><input name="position" /></Field>
        </>}
        {modal.type === "block" && <>
          <Field label="Unidade"><select name="salesUnitId" required defaultValue={modal.id ?? ""}><option value="" disabled>Selecione</option>{workspace.units.filter((unit) => !unit.activeBlock).map((unit) => <option key={unit.id} value={unit.id}>{unit.code} · {unit.status}</option>)}</select></Field>
          <Field label="Origem"><select name="origin" defaultValue="COMERCIAL"><option value="COMERCIAL">Comercial</option><option value="JURIDICO">Jurídico</option><option value="DIRETORIA">Diretoria</option><option value="INCORPORACAO">Incorporação</option><option value="TECNICA">Técnica</option><option value="PERMUTA">Permuta</option><option value="OUTRO">Outro</option></select></Field>
          <Field label="Motivo" full><textarea name="reason" required /></Field>
        </>}
        {modal.type === "priceTable" && <>
          <Field label="Vigência inicial"><input name="validFrom" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></Field>
          <Field label="Observação"><input name="notes" /></Field>
          {workspace.units.map((unit) => <div key={unit.id} className={styles.field}><label>{unit.code} · preço lista</label><input name={"price_" + unit.id} type="number" min="0" step="0.01" defaultValue={unit.listPrice ?? ""} /><span className={styles.help}>Mínimo autorizado</span><input name={"minimum_" + unit.id} type="number" min="0" step="0.01" /></div>)}
        </>}
        {modal.type === "broker" && <>
          <Field label="Fornecedor / corretor"><select name="supplierId" required defaultValue=""><option value="" disabled>Selecione</option>{availableSuppliersForBroker.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="CRECI"><input name="creci" /></Field><Field label="Comissão padrão (%)"><input name="defaultCommissionRate" type="number" min="0" step="0.01" /></Field><Field label="Canal"><input name="channel" /></Field>
        </>}
        {modal.type === "commissionPolicy" && <>
          <Field label="Percentual (%)"><input name="percentage" type="number" min="0" step="0.01" required /></Field><Field label="Base"><select name="basis" defaultValue="SOLD_PRICE"><option value="SOLD_PRICE">Preço de venda</option><option value="RECEIVED_AMOUNT">Valor recebido</option></select></Field><Field label="Gatilho"><select name="triggerEvent" defaultValue="SIGNATURE"><option value="SIGNATURE">Assinatura</option><option value="DOWN_PAYMENT_PAID">Entrada paga</option><option value="RECEIPT">Recebimento</option><option value="MILESTONE">Marco</option><option value="OTHER">Outro</option></select></Field>
        </>}
        {modal.type === "commission" && <>
          <Field label="Venda"><select name="saleId" required defaultValue=""><option value="" disabled>Selecione</option>{approvedSales.map((sale) => <option key={sale.id} value={sale.id}>{sale.unit} · {sale.buyers.join(", ")}</option>)}</select></Field><Field label="Corretor"><select name="brokerSupplierId" required defaultValue=""><option value="" disabled>Selecione</option>{workspace.brokers.map((broker) => <option key={broker.id} value={broker.supplierId}>{broker.name}</option>)}</select></Field><Field label="Política"><select name="policyId" defaultValue=""><option value="">Sem política vinculada</option>{workspace.commissionPolicies.map((item) => <option key={item.id} value={item.id}>{item.triggerEvent} · {(item.percentage * 100).toFixed(2)}%</option>)}</select></Field><Field label="Percentual (%)"><input name="percentage" type="number" min="0" step="0.01" required /></Field><Field label="Base"><select name="basis" defaultValue="SOLD_PRICE"><option value="SOLD_PRICE">Preço de venda</option><option value="RECEIVED_AMOUNT">Valor recebido</option></select></Field><Field label="Gatilho"><select name="triggerEvent" defaultValue="SIGNATURE"><option value="SIGNATURE">Assinatura</option><option value="DOWN_PAYMENT_PAID">Entrada paga</option><option value="RECEIPT">Recebimento</option><option value="MILESTONE">Marco</option><option value="OTHER">Outro</option></select></Field>
        </>}
        {modal.type === "inspection" && <><Field label="Venda / unidade"><select name="saleId" required defaultValue=""><option value="" disabled>Selecione</option>{approvedSales.map((sale) => <option key={sale.id} value={sale.id}>{sale.unit} · {sale.buyers.join(", ")}</option>)}</select></Field><Field label="Data e hora"><input name="scheduledAt" type="datetime-local" required /></Field></>}
        {modal.type === "inspectionOutcome" && <><Field label="Resultado"><select name="outcome" defaultValue="ACCEPTED"><option value="ACCEPTED">Aceita</option><option value="ACCEPTED_WITH_PENDING">Aceita com pendências</option><option value="REJECTED">Rejeitada</option></select></Field><Field label="Próxima vistoria"><input name="nextInspectionAt" type="date" /></Field><Field label="Pendências" full><textarea name="pendingIssues" /></Field></>}
        {modal.type === "postSale" && <><Field label="Venda / unidade"><select name="saleId" required defaultValue=""><option value="" disabled>Selecione</option>{approvedSales.map((sale) => <option key={sale.id} value={sale.id}>{sale.unit} · {sale.buyers.join(", ")}</option>)}</select></Field><Field label="Categoria"><select name="category" defaultValue="ASSISTENCIA"><option value="GARANTIA">Garantia</option><option value="ASSISTENCIA">Assistência</option><option value="OCORRENCIA">Ocorrência</option><option value="OUTRO">Outro</option></select></Field><Field label="SLA até"><input name="slaDueAt" type="date" /></Field><Field label="Descrição" full><textarea name="description" required /></Field></>}
        {modal.type === "postSaleManage" && <><Field label="Fornecedor"><select name="supplierId" defaultValue=""><option value="">Sem alteração</option>{workspace.suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Status"><select name="status" defaultValue=""><option value="">Sem alteração</option><option value="OPEN">Aberto</option><option value="IN_PROGRESS">Em andamento</option><option value="WAITING_CUSTOMER">Aguardando cliente</option><option value="RESOLVED">Resolvido</option><option value="CLOSED">Fechado</option></select></Field><Field label="Custo estimado"><input name="estimatedCost" type="number" min="0" step="0.01" /></Field><Field label="Custo realizado"><input name="actualCost" type="number" min="0" step="0.01" /></Field><Field label="Reincidência de"><select name="recurrenceOfId" defaultValue=""><option value="">Não marcar</option>{workspace.postSaleRequests.filter((item) => item.id !== modal.id).map((item) => <option key={item.id} value={item.id}>{item.unit} · {item.category} · {item.status}</option>)}</select></Field></>}
      </div><div className={styles.modalActions}><button type="button" className="button button-secondary" disabled={pending} onClick={() => setModal(null)}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending}>{pending ? "Processando..." : "Confirmar"}</button></div></form>
    </div></div>}
  </section>;
}

function Field({ label, children, full = false }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <div className={full ? styles.field + " " + styles.fieldFull : styles.field}><label>{label}</label>{children}</div>;
}

function modalTitle(type: ModalType) {
  const labels: Record<ModalType, string> = {
    unit: "Cadastrar unidade",
    block: "Bloquear unidade",
    priceTable: "Nova tabela de preços",
    broker: "Cadastrar corretor",
    commissionPolicy: "Nova política de comissão",
    commission: "Criar comissão",
    inspection: "Agendar vistoria",
    inspectionOutcome: "Resultado da vistoria",
    postSale: "Abrir pós-venda",
    postSaleManage: "Gerenciar pós-venda",
  };
  return labels[type];
}
