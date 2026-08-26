"use client";

/**
 * Fase 9K.4B — Cliente 360. Visão puramente de apresentação: toda a agregação, RBAC e cálculo
 * financeiro vivem em `src/application/sales/customer-360-service.ts` e
 * `src/domain/sales/customer-360.ts` — este componente só exibe o que o backend já autorizou.
 *
 * `authorized: false` (vindo do backend) e "lista vazia" nunca usam a mesma mensagem — plano §10:
 * a primeira mostra `RestrictedSection`, a segunda usa o `emptyMessage` do `DataTable`/estado local.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Landmark, Lock, MessageSquareWarning, ShieldCheck } from "lucide-react";
import { DataTable, MetricCard, SectionTitle, type DataTableColumn } from "@/components/ui";
import { ActionsTable } from "@/components/areas/actions-table";
import { Status, statusLabel } from "@/components/sales-view";
import type { Customer360View as Customer360Data } from "@/application/sales/customer-360-service";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("pt-BR");
const dateOrNone = (iso: string | null) => (iso ? date.format(new Date(iso)) : "—");

type Tab = "resumo" | "comercial" | "financeiro" | "credito" | "posvenda" | "acoes";
const TABS: { key: Tab; label: string }[] = [
  { key: "resumo", label: "Resumo" }, { key: "comercial", label: "Comercial e Contratos" }, { key: "financeiro", label: "Financeiro" },
  { key: "credito", label: "Crédito" }, { key: "posvenda", label: "Pós-venda" }, { key: "acoes", label: "Central de Ações" },
];

function RestrictedSection({ label }: { label: string }) {
  return (
    <div className="ds-empty-state" role="status">
      <Lock size={20} />
      <strong>Sem permissão</strong>
      <p>Seu perfil não tem a capacidade necessária para ver {label}.</p>
    </div>
  );
}

type SalesItem = Customer360Data["sales"]["items"][number];
type FinancialBySale = Customer360Data["financial"]["bySale"][number];

function SaleCard({ sale }: { sale: SalesItem }) {
  return (
    <article className="panel" key={sale.id}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{sale.projectName} · UNIDADE {sale.unitCode}</span>
          <h2>{sale.contract?.title ?? `Venda ${sale.id}`}</h2>
        </div>
        <Status value={sale.status} />
      </div>
      <div className="metric-grid">
        <MetricCard label="Preço vendido" value={brl.format(sale.soldPrice)} meta={sale.broker ? `Corretor: ${sale.broker}` : "Sem corretor"} icon={Landmark} />
        <MetricCard label="Desconto" value={brl.format(sale.discountAmount)} meta="Sobre o preço de tabela" icon={Landmark} />
      </div>

      {sale.contract ? (
        <div className="scenario-table">
          <div className="table-row"><strong>Contrato</strong><span>{sale.contract.number}</span><Status value={sale.contract.status} /></div>
          <div className="table-row"><strong>Assinatura</strong><span>{sale.contract.effectiveFrom ? `Vigente desde ${dateOrNone(sale.contract.effectiveFrom)}` : "Sem vigência definida"}</span><Status value={sale.contract.signatureStatus} /></div>
          {sale.signatureRequest && (
            <div className="table-row">
              <strong>Signatários</strong>
              <span>{sale.signatureRequest.parties.map((party) => `${party.displayName} (${statusLabel[party.role] ?? party.role}): ${statusLabel[party.status] ?? party.status}`).join(" · ")}</span>
              <Status value={sale.signatureRequest.status} />
            </div>
          )}
          {sale.signatureRequest?.errorMessage && <div className="table-row"><strong>Erro de assinatura</strong><span className="negative-value">{sale.signatureRequest.errorMessage}</span><span /></div>}
          {sale.documents.length > 0 && <div className="table-row"><strong>Documentos</strong><span>{sale.documents.map((doc) => `${statusLabel[doc.kind] ?? doc.kind} v${doc.version}`).join(", ")}</span><span /></div>}
        </div>
      ) : (
        <p className="empty-state">Nenhum contrato gerado para esta venda ainda.</p>
      )}

      {sale.paymentPlanVersions.length > 1 && (
        <div className="scenario-table">
          <div className="table-row table-head"><span>Plano de pagamento</span><span>Situação</span><span>Ativado em</span></div>
          {sale.paymentPlanVersions.map((plan) => <div className="table-row" key={plan.version}><strong>Versão {plan.version}{plan.renegotiated ? " (renegociado)" : ""}</strong><Status value={plan.status} /><span>{dateOrNone(plan.activatedAt)}</span></div>)}
        </div>
      )}

      {sale.status === "CANCELLED" && (
        <div className="model-note">
          <ShieldCheck size={20} />
          <div><strong>Distrato</strong><p>{sale.cancelledReason ?? "Sem motivo registrado."} {sale.cancelledAt && `— em ${dateOrNone(sale.cancelledAt)}`}</p></div>
        </div>
      )}
    </article>
  );
}

export function Customer360View({ view }: { view: Customer360Data }) {
  const [tab, setTab] = useState<Tab>("resumo");
  const router = useRouter();
  const { customer, capabilities } = view;

  const financialColumns: DataTableColumn<FinancialBySale>[] = [
    { key: "unit", header: "Unidade / Contrato", priority: "essential", align: "left", render: (row) => <span><strong>{row.unitCode}</strong>{row.contractNumber && <><br /><small>{row.contractNumber}</small></>}</span> },
    { key: "project", header: "Empreendimento", priority: "default", align: "left", render: (row) => row.projectName },
    { key: "contracted", header: "Contratado", priority: "essential", render: (row) => brl.format(row.position.contracted) },
    { key: "paid", header: "Pago", priority: "essential", render: (row) => brl.format(row.position.paid) },
    { key: "open", header: "Em aberto", priority: "essential", render: (row) => brl.format(row.position.open) },
    { key: "overdue", header: "Vencido", priority: "essential", render: (row) => <span className={row.position.overdue > 0 ? "negative-value" : undefined}>{brl.format(row.position.overdue)}</span> },
    { key: "next", header: "Próximo vencimento", priority: "default", render: (row) => (row.position.nextDueDate ? `${dateOrNone(row.position.nextDueDate)} · ${brl.format(row.position.nextDueAmount ?? 0)}` : "—") },
  ];

  return (
    <div className="view-stack">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button type="button" className="button button-secondary" onClick={() => router.push("/comercial")}><ArrowLeft size={16} /> Comercial</button>
        {capabilities.financialView && <Link href="/financeiro" className="button button-secondary">Financeiro</Link>}
        {capabilities.legalView && <Link href="/juridico" className="button button-secondary">Jurídico</Link>}
      </div>

      <SectionTitle
        eyebrow="CLIENTE 360"
        title={customer.name}
        description={`${customer.personType === "INDIVIDUAL" ? "Pessoa física" : "Pessoa jurídica"} · ${customer.taxIdMasked ?? "Documento não cadastrado"} · ${customer.email ?? "sem e-mail"} · ${customer.phone ?? "sem telefone"}`}
      />

      <div className="scenario-switch" aria-label="Seções do Cliente 360">{TABS.map((item) => <button key={item.key} className={tab === item.key ? "is-active" : ""} onClick={() => setTab(item.key)}>{item.label}</button>)}</div>

      {tab === "resumo" && (
        <>
          {capabilities.financialView && view.financial.totals ? (
            <div className="metric-grid">
              <MetricCard label="Contratado" value={brl.format(view.financial.totals.contracted)} meta={`${view.sales.items.length} venda(s)`} icon={Landmark} />
              <MetricCard label="Pago" value={brl.format(view.financial.totals.paid)} meta="Recebimento real (9B)" icon={Landmark} tone="positive" />
              <MetricCard label="Em aberto" value={brl.format(view.financial.totals.open)} meta="Ainda a receber" icon={Landmark} />
              <MetricCard label="Vencido" value={brl.format(view.financial.totals.overdue)} meta={`${view.financial.totals.overdueCount} parcela(s)`} icon={Landmark} tone={view.financial.totals.overdue > 0 ? "negative" : "positive"} />
            </div>
          ) : (
            <RestrictedSection label="a posição financeira deste cliente" />
          )}

          {capabilities.commercialView ? (
            <article className="panel"><div className="panel-heading"><div><span className="eyebrow">EMPREENDIMENTO E UNIDADES</span><h2>Unidades relacionadas a este cliente</h2></div></div>
              <div className="scenario-table"><div className="table-row table-head"><span>Empreendimento</span><span>Unidade</span><span>Situação</span></div>
                {view.units.items.map((item) => <div className="table-row" key={item.unitId}><strong>{item.projectName}</strong><span>{item.unitCode}</span><Status value={item.unitStatus} /></div>)}
                {view.units.items.length === 0 && <p className="empty-state">Nenhuma unidade relacionada a este cliente.</p>}
              </div>
            </article>
          ) : <RestrictedSection label="as unidades comerciais deste cliente" />}
        </>
      )}

      {tab === "comercial" && (capabilities.commercialView ? (
        <>
          <article className="panel"><div className="panel-heading"><div><span className="eyebrow">NEGOCIAÇÃO</span><h2>Propostas</h2></div></div>
            <div className="scenario-table"><div className="table-row table-head"><span>Unidade</span><span>Empreendimento</span><span>Preço proposto</span><span>Válida até</span><span>Situação</span></div>
              {view.proposals.items.map((item) => <div className="table-row" key={item.id}><strong>{item.unitCode}</strong><span>{item.projectName}</span><span>{brl.format(item.proposedPrice)}</span><span>{dateOrNone(item.validUntil)}</span><Status value={item.status} /></div>)}
              {view.proposals.items.length === 0 && <p className="empty-state">Nenhuma proposta registrada para este cliente.</p>}
            </div>
          </article>

          <article className="panel"><div className="panel-heading"><div><span className="eyebrow">RESERVA</span><h2>Reservas</h2></div></div>
            <div className="scenario-table"><div className="table-row table-head"><span>Unidade</span><span>Empreendimento</span><span>Expira em</span><span>Situação</span></div>
              {view.reservations.items.map((item) => <div className="table-row" key={item.id}><strong>{item.unitCode}</strong><span>{item.projectName}</span><span>{dateOrNone(item.expiresAt)}</span><Status value={item.status} /></div>)}
              {view.reservations.items.length === 0 && <p className="empty-state">Nenhuma reserva registrada para este cliente.</p>}
            </div>
          </article>

          {view.sales.items.length === 0 && <p className="empty-state">Nenhuma venda registrada para este cliente.</p>}
          {view.sales.items.map((sale) => <SaleCard sale={sale} key={sale.id} />)}

          <article className="panel"><div className="panel-heading"><div><span className="eyebrow">CORRETAGEM</span><h2>Comissões</h2></div></div>
            <div className="scenario-table"><div className="table-row table-head"><span>Unidade</span><span>Corretor</span><span>Valor</span><span>Situação</span></div>
              {view.commissions.items.map((item) => <div className="table-row" key={item.id}><strong>{item.unitCode}</strong><span>{item.broker}</span><span>{brl.format(item.amount)}</span><Status value={item.status} /></div>)}
              {view.commissions.items.length === 0 && <p className="empty-state">Nenhuma comissão registrada para este cliente.</p>}
            </div>
          </article>
        </>
      ) : <RestrictedSection label="os dados comerciais deste cliente" />)}

      {tab === "financeiro" && (capabilities.financialView ? (
        <article className="panel"><div className="panel-heading"><div><span className="eyebrow">POSIÇÃO POR UNIDADE/CONTRATO</span><h2>Quanto contratou, pagou, deve e venceu</h2></div></div>
          <DataTable columns={financialColumns} rows={view.financial.bySale} rowKey={(row) => row.saleId} emptyMessage="Nenhum contrato com posição financeira para este cliente." />
        </article>
      ) : <RestrictedSection label="a visão financeira deste cliente" />)}

      {tab === "credito" && (capabilities.commercialView ? (
        <article className="panel"><div className="panel-heading"><div><span className="eyebrow">CRÉDITO</span><h2>Consultas ao bureau (CPF mascarado — nunca decide a venda sozinha)</h2></div></div>
          <div className="scenario-table"><div className="table-row table-head"><span>Provider</span><span>CPF</span><span>Resultado</span><span>Score</span><span>Consultado em</span></div>
            {view.credit.items.map((item) => <div className="table-row" key={item.id}><strong>{item.provider}</strong><span>{item.cpfMasked}</span><span>{item.result ? statusLabel[item.result] ?? item.result : statusLabel[item.status] ?? item.status}</span><span>{item.score ?? "—"}</span><span>{dateOrNone(item.requestedAt)}</span></div>)}
            {view.credit.items.length === 0 && <p className="empty-state">Nenhuma consulta de crédito registrada para este cliente.</p>}
          </div>
        </article>
      ) : <RestrictedSection label="as consultas de crédito deste cliente" />)}

      {tab === "posvenda" && (capabilities.commercialView ? (
        <article className="panel"><div className="panel-heading"><div><span className="eyebrow">ATENDIMENTO PÓS-VENDA</span><h2>Solicitações e histórico</h2></div></div>
          {view.postSale.items.map((item) => (
            <div className="model-note" key={item.id}>
              <MessageSquareWarning size={20} />
              <div><strong>{item.unitCode} · {item.category.replaceAll("_", " ")}</strong><p>{item.updates} atualização(ões) · aberta em {dateOrNone(item.createdAt)}</p><Status value={item.status} /></div>
            </div>
          ))}
          {view.postSale.items.length === 0 && <p className="empty-state">Nenhuma solicitação de pós-venda para este cliente.</p>}
        </article>
      ) : <RestrictedSection label="o pós-venda deste cliente" />)}

      {tab === "acoes" && (capabilities.commercialView ? (
        <article className="panel"><div className="panel-heading"><div><span className="eyebrow">CENTRAL DE AÇÕES</span><h2>O que precisa de atenção neste cliente</h2></div></div>
          <ActionsTable actions={view.actions.items} responsibleNames={view.actions.responsibleNames} emptyMessage="Nenhuma ação pendente para este cliente." />
        </article>
      ) : <RestrictedSection label="a central de ações deste cliente" />)}
    </div>
  );
}

