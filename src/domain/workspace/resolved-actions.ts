/**
 * Tradutores puros de fato de módulo CONCLUÍDO → Exceção Executiva com `status: "RESOLVIDA"`
 * (Fase 9K.3, plano §L "Contrato de Ação"). Espelha `exception-builders.ts` (mesmo princípio de
 * não-duplicação: nenhuma função aqui persiste nada, todas traduzem dados já buscados) mas para o
 * lado oposto do contrato — "recentemente concluída" em vez de "aberta".
 *
 * `resolvedAt` vem SEMPRE de um timestamp real do fato de origem (`LegalObligation.fulfilledAt`,
 * `PayablePayment.paidAt`/`ReceivablePayment.receivedAt`, `ApprovalRequest.completedAt`) — nunca um
 * carimbo de UX/leitura. Quando a origem não tem um timestamp real de conclusão, o item
 * simplesmente não é emitido (ver `src/application/actions/action-queries.ts`) em vez de inventar
 * um valor.
 *
 * Severidade sempre `"NORMAL"`: um item resolvido não é mais um alerta acionável — é só o registro
 * de que algo importante foi concluído recentemente (mesma leitura que `mapLegalAlertSeverity`
 * aplica a `LegalAlert.status === "RESOLVED"`).
 *
 * Idempotência (plano §AQ): cada builder usa um `type` de exceção diferente do seu equivalente
 * "aberto" em `exception-builders.ts` (ex.: `obligation_fulfilled` vs. `obligation_due`) — o mesmo
 * registro de origem nunca pode produzir dois ids iguais entre os dois lados, e a query de origem
 * de cada lado já filtra por status mutuamente exclusivos (ver comentário em cada função aqui), o
 * que também impede o mesmo fato aparecer como ABERTA e RESOLVIDA ao mesmo tempo.
 */
import { buildExceptionId, type ExecutiveException } from "./exceptions";
import type { ExceptionTenantContext } from "./exception-builders";

const NORMAL: ExecutiveException["severity"] = "NORMAL";

// ---------------------------------------------------------------------------
// Jurídico — obrigações cumpridas (`LegalObligation.status === "FULFILLED"`, mutuamente exclusivo
// com o filtro `notIn: ["FULFILLED", "WAIVED", "CANCELLED"]` usado pelo lado aberto).
// ---------------------------------------------------------------------------

export interface ResolvedLegalObligationSignal {
  id: string;
  code: string;
  title: string;
  /** `LegalObligation.fulfilledAt` — timestamp real de conclusão, nunca inferido. */
  fulfilledAt: Date;
  amount: number | null;
  responsibleId?: string | null;
}

export function buildResolvedLegalExceptions(ctx: ExceptionTenantContext, obligations: ResolvedLegalObligationSignal[]): ExecutiveException[] {
  return obligations.map((obligation) => ({
    id: buildExceptionId(ctx.organizationId, "legal", "obligation_fulfilled", obligation.id),
    organizationId: ctx.organizationId,
    economicGroupId: ctx.economicGroupId,
    companyId: ctx.companyId,
    projectId: ctx.projectId,
    projectName: ctx.projectName,
    domain: "legal",
    type: "obligation_fulfilled",
    title: `Obrigação cumprida: ${obligation.title}`,
    summary: `${obligation.title} (${obligation.code})${obligation.amount ? ` · R$ ${obligation.amount.toLocaleString("pt-BR")}` : ""}`,
    severity: NORMAL,
    impact: { legal: true, financial: obligation.amount ?? undefined },
    materialityValue: obligation.amount,
    dueDate: null,
    confidence: "ALTA",
    source: "REDE",
    occurredAt: obligation.fulfilledAt.toISOString(),
    href: "/juridico",
    reason: "Obrigação marcada como cumprida na origem (LegalObligation.status = FULFILLED).",
    responsibleId: obligation.responsibleId,
    status: "RESOLVIDA",
    resolvedAt: obligation.fulfilledAt.toISOString(),
    evidence: [obligation.code],
  }));
}

// ---------------------------------------------------------------------------
// Financeiro — parcelas pagas/recebidas (`status === "PAGA"`/`"RECEBIDA"`, mutuamente exclusivo com
// `PAYABLE_TERMINAL_STATUSES`/`RECEIVABLE_TERMINAL_STATUSES` do lado aberto, que já as exclui).
// ---------------------------------------------------------------------------

export interface ResolvedInstallmentSignal {
  id: string;
  description: string;
  counterpartyName: string | null;
  amount: number;
  /** Timestamp real do evento de liquidação (`PayablePayment.paidAt`/`ReceivablePayment.receivedAt`), nunca `updatedAt` da parcela. */
  completedAt: Date;
  responsibleId?: string | null;
}

function buildResolvedInstallments(ctx: ExceptionTenantContext, items: ResolvedInstallmentSignal[], type: "payable_paid" | "receivable_received", noun: string, href: string): ExecutiveException[] {
  return items.map((item) => ({
    id: buildExceptionId(ctx.organizationId, "financial", type, item.id),
    organizationId: ctx.organizationId,
    economicGroupId: ctx.economicGroupId,
    companyId: ctx.companyId,
    projectId: ctx.projectId,
    projectName: ctx.projectName,
    domain: "financial",
    type,
    title: `${noun} concluída: ${item.description}`,
    summary: `${item.description}${item.counterpartyName ? ` · ${item.counterpartyName}` : ""} · R$ ${item.amount.toLocaleString("pt-BR")}`,
    severity: NORMAL,
    impact: { financial: item.amount },
    materialityValue: item.amount,
    dueDate: null,
    confidence: "ALTA",
    source: "REDE",
    occurredAt: item.completedAt.toISOString(),
    href,
    reason: `${noun} liquidada em ${item.completedAt.toISOString().slice(0, 10)}.`,
    responsibleId: item.responsibleId,
    status: "RESOLVIDA",
    resolvedAt: item.completedAt.toISOString(),
    evidence: [item.id],
  }));
}

export function buildResolvedFinancialExceptions(ctx: ExceptionTenantContext, payables: ResolvedInstallmentSignal[], receivables: ResolvedInstallmentSignal[]): ExecutiveException[] {
  return [
    ...buildResolvedInstallments(ctx, payables, "payable_paid", "Conta a pagar", "/financeiro"),
    ...buildResolvedInstallments(ctx, receivables, "receivable_received", "Conta a receber", "/financeiro"),
  ];
}

// ---------------------------------------------------------------------------
// Decisões/Aprovações concluídas (`ApprovalRequest.status` in `APPROVED`/`REJECTED`, mutuamente
// exclusivo com `status: "PENDING"` do lado aberto).
// ---------------------------------------------------------------------------

export interface ResolvedApprovalSignal {
  id: string;
  actType: string;
  entityType: string;
  amount: number;
  /** `ApprovalRequest.completedAt` — timestamp real da decisão. */
  completedAt: Date;
  decision: "APPROVED" | "REJECTED";
  projectId: string | null;
  projectName: string | null;
  requestedById?: string;
  requiredRole?: import("@prisma/client").MembershipRole | null;
}

export function buildResolvedApprovalExceptions(organizationId: string, requests: ResolvedApprovalSignal[]): ExecutiveException[] {
  return requests.map((request) => ({
    id: buildExceptionId(organizationId, "approvals", "request_completed", request.id),
    organizationId,
    projectId: request.projectId,
    projectName: request.projectName,
    domain: "approvals",
    type: "request_completed",
    title: `Aprovação ${request.decision === "APPROVED" ? "aprovada" : "rejeitada"}: ${request.entityType}`,
    summary: `${request.actType} · R$ ${request.amount.toLocaleString("pt-BR")} · decidida em ${request.completedAt.toISOString().slice(0, 10)}`,
    severity: NORMAL,
    impact: { financial: request.amount },
    materialityValue: request.amount,
    dueDate: null,
    confidence: "ALTA",
    source: "REDE",
    occurredAt: request.completedAt.toISOString(),
    href: request.entityType === "SALE" ? "/comercial" : "/suprimentos",
    reason: `Alçada decidiu: ${request.decision === "APPROVED" ? "aprovado" : "rejeitado"} (ApprovalRequest.status = ${request.decision}).`,
    // Mesma decisão de `buildApprovalExceptions` (lado aberto): quem decide é uma alçada (role), não
    // uma pessoa atribuída — nunca inventar um responsável aqui (plano §4/§M).
    status: "RESOLVIDA",
    resolvedAt: request.completedAt.toISOString(),
    evidence: [request.id, ...(request.requestedById ? [request.requestedById] : [])],
    approvalCapability: request.requiredRole ? { requiredRole: request.requiredRole } : null,
  }));
}
