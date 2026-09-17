"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeDollarSign, CalendarCheck2, ContactRound, UserPlus } from "lucide-react";
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

export function SalesOperabilityPanel({ workspace }: { workspace: SalesWorkspaceView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const act = (op: () => Promise<{ ok: boolean; error?: string }>) => startTransition(async () => { const result = await op(); if (!result.ok) alert(result.error ?? "Não foi possível concluir."); else router.refresh(); });
  const activeTable = workspace.priceTables.find((table) => table.status === "ACTIVE");
  const findUnit = (code: string) => workspace.units.find((unit) => unit.code.toLowerCase() === code.trim().toLowerCase());
  const findCustomer = (name: string) => workspace.customers.find((customer) => customer.name.toLowerCase() === name.trim().toLowerCase());

  const newCustomer = () => { const name = prompt("Nome do cliente:"); if (!name) return; const personType = prompt("Tipo: INDIVIDUAL ou LEGAL_ENTITY", "INDIVIDUAL"); if (!personType || !["INDIVIDUAL", "LEGAL_ENTITY"].includes(personType)) return; const taxId = prompt("CPF/CNPJ (opcional):") || null; const email = prompt("E-mail (opcional):") || null; const phone = prompt("Telefone (opcional):") || null; act(() => createCommercialCustomerAction({ name, personType: personType as "INDIVIDUAL" | "LEGAL_ENTITY", taxId, email, phone })); };
  const newLead = () => { const name = prompt("Nome do lead:"); if (!name) return; const contact = prompt("Contato:"); if (!contact) return; const source = prompt("Origem:", "Indicação"); if (!source) return; const channel = prompt("Canal (opcional):") || null; act(() => createSalesLeadAction({ projectId: workspace.projectId, name, contact, source, channel })); };
  const newProposal = () => { if (!activeTable) return alert("Ative uma tabela de preços antes de criar proposta."); const code = prompt(`Código da unidade (${workspace.units.filter(u => ["DISPONIVEL","RESERVADA","EM_RESERVA"].includes(u.status)).slice(0,10).map(u=>u.code).join(", ")}):`); if (!code) return; const unit = findUnit(code); if (!unit) return alert("Unidade não encontrada."); const customerName = prompt(`Cliente (${workspace.customers.slice(0,10).map(c=>c.name).join(", ")}):`); if (!customerName) return; const customer = findCustomer(customerName); if (!customer) return alert("Cliente não encontrado."); const proposedPrice = Number(prompt("Preço proposto:", String(unit.listPrice ?? ""))); if (!Number.isFinite(proposedPrice) || proposedPrice <= 0) return; const days = Number(prompt("Validade em dias:", "7")); act(() => createSalesProposalAction({ salesUnitId: unit.id, customerId: customer.id, priceTableId: activeTable.id, proposedPrice, discountAmount: Math.max(0, Number(unit.listPrice ?? proposedPrice) - proposedPrice), paymentConditionSummary: {}, validUntil: new Date(Date.now() + Math.max(1, days) * 86400000) })); };
  const newReservation = () => { const code = prompt("Código da unidade:"); if (!code) return; const unit = findUnit(code); if (!unit) return alert("Unidade não encontrada."); const customerName = prompt("Nome exato do cliente:"); if (!customerName) return; const customer = findCustomer(customerName); if (!customer) return alert("Cliente não encontrado."); const days = Number(prompt("Reserva por quantos dias?", "3")); act(() => createSalesReservationAction({ salesUnitId: unit.id, customerId: customer.id, expiresAt: new Date(Date.now() + Math.max(1, days) * 86400000) })); };
  const newSale = () => { if (!activeTable) return alert("Ative uma tabela de preços antes de registrar venda."); const code = prompt("Código da unidade:"); if (!code) return; const unit = findUnit(code); if (!unit) return alert("Unidade não encontrada."); const customerName = prompt("Nome exato do comprador:"); if (!customerName) return; const customer = findCustomer(customerName); if (!customer) return alert("Cliente não encontrado."); const soldPrice = Number(prompt("Preço de venda:", String(unit.listPrice ?? ""))); if (!Number.isFinite(soldPrice) || soldPrice <= 0) return; act(() => createSaleAction({ salesUnitId: unit.id, priceTableId: activeTable.id, soldPrice, incentiveAmount: 0, commercialConditionSnapshot: {}, parties: [{ customerId: customer.id, role: "BUYER", ownershipPercentage: 100 }] })); };

  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">OPERAÇÃO HUMANA · 10C.1</span><h2>Operação Comercial</h2><p>Clientes, leads, propostas, reservas e vendas passam a nascer pela interface comercial.</p></div><div className="panel-actions"><button className="button button-secondary" disabled={pending} onClick={newCustomer}><UserPlus size={15}/> Cliente</button><button className="button button-secondary" disabled={pending} onClick={newLead}><ContactRound size={15}/> Lead</button><button className="button button-secondary" disabled={pending} onClick={newProposal}><BadgeDollarSign size={15}/> Proposta</button><button className="button button-secondary" disabled={pending} onClick={newReservation}><CalendarCheck2 size={15}/> Reserva</button><button className="button button-primary" disabled={pending} onClick={newSale}>Registrar venda</button></div></div>
    <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Fluxo</th><th>Registro</th><th>Status</th><th>Ação humana</th></tr></thead><tbody>
      {workspace.reservations.filter(r => ["ACTIVE","CONFIRMED"].includes(r.status)).slice(0,8).map(r => <tr key={r.id}><td>Reserva</td><td>{r.unit} · {r.customer}</td><td>{r.status}</td><td><div className="panel-actions">{r.status === "ACTIVE" && <button className="button button-secondary" disabled={pending} onClick={() => act(() => confirmSalesReservationAction(r.id))}>Confirmar</button>}<button className="button button-secondary" disabled={pending} onClick={() => { const reason = prompt("Motivo da liberação/cancelamento:"); if (reason) act(() => releaseSalesReservationAction(r.id, reason)); }}>Liberar</button></div></td></tr>)}
      {workspace.sales.filter(s => s.status === "DRAFT").slice(0,8).map(s => <tr key={s.id}><td>Venda</td><td>{s.unit} · {s.buyers.join(", ")}</td><td>{s.status}</td><td><button className="button button-primary" disabled={pending} onClick={() => { const number = prompt("Número do contrato:", `CV-${Date.now().toString().slice(-6)}`); if (!number) return; const due = prompt("Vencimento da parcela única (AAAA-MM-DD):", new Date().toISOString().slice(0,10)); if (!due) return; act(() => approveSaleAction({ saleId: s.id, contract: { number, title: `Contrato de venda · ${s.unit}`, commercialCondition: {}, effectiveFrom: new Date() }, installments: [{ number: 1, nature: "BALANCE", dueDate: new Date(`${due}T00:00:00Z`), amount: s.soldPrice }] })); }}>Aprovar e gerar recebível</button></td></tr>)}
      {workspace.reservations.filter(r => ["ACTIVE","CONFIRMED"].includes(r.status)).length === 0 && workspace.sales.filter(s => s.status === "DRAFT").length === 0 && <tr><td colSpan={4}>Nenhuma reserva ou venda aguardando ação.</td></tr>}
    </tbody></table></div>
  </section>;
}
