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
import styles from "./procurement-professional.module.css";

type FormKey = "order" | "contract" | "amendment" | "measurement" | null;
type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const STATUS: Record<string, string> = {
  DRAFT: "Rascunho",
  UNDER_REVIEW: "Em revisão",
  IN_APPROVAL: "Em aprovação",
  APPROVED: "Aprovado",
  ACTIVE: "Ativo",
  SUSPENDED: "Suspenso",
  SUBMITTED: "Enviada",
  IN_TECHNICAL_REVIEW: "Em análise técnica",
  TECHNICALLY_APPROVED: "Aprovada tecnicamente",
};

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);

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

  const openOrders = workspace.orders.filter((item) => ["DRAFT", "IN_APPROVAL"].includes(item.status));
  const contractsInFlow = workspace.contracts.filter((item) => ["DRAFT", "UNDER_REVIEW", "IN_APPROVAL", "APPROVED"].includes(item.status));
  const measurementsInFlow = workspace.measurements.filter((item) => ["DRAFT", "SUBMITTED", "IN_TECHNICAL_REVIEW", "TECHNICALLY_APPROVED", "IN_APPROVAL"].includes(item.status));

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
      setFeedback("Vincule uma empresa/SPE ao empreendimento e selecione uma cotação decidida.");
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
      setFeedback("Vincule uma empresa/SPE ao empreendimento e selecione uma cotação decidida.");
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
    await run(() => transitionOperationalContractAction(id, next as "UNDER_REVIEW" | "IN_APPROVAL" | "APPROVED" | "ACTIVE"), `Contrato atualizado para ${STATUS[next]?.toLowerCase() ?? next.toLowerCase()}.`);
  }

  async function advanceMeasurement(id: string, status: string) {
    const next = status === "DRAFT" ? "SUBMITTED" : status === "SUBMITTED" ? "IN_TECHNICAL_REVIEW" : status === "IN_TECHNICAL_REVIEW" ? "TECHNICALLY_APPROVED" : "IN_APPROVAL";
    await run(() => transitionMeasurementAction(id, next as "SUBMITTED" | "IN_TECHNICAL_REVIEW" | "TECHNICALLY_APPROVED" | "IN_APPROVAL"), `Medição atualizada para ${STATUS[next]?.toLowerCase() ?? next.toLowerCase()}.`);
  }

  const selectedContractValue = selectedMeasurementContract?.items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0) ?? 0;

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div>
          <span className={styles.kicker}>Contratação e execução</span>
          <h2 className={styles.title}>Pedidos, contratos, aditivos e medições</h2>
          <p className={styles.description}>Transforme uma compra aprovada em compromisso contratual, acompanhe alterações e leve a execução medida até o Financeiro com rastreabilidade.</p>
        </div>
        <div className={styles.actions}>
          <button className="button button-secondary" onClick={() => setForm(form === "order" ? null : "order")}><ShoppingBag size={15} /> Pedido de compra</button>
          <button className="button button-secondary" onClick={() => setForm(form === "contract" ? null : "contract")}><FileSignature size={15} /> Contrato</button>
          <button className="button button-secondary" onClick={() => setForm(form === "amendment" ? null : "amendment")}><SquarePen size={15} /> Aditivo</button>
          <button className="button button-primary" onClick={() => setForm(form === "measurement" ? null : "measurement")}><Ruler size={15} /> Medição</button>
        </div>
      </div>

      <div className={styles.flowBar} aria-label="Fluxo de contratação">
        {['Cotação decidida', 'Pedido ou contrato', 'Aprovação', 'Execução', 'Medição', 'Financeiro'].map((step) => <span className={styles.flowStep} key={step}>{step}</span>)}
      </div>

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Pedidos em fluxo</span><span className={styles.summaryValue}>{openOrders.length}</span></div>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Contratos em fluxo</span><span className={styles.summaryValue}>{contractsInFlow.length}</span></div>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Contratos mensuráveis</span><span className={styles.summaryValue}>{measurableContracts.length}</span></div>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Medições em análise</span><span className={styles.summaryValue}>{measurementsInFlow.length}</span></div>
      </div>

      {feedback && <div className={styles.info} role="status"><CheckCircle2 size={18} /><div><strong>Contratação</strong><p>{feedback}</p></div></div>}

      {(form === "order" || form === "contract") && (
        <div className={styles.formCard}>
          <h3 className={styles.formTitle}>Origem da contratação</h3>
          <div className={styles.field}><label>Cotação decidida</label><select value={sourceQuotationId} onChange={(event) => setSourceQuotationId(event.target.value)}><option value="">Selecione uma cotação</option>{decidedSources.map((item) => <option value={item.id} key={item.id}>{item.number} · {item.title} · {item.selectedProposal?.supplierName}</option>)}</select></div>
          {!operability.companyId && <div className={styles.warning}>Vincule uma empresa/SPE ao empreendimento antes de criar pedidos ou contratos.</div>}
          {selectedSource && <div className={styles.info}><FileSignature size={18} /><div><strong>{selectedSource.selectedProposal?.supplierName}</strong><p>{selectedSource.selectedProposal?.items.length} item(ns) da proposta vencedora serão usados como base da contratação.</p></div></div>}
        </div>
      )}

      {form === "order" && selectedSource && (
        <form action={submitOrder} className={styles.formCard}>
          <h3 className={styles.formTitle}>Novo pedido de compra</h3>
          <div className={styles.grid2}>
            <div className={styles.field}><label>Número do pedido</label><input name="number" required placeholder="PC-0001" /></div>
            <div className={styles.field}><label>Título</label><input name="title" required placeholder="Descrição objetiva do pedido" /></div>
          </div>
          <div className={styles.field}><label>Escopo</label><textarea name="scope" required placeholder="Descreva o objeto do fornecimento, limites e condições principais." /></div>
          <div className={styles.grid2}>
            <div className={styles.field}><label>Data prevista de entrega</label><input name="deliveryAt" type="date" /></div>
            <div className={styles.field}><label>Condições de pagamento</label><input name="paymentTerms" placeholder="Ex.: 30/60/90 dias" /></div>
          </div>
          <div className={styles.formActions}><button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button><button className="button button-primary" disabled={busy || !operability.companyId} type="submit">Criar pedido de compra</button></div>
        </form>
      )}

      {form === "contract" && selectedSource && (
        <form action={submitContract} className={styles.formCard}>
          <h3 className={styles.formTitle}>Novo contrato</h3>
          <div className={styles.grid2}>
            <div className={styles.field}><label>Número</label><input name="number" required placeholder="CT-0001" /></div>
            <div className={styles.field}><label>Título do contrato</label><input name="title" required placeholder="Objeto principal do contrato" /></div>
          </div>
          <div className={styles.grid2}>
            <div className={styles.field}><label>Tipo</label><select name="type" defaultValue="CONSTRUCTION"><option value="SUPPLY">Fornecimento</option><option value="SERVICE">Serviço</option><option value="CONSTRUCTION">Construção</option><option value="DESIGN">Projeto</option><option value="CONSULTING">Consultoria</option><option value="LEASE">Locação</option><option value="ACQUISITION">Aquisição</option><option value="OTHER">Outro</option></select></div>
            <div className={styles.field}><label>Modelo de cobrança</label><select name="billingModel" defaultValue="MEASUREMENT"><option value="MEASUREMENT">Por medição</option><option value="FIXED_INSTALLMENT">Parcela fixa</option><option value="MONTHLY">Mensal</option><option value="MILESTONE">Por marco</option><option value="DELIVERY">Por entrega</option><option value="ADVANCE">Adiantamento</option><option value="CUSTOM">Personalizado</option></select></div>
          </div>
          <div className={styles.field}><label>Escopo contratual</label><textarea name="scope" required placeholder="Defina o escopo, exclusões e responsabilidades principais." /></div>
          <div className={styles.grid2}>
            <div className={styles.field}><label>Início</label><input name="startsAt" type="date" required /></div>
            <div className={styles.field}><label>Término previsto</label><input name="endsAt" type="date" required /></div>
          </div>
          <div className={styles.field}><label>Condições de pagamento</label><input name="paymentTerms" placeholder="Condição contratual de pagamento" /></div>
          <div className={styles.grid2}>
            <div className={styles.field}><label>Retenção (%)</label><input name="retentionRate" type="number" min="0" step="0.01" defaultValue="0" /></div>
            <div className={styles.field}><label>Garantia</label><input name="warrantyTerms" placeholder="Prazo e condições de garantia" /></div>
          </div>
          <div className={styles.formActions}><button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button><button className="button button-primary" disabled={busy || !operability.companyId} type="submit">Criar contrato</button></div>
        </form>
      )}

      {form === "amendment" && (
        <form action={submitAmendment} className={styles.formCard}>
          <h3 className={styles.formTitle}>Novo aditivo contratual</h3>
          <div className={styles.field}><label>Contrato</label><select name="contractId" required defaultValue=""><option value="" disabled>Selecione o contrato</option>{measurableContracts.map((item) => <option value={item.id} key={item.id}>{item.number} · {item.title}</option>)}</select></div>
          <div className={styles.grid3}>
            <div className={styles.field}><label>Número do aditivo</label><input name="number" type="number" min="1" required /></div>
            <div className={styles.field}><label>Tipo</label><select name="type" defaultValue="INCREASE"><option value="INCREASE">Acréscimo</option><option value="SUPPRESSION">Supressão</option><option value="TERM">Prazo</option><option value="SCOPE">Escopo</option><option value="READJUSTMENT">Reajuste</option><option value="OTHER">Outro</option></select></div>
            <div className={styles.field}><label>Causa do desvio</label><select name="deviationCause" defaultValue="SCOPE"><option value="PRICE">Preço</option><option value="QUANTITY">Quantidade</option><option value="SCOPE">Escopo</option><option value="TERM">Prazo</option><option value="DESIGN">Projeto</option><option value="MARKET">Mercado</option><option value="SUPPLIER">Fornecedor</option><option value="OTHER">Outro</option></select></div>
          </div>
          <div className={styles.field}><label>Motivo</label><textarea name="reason" required placeholder="Explique por que o aditivo é necessário." /></div>
          <div className={styles.field}><label>Escopo alterado</label><textarea name="scopeDescription" placeholder="Descreva o que muda em relação ao contrato vigente." /></div>
          <div className={styles.grid3}>
            <div className={styles.field}><label>Valor</label><input name="value" type="number" min="0" step="0.01" defaultValue="0" /></div>
            <div className={styles.field}><label>Prazo adicional (dias)</label><input name="termDays" type="number" defaultValue="0" /></div>
            <div className={styles.field}><label>Vigência</label><input name="effectiveAt" type="date" /></div>
          </div>
          <div className={styles.formActions}><button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button><button className="button button-primary" disabled={busy} type="submit">Criar aditivo</button></div>
        </form>
      )}

      {form === "measurement" && (
        <form action={submitMeasurement} className={styles.formCard}>
          <h3 className={styles.formTitle}>Nova medição</h3>
          <div className={styles.field}><label>Contrato</label><select value={measurementContractId} onChange={(event) => setMeasurementContractId(event.target.value)} required><option value="">Selecione o contrato</option>{measurableContracts.map((item) => <option value={item.id} key={item.id}>{item.number} · {item.title}</option>)}</select></div>
          {selectedMeasurementContract && <div className={styles.info}><Ruler size={18} /><div><strong>{selectedMeasurementContract.number} · {selectedMeasurementContract.title}</strong><p>Valor-base dos itens: {money(selectedContractValue)}. Informe abaixo somente a quantidade executada neste período.</p></div></div>}
          {selectedMeasurementContract && <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Item</th><th>Contratado</th><th>Unidade</th><th>Quantidade no período</th></tr></thead><tbody>{selectedMeasurementContract.items.map((item) => <tr key={item.id}><td><span className={styles.recordTitle}>{item.code}</span><span className={styles.recordMeta}>{item.description}</span></td><td>{item.quantity}</td><td>{item.unit}</td><td><input name={`quantity_${item.id}`} type="number" min="0" max={item.quantity} step="0.0001" defaultValue="0" /></td></tr>)}</tbody></table></div>}
          <div className={styles.grid3}>
            <div className={styles.field}><label>Número da medição</label><input name="number" type="number" min="1" required /></div>
            <div className={styles.field}><label>Competência</label><input name="competenceDate" type="date" required /></div>
            <div className={styles.field}><label>Avanço físico (%)</label><input name="physicalProgress" type="number" min="0" step="0.0001" /></div>
          </div>
          <div className={styles.grid4}>
            <div className={styles.field}><label>Início do período</label><input name="periodStart" type="date" required /></div>
            <div className={styles.field}><label>Fim do período</label><input name="periodEnd" type="date" required /></div>
            <div className={styles.field}><label>Emissão</label><input name="issuedAt" type="date" required /></div>
            <div className={styles.field}><label>Vencimento</label><input name="dueDate" type="date" required /></div>
          </div>
          <div className={styles.grid3}>
            <div className={styles.field}><label>Retenção</label><input name="retentionAmount" type="number" min="0" step="0.01" defaultValue="0" /></div>
            <div className={styles.field}><label>Desconto / glosa</label><input name="discountAmount" type="number" min="0" step="0.01" defaultValue="0" /></div>
            <div className={styles.field}><label>Amortização de adiantamento</label><input name="advanceAmortizationAmount" type="number" min="0" step="0.01" defaultValue="0" /></div>
          </div>
          <div className={styles.formActions}><button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button><button className="button button-primary" disabled={busy || !selectedMeasurementContract} type="submit">Criar medição</button></div>
        </form>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Fluxo</th><th>Registro</th><th>Situação</th><th>Próxima ação</th></tr></thead>
          <tbody>
            {openOrders.map((item) => <tr key={`order-${item.id}`}><td>Pedido de compra</td><td><span className={styles.recordTitle}>{item.number}</span><span className={styles.recordMeta}>{item.title}</span></td><td><span className={styles.status}>{STATUS[item.status] ?? item.status}</span></td><td><button className="button button-secondary" disabled={busy} onClick={() => run(() => approvePurchaseOrderAction(item.id), "Pedido aprovado.")}>Aprovar pedido</button></td></tr>)}
            {contractsInFlow.map((item) => <tr key={`contract-${item.id}`}><td>Contrato</td><td><span className={styles.recordTitle}>{item.number}</span><span className={styles.recordMeta}>{item.title}</span></td><td><span className={styles.status}>{STATUS[item.status] ?? item.status}</span></td><td><button className="button button-secondary" disabled={busy} onClick={() => advanceContract(item.id, item.status)}>{item.status === "APPROVED" ? "Ativar contrato" : "Avançar etapa"}</button></td></tr>)}
            {workspace.contracts.flatMap((contract) => contract.amendments.map((amendment) => ({ ...amendment, contract: contract.number }))).filter((item) => item.status === "DRAFT").map((item) => <tr key={`amendment-${item.id}`}><td>Aditivo</td><td><span className={styles.recordTitle}>{item.contract}</span><span className={styles.recordMeta}>Aditivo {item.number}</span></td><td><span className={styles.status}>Rascunho</span></td><td><button className="button button-secondary" disabled={busy} onClick={() => run(() => approveContractAmendmentAction(item.id), "Aditivo aprovado.")}>Aprovar aditivo</button></td></tr>)}
            {measurementsInFlow.map((item) => <tr key={`measurement-${item.id}`}><td>Medição</td><td><span className={styles.recordTitle}>BM {item.number}</span><span className={styles.recordMeta}>{item.contract}</span></td><td><span className={styles.status}>{STATUS[item.status] ?? item.status}</span></td><td>{item.status === "IN_APPROVAL" ? <button className="button button-primary" disabled={busy} onClick={() => run(() => approveMeasurementAction(item.id), "Medição aprovada e enviada ao Financeiro.")}>Aprovar e enviar ao Financeiro</button> : <button className="button button-secondary" disabled={busy} onClick={() => advanceMeasurement(item.id, item.status)}>Avançar etapa</button>}</td></tr>)}
            {openOrders.length === 0 && contractsInFlow.length === 0 && measurementsInFlow.length === 0 && <tr><td colSpan={4} className={styles.empty}>Nenhum pedido, contrato, aditivo ou medição aguardando ação.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
