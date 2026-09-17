"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeDollarSign, CalendarCheck2, ContactRound, FileCheck2, ShoppingCart, UserPlus } from "lucide-react";
import type { SalesWorkspaceView } from "@/application/sales/sales-service";
import {
  approveSaleAction,
  confirmSalesReservationAction,
  createCommercialCustomerAction,
  createSaleAction,
  createSalesLeadAction,
  createSalesProposalAction,
  createSalesReservationAction,
  releaseSalesReservationAction,
} from "@/app/actions/sales";
import styles from "./sales-operability-panel.module.css";

type ModalState =
  | { type: "customer" }
  | { type: "lead" }
  | { type: "proposal" }
  | { type: "reservation" }
  | { type: "sale" }
  | { type: "release"; reservationId: string; label: string }
  | { type: "approve"; saleId: string; unit: string; soldPrice: number }
  | null;

type ActionResult = { ok: boolean; error?: string };

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const RESERVATION_STATUS: Record<string, string> = { ACTIVE: "Ativa", CONFIRMED: "Confirmada", RELEASED: "Liberada", EXPIRED: "Expirada", CANCELLED: "Cancelada" };
const SALE_STATUS: Record<string, string> = { DRAFT: "Rascunho", IN_APPROVAL: "Em aprovação", APPROVED: "Aprovada", CANCELLED: "Cancelada", REVERSED: "Revertida" };
const UNIT_STATUS: Record<string, string> = { DISPONIVEL: "Disponível", EM_PROPOSTA: "Em proposta", EM_RESERVA: "Em reserva", RESERVADA: "Reservada", VENDIDA: "Vendida", BLOQUEADA: "Bloqueada", ENTREGUE: "Entregue" };

export function SalesOperabilityPanel({ workspace }: { workspace: SalesWorkspaceView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [modal, setModal] = useState<ModalState>(null);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const activeTable = workspace.priceTables.find((table) => table.status === "ACTIVE");
  const availableUnits = useMemo(
    () => workspace.units.filter((unit) => ["DISPONIVEL", "EM_PROPOSTA", "EM_RESERVA", "RESERVADA"].includes(unit.status)),
    [workspace.units],
  );
  const pendingReservations = workspace.reservations.filter((reservation) => ["ACTIVE", "CONFIRMED"].includes(reservation.status));
  const draftSales = workspace.sales.filter((sale) => sale.status === "DRAFT");

  const run = (op: () => Promise<ActionResult>, successMessage: string) => {
    setFeedback(null);
    startTransition(async () => {
      const result = await op();
      if (!result.ok) {
        setFeedback({ type: "error", text: result.error ?? "Não foi possível concluir a operação." });
        return;
      }
      setModal(null);
      setFeedback({ type: "success", text: successMessage });
      router.refresh();
    });
  };

  const getUnit = (id: string) => workspace.units.find((unit) => unit.id === id);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!modal) return;
    const data = new FormData(event.currentTarget);

    if (modal.type === "customer") {
      const name = String(data.get("name") ?? "").trim();
      const personType = String(data.get("personType") ?? "INDIVIDUAL") as "INDIVIDUAL" | "LEGAL_ENTITY";
      const taxId = String(data.get("taxId") ?? "").trim() || null;
      const email = String(data.get("email") ?? "").trim() || null;
      const phone = String(data.get("phone") ?? "").trim() || null;
      if (!name) return setFeedback({ type: "error", text: "Informe o nome do cliente." });
      return run(() => createCommercialCustomerAction({ name, personType, taxId, email, phone }), "Cliente cadastrado com sucesso.");
    }

    if (modal.type === "lead") {
      const name = String(data.get("name") ?? "").trim();
      const contact = String(data.get("contact") ?? "").trim();
      const source = String(data.get("source") ?? "").trim();
      const channel = String(data.get("channel") ?? "").trim() || null;
      if (!name || !contact || !source) return setFeedback({ type: "error", text: "Preencha nome, contato e origem do lead." });
      return run(() => createSalesLeadAction({ projectId: workspace.projectId, name, contact, source, channel }), "Lead cadastrado com sucesso.");
    }

    if (modal.type === "proposal") {
      if (!activeTable) return setFeedback({ type: "error", text: "Ative uma tabela de preços antes de criar propostas." });
      const salesUnitId = String(data.get("salesUnitId") ?? "");
      const customerId = String(data.get("customerId") ?? "");
      const unit = getUnit(salesUnitId);
      const proposedPrice = Number(data.get("proposedPrice"));
      const validityDays = Math.max(1, Number(data.get("validityDays") ?? 7));
      if (!unit || !customerId || !Number.isFinite(proposedPrice) || proposedPrice <= 0) return setFeedback({ type: "error", text: "Revise unidade, cliente e preço da proposta." });
      const listPrice = Number(unit.listPrice ?? proposedPrice);
      return run(
        () => createSalesProposalAction({
          salesUnitId,
          customerId,
          priceTableId: activeTable.id,
          proposedPrice,
          discountAmount: Math.max(0, listPrice - proposedPrice),
          paymentConditionSummary: {},
          validUntil: new Date(Date.now() + validityDays * 86400000),
        }),
        "Proposta comercial criada.",
      );
    }

    if (modal.type === "reservation") {
      const salesUnitId = String(data.get("salesUnitId") ?? "");
      const customerId = String(data.get("customerId") ?? "");
      const days = Math.max(1, Number(data.get("days") ?? 3));
      if (!salesUnitId || !customerId) return setFeedback({ type: "error", text: "Selecione unidade e cliente." });
      return run(
        () => createSalesReservationAction({ salesUnitId, customerId, expiresAt: new Date(Date.now() + days * 86400000) }),
        "Reserva registrada.",
      );
    }

    if (modal.type === "sale") {
      if (!activeTable) return setFeedback({ type: "error", text: "Ative uma tabela de preços antes de registrar uma venda." });
      const salesUnitId = String(data.get("salesUnitId") ?? "");
      const customerId = String(data.get("customerId") ?? "");
      const soldPrice = Number(data.get("soldPrice"));
      const incentiveAmount = Math.max(0, Number(data.get("incentiveAmount") ?? 0));
      if (!salesUnitId || !customerId || !Number.isFinite(soldPrice) || soldPrice <= 0) return setFeedback({ type: "error", text: "Revise unidade, comprador e valor de venda." });
      return run(
        () => createSaleAction({
          salesUnitId,
          priceTableId: activeTable.id,
          soldPrice,
          incentiveAmount,
          commercialConditionSnapshot: {},
          parties: [{ customerId, role: "BUYER", ownershipPercentage: 100 }],
        }),
        "Venda registrada em rascunho para aprovação.",
      );
    }

    if (modal.type === "release") {
      const reason = String(data.get("reason") ?? "").trim();
      if (!reason) return setFeedback({ type: "error", text: "Informe o motivo da liberação." });
      return run(() => releaseSalesReservationAction(modal.reservationId, reason), "Reserva liberada.");
    }

    if (modal.type === "approve") {
      const number = String(data.get("contractNumber") ?? "").trim();
      const dueDate = String(data.get("dueDate") ?? "");
      if (!number || !dueDate) return setFeedback({ type: "error", text: "Informe o número do contrato e o vencimento." });
      return run(
        () => approveSaleAction({
          saleId: modal.saleId,
          contract: {
            number,
            title: `Contrato de venda · ${modal.unit}`,
            commercialCondition: {},
            effectiveFrom: new Date(),
          },
          installments: [{
            number: 1,
            nature: "BALANCE",
            dueDate: new Date(`${dueDate}T00:00:00Z`),
            amount: modal.soldPrice,
          }],
        }),
        "Venda aprovada, contrato criado e recebível gerado.",
      );
    }
  };

  const modalTitle = modal?.type === "customer" ? "Novo cliente"
    : modal?.type === "lead" ? "Novo lead"
    : modal?.type === "proposal" ? "Nova proposta"
    : modal?.type === "reservation" ? "Nova reserva"
    : modal?.type === "sale" ? "Registrar venda"
    : modal?.type === "release" ? "Liberar reserva"
    : modal?.type === "approve" ? "Aprovar venda e gerar contrato"
    : "";

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">OPERAÇÃO COMERCIAL</span>
          <h2>Cadastro, negociação e formalização</h2>
          <p>Clientes, leads, propostas, reservas e vendas são operados diretamente nesta tela e conectados ao financeiro.</p>
        </div>
      </div>

      <div className={styles.summary}>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Unidades disponíveis</span><strong className={styles.summaryValue}>{availableUnits.length}</strong></div>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Clientes</span><strong className={styles.summaryValue}>{workspace.customers.length}</strong></div>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Reservas em andamento</span><strong className={styles.summaryValue}>{pendingReservations.length}</strong></div>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Vendas aguardando aprovação</span><strong className={styles.summaryValue}>{draftSales.length}</strong></div>
      </div>

      {!activeTable && <div className={styles.notice}>Não há tabela de preços ativa. Propostas e vendas ficam indisponíveis até a ativação de uma tabela.</div>}
      {feedback && <div className={feedback.type === "error" ? styles.error : styles.success}>{feedback.text}</div>}

      <div className={styles.toolbar}>
        <div className={styles.toolbarActions}>
          <button className="button button-secondary" disabled={pending} onClick={() => setModal({ type: "customer" })}><UserPlus size={15}/> Novo cliente</button>
          <button className="button button-secondary" disabled={pending} onClick={() => setModal({ type: "lead" })}><ContactRound size={15}/> Novo lead</button>
          <button className="button button-secondary" disabled={pending || !activeTable} onClick={() => setModal({ type: "proposal" })}><BadgeDollarSign size={15}/> Nova proposta</button>
          <button className="button button-secondary" disabled={pending} onClick={() => setModal({ type: "reservation" })}><CalendarCheck2 size={15}/> Nova reserva</button>
        </div>
        <button className="button button-primary" disabled={pending || !activeTable} onClick={() => setModal({ type: "sale" })}><ShoppingCart size={15}/> Registrar venda</button>
      </div>

      <div className="data-table-scroll" style={{ marginTop: 18 }}>
        <table className="data-table">
          <thead><tr><th>Etapa</th><th>Registro</th><th>Situação</th><th>Próxima ação</th></tr></thead>
          <tbody>
            {pendingReservations.slice(0, 8).map((reservation) => (
              <tr key={reservation.id}>
                <td>Reserva</td>
                <td>{reservation.unit} · {reservation.customer}</td>
                <td className={styles.statusCell}>{RESERVATION_STATUS[reservation.status] ?? reservation.status}</td>
                <td>
                  <div className="panel-actions">
                    {reservation.status === "ACTIVE" && <button className="button button-secondary" disabled={pending} onClick={() => run(() => confirmSalesReservationAction(reservation.id), "Reserva confirmada.")}>Confirmar</button>}
                    <button className="button button-secondary" disabled={pending} onClick={() => setModal({ type: "release", reservationId: reservation.id, label: `${reservation.unit} · ${reservation.customer}` })}>Liberar</button>
                  </div>
                </td>
              </tr>
            ))}
            {draftSales.slice(0, 8).map((sale) => (
              <tr key={sale.id}>
                <td>Venda</td>
                <td>{sale.unit} · {sale.buyers.join(", ")}</td>
                <td className={styles.statusCell}>{SALE_STATUS[sale.status] ?? sale.status}</td>
                <td><button className="button button-primary" disabled={pending} onClick={() => setModal({ type: "approve", saleId: sale.id, unit: sale.unit, soldPrice: Number(sale.soldPrice) })}><FileCheck2 size={15}/> Aprovar e gerar recebível</button></td>
              </tr>
            ))}
            {pendingReservations.length === 0 && draftSales.length === 0 && <tr><td colSpan={4}>Nenhuma reserva ou venda aguardando ação.</td></tr>}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setModal(null); }}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-label={modalTitle}>
            <div className={styles.modalHeader}>
              <div><h3>{modalTitle}</h3><p>Preencha os dados necessários para concluir esta etapa do fluxo comercial.</p></div>
              <button className={styles.closeButton} type="button" aria-label="Fechar" disabled={pending} onClick={() => setModal(null)}>×</button>
            </div>
            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.formGrid}>
                {modal.type === "customer" && <>
                  <div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="customer-name">Nome / razão social</label><input id="customer-name" name="name" autoFocus required /></div>
                  <div className={styles.field}><label htmlFor="person-type">Tipo de pessoa</label><select id="person-type" name="personType" defaultValue="INDIVIDUAL"><option value="INDIVIDUAL">Pessoa física</option><option value="LEGAL_ENTITY">Pessoa jurídica</option></select></div>
                  <div className={styles.field}><label htmlFor="tax-id">CPF / CNPJ</label><input id="tax-id" name="taxId" /></div>
                  <div className={styles.field}><label htmlFor="email">E-mail</label><input id="email" name="email" type="email" /></div>
                  <div className={styles.field}><label htmlFor="phone">Telefone</label><input id="phone" name="phone" /></div>
                </>}

                {modal.type === "lead" && <>
                  <div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="lead-name">Nome do lead</label><input id="lead-name" name="name" autoFocus required /></div>
                  <div className={styles.field}><label htmlFor="lead-contact">Contato</label><input id="lead-contact" name="contact" required /></div>
                  <div className={styles.field}><label htmlFor="lead-source">Origem</label><input id="lead-source" name="source" defaultValue="Indicação" required /></div>
                  <div className={styles.field}><label htmlFor="lead-channel">Canal</label><input id="lead-channel" name="channel" placeholder="WhatsApp, portal, imobiliária..." /></div>
                </>}

                {modal.type === "proposal" && <>
                  <div className={styles.field}><label htmlFor="proposal-unit">Unidade</label><select id="proposal-unit" name="salesUnitId" required defaultValue=""><option value="" disabled>Selecione</option>{availableUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} · {UNIT_STATUS[unit.status] ?? unit.status}{unit.listPrice ? ` · ${currency.format(Number(unit.listPrice))}` : ""}</option>)}</select></div>
                  <div className={styles.field}><label htmlFor="proposal-customer">Cliente</label><select id="proposal-customer" name="customerId" required defaultValue=""><option value="" disabled>Selecione</option>{workspace.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></div>
                  <div className={styles.field}><label htmlFor="proposal-price">Preço proposto</label><input id="proposal-price" name="proposedPrice" type="number" min="0.01" step="0.01" required /></div>
                  <div className={styles.field}><label htmlFor="validity-days">Validade</label><input id="validity-days" name="validityDays" type="number" min="1" defaultValue="7" required /><span className={styles.help}>Quantidade de dias</span></div>
                </>}

                {modal.type === "reservation" && <>
                  <div className={styles.field}><label htmlFor="reservation-unit">Unidade</label><select id="reservation-unit" name="salesUnitId" required defaultValue=""><option value="" disabled>Selecione</option>{availableUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} · {UNIT_STATUS[unit.status] ?? unit.status}</option>)}</select></div>
                  <div className={styles.field}><label htmlFor="reservation-customer">Cliente</label><select id="reservation-customer" name="customerId" required defaultValue=""><option value="" disabled>Selecione</option>{workspace.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></div>
                  <div className={styles.field}><label htmlFor="reservation-days">Prazo da reserva</label><input id="reservation-days" name="days" type="number" min="1" defaultValue="3" required /><span className={styles.help}>Quantidade de dias</span></div>
                </>}

                {modal.type === "sale" && <>
                  <div className={styles.field}><label htmlFor="sale-unit">Unidade</label><select id="sale-unit" name="salesUnitId" required defaultValue=""><option value="" disabled>Selecione</option>{availableUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} · {UNIT_STATUS[unit.status] ?? unit.status}{unit.listPrice ? ` · ${currency.format(Number(unit.listPrice))}` : ""}</option>)}</select></div>
                  <div className={styles.field}><label htmlFor="sale-customer">Comprador</label><select id="sale-customer" name="customerId" required defaultValue=""><option value="" disabled>Selecione</option>{workspace.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></div>
                  <div className={styles.field}><label htmlFor="sold-price">Valor de venda</label><input id="sold-price" name="soldPrice" type="number" min="0.01" step="0.01" required /></div>
                  <div className={styles.field}><label htmlFor="incentive-amount">Incentivo comercial</label><input id="incentive-amount" name="incentiveAmount" type="number" min="0" step="0.01" defaultValue="0" /></div>
                </>}

                {modal.type === "release" && <div className={`${styles.field} ${styles.fieldFull}`}><label>Reserva</label><input value={modal.label} readOnly /><label htmlFor="release-reason">Motivo da liberação</label><textarea id="release-reason" name="reason" autoFocus required /></div>}

                {modal.type === "approve" && <>
                  <div className={`${styles.field} ${styles.fieldFull}`}><label>Venda</label><input value={`${modal.unit} · ${currency.format(modal.soldPrice)}`} readOnly /></div>
                  <div className={styles.field}><label htmlFor="contract-number">Número do contrato</label><input id="contract-number" name="contractNumber" defaultValue={`CV-${new Date().getFullYear()}-${modal.saleId.slice(-6).toUpperCase()}`} required /></div>
                  <div className={styles.field}><label htmlFor="due-date">Vencimento do recebível</label><input id="due-date" name="dueDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></div>
                  <div className={`${styles.field} ${styles.fieldFull}`}><span className={styles.help}>Esta ação aprova a venda no fluxo atual, cria o contrato e gera o recebível correspondente.</span></div>
                </>}
              </div>

              {feedback?.type === "error" && <div className={styles.error}>{feedback.text}</div>}
              <div className={styles.modalActions}>
                <button type="button" className="button button-secondary" disabled={pending} onClick={() => setModal(null)}>Cancelar</button>
                <button type="submit" className="button button-primary" disabled={pending}>{pending ? "Salvando..." : "Confirmar"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}