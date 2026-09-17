"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleDollarSign, ClipboardList, Ruler, WalletCards } from "lucide-react";
import type { ContractControlView, ServiceOrderMeasurementView } from "@/application/procurement/contract-control-service";
import type { ProcurementWorkspaceView } from "@/application/procurement/procurement-service";
import { approveMeasurementAction, createMeasurementAction, transitionMeasurementAction } from "@/app/actions/procurement";
import { linkMeasurementToServiceOrderAction } from "@/app/actions/service-orders";
import styles from "./procurement-professional.module.css";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const STATUS: Record<string, string> = {
  DRAFT: "Rascunho",
  SUBMITTED: "Enviada",
  IN_TECHNICAL_REVIEW: "Em análise técnica",
  TECHNICALLY_APPROVED: "Aprovada tecnicamente",
  IN_APPROVAL: "Em aprovação",
  APPROVED: "Aprovada",
  SENT_TO_FINANCE: "Enviada ao Financeiro",
  RETURNED: "Devolvida",
  REVERSED: "Revertida",
  CANCELLED: "Cancelada",
};

export function Contract360MeasurementPanel({
  workspace,
  contracts,
  serviceOrders,
}: {
  workspace: ProcurementWorkspaceView;
  contracts: ContractControlView[];
  serviceOrders: ServiceOrderMeasurementView[];
}) {
  const router = useRouter();
  const [selectedContractId, setSelectedContractId] = useState(contracts[0]?.id ?? "");
  const [selectedServiceOrderId, setSelectedServiceOrderId] = useState("");
  const [openMeasurement, setOpenMeasurement] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const selectedContract = useMemo(() => contracts.find((item) => item.id === selectedContractId) ?? null, [contracts, selectedContractId]);
  const eligibleOrders = useMemo(() => serviceOrders.filter((item) => item.items.some((line) => line.remainingQuantity > 0)), [serviceOrders]);
  const selectedOrder = useMemo(() => eligibleOrders.find((item) => item.id === selectedServiceOrderId) ?? null, [eligibleOrders, selectedServiceOrderId]);

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
    router.refresh();
    return result.data;
  }

  async function submitMeasurement(data: FormData) {
    if (!selectedOrder) return setFeedback("Selecione uma ordem de serviço com saldo disponível para medição.");
    const lines = selectedOrder.items.map((item) => ({
      contractItemId: item.contractItemId,
      periodQuantity: String(data.get(`quantity_${item.contractItemId}`) || "0"),
    })).filter((item) => Number(item.periodQuantity) > 0);
    if (lines.length === 0) return setFeedback("Informe quantidade medida em ao menos um item da ordem de serviço.");

    for (const line of lines) {
      const source = selectedOrder.items.find((item) => item.contractItemId === line.contractItemId);
      if (!source || Number(line.periodQuantity) > source.remainingQuantity) {
        return setFeedback("A quantidade medida não pode ultrapassar o saldo autorizado da ordem de serviço.");
      }
    }

    const created = await run(() => createMeasurementAction({
      contractId: selectedOrder.contractId,
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
    }), "Medição criada. Vinculando à ordem de serviço...");

    if (!created) return;
    const measurementId = (created as { id?: string }).id;
    if (!measurementId) return setFeedback("A medição foi criada, mas não foi possível identificar seu registro para vinculá-la à OS.");
    const linked = await run(() => linkMeasurementToServiceOrderAction(measurementId, selectedOrder.id), "Medição criada e vinculada à ordem de serviço.");
    if (linked) {
      setOpenMeasurement(false);
      setSelectedServiceOrderId("");
    }
  }

  async function advanceMeasurement(id: string, status: string) {
    const next = status === "DRAFT" ? "SUBMITTED" : status === "SUBMITTED" ? "IN_TECHNICAL_REVIEW" : status === "IN_TECHNICAL_REVIEW" ? "TECHNICALLY_APPROVED" : "IN_APPROVAL";
    await run(() => transitionMeasurementAction(id, next as "SUBMITTED" | "IN_TECHNICAL_REVIEW" | "TECHNICALLY_APPROVED" | "IN_APPROVAL"), `Medição atualizada para ${STATUS[next].toLowerCase()}.`);
  }

  const pendingMeasurements = workspace.measurements.filter((item) => ["DRAFT", "SUBMITTED", "IN_TECHNICAL_REVIEW", "TECHNICALLY_APPROVED", "IN_APPROVAL"].includes(item.status));

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div>
          <span className={styles.kicker}>Controle contratual</span>
          <h2 className={styles.title}>Contrato 360 e medições</h2>
          <p className={styles.description}>Acompanhe o valor contratado, os aditivos, o que foi autorizado por ordem de serviço, o que já foi medido, aprovado e efetivamente pago.</p>
        </div>
        <div className={styles.actions}><button className="button button-primary" onClick={() => setOpenMeasurement((value) => !value)}><Ruler size={15} /> Nova medição</button></div>
      </div>

      <div className={styles.field}><label>Contrato</label><select value={selectedContractId} onChange={(event) => setSelectedContractId(event.target.value)}><option value="">Selecione o contrato</option>{contracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.number} · {contract.title} · {contract.supplierName}</option>)}</select></div>

      {selectedContract ? <>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryCard}><span className={styles.summaryLabel}>Valor original</span><span className={styles.summaryValue}>{money(selectedContract.originalAmount)}</span></div>
          <div className={styles.summaryCard}><span className={styles.summaryLabel}>Aditivos aprovados</span><span className={styles.summaryValue}>{money(selectedContract.approvedAmendments)}</span></div>
          <div className={styles.summaryCard}><span className={styles.summaryLabel}>Valor atualizado</span><span className={styles.summaryValue}>{money(selectedContract.currentAmount)}</span></div>
          <div className={styles.summaryCard}><span className={styles.summaryLabel}>Autorizado por OS</span><span className={styles.summaryValue}>{money(selectedContract.authorizedByServiceOrders)}</span></div>
          <div className={styles.summaryCard}><span className={styles.summaryLabel}>Medido</span><span className={styles.summaryValue}>{money(selectedContract.measuredGross)}</span></div>
          <div className={styles.summaryCard}><span className={styles.summaryLabel}>Aprovado para pagamento</span><span className={styles.summaryValue}>{money(selectedContract.approvedForPayment)}</span></div>
          <div className={styles.summaryCard}><span className={styles.summaryLabel}>Pago</span><span className={styles.summaryValue}>{money(selectedContract.paidAmount)}</span></div>
          <div className={styles.summaryCard}><span className={styles.summaryLabel}>Saldo contratual</span><span className={styles.summaryValue}>{money(selectedContract.contractBalance)}</span></div>
        </div>
        <div className={styles.flowBar}>{[
          `Contratado ${money(selectedContract.currentAmount)}`,
          `Autorizado ${money(selectedContract.authorizedByServiceOrders)}`,
          `Medido ${money(selectedContract.measuredGross)}`,
          `Aprovado ${money(selectedContract.approvedForPayment)}`,
          `Pago ${money(selectedContract.paidAmount)}`,
        ].map((step) => <span className={styles.flowStep} key={step}>{step}</span>)}</div>
      </> : <div className={styles.empty}>Selecione um contrato para visualizar sua posição financeira e física.</div>}

      {feedback && <div className={styles.info}><CircleDollarSign size={18} /><div><strong>Controle contratual</strong><p>{feedback}</p></div></div>}

      {openMeasurement && (
        <form action={submitMeasurement} className={styles.formCard}>
          <h3 className={styles.formTitle}>Nova medição por ordem de serviço</h3>
          <div className={styles.field}><label>Ordem de serviço</label><select value={selectedServiceOrderId} onChange={(event) => setSelectedServiceOrderId(event.target.value)} required><option value="">Selecione a OS</option>{eligibleOrders.map((order) => <option value={order.id} key={order.id}>{order.number} · {order.title} · contrato {order.contractNumber}</option>)}</select></div>
          {selectedOrder && <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Item autorizado</th><th>Autorizado</th><th>Medido anteriormente</th><th>Saldo</th><th>Quantidade desta medição</th></tr></thead><tbody>{selectedOrder.items.map((item) => <tr key={item.contractItemId}><td><span className={styles.recordTitle}>{item.description}</span><span className={styles.recordMeta}>{money(item.unitPrice)} / {item.unit}</span></td><td>{item.authorizedQuantity} {item.unit}</td><td>{item.previousMeasuredQuantity} {item.unit}</td><td>{item.remainingQuantity} {item.unit}</td><td><input name={`quantity_${item.contractItemId}`} type="number" min="0" max={item.remainingQuantity} step="0.0001" defaultValue="0" disabled={item.remainingQuantity <= 0} /></td></tr>)}</tbody></table></div>}
          <div className={styles.grid3}><div className={styles.field}><label>Número da medição</label><input name="number" type="number" min="1" required /></div><div className={styles.field}><label>Competência</label><input name="competenceDate" type="date" required /></div><div className={styles.field}><label>Avanço físico</label><input name="physicalProgress" type="number" min="0" step="0.0001" placeholder="Ex.: 0,35" /></div></div>
          <div className={styles.grid4}><div className={styles.field}><label>Início do período</label><input name="periodStart" type="date" required /></div><div className={styles.field}><label>Fim do período</label><input name="periodEnd" type="date" required /></div><div className={styles.field}><label>Emissão</label><input name="issuedAt" type="date" required /></div><div className={styles.field}><label>Vencimento</label><input name="dueDate" type="date" required /></div></div>
          <div className={styles.grid3}><div className={styles.field}><label>Retenção</label><input name="retentionAmount" type="number" min="0" step="0.01" defaultValue="0" /></div><div className={styles.field}><label>Desconto / glosa</label><input name="discountAmount" type="number" min="0" step="0.01" defaultValue="0" /></div><div className={styles.field}><label>Amortização de adiantamento</label><input name="advanceAmortizationAmount" type="number" min="0" step="0.01" defaultValue="0" /></div></div>
          <div className={styles.formActions}><button className="button button-secondary" type="button" onClick={() => setOpenMeasurement(false)}>Cancelar</button><button className="button button-primary" type="submit" disabled={busy || !selectedOrder}>Criar medição</button></div>
        </form>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Medição</th><th>Contrato</th><th>Valor bruto</th><th>Valor líquido</th><th>Situação</th><th>Próxima ação</th></tr></thead>
          <tbody>{pendingMeasurements.map((item) => <tr key={item.id}><td><span className={styles.recordTitle}>BM {item.number}</span><span className={styles.recordMeta}>{item.competenceDate}</span></td><td>{item.contract}</td><td>{money(item.grossAmount)}</td><td>{money(item.netAmount)}</td><td><span className={styles.status}>{STATUS[item.status] ?? item.status}</span></td><td>{item.status === "IN_APPROVAL" ? <button className="button button-primary" disabled={busy} onClick={() => run(() => approveMeasurementAction(item.id), "Medição aprovada e enviada ao Financeiro.")}><WalletCards size={14} /> Aprovar e enviar</button> : <button className="button button-secondary" disabled={busy} onClick={() => advanceMeasurement(item.id, item.status)}><ClipboardList size={14} /> Avançar</button>}</td></tr>)}{pendingMeasurements.length === 0 && <tr><td colSpan={6} className={styles.empty}>Nenhuma medição aguardando ação.</td></tr>}</tbody>
        </table>
      </div>
    </section>
  );
}