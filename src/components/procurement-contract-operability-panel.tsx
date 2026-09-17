"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileSignature, Ruler, ShoppingBag, SquarePen } from "lucide-react";
import type { ProcurementOperabilityMetadata } from "@/application/procurement/procurement-operability-service";
import type { ProcurementWorkspaceView } from "@/application/procurement/procurement-service";
import {
  approveContractAmendmentAction,
  approveMeasurementAction,
  approvePurchaseOrderAction,
  createContractAmendmentAction,
  createMeasurementAction,
  createOperationalContractAction,
  createPurchaseOrderAction,
  transitionMeasurementAction,
  transitionOperationalContractAction,
} from "@/app/actions/procurement";

type FormKey = "order" | "contract" | "amendment" | "measurement" | null;
type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function ProcurementContractOperabilityPanel({ workspace, operability }: { workspace: ProcurementWorkspaceView; operability: ProcurementOperabilityMetadata }) {
  const router = useRouter();
  const [form, setForm] = useState<FormKey>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sourceQuotationId, setSourceQuotationId] = useState("");
  const [measurementContractId, setMeasurementContractId] = useState("");

  const decidedSources = useMemo(() => operability.quotations.filter((item) => item.status === "DECIDED" && item.selectedProposal), [operability.quotations]);
  const selectedSource = useMemo(() => decidedSources.find((item) => item.id === sourceQuotationId) ?? null, [decidedSources, sourceQuotationId]);
  const measurableContracts = useMemo(() => operability.contracts.filter((item) => ["APPROVED", "ACTIVE", "SUSPENDED"].includes(item.status)), [operability.contracts]);
  const selectedMeasurementContract = useMemo(() => measurableContracts.find((item) => item.id === measurementContractId) ?? null, [measurableContracts, measurementContractId]);

  async function run<T>(operation: () => Promise<ActionResult<T>>, success: string) {
    setBusy(true);
    setFeedback(null);
    const result = await operation();
    setBusy(false);
    if (!result.ok) {
      setFeedback(result.error);
      return false;
    }
    setFeedback(success);
    setForm(null);
    router.refresh();
    return true;
  }

  function sourceItems() {
    if (!selectedSource?.selectedProposal) return [];
    return selectedSource.selectedProposal.items.map((item, index) => ({
      code: `ITEM-${String(index + 1).padStart(3, "0")}`,
      description: item.description,
      quantity: String(item.quantity),
      unit: item.unit,
      unitPrice: String(item.unitPrice),
    }));
  }

  async function submitOrder(data: FormData) {
    if (!selectedSource?.selectedProposal || !operability.companyId) {
      setFeedback("O empreendimento precisa ter uma SPE/empresa vinculada e uma cotação decidida.");
      return;
    }
    await run(() => createPurchaseOrderAction({
      projectId: workspace.projectId,
      companyId: operability.companyId!,
      supplierId: selectedSource.selectedProposal!.supplierId,
      quotationProcessId: selectedSource.id,
      selectedProposalId: selectedSource.selectedProposal!.id,
      number: String(data.get("number")),
      title: String(data.get("title")),
      scope: String(data.get("scope")),
      deliveryAt: data.get("deliveryAt") ? new Date(`${data.get("deliveryAt")}T23:59:59.000Z`) : null,
      paymentTerms: String(data.get("paymentTerms") || "") || null,
      items: sourceItems().map(({ code: _code, ...item }) => item),
    }), "Pedido de compra criado.");
  }

  async function submitContract(data: FormData) {
    if (!selectedSource?.selectedProposal || !operability.companyId) {
      setFeedback("O empreendimento precisa ter uma SPE/empresa vinculada e uma cotação decidida.");
      return;
    }
    await run(() => createOperationalContractAction({
      projectId: workspace.projectId,
      companyId: operability.companyId!,
      supplierId: selectedSource.selectedProposal!.supplierId,
      quotationProcessId: selectedSource.id,
      selectedProposalId: selectedSource.selectedProposal!.id,
      number: String(data.get("number")),
      title: String(data.get("title")),
      type: String(data.get("type")) as "SUPPLY" | "SERVICE" | "CONSTRUCTION" | "DESIGN" | "CONSULTING" | "LEASE" | "ACQUISITION" | "OTHER",
      billingModel: String(data.get("billingModel")) as "MEASUREMENT" | "FIXED_INSTALLMENT" | "MONTHLY" | "MILESTONE" | "DELIVERY" | "ADVANCE" | "CUSTOM",
      scope: String(data.get("scope")),
      startsAt: new Date(`${data.get("startsAt")}T00:00:00.000Z`),
      endsAt: new Date(`${data.get("endsAt")}T23:59:59.000Z`),
      responsibleId: operability.currentUserId,
      paymentTerms: String(data.get("paymentTerms") || "") || null,
      retentionRate: String(data.get("retentionRate") || "0"),
      warrantyTerms: String(data.get("warrantyTerms") || "") || null,
      items: sourceItems(),
    }), "Contrato criado em rascunho.");
  }

  async function submitAmendment(data: FormData) {
    await run(() => createContractAmendmentAction({
      contractId: String(data.get("contractId")),
      number: Number(data.get("number")),
      type: String(data.get("type")) as "INCREASE" | "SUPPRESSION" | "TERM" | "SCOPE" | "READJUSTMENT" | "OTHER",
      reason: String(data.get("reason")),
      deviationCause: String(data.get("deviationCause")) as "PRICE" | "QUANTITY" | "SCOPE" | "TERM" | "DESIGN" | "BUDGET_ERROR" | "MARKET" | "SUPPLIER" | "REWORK" | "PRODUCTIVITY" | "UNFORESEEN_CONDITION" | "LEGAL_CHANGE" | "OTHER",
      scopeDescription: String(data.get("scopeDescription") || "") || null,
      value: String(data.get("value") || "0"),
      termDays: Number(data.get("termDays") || 0),
      effectiveAt: data.get("effectiveAt") ? new Date(`${data.get("effectiveAt")}T00:00:00.000Z`) : null,
    }), "Aditivo criado.");
  }

  async function submitMeasurement(data: FormData) {
    if (!selectedMeasurementContract) {
      setFeedback("Selecione um contrato disponível para medição.");
      return;
    }
    const lines = selectedMeasurementContract.items.map((item) => ({
      contractItemId: item.id,
      periodQuantity: String(data.get(`quantity_${item.id}`) || "0"),
    })).filter((item) => Number(item.periodQuantity) > 0);
    if (lines.length === 0) {
      setFeedback("Informe quantidade medida em ao menos um item do contrato.");
      return;
    }
    await run(() => createMeasurementAction({
      contractId: selectedMeasurementContract.id,
      number: Number(data.get("number")),
      version: 1,
      competenceDate: new Date(`${data.get("competenceDate")}T00:00:00.000Z`),
      periodStart: new Date(`${data.get("periodStart")}T00:00:00.000Z`),
      periodEnd: new Date(`${data.get("periodEnd")}T23:59:59.000Z`),
      issuedAt: new Date(`${data.get("issuedAt")}T00:00:00.000Z`),
      dueDate: new Date(`${data.get("dueDate")}T23:59:59.000Z`),
      physicalProgress: data.get("physicalProgress") ? String(data.get("physicalProgress")) : null,
      retentionAmount: String(data.get("retentionAmount") || "0"),
      discountAmount: String(data.get("discountAmount") || "0"),
      advanceAmortizationAmount: String(data.get("advanceAmortizationAmount") || "0"),
      lines,
    }), "Medição criada em rascunho.");
  }

  async function advanceContract(id: string, status: string) {
    const next = status === "DRAFT" ? "UNDER_REVIEW" : status === "UNDER_REVIEW" ? "IN_APPROVAL" : status === "IN_APPROVAL" ? "APPROVED" : "ACTIVE";
    await run(() => transitionOperationalContractAction(id, next as "UNDER_REVIEW" | "IN_APPROVAL" | "APPROVED" | "ACTIVE"), `Contrato movido para ${next.replaceAll("_", " ").toLowerCase()}.`);
  }

  async function advanceMeasurement(id: string, status: string) {
    const next = status === "DRAFT" ? "SUBMITTED" : status === "SUBMITTED" ? "IN_TECHNICAL_REVIEW" : status === "IN_TECHNICAL_REVIEW" ? "TECHNICALLY_APPROVED" : "IN_APPROVAL";
    await run(() => transitionMeasurementAction(id, next as "SUBMITTED" | "IN_TECHNICAL_REVIEW" | "TECHNICALLY_APPROVED" | "IN_APPROVAL"), `Medição movida para ${next.replaceAll("_", " ").toLowerCase()}.`);
  }

  return (
    <section className="operations-panel">
      <header>
        <div><span className="eyebrow">CONTRATAÇÃO E MEDIÇÃO · 10C.1</span><h3>Pedidos, contratos, aditivos e medições</h3><p>Transforme a decisão de compra em compromisso contratual e execução medida.</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="button button-secondary" onClick={() => setForm(form === "order" ? null : "order")}><ShoppingBag size={16} /> Novo pedido</button>
          <button className="button button-secondary" onClick={() => setForm(form === "contract" ? null : "contract")}><FileSignature size={16} /> Novo contrato</button>
          <button className="button button-secondary" onClick={() => setForm(form === "amendment" ? null : "amendment")}><SquarePen size={16} /> Novo aditivo</button>
          <button className="button button-primary" onClick={() => setForm(form === "measurement" ? null : "measurement")}><Ruler size={16} /> Nova medição</button>
        </div>
      </header>

      {feedback && <div className="model-note"><CheckCircle2 size={20} /><div><strong>Contratação</strong><p>{feedback}</p></div></div>}

      {(form === "order" || form === "contract") && (
        <div className="operations-table-wrap" style={{ padding: 20, display: "grid", gap: 12 }}>
          <select value={sourceQuotationId} onChange={(event) => setSourceQuotationId(event.target.value)}><option value="">Selecione uma cotação decidida</option>{decidedSources.map((item) => <option value={item.id} key={item.id}>{item.number} · {item.title} · {item.selectedProposal?.supplierName}</option>)}</select>
          {!operability.companyId && <span className="negative-value">Este empreendimento não possui empresa/SPE vinculada. Pedido e contrato exigem `companyId`.</span>}
          {selectedSource && <div className="model-note"><FileSignature size={18} /><div><strong>{selectedSource.selectedProposal?.supplierName}</strong><p>{selectedSource.selectedProposal?.items.length} item(ns) serão trazidos da proposta selecionada.</p></div></div>}
        </div>
      )}

      {form === "order" && selectedSource && (
        <form action={submitOrder} className="operations-table-wrap" style={{ padding: 20, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}><input name="number" required placeholder="Número do pedido" /><input name="title" required placeholder="Título do pedido" /></div>
          <textarea name="scope" required placeholder="Escopo do pedido" style={{ minHeight: 80 }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}><input name="deliveryAt" type="date" /><input name="paymentTerms" placeholder="Condições de pagamento" /></div>
          <button className="button button-primary" disabled={busy || !operability.companyId} type="submit">Criar pedido</button>
        </form>
      )}

      {form === "contract" && selectedSource && (
        <form action={submitContract} className="operations-table-wrap" style={{ padding: 20, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}><input name="number" required placeholder="Número do contrato" /><input name="title" required placeholder="Título do contrato" /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><select name="type" defaultValue="CONSTRUCTION"><option value="SUPPLY">Fornecimento</option><option value="SERVICE">Serviço</option><option value="CONSTRUCTION">Construção</option><option value="DESIGN">Projeto</option><option value="CONSULTING">Consultoria</option><option value="OTHER">Outro</option></select><select name="billingModel" defaultValue="MEASUREMENT"><option value="MEASUREMENT">Medição</option><option value="FIXED_INSTALLMENT">Parcela fixa</option><option value="MONTHLY">Mensal</option><option value="MILESTONE">Marco</option><option value="DELIVERY">Entrega</option><option value="CUSTOM">Personalizado</option></select></div>
          <textarea name="scope" required placeholder="Escopo contratual" style={{ minHeight: 90 }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><input name="startsAt" type="date" required /><input name="endsAt" type="date" required /></div>
          <input name="paymentTerms" placeholder="Condições de pagamento" /><div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}><input name="retentionRate" type="number" min="0" step="0.01" defaultValue="0" placeholder="Retenção" /><input name="warrantyTerms" placeholder="Condições de garantia" /></div>
          <button className="button button-primary" disabled={busy || !operability.companyId} type="submit">Criar contrato</button>
        </form>
      )}

      {form === "amendment" && (
        <form action={submitAmendment} className="operations-table-wrap" style={{ padding: 20, display: "grid", gap: 10 }}>
          <select name="contractId" required defaultValue=""><option value="" disabled>Selecione o contrato vigente</option>{measurableContracts.map((item) => <option value={item.id} key={item.id}>{item.number} · {item.title}</option>)}</select>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}><input name="number" type="number" min="1" required placeholder="Nº do aditivo" /><select name="type" defaultValue="INCREASE"><option value="INCREASE">Acréscimo</option><option value="SUPPRESSION">Supressão</option><option value="TERM">Prazo</option><option value="SCOPE">Escopo</option><option value="READJUSTMENT">Reajuste</option><option value="OTHER">Outro</option></select><select name="deviationCause" defaultValue="SCOPE"><option value="PRICE">Preço</option><option value="QUANTITY">Quantidade</option><option value="SCOPE">Escopo</option><option value="TERM">Prazo</option><option value="DESIGN">Projeto</option><option value="MARKET">Mercado</option><option value="SUPPLIER">Fornecedor</option><option value="OTHER">Outro</option></select></div>
          <textarea name="reason" required placeholder="Motivo do aditivo" style={{ minHeight: 80 }} /><textarea name="scopeDescription" placeholder="Descrição do escopo alterado" style={{ minHeight: 70 }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}><input name="value" type="number" min="0" step="0.01" defaultValue="0" placeholder="Valor" /><input name="termDays" type="number" defaultValue="0" placeholder="Dias de prazo" /><input name="effectiveAt" type="date" /></div>
          <button className="button button-primary" disabled={busy} type="submit">Criar aditivo</button>
        </form>
      )}

      {form === "measurement" && (
        <form action={submitMeasurement} className="operations-table-wrap" style={{ padding: 20, display: "grid", gap: 10 }}>
          <select value={measurementContractId} onChange={(event) => setMeasurementContractId(event.target.value)} required><option value="">Selecione o contrato</option>{measurableContracts.map((item) => <option value={item.id} key={item.id}>{item.number} · {item.title}</option>)}</select>
          {selectedMeasurementContract && <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Item</th><th>Contratado</th><th>Unidade</th><th>Quantidade no período</th></tr></thead><tbody>{selectedMeasurementContract.items.map((item) => <tr key={item.id}><td>{item.code} · {item.description}</td><td>{item.quantity}</td><td>{item.unit}</td><td><input name={`quantity_${item.id}`} type="number" min="0" max={item.quantity} step="0.0001" defaultValue="0" /></td></tr>)}</tbody></table></div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}><input name="number" type="number" min="1" required placeholder="Nº medição" /><input name="competenceDate" type="date" required /><input name="physicalProgress" type="number" min="0" step="0.0001" placeholder="Avanço físico" /></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}><input name="periodStart" type="date" required /><input name="periodEnd" type="date" required /><input name="issuedAt" type="date" required /><input name="dueDate" type="date" required /></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}><input name="retentionAmount" type="number" min="0" step="0.01" defaultValue="0" placeholder="Retenção" /><input name="discountAmount" type="number" min="0" step="0.01" defaultValue="0" placeholder="Desconto/glosa" /><input name="advanceAmortizationAmount" type="number" min="0" step="0.01" defaultValue="0" placeholder="Amortização adiantamento" /></div>
          <button className="button button-primary" disabled={busy || !selectedMeasurementContract} type="submit">Criar medição</button>
        </form>
      )}

      <div className="operations-table-wrap" style={{ marginTop: 16 }}><table className="operations-table"><thead><tr><th>Tipo</th><th>Registro</th><th>Situação</th><th>Ação</th></tr></thead><tbody>
        {workspace.orders.filter((item) => ["DRAFT", "IN_APPROVAL"].includes(item.status)).map((item) => <tr key={`order-${item.id}`}><td>Pedido</td><td>{item.number} · {item.title}</td><td>{item.status}</td><td><button className="button button-secondary" disabled={busy} onClick={() => run(() => approvePurchaseOrderAction(item.id), "Pedido aprovado.")}>Aprovar pedido</button></td></tr>)}
        {workspace.contracts.filter((item) => ["DRAFT", "UNDER_REVIEW", "IN_APPROVAL", "APPROVED"].includes(item.status)).map((item) => <tr key={`contract-${item.id}`}><td>Contrato</td><td>{item.number} · {item.title}</td><td>{item.status.replaceAll("_", " ")}</td><td><button className="button button-secondary" disabled={busy} onClick={() => advanceContract(item.id, item.status)}>{item.status === "APPROVED" ? "Ativar" : "Avançar"}</button></td></tr>)}
        {workspace.contracts.flatMap((contract) => contract.amendments.map((amendment) => ({ ...amendment, contract: contract.number }))).filter((item) => item.status === "DRAFT").map((item) => <tr key={`amendment-${item.id}`}><td>Aditivo</td><td>{item.contract} · aditivo {item.number}</td><td>{item.status}</td><td><button className="button button-secondary" disabled={busy} onClick={() => run(() => approveContractAmendmentAction(item.id), "Aditivo aprovado.")}>Aprovar aditivo</button></td></tr>)}
        {workspace.measurements.filter((item) => ["DRAFT", "SUBMITTED", "IN_TECHNICAL_REVIEW", "TECHNICALLY_APPROVED", "IN_APPROVAL"].includes(item.status)).map((item) => <tr key={`measurement-${item.id}`}><td>Medição</td><td>BM {item.number} · {item.contract}</td><td>{item.status.replaceAll("_", " ")}</td><td>{item.status === "IN_APPROVAL" ? <button className="button button-primary" disabled={busy} onClick={() => run(() => approveMeasurementAction(item.id), "Medição aprovada e enviada ao Financeiro.")}>Aprovar e enviar ao Financeiro</button> : <button className="button button-secondary" disabled={busy} onClick={() => advanceMeasurement(item.id, item.status)}>Avançar</button>}</td></tr>)}
      </tbody></table></div>
    </section>
  );
}
