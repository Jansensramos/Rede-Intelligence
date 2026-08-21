"use client";

import { useState } from "react";
import { AlertTriangle, BadgeDollarSign, ClipboardList, FileCheck2, PackageCheck, Ruler, ShoppingCart } from "lucide-react";
import type { ProcurementWorkspaceView } from "@/application/procurement/procurement-service";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("pt-BR");
type Area = "visao" | "necessidades" | "requisicoes" | "cotacoes" | "fornecedores" | "pedidos" | "contratos" | "medicoes";
const areas: { key: Area; label: string }[] = [
  { key: "visao", label: "Visão Geral" }, { key: "necessidades", label: "Necessidades" }, { key: "requisicoes", label: "Requisições" }, { key: "cotacoes", label: "Cotações" },
  { key: "fornecedores", label: "Fornecedores" }, { key: "pedidos", label: "Pedidos" }, { key: "contratos", label: "Contratos e Aditivos" }, { key: "medicoes", label: "Medições" },
];

const statusLabel: Record<string, string> = {
  IDENTIFIED: "Identificada", VALIDATED: "Validada", CONVERTED_TO_REQUISITION: "Convertida", DRAFT: "Rascunho", REQUESTED: "Solicitada", IN_APPROVAL: "Em aprovação",
  APPROVED_FOR_QUOTATION: "Aprovada para cotação", IN_QUOTATION: "Em cotação", FULFILLED: "Atendida", OPEN: "Aberta", DECIDED: "Decidida", SUBMITTED: "Submetida",
  APPROVED: "Aprovado", ACTIVE: "Ativo", SENT_TO_FINANCE: "Enviada ao Financeiro", TECHNICALLY_APPROVED: "Aprovada tecnicamente", QUALIFIED: "Qualificado", QUALIFIED_WITH_RESTRICTIONS: "Qualificado com restrições",
};

function Status({ value }: { value: string }) { return <span className="status-pill">{statusLabel[value] ?? value.replaceAll("_", " ")}</span>; }

function Metrics({ workspace }: { workspace: ProcurementWorkspaceView }) {
  const cards = [
    ["Orçamento Oficial", workspace.summary.budget, "Base imutável", ClipboardList], ["Contratado", workspace.summary.contracted, `${workspace.contracts.length} contratos`, FileCheck2],
    ["Saldo a contratar", workspace.summary.balanceToContract, `${workspace.summary.criticalPurchases} compras críticas`, ShoppingCart], ["Medido", workspace.summary.measured, `${workspace.measurements.length} boletins`, Ruler],
    ["Obrigado", workspace.summary.obligated, "Origem Financeiro 9B", BadgeDollarSign], ["Pago", workspace.summary.paid, "Exclusivamente Financeiro", PackageCheck],
  ] as const;
  return <div className="metric-grid">{cards.map(([label, value, meta, Icon]) => <article className="metric-card" key={label}><div><span>{label}</span><Icon size={17} /></div><strong>{brl.format(value)}</strong><small>{meta}</small></article>)}</div>;
}

export function ProcurementView({ workspace }: { workspace: ProcurementWorkspaceView }) {
  const [area, setArea] = useState<Area>("visao");
  return <div className="view-stack">
    <div className="scenario-switch" aria-label="Áreas de Suprimentos">{areas.map((item) => <button key={item.key} className={area === item.key ? "is-active" : ""} onClick={() => setArea(item.key)}>{item.label}</button>)}</div>
    {area === "visao" && <><Metrics workspace={workspace} /><div className="metric-grid">
      <article className="metric-card"><div><span>Aditivos aprovados</span><FileCheck2 size={17} /></div><strong>{brl.format(workspace.summary.amendments)}</strong><small>Impacto preservado por evento</small></article>
      <article className="metric-card"><div><span>Economia validada</span><BadgeDollarSign size={17} /></div><strong>{brl.format(workspace.summary.validatedSaving)}</strong><small>Escopo tecnicamente comparável</small></article>
      <article className="metric-card"><div><span>Processos abertos</span><ShoppingCart size={17} /></div><strong>{workspace.summary.openProcesses}</strong><small>Cotações em andamento</small></article>
      <article className="metric-card"><div><span>Medições pendentes</span><Ruler size={17} /></div><strong>{workspace.summary.pendingMeasurements}</strong><small>Fluxo técnico e de aprovação</small></article>
    </div><article className="panel"><div className="panel-heading"><div><span className="eyebrow">CADEIA ECONÔMICA</span><h2>Orçamento → Contratado → Medido → Obrigado → Pago</h2></div></div><div className="scenario-table">
      <div className="table-row table-head"><span>Estágio</span><span>Valor</span><span>Regra</span><span>Origem</span></div>
      {[["Orçamento", workspace.summary.budget, "Base do saldo a contratar", "Orçamento Oficial"], ["Contratado", workspace.summary.contracted, "Compromisso, não realizado", "Pedidos + contratos + aditivos"], ["Medido", workspace.summary.measured, "Execução certificada", "Boletins aprovados"], ["Obrigado", workspace.summary.obligated, "Dívida financeira", "Financeiro 9B"], ["Pago", workspace.summary.paid, "Liquidação confirmada", "Financeiro 9B"]].map(([stage, value, rule, source]) => <div className="table-row" key={String(stage)}><strong>{stage}</strong><span>{brl.format(Number(value))}</span><span>{rule}</span><span>{source}</span></div>)}
    </div></article></>}
    {area === "necessidades" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">PLANO DE SUPRIMENTOS</span><h2>Necessidades e datas-limite</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Código</th><th>Necessidade</th><th>Quantidade</th><th>Necessária em</th><th>Contratar até</th><th>Origem</th><th>Situação</th></tr></thead><tbody>{workspace.needs.map((item) => <tr key={item.id}><td>{item.code}</td><td><strong>{item.description}</strong></td><td>{item.quantity} {item.unit}</td><td>{date.format(new Date(item.requiredAt))}</td><td>{date.format(new Date(item.contractingDeadline))}</td><td>{item.origin.replaceAll("_", " ")}</td><td>{item.critical ? <span className="negative-value"><AlertTriangle size={14} /> COMPRA CRÍTICA</span> : <Status value={item.status} />}</td></tr>)}</tbody></table></div></article>}
    {area === "requisicoes" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">WORKFLOW</span><h2>Requisições de compra</h2></div></div><div className="scenario-table"><div className="table-row table-head"><span>Número</span><span>Título</span><span>Itens</span><span>Situação</span></div>{workspace.requisitions.map((item) => <div className="table-row" key={item.id}><strong>{item.number}</strong><span>{item.title}</span><span>{item.itemCount}</span><Status value={item.status} /></div>)}</div></article>}
    {area === "cotacoes" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">MAPA COMPARATIVO</span><h2>Processos, propostas e comparabilidade</h2></div></div>{workspace.quotations.map((quotation) => <div className="model-note" key={quotation.id}><ShoppingCart size={20} /><div><strong>{quotation.number} · {quotation.title}</strong><p>{quotation.invitedCount} fornecedores convidados · <Status value={quotation.status} /></p><div className="scenario-deltas">{quotation.proposals.map((proposal) => <span key={proposal.id}>{proposal.supplier}: {brl.format(proposal.total)} {proposal.comparable ? "· comparável" : "· requer ajuste de escopo"}</span>)}</div></div></div>)}</article>}
    {area === "fornecedores" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">CADASTRO ÚNICO</span><h2>Fornecedores e qualificação</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Fornecedor</th><th>CNPJ/CPF</th><th>Qualificação</th><th>Exposição ativa</th><th>Situação</th></tr></thead><tbody>{workspace.suppliers.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.legalName}</small></td><td>{item.taxId ?? "—"}</td><td>{item.qualifications.map((q) => `${q.category}: ${statusLabel[q.status] ?? q.status}`).join(" · ") || "Pendente"}</td><td>{brl.format(item.activeContractValue)}</td><td><Status value={item.status} /></td></tr>)}</tbody></table></div></article>}
    {area === "pedidos" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">AQUISIÇÕES SIMPLES</span><h2>Pedidos de compra</h2></div></div><div className="scenario-table"><div className="table-row table-head"><span>Número</span><span>Fornecedor</span><span>Valor</span><span>Situação</span></div>{workspace.orders.map((item) => <div className="table-row" key={item.id}><strong>{item.number}</strong><span>{item.supplier}</span><span>{brl.format(item.amount)}</span><Status value={item.status} /></div>)}</div></article>}
    {area === "contratos" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">COMPROMISSOS</span><h2>Contratos, saldo e aditivos</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Contrato</th><th>Fornecedor</th><th>Original</th><th>Atual</th><th>Medido</th><th>Saldo</th><th>Situação</th></tr></thead><tbody>{workspace.contracts.map((item) => <tr key={item.id}><td><strong>{item.number} · {item.title}</strong><small>{item.amendments.length} aditivo(s)</small></td><td>{item.supplier}</td><td>{brl.format(item.originalAmount)}</td><td>{brl.format(item.currentAmount)}</td><td>{brl.format(item.measured)}</td><td>{brl.format(item.balance)}</td><td><Status value={item.status} /></td></tr>)}</tbody></table></div></article>}
    {area === "medicoes" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">EXECUÇÃO CERTIFICADA</span><h2>Boletins de medição</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Boletim</th><th>Contrato / Fornecedor</th><th>Competência</th><th>Bruto</th><th>Retenções</th><th>Líquido</th><th>Obrigação</th><th>Situação</th></tr></thead><tbody>{workspace.measurements.map((item) => <tr key={item.id}><td><strong>BM {item.number}</strong></td><td>{item.contract}<small>{item.supplier}</small></td><td>{date.format(new Date(item.competenceDate))}</td><td>{brl.format(item.grossAmount)}</td><td>{brl.format(item.retentionAmount)}</td><td>{brl.format(item.netAmount)}</td><td>{item.obligationId ? "Gerada exatamente uma vez" : "Pendente"}</td><td><Status value={item.status} /></td></tr>)}</tbody></table></div></article>}
  </div>;
}
