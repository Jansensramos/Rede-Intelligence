/**
 * Fase 9L — camada transversal de Operação Viva.
 *
 * Não persiste nem duplica fatos: transforma a Ação Canônica já derivada dos módulos oficiais em
 * evento, próximo passo e resumo operacional. Todas as funções são puras e idempotentes.
 */
import type { CanonicalSeverity } from "./severity";
import type { ExecutiveDomain, ExecutiveException } from "./exceptions";

export type OperationalEventProcessingStatus = "DETECTADO" | "PROCESSADO";
export type AutomationLevel = "RECOMENDAR" | "PREPARAR" | "EXECUTAR";

export interface CanonicalOperationalEvent {
  id: string;
  organizationId: string;
  projectId?: string | null;
  domain: ExecutiveDomain;
  eventType: string;
  sourceType: string;
  sourceId: string;
  occurredAt: string;
  detectedAt: string;
  severity: CanonicalSeverity;
  materialityValue?: number | null;
  evidence: string[];
  href: string;
  processingStatus: OperationalEventProcessingStatus;
}

export interface RecommendedNextStep {
  what: string;
  why: string;
  dueDate?: string | null;
  responsibleId?: string | null;
  impact: string;
  evidence: string[];
  source: string;
  href: string;
}

export interface OperationalAutomation {
  level: Exclude<AutomationLevel, "EXECUTAR">;
  preparedAction?: string;
  requiresHumanConfirmation: true;
}

export type OperationalAction = ExecutiveException & {
  operationalEvent: CanonicalOperationalEvent;
  nextStep: RecommendedNextStep;
  automation: OperationalAutomation;
};

const sourceTypeByActionType: Record<string, string> = {
  obligation_due: "LegalObligation",
  license_expiring: "LegalLicense",
  payable_due: "PayableInstallment",
  receivable_due: "ReceivableInstallment",
  receivable_overdue: "ReceivableInstallment",
  sale_awaiting_approval: "Sale",
  credit_review_required: "CreditBureauConsultation",
  signature_pending: "SignatureRequest",
  signature_failed: "SignatureRequest",
  critical_need: "ProcurementNeed",
  measurement_pending: "MeasurementCertificate",
  budget_variance: "BudgetLineItem",
  installation_health: "ConnectorInstallation",
  pending_request: "ApprovalRequest",
  condition_pending: "FundingCondition",
  covenant_at_risk: "FundingCovenant",
  disbursement_delayed: "FundingDisbursement",
  disbursement_blocked: "FundingDisbursement",
  proposal_awaiting_decision: "FundingProposal",
};

export function buildOperationalEventId(organizationId: string, eventType: string, sourceType: string, sourceId: string): string {
  return [organizationId, "operational-event", eventType, sourceType, sourceId].join(":");
}

export function actionToOperationalEvent(action: ExecutiveException, detectedAt = action.occurredAt): CanonicalOperationalEvent {
  const sourceType = sourceTypeByActionType[action.type] ?? "OperationalFact";
  // `evidence[0]` é um código de negócio (ex.: `FundingCondition.code`, `LegalLicense.code`), útil
  // para exibição, mas só é único dentro de um escopo menor que a organização (`@@unique([proposalId,
  // code])`, `@@unique([projectId, code, version])` etc. — ver schema). Usar `evidence[0]` como parte
  // do identificador do evento canônico colidiria entre fatos de proposals/projetos diferentes que
  // reaproveitam o mesmo código (ex.: duas propostas com condição "CP-01"). `action.id` já é
  // determinístico e globalmente único (`buildExceptionId` inclui o id real do registro) — é a única
  // parte usada para IDENTIDADE. `sourceId` continua vindo da evidência, só para referência/exibição.
  const sourceId = action.evidence[0] ?? action.id;
  return {
    id: buildOperationalEventId(action.organizationId, action.type, sourceType, action.id),
    organizationId: action.organizationId,
    projectId: action.projectId,
    domain: action.domain,
    eventType: action.type,
    sourceType,
    sourceId,
    occurredAt: action.occurredAt,
    detectedAt,
    severity: action.severity,
    materialityValue: action.materialityValue,
    evidence: [...action.evidence],
    href: action.href,
    processingStatus: "PROCESSADO",
  };
}

function impactLabel(action: ExecutiveException): string {
  const impacts: string[] = [];
  if (action.impact?.financial != null) impacts.push(`Impacto financeiro de R$ ${action.impact.financial.toLocaleString("pt-BR")}`);
  if (action.impact?.schedule) impacts.push("Pode impactar o cronograma");
  if (action.impact?.legal) impacts.push("Possui impacto jurídico");
  return impacts.join(" · ") || "Impacto operacional a avaliar";
}

function recommendationFor(action: ExecutiveException): Pick<RecommendedNextStep, "what" | "why"> & Pick<OperationalAutomation, "level" | "preparedAction"> {
  switch (action.type) {
    case "payable_due":
      return { what: "Validar documentos e preparar a solicitação de aprovação do pagamento.", why: action.reason, level: "PREPARAR", preparedAction: "Solicitação de aprovação de pagamento" };
    case "receivable_due":
    case "receivable_overdue":
      return { what: "Validar o saldo e preparar a cobrança ao cliente.", why: action.reason, level: "PREPARAR", preparedAction: "Rascunho de cobrança" };
    case "license_expiring":
      return { what: "Preparar o checklist e a documentação para renovação da licença.", why: action.reason, level: "PREPARAR", preparedAction: "Checklist de renovação" };
    case "obligation_due":
      return { what: "Revisar a obrigação e preparar as evidências necessárias para cumprimento.", why: action.reason, level: "PREPARAR", preparedAction: "Checklist de cumprimento" };
    case "critical_need":
      return { what: "Preparar a requisição de compra e comparar prazo de contratação com o cronograma.", why: action.reason, level: "PREPARAR", preparedAction: "Requisição de compra" };
    case "measurement_pending":
      return { what: "Revisar evidências da medição e preparar a solicitação de aprovação.", why: action.reason, level: "PREPARAR", preparedAction: "Solicitação de aprovação da medição" };
    case "condition_pending":
      return { what: "Preparar o checklist da condição precedente e reunir as evidências faltantes.", why: action.reason, level: "PREPARAR", preparedAction: "Checklist da condição precedente" };
    case "covenant_at_risk":
      return { what: "Revisar a memória de cálculo e preparar uma análise de impacto para decisão humana.", why: action.reason, level: "PREPARAR", preparedAction: "Análise de impacto da cláusula financeira" };
    case "pending_request":
      return { what: "Revisar a solicitação e registrar a decisão no módulo de origem.", why: action.reason, level: "RECOMENDAR" };
    case "signature_pending":
    case "signature_failed":
      return { what: "Revisar a solicitação de assinatura e preparar o contato com as partes.", why: action.reason, level: "PREPARAR", preparedAction: "Lembrete de assinatura" };
    case "sale_awaiting_approval":
    case "credit_review_required":
    case "proposal_awaiting_decision":
      return { what: "Revisar as evidências e encaminhar para decisão humana.", why: action.reason, level: "RECOMENDAR" };
    case "disbursement_delayed":
    case "disbursement_blocked":
      return { what: "Confirmar condições e preparar o acompanhamento do desembolso com o agente financeiro.", why: action.reason, level: "PREPARAR", preparedAction: "Acompanhamento de desembolso" };
    case "budget_variance":
      return { what: "Preparar comparação da variação e análise de impacto antes de qualquer alteração orçamentária.", why: action.reason, level: "PREPARAR", preparedAction: "Comparação orçamentária" };
    default:
      return { what: "Abrir o registro de origem, validar o fato e definir a providência com o responsável.", why: action.reason, level: "RECOMENDAR" };
  }
}

export function enrichOperationalAction(action: ExecutiveException): OperationalAction {
  const recommendation = recommendationFor(action);
  return {
    ...action,
    operationalEvent: actionToOperationalEvent(action),
    nextStep: {
      what: recommendation.what,
      why: recommendation.why,
      dueDate: action.dueDate,
      responsibleId: action.responsibleId,
      impact: impactLabel(action),
      evidence: [...action.evidence],
      source: action.source,
      href: action.href,
    },
    automation: {
      level: recommendation.level,
      preparedAction: recommendation.preparedAction,
      requiresHumanConfirmation: true,
    },
  };
}

/** Mesmo fato + mesma regra produz uma única ação, preservando o primeiro resultado canônico. */
export function deriveOperationalActions(actions: ExecutiveException[]): OperationalAction[] {
  const byId = new Map<string, OperationalAction>();
  for (const action of actions) {
    const enriched = enrichOperationalAction(action);
    if (!byId.has(enriched.id)) byId.set(enriched.id, enriched);
  }
  return [...byId.values()];
}

export interface DailyOperationalSummary {
  totalOpen: number;
  criticalActions: number;
  overdueActions: number;
  importantPayments: number;
  overdueReceivables: number;
  pendingApprovals: number;
  fundingConditions: number;
  procurementRisks: number;
  lines: string[];
}

const isoDay = (value: string | Date) => (typeof value === "string" ? value : value.toISOString()).slice(0, 10);

export function buildDailyOperationalSummary(actions: ExecutiveException[], referenceDate: Date): DailyOperationalSummary {
  const open = actions.filter((item) => item.status === "ABERTA");
  const today = isoDay(referenceDate);
  const overdueActions = open.filter((item) => item.dueDate != null && isoDay(item.dueDate) < today).length;
  const summary: DailyOperationalSummary = {
    totalOpen: open.length,
    criticalActions: open.filter((item) => item.severity === "CRITICO").length,
    overdueActions,
    importantPayments: open.filter((item) => item.type === "payable_due").length,
    overdueReceivables: open.filter((item) => item.type === "receivable_due" || item.type === "receivable_overdue").length,
    pendingApprovals: open.filter((item) => item.type === "pending_request").length,
    fundingConditions: open.filter((item) => item.type === "condition_pending").length,
    procurementRisks: open.filter((item) => item.type === "critical_need").length,
    lines: [],
  };
  const counts: Array<[number, string]> = [
    [summary.criticalActions, "ação(ões) crítica(s)"],
    [summary.importantPayments, "pagamento(s) importante(s)"],
    [summary.overdueReceivables, "recebível(is) vencido(s) ou próximo(s)"],
    [summary.pendingApprovals, "aprovação(ões) pendente(s)"],
    [summary.fundingConditions, "condição(ões) de financiamento"],
    [summary.procurementRisks, "compra(s) que pode(m) impactar a obra"],
  ];
  summary.lines = counts.filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`);
  return summary;
}

function routineRank(action: ExecutiveException, referenceDate: Date): number {
  const today = isoDay(referenceDate);
  const due = action.dueDate ? isoDay(action.dueDate) : null;
  if (action.severity === "CRITICO" && due && due < today) return 0;
  if (action.severity === "CRITICO" && due === today) return 1;
  if (action.type === "pending_request") return 2;
  if ((action.severity === "CRITICO" || action.severity === "ACAO_NECESSARIA") && due && due > today) return 3;
  return 4;
}

/** Ordem da Minha Rotina: críticas vencidas → críticas de hoje → aprovações → próximas com risco → demais. */
export function sortRoutinePriority(actions: ExecutiveException[], referenceDate: Date): ExecutiveException[] {
  return [...actions].sort((a, b) => routineRank(a, referenceDate) - routineRank(b, referenceDate) || (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity));
}

/** A Fase 9L inicial jamais executa automaticamente uma ação crítica ou de negócio. */
export function isAutomaticExecutionAllowed(action: ExecutiveException): false {
  void action; // assinatura preparada para política futura; 9L inicial bloqueia qualquer execução.
  return false;
}
