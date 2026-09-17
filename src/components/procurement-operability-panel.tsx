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
import styles from "./procurement-professional.module.css";

type FormKey = "need" | "requisition" | "quotation" | "proposal" | "decision" | null;
type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const STATUS: Record<string, string> = {
  IDENTIFIED: "Identificada",
  VALIDATED: "Validada",
  DRAFT: "Rascunho",
  REQUESTED: "Solicitada",
  IN_APPROVAL: "Em aprovação",
  APPROVED_FOR_QUOTATION: "Aprovada para cotação",
  IN_QUOTATION: "Em cotação",
  OPEN: "Aberta",
  UNDER_ANALYSIS: "Em análise",
  DECIDED: "Decidida",
};

export function ProcurementOperabilityPanel({ workspace, operability }: { workspace: ProcurementWorkspaceView; operability: ProcurementOperabilityMetadata }) {
  const router = useRouter();
  const [form, setForm] = useState<FormKey>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selectedNeedIds, setSelectedNeedIds] = useState<string[]>([]);
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);
  const [proposalQuotationId, setProposalQuotationId] = useState("");
  const [decisionQuotationId, setDecisionQuotationId] = useState("");

  const identifiedNeeds = useMemo(() => workspace.needs.filter((item) => item.status === "IDENTIFIED"), [workspace.needs]);
  const validatedNeeds = useMemo(() => workspace.needs.filter((item) => item.status === "VALIDATED"), [workspace.needs]);
  const requisitionsForQuotation = useMemo(() => workspace.requisitions.filter((item) => ["APPROVED_FOR_QUOTATION", "IN_QUOTATION"].includes(item.status)), [workspace.requisitions]);
  const requisitionsToAdvance = useMemo(() => workspace.requisitions.filter((item) => ["DRAFT", "REQUESTED", "IN_APPROVAL"].includes(item.status)), [workspace.requisitions]);
  const openQuotations = useMemo(() => operability.quotations.filter((item) => item.status === "OPEN"), [operability.quotations]);
  const proposalQuotation = useMemo(() => openQuotations.find((item) => item.id === proposalQuotationId) ?? null, [openQuotations, proposalQuotationId]);
  const decisionQuotation = useMemo(() => workspace.quotations.find((item) => item.id === decisionQuotationId) ?? null, [workspace.quotations, decisionQuotationId]);
  const decidableQuotations = useMemo(() => workspace.quotations.filter((item) => ["OPEN", "UNDER_ANALYSIS"].includes(item.status) && item.proposals.some((proposal) => proposal.status === "SUBMITTED")), [workspace.quotations]);
  const activeSuppliers = useMemo(() => workspace.suppliers.filter((item) => item.status === "ACTIVE"), [workspace.suppliers]);

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
    if (selectedNeedIds.length === 0) return setFeedback("Selecione ao menos uma necessidade validada.");
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
    if (selectedSupplierIds.length === 0) return setFeedback("Selecione ao menos um fornecedor ativo.");
    const deadline = String(data.get("responseDeadline") || "");
    const ok = await run(() => createQuotationProcessAction({
      requisitionId: String(data.get("requisitionId")),
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
    if (!quotation) return setFeedback("Selecione uma cotação aberta.");
    const supplierId = String(data.get("supplierId"));
    if (!supplierId) return setFeedback("Selecione o fornecedor da proposta.");
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
    if (!quotationProcessId || !selectedProposalId) return setFeedback("Selecione a cotação e a proposta vencedora.");
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
    await run(() => transitionPurchaseRequisitionAction(id, next as "REQUESTED" | "IN_APPROVAL" | "APPROVED_FOR_QUOTATION"), `Requisição atualizada para ${STATUS[next]?.toLowerCase() ?? next.toLowerCase()}.`);
  }

  const toggleNeed = (id: string) => setSelectedNeedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleSupplier = (id: string) => setSelectedSupplierIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div>
          <span className={styles.kicker}>Compras e suprimentos</span>
          <h2 className={styles.title}>Necessidades, requisições e cotações</h2>
          <p className={styles.description}>Estruture a demanda, formalize a requisição, compare fornecedores e registre a decisão de compra antes de gerar o compromisso contratual.</p>
        </div>
        <div className={styles.actions}>
          <button className="button button-secondary" onClick={() => setForm(form === "need" ? null : "need")}><FilePlus2 size={15} /> Necessidade</button>
          <button className="button button-secondary" onClick={() => setForm(form === "requisition" ? null : "requisition")}><Workflow size={15} /> Requisição</button>
          <button className="button button-secondary" onClick={() => setForm(form === "quotation" ? null : "quotation")}><ShoppingCart size={15} /> Cotação</button>
          <button className="button button-secondary" onClick={() => setForm(form === "proposal" ? null : "proposal")}><ReceiptText size={15} /> Proposta</button>
          <button className="button button-primary" onClick={() => setForm(form === "decision" ? null : "decision")}><Gavel size={15} /> Decisão</button>
        </div>
      </div>

      <div className={styles.flowBar} aria-label="Fluxo de compras">
        {['Necessidade', 'Requisição', 'Cotação', 'Propostas', 'Decisão', 'Contratação'].map((step) => <span className={styles.flowStep} key={step}>{step}</span>)}
      </div>

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Necessidades a validar</span><span className={styles.summaryValue}>{identifiedNeeds.length}</span></div>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Requisições em fluxo</span><span className={styles.summaryValue}>{requisitionsToAdvance.length}</span></div>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Cotações abertas</span><span className={styles.summaryValue}>{openQuotations.length}</span></div>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Fornecedores ativos</span><span className={styles.summaryValue}>{activeSuppliers.length}</span></div>
      </div>

      {feedback && <div className={styles.info} role="status"><CheckCircle2 size={18} /><div><strong>Suprimentos</strong><p>{feedback}</p></div></div>}

      {form === "need" && (
        <form action={submitNeed} className={styles.formCard}>
          <h3 className={styles.formTitle}>Nova necessidade de compra</h3>
          <div className={styles.grid3}>
            <div className={styles.field}><label>Código</label><input name="code" placeholder="NEC-0001" required /></div>
            <div className={styles.field}><label>Descrição</label><input name="description" placeholder="Item ou serviço necessário" required /></div>
            <div className={styles.field}><label>Prioridade</label><select name="priority" defaultValue="NORMAL"><option value="LOW">Baixa</option><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></div>
          </div>
          <div className={styles.field}><label>Especificação técnica</label><textarea name="specification" placeholder="Descreva requisitos técnicos, padrão, referência e restrições." required /></div>
          <div className={styles.grid4}>
            <div className={styles.field}><label>Quantidade</label><input name="quantity" type="number" min="0.0001" step="0.0001" required /></div>
            <div className={styles.field}><label>Unidade</label><input name="unit" placeholder="un, m², kg..." required /></div>
            <div className={styles.field}><label>Necessário em</label><input name="requiredAt" type="date" required /></div>
            <div className={styles.field}><label>Lead time / folga</label><div className={styles.grid2}><input name="expectedLeadDays" type="number" min="0" defaultValue="30" title="Lead time em dias" /><input name="bufferDays" type="number" min="0" defaultValue="7" title="Folga em dias" /></div></div>
          </div>
          <div className={styles.formActions}><button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button><button className="button button-primary" disabled={busy} type="submit">Registrar necessidade</button></div>
        </form>
      )}

      {form === "requisition" && (
        <form action={submitRequisition} className={styles.formCard}>
          <h3 className={styles.formTitle}>Nova requisição de compra</h3>
          <div className={styles.grid2}><div className={styles.field}><label>Número</label><input name="number" placeholder="RC-0001" required /></div><div className={styles.field}><label>Título</label><input name="title" placeholder="Objeto da requisição" required /></div></div>
          <div className={styles.field}><label>Justificativa</label><textarea name="justification" placeholder="Motivo da compra e contexto operacional." /></div>
          <div className={styles.field}><label>Necessidades validadas</label><div>{validatedNeeds.map((item) => <label key={item.id} className={styles.helper}><input type="checkbox" checked={selectedNeedIds.includes(item.id)} onChange={() => toggleNeed(item.id)} /> {item.code} · {item.description} · {item.quantity} {item.unit}</label>)}{validatedNeeds.length === 0 && <span className={styles.helper}>Nenhuma necessidade validada disponível.</span>}</div></div>
          <div className={styles.formActions}><button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button><button className="button button-primary" disabled={busy || validatedNeeds.length === 0} type="submit">Criar requisição</button></div>
        </form>
      )}

      {form === "quotation" && (
        <form action={submitQuotation} className={styles.formCard}>
          <h3 className={styles.formTitle}>Nova cotação</h3>
          <div className={styles.field}><label>Requisição aprovada</label><select name="requisitionId" required defaultValue=""><option value="" disabled>Selecione a requisição</option>{requisitionsForQuotation.map((item) => <option value={item.id} key={item.id}>{item.number} · {item.title}</option>)}</select></div>
          <div className={styles.grid2}><div className={styles.field}><label>Número</label><input name="number" placeholder="COT-0001" required /></div><div className={styles.field}><label>Título</label><input name="title" placeholder="Objeto da cotação" required /></div></div>
          <div className={styles.field}><label>Escopo</label><textarea name="scope" placeholder="Escopo comum que será enviado aos fornecedores." required /></div>
          <div className={styles.grid3}><div className={styles.field}><label>Local de entrega</label><input name="deliveryLocation" /></div><div className={styles.field}><label>Condição/prazo de entrega</label><input name="deliveryTerm" /></div><div className={styles.field}><label>Prazo para resposta</label><input name="responseDeadline" type="date" /></div></div>
          <div className={styles.field}><label>Fornecedores convidados</label><div>{activeSuppliers.map((item) => <label key={item.id} className={styles.helper}><input type="checkbox" checked={selectedSupplierIds.includes(item.id)} onChange={() => toggleSupplier(item.id)} /> {item.name}{item.taxId ? ` · ${item.taxId}` : ""}</label>)}{activeSuppliers.length === 0 && <span className={styles.helper}>Nenhum fornecedor ativo disponível.</span>}</div></div>
          <div className={styles.formActions}><button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button><button className="button button-primary" disabled={busy || requisitionsForQuotation.length === 0} type="submit">Abrir cotação</button></div>
        </form>
      )}

      {form === "proposal" && (
        <form action={submitProposal} className={styles.formCard}>
          <h3 className={styles.formTitle}>Registrar proposta de fornecedor</h3>
          <div className={styles.field}><label>Cotação aberta</label><select name="quotationProcessId" required value={proposalQuotationId} onChange={(event) => setProposalQuotationId(event.target.value)}><option value="">Selecione a cotação</option>{openQuotations.map((item) => <option key={item.id} value={item.id}>{item.number} · {item.title}</option>)}</select></div>
          {proposalQuotation ? <>
            <div className={styles.field}><label>Fornecedor</label><select name="supplierId" required defaultValue=""><option value="" disabled>Selecione o fornecedor convidado</option>{proposalQuotation.invitedSuppliers.map((item) => <option key={item.supplierId} value={item.supplierId}>{item.supplierName}</option>)}</select></div>
            <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Item</th><th>Qtd.</th><th>Unidade</th><th>Preço unitário</th></tr></thead><tbody>{proposalQuotation.requisitionItems.map((item) => <tr key={item.id}><td>{item.description}</td><td>{item.quantity}</td><td>{item.unit}</td><td><input name={`price_${item.id}`} type="number" step="0.01" min="0" required /></td></tr>)}</tbody></table></div>
            <div className={styles.grid3}><div className={styles.field}><label>Impostos</label><input name="taxAmount" type="number" step="0.01" min="0" defaultValue="0" /></div><div className={styles.field}><label>Frete</label><input name="freightAmount" type="number" step="0.01" min="0" defaultValue="0" /></div><div className={styles.field}><label>Desconto</label><input name="discountAmount" type="number" step="0.01" min="0" defaultValue="0" /></div></div>
            <div className={styles.grid2}><div className={styles.field}><label>Validade</label><input name="validityUntil" type="date" /></div><div className={styles.field}><label>Prazo de entrega (dias)</label><input name="deliveryTermDays" type="number" min="0" /></div></div>
            <div className={styles.grid2}><div className={styles.field}><label>Condições de pagamento</label><input name="paymentTerms" /></div><div className={styles.field}><label>Garantias</label><input name="warrantyTerms" /></div></div>
            <div className={styles.field}><label>Observações</label><textarea name="notes" /></div>
            <div className={styles.formActions}><button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button><button className="button button-primary" disabled={busy} type="submit">Registrar proposta</button></div>
          </> : <span className={styles.helper}>Selecione uma cotação para carregar itens e fornecedores.</span>}
        </form>
      )}

      {form === "decision" && (
        <form action={submitDecision} className={styles.formCard}>
          <h3 className={styles.formTitle}>Decisão da cotação</h3>
          <div className={styles.field}><label>Cotação</label><select name="quotationProcessId" required value={decisionQuotationId} onChange={(event) => setDecisionQuotationId(event.target.value)}><option value="">Selecione a cotação</option>{decidableQuotations.map((item) => <option key={item.id} value={item.id}>{item.number} · {item.title}</option>)}</select></div>
          {decisionQuotation ? <>
            <div className={styles.field}><label>Proposta selecionada</label><select name="selectedProposalId" required defaultValue=""><option value="" disabled>Selecione a proposta</option>{decisionQuotation.proposals.filter((proposal) => proposal.status === "SUBMITTED").map((proposal) => <option key={proposal.id} value={proposal.id}>{proposal.supplier} · {proposal.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</option>)}</select></div>
            <div className={styles.field}><label>Valor de referência / orçamento</label><input name="referenceAmount" type="number" step="0.01" min="0" required /></div>
            <div className={styles.grid2}><div className={styles.field}><label>Parecer técnico</label><textarea name="technicalOpinion" required /></div><div className={styles.field}><label>Justificativa comercial</label><textarea name="commercialRationale" required /></div></div>
            <label className={styles.helper}><input name="scopeComparable" type="checkbox" /> Escopo tecnicamente comparável para cálculo de economia validada.</label>
            <div className={styles.formActions}><button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button><button className="button button-primary" disabled={busy} type="submit">Registrar decisão</button></div>
          </> : <span className={styles.helper}>Selecione uma cotação com proposta submetida.</span>}
        </form>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Fluxo</th><th>Registro</th><th>Situação</th><th>Próxima ação</th></tr></thead>
          <tbody>
            {identifiedNeeds.slice(0, 8).map((item) => <tr key={`need-${item.id}`}><td>Necessidade</td><td><span className={styles.recordTitle}>{item.code}</span><span className={styles.recordMeta}>{item.description}</span></td><td><span className={styles.status}>{STATUS[item.status] ?? item.status}</span></td><td><button className="button button-secondary" disabled={busy} onClick={() => validateNeed(item.id)}>Validar</button></td></tr>)}
            {requisitionsToAdvance.slice(0, 8).map((item) => <tr key={`req-${item.id}`}><td>Requisição</td><td><span className={styles.recordTitle}>{item.number}</span><span className={styles.recordMeta}>{item.title}</span></td><td><span className={styles.status}>{STATUS[item.status] ?? item.status}</span></td><td><button className="button button-secondary" disabled={busy} onClick={() => advanceRequisition(item.id, item.status)}>{item.status === "DRAFT" ? "Solicitar" : item.status === "REQUESTED" ? "Enviar para aprovação" : "Aprovar para cotação"}</button></td></tr>)}
            {identifiedNeeds.length === 0 && requisitionsToAdvance.length === 0 && <tr><td colSpan={4} className={styles.empty}>Nenhuma necessidade ou requisição aguardando ação.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
