"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FilePlus2, Gavel, ReceiptText, ShoppingCart, Workflow } from "lucide-react";
import type { ProcurementOperabilityMetadata } from "@/application/procurement/procurement-operability-service";
import type { ProcurementWorkspaceView } from "@/application/procurement/procurement-service";
import {
  approveMeasurementAction,
  approvePurchaseOrderAction,
  approveContractAmendmentAction,
  createContractAmendmentAction,
  createMeasurementAction,
  createOperationalContractAction,
  createProcurementNeedAction,
  createPurchaseOrderAction,
  createPurchaseRequisitionAction,
  reverseMeasurementAction,
  createQuotationProcessAction,
  decideQuotationAction,
  submitSupplierProposalAction,
  transitionMeasurementAction,
  transitionOperationalContractAction,
  transitionPurchaseRequisitionAction,
  validateProcurementNeedAction,
} from "@/app/actions/procurement";
import styles from "./procurement-professional.module.css";

type FormKey = "need" | "requisition" | "quotation" | "proposal" | "decision" | "order" | "contract" | "amendment" | "measurement" | null;
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

export function ProcurementOperabilityPanel({ workspace, operability, canWrite, canApprove }: { workspace: ProcurementWorkspaceView; operability: ProcurementOperabilityMetadata; canWrite: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<FormKey>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selectedNeedIds, setSelectedNeedIds] = useState<string[]>([]);
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);
  const [proposalQuotationId, setProposalQuotationId] = useState("");
  const [decisionQuotationId, setDecisionQuotationId] = useState("");
  const [instrumentQuotationId, setInstrumentQuotationId] = useState("");
  const [measurementContractId, setMeasurementContractId] = useState("");
  const [amendmentContractId, setAmendmentContractId] = useState("");
  const [reversingMeasurementId, setReversingMeasurementId] = useState<string | null>(null);

  const identifiedNeeds = useMemo(() => workspace.needs.filter((item) => item.status === "IDENTIFIED"), [workspace.needs]);
  const validatedNeeds = useMemo(() => workspace.needs.filter((item) => item.status === "VALIDATED"), [workspace.needs]);
  const requisitionsForQuotation = useMemo(() => workspace.requisitions.filter((item) => ["APPROVED_FOR_QUOTATION", "IN_QUOTATION"].includes(item.status)), [workspace.requisitions]);
  const requisitionsToAdvance = useMemo(() => workspace.requisitions.filter((item) => ["DRAFT", "REQUESTED", "IN_APPROVAL"].includes(item.status)), [workspace.requisitions]);
  const openQuotations = useMemo(() => operability.quotations.filter((item) => item.status === "OPEN"), [operability.quotations]);
  const proposalQuotation = useMemo(() => openQuotations.find((item) => item.id === proposalQuotationId) ?? null, [openQuotations, proposalQuotationId]);
  const decisionQuotation = useMemo(() => workspace.quotations.find((item) => item.id === decisionQuotationId) ?? null, [workspace.quotations, decisionQuotationId]);
  const decidableQuotations = useMemo(() => workspace.quotations.filter((item) => ["OPEN", "UNDER_ANALYSIS"].includes(item.status) && item.proposals.some((proposal) => proposal.status === "SUBMITTED")), [workspace.quotations]);
  const activeSuppliers = useMemo(() => workspace.suppliers.filter((item) => item.status === "ACTIVE"), [workspace.suppliers]);
  const decidedQuotations = useMemo(() => operability.quotations.filter((item) => item.status === "DECIDED" && item.selectedProposal), [operability.quotations]);
  const instrumentQuotation = useMemo(() => decidedQuotations.find((item) => item.id === instrumentQuotationId) ?? null, [decidedQuotations, instrumentQuotationId]);
  const measurableContracts = useMemo(() => operability.contracts.filter((item) => ["APPROVED", "ACTIVE"].includes(item.status)), [operability.contracts]);
  const measurementContract = useMemo(() => measurableContracts.find((item) => item.id === measurementContractId) ?? null, [measurableContracts, measurementContractId]);


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

  async function submitOrder(data: FormData) {
    if (!operability.companyId) return setFeedback("O empreendimento precisa estar vinculado a uma empresa/SPE.");
    const quotation = operability.quotations.find((item) => item.id === String(data.get("quotationProcessId")));
    const proposal = quotation?.selectedProposal;
    if (!quotation || !proposal) return setFeedback("Selecione uma cotação decidida com proposta vencedora.");
    await run(() => createPurchaseOrderAction({
      projectId: workspace.projectId, companyId: operability.companyId!, supplierId: proposal.supplierId, quotationProcessId: quotation.id, selectedProposalId: proposal.id,
      number: String(data.get("number")), title: String(data.get("title")), scope: String(data.get("scope")),
      deliveryAt: data.get("deliveryAt") ? new Date(String(data.get("deliveryAt")) + "T00:00:00Z") : null,
      paymentTerms: String(data.get("paymentTerms") || "") || null,
      items: proposal.items.map((item) => ({ description: item.description, quantity: String(item.quantity), unit: item.unit, unitPrice: String(item.unitPrice) })),
    }), "Pedido de compra criado.");
  }

  async function submitContract(data: FormData) {
    if (!operability.companyId) return setFeedback("O empreendimento precisa estar vinculado a uma empresa/SPE.");
    const quotation = operability.quotations.find((item) => item.id === String(data.get("quotationProcessId")));
    const proposal = quotation?.selectedProposal;
    if (!quotation || !proposal) return setFeedback("Selecione uma cotação decidida com proposta vencedora.");
    await run(() => createOperationalContractAction({
      projectId: workspace.projectId, companyId: operability.companyId!, supplierId: proposal.supplierId, quotationProcessId: quotation.id, selectedProposalId: proposal.id,
      number: String(data.get("number")), title: String(data.get("title")), type: String(data.get("type")) as "SUPPLY" | "SERVICE" | "CONSTRUCTION" | "DESIGN" | "CONSULTING" | "LEASE" | "ACQUISITION" | "OTHER",
      billingModel: String(data.get("billingModel")) as "MEASUREMENT" | "FIXED_INSTALLMENT" | "MONTHLY" | "MILESTONE" | "DELIVERY" | "ADVANCE" | "CUSTOM",
      scope: String(data.get("scope")), startsAt: new Date(String(data.get("startsAt")) + "T00:00:00Z"), endsAt: new Date(String(data.get("endsAt")) + "T00:00:00Z"),
      responsibleId: operability.currentUserId, paymentTerms: String(data.get("paymentTerms") || "") || null, retentionRate: String(data.get("retentionRate") || "0"), warrantyTerms: String(data.get("warrantyTerms") || "") || null,
      items: proposal.items.map((item, index) => ({ code: "ITEM-" + (index + 1), description: item.description, quantity: String(item.quantity), unit: item.unit, unitPrice: String(item.unitPrice) })),
    }), "Contrato operacional criado.");
  }

  async function submitAmendment(data: FormData) {
    const contractId = String(data.get("contractId"));
    if (!contractId) return setFeedback("Selecione um contrato.");
    await run(() => createContractAmendmentAction({
      contractId,
      number: Number(data.get("number")),
      type: String(data.get("type")) as "INCREASE" | "SUPPRESSION" | "TERM" | "SCOPE" | "READJUSTMENT" | "OTHER",
      reason: String(data.get("reason")),
      deviationCause: String(data.get("deviationCause")) as "PRICE" | "QUANTITY" | "SCOPE" | "TERM" | "DESIGN" | "BUDGET_ERROR" | "MARKET" | "SUPPLIER" | "REWORK" | "PRODUCTIVITY" | "UNFORESEEN_CONDITION" | "LEGAL_CHANGE" | "OTHER",
      scopeDescription: String(data.get("scopeDescription") || "") || null,
      value: String(data.get("value") || "0"),
      termDays: Number(data.get("termDays") || 0),
      effectiveAt: data.get("effectiveAt") ? new Date(String(data.get("effectiveAt")) + "T00:00:00Z") : null,
    }), "Aditivo contratual criado.");
  }
  async function submitMeasurement(data: FormData) {
    const contract = operability.contracts.find((item) => item.id === String(data.get("contractId")));
    if (!contract) return setFeedback("Selecione um contrato aprovado ou ativo.");
    await run(() => createMeasurementAction({
      contractId: contract.id, number: Number(data.get("number")), version: 1, competenceDate: new Date(String(data.get("competenceDate")) + "T00:00:00Z"),
      periodStart: new Date(String(data.get("periodStart")) + "T00:00:00Z"), periodEnd: new Date(String(data.get("periodEnd")) + "T00:00:00Z"),
      issuedAt: new Date(String(data.get("issuedAt")) + "T00:00:00Z"), dueDate: new Date(String(data.get("dueDate")) + "T00:00:00Z"),
      physicalProgress: String(data.get("physicalProgress") || "0"), retentionAmount: String(data.get("retentionAmount") || "0"), discountAmount: String(data.get("discountAmount") || "0"), advanceAmortizationAmount: "0",
      lines: contract.items.map((item) => ({ contractItemId: item.id, periodQuantity: String(data.get("qty_" + item.id) || "0") })).filter((item) => Number(item.periodQuantity) > 0),
    }), "Medição criada em rascunho.");
  }

  async function advanceContract(id: string, status: string) {
    const next = status === "DRAFT" ? "UNDER_REVIEW" : status === "UNDER_REVIEW" ? "IN_APPROVAL" : status === "IN_APPROVAL" ? "APPROVED" : status === "APPROVED" ? "ACTIVE" : null;
    if (!next) return;
    await run(() => transitionOperationalContractAction(id, next as "UNDER_REVIEW" | "IN_APPROVAL" | "APPROVED" | "ACTIVE"), "Contrato atualizado.");
  }

  async function reverseMeasurement(id: string, form: FormData) {
    const reason = String(form.get("reason") ?? "").trim();
    if (!reason) return setFeedback("Informe o motivo da reversão.");
    await run(() => reverseMeasurementAction(id, reason), "Medição revertida e obrigação financeira estornada.");
    setReversingMeasurementId(null);
  }

  async function advanceMeasurement(id: string, status: string) {
    const next = status === "DRAFT" ? "SUBMITTED" : status === "SUBMITTED" ? "IN_TECHNICAL_REVIEW" : status === "IN_TECHNICAL_REVIEW" ? "TECHNICALLY_APPROVED" : status === "TECHNICALLY_APPROVED" ? "IN_APPROVAL" : null;
    if (next) await run(() => transitionMeasurementAction(id, next as "SUBMITTED" | "IN_TECHNICAL_REVIEW" | "TECHNICALLY_APPROVED" | "IN_APPROVAL"), "Medição atualizada.");
    else if (status === "IN_APPROVAL") await run(() => approveMeasurementAction(id), "Medição aprovada e enviada ao Financeiro.");
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
      {!canWrite && !canApprove && <div className={styles.info}><div><strong>Modo de leitura</strong><p>Seu perfil pode consultar Suprimentos, mas não alterar nem aprovar registros.</p></div></div>}
      <div className={styles.header}>
        <div>
          <span className={styles.kicker}>Compras e suprimentos</span>
          <h2 className={styles.title}>Necessidades, requisições e cotações</h2>
          <p className={styles.description}>Estruture a demanda, formalize a requisição, compare fornecedores e registre a decisão de compra antes de gerar o compromisso contratual.</p>
        </div>
        <div className={styles.actions}>
          <button className="button button-secondary" disabled={!canWrite} onClick={() => setForm(form === "need" ? null : "need")}><FilePlus2 size={15} /> Necessidade</button>
          <button className="button button-secondary" disabled={!canWrite} onClick={() => setForm(form === "requisition" ? null : "requisition")}><Workflow size={15} /> Requisição</button>
          <button className="button button-secondary" disabled={!canWrite} onClick={() => setForm(form === "quotation" ? null : "quotation")}><ShoppingCart size={15} /> Cotação</button>
          <button className="button button-secondary" disabled={!canWrite} onClick={() => setForm(form === "proposal" ? null : "proposal")}><ReceiptText size={15} /> Proposta</button>
          <button className="button button-primary" disabled={!canApprove} onClick={() => setForm(form === "decision" ? null : "decision")}><Gavel size={15} /> Decisão</button>
          <button className="button button-secondary" disabled={!canWrite} onClick={() => setForm(form === "order" ? null : "order")}>Pedido</button>
          <button className="button button-secondary" disabled={!canWrite} onClick={() => setForm(form === "contract" ? null : "contract")}>Contrato</button><button className="button button-secondary" disabled={!canWrite} onClick={() => setForm(form === "amendment" ? null : "amendment")}>Aditivo</button>
          <button className="button button-secondary" disabled={!canWrite} onClick={() => setForm(form === "measurement" ? null : "measurement")}>Medição</button>
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

      {form === "order" && (
        <form action={submitOrder} className={styles.formCard}>
          <h3 className={styles.formTitle}>Novo pedido de compra</h3>
          <div className={styles.field}><label>Cotação decidida</label><select name="quotationProcessId" value={instrumentQuotationId} onChange={(event) => setInstrumentQuotationId(event.target.value)} required><option value="">Selecione</option>{decidedQuotations.map((item) => <option key={item.id} value={item.id}>{item.number} · {item.title} · {item.selectedProposal?.supplierName}</option>)}</select></div>
          {instrumentQuotation && <><div className={styles.grid2}><div className={styles.field}><label>Número</label><input name="number" required placeholder="PC-0001" /></div><div className={styles.field}><label>Título</label><input name="title" required defaultValue={instrumentQuotation.title} /></div></div><div className={styles.field}><label>Escopo</label><textarea name="scope" required defaultValue={instrumentQuotation.title} /></div><div className={styles.grid2}><div className={styles.field}><label>Entrega prevista</label><input name="deliveryAt" type="date" /></div><div className={styles.field}><label>Pagamento</label><input name="paymentTerms" /></div></div><div className={styles.formActions}><button className="button button-primary" disabled={busy} type="submit">Criar pedido</button></div></>}
        </form>
      )}

      {form === "contract" && (
        <form action={submitContract} className={styles.formCard}>
          <h3 className={styles.formTitle}>Novo contrato operacional</h3>
          <div className={styles.field}><label>Cotação decidida</label><select name="quotationProcessId" value={instrumentQuotationId} onChange={(event) => setInstrumentQuotationId(event.target.value)} required><option value="">Selecione</option>{decidedQuotations.map((item) => <option key={item.id} value={item.id}>{item.number} · {item.title} · {item.selectedProposal?.supplierName}</option>)}</select></div>
          {instrumentQuotation && <><div className={styles.grid2}><div className={styles.field}><label>Número</label><input name="number" required placeholder="CT-0001" /></div><div className={styles.field}><label>Título</label><input name="title" required defaultValue={instrumentQuotation.title} /></div></div><div className={styles.grid3}><div className={styles.field}><label>Tipo</label><select name="type" defaultValue="CONSTRUCTION"><option value="SUPPLY">Fornecimento</option><option value="SERVICE">Serviço</option><option value="CONSTRUCTION">Construção</option><option value="DESIGN">Projeto</option><option value="CONSULTING">Consultoria</option><option value="OTHER">Outro</option></select></div><div className={styles.field}><label>Faturamento</label><select name="billingModel" defaultValue="MEASUREMENT"><option value="MEASUREMENT">Medição</option><option value="FIXED_INSTALLMENT">Parcela fixa</option><option value="MONTHLY">Mensal</option><option value="MILESTONE">Marco</option><option value="DELIVERY">Entrega</option></select></div><div className={styles.field}><label>Retenção (%)</label><input name="retentionRate" type="number" step="0.01" defaultValue="0" /></div></div><div className={styles.grid2}><div className={styles.field}><label>Início</label><input name="startsAt" type="date" required /></div><div className={styles.field}><label>Fim</label><input name="endsAt" type="date" required /></div></div><div className={styles.field}><label>Escopo</label><textarea name="scope" required defaultValue={instrumentQuotation.title} /></div><div className={styles.grid2}><div className={styles.field}><label>Pagamento</label><input name="paymentTerms" /></div><div className={styles.field}><label>Garantia</label><input name="warrantyTerms" /></div></div><div className={styles.formActions}><button className="button button-primary" disabled={busy} type="submit">Criar contrato</button></div></>}
        </form>
      )}

      {form === "amendment" && (
        <form action={submitAmendment} className={styles.formCard}>
          <h3 className={styles.formTitle}>Novo aditivo contratual</h3>
          <div className={styles.field}><label>Contrato</label><select name="contractId" value={amendmentContractId} onChange={(event) => setAmendmentContractId(event.target.value)} required><option value="">Selecione</option>{operability.contracts.filter((item) => ["APPROVED", "ACTIVE", "SUSPENDED"].includes(item.status)).map((item) => <option key={item.id} value={item.id}>{item.number} · {item.title}</option>)}</select></div>
          <div className={styles.grid3}><div className={styles.field}><label>Número do aditivo</label><input name="number" type="number" min="1" required /></div><div className={styles.field}><label>Tipo</label><select name="type" defaultValue="INCREASE"><option value="INCREASE">Acréscimo</option><option value="SUPPRESSION">Supressão</option><option value="TERM">Prazo</option><option value="SCOPE">Escopo</option><option value="READJUSTMENT">Reajuste</option><option value="OTHER">Outro</option></select></div><div className={styles.field}><label>Causa do desvio</label><select name="deviationCause" defaultValue="SCOPE"><option value="PRICE">Preço</option><option value="QUANTITY">Quantidade</option><option value="SCOPE">Escopo</option><option value="TERM">Prazo</option><option value="DESIGN">Projeto</option><option value="BUDGET_ERROR">Erro de orçamento</option><option value="MARKET">Mercado</option><option value="SUPPLIER">Fornecedor</option><option value="REWORK">Retrabalho</option><option value="PRODUCTIVITY">Produtividade</option><option value="UNFORESEEN_CONDITION">Condição imprevista</option><option value="LEGAL_CHANGE">Alteração legal</option><option value="OTHER">Outro</option></select></div></div>
          <div className={styles.grid3}><div className={styles.field}><label>Valor</label><input name="value" type="number" step="0.01" min="0" defaultValue="0" /></div><div className={styles.field}><label>Dias de prazo</label><input name="termDays" type="number" defaultValue="0" /></div><div className={styles.field}><label>Vigência</label><input name="effectiveAt" type="date" /></div></div>
          <div className={styles.field}><label>Motivo</label><textarea name="reason" required /></div><div className={styles.field}><label>Descrição do escopo</label><textarea name="scopeDescription" /></div>
          <div className={styles.formActions}><button className="button button-primary" disabled={busy} type="submit">Criar aditivo</button></div>
        </form>
      )}
      {form === "measurement" && (
        <form action={submitMeasurement} className={styles.formCard}>
          <h3 className={styles.formTitle}>Nova medição</h3>
          <div className={styles.field}><label>Contrato</label><select name="contractId" value={measurementContractId} onChange={(event) => setMeasurementContractId(event.target.value)} required><option value="">Selecione</option>{measurableContracts.map((item) => <option key={item.id} value={item.id}>{item.number} · {item.title}</option>)}</select></div>
          {measurementContract && <><div className={styles.grid4}><div className={styles.field}><label>Número</label><input name="number" type="number" min="1" required /></div><div className={styles.field}><label>Competência</label><input name="competenceDate" type="date" required /></div><div className={styles.field}><label>Início período</label><input name="periodStart" type="date" required /></div><div className={styles.field}><label>Fim período</label><input name="periodEnd" type="date" required /></div></div><div className={styles.grid4}><div className={styles.field}><label>Emissão</label><input name="issuedAt" type="date" required /></div><div className={styles.field}><label>Vencimento</label><input name="dueDate" type="date" required /></div><div className={styles.field}><label>Avanço físico (%)</label><input name="physicalProgress" type="number" step="0.01" defaultValue="0" /></div><div className={styles.field}><label>Retenção</label><input name="retentionAmount" type="number" step="0.01" defaultValue="0" /></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Item</th><th>Contratado</th><th>Quantidade do período</th></tr></thead><tbody>{measurementContract.items.map((item) => <tr key={item.id}><td>{item.code} · {item.description}</td><td>{item.quantity} {item.unit}</td><td><input name={"qty_" + item.id} type="number" min="0" step="0.0001" defaultValue="0" /></td></tr>)}</tbody></table></div><div className={styles.formActions}><button className="button button-primary" disabled={busy} type="submit">Criar medição</button></div></>}
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
            {identifiedNeeds.slice(0, 8).map((item) => <tr key={`need-${item.id}`}><td>Necessidade</td><td><span className={styles.recordTitle}>{item.code}</span><span className={styles.recordMeta}>{item.description}</span></td><td><span className={styles.status}>{STATUS[item.status] ?? item.status}</span></td><td><button className="button button-secondary" disabled={busy || !canWrite} onClick={() => validateNeed(item.id)}>Validar</button></td></tr>)}
            {requisitionsToAdvance.slice(0, 8).map((item) => <tr key={`req-${item.id}`}><td>Requisição</td><td><span className={styles.recordTitle}>{item.number}</span><span className={styles.recordMeta}>{item.title}</span></td><td><span className={styles.status}>{STATUS[item.status] ?? item.status}</span></td><td><button className="button button-secondary" disabled={busy || (item.status === "IN_APPROVAL" ? !canApprove : !canWrite)} onClick={() => advanceRequisition(item.id, item.status)}>{item.status === "DRAFT" ? "Solicitar" : item.status === "REQUESTED" ? "Enviar para aprovação" : "Aprovar para cotação"}</button></td></tr>)}
            {identifiedNeeds.length === 0 && requisitionsToAdvance.length === 0 && <tr><td colSpan={4} className={styles.empty}>Nenhuma necessidade ou requisição aguardando ação.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className={styles.tableWrap} style={{ marginTop: 24 }}><table className={styles.table}><thead><tr><th>Pedido</th><th>Fornecedor</th><th>Valor</th><th>Status</th><th>Ação</th></tr></thead><tbody>{workspace.orders.map((item) => <tr key={item.id}><td>{item.number} · {item.title}</td><td>{item.supplier}</td><td>{item.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td><td>{item.status}</td><td>{["DRAFT", "IN_APPROVAL"].includes(item.status) ? <button className="text-button" disabled={busy || !canApprove} onClick={() => run(() => approvePurchaseOrderAction(item.id), "Pedido aprovado.")}>Aprovar</button> : "—"}</td></tr>)}</tbody></table></div>

      <div className={styles.tableWrap} style={{ marginTop: 18 }}><table className={styles.table}><thead><tr><th>Contrato</th><th>Fornecedor</th><th>Valor atual</th><th>Status</th><th>Ação</th></tr></thead><tbody>{workspace.contracts.map((item) => <tr key={item.id}><td>{item.number} · {item.title}</td><td>{item.supplier}</td><td>{item.currentAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td><td>{item.status}</td><td>{["DRAFT", "UNDER_REVIEW", "IN_APPROVAL", "APPROVED"].includes(item.status) ? <button className="text-button" disabled={busy || (item.status === "IN_APPROVAL" ? !canApprove : !canWrite)} onClick={() => advanceContract(item.id, item.status)}>Avançar</button> : "—"}{item.amendments.filter((amendment) => amendment.status !== "APPROVED").map((amendment) => <button key={amendment.id} className="text-button" disabled={busy || !canApprove} onClick={() => run(() => approveContractAmendmentAction(amendment.id), "Aditivo aprovado.")}>Aprovar aditivo {amendment.number}</button>)}</td></tr>)}</tbody></table></div>

      <div className={styles.tableWrap} style={{ marginTop: 18 }}><table className={styles.table}><thead><tr><th>Medição</th><th>Contrato</th><th>Fornecedor</th><th>Líquido</th><th>Status</th><th>Ação</th></tr></thead><tbody>{workspace.measurements.map((item) => <tr key={item.id}><td>BM {item.number}</td><td>{item.contract}</td><td>{item.supplier}</td><td>{item.netAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td><td>{item.status}</td><td>
        {["DRAFT", "SUBMITTED", "IN_TECHNICAL_REVIEW", "TECHNICALLY_APPROVED", "IN_APPROVAL"].includes(item.status) && <button className="text-button" disabled={busy || (item.status === "IN_APPROVAL" ? !canApprove : !canWrite)} onClick={() => advanceMeasurement(item.id, item.status)}>{item.status === "IN_APPROVAL" ? "Aprovar e enviar ao Financeiro" : "Avançar"}</button>}
        {["APPROVED", "SENT_TO_FINANCE"].includes(item.status) && reversingMeasurementId !== item.id && <button className="text-button" disabled={busy || !canApprove} onClick={() => setReversingMeasurementId(item.id)}>Reverter</button>}
        {reversingMeasurementId === item.id && <form style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }} action={(form) => reverseMeasurement(item.id, form)}><input name="reason" required placeholder="Motivo da reversão" /><button className="text-button" type="submit" disabled={busy}>Confirmar reversão</button><button className="text-button" type="button" onClick={() => setReversingMeasurementId(null)}>Cancelar</button></form>}
        {!["DRAFT", "SUBMITTED", "IN_TECHNICAL_REVIEW", "TECHNICALLY_APPROVED", "IN_APPROVAL", "APPROVED", "SENT_TO_FINANCE"].includes(item.status) && "—"}
      </td></tr>)}</tbody></table></div>
    </section>
  );
}
