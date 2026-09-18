"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Building2, CalendarClock, HandCoins, Home, MessageSquareWarning, ReceiptText, Users } from "lucide-react";
import type { SalesWorkspaceView } from "@/application/sales/sales-service";
import { getUnitDeliveryReadinessAction } from "@/app/actions/handover";
import { HandoverOperabilityPanel } from "./handover-operability-panel";
import {
  approveSalesCommissionAction,
  completeLocalSignatureAction,
  createSalesCommissionAction,
  ensureDefaultContractTemplateAction,
  generateContractDocumentAction,
  startLocalSignatureAction,
  scheduleInspectionAction,
  recordInspectionOutcomeAction,
  markUnitDeliveredAction,
  createPostSaleRequestAction,
  addPostSaleUpdateAction,
  transitionPostSaleRequestAction,
} from "@/app/actions/sales";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlPrecise = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percentage = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const date = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
type Area = "visao" | "estoque" | "propostas" | "reservas" | "vendas" | "fechamento360" | "comissoes" | "posvenda" | "repasse" | "clientes";
const areas: { key: Area; label: string }[] = [
  { key: "visao", label: "Visão Geral" }, { key: "estoque", label: "Estoque e Preços" }, { key: "propostas", label: "Propostas" },
  { key: "reservas", label: "Reservas" }, { key: "vendas", label: "Vendas e Contratos" }, { key: "fechamento360", label: "Crédito → Contrato → Assinatura" },
  { key: "comissoes", label: "Comissões" }, { key: "posvenda", label: "Entrega e Pós-venda" },
  { key: "repasse", label: "Repasse, Chaves e Assistência" }, { key: "clientes", label: "Clientes (Cliente 360)" },
];

/** Link para o Cliente 360 (Fase 9K.4B) — mesmo nome já exibido nesta tela, agora clicável. */
function CustomerLink({ customerId, name }: { customerId: string | null; name: string }) {
  if (!customerId) return <>{name}</>;
  return <Link href={`/comercial/cliente/${customerId}`}>{name}</Link>;
}

/** Exportado para reuso no Cliente 360 (`customer-360-view.tsx`) — mesmos rótulos, nunca um segundo dicionário. */
export const statusLabel: Record<string, string> = {
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
  // Fase 9R — repasse bancário e implantação do condomínio.
  REQUESTED: "Solicitado", DISBURSED: "Liberado pelo banco", RECONCILED: "Conciliado", DIVERGENT: "Divergente",
  PLANNED: "Planejada", IMPLEMENTED: "Implantado",
  FINANCING: "Financiamento", FGTS: "FGTS", SUBSIDY: "Subsídio", OTHER: "Outro",
};

const creditResultTone: Record<string, "positive" | "negative" | "neutral"> = { SEM_RESTRICAO: "positive", COM_RESTRICAO: "negative", REQUER_ANALISE: "neutral" };

/** Exportado para reuso no Cliente 360 — mesmo componente, nunca uma segunda pílula de status. */
export function Status({ value }: { value: string }) { return <span className="status-pill">{statusLabel[value] ?? value.replaceAll("_", " ")}</span>; }

function Metrics({ workspace }: { workspace: SalesWorkspaceView }) {
  const cards = [
    ["VGV Total", workspace.summary.vgvTotal, `${workspace.summary.unitsTotal} unidades`, Building2],
    ["VGV Disponível", workspace.summary.vgvDisponivel, `${workspace.summary.unitsAvailable} unidades livres`, Home],
    ["VGV Vendido", workspace.summary.vgvVendido, `${workspace.summary.unitsSold} vendidas`, HandCoins],
    ["A Receber", workspace.summary.vgvAReceber, `${brl.format(workspace.summary.vgvRecebido)} recebidos`, ReceiptText],
  ] as const;
  return <div className="metric-grid">{cards.map(([label, value, meta, Icon]) => <article className="metric-card" key={label}><div><span>{label}</span><Icon size={17} /></div><strong>{brl.format(value)}</strong><small>{meta}</small></article>)}</div>;
}

export function SalesView({ workspace, canWrite, canApprove }: { workspace: SalesWorkspaceView; canWrite: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [area, setArea] = useState<Area>("visao");
  const [showInspectionForm, setShowInspectionForm] = useState(false);
  const [showPostSaleForm, setShowPostSaleForm] = useState(false);
  const [outcomeInspectionId, setOutcomeInspectionId] = useState<string | null>(null);
  const [editingPostSaleId, setEditingPostSaleId] = useState<string | null>(null);
  const [deliveryGate, setDeliveryGate] = useState<{
    salesUnitId: string;
    unit: string;
    overall: "APTO" | "BLOQUEADO";
    technical: { status: string; reason: string };
    legal: { status: string; reason: string };
    financial: { status: string; reason: string };
  } | null>(null);
  const approvedTemplateVersion = workspace.contractTemplates
    .flatMap((template) => template.versions.map((version) => ({ ...version, templateName: template.name })))
    .find((version) => version.status === "APPROVED") ?? null;

  const runCommercialAction = (op: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setFeedback(null);
    startTransition(async () => {
      const result = await op();
      if (!result.ok) {
        setFeedback(result.error ?? "Não foi possível concluir a operação.");
        return;
      }
      setFeedback(success);
      router.refresh();
    });
  };

  const todayValue = () => new Date().toISOString().slice(0, 10);

  const submitInspection = (form: FormData) => {
    const saleId = String(form.get("saleId"));
    const sale = workspace.sales.find((item) => item.id === saleId);
    if (!sale) return setFeedback("Venda aprovada não encontrada.");
    runCommercialAction(() => scheduleInspectionAction({
      salesUnitId: sale.salesUnitId,
      saleId: sale.id,
      scheduledAt: new Date(`${form.get("scheduledAt")}T12:00:00.000Z`),
      checklist: { source: "commercial-ui", items: ["acabamentos", "instalacoes", "esquadrias", "limpeza"] },
    }), "Vistoria agendada.");
    setShowInspectionForm(false);
  };

  const submitInspectionOutcome = (inspectionId: string, form: FormData) => {
    const outcome = String(form.get("outcome")) as "ACCEPTED" | "ACCEPTED_WITH_PENDING" | "REJECTED";
    const pendingNote = String(form.get("pendingNote") || "").trim();
    runCommercialAction(() => recordInspectionOutcomeAction({
      inspectionId,
      outcome,
      pendingIssues: pendingNote ? [{ note: pendingNote }] : [],
      nextInspectionAt: form.get("nextInspectionAt") ? new Date(`${form.get("nextInspectionAt")}T12:00:00.000Z`) : null,
    }), "Resultado da vistoria registrado.");
    setOutcomeInspectionId(null);
  };

  const submitPostSale = (form: FormData) => {
    const saleId = String(form.get("saleId"));
    const sale = workspace.sales.find((item) => item.id === saleId);
    if (!sale || !sale.buyerCustomerId) return setFeedback("Venda ou comprador principal não encontrado.");
    runCommercialAction(() => createPostSaleRequestAction({
      salesUnitId: sale.salesUnitId,
      saleId: sale.id,
      customerId: sale.buyerCustomerId,
      category: String(form.get("category")) as "GARANTIA" | "ASSISTENCIA" | "OCORRENCIA" | "OUTRO",
      description: String(form.get("description")),
      slaDueAt: form.get("slaDueAt") ? new Date(`${form.get("slaDueAt")}T12:00:00.000Z`) : null,
    }), "Solicitação de pós-venda criada.");
    setShowPostSaleForm(false);
  };

  const previewDelivery = (sale: SalesWorkspaceView["sales"][number]) => {
    startTransition(async () => {
      setFeedback(null);
      const result = await getUnitDeliveryReadinessAction(sale.salesUnitId);
      if (!result.ok) {
        setFeedback(result.error ?? "Não foi possível avaliar a prontidão da entrega.");
        return;
      }
      if (!result.data) {
        setFeedback("A venda aprovada da unidade não foi encontrada para avaliar a entrega.");
        return;
      }
      setDeliveryGate({
        salesUnitId: sale.salesUnitId,
        unit: sale.unit,
        overall: result.data.overall,
        technical: result.data.technical,
        legal: result.data.legal,
        financial: result.data.financial,
      });
    });
  };

  const submitPostSaleUpdate = (requestId: string, form: FormData) => {
    const note = String(form.get("note") || "").trim();
    const status = String(form.get("status") || "");
    startTransition(async () => {
      setFeedback(null);
      if (note) {
        const result = await addPostSaleUpdateAction({ requestId, note });
        if (!result.ok) return setFeedback(result.error ?? "Não foi possível registrar a atualização.");
      }
      if (status) {
        const result = await transitionPostSaleRequestAction({ requestId, status: status as "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED" });
        if (!result.ok) return setFeedback(result.error ?? "Não foi possível atualizar o status.");
      }
      setFeedback("Pós-venda atualizado.");
      setEditingPostSaleId(null);
      router.refresh();
    });
  };

  return <div className="view-stack">
    {!canWrite && !canApprove && <div className="model-note"><div><strong>Modo de leitura</strong><p>Seu perfil pode consultar o Comercial, mas não alterar nem aprovar registros.</p></div></div>}
    <div className="scenario-switch" aria-label="Áreas Comerciais">{areas.map((item) => <button key={item.key} className={area === item.key ? "is-active" : ""} onClick={() => setArea(item.key)}>{item.label}</button>)}</div>

    {area === "visao" && <><Metrics workspace={workspace} /><div className="metric-grid">
      <article className="metric-card"><div><span>VSO do mês</span><Users size={17} /></div><strong>{percentage.format(workspace.summary.vso)}</strong><small>{workspace.summary.salesThisMonth} venda(s) no mês</small></article>
      <article className="metric-card"><div><span>Preço/m² médio</span><Home size={17} /></div><strong>{brlPrecise.format(workspace.summary.averagePricePerM2)}</strong><small>Desconto médio {brl.format(workspace.summary.averageDiscount)}</small></article>
      <article className="metric-card"><div><span>Reservas ativas</span><CalendarClock size={17} /></div><strong>{workspace.summary.activeReservations}</strong><small>{workspace.summary.activeProposals} proposta(s) em curso</small></article>
      <article className="metric-card"><div><span>Recebíveis vencidos</span><AlertTriangle size={17} /></div><strong>{brl.format(workspace.summary.overdueReceivablesAmount)}</strong><small>{workspace.summary.overdueReceivables} parcela(s) — integrado ao Financeiro</small></article>
    </div>
    <article className="panel"><div className="panel-heading"><div><span className="eyebrow">CADEIA COMERCIAL</span><h2>Estoque → Tabela → Proposta → Reserva → Venda → Recebíveis</h2></div></div><div className="scenario-table">
      <div className="table-row table-head"><span>Estágio</span><span>Valor / Quantidade</span><span>Origem</span></div>
      {[["Disponível", brl.format(workspace.summary.vgvDisponivel), `${workspace.summary.unitsAvailable} unidades`], ["Reservado", brl.format(workspace.summary.vgvReservado), `${workspace.summary.unitsReserved} unidades`], ["Vendido", brl.format(workspace.summary.vgvVendido), `${workspace.summary.unitsSold} unidades`], ["Distratado", brl.format(workspace.summary.vgvDistratado), `${workspace.summary.unitsRescinded} unidades`], ["Recebido", brl.format(workspace.summary.vgvRecebido), "Financeiro"], ["Comissões pendentes", String(workspace.summary.pendingCommissions), "Corretores"], ["Pós-venda aberto", String(workspace.summary.openPostSaleRequests), "Atendimento"]].map((row) => <div className="table-row" key={row[0]}><strong>{row[0]}</strong><span>{row[1]}</span><span>{row[2]}</span></div>)}
    </div></article></>}

    {area === "estoque" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">ESTOQUE COMERCIAL</span><h2>Unidades, tipologia e preço vigente</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Unidade</th><th>Tipologia</th><th>Área privativa</th><th>Preço de tabela</th><th>Preço/m²</th><th>Bloqueio</th><th>Situação</th></tr></thead><tbody>{workspace.units.map((item) => <tr key={item.id}><td><strong>{item.code}</strong>{item.floor && <small> · andar {item.floor}</small>}</td><td>{item.typology}</td><td>{item.privateAreaM2.toLocaleString("pt-BR")} m²</td><td>{item.listPrice !== null ? brl.format(item.listPrice) : "—"}</td><td>{item.pricePerM2 !== null ? brlPrecise.format(item.pricePerM2) : "—"}</td><td>{item.activeBlock ? `${item.activeBlock.origin} — ${item.activeBlock.reason}` : "—"}</td><td><Status value={item.status} /></td></tr>)}</tbody></table></div></article>}

    {area === "propostas" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">NEGOCIAÇÃO</span><h2>Propostas comerciais</h2></div></div><div className="scenario-table"><div className="table-row table-head"><span>Unidade</span><span>Cliente</span><span>Preço proposto</span><span>Desconto</span><span>Válida até</span><span>Situação</span></div>{workspace.proposals.map((item) => <div className="table-row" key={item.id}><strong>{item.unit}</strong><span><CustomerLink customerId={item.customerId} name={item.customer} /></span><span>{brl.format(item.proposedPrice)}</span><span>{brl.format(item.discountAmount)}</span><span>{date.format(new Date(item.validUntil))}</span><Status value={item.status} /></div>)}</div></article>}

    {area === "reservas" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">RESERVA DE UNIDADE</span><h2>Reservas ativas, confirmadas e expiradas</h2></div></div><div className="scenario-table"><div className="table-row table-head"><span>Unidade</span><span>Cliente</span><span>Expira em</span><span>Situação</span></div>{workspace.reservations.map((item) => <div className="table-row" key={item.id}><strong>{item.unit}</strong><span><CustomerLink customerId={item.customerId} name={item.customer} /></span><span>{date.format(new Date(item.expiresAt))}</span>{item.expired ? <span className="negative-value"><AlertTriangle size={14} /> EXPIRADA</span> : <Status value={item.status} />}</div>)}</div></article>}

    {area === "vendas" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">EVENTO COMERCIAL</span><h2>Vendas, contrato e plano de pagamento</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Contrato</th><th>Unidade</th><th>Compradores</th><th>Corretor</th><th>Preço vendido</th><th>Desconto</th><th>Parcelas ativas</th><th>Recebido</th><th>Assinatura</th><th>Situação</th></tr></thead><tbody>{workspace.sales.map((item) => <tr key={item.id}><td><strong>{item.contractNumber ?? "—"}</strong></td><td>{item.unit}</td><td><CustomerLink customerId={item.buyerCustomerId} name={item.buyers.join(", ")} /></td><td>{item.broker ?? "—"}</td><td>{brl.format(item.soldPrice)}</td><td>{brl.format(item.discountAmount)}</td><td>{item.installments}</td><td>{brl.format(item.received)}</td><td>{item.signatureStatus ? <Status value={item.signatureStatus} /> : "—"}{item.signatureRequest && <small> · {item.signatureRequest.signedCount}/{item.signatureRequest.totalParties} assinaram</small>}</td><td><Status value={item.status} /></td></tr>)}</tbody></table></div></article>}

    {area === "clientes" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">CLIENTE 360</span><h2>Clientes deste empreendimento — visão consolidada por cliente</h2></div></div><div className="scenario-table"><div className="table-row table-head"><span>Cliente</span><span>Propostas</span><span>Reservas</span><span>Vendas</span><span>Pós-venda</span></div>{workspace.customers.map((item) => <div className="table-row" key={item.id}><strong><Link href={`/comercial/cliente/${item.id}`}>{item.name}</Link></strong><span>{item.proposals}</span><span>{item.reservations}</span><span>{item.sales}</span><span>{item.postSaleRequests}</span></div>)}{workspace.customers.length === 0 && <p className="empty-state">Nenhum cliente com atividade comercial neste empreendimento.</p>}</div></article>}

    {area === "fechamento360" && <><article className="panel"><div className="panel-heading"><div><span className="eyebrow">CRÉDITO</span><h2>Consulta de crédito por proposta (CPF mascarado — nunca decide a venda sozinha)</h2></div></div><div className="scenario-table"><div className="table-row table-head"><span>Unidade</span><span>Cliente</span><span>CPF</span><span>Resultado</span><span>Consultado em</span></div>{workspace.proposals.filter((item) => item.creditConsultation).map((item) => <div className="table-row" key={item.id}><strong>{item.unit}</strong><span><CustomerLink customerId={item.customerId} name={item.customer} /></span><span>{item.creditConsultation!.cpfMasked}</span><span className={item.creditConsultation!.result ? { positive: "positive-value", negative: "negative-value", neutral: undefined }[creditResultTone[item.creditConsultation!.result] ?? "neutral"] : undefined}>{item.creditConsultation!.result ? statusLabel[item.creditConsultation!.result] ?? item.creditConsultation!.result : statusLabel[item.creditConsultation!.status] ?? item.creditConsultation!.status}</span><span>{date.format(new Date(item.creditConsultation!.requestedAt))}</span></div>)}{workspace.proposals.every((item) => !item.creditConsultation) && <p className="empty-state">Nenhuma consulta de crédito registrada neste empreendimento.</p>}</div></article>

    <article className="panel">
      <div className="panel-heading">
        <div><span className="eyebrow">MODELO CONTRATUAL</span><h2>Modelos por empreendimento e versões aprovadas</h2></div>
        {!approvedTemplateVersion && <button className="button button-primary" disabled={pending} onClick={() => runCommercialAction(() => ensureDefaultContractTemplateAction(workspace.projectId), "Modelo contratual padrão criado e aprovado.")}>{pending ? "Processando..." : "Criar modelo padrão"}</button>}
      </div>
      {feedback && <div style={{ padding: "12px 16px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface-subtle)" }}><strong>{feedback}</strong></div>}
      <div className="scenario-table"><div className="table-row table-head"><span>Modelo</span><span>Situação</span><span>Versões</span></div>{workspace.contractTemplates.map((template) => <div className="table-row" key={template.id}><strong>{template.name}</strong><Status value={template.status} /><span>{template.versions.map((version) => `v${version.version} (${statusLabel[version.status] ?? version.status})`).join(", ") || "—"}</span></div>)}{workspace.contractTemplates.length === 0 && <p className="empty-state">Nenhum modelo contratual cadastrado neste empreendimento. Use “Criar modelo padrão” para iniciar o fluxo.</p>}</div>
    </article>

    <article className="panel">
      <div className="panel-heading"><div><span className="eyebrow">CONTRATO → DOCUMENTO → ASSINATURA</span><h2>Documento gerado, storage privado e situação de assinatura por venda</h2><p>No localhost, a assinatura pode ser simulada para validar o ciclo completo sem enviar nada a um provedor externo.</p></div></div>
      <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Contrato</th><th>Unidade</th><th>Documentos</th><th>Provider</th><th>Assinatura</th><th>Signatários</th><th>Ação</th></tr></thead><tbody>{workspace.sales.filter((item) => item.contractId).map((item) => {
        const generatedDocument = item.contractDocuments.find((doc) => doc.kind === "MODEL_RENDER") ?? null;
        return <tr key={item.id}>
          <td><strong>{item.contractNumber ?? "—"}</strong></td>
          <td>{item.unit}</td>
          <td>{item.contractDocuments.length ? item.contractDocuments.map((doc) => statusLabel[doc.kind] ?? doc.kind).join(", ") : "—"}</td>
          <td>{item.signatureRequest?.provider ?? "—"}</td>
          <td>{item.signatureRequest ? <Status value={item.signatureRequest.status} /> : <span className="empty-state">Não iniciada</span>}</td>
          <td>{item.signatureRequest ? `${item.signatureRequest.signedCount}/${item.signatureRequest.totalParties}` : "—"}</td>
          <td><div className="panel-actions">
            {!generatedDocument && <button className="button button-secondary" disabled={pending || !approvedTemplateVersion} onClick={() => approvedTemplateVersion && runCommercialAction(() => generateContractDocumentAction(item.contractId!, approvedTemplateVersion.id), "Documento contratual gerado.")}>{approvedTemplateVersion ? "Gerar documento" : "Crie o modelo"}</button>}
            {generatedDocument && !item.signatureRequest && <button className="button button-secondary" disabled={pending || item.buyerParties.length === 0} onClick={() => runCommercialAction(() => startLocalSignatureAction({
              contractId: item.contractId!,
              documentId: generatedDocument.id,
              parties: item.buyerParties.map((party) => ({ customerId: party.customerId, displayName: party.name, email: party.email ?? undefined, role: party.role })),
            }), "Assinatura local iniciada.")}>Iniciar assinatura local</button>}
            {item.signatureRequest?.provider === "MOCK" && ["PREPARADO", "ENVIADO", "AGUARDANDO_ASSINATURAS"].includes(item.signatureRequest.status) && <button className="button button-primary" disabled={pending} onClick={() => runCommercialAction(() => completeLocalSignatureAction(item.signatureRequest!.id), "Assinatura local concluída e documento final gerado.")}>Concluir assinatura</button>}
            {item.signatureRequest?.status === "ASSINADO" && <span className="positive-value">Fluxo concluído</span>}
          </div></td>
        </tr>;
      })}</tbody></table></div>
    </article></>}

    {area === "comissoes" && <article className="panel">
      <div className="panel-heading"><div><span className="eyebrow">CORRETAGEM</span><h2>Comissões — obrigação gerada exatamente uma vez</h2><p>Crie a comissão da venda assinada e aprove para gerar a obrigação no Financeiro.</p></div></div>
      <div className="scenario-table">
        <div className="table-row table-head"><span>Corretor</span><span>Venda</span><span>Valor</span><span>Situação</span><span>Ação</span></div>
        {workspace.commissions.map((item) => <div className="table-row" key={item.id}><strong>{item.broker}</strong><span>{item.sale}</span><span>{brl.format(item.amount)}</span><Status value={item.status} /><span>{item.status === "PENDING" ? <button className="button button-primary" disabled={pending || !canApprove} onClick={() => runCommercialAction(() => approveSalesCommissionAction(item.id), "Comissão aprovada e obrigação financeira gerada.")}>Aprovar comissão</button> : "—"}</span></div>)}
        {workspace.sales.filter((sale) => sale.status === "APPROVED" && !workspace.commissions.some((commission) => commission.sale === sale.id)).map((sale) => <div className="table-row" key={`eligible-${sale.id}`}><strong>{workspace.brokers[0]?.name ?? "Sem corretor cadastrado"}</strong><span>{sale.contractNumber ?? sale.id} · {sale.unit}</span><span>{workspace.brokers[0] ? brl.format(sale.soldPrice * 0.04) : "—"}</span><span>Não criada</span><span>{workspace.brokers[0] ? <button className="button button-secondary" disabled={pending || !canWrite} onClick={() => runCommercialAction(() => createSalesCommissionAction({ saleId: sale.id, brokerId: workspace.brokers[0].id, basis: "SOLD_PRICE", percentage: "0.04", triggerEvent: "SIGNATURE" }), "Comissão de 4% criada para a venda.")}>Criar comissão 4%</button> : "Cadastre um corretor"}</span></div>)}
        {workspace.commissions.length === 0 && workspace.sales.every((sale) => sale.status !== "APPROVED") && <p className="empty-state">Nenhuma venda aprovada disponível para comissão.</p>}
      </div>
    </article>}

    {area === "posvenda" && <>
    <article className="panel">
      <div className="panel-heading"><div><span className="eyebrow">VISTORIA</span><h2>Entrega e vistoria de unidades</h2><p>Agende, registre o resultado e, quando os gates técnico, jurídico e financeiro estiverem aptos, conclua a entrega.</p></div><button className="button button-secondary" disabled={pending || !canWrite || workspace.sales.every((sale) => sale.status !== "APPROVED")} onClick={() => setShowInspectionForm((value) => !value)}>{showInspectionForm ? "Fechar" : "Agendar vistoria"}</button></div>
      {showInspectionForm && <form className="form-grid" action={submitInspection}>
        <label>Venda<select name="saleId" required defaultValue=""><option value="" disabled>Selecione</option>{workspace.sales.filter((sale) => sale.status === "APPROVED").map((sale) => <option key={sale.id} value={sale.id}>{sale.contractNumber ?? sale.id} · {sale.unit} · {sale.buyers.join(", ")}</option>)}</select></label>
        <label>Data da vistoria<input name="scheduledAt" type="date" defaultValue={todayValue()} required /></label>
        <div className="form-actions"><button className="button button-primary" disabled={pending || !canWrite} type="submit">Agendar vistoria</button></div>
      </form>}
      <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Unidade</th><th>Agendada em</th><th>Resultado</th><th>Ação</th></tr></thead><tbody>
        {workspace.inspections.map((item) => <tr key={item.id}><td><strong>{item.unit}</strong></td><td>{date.format(new Date(item.scheduledAt))}</td><td>{item.outcome ? statusLabel[item.outcome] ?? item.outcome : "Pendente"}</td><td>
          {!item.outcome && outcomeInspectionId !== item.id && <button className="text-button" disabled={pending || !canWrite} onClick={() => setOutcomeInspectionId(item.id)}>Registrar resultado</button>}
          {outcomeInspectionId === item.id && <form style={{ display: "grid", gap: 6 }} action={(form) => submitInspectionOutcome(item.id, form)}>
            <select name="outcome" defaultValue="ACCEPTED"><option value="ACCEPTED">Aceita</option><option value="ACCEPTED_WITH_PENDING">Aceita com pendências</option><option value="REJECTED">Rejeitada</option></select>
            <input name="pendingNote" placeholder="Pendência observada (opcional)" />
            <label>Nova vistoria, se necessária<input name="nextInspectionAt" type="date" /></label>
            <div className="panel-actions"><button className="text-button" type="submit" disabled={pending || !canWrite}>Salvar</button><button className="text-button" type="button" onClick={() => setOutcomeInspectionId(null)}>Cancelar</button></div>
          </form>}
        </td></tr>)}
        {workspace.inspections.length === 0 && <tr><td colSpan={4}>Nenhuma vistoria agendada.</td></tr>}
      </tbody></table></div>
      <div className="scenario-table"><div className="table-row table-head"><span>Unidade vendida</span><span>Contrato</span><span>Entrega</span></div>
        {workspace.sales.filter((sale) => sale.status === "APPROVED").map((sale) => <div className="table-row" key={`delivery-${sale.id}`}><strong>{sale.unit}</strong><span>{sale.contractNumber ?? "—"}</span><span><div className="panel-actions"><button className="button button-secondary" disabled={pending} onClick={() => previewDelivery(sale)}>Verificar prontidão</button><button className="button button-primary" disabled={pending || !canApprove} onClick={() => runCommercialAction(() => markUnitDeliveredAction(sale.salesUnitId), "Unidade marcada como entregue.")}>Concluir entrega</button></div></span></div>)}
      </div>
      {deliveryGate && <div className="model-note"><AlertTriangle size={20} /><div style={{ width: "100%" }}><strong>{deliveryGate.unit} · prontidão da entrega: {deliveryGate.overall === "APTO" ? "APTA" : "BLOQUEADA"}</strong><div className="scenario-table" style={{ marginTop: 10 }}><div className="table-row table-head"><span>Gate</span><span>Status</span><span>Motivo</span></div><div className="table-row"><strong>Técnico</strong><span>{deliveryGate.technical.status}</span><span>{deliveryGate.technical.reason}</span></div><div className="table-row"><strong>Jurídico</strong><span>{deliveryGate.legal.status}</span><span>{deliveryGate.legal.reason}</span></div><div className="table-row"><strong>Financeiro</strong><span>{deliveryGate.financial.status}</span><span>{deliveryGate.financial.reason}</span></div></div><div className="panel-actions"><button className="text-button" type="button" onClick={() => setDeliveryGate(null)}>Fechar diagnóstico</button></div></div></div>}
    </article>

    <article className="panel">
      <div className="panel-heading"><div><span className="eyebrow">ATENDIMENTO PÓS-VENDA</span><h2>Solicitações, categoria e histórico</h2></div><button className="button button-secondary" disabled={pending || !canWrite || workspace.sales.every((sale) => sale.status !== "APPROVED")} onClick={() => setShowPostSaleForm((value) => !value)}>{showPostSaleForm ? "Fechar" : "Nova solicitação"}</button></div>
      {showPostSaleForm && <form className="form-grid" action={submitPostSale}>
        <label>Venda<select name="saleId" required defaultValue=""><option value="" disabled>Selecione</option>{workspace.sales.filter((sale) => sale.status === "APPROVED").map((sale) => <option key={sale.id} value={sale.id}>{sale.contractNumber ?? sale.id} · {sale.unit} · {sale.buyers.join(", ")}</option>)}</select></label>
        <label>Categoria<select name="category" defaultValue="ASSISTENCIA"><option value="GARANTIA">Garantia</option><option value="ASSISTENCIA">Assistência</option><option value="OCORRENCIA">Ocorrência</option><option value="OUTRO">Outro</option></select></label>
        <label>Prazo SLA<input name="slaDueAt" type="date" /></label>
        <label style={{ gridColumn: "1 / -1" }}>Descrição<textarea name="description" rows={3} required /></label>
        <div className="form-actions"><button className="button button-primary" disabled={pending || !canWrite} type="submit">Abrir solicitação</button></div>
      </form>}
      {workspace.postSaleRequests.map((item) => <div className="model-note" key={item.id}><MessageSquareWarning size={20} /><div style={{ width: "100%" }}><strong>{item.unit} · {item.customer}</strong><p>{item.category.replaceAll("_", " ")} · {item.updates} atualização(ões){item.slaDueAt ? ` · SLA ${date.format(new Date(item.slaDueAt))}` : ""}</p><Status value={item.status} />{item.slaViolated && <span className="negative-value"><AlertTriangle size={14} /> SLA vencido</span>}
        <div className="panel-actions"><button className="text-button" disabled={pending || !canWrite} onClick={() => setEditingPostSaleId(editingPostSaleId === item.id ? null : item.id)}>{editingPostSaleId === item.id ? "Fechar" : "Atualizar"}</button></div>
        {editingPostSaleId === item.id && <form className="form-grid" action={(form) => submitPostSaleUpdate(item.id, form)}>
          <label style={{ gridColumn: "1 / -1" }}>Atualização<textarea name="note" rows={2} placeholder="Descreva o andamento ou atendimento realizado" /></label>
          <label>Situação<select name="status" defaultValue={item.status}><option value="OPEN">Aberta</option><option value="IN_PROGRESS">Em andamento</option><option value="WAITING_CUSTOMER">Aguardando cliente</option><option value="RESOLVED">Resolvida</option><option value="CLOSED">Encerrada</option></select></label>
          <div className="form-actions"><button className="button button-primary" type="submit" disabled={pending || !canWrite}>Salvar atualização</button></div>
        </form>}
      </div></div>)}
      {workspace.postSaleRequests.length === 0 && <p className="empty-state">Nenhuma solicitação de pós-venda neste empreendimento.</p>}
    </article>
  </>}

    {area === "repasse" && <HandoverOperabilityPanel workspace={workspace} canWrite={canWrite} />}
  </div>;
}
