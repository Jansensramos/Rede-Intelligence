"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, PlayCircle, Plus, Send, SquareCheckBig } from "lucide-react";
import type { ProcurementOperabilityMetadata } from "@/application/procurement/procurement-operability-service";
import type { ServiceOrderStatus, ServiceOrderView } from "@/application/procurement/service-order-service";
import { createServiceOrderAction, transitionServiceOrderAction } from "@/app/actions/service-orders";
import styles from "./procurement-professional.module.css";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const STATUS: Record<ServiceOrderStatus, string> = {
  DRAFT: "Rascunho",
  IN_APPROVAL: "Em aprovação",
  APPROVED: "Aprovada",
  ISSUED: "Emitida",
  IN_PROGRESS: "Em execução",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
};

export function ServiceOrderOperabilityPanel({ projectId, operability, serviceOrders }: { projectId: string; operability: ProcurementOperabilityMetadata; serviceOrders: ServiceOrderView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [contractId, setContractId] = useState("");

  const eligibleContracts = useMemo(() => operability.contracts.filter((contract) => ["APPROVED", "ACTIVE"].includes(contract.status) && ["SERVICE", "CONSTRUCTION", "DESIGN", "CONSULTING", "OTHER"].includes(contract.type)), [operability.contracts]);
  const selectedContract = useMemo(() => eligibleContracts.find((contract) => contract.id === contractId) ?? null, [eligibleContracts, contractId]);
  const activeCount = serviceOrders.filter((item) => ["APPROVED", "ISSUED", "IN_PROGRESS"].includes(item.status)).length;
  const authorized = serviceOrders.filter((item) => item.status !== "CANCELLED").reduce((sum, item) => sum + item.authorizedAmount, 0);

  async function run<T>(operation: () => Promise<ActionResult<T>>, success: string) {
    setBusy(true);
    setFeedback(null);
    const result = await operation();
    setBusy(false);
    if (!result.ok) {
      setFeedback(result.error);
      return;
    }
    setFeedback(success);
    setOpen(false);
    router.refresh();
  }

  async function submit(data: FormData) {
    if (!selectedContract) return setFeedback("Selecione um contrato elegível.");
    const items = selectedContract.items.map((item) => ({
      contractItemId: item.id,
      quantity: Number(data.get(`qty_${item.id}`) || 0),
    })).filter((item) => item.quantity > 0);
    if (items.length === 0) return setFeedback("Informe quantidade autorizada em ao menos um item.");
    await run(() => createServiceOrderAction({
      projectId,
      contractId: selectedContract.id,
      number: String(data.get("number")),
      title: String(data.get("title")),
      scope: String(data.get("scope")),
      startsAt: data.get("startsAt") ? new Date(`${data.get("startsAt")}T00:00:00.000Z`) : null,
      endsAt: data.get("endsAt") ? new Date(`${data.get("endsAt")}T23:59:59.000Z`) : null,
      notes: String(data.get("notes") || "") || null,
      items,
    }), "Ordem de serviço criada.");
  }

  async function advance(item: ServiceOrderView) {
    const next: ServiceOrderStatus | null = item.status === "DRAFT" ? "IN_APPROVAL" : item.status === "IN_APPROVAL" ? "APPROVED" : item.status === "APPROVED" ? "ISSUED" : item.status === "ISSUED" ? "IN_PROGRESS" : item.status === "IN_PROGRESS" ? "COMPLETED" : null;
    if (!next) return;
    await run(() => transitionServiceOrderAction(item.id, next), `Ordem de serviço atualizada para ${STATUS[next].toLowerCase()}.`);
  }

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div>
          <span className={styles.kicker}>Execução autorizada</span>
          <h2 className={styles.title}>Ordens de serviço</h2>
          <p className={styles.description}>Autorize frentes específicas de um contrato sem confundir valor contratado com valor efetivamente liberado para execução.</p>
        </div>
        <div className={styles.actions}><button className="button button-primary" onClick={() => setOpen((value) => !value)}><Plus size={15} /> Nova ordem de serviço</button></div>
      </div>

      <div className={styles.flowBar}>{['Contrato ativo', 'OS em aprovação', 'OS emitida', 'Execução', 'Medição', 'Pagamento'].map((step) => <span className={styles.flowStep} key={step}>{step}</span>)}</div>

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Ordens de serviço</span><span className={styles.summaryValue}>{serviceOrders.length}</span></div>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Em execução / autorizadas</span><span className={styles.summaryValue}>{activeCount}</span></div>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Valor autorizado</span><span className={styles.summaryValue}>{authorized.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}</span></div>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Contratos elegíveis</span><span className={styles.summaryValue}>{eligibleContracts.length}</span></div>
      </div>

      {feedback && <div className={styles.info}><ClipboardCheck size={18} /><div><strong>Ordens de serviço</strong><p>{feedback}</p></div></div>}

      {open && (
        <form action={submit} className={styles.formCard}>
          <h3 className={styles.formTitle}>Nova ordem de serviço</h3>
          <div className={styles.field}><label>Contrato de origem</label><select value={contractId} onChange={(event) => setContractId(event.target.value)} required><option value="">Selecione o contrato</option>{eligibleContracts.map((contract) => <option value={contract.id} key={contract.id}>{contract.number} · {contract.title}</option>)}</select></div>
          <div className={styles.grid2}><div className={styles.field}><label>Número da OS</label><input name="number" placeholder="OS-0001" required /></div><div className={styles.field}><label>Título</label><input name="title" placeholder="Frente ou serviço autorizado" required /></div></div>
          <div className={styles.field}><label>Escopo autorizado</label><textarea name="scope" placeholder="Defina claramente o que está autorizado nesta ordem de serviço." required /></div>
          <div className={styles.grid2}><div className={styles.field}><label>Início previsto</label><input name="startsAt" type="date" /></div><div className={styles.field}><label>Término previsto</label><input name="endsAt" type="date" /></div></div>
          {selectedContract && <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Item contratual</th><th>Contratado</th><th>Unidade</th><th>Quantidade autorizada</th></tr></thead><tbody>{selectedContract.items.map((item) => <tr key={item.id}><td><span className={styles.recordTitle}>{item.code}</span><span className={styles.recordMeta}>{item.description}</span></td><td>{item.quantity}</td><td>{item.unit}</td><td><input name={`qty_${item.id}`} type="number" min="0" max={item.quantity} step="0.0001" defaultValue="0" /></td></tr>)}</tbody></table></div>}
          <div className={styles.field}><label>Observações</label><textarea name="notes" placeholder="Orientações de execução, condicionantes ou referências." /></div>
          <div className={styles.formActions}><button className="button button-secondary" type="button" onClick={() => setOpen(false)}>Cancelar</button><button className="button button-primary" disabled={busy || !selectedContract} type="submit">Criar ordem de serviço</button></div>
        </form>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>OS</th><th>Contrato</th><th>Valor autorizado</th><th>Situação</th><th>Próxima ação</th></tr></thead>
          <tbody>
            {serviceOrders.map((item) => <tr key={item.id}><td><span className={styles.recordTitle}>{item.number}</span><span className={styles.recordMeta}>{item.title}</span></td><td><span className={styles.recordTitle}>{item.contractNumber}</span><span className={styles.recordMeta}>{item.contractTitle}</span></td><td>{item.authorizedAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td><td><span className={styles.status}>{STATUS[item.status]}</span></td><td>{!["COMPLETED", "CANCELLED"].includes(item.status) ? <button className="button button-secondary" disabled={busy} onClick={() => advance(item)}>{item.status === "DRAFT" ? <><Send size={14} /> Enviar para aprovação</> : item.status === "IN_APPROVAL" ? <><SquareCheckBig size={14} /> Aprovar</> : item.status === "APPROVED" ? <><Send size={14} /> Emitir</> : item.status === "ISSUED" ? <><PlayCircle size={14} /> Iniciar execução</> : <><SquareCheckBig size={14} /> Concluir</>}</button> : "—"}</td></tr>)}
            {serviceOrders.length === 0 && <tr><td colSpan={5} className={styles.empty}>Nenhuma ordem de serviço registrada para este empreendimento.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
