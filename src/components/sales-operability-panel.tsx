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
  renegotiateSalesPaymentPlanAction,
  rescindSaleAction,
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
  | { type: "renegotiate"; saleId: string; unit: string; soldPrice: number; received: number }
  | { type: "rescind"; saleId: string; unit: string; soldPrice: number; received: number }
  | null;

type ActionResult = { ok: boolean; error?: string };
type InstallmentNature = "DOWN_PAYMENT" | "MONTHLY" | "INTERMEDIATE" | "ANNUAL" | "KEYS" | "FINANCING" | "BALANCE" | "REINFORCEMENT" | "CUSTOM";
type Installment = { number: number; nature: InstallmentNature; dueDate: Date; amount: number; correctionRuleId?: string | null };

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const RESERVATION_STATUS: Record<string, string> = { ACTIVE: "Ativa", CONFIRMED: "Confirmada", RELEASED: "Liberada", EXPIRED: "Expirada", CANCELLED: "Cancelada", CONVERTED: "Convertida em venda" };
const SALE_STATUS: Record<string, string> = { DRAFT: "Rascunho", UNDER_APPROVAL: "Em aprovação", IN_APPROVAL: "Em aprovação", APPROVED: "Aprovada", CANCELLED: "Distratada", REVERSED: "Revertida" };
const UNIT_STATUS: Record<string, string> = { DISPONIVEL: "Disponível", EM_PROPOSTA: "Em proposta", EM_RESERVA: "Em reserva", RESERVADA: "Reservada", VENDIDA: "Vendida", BLOQUEADA: "Bloqueada", ENTREGUE: "Entregue", DISTRATADA: "Distratada", PERMUTA: "Permuta" };
const INDEX_LABELS: Record<string, string> = { INCC: "INCC", IPCA: "IPCA", IGP_M: "IGP-M", CDI: "CDI", SELIC: "Selic", TR: "TR", FIXED: "Taxa fixa", NONE: "Sem índice" };

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const amountOf = (data: FormData, key: string) => roundMoney(Math.max(0, Number(data.get(key) ?? 0) || 0));
const stringOf = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
const dateOf = (value: string) => new Date(`${value}T12:00:00.000Z`);
const addMonths = (value: string, months: number) => {
  const date = dateOf(value);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date;
};
const futureDate = (months: number) => {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
};

function buildPaymentPlan(data: FormData, targetAmount: number): { installments: Installment[]; error?: string } {
  const target = roundMoney(targetAmount);
  if (target <= 0) return { installments: [], error: "Não há saldo positivo para estruturar o plano de pagamento." };

  const installments: Installment[] = [];
  const correctionRuleId = stringOf(data, "correctionRuleId") || null;
  let number = 1;
  const push = (nature: InstallmentNature, amount: number, dueDate: Date, applyCorrection = true) => installments.push({
    number: number++,
    nature,
    dueDate,
    amount: roundMoney(amount),
    correctionRuleId: applyCorrection ? correctionRuleId : null,
  });

  const entryAmount = amountOf(data, "entryAmount");
  const entryDate = stringOf(data, "entryDate");
  if (entryAmount > 0) {
    if (!entryDate) return { installments: [], error: "Informe a data da entrada." };
    push("DOWN_PAYMENT", entryAmount, dateOf(entryDate), false);
  }

  const monthlyCount = Math.max(0, Math.trunc(Number(data.get("monthlyCount") ?? 0) || 0));
  const monthlyAmount = amountOf(data, "monthlyAmount");
  const monthlyStart = stringOf(data, "monthlyStart");
  if (monthlyCount > 0 || monthlyAmount > 0) {
    if (monthlyCount <= 0 || monthlyAmount <= 0 || !monthlyStart) return { installments: [], error: "Para as mensais, informe quantidade, valor e primeira data." };
    for (let index = 0; index < monthlyCount; index += 1) push("MONTHLY", monthlyAmount, addMonths(monthlyStart, index));
  }

  const intermediateCount = Math.max(0, Math.trunc(Number(data.get("intermediateCount") ?? 0) || 0));
  const intermediateAmount = amountOf(data, "intermediateAmount");
  const intermediateStart = stringOf(data, "intermediateStart");
  const intermediateInterval = Math.max(1, Math.trunc(Number(data.get("intermediateInterval") ?? 6) || 6));
  if (intermediateCount > 0 || intermediateAmount > 0) {
    if (intermediateCount <= 0 || intermediateAmount <= 0 || !intermediateStart) return { installments: [], error: "Para as intermediárias, informe quantidade, valor e primeira data." };
    for (let index = 0; index < intermediateCount; index += 1) push("INTERMEDIATE", intermediateAmount, addMonths(intermediateStart, index * intermediateInterval));
  }

  const keysAmount = amountOf(data, "keysAmount");
  const keysDate = stringOf(data, "keysDate");
  if (keysAmount > 0) {
    if (!keysDate) return { installments: [], error: "Informe a data da parcela de chaves." };
    push("KEYS", keysAmount, dateOf(keysDate));
  }

  const financingAmount = amountOf(data, "financingAmount");
  const financingDate = stringOf(data, "financingDate");
  if (financingAmount > 0) {
    if (!financingDate) return { installments: [], error: "Informe a data prevista do repasse/financiamento." };
    push("FINANCING", financingAmount, dateOf(financingDate));
  }

  const structured = roundMoney(installments.reduce((sum, item) => sum + item.amount, 0));
  if (structured > target) return { installments: [], error: `O plano informado soma ${currency.format(structured)}, acima do valor de ${currency.format(target)}.` };

  const remainder = roundMoney(target - structured);
  if (remainder > 0) {
    const balanceDate = stringOf(data, "balanceDate");
    if (!balanceDate) return { installments: [], error: `Ainda faltam ${currency.format(remainder)}. Informe a data do saldo final ou ajuste as parcelas.` };
    push("BALANCE", remainder, dateOf(balanceDate));
  }

  return { installments };
}

function PaymentPlanFields({ targetAmount, correctionRules }: { targetAmount: number; correctionRules: SalesWorkspaceView["correctionRules"] }) {
  return <>
    <div className={`${styles.field} ${styles.fieldFull}`}><span className={styles.help}>Valor a estruturar: <strong>{currency.format(targetAmount)}</strong>. Se a soma informada ficar abaixo desse valor, a diferença será criada como saldo final.</span></div>
    <div className={`${styles.field} ${styles.fieldFull}`}>
      <label htmlFor="correction-rule">Correção monetária das parcelas futuras</label>
      <select id="correction-rule" name="correctionRuleId" defaultValue="" disabled={correctionRules.length === 0}>
        <option value="">{correctionRules.length === 0 ? "Nenhuma regra ativa cadastrada" : "Sem correção monetária"}</option>
        {correctionRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name} · {INDEX_LABELS[rule.indexName] ?? rule.indexName}{rule.lagMonths ? ` · defasagem ${rule.lagMonths}m` : ""}</option>)}
      </select>
      <span className={styles.help}>A regra escolhida é vinculada às mensais, intermediárias, chaves, financiamento e saldo final. A entrada permanece sem correção.</span>
    </div>
    <div className={styles.field}><label htmlFor="entry-amount">Entrada</label><input id="entry-amount" name="entryAmount" type="number" min="0" step="0.01" defaultValue="0" /></div>
    <div className={styles.field}><label htmlFor="entry-date">Data da entrada</label><input id="entry-date" name="entryDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
    <div className={styles.field}><label htmlFor="monthly-count">Mensais · quantidade</label><input id="monthly-count" name="monthlyCount" type="number" min="0" step="1" defaultValue="0" /></div>
    <div className={styles.field}><label htmlFor="monthly-amount">Mensais · valor unitário</label><input id="monthly-amount" name="monthlyAmount" type="number" min="0" step="0.01" defaultValue="0" /></div>
    <div className={styles.field}><label htmlFor="monthly-start">Primeira mensal</label><input id="monthly-start" name="monthlyStart" type="date" defaultValue={futureDate(1)} /></div>
    <div className={styles.field}><label htmlFor="intermediate-count">Intermediárias · quantidade</label><input id="intermediate-count" name="intermediateCount" type="number" min="0" step="1" defaultValue="0" /></div>
    <div className={styles.field}><label htmlFor="intermediate-amount">Intermediárias · valor unitário</label><input id="intermediate-amount" name="intermediateAmount" type="number" min="0" step="0.01" defaultValue="0" /></div>
    <div className={styles.field}><label htmlFor="intermediate-start">Primeira intermediária</label><input id="intermediate-start" name="intermediateStart" type="date" defaultValue={futureDate(6)} /></div>
    <div className={styles.field}><label htmlFor="intermediate-interval">Intervalo das intermediárias</label><input id="intermediate-interval" name="intermediateInterval" type="number" min="1" step="1" defaultValue="6" /><span className={styles.help}>Em meses</span></div>
    <div className={styles.field}><label htmlFor="keys-amount">Chaves</label><input id="keys-amount" name="keysAmount" type="number" min="0" step="0.01" defaultValue="0" /></div>
    <div className={styles.field}><label htmlFor="keys-date">Data das chaves</label><input id="keys-date" name="keysDate" type="date" defaultValue={futureDate(24)} /></div>
    <div className={styles.field}><label htmlFor="financing-amount">Repasse / financiamento</label><input id="financing-amount" name="financingAmount" type="number" min="0" step="0.01" defaultValue="0" /></div>
    <div className={styles.field}><label htmlFor="financing-date">Data prevista do repasse</label><input id="financing-date" name="financingDate" type="date" defaultValue={futureDate(24)} /></div>
    <div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="balance-date">Data do saldo final</label><input id="balance-date" name="balanceDate" type="date" defaultValue={futureDate(24)} /><span className={styles.help}>Usada automaticamente somente se restar saldo após entrada, mensais, intermediárias, chaves e financiamento.</span></div>
  </>;
}

export function SalesOperabilityPanel({ workspace }: { workspace: SalesWorkspaceView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [modal, setModal] = useState<ModalState>(null);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const activeTable = workspace.priceTables.find((table) => table.status === "ACTIVE");
  const availableUnits = useMemo(() => workspace.units.filter((unit) => ["DISPONIVEL", "EM_PROPOSTA", "EM_RESERVA", "RESERVADA"].includes(unit.status)), [workspace.units]);
  const pendingReservations = workspace.reservations.filter((reservation) => ["ACTIVE", "CONFIRMED"].includes(reservation.status));
  const draftSales = workspace.sales.filter((sale) => sale.status === "DRAFT");
  const approvedSales = workspace.sales.filter((sale) => sale.status === "APPROVED");

  const run = (op: () => Promise<ActionResult>, successMessage: string) => {
    setFeedback(null);
    startTransition(async () => {
      const result = await op();
      if (!result.ok) { setFeedback({ type: "error", text: result.error ?? "Não foi possível concluir a operação." }); return; }
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
      const name = stringOf(data, "name");
      const personType = String(data.get("personType") ?? "INDIVIDUAL") as "INDIVIDUAL" | "LEGAL_ENTITY";
      const taxId = stringOf(data, "taxId") || null;
      const email = stringOf(data, "email") || null;
      const phone = stringOf(data, "phone") || null;
      if (!name) return setFeedback({ type: "error", text: "Informe o nome do cliente." });
      return run(() => createCommercialCustomerAction({ name, personType, taxId, email, phone }), "Cliente cadastrado com sucesso.");
    }

    if (modal.type === "lead") {
      const name = stringOf(data, "name");
      const contact = stringOf(data, "contact");
      const source = stringOf(data, "source");
      const channel = stringOf(data, "channel") || null;
      if (!name || !contact || !source) return setFeedback({ type: "error", text: "Preencha nome, contato e origem do lead." });
      return run(() => createSalesLeadAction({ projectId: workspace.projectId, name, contact, source, channel }), "Lead cadastrado com sucesso.");
    }

    if (modal.type === "proposal") {
      if (!activeTable) return setFeedback({ type: "error", text: "Ative uma tabela de preços antes de criar propostas." });
      const salesUnitId = stringOf(data, "salesUnitId");
      const customerId = stringOf(data, "customerId");
      const unit = getUnit(salesUnitId);
      const proposedPrice = Number(data.get("proposedPrice"));
      const validityDays = Math.max(1, Number(data.get("validityDays") ?? 7));
      if (!unit || !customerId || !Number.isFinite(proposedPrice) || proposedPrice <= 0) return setFeedback({ type: "error", text: "Revise unidade, cliente e preço da proposta." });
      const listPrice = Number(unit.listPrice ?? proposedPrice);
      return run(() => createSalesProposalAction({ salesUnitId, customerId, priceTableId: activeTable.id, proposedPrice, discountAmount: Math.max(0, listPrice - proposedPrice), paymentConditionSummary: {}, validUntil: new Date(Date.now() + validityDays * 86400000) }), "Proposta comercial criada.");
    }

    if (modal.type === "reservation") {
      const salesUnitId = stringOf(data, "salesUnitId");
      const customerId = stringOf(data, "customerId");
      const days = Math.max(1, Number(data.get("days") ?? 3));
      if (!salesUnitId || !customerId) return setFeedback({ type: "error", text: "Selecione unidade e cliente." });
      return run(() => createSalesReservationAction({ salesUnitId, customerId, expiresAt: new Date(Date.now() + days * 86400000) }), "Reserva registrada.");
    }

    if (modal.type === "sale") {
      if (!activeTable) return setFeedback({ type: "error", text: "Ative uma tabela de preços antes de registrar uma venda." });
      const salesUnitId = stringOf(data, "salesUnitId");
      const customerId = stringOf(data, "customerId");
      const coBuyerId = stringOf(data, "coBuyerId");
      const soldPrice = Number(data.get("soldPrice"));
      const incentiveAmount = Math.max(0, Number(data.get("incentiveAmount") ?? 0));
      const primaryOwnership = coBuyerId ? Number(data.get("primaryOwnership") ?? 50) : 100;
      const coBuyerOwnership = coBuyerId ? Number(data.get("coBuyerOwnership") ?? 50) : 0;
      if (!salesUnitId || !customerId || !Number.isFinite(soldPrice) || soldPrice <= 0) return setFeedback({ type: "error", text: "Revise unidade, comprador e valor de venda." });
      if (coBuyerId && coBuyerId === customerId) return setFeedback({ type: "error", text: "Comprador principal e co-comprador precisam ser clientes diferentes." });
      if (coBuyerId && roundMoney(primaryOwnership + coBuyerOwnership) !== 100) return setFeedback({ type: "error", text: "Os percentuais de participação dos compradores devem somar 100%." });
      const parties = [{ customerId, role: "BUYER" as const, ownershipPercentage: primaryOwnership }, ...(coBuyerId ? [{ customerId: coBuyerId, role: "CO_BUYER" as const, ownershipPercentage: coBuyerOwnership }] : [])];
      return run(() => createSaleAction({ salesUnitId, priceTableId: activeTable.id, soldPrice, incentiveAmount, commercialConditionSnapshot: {}, parties }), "Venda registrada em rascunho para aprovação.");
    }

    if (modal.type === "release") {
      const reason = stringOf(data, "reason");
      if (!reason) return setFeedback({ type: "error", text: "Informe o motivo da liberação." });
      return run(() => releaseSalesReservationAction(modal.reservationId, reason), "Reserva liberada.");
    }

    if (modal.type === "approve") {
      const number = stringOf(data, "contractNumber");
      const plan = buildPaymentPlan(data, modal.soldPrice);
      if (!number) return setFeedback({ type: "error", text: "Informe o número do contrato." });
      if (plan.error) return setFeedback({ type: "error", text: plan.error });
      return run(() => approveSaleAction({ saleId: modal.saleId, contract: { number, title: `Contrato de venda · ${modal.unit}`, commercialCondition: { paymentPlanStructure: "REAL_ESTATE" }, effectiveFrom: new Date() }, installments: plan.installments }), `Venda aprovada com ${plan.installments.length} parcela(s), contrato criado e recebíveis gerados.`);
    }

    if (modal.type === "renegotiate") {
      const reason = stringOf(data, "reason");
      const remaining = roundMoney(Math.max(0, modal.soldPrice - modal.received));
      const plan = buildPaymentPlan(data, remaining);
      if (!reason) return setFeedback({ type: "error", text: "Informe o motivo da renegociação." });
      if (plan.error) return setFeedback({ type: "error", text: plan.error });
      return run(() => renegotiateSalesPaymentPlanAction({ saleId: modal.saleId, reason, installments: plan.installments }), `Plano renegociado com ${plan.installments.length} parcela(s) e recebíveis atualizados.`);
    }

    if (modal.type === "rescind") {
      const reason = stringOf(data, "reason");
      const retentionPercent = Number(data.get("retentionPercent") ?? 0);
      if (!reason) return setFeedback({ type: "error", text: "Informe o motivo do distrato." });
      if (!Number.isFinite(retentionPercent) || retentionPercent < 0 || retentionPercent > 100) return setFeedback({ type: "error", text: "A retenção precisa estar entre 0% e 100%." });
      return run(() => rescindSaleAction({ saleId: modal.saleId, reason, retentionRate: retentionPercent / 100 }), "Distrato processado; parcelas abertas e efeitos financeiros foram tratados pelo fluxo comercial-financeiro.");
    }
  };

  const modalTitle = modal?.type === "customer" ? "Novo cliente"
    : modal?.type === "lead" ? "Novo lead"
    : modal?.type === "proposal" ? "Nova proposta"
    : modal?.type === "reservation" ? "Nova reserva"
    : modal?.type === "sale" ? "Registrar venda"
    : modal?.type === "release" ? "Liberar reserva"
    : modal?.type === "approve" ? "Aprovar venda e estruturar recebíveis"
    : modal?.type === "renegotiate" ? "Renegociar plano de pagamento"
    : modal?.type === "rescind" ? "Registrar distrato"
    : "";

  return (
    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">OPERAÇÃO COMERCIAL</span><h2>Cadastro, negociação e formalização</h2><p>Clientes, leads, propostas, reservas, vendas, contratos e planos de pagamento são operados diretamente nesta tela e conectados ao Financeiro.</p></div></div>

      <div className={styles.summary}>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Unidades disponíveis</span><strong className={styles.summaryValue}>{availableUnits.length}</strong></div>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Clientes</span><strong className={styles.summaryValue}>{workspace.customers.length}</strong></div>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Reservas em andamento</span><strong className={styles.summaryValue}>{pendingReservations.length}</strong></div>
        <div className={styles.summaryCard}><span className={styles.summaryLabel}>Vendas aprovadas</span><strong className={styles.summaryValue}>{approvedSales.length}</strong></div>
      </div>

      {!activeTable && <div className={styles.notice}>Não há tabela de preços ativa. Propostas e vendas ficam indisponíveis até a ativação de uma tabela.</div>}
      {feedback && <div className={feedback.type === "error" ? styles.error : styles.success}>{feedback.text}</div>}

      <div className={styles.toolbar}><div className={styles.toolbarActions}>
        <button className="button button-secondary" disabled={pending} onClick={() => setModal({ type: "customer" })}><UserPlus size={15}/> Novo cliente</button>
        <button className="button button-secondary" disabled={pending} onClick={() => setModal({ type: "lead" })}><ContactRound size={15}/> Novo lead</button>
        <button className="button button-secondary" disabled={pending || !activeTable} onClick={() => setModal({ type: "proposal" })}><BadgeDollarSign size={15}/> Nova proposta</button>
        <button className="button button-secondary" disabled={pending} onClick={() => setModal({ type: "reservation" })}><CalendarCheck2 size={15}/> Nova reserva</button>
      </div><button className="button button-primary" disabled={pending || !activeTable} onClick={() => setModal({ type: "sale" })}><ShoppingCart size={15}/> Registrar venda</button></div>

      <div className="data-table-scroll" style={{ marginTop: 18 }}><table className="data-table"><thead><tr><th>Etapa</th><th>Registro</th><th>Situação</th><th>Próxima ação</th></tr></thead><tbody>
        {pendingReservations.slice(0, 8).map((reservation) => <tr key={reservation.id}><td>Reserva</td><td>{reservation.unit} · {reservation.customer}</td><td className={styles.statusCell}>{RESERVATION_STATUS[reservation.status] ?? reservation.status}</td><td><div className="panel-actions">{reservation.status === "ACTIVE" && <button className="button button-secondary" disabled={pending} onClick={() => run(() => confirmSalesReservationAction(reservation.id), "Reserva confirmada.")}>Confirmar</button>}<button className="button button-secondary" disabled={pending} onClick={() => setModal({ type: "release", reservationId: reservation.id, label: `${reservation.unit} · ${reservation.customer}` })}>Liberar</button></div></td></tr>)}
        {draftSales.slice(0, 8).map((sale) => <tr key={sale.id}><td>Venda</td><td>{sale.unit} · {sale.buyers.join(", ")}</td><td className={styles.statusCell}>{SALE_STATUS[sale.status] ?? sale.status}</td><td><button className="button button-primary" disabled={pending} onClick={() => setModal({ type: "approve", saleId: sale.id, unit: sale.unit, soldPrice: Number(sale.soldPrice) })}><FileCheck2 size={15}/> Aprovar e montar plano</button></td></tr>)}
        {approvedSales.slice(0, 12).map((sale) => <tr key={`approved-${sale.id}`}><td>Contrato</td><td><strong>{sale.unit}</strong> · {sale.buyers.join(", ")}<small>{sale.contractNumber ? `Contrato ${sale.contractNumber} · ` : ""}{sale.installments} parcela(s) · recebido {currency.format(Number(sale.received))}</small></td><td className={styles.statusCell}>Aprovada</td><td><div className="panel-actions"><button className="button button-secondary" disabled={pending || Number(sale.received) >= Number(sale.soldPrice)} onClick={() => setModal({ type: "renegotiate", saleId: sale.id, unit: sale.unit, soldPrice: Number(sale.soldPrice), received: Number(sale.received) })}>Renegociar</button><button className="button button-secondary" disabled={pending} onClick={() => setModal({ type: "rescind", saleId: sale.id, unit: sale.unit, soldPrice: Number(sale.soldPrice), received: Number(sale.received) })}>Distrato</button></div></td></tr>)}
        {pendingReservations.length === 0 && draftSales.length === 0 && approvedSales.length === 0 && <tr><td colSpan={4}>Nenhuma reserva ou venda registrada.</td></tr>}
      </tbody></table></div>

      {modal && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setModal(null); }}><div className={styles.modal} role="dialog" aria-modal="true" aria-label={modalTitle}><div className={styles.modalHeader}><div><h3>{modalTitle}</h3><p>Preencha os dados necessários para concluir esta etapa do fluxo comercial.</p></div><button className={styles.closeButton} type="button" aria-label="Fechar" disabled={pending} onClick={() => setModal(null)}>×</button></div><form className={styles.form} onSubmit={handleSubmit}><div className={styles.formGrid}>
        {modal.type === "customer" && <><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="customer-name">Nome / razão social</label><input id="customer-name" name="name" autoFocus required /></div><div className={styles.field}><label htmlFor="person-type">Tipo de pessoa</label><select id="person-type" name="personType" defaultValue="INDIVIDUAL"><option value="INDIVIDUAL">Pessoa física</option><option value="LEGAL_ENTITY">Pessoa jurídica</option></select></div><div className={styles.field}><label htmlFor="tax-id">CPF / CNPJ</label><input id="tax-id" name="taxId" /></div><div className={styles.field}><label htmlFor="email">E-mail</label><input id="email" name="email" type="email" /></div><div className={styles.field}><label htmlFor="phone">Telefone</label><input id="phone" name="phone" /></div></>}
        {modal.type === "lead" && <><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="lead-name">Nome do lead</label><input id="lead-name" name="name" autoFocus required /></div><div className={styles.field}><label htmlFor="lead-contact">Contato</label><input id="lead-contact" name="contact" required /></div><div className={styles.field}><label htmlFor="lead-source">Origem</label><input id="lead-source" name="source" defaultValue="Indicação" required /></div><div className={styles.field}><label htmlFor="lead-channel">Canal</label><input id="lead-channel" name="channel" placeholder="WhatsApp, portal, imobiliária..." /></div></>}
        {modal.type === "proposal" && <><div className={styles.field}><label htmlFor="proposal-unit">Unidade</label><select id="proposal-unit" name="salesUnitId" required defaultValue=""><option value="" disabled>Selecione</option>{availableUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} · {UNIT_STATUS[unit.status] ?? unit.status}{unit.listPrice ? ` · ${currency.format(Number(unit.listPrice))}` : ""}</option>)}</select></div><div className={styles.field}><label htmlFor="proposal-customer">Cliente</label><select id="proposal-customer" name="customerId" required defaultValue=""><option value="" disabled>Selecione</option>{workspace.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></div><div className={styles.field}><label htmlFor="proposal-price">Preço proposto</label><input id="proposal-price" name="proposedPrice" type="number" min="0.01" step="0.01" required /></div><div className={styles.field}><label htmlFor="validity-days">Validade</label><input id="validity-days" name="validityDays" type="number" min="1" defaultValue="7" required /><span className={styles.help}>Quantidade de dias</span></div></>}
        {modal.type === "reservation" && <><div className={styles.field}><label htmlFor="reservation-unit">Unidade</label><select id="reservation-unit" name="salesUnitId" required defaultValue=""><option value="" disabled>Selecione</option>{availableUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} · {UNIT_STATUS[unit.status] ?? unit.status}</option>)}</select></div><div className={styles.field}><label htmlFor="reservation-customer">Cliente</label><select id="reservation-customer" name="customerId" required defaultValue=""><option value="" disabled>Selecione</option>{workspace.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></div><div className={styles.field}><label htmlFor="reservation-days">Prazo da reserva</label><input id="reservation-days" name="days" type="number" min="1" defaultValue="3" required /><span className={styles.help}>Quantidade de dias</span></div></>}
        {modal.type === "sale" && <><div className={styles.field}><label htmlFor="sale-unit">Unidade</label><select id="sale-unit" name="salesUnitId" required defaultValue=""><option value="" disabled>Selecione</option>{availableUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} · {UNIT_STATUS[unit.status] ?? unit.status}{unit.listPrice ? ` · ${currency.format(Number(unit.listPrice))}` : ""}</option>)}</select></div><div className={styles.field}><label htmlFor="sale-customer">Comprador principal</label><select id="sale-customer" name="customerId" required defaultValue=""><option value="" disabled>Selecione</option>{workspace.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></div><div className={styles.field}><label htmlFor="co-buyer">Co-comprador</label><select id="co-buyer" name="coBuyerId" defaultValue=""><option value="">Sem co-comprador</option>{workspace.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></div><div className={styles.field}><label htmlFor="primary-ownership">Participação principal (%)</label><input id="primary-ownership" name="primaryOwnership" type="number" min="0" max="100" step="0.01" defaultValue="50" /></div><div className={styles.field}><label htmlFor="co-buyer-ownership">Participação co-comprador (%)</label><input id="co-buyer-ownership" name="coBuyerOwnership" type="number" min="0" max="100" step="0.01" defaultValue="50" /></div><div className={styles.field}><label htmlFor="sold-price">Valor de venda</label><input id="sold-price" name="soldPrice" type="number" min="0.01" step="0.01" required /></div><div className={styles.field}><label htmlFor="incentive-amount">Incentivo comercial</label><input id="incentive-amount" name="incentiveAmount" type="number" min="0" step="0.01" defaultValue="0" /></div></>}
        {modal.type === "release" && <div className={`${styles.field} ${styles.fieldFull}`}><label>Reserva</label><input value={modal.label} readOnly /><label htmlFor="release-reason">Motivo da liberação</label><textarea id="release-reason" name="reason" autoFocus required /></div>}
        {modal.type === "approve" && <><div className={`${styles.field} ${styles.fieldFull}`}><label>Venda</label><input value={`${modal.unit} · ${currency.format(modal.soldPrice)}`} readOnly /></div><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="contract-number">Número do contrato</label><input id="contract-number" name="contractNumber" defaultValue={`CV-${new Date().getFullYear()}-${modal.saleId.slice(-6).toUpperCase()}`} required /></div><PaymentPlanFields targetAmount={modal.soldPrice} correctionRules={workspace.correctionRules} /></>}
        {modal.type === "renegotiate" && <><div className={`${styles.field} ${styles.fieldFull}`}><label>Venda</label><input value={`${modal.unit} · vendido ${currency.format(modal.soldPrice)} · recebido ${currency.format(modal.received)}`} readOnly /></div><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="renegotiation-reason">Motivo da renegociação</label><textarea id="renegotiation-reason" name="reason" autoFocus required /></div><PaymentPlanFields targetAmount={roundMoney(Math.max(0, modal.soldPrice - modal.received))} correctionRules={workspace.correctionRules} /></>}
        {modal.type === "rescind" && <><div className={`${styles.field} ${styles.fieldFull}`}><label>Venda</label><input value={`${modal.unit} · vendido ${currency.format(modal.soldPrice)} · recebido ${currency.format(modal.received)}`} readOnly /></div><div className={`${styles.field} ${styles.fieldFull}`}><label htmlFor="rescind-reason">Motivo do distrato</label><textarea id="rescind-reason" name="reason" autoFocus required /></div><div className={styles.field}><label htmlFor="retention-percent">Retenção sobre o valor recebido (%)</label><input id="retention-percent" name="retentionPercent" type="number" min="0" max="100" step="0.01" defaultValue="0" /></div><div className={`${styles.field} ${styles.fieldFull}`}><span className={styles.help}>O motor calcula a retenção e eventual devolução sobre valores efetivamente pagos; parcelas abertas são canceladas pelo fluxo de distrato.</span></div></>}
      </div>{feedback?.type === "error" && <div className={styles.error}>{feedback.text}</div>}<div className={styles.modalActions}><button type="button" className="button button-secondary" disabled={pending} onClick={() => setModal(null)}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending}>{pending ? "Salvando..." : "Confirmar"}</button></div></form></div></div>}
    </section>
  );
}
