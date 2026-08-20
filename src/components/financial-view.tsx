"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Banknote, CalendarClock, CircleDollarSign, Landmark, Plus, TrendingDown, Wallet } from "lucide-react";
import type { FinancialWorkspaceView } from "@/application/financial-ops/financial-service";
import {
  approveIntercompanyTransactionAction,
  confirmReconciliationAction,
  createBankAccountAction,
  createIntercompanyTransactionAction,
  createPayableAccountAction,
  createReceivableAccountAction,
  importBankStatementCsvAction,
  registerPayablePaymentAction,
  registerReceivablePaymentAction,
  rejectReconciliationAction,
  suggestReconciliationsAction,
  transitionPayableInstallmentAction,
  transitionReceivableInstallmentAction,
} from "@/app/actions/financial";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const month = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" });
const today = () => new Date().toISOString().slice(0, 10);

const restrictionLabel: Record<string, string> = { FREE: "Livre", RESTRICTED: "Restrita" };
const bankAccountTypeLabel: Record<string, string> = { OPERATIONAL: "Operacional", COLLECTIONS: "Recebimentos", PAYMENTS: "Pagamentos", FUNDING: "Funding", LINKED: "Vinculada", ESCROW: "Escrow", RESERVE: "Reserva", INVESTMENT: "Aplicação", OTHER: "Outra" };
const payableStatusLabel: Record<string, string> = { PREVISTA: "Prevista", PROGRAMADA: "Programada", AGUARDANDO_APROVACAO: "Aguardando aprovação", APROVADA: "Aprovada", PARCIALMENTE_PAGA: "Parcialmente paga", PAGA: "Paga", CANCELADA: "Cancelada" };
const receivableStatusLabel: Record<string, string> = { PREVISTA: "Prevista", EMITIDA: "Emitida", PARCIALMENTE_RECEBIDA: "Parcialmente recebida", RECEBIDA: "Recebida", RENEGOCIADA: "Renegociada", CANCELADA: "Cancelada" };

type SectionKey = "tesouraria" | "pagar" | "receber" | "conciliacao" | "intercompany" | "projecao";
type PayableItem = FinancialWorkspaceView["payables"]["openItems"][number];
type ReceivableItem = FinancialWorkspaceView["receivables"]["openItems"][number];

export function FinancialView({ workspace }: { workspace: FinancialWorkspaceView }) {
  const router = useRouter();
  const [section, setSection] = useState<SectionKey>("tesouraria");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showBankForm, setShowBankForm] = useState(false);
  const [showPayableForm, setShowPayableForm] = useState(false);
  const [showReceivableForm, setShowReceivableForm] = useState(false);
  const [showIntercompanyForm, setShowIntercompanyForm] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [csvAccount, setCsvAccount] = useState(workspace.bankAccounts[0]?.id ?? "");
  const [csvContent, setCsvContent] = useState("");

  const maxTotal = useMemo(() => Math.max(1, ...workspace.updatedProjection.map((row) => row.total)), [workspace.updatedProjection]);

  async function withFeedback<T>(operation: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, successMessage: (data: T) => string) {
    setBusy(true); setFeedback(null);
    const result = await operation();
    setBusy(false);
    if (!result.ok) { setFeedback(result.error); return null; }
    setFeedback(successMessage(result.data));
    router.refresh();
    return result.data;
  }

  async function submitBankAccount(form: FormData) {
    await withFeedback(() => createBankAccountAction({
      companyId: workspace.companyId ?? "", projectId: workspace.projectId,
      institutionName: String(form.get("institutionName")), agency: String(form.get("agency")), accountNumber: String(form.get("accountNumber")),
      holderName: String(form.get("holderName")), type: form.get("type") as never, restriction: form.get("restriction") as never, openingBalance: String(form.get("openingBalance") || "0"),
    }), () => "Conta bancária cadastrada.");
    setShowBankForm(false);
  }

  async function submitPayableAccount(form: FormData) {
    const total = Number(form.get("totalAmount"));
    const count = Math.max(1, Number(form.get("installmentsCount") || 1));
    const firstDueDate = new Date(`${form.get("firstDueDate")}T00:00:00.000Z`);
    const perInstallment = Math.round((total / count) * 100) / 100;
    const installments = Array.from({ length: count }, (_, index) => {
      const due = new Date(firstDueDate); due.setUTCMonth(due.getUTCMonth() + index);
      const amount = index === count - 1 ? Math.round((total - perInstallment * (count - 1)) * 100) / 100 : perInstallment;
      return { number: index + 1, dueDate: due, amount: String(amount) };
    });
    const supplierId = String(form.get("supplierId") || "");
    await withFeedback(() => createPayableAccountAction({
      projectId: workspace.projectId, description: String(form.get("description")), origin: "MANUAL",
      competenceMonth: new Date(`${form.get("competenceMonth")}T00:00:00.000Z`), supplierId: supplierId || null, installments,
    }), () => "Conta a pagar criada.");
    setShowPayableForm(false);
  }

  async function submitReceivableAccount(form: FormData) {
    const total = Number(form.get("totalAmount"));
    const count = Math.max(1, Number(form.get("installmentsCount") || 1));
    const firstDueDate = new Date(`${form.get("firstDueDate")}T00:00:00.000Z`);
    const perInstallment = Math.round((total / count) * 100) / 100;
    const installments = Array.from({ length: count }, (_, index) => {
      const due = new Date(firstDueDate); due.setUTCMonth(due.getUTCMonth() + index);
      const amount = index === count - 1 ? Math.round((total - perInstallment * (count - 1)) * 100) / 100 : perInstallment;
      return { number: index + 1, dueDate: due, amount: String(amount) };
    });
    const customerId = String(form.get("customerId") || "");
    await withFeedback(() => createReceivableAccountAction({
      projectId: workspace.projectId, description: String(form.get("description")), origin: "SALE",
      competenceMonth: new Date(`${form.get("competenceMonth")}T00:00:00.000Z`), customerId: customerId || null, installments,
    }), () => "Conta a receber criada.");
    setShowReceivableForm(false);
  }

  async function submitIntercompany(form: FormData) {
    const toCompanyId = String(form.get("toCompanyId"));
    await withFeedback(() => createIntercompanyTransactionAction({
      fromCompanyId: String(form.get("fromCompanyId")), toCompanyId,
      toProjectId: toCompanyId === workspace.companyId ? workspace.projectId : null,
      amount: String(form.get("amount")), occurredAt: new Date(`${form.get("occurredAt")}T00:00:00.000Z`),
      nature: form.get("nature") as never, description: String(form.get("description") || ""),
    }), () => "Movimentação intercompany registrada.");
    setShowIntercompanyForm(false);
  }

  async function payInstallment(item: PayableItem, form: FormData) {
    await withFeedback(() => registerPayablePaymentAction({
      installmentId: item.id, bankAccountId: String(form.get("bankAccountId")), amount: String(form.get("amount")),
      method: "TRANSFER", paidAt: new Date(`${form.get("paidAt")}T00:00:00.000Z`),
    }), () => "Pagamento registrado.");
    setPayingId(null);
  }

  async function receiveInstallment(item: ReceivableItem, form: FormData) {
    await withFeedback(() => registerReceivablePaymentAction({
      installmentId: item.id, bankAccountId: String(form.get("bankAccountId")), amount: String(form.get("amount")),
      method: "PIX", receivedAt: new Date(`${form.get("receivedAt")}T00:00:00.000Z`),
    }), () => "Recebimento registrado.");
    setReceivingId(null);
  }

  async function importCsv() {
    if (!csvAccount || !csvContent.trim()) return;
    await withFeedback(() => importBankStatementCsvAction(csvAccount, csvContent), (data) => `Importação concluída: ${data.accepted} aceita(s), ${data.rejected.length} rejeitada(s), ${data.duplicates} duplicada(s) ignorada(s).`);
    setCsvContent("");
  }

  return (
    <div className="operations-module">
      {feedback && <div className="model-note" role="status"><div><strong>Financeiro</strong><p>{feedback}</p></div></div>}

      <div className="operations-kpis">
        <button onClick={() => setSection("tesouraria")}><Wallet size={18} /><span>Caixa Total</span><strong>{money.format(workspace.cashPosition.total)}</strong><small>{workspace.bankAccounts.length} conta(s) bancária(s)</small></button>
        <button onClick={() => setSection("tesouraria")}><Banknote size={18} /><span>Caixa Livre</span><strong>{money.format(workspace.cashPosition.free)}</strong><small>Disponível para uso imediato</small></button>
        <button onClick={() => setSection("tesouraria")}><Landmark size={18} /><span>Caixa Restrito</span><strong>{money.format(workspace.cashPosition.restricted)}</strong><small>Contas vinculadas/funding</small></button>
        <button onClick={() => setSection("pagar")}><CircleDollarSign size={18} /><span>Contas a Pagar em Aberto</span><strong>{money.format(workspace.payables.totalOpen)}</strong><small>{workspace.payables.overdueItems.length} vencida(s)</small></button>
        <button onClick={() => setSection("receber")}><TrendingDown size={18} /><span>Contas a Receber em Aberto</span><strong>{money.format(workspace.receivables.totalOpen)}</strong><small>{workspace.receivables.overdueItems.length} vencida(s)</small></button>
        <button onClick={() => setSection("projecao")}><AlertTriangle size={18} /><span>Necessidade de Capital</span><strong className={workspace.capitalNeed.capitalNeed > 0 ? "operation-negative" : "operation-positive"}>{money.format(workspace.capitalNeed.capitalNeed)}</strong><small>{workspace.capitalNeed.lowestBalancePeriod ? `Pico em ${workspace.capitalNeed.lowestBalancePeriod}` : "Sem déficit projetado"}</small></button>
      </div>

      <nav className="operations-tabs" aria-label="Visões financeiras">
        <button className={section === "tesouraria" ? "active" : ""} onClick={() => setSection("tesouraria")}>Tesouraria &amp; Bancos</button>
        <button className={section === "pagar" ? "active" : ""} onClick={() => setSection("pagar")}>Contas a Pagar</button>
        <button className={section === "receber" ? "active" : ""} onClick={() => setSection("receber")}>Contas a Receber</button>
        <button className={section === "conciliacao" ? "active" : ""} onClick={() => setSection("conciliacao")}>Conciliação {workspace.pendingReconciliations > 0 && <b>{workspace.pendingReconciliations}</b>}</button>
        <button className={section === "intercompany" ? "active" : ""} onClick={() => setSection("intercompany")}>Intercompany {workspace.pendingIntercompany > 0 && <b>{workspace.pendingIntercompany}</b>}</button>
        <button className={section === "projecao" ? "active" : ""} onClick={() => setSection("projecao")}>Projeção Atualizada</button>
      </nav>

      {section === "tesouraria" && (
        <section className="operations-panel">
          <header><div><span className="eyebrow">POSIÇÃO DE CAIXA</span><h3>Contas bancárias da SPE</h3><p>{workspace.pendingReconciliations} transação(ões) aguardando conciliação · {workspace.pendingIntercompany} movimentação(ões) intercompany pendente(s).</p></div><button className="button button-secondary" onClick={() => setShowBankForm((value) => !value)}><Plus size={16} /> Nova conta bancária</button></header>
          {showBankForm && <form className="operations-table-wrap" style={{ padding: 20, display: "grid", gap: 10, gridTemplateColumns: "repeat(3, 1fr)" }} action={submitBankAccount}>
            <input name="institutionName" placeholder="Instituição (ex.: Itaú)" required />
            <input name="agency" placeholder="Agência" required />
            <input name="accountNumber" placeholder="Número da conta" required />
            <input name="holderName" placeholder="Titular" required defaultValue={workspace.companies.find((c) => c.id === workspace.companyId)?.name ?? ""} />
            <select name="type" defaultValue="OPERATIONAL">{Object.entries(bankAccountTypeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <select name="restriction" defaultValue="FREE"><option value="FREE">Livre</option><option value="RESTRICTED">Restrita</option></select>
            <input name="openingBalance" type="number" step="0.01" placeholder="Saldo de abertura" defaultValue="0" />
            <button className="button button-primary" disabled={busy} type="submit">Cadastrar</button>
          </form>}
          <div className="operations-table-wrap">
            <table className="operations-table">
              <thead><tr><th>Instituição</th><th>Agência</th><th>Conta</th><th>Tipo</th><th>Restrição</th><th>Saldo</th></tr></thead>
              <tbody>
                {workspace.bankAccounts.map((account) => (
                  <tr key={account.id}><td><strong>{account.institution ?? "—"}</strong></td><td>{account.agency}</td><td>{account.accountNumber}</td><td>{bankAccountTypeLabel[account.type] ?? account.type}</td><td>{restrictionLabel[account.restriction] ?? account.restriction}</td><td>{money.format(account.balance)}</td></tr>
                ))}
                {workspace.bankAccounts.length === 0 && <tr><td colSpan={6} className="operations-empty">Nenhuma conta bancária cadastrada para esta SPE.</td></tr>}
              </tbody>
              <tfoot><tr><td colSpan={5}>Total</td><td>{money.format(workspace.cashPosition.total)}</td></tr></tfoot>
            </table>
          </div>
        </section>
      )}

      {section === "pagar" && (
        <section className="operations-panel">
          <header><div><span className="eyebrow">RÉGUA DE VENCIMENTOS</span><h3>Contas a pagar</h3><p>{workspace.payables.openCount} parcela(s) em aberto · Próximos 7 dias: {money.format(workspace.payables.horizons.byHorizon[7] ?? 0)} · 30 dias: {money.format(workspace.payables.horizons.byHorizon[30] ?? 0)} · 90 dias: {money.format(workspace.payables.horizons.byHorizon[90] ?? 0)}</p></div><button className="button button-secondary" onClick={() => setShowPayableForm((value) => !value)}><Plus size={16} /> Nova conta a pagar</button></header>
          {showPayableForm && <form className="operations-table-wrap" style={{ padding: 20, display: "grid", gap: 10, gridTemplateColumns: "repeat(3, 1fr)" }} action={submitPayableAccount}>
            <input name="description" placeholder="Descrição" required style={{ gridColumn: "span 2" }} />
            <select name="supplierId" defaultValue=""><option value="">— Sem fornecedor —</option>{workspace.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select>
            <label>Competência<input name="competenceMonth" type="date" required defaultValue={today()} /></label>
            <label>Valor total<input name="totalAmount" type="number" step="0.01" min="0.01" required /></label>
            <label>Nº de parcelas<input name="installmentsCount" type="number" min="1" defaultValue={1} /></label>
            <label>1º vencimento<input name="firstDueDate" type="date" required defaultValue={today()} /></label>
            <button className="button button-primary" disabled={busy} type="submit">Criar</button>
          </form>}
          <div className="operations-table-wrap">
            <table className="operations-table">
              <thead><tr><th>Descrição</th><th>Fornecedor</th><th>Vencimento</th><th>Status</th><th>Saldo</th><th>Ação</th></tr></thead>
              <tbody>
                {workspace.payables.openItems.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.description}</strong></td><td>{item.supplier ?? "—"}</td>
                    <td className={item.overdue ? "operation-negative" : ""}><CalendarClock size={13} /> {date.format(new Date(item.dueDate))}</td>
                    <td>{payableStatusLabel[item.status] ?? item.status}</td><td>{money.format(item.balance)}</td>
                    <td>
                      {item.status === "PREVISTA" && <button className="text-button" disabled={busy} onClick={() => withFeedback(() => transitionPayableInstallmentAction(item.id, "PROGRAMADA"), () => "Parcela programada.")}>Programar</button>}
                      {item.status === "PROGRAMADA" && <button className="text-button" disabled={busy} onClick={() => withFeedback(() => transitionPayableInstallmentAction(item.id, "APROVADA"), () => "Parcela aprovada.")}>Aprovar</button>}
                      {(item.status === "APROVADA" || item.status === "PARCIALMENTE_PAGA") && (payingId === item.id
                        ? <form style={{ display: "flex", gap: 6 }} action={(form) => payInstallment(item, form)}>
                            <select name="bankAccountId" required defaultValue={workspace.bankAccounts[0]?.id ?? ""}>{workspace.bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.institution} {account.accountNumber}</option>)}</select>
                            <input name="amount" type="number" step="0.01" defaultValue={item.balance} required style={{ width: 100 }} />
                            <input name="paidAt" type="date" defaultValue={today()} required />
                            <button className="text-button" disabled={busy} type="submit">Confirmar</button>
                            <button className="text-button" type="button" onClick={() => setPayingId(null)}>Cancelar</button>
                          </form>
                        : <button className="text-button" disabled={busy} onClick={() => setPayingId(item.id)}>Pagar</button>)}
                    </td>
                  </tr>
                ))}
                {workspace.payables.openItems.length === 0 && <tr><td colSpan={6} className="operations-empty">Nenhuma conta a pagar em aberto.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {section === "receber" && (
        <section className="operations-panel">
          <header><div><span className="eyebrow">RÉGUA DE VENCIMENTOS</span><h3>Contas a receber</h3><p>{workspace.receivables.openCount} parcela(s) em aberto · Próximos 7 dias: {money.format(workspace.receivables.horizons.byHorizon[7] ?? 0)} · 30 dias: {money.format(workspace.receivables.horizons.byHorizon[30] ?? 0)} · 90 dias: {money.format(workspace.receivables.horizons.byHorizon[90] ?? 0)}</p></div><button className="button button-secondary" onClick={() => setShowReceivableForm((value) => !value)}><Plus size={16} /> Nova conta a receber</button></header>
          {showReceivableForm && <form className="operations-table-wrap" style={{ padding: 20, display: "grid", gap: 10, gridTemplateColumns: "repeat(3, 1fr)" }} action={submitReceivableAccount}>
            <input name="description" placeholder="Descrição" required style={{ gridColumn: "span 2" }} />
            <select name="customerId" defaultValue=""><option value="">— Sem cliente —</option>{workspace.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select>
            <label>Competência<input name="competenceMonth" type="date" required defaultValue={today()} /></label>
            <label>Valor total<input name="totalAmount" type="number" step="0.01" min="0.01" required /></label>
            <label>Nº de parcelas<input name="installmentsCount" type="number" min="1" defaultValue={1} /></label>
            <label>1º vencimento<input name="firstDueDate" type="date" required defaultValue={today()} /></label>
            <button className="button button-primary" disabled={busy} type="submit">Criar</button>
          </form>}
          <div className="operations-table-wrap">
            <table className="operations-table">
              <thead><tr><th>Descrição</th><th>Cliente</th><th>Vencimento</th><th>Status</th><th>Saldo</th><th>Ação</th></tr></thead>
              <tbody>
                {workspace.receivables.openItems.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.description}</strong></td><td>{item.customer ?? "—"}</td>
                    <td className={item.overdue ? "operation-negative" : ""}><CalendarClock size={13} /> {date.format(new Date(item.dueDate))}</td>
                    <td>{receivableStatusLabel[item.status] ?? item.status}</td><td>{money.format(item.balance)}</td>
                    <td>
                      {item.status === "PREVISTA" && <button className="text-button" disabled={busy} onClick={() => withFeedback(() => transitionReceivableInstallmentAction(item.id, "EMITIDA"), () => "Parcela emitida.")}>Emitir</button>}
                      {(item.status === "EMITIDA" || item.status === "PARCIALMENTE_RECEBIDA") && (receivingId === item.id
                        ? <form style={{ display: "flex", gap: 6 }} action={(form) => receiveInstallment(item, form)}>
                            <select name="bankAccountId" required defaultValue={workspace.bankAccounts[0]?.id ?? ""}>{workspace.bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.institution} {account.accountNumber}</option>)}</select>
                            <input name="amount" type="number" step="0.01" defaultValue={item.balance} required style={{ width: 100 }} />
                            <input name="receivedAt" type="date" defaultValue={today()} required />
                            <button className="text-button" disabled={busy} type="submit">Confirmar</button>
                            <button className="text-button" type="button" onClick={() => setReceivingId(null)}>Cancelar</button>
                          </form>
                        : <button className="text-button" disabled={busy} onClick={() => setReceivingId(item.id)}>Registrar recebimento</button>)}
                    </td>
                  </tr>
                ))}
                {workspace.receivables.openItems.length === 0 && <tr><td colSpan={6} className="operations-empty">Nenhuma conta a receber em aberto.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {section === "conciliacao" && (
        <section className="operations-panel">
          <header><div><span className="eyebrow">CENTRAL DE CONCILIAÇÃO</span><h3>Transações bancárias sem conciliação</h3><p>Sugestão determinística por valor, data e documento — confirmação exige Administrador ou Owner.</p></div></header>
          <div className="operations-table-wrap" style={{ padding: 20 }}>
            <strong>Importar extrato CSV</strong>
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <select value={csvAccount} onChange={(event) => setCsvAccount(event.target.value)}>{workspace.bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.institution} {account.accountNumber}</option>)}</select>
              <textarea value={csvContent} onChange={(event) => setCsvContent(event.target.value)} placeholder={"data,valor,tipo,descricao,contraparte,documento,external_id\n2026-09-15,1800.00,DEBITO,PAG NF 4821,Fornecedor X,NF 4821,"} rows={4} style={{ flex: 1, minWidth: 320 }} />
              <button className="button button-secondary" disabled={busy || !csvContent.trim()} onClick={importCsv}>Importar</button>
            </div>
          </div>
          <div className="operations-table-wrap">
            <table className="operations-table">
              <thead><tr><th>Data</th><th>Descrição</th><th>Valor</th><th>Status</th><th>Sugestões</th></tr></thead>
              <tbody>
                {workspace.unreconciledTransactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{date.format(new Date(transaction.occurredAt))}</td>
                    <td><strong>{transaction.description}</strong></td>
                    <td className={transaction.direction === "DEBIT" ? "operation-negative" : "operation-positive"}>{transaction.direction === "DEBIT" ? "−" : "+"}{money.format(transaction.amount)}</td>
                    <td>{transaction.status}</td>
                    <td>
                      {transaction.suggestions.length === 0
                        ? <button className="text-button" disabled={busy} onClick={() => withFeedback(() => suggestReconciliationsAction(transaction.id), () => "Sugestões geradas.")}>Sugerir candidatos</button>
                        : <div style={{ display: "grid", gap: 6 }}>
                            {transaction.suggestions.map((suggestion) => (
                              <div key={suggestion.matchId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span className={`materiality materiality-${suggestion.confidence === "ALTA" ? "informativo" : suggestion.confidence === "MEDIA" ? "atencao" : "relevante"}`}>{suggestion.confidence ?? "—"} · {suggestion.score}</span>
                                <span>{suggestion.candidateLabel}</span>
                                <button className="text-button" disabled={busy} onClick={() => withFeedback(() => confirmReconciliationAction(suggestion.matchId), () => "Conciliação confirmada.")}>Confirmar</button>
                                <button className="text-button" disabled={busy} onClick={() => withFeedback(() => rejectReconciliationAction(suggestion.matchId, "Rejeitado manualmente na Central de Conciliação."), () => "Sugestão rejeitada.")}>Rejeitar</button>
                              </div>
                            ))}
                          </div>}
                    </td>
                  </tr>
                ))}
                {workspace.unreconciledTransactions.length === 0 && <tr><td colSpan={5} className="operations-empty">Nenhuma transação pendente de conciliação.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {section === "intercompany" && (
        <section className="operations-panel">
          <header><div><span className="eyebrow">CONSOLIDAÇÃO SEM EFEITO ARTIFICIAL</span><h3>Movimentações intercompany</h3><p>Cada movimentação gera obrigação e direito vinculados nas duas empresas — eliminados na visão consolidada.</p></div><button className="button button-secondary" onClick={() => setShowIntercompanyForm((value) => !value)}><Plus size={16} /> Nova movimentação</button></header>
          {showIntercompanyForm && <form className="operations-table-wrap" style={{ padding: 20, display: "grid", gap: 10, gridTemplateColumns: "repeat(3, 1fr)" }} action={submitIntercompany}>
            <select name="fromCompanyId" required defaultValue="">{[<option key="" value="" disabled>Empresa de origem</option>, ...workspace.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)]}</select>
            <select name="toCompanyId" required defaultValue={workspace.companyId ?? ""}>{[<option key="" value="" disabled>Empresa de destino</option>, ...workspace.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)]}</select>
            <select name="nature" defaultValue="APORTE"><option value="APORTE">Aporte</option><option value="MUTUO">Mútuo</option><option value="ADIANTAMENTO">Adiantamento</option><option value="RATEIO">Rateio</option><option value="REEMBOLSO">Reembolso</option><option value="TRANSFERENCIA">Transferência</option><option value="OUTRA">Outra</option></select>
            <label>Valor<input name="amount" type="number" step="0.01" min="0.01" required /></label>
            <label>Data<input name="occurredAt" type="date" required defaultValue={today()} /></label>
            <input name="description" placeholder="Descrição (opcional)" />
            <button className="button button-primary" disabled={busy} type="submit">Registrar</button>
          </form>}
          <div className="operations-table-wrap">
            <table className="operations-table">
              <thead><tr><th>Origem</th><th>Destino</th><th>Natureza</th><th>Data</th><th>Valor</th><th>Ação</th></tr></thead>
              <tbody>
                {workspace.pendingIntercompanyList.map((item) => (
                  <tr key={item.id}><td><strong>{item.fromCompany}</strong></td><td>{item.toCompany}</td><td>{item.nature}</td><td>{date.format(new Date(item.occurredAt))}</td><td>{money.format(item.amount)}</td><td><button className="text-button" disabled={busy} onClick={() => withFeedback(() => approveIntercompanyTransactionAction(item.id), () => "Movimentação aprovada.")}>Aprovar</button></td></tr>
                ))}
                {workspace.pendingIntercompanyList.length === 0 && <tr><td colSpan={6} className="operations-empty">Nenhuma movimentação intercompany pendente.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {section === "projecao" && (
        <section className="operations-panel">
          <header><div><span className="eyebrow">REALIZADO · COMPROMISSO · PREVISÃO RESIDUAL</span><h3>Projeção Atualizada</h3><p>Hierarquia sem dupla contagem: o compromisso concreto substitui a previsão residual correspondente.</p></div></header>
          <div className="disbursement-chart" role="img" aria-label="Fluxo financeiro projetado por período">
            {workspace.updatedProjection.map((row) => (
              <div className="disbursement-column" key={row.period}>
                <div className="disbursement-value">{money.format(row.total)}</div>
                <div className="disbursement-track"><span style={{ height: `${Math.max(3, (row.total / maxTotal) * 100)}%` }} /></div>
                <small>{month.format(new Date(`${row.period}-01T00:00:00Z`))}</small>
              </div>
            ))}
            {workspace.updatedProjection.length === 0 && <div className="operations-empty">Sem cronograma aprovado ou contas concretas vinculadas para projetar.</div>}
          </div>
          {workspace.updatedProjection.length > 0 && (
            <div className="operations-table-wrap">
              <table className="operations-table">
                <thead><tr><th>Mês</th><th>Realizado</th><th>Compromisso concreto</th><th>Previsão residual</th><th>Total</th></tr></thead>
                <tbody>
                  {workspace.updatedProjection.map((row) => (
                    <tr key={row.period}><td>{month.format(new Date(`${row.period}-01T00:00:00Z`))}</td><td>{money.format(row.realized)}</td><td>{money.format(row.committed)}</td><td>{money.format(row.residual)}</td><td>{money.format(row.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
