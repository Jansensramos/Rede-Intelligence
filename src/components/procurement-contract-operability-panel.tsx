"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileSignature, ShoppingBag, SquarePen } from "lucide-react";
import type { ProcurementOperabilityMetadata } from "@/application/procurement/procurement-operability-service";
import type { ProcurementWorkspaceView } from "@/application/procurement/procurement-service";
import {
  approveContractAmendmentAction,
  approvePurchaseOrderAction,
  createContractAmendmentAction,
  createOperationalContractAction,
  createPurchaseOrderAction,
  transitionOperationalContractAction,
} from "@/app/actions/procurement";
import { BusinessDocumentPrintButton } from "./business-document-print-button";
import styles from "./procurement-professional.module.css";

type FormKey = "order" | "contract" | "amendment" | null;
type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const CONTRACT_STATUS: Record<string, string> = {
  DRAFT: "Rascunho", UNDER_REVIEW: "Em revisão", IN_APPROVAL: "Em aprovação", APPROVED: "Aprovado", ACTIVE: "Ativo", SUSPENDED: "Suspenso", CLOSED: "Encerrado", CANCELLED: "Cancelado", TERMINATED: "Rescindido",
};
const ORDER_STATUS: Record<string, string> = {
  DRAFT: "Rascunho", IN_APPROVAL: "Em aprovação", APPROVED: "Aprovado", ISSUED: "Emitido", PARTIALLY_DELIVERED: "Entrega parcial", DELIVERED: "Entregue", CANCELLED: "Cancelado", SUPERSEDED: "Substituído por contrato",
};

export function ProcurementContractOperabilityPanel({ workspace, operability }: { workspace: ProcurementWorkspaceView; operability: ProcurementOperabilityMetadata }) {
  const router = useRouter();
  const [form, setForm] = useState<FormKey>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sourceQuotationId, setSourceQuotationId] = useState("");

  const decidedSources = useMemo(() => operability.quotations.filter((item) => item.status === "DECIDED" && item.selectedProposal), [operability.quotations]);
  const selectedSource = useMemo(() => decidedSources.find((item) => item.id === sourceQuotationId) ?? null, [decidedSources, sourceQuotationId]);
  const currentContracts = useMemo(() => operability.contracts.filter((item) => ["APPROVED", "ACTIVE", "SUSPENDED"].includes(item.status)), [operability.contracts]);
  const contractedValue = workspace.contracts.filter((item) => ["APPROVED", "ACTIVE", "SUSPENDED", "CLOSED"].includes(item.status)).reduce((sum, item) => sum + item.currentAmount, 0);

  async function run<T>(operation: () => Promise<ActionResult<T>>, success: string) {
    setBusy(true); setFeedback(null);
    const result = await operation();
    setBusy(false);
    if (!result.ok) { setFeedback(result.error); return false; }
    setFeedback(success); setForm(null); router.refresh(); return true;
  }

  function sourceItems() {
    if (!selectedSource?.selectedProposal) return [];
    return selectedSource.selectedProposal.items.map((item, index) => ({ code: `ITEM-${String(index + 1).padStart(3, "0")}`, description: item.description, quantity: String(item.quantity), unit: item.unit, unitPrice: String(item.unitPrice) }));
  }

  async function submitOrder(data: FormData) {
    if (!selectedSource?.selectedProposal || !operability.companyId) return setFeedback("Selecione uma cotação decidida e confirme a SPE vinculada ao empreendimento.");
    await run(() => createPurchaseOrderAction({ projectId: workspace.projectId, companyId: operability.companyId!, supplierId: selectedSource.selectedProposal!.supplierId, quotationProcessId: selectedSource.id, selectedProposalId: selectedSource.selectedProposal!.id, number: String(data.get("number")), title: String(data.get("title")), scope: String(data.get("scope")), deliveryAt: data.get("deliveryAt") ? new Date(`${data.get("deliveryAt")}T23:59:59.000Z`) : null, paymentTerms: String(data.get("paymentTerms") || "") || null, items: sourceItems().map(({ code: _code, ...item }) => item) }), "Pedido de compra criado.");
  }

  async function submitContract(data: FormData) {
    if (!selectedSource?.selectedProposal || !operability.companyId) return setFeedback("Selecione uma cotação decidida e confirme a SPE vinculada ao empreendimento.");
    await run(() => createOperationalContractAction({ projectId: workspace.projectId, companyId: operability.companyId!, supplierId: selectedSource.selectedProposal!.supplierId, quotationProcessId: selectedSource.id, selectedProposalId: selectedSource.selectedProposal!.id, number: String(data.get("number")), title: String(data.get("title")), type: String(data.get("type")) as "SUPPLY" | "SERVICE" | "CONSTRUCTION" | "DESIGN" | "CONSULTING" | "LEASE" | "ACQUISITION" | "OTHER", billingModel: String(data.get("billingModel")) as "MEASUREMENT" | "FIXED_INSTALLMENT" | "MONTHLY" | "MILESTONE" | "DELIVERY" | "ADVANCE" | "CUSTOM", scope: String(data.get("scope")), startsAt: new Date(`${data.get("startsAt")}T00:00:00.000Z`), endsAt: new Date(`${data.get("endsAt")}T23:59:59.000Z`), responsibleId: operability.currentUserId, paymentTerms: String(data.get("paymentTerms") || "") || null, retentionRate: String(data.get("retentionRate") || "0"), warrantyTerms: String(data.get("warrantyTerms") || "") || null, items: sourceItems() }), "Contrato criado em rascunho.");
  }

  async function submitAmendment(data: FormData) {
    await run(() => createContractAmendmentAction({ contractId: String(data.get("contractId")), number: Number(data.get("number")), type: String(data.get("type")) as "INCREASE" | "SUPPRESSION" | "TERM" | "SCOPE" | "READJUSTMENT" | "OTHER", reason: String(data.get("reason")), deviationCause: String(data.get("deviationCause")) as "PRICE" | "QUANTITY" | "SCOPE" | "TERM" | "DESIGN" | "BUDGET_ERROR" | "MARKET" | "SUPPLIER" | "REWORK" | "PRODUCTIVITY" | "UNFORESEEN_CONDITION" | "LEGAL_CHANGE" | "OTHER", scopeDescription: String(data.get("scopeDescription") || "") || null, value: String(data.get("value") || "0"), termDays: Number(data.get("termDays") || 0), effectiveAt: data.get("effectiveAt") ? new Date(`${data.get("effectiveAt")}T00:00:00.000Z`) : null }), "Aditivo criado.");
  }

  async function advanceContract(id: string, status: string) {
    const next = status === "DRAFT" ? "UNDER_REVIEW" : status === "UNDER_REVIEW" ? "IN_APPROVAL" : status === "IN_APPROVAL" ? "APPROVED" : "ACTIVE";
    await run(() => transitionOperationalContractAction(id, next as "UNDER_REVIEW" | "IN_APPROVAL" | "APPROVED" | "ACTIVE"), `Contrato atualizado para ${CONTRACT_STATUS[next].toLowerCase()}.`);
  }

  return <section className={styles.section}>
    <div className={styles.header}><div><span className={styles.kicker}>Formalização da compra</span><h2 className={styles.title}>Pedidos, contratos e aditivos</h2><p className={styles.description}>Transforme a decisão de compra em documentos formais, com aprovação, histórico e impressão.</p></div><div className={styles.actions}><button className="button button-secondary" onClick={() => setForm(form === "order" ? null : "order")}><ShoppingBag size={15}/> Novo pedido</button><button className="button button-secondary" onClick={() => setForm(form === "contract" ? null : "contract")}><FileSignature size={15}/> Novo contrato</button><button className="button button-primary" onClick={() => setForm(form === "amendment" ? null : "amendment")}><SquarePen size={15}/> Novo aditivo</button></div></div>

    <div className={styles.summaryGrid}><div className={styles.summaryCard}><span className={styles.summaryLabel}>Pedidos registrados</span><span className={styles.summaryValue}>{workspace.orders.length}</span></div><div className={styles.summaryCard}><span className={styles.summaryLabel}>Contratos</span><span className={styles.summaryValue}>{workspace.contracts.length}</span></div><div className={styles.summaryCard}><span className={styles.summaryLabel}>Valor contratado atualizado</span><span className={styles.summaryValue}>{money(contractedValue)}</span></div><div className={styles.summaryCard}><span className={styles.summaryLabel}>Cotações decididas disponíveis</span><span className={styles.summaryValue}>{decidedSources.length}</span></div></div>

    {feedback && <div className={styles.info}><CheckCircle2 size={18}/><div><strong>Contratação</strong><p>{feedback}</p></div></div>}

    {(form === "order" || form === "contract") && <div className={styles.formCard}><div className={styles.field}><label>Cotação decidida</label><select value={sourceQuotationId} onChange={(event) => setSourceQuotationId(event.target.value)}><option value="">Selecione a cotação</option>{decidedSources.map((item) => <option value={item.id} key={item.id}>{item.number} · {item.title} · {item.selectedProposal?.supplierName}</option>)}</select></div>{!operability.companyId && <div className={styles.warning}>O empreendimento precisa ter uma SPE/empresa vinculada antes da contratação.</div>}{selectedSource && <div className={styles.info}><FileSignature size={18}/><div><strong>{selectedSource.selectedProposal?.supplierName}</strong><p>{selectedSource.selectedProposal?.items.length} item(ns) serão importados da proposta vencedora.</p></div></div>}</div>}

    {form === "order" && selectedSource && <form action={submitOrder} className={styles.formCard}><h3 className={styles.formTitle}>Novo pedido de compra</h3><div className={styles.grid2}><div className={styles.field}><label>Número</label><input name="number" required placeholder="PC-0001"/></div><div className={styles.field}><label>Título</label><input name="title" required placeholder="Objeto do pedido"/></div></div><div className={styles.field}><label>Escopo</label><textarea name="scope" required placeholder="Escopo e condições principais do pedido"/></div><div className={styles.grid2}><div className={styles.field}><label>Entrega prevista</label><input name="deliveryAt" type="date"/></div><div className={styles.field}><label>Condições de pagamento</label><input name="paymentTerms" placeholder="Ex.: 30/60 dias"/></div></div><div className={styles.formActions}><button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button><button className="button button-primary" disabled={busy || !operability.companyId} type="submit">Criar pedido</button></div></form>}

    {form === "contract" && selectedSource && <form action={submitContract} className={styles.formCard}><h3 className={styles.formTitle}>Novo contrato</h3><div className={styles.grid2}><div className={styles.field}><label>Número</label><input name="number" required placeholder="CT-0001"/></div><div className={styles.field}><label>Título</label><input name="title" required placeholder="Objeto do contrato"/></div></div><div className={styles.grid2}><div className={styles.field}><label>Tipo</label><select name="type" defaultValue="CONSTRUCTION"><option value="SUPPLY">Fornecimento</option><option value="SERVICE">Serviço</option><option value="CONSTRUCTION">Construção</option><option value="DESIGN">Projeto</option><option value="CONSULTING">Consultoria</option><option value="LEASE">Locação</option><option value="ACQUISITION">Aquisição</option><option value="OTHER">Outro</option></select></div><div className={styles.field}><label>Forma de faturamento</label><select name="billingModel" defaultValue="MEASUREMENT"><option value="MEASUREMENT">Medição</option><option value="FIXED_INSTALLMENT">Parcela fixa</option><option value="MONTHLY">Mensal</option><option value="MILESTONE">Marco</option><option value="DELIVERY">Entrega</option><option value="ADVANCE">Adiantamento</option><option value="CUSTOM">Personalizado</option></select></div></div><div className={styles.field}><label>Escopo contratual</label><textarea name="scope" required/></div><div className={styles.grid2}><div className={styles.field}><label>Início</label><input name="startsAt" type="date" required/></div><div className={styles.field}><label>Término</label><input name="endsAt" type="date" required/></div></div><div className={styles.field}><label>Condições de pagamento</label><input name="paymentTerms"/></div><div className={styles.grid2}><div className={styles.field}><label>Retenção</label><input name="retentionRate" type="number" min="0" step="0.0001" defaultValue="0"/></div><div className={styles.field}><label>Garantia</label><input name="warrantyTerms"/></div></div><div className={styles.formActions}><button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button><button className="button button-primary" disabled={busy || !operability.companyId} type="submit">Criar contrato</button></div></form>}

    {form === "amendment" && <form action={submitAmendment} className={styles.formCard}><h3 className={styles.formTitle}>Novo aditivo contratual</h3><div className={styles.field}><label>Contrato</label><select name="contractId" required defaultValue=""><option value="" disabled>Selecione o contrato</option>{currentContracts.map((item) => <option value={item.id} key={item.id}>{item.number} · {item.title}</option>)}</select></div><div className={styles.grid3}><div className={styles.field}><label>Número</label><input name="number" type="number" min="1" required/></div><div className={styles.field}><label>Tipo</label><select name="type" defaultValue="INCREASE"><option value="INCREASE">Acréscimo</option><option value="SUPPRESSION">Supressão</option><option value="TERM">Prazo</option><option value="SCOPE">Escopo</option><option value="READJUSTMENT">Reajuste</option><option value="OTHER">Outro</option></select></div><div className={styles.field}><label>Causa</label><select name="deviationCause" defaultValue="SCOPE"><option value="PRICE">Preço</option><option value="QUANTITY">Quantidade</option><option value="SCOPE">Escopo</option><option value="TERM">Prazo</option><option value="DESIGN">Projeto</option><option value="BUDGET_ERROR">Erro de orçamento</option><option value="MARKET">Mercado</option><option value="SUPPLIER">Fornecedor</option><option value="REWORK">Retrabalho</option><option value="PRODUCTIVITY">Produtividade</option><option value="UNFORESEEN_CONDITION">Condição imprevista</option><option value="LEGAL_CHANGE">Mudança legal</option><option value="OTHER">Outro</option></select></div></div><div className={styles.field}><label>Motivo</label><textarea name="reason" required/></div><div className={styles.field}><label>Escopo alterado</label><textarea name="scopeDescription"/></div><div className={styles.grid3}><div className={styles.field}><label>Valor</label><input name="value" type="number" min="0" step="0.01" defaultValue="0"/></div><div className={styles.field}><label>Dias adicionais</label><input name="termDays" type="number" defaultValue="0"/></div><div className={styles.field}><label>Vigência</label><input name="effectiveAt" type="date"/></div></div><div className={styles.formActions}><button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button><button className="button button-primary" disabled={busy} type="submit">Criar aditivo</button></div></form>}

    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Tipo</th><th>Registro</th><th>Valor</th><th>Situação</th><th>Ações</th></tr></thead><tbody>
      {workspace.orders.map((item) => <tr key={`order-${item.id}`}><td>Pedido</td><td><span className={styles.recordTitle}>{item.number}</span><span className={styles.recordMeta}>{item.title} · {item.supplier}</span></td><td>{money(item.amount)}</td><td><span className={styles.status}>{ORDER_STATUS[item.status] ?? item.status}</span></td><td><div className={styles.actions}><BusinessDocumentPrintButton title="Pedido de compra" documentNumber={item.number} subtitle={item.title} fields={[{ label: "Fornecedor", value: item.supplier }, { label: "Situação", value: ORDER_STATUS[item.status] ?? item.status }, { label: "Empreendimento", value: workspace.projectId }]} totalLabel="Valor do pedido" totalValue={money(item.amount)} label="Imprimir pedido"/>{["DRAFT", "IN_APPROVAL"].includes(item.status) && <button className="button button-secondary" disabled={busy} onClick={() => run(() => approvePurchaseOrderAction(item.id), "Pedido aprovado.")}>Aprovar</button>}</div></td></tr>)}
      {workspace.contracts.map((item) => { const detail = operability.contracts.find((contract) => contract.id === item.id); return <tr key={`contract-${item.id}`}><td>Contrato</td><td><span className={styles.recordTitle}>{item.number}</span><span className={styles.recordMeta}>{item.title} · {item.supplier}</span></td><td>{money(item.currentAmount)}</td><td><span className={styles.status}>{CONTRACT_STATUS[item.status] ?? item.status}</span></td><td><div className={styles.actions}><BusinessDocumentPrintButton title="Contrato operacional" documentNumber={item.number} subtitle={item.title} fields={[{ label: "Fornecedor", value: item.supplier }, { label: "Tipo", value: item.type }, { label: "Faturamento", value: item.billingModel }, { label: "Situação", value: CONTRACT_STATUS[item.status] ?? item.status }, { label: "Término", value: new Date(item.endsAt).toLocaleDateString("pt-BR") }]} columns={[{ key: "code", label: "Item" }, { key: "description", label: "Descrição" }, { key: "quantity", label: "Quantidade", align: "right" }, { key: "unit", label: "Unidade" }, { key: "unitPrice", label: "Preço unitário", align: "right" }]} rows={(detail?.items ?? []).map((line) => ({ code: line.code, description: line.description, quantity: line.quantity, unit: line.unit, unitPrice: money(line.unitPrice) }))} totalLabel="Valor atualizado" totalValue={money(item.currentAmount)} label="Imprimir contrato"/>{["DRAFT", "UNDER_REVIEW", "IN_APPROVAL", "APPROVED"].includes(item.status) && <button className="button button-secondary" disabled={busy} onClick={() => advanceContract(item.id, item.status)}>{item.status === "APPROVED" ? "Ativar" : "Avançar"}</button>}</div></td></tr>; })}
      {workspace.contracts.flatMap((contract) => contract.amendments.map((amendment) => ({ ...amendment, contract: contract.number }))).filter((item) => item.status === "DRAFT").map((item) => <tr key={`amendment-${item.id}`}><td>Aditivo</td><td><span className={styles.recordTitle}>{item.contract} · aditivo {item.number}</span><span className={styles.recordMeta}>{item.type}</span></td><td>{money(item.value)}</td><td><span className={styles.status}>Rascunho</span></td><td><button className="button button-secondary" disabled={busy} onClick={() => run(() => approveContractAmendmentAction(item.id), "Aditivo aprovado.")}>Aprovar aditivo</button></td></tr>)}
      {workspace.orders.length === 0 && workspace.contracts.length === 0 && <tr><td colSpan={5} className={styles.empty}>Nenhum pedido ou contrato registrado.</td></tr>}
    </tbody></table></div>
  </section>;
}
