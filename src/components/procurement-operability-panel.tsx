"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FilePlus2, Gavel, ReceiptText, ShoppingCart, Workflow } from "lucide-react";
import type { ProcurementOperabilityMetadata } from "@/application/procurement/procurement-operability-service";
import type { ProcurementWorkspaceView } from "@/application/procurement/procurement-service";
import {
  createProcurementNeedAction,
  createPurchaseRequisitionAction,
  createQuotationProcessAction,
  decideQuotationAction,
  submitSupplierProposalAction,
  transitionPurchaseRequisitionAction,
  validateProcurementNeedAction,
} from "@/app/actions/procurement";

type FormKey = "need" | "requisition" | "quotation" | "proposal" | "decision" | null;
type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function ProcurementOperabilityPanel({ workspace, operability }: { workspace: ProcurementWorkspaceView; operability: ProcurementOperabilityMetadata }) {
  const router = useRouter();
  const [form, setForm] = useState<FormKey>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selectedNeedIds, setSelectedNeedIds] = useState<string[]>([]);
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);
  const [proposalQuotationId, setProposalQuotationId] = useState("");
  const [decisionQuotationId, setDecisionQuotationId] = useState("");

  const validatedNeeds = useMemo(() => workspace.needs.filter((item) => item.status === "VALIDATED"), [workspace.needs]);
  const requisitionsForQuotation = useMemo(() => workspace.requisitions.filter((item) => ["APPROVED_FOR_QUOTATION", "IN_QUOTATION"].includes(item.status)), [workspace.requisitions]);
  const requisitionsToAdvance = useMemo(() => workspace.requisitions.filter((item) => ["DRAFT", "REQUESTED", "IN_APPROVAL"].includes(item.status)), [workspace.requisitions]);
  const openQuotations = useMemo(() => operability.quotations.filter((item) => item.status === "OPEN"), [operability.quotations]);
  const proposalQuotation = useMemo(() => openQuotations.find((item) => item.id === proposalQuotationId) ?? null, [openQuotations, proposalQuotationId]);
  const decisionQuotation = useMemo(() => workspace.quotations.find((item) => item.id === decisionQuotationId) ?? null, [workspace.quotations, decisionQuotationId]);
  const decidableQuotations = useMemo(() => workspace.quotations.filter((item) => ["OPEN", "UNDER_ANALYSIS"].includes(item.status) && item.proposals.some((proposal) => proposal.status === "SUBMITTED")), [workspace.quotations]);

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

  async function submitNeed(data: FormData) {
    await run(() => createProcurementNeedAction({
      projectId: workspace.projectId,
      code: String(data.get("code")),
      description: String(data.get("description")),
      specification: String(data.get("specification")),
      quantity: String(data.get("quantity")),
      unit: String(data.get("unit")),
      requiredAt: new Date(`${data.get("requiredAt")}T00:00:00.000Z`),
      expectedLeadDays: Number(data.get("expectedLeadDays") || 30),
      bufferDays: Number(data.get("bufferDays") || 7),
      priority: String(data.get("priority") || "NORMAL") as "LOW" | "NORMAL" | "HIGH" | "CRITICAL",
      origin: "MANUAL",
    }), "Necessidade de compra registrada.");
  }

  async function submitRequisition(data: FormData) {
    if (selectedNeedIds.length === 0) {
      setFeedback("Selecione ao menos uma necessidade validada.");
      return;
    }
    const ok = await run(() => createPurchaseRequisitionAction({
      projectId: workspace.projectId,
      number: String(data.get("number")),
      title: String(data.get("title")),
      justification: String(data.get("justification") || "") || null,
      needIds: selectedNeedIds,
    }), "Requisição criada em rascunho.");
    if (ok) setSelectedNeedIds([]);
  }

  async function submitQuotation(data: FormData) {
    if (selectedSupplierIds.length === 0) {
      setFeedback("Selecione ao menos um fornecedor ativo.");
      return;
    }
    const requisitionId = String(data.get("requisitionId"));
    const deadline = String(data.get("responseDeadline") || "");
    const ok = await run(() => createQuotationProcessAction({
      requisitionId,
      number: String(data.get("number")),
      title: String(data.get("title")),
      scope: String(data.get("scope")),
      requirements: {},
      deliveryLocation: String(data.get("deliveryLocation") || "") || null,
      deliveryTerm: String(data.get("deliveryTerm") || "") || null,
      responseDeadline: deadline ? new Date(`${deadline}T23:59:59.000Z`) : null,
      supplierIds: selectedSupplierIds,
    }), "Processo de cotação aberto.");
    if (ok) setSelectedSupplierIds([]);
  }

  async function submitProposal(data: FormData) {
    const quotation = operability.quotations.find((item) => item.id === String(data.get("quotationProcessId")));
    if (!quotation) {
      setFeedback("Selecione uma cotação aberta.");
      return;
    }
    const supplierId = String(data.get("supplierId"));
    if (!supplierId) {
      setFeedback("Selecione o fornecedor da proposta.");
      return;
    }
    const items = quotation.requisitionItems.map((item) => ({
      requisitionItemId: item.id,
      description: item.description,
      quantity: String(item.quantity),
      unit: item.unit,
      unitPrice: String(data.get(`price_${item.id}`) || "0"),
      taxAmount: "0",
      freightAmount: "0",
      discountAmount: "0",
      comparability: "COMPARABLE" as const,
      inclusions: [],
      exclusions: [],
      technicalNotes: null,
    }));
    await run(() => submitSupplierProposalAction({
      quotationProcessId: quotation.id,
      supplierId,
      version: 1,
      taxAmount: String(data.get("taxAmount") || "0"),
      freightAmount: String(data.get("freightAmount") || "0"),
      discountAmount: String(data.get("discountAmount") || "0"),
      validityUntil: data.get("validityUntil") ? new Date(`${data.get("validityUntil")}T23:59:59.000Z`) : null,
      deliveryTermDays: data.get("deliveryTermDays") ? Number(data.get("deliveryTermDays")) : null,
      paymentTerms: String(data.get("paymentTerms") || "") || null,
      warrantyTerms: String(data.get("warrantyTerms") || "") || null,
      inclusions: [],
      exclusions: [],
      notes: String(data.get("notes") || "") || null,
      items,
    }), "Proposta do fornecedor registrada.");
  }

  async function submitDecision(data: FormData) {
    const quotationProcessId = String(data.get("quotationProcessId"));
    const selectedProposalId = String(data.get("selectedProposalId"));
    if (!quotationProcessId || !selectedProposalId) {
      setFeedback("Selecione a cotação e a proposta vencedora.");
      return;
    }
    await run(() => decideQuotationAction({
      quotationProcessId,
      selectedProposalId,
      technicalOpinion: String(data.get("technicalOpinion")),
      commercialRationale: String(data.get("commercialRationale")),
      referenceAmount: String(data.get("referenceAmount")),
      scopeComparable: data.get("scopeComparable") === "on",
    }), "Cotação decidida e registrada.");
  }

  async function validateNeed(id: string) {
    await run(() => validateProcurementNeedAction(id), "Necessidade validada.");
  }

  async function advanceRequisition(id: string, status: string) {
    const next = status === "DRAFT" ? "REQUESTED" : status === "REQUESTED" ? "IN_APPROVAL" : "APPROVED_FOR_QUOTATION";
    await run(() => transitionPurchaseRequisitionAction(id, next as "REQUESTED" | "IN_APPROVAL" | "APPROVED_FOR_QUOTATION"), `Requisição movida para ${next.replaceAll("_", " ").toLowerCase()}.`);
  }

  function toggleNeed(id: string) {
    setSelectedNeedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleSupplier(id: string) {
    setSelectedSupplierIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  return (
    <section className="operations-panel">
      <header>
        <div>
          <span className="eyebrow">OPERAÇÃO HUMANA · 10C.1</span>
          <h3>Lançamentos de Suprimentos</h3>
          <p>Necessidade → requisição → cotação → proposta → decisão, com persistência e auditoria reais.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="button button-secondary" onClick={() => setForm(form === "need" ? null : "need")}><FilePlus2 size={16} /> Nova necessidade</button>
          <button className="button button-secondary" onClick={() => setForm(form === "requisition" ? null : "requisition")}><Workflow size={16} /> Nova requisição</button>
          <button className="button button-secondary" onClick={() => setForm(form === "quotation" ? null : "quotation")}><ShoppingCart size={16} /> Nova cotação</button>
          <button className="button button-secondary" onClick={() => setForm(form === "proposal" ? null : "proposal")}><ReceiptText size={16} /> Registrar proposta</button>
          <button className="button button-primary" onClick={() => setForm(form === "decision" ? null : "decision")}><Gavel size={16} /> Decidir cotação</button>
        </div>
      </header>

      {feedback && <div className="model-note" role="status"><CheckCircle2 size={20} /><div><strong>Suprimentos</strong><p>{feedback}</p></div></div>}

      {form === "need" && (
        <form action={submitNeed} className="operations-table-wrap" style={{ padding: 20, display: "grid", gap: 10, gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
          <input name="code" placeholder="Código (ex.: NEC-001)" required />
          <input name="description" placeholder="Descrição" required style={{ gridColumn: "span 2" }} />
          <select name="priority" defaultValue="NORMAL"><option value="LOW">Baixa</option><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select>
          <textarea name="specification" placeholder="Especificação técnica" required style={{ gridColumn: "span 4", minHeight: 90 }} />
          <input name="quantity" type="number" min="0.0001" step="0.0001" placeholder="Quantidade" required />
          <input name="unit" placeholder="Unidade (m², un, kg...)" required />
          <input name="requiredAt" type="date" required />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><input name="expectedLeadDays" type="number" min="0" defaultValue="30" title="Lead time" /><input name="bufferDays" type="number" min="0" defaultValue="7" title="Folga" /></div>
          <button className="button button-primary" disabled={busy} type="submit">Registrar necessidade</button>
          <button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button>
        </form>
      )}

      {form === "requisition" && (
        <form action={submitRequisition} className="operations-table-wrap" style={{ padding: 20, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}><input name="number" placeholder="Número da requisição" required /><input name="title" placeholder="Título" required /></div>
          <textarea name="justification" placeholder="Justificativa" style={{ minHeight: 70 }} />
          <div><strong>Necessidades validadas</strong><div style={{ display: "grid", gap: 8, marginTop: 8 }}>{validatedNeeds.map((item) => <label key={item.id} style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={selectedNeedIds.includes(item.id)} onChange={() => toggleNeed(item.id)} /><span>{item.code} · {item.description} · {item.quantity} {item.unit}</span></label>)}{validatedNeeds.length === 0 && <span className="operations-empty">Nenhuma necessidade validada disponível.</span>}</div></div>
          <div style={{ display: "flex", gap: 8 }}><button className="button button-primary" disabled={busy || validatedNeeds.length === 0} type="submit">Criar requisição</button><button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button></div>
        </form>
      )}

      {form === "quotation" && (
        <form action={submitQuotation} className="operations-table-wrap" style={{ padding: 20, display: "grid", gap: 12 }}>
          <select name="requisitionId" required defaultValue=""><option value="" disabled>Selecione a requisição</option>{requisitionsForQuotation.map((item) => <option value={item.id} key={item.id}>{item.number} · {item.title}</option>)}</select>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}><input name="number" placeholder="Número da cotação" required /><input name="title" placeholder="Título da cotação" required /></div>
          <textarea name="scope" placeholder="Escopo da cotação" required style={{ minHeight: 90 }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}><input name="deliveryLocation" placeholder="Local de entrega" /><input name="deliveryTerm" placeholder="Prazo/condição de entrega" /><input name="responseDeadline" type="date" /></div>
          <div><strong>Fornecedores convidados</strong><div style={{ display: "grid", gap: 8, marginTop: 8 }}>{workspace.suppliers.filter((item) => item.status === "ACTIVE").map((item) => <label key={item.id} style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={selectedSupplierIds.includes(item.id)} onChange={() => toggleSupplier(item.id)} /><span>{item.name}{item.taxId ? ` · ${item.taxId}` : ""}</span></label>)}{workspace.suppliers.filter((item) => item.status === "ACTIVE").length === 0 && <span className="operations-empty">Nenhum fornecedor ativo disponível.</span>}</div></div>
          <div style={{ display: "flex", gap: 8 }}><button className="button button-primary" disabled={busy || requisitionsForQuotation.length === 0} type="submit">Abrir cotação</button><button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button></div>
        </form>
      )}

      {form === "proposal" && (
        <form action={submitProposal} className="operations-table-wrap" style={{ padding: 20, display: "grid", gap: 12 }}>
          <select name="quotationProcessId" required value={proposalQuotationId} onChange={(event) => setProposalQuotationId(event.target.value)}><option value="">Selecione a cotação aberta</option>{openQuotations.map((item) => <option key={item.id} value={item.id}>{item.number} · {item.title}</option>)}</select>
          {proposalQuotation && <>
            <select name="supplierId" required defaultValue=""><option value="" disabled>Selecione o fornecedor convidado</option>{proposalQuotation.invitedSuppliers.map((item) => <option key={item.supplierId} value={item.supplierId}>{item.supplierName}</option>)}</select>
            <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Item</th><th>Quantidade</th><th>Unidade</th><th>Preço unitário</th></tr></thead><tbody>{proposalQuotation.requisitionItems.map((item) => <tr key={item.id}><td>{item.description}</td><td>{item.quantity}</td><td>{item.unit}</td><td><input name={`price_${item.id}`} type="number" step="0.01" min="0" required placeholder="0,00" /></td></tr>)}</tbody></table></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}><input name="taxAmount" type="number" step="0.01" min="0" defaultValue="0" placeholder="Impostos" /><input name="freightAmount" type="number" step="0.01" min="0" defaultValue="0" placeholder="Frete" /><input name="discountAmount" type="number" step="0.01" min="0" defaultValue="0" placeholder="Desconto" /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><input name="validityUntil" type="date" /><input name="deliveryTermDays" type="number" min="0" placeholder="Prazo de entrega (dias)" /></div>
            <input name="paymentTerms" placeholder="Condições de pagamento" /><input name="warrantyTerms" placeholder="Garantias" /><textarea name="notes" placeholder="Observações da proposta" style={{ minHeight: 70 }} />
            <div style={{ display: "flex", gap: 8 }}><button className="button button-primary" disabled={busy} type="submit">Registrar proposta</button><button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button></div>
          </>}
          {!proposalQuotation && <span className="operations-empty">Selecione uma cotação para carregar seus itens e fornecedores convidados.</span>}
        </form>
      )}

      {form === "decision" && (
        <form action={submitDecision} className="operations-table-wrap" style={{ padding: 20, display: "grid", gap: 12 }}>
          <select name="quotationProcessId" required value={decisionQuotationId} onChange={(event) => setDecisionQuotationId(event.target.value)}><option value="">Selecione a cotação</option>{decidableQuotations.map((item) => <option key={item.id} value={item.id}>{item.number} · {item.title}</option>)}</select>
          {decisionQuotation && <>
            <select name="selectedProposalId" required defaultValue=""><option value="" disabled>Selecione a proposta vencedora</option>{decisionQuotation.proposals.filter((proposal) => proposal.status === "SUBMITTED").map((proposal) => <option key={proposal.id} value={proposal.id}>{proposal.supplier} · {proposal.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</option>)}</select>
            <input name="referenceAmount" type="number" step="0.01" min="0" required placeholder="Valor de referência / orçamento oficial" />
            <textarea name="technicalOpinion" required placeholder="Parecer técnico" style={{ minHeight: 80 }} />
            <textarea name="commercialRationale" required placeholder="Justificativa comercial da decisão" style={{ minHeight: 80 }} />
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input name="scopeComparable" type="checkbox" /> Escopo tecnicamente comparável para cálculo de economia validada</label>
            <div style={{ display: "flex", gap: 8 }}><button className="button button-primary" disabled={busy} type="submit">Registrar decisão</button><button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button></div>
          </>}
          {!decisionQuotation && <span className="operations-empty">Selecione uma cotação com proposta submetida.</span>}
        </form>
      )}

      <div className="operations-table-wrap" style={{ marginTop: 16 }}>
        <table className="operations-table">
          <thead><tr><th>Fluxo</th><th>Registro</th><th>Situação</th><th>Ação humana</th></tr></thead>
          <tbody>
            {workspace.needs.filter((item) => item.status === "IDENTIFIED").slice(0, 8).map((item) => <tr key={`need-${item.id}`}><td>Necessidade</td><td><strong>{item.code}</strong><small>{item.description}</small></td><td>{item.status}</td><td><button className="button button-secondary" disabled={busy} onClick={() => validateNeed(item.id)}>Validar</button></td></tr>)}
            {requisitionsToAdvance.slice(0, 8).map((item) => <tr key={`req-${item.id}`}><td>Requisição</td><td><strong>{item.number}</strong><small>{item.title}</small></td><td>{item.status.replaceAll("_", " ")}</td><td><button className="button button-secondary" disabled={busy} onClick={() => advanceRequisition(item.id, item.status)}>{item.status === "DRAFT" ? "Solicitar" : item.status === "REQUESTED" ? "Enviar para aprovação" : "Aprovar para cotação"}</button></td></tr>)}
            {workspace.needs.every((item) => item.status !== "IDENTIFIED") && requisitionsToAdvance.length === 0 && <tr><td colSpan={4} className="operations-empty">Nenhum item aguardando ação neste estágio.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
