"use client";

import { useState } from "react";
import { AlertTriangle, Building2, CalendarClock, HandCoins, Home, MessageSquareWarning, ReceiptText, Users } from "lucide-react";
import type { SalesWorkspaceView } from "@/application/sales/sales-service";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlPrecise = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percentage = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const date = new Intl.DateTimeFormat("pt-BR");
type Area = "visao" | "estoque" | "propostas" | "reservas" | "vendas" | "fechamento360" | "comissoes" | "posvenda";
const areas: { key: Area; label: string }[] = [
  { key: "visao", label: "Visão Geral" }, { key: "estoque", label: "Estoque e Preços" }, { key: "propostas", label: "Propostas" },
  { key: "reservas", label: "Reservas" }, { key: "vendas", label: "Vendas e Contratos" }, { key: "fechamento360", label: "Crédito → Contrato → Assinatura" },
  { key: "comissoes", label: "Comissões" }, { key: "posvenda", label: "Entrega e Pós-venda" },
];

const statusLabel: Record<string, string> = {
  DISPONIVEL: "Disponível", EM_RESERVA: "Em reserva", RESERVADA: "Reservada", EM_PROPOSTA: "Em proposta", VENDIDA: "Vendida",
  BLOQUEADA: "Bloqueada", PERMUTA: "Permuta", DISTRATADA: "Distratada", ENTREGUE: "Entregue", DRAFT: "Rascunho",
  SUBMITTED: "Submetida", UNDER_APPROVAL: "Em aprovação", APPROVED: "Aprovada", REJECTED: "Rejeitada", EXPIRED: "Expirada",
  CONVERTED: "Convertida", ACTIVE: "Ativa", CONFIRMED: "Confirmada", CANCELLED: "Cancelada", PENDING: "Pendente",
  PAYABLE_GENERATED: "Obrigação gerada", PAID: "Paga", OPEN: "Aberta", IN_PROGRESS: "Em andamento", WAITING_CUSTOMER: "Aguardando cliente",
  RESOLVED: "Resolvida", CLOSED: "Encerrada",
  PREPARADO: "Preparado", ENVIADO: "Enviado", AGUARDANDO_ASSINATURAS: "Aguardando assinaturas", ASSINADO: "Assinado", RECUSADO: "Recusado", CANCELADO: "Cancelado", ERRO: "Erro",
  SEM_RESTRICAO: "Sem restrição", COM_RESTRICAO: "Com restrição", REQUER_ANALISE: "Requer análise",
  ARCHIVED: "Arquivado",
  MODEL_RENDER: "Documento gerado", ATTACHMENT: "Anexo", SIGNED_FINAL: "Assinado (final)", FINAL: "Final",
};

const creditResultTone: Record<string, "positive" | "negative" | "neutral"> = { SEM_RESTRICAO: "positive", COM_RESTRICAO: "negative", REQUER_ANALISE: "neutral" };

function Status({ value }: { value: string }) { return <span className="status-pill">{statusLabel[value] ?? value.replaceAll("_", " ")}</span>; }

function Metrics({ workspace }: { workspace: SalesWorkspaceView }) {
  const cards = [
    ["VGV Total", workspace.summary.vgvTotal, `${workspace.summary.unitsTotal} unidades`, Building2],
    ["VGV Disponível", workspace.summary.vgvDisponivel, `${workspace.summary.unitsAvailable} unidades livres`, Home],
    ["VGV Vendido", workspace.summary.vgvVendido, `${workspace.summary.unitsSold} vendidas`, HandCoins],
    ["A Receber", workspace.summary.vgvAReceber, `${brl.format(workspace.summary.vgvRecebido)} recebidos`, ReceiptText],
  ] as const;
  return <div className="metric-grid">{cards.map(([label, value, meta, Icon]) => <article className="metric-card" key={label}><div><span>{label}</span><Icon size={17} /></div><strong>{brl.format(value)}</strong><small>{meta}</small></article>)}</div>;
}

export function SalesView({ workspace }: { workspace: SalesWorkspaceView }) {
  const [area, setArea] = useState<Area>("visao");
  return <div className="view-stack">
    <div className="scenario-switch" aria-label="Áreas Comerciais">{areas.map((item) => <button key={item.key} className={area === item.key ? "is-active" : ""} onClick={() => setArea(item.key)}>{item.label}</button>)}</div>

    {area === "visao" && <><Metrics workspace={workspace} /><div className="metric-grid">
      <article className="metric-card"><div><span>VSO do mês</span><Users size={17} /></div><strong>{percentage.format(workspace.summary.vso)}</strong><small>{workspace.summary.salesThisMonth} venda(s) no mês</small></article>
      <article className="metric-card"><div><span>Preço/m² médio</span><Home size={17} /></div><strong>{brlPrecise.format(workspace.summary.averagePricePerM2)}</strong><small>Desconto médio {brl.format(workspace.summary.averageDiscount)}</small></article>
      <article className="metric-card"><div><span>Reservas ativas</span><CalendarClock size={17} /></div><strong>{workspace.summary.activeReservations}</strong><small>{workspace.summary.activeProposals} proposta(s) em curso</small></article>
      <article className="metric-card"><div><span>Recebíveis vencidos</span><AlertTriangle size={17} /></div><strong>{brl.format(workspace.summary.overdueReceivablesAmount)}</strong><small>{workspace.summary.overdueReceivables} parcela(s) — leitura direta da 9B</small></article>
    </div>
    <article className="panel"><div className="panel-heading"><div><span className="eyebrow">CADEIA COMERCIAL</span><h2>Estoque → Tabela → Proposta → Reserva → Venda → Recebíveis (9B)</h2></div></div><div className="scenario-table">
      <div className="table-row table-head"><span>Estágio</span><span>Valor / Quantidade</span><span>Origem</span></div>
      {[["Disponível", brl.format(workspace.summary.vgvDisponivel), `${workspace.summary.unitsAvailable} unidades`], ["Reservado", brl.format(workspace.summary.vgvReservado), `${workspace.summary.unitsReserved} unidades`], ["Vendido", brl.format(workspace.summary.vgvVendido), `${workspace.summary.unitsSold} unidades`], ["Distratado", brl.format(workspace.summary.vgvDistratado), `${workspace.summary.unitsRescinded} unidades`], ["Recebido (9B)", brl.format(workspace.summary.vgvRecebido), "Financeiro"], ["Comissões pendentes", String(workspace.summary.pendingCommissions), "Corretores"], ["Pós-venda aberto", String(workspace.summary.openPostSaleRequests), "Atendimento"]].map((row) => <div className="table-row" key={row[0]}><strong>{row[0]}</strong><span>{row[1]}</span><span>{row[2]}</span></div>)}
    </div></article></>}

    {area === "estoque" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">ESTOQUE COMERCIAL</span><h2>Unidades, tipologia e preço vigente</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Unidade</th><th>Tipologia</th><th>Área privativa</th><th>Preço de tabela</th><th>Preço/m²</th><th>Bloqueio</th><th>Situação</th></tr></thead><tbody>{workspace.units.map((item) => <tr key={item.id}><td><strong>{item.code}</strong>{item.floor && <small> · andar {item.floor}</small>}</td><td>{item.typology}</td><td>{item.privateAreaM2.toLocaleString("pt-BR")} m²</td><td>{item.listPrice !== null ? brl.format(item.listPrice) : "—"}</td><td>{item.pricePerM2 !== null ? brlPrecise.format(item.pricePerM2) : "—"}</td><td>{item.activeBlock ? `${item.activeBlock.origin} — ${item.activeBlock.reason}` : "—"}</td><td><Status value={item.status} /></td></tr>)}</tbody></table></div></article>}

    {area === "propostas" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">NEGOCIAÇÃO</span><h2>Propostas comerciais</h2></div></div><div className="scenario-table"><div className="table-row table-head"><span>Unidade</span><span>Cliente</span><span>Preço proposto</span><span>Desconto</span><span>Válida até</span><span>Situação</span></div>{workspace.proposals.map((item) => <div className="table-row" key={item.id}><strong>{item.unit}</strong><span>{item.customer}</span><span>{brl.format(item.proposedPrice)}</span><span>{brl.format(item.discountAmount)}</span><span>{date.format(new Date(item.validUntil))}</span><Status value={item.status} /></div>)}</div></article>}

    {area === "reservas" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">RESERVA DE UNIDADE</span><h2>Reservas ativas, confirmadas e expiradas</h2></div></div><div className="scenario-table"><div className="table-row table-head"><span>Unidade</span><span>Cliente</span><span>Expira em</span><span>Situação</span></div>{workspace.reservations.map((item) => <div className="table-row" key={item.id}><strong>{item.unit}</strong><span>{item.customer}</span><span>{date.format(new Date(item.expiresAt))}</span>{item.expired ? <span className="negative-value"><AlertTriangle size={14} /> EXPIRADA</span> : <Status value={item.status} />}</div>)}</div></article>}

    {area === "vendas" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">EVENTO COMERCIAL</span><h2>Vendas, contrato e plano de pagamento</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Contrato</th><th>Unidade</th><th>Compradores</th><th>Corretor</th><th>Preço vendido</th><th>Desconto</th><th>Parcelas ativas</th><th>Recebido</th><th>Assinatura</th><th>Situação</th></tr></thead><tbody>{workspace.sales.map((item) => <tr key={item.id}><td><strong>{item.contractNumber ?? "—"}</strong></td><td>{item.unit}</td><td>{item.buyers.join(", ")}</td><td>{item.broker ?? "—"}</td><td>{brl.format(item.soldPrice)}</td><td>{brl.format(item.discountAmount)}</td><td>{item.installments}</td><td>{brl.format(item.received)}</td><td>{item.signatureStatus ? <Status value={item.signatureStatus} /> : "—"}{item.signatureRequest && <small> · {item.signatureRequest.signedCount}/{item.signatureRequest.totalParties} assinaram</small>}</td><td><Status value={item.status} /></td></tr>)}</tbody></table></div></article>}

    {area === "fechamento360" && <><article className="panel"><div className="panel-heading"><div><span className="eyebrow">CRÉDITO</span><h2>Consulta de crédito por proposta (CPF mascarado — nunca decide a venda sozinha)</h2></div></div><div className="scenario-table"><div className="table-row table-head"><span>Unidade</span><span>Cliente</span><span>CPF</span><span>Resultado</span><span>Consultado em</span></div>{workspace.proposals.filter((item) => item.creditConsultation).map((item) => <div className="table-row" key={item.id}><strong>{item.unit}</strong><span>{item.customer}</span><span>{item.creditConsultation!.cpfMasked}</span><span className={item.creditConsultation!.result ? { positive: "positive-value", negative: "negative-value", neutral: undefined }[creditResultTone[item.creditConsultation!.result] ?? "neutral"] : undefined}>{item.creditConsultation!.result ? statusLabel[item.creditConsultation!.result] ?? item.creditConsultation!.result : statusLabel[item.creditConsultation!.status] ?? item.creditConsultation!.status}</span><span>{date.format(new Date(item.creditConsultation!.requestedAt))}</span></div>)}{workspace.proposals.every((item) => !item.creditConsultation) && <p className="empty-state">Nenhuma consulta de crédito registrada neste empreendimento.</p>}</div></article>

    <article className="panel"><div className="panel-heading"><div><span className="eyebrow">MODELO CONTRATUAL</span><h2>Modelos por empreendimento e versões aprovadas</h2></div></div><div className="scenario-table"><div className="table-row table-head"><span>Modelo</span><span>Situação</span><span>Versões</span></div>{workspace.contractTemplates.map((template) => <div className="table-row" key={template.id}><strong>{template.name}</strong><Status value={template.status} /><span>{template.versions.map((version) => `v${version.version} (${statusLabel[version.status] ?? version.status})`).join(", ") || "—"}</span></div>)}{workspace.contractTemplates.length === 0 && <p className="empty-state">Nenhum modelo contratual cadastrado neste empreendimento.</p>}</div></article>

    <article className="panel"><div className="panel-heading"><div><span className="eyebrow">CONTRATO → DOCUMENTO → ASSINATURA</span><h2>Documento gerado, storage privado e situação de assinatura por venda</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Contrato</th><th>Unidade</th><th>Documentos</th><th>Provider</th><th>Assinatura</th><th>Signatários</th></tr></thead><tbody>{workspace.sales.filter((item) => item.contractId).map((item) => <tr key={item.id}><td><strong>{item.contractNumber ?? "—"}</strong></td><td>{item.unit}</td><td>{item.contractDocuments.length ? item.contractDocuments.map((doc) => statusLabel[doc.kind] ?? doc.kind).join(", ") : "—"}</td><td>{item.signatureRequest?.provider ?? "—"}</td><td>{item.signatureRequest ? <Status value={item.signatureRequest.status} /> : <span className="empty-state">Não iniciada</span>}</td><td>{item.signatureRequest ? `${item.signatureRequest.signedCount}/${item.signatureRequest.totalParties}` : "—"}</td></tr>)}</tbody></table></div></article></>}

    {area === "comissoes" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">CORRETAGEM</span><h2>Comissões — obrigação gerada exatamente uma vez</h2></div></div><div className="scenario-table"><div className="table-row table-head"><span>Corretor</span><span>Venda</span><span>Valor</span><span>Situação</span></div>{workspace.commissions.map((item) => <div className="table-row" key={item.id}><strong>{item.broker}</strong><span>{item.sale}</span><span>{brl.format(item.amount)}</span><Status value={item.status} /></div>)}</div></article>}

    {area === "posvenda" && <><article className="panel"><div className="panel-heading"><div><span className="eyebrow">VISTORIA</span><h2>Entrega e vistoria de unidades</h2></div></div><div className="scenario-table"><div className="table-row table-head"><span>Unidade</span><span>Agendada em</span><span>Resultado</span></div>{workspace.inspections.map((item) => <div className="table-row" key={item.id}><strong>{item.unit}</strong><span>{date.format(new Date(item.scheduledAt))}</span><span>{item.outcome ? statusLabel[item.outcome] ?? item.outcome : "Pendente"}</span></div>)}</div></article>
    <article className="panel"><div className="panel-heading"><div><span className="eyebrow">ATENDIMENTO PÓS-VENDA</span><h2>Solicitações, categoria e histórico</h2></div></div>{workspace.postSaleRequests.map((item) => <div className="model-note" key={item.id}><MessageSquareWarning size={20} /><div><strong>{item.unit} · {item.customer}</strong><p>{item.category.replaceAll("_", " ")} · {item.updates} atualização(ões)</p><Status value={item.status} /></div></div>)}</article></>}
  </div>;
}
