/**
 * Tradutores puros de fato de módulo → Exceção Executiva (Fase 9K.2, plano §I "Gestão por
 * Exceção" + §L "Contrato de Ação", ordem de serviço §3/§5). Cada função aqui recebe dados já
 * buscados (shapes simples, sem tipo do Prisma) e devolve `ExecutiveException[]` — sem I/O, o que
 * torna a classificação de severidade/materialidade testável sem PostgreSQL (ordem de serviço §22).
 *
 * Princípio de não-duplicação (ordem de serviço §4): nenhuma função aqui persiste nada — todas
 * calculam severidade a partir dos MESMOS campos que o módulo de origem já expõe como oficiais
 * (`LegalObligation.dueAt`, `PayableInstallment.dueDate`, ...), nunca a partir de um `LegalAlert`/
 * cópia derivada, para não arriscar contagem dupla entre o fato e sua cópia.
 */
import { daysUntil, DEFAULT_LEGAL_MILESTONES, milestonesReached, type DeadlineMilestone } from "@/domain/legal/engine";
import { isCriticalPurchase, requiredContractingDate } from "@/domain/procurement/engine";
import { classifyDueSeverity } from "@/domain/financial-ops/engine";
import type { BudgetBridgeRow } from "@/domain/operations/operations-engine";
import { classifyInstallationState, type InstallationStateInput, type InstallationUiState } from "@/domain/integrations/installation-state";
import { buildExceptionId, type ExecutiveException, type ExecutiveExceptionConfidence } from "./exceptions";
import { mapFinancialDueSeverity, mapIntegrationUiState, mapLegalAlertSeverity, mapMaterialityLevel, mapRiskFindingSeverity, type LegalCriticality } from "./severity";

const ALTA: ExecutiveExceptionConfidence = "ALTA";

export interface ExceptionTenantContext {
  organizationId: string;
  economicGroupId?: string | null;
  companyId?: string | null;
  projectId: string;
  projectName: string;
}

const legalCriticalityRank: LegalCriticality[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

/** Pior criticidade entre os marcos de prazo já atingidos (D-90..D-7, VENCIDO) — nunca inventa marco fora da régua oficial do módulo Jurídico. */
function worstMilestoneCriticality(dueAt: Date, referenceDate: Date, milestones: DeadlineMilestone[] = DEFAULT_LEGAL_MILESTONES): LegalCriticality | null {
  const reached = milestonesReached(dueAt, referenceDate, milestones);
  if (reached.length === 0) return null;
  return reached.reduce<LegalCriticality>((worst, item) => (legalCriticalityRank.indexOf(item.criticality) > legalCriticalityRank.indexOf(worst) ? item.criticality : worst), "LOW");
}

// ---------------------------------------------------------------------------
// Jurídico — obrigações e licenças (plano §7 "JURÍDICO"; severidade via mapLegalAlertSeverity)
// ---------------------------------------------------------------------------

export interface LegalObligationSignal {
  id: string;
  code: string;
  title: string;
  dueAt: Date;
  amount: number | null;
  /** `LegalObligation.responsibleId` — campo obrigatório na origem (plano §L, "responsavelId"). */
  responsibleId?: string;
}

export interface LegalLicenseSignal {
  id: string;
  code: string;
  title: string;
  expiresAt: Date;
  /** `LegalLicense.responsibleId` — campo obrigatório na origem. */
  responsibleId?: string;
}

export function buildLegalExceptions(ctx: ExceptionTenantContext, obligations: LegalObligationSignal[], licenses: LegalLicenseSignal[], referenceDate: Date): ExecutiveException[] {
  const exceptions: ExecutiveException[] = [];

  for (const obligation of obligations) {
    const criticality = worstMilestoneCriticality(obligation.dueAt, referenceDate);
    if (!criticality) continue;
    const severity = mapLegalAlertSeverity("OPEN", criticality);
    if (severity === "NORMAL") continue;
    const days = daysUntil(obligation.dueAt, referenceDate);
    exceptions.push({
      id: buildExceptionId(ctx.organizationId, "legal", "obligation_due", obligation.id),
      organizationId: ctx.organizationId,
      economicGroupId: ctx.economicGroupId,
      companyId: ctx.companyId,
      projectId: ctx.projectId,
      projectName: ctx.projectName,
      domain: "legal",
      type: "obligation_due",
      title: days < 0 ? `Obrigação vencida: ${obligation.title}` : `Obrigação ${obligation.code} vence em ${days} dia(s)`,
      summary: `${obligation.title} (${obligation.code})${obligation.amount ? ` · R$ ${obligation.amount.toLocaleString("pt-BR")}` : ""}`,
      severity,
      impact: { legal: true, financial: obligation.amount ?? undefined },
      materialityValue: obligation.amount,
      dueDate: obligation.dueAt.toISOString(),
      confidence: ALTA,
      source: "REDE",
      occurredAt: referenceDate.toISOString(),
      href: "/juridico",
      reason: days < 0 ? `Vencida há ${Math.abs(days)} dia(s).` : `Vence em ${days} dia(s) (marco ${criticality}).`,
      responsibleId: obligation.responsibleId,
      status: "ABERTA",
      evidence: [obligation.code],
    });
  }

  for (const license of licenses) {
    const criticality = worstMilestoneCriticality(license.expiresAt, referenceDate);
    if (!criticality) continue;
    const severity = mapLegalAlertSeverity("OPEN", criticality);
    if (severity === "NORMAL") continue;
    const days = daysUntil(license.expiresAt, referenceDate);
    exceptions.push({
      id: buildExceptionId(ctx.organizationId, "legal", "license_expiring", license.id),
      organizationId: ctx.organizationId,
      economicGroupId: ctx.economicGroupId,
      companyId: ctx.companyId,
      projectId: ctx.projectId,
      projectName: ctx.projectName,
      domain: "legal",
      type: "license_expiring",
      title: days < 0 ? `Licença vencida: ${license.title}` : `Licença ${license.code} vence em D-${days}`,
      summary: `${license.title} (${license.code})`,
      severity,
      impact: { legal: true },
      materialityValue: null,
      dueDate: license.expiresAt.toISOString(),
      confidence: ALTA,
      source: "REDE",
      occurredAt: referenceDate.toISOString(),
      href: "/juridico",
      reason: days < 0 ? `Vencida há ${Math.abs(days)} dia(s).` : `Vence em D-${days} (marco ${criticality}).`,
      responsibleId: license.responsibleId,
      status: "ABERTA",
      evidence: [license.code],
    });
  }

  return exceptions;
}

// ---------------------------------------------------------------------------
// Financeiro — parcelas vencidas/a vencer (plano §7 "FINANCEIRO"; severidade via classifyDueSeverity)
// ---------------------------------------------------------------------------

export interface InstallmentSignal {
  id: string;
  description: string;
  counterpartyName: string | null;
  dueDate: Date;
  balance: number;
  /** `PayableAccount.responsibleId`/`ReceivableAccount.responsibleId` — opcional na origem (plano §L). Nunca inventado quando ausente. */
  responsibleId?: string | null;
}

export function buildFinancialExceptions(
  ctx: ExceptionTenantContext,
  payables: InstallmentSignal[],
  receivables: InstallmentSignal[],
  referenceDate: Date,
): ExecutiveException[] {
  const build = (items: InstallmentSignal[], type: "payable_due" | "receivable_due", noun: string): ExecutiveException[] =>
    items
      .filter((item) => item.balance > 0.005)
      .map((item): ExecutiveException | null => {
        const days = daysUntil(item.dueDate, referenceDate);
        const severity = mapFinancialDueSeverity(classifyDueSeverity(days));
        if (severity === "NORMAL") return null;
        return {
          id: buildExceptionId(ctx.organizationId, "financial", type, item.id),
          organizationId: ctx.organizationId,
          economicGroupId: ctx.economicGroupId,
          companyId: ctx.companyId,
          projectId: ctx.projectId,
          projectName: ctx.projectName,
          domain: "financial",
          type,
          title: days < 0 ? `${noun} vencida: ${item.description}` : `${noun} vence em ${days} dia(s): ${item.description}`,
          summary: `${item.description}${item.counterpartyName ? ` · ${item.counterpartyName}` : ""} · R$ ${item.balance.toLocaleString("pt-BR")}`,
          severity,
          impact: { financial: item.balance },
          materialityValue: item.balance,
          dueDate: item.dueDate.toISOString(),
          confidence: ALTA,
          source: "REDE",
          occurredAt: referenceDate.toISOString(),
          href: "/financeiro",
          reason: days < 0 ? `Saldo em aberto vencido há ${Math.abs(days)} dia(s).` : `Vence em ${days} dia(s) (janela de alerta ≤ 3 dias).`,
          responsibleId: item.responsibleId,
          status: "ABERTA",
          evidence: [item.id],
        } satisfies ExecutiveException;
      })
      .filter((item): item is ExecutiveException => item !== null);

  return [...build(payables, "payable_due", "Conta a pagar"), ...build(receivables, "receivable_due", "Conta a receber")];
}

// ---------------------------------------------------------------------------
// Comercial — recebíveis inadimplentes (plano §7 "COMERCIAL")
// ---------------------------------------------------------------------------

export function buildSalesExceptions(ctx: ExceptionTenantContext, overdueReceivables: InstallmentSignal[], referenceDate: Date): ExecutiveException[] {
  return overdueReceivables
    .filter((item) => item.balance > 0.005)
    .map((item) => {
      const days = Math.abs(daysUntil(item.dueDate, referenceDate));
      return {
        id: buildExceptionId(ctx.organizationId, "sales", "receivable_overdue", item.id),
        organizationId: ctx.organizationId,
        economicGroupId: ctx.economicGroupId,
        companyId: ctx.companyId,
        projectId: ctx.projectId,
        projectName: ctx.projectName,
        domain: "sales",
        type: "receivable_overdue",
        title: `Inadimplência: ${item.description}`,
        summary: `${item.counterpartyName ?? "Cliente"} · R$ ${item.balance.toLocaleString("pt-BR")} · vencida há ${days} dia(s)`,
        severity: "ACAO_NECESSARIA" as const,
        impact: { financial: item.balance },
        materialityValue: item.balance,
        dueDate: item.dueDate.toISOString(),
        confidence: ALTA,
        source: "REDE",
        occurredAt: referenceDate.toISOString(),
        href: "/comercial",
        reason: `Recebível vencido há ${days} dia(s), sem baixa registrada.`,
        responsibleId: item.responsibleId,
        status: "ABERTA",
        evidence: [item.id],
      } satisfies ExecutiveException;
    });
}

// ---------------------------------------------------------------------------
// Suprimentos — compras críticas e medições pendentes (plano §7 "SUPRIMENTOS")
// ---------------------------------------------------------------------------

export interface ProcurementNeedSignal {
  id: string;
  code: string;
  description: string;
  requiredAt: Date;
  expectedLeadDays: number;
  bufferDays: number;
  /** `ProcurementNeed.requesterId` — campo obrigatório na origem; é quem solicitou a necessidade (plano §L). */
  requesterId?: string;
}

export function buildProcurementExceptions(ctx: ExceptionTenantContext, criticalNeeds: ProcurementNeedSignal[], referenceDate: Date): ExecutiveException[] {
  return criticalNeeds
    .filter((need) => isCriticalPurchase({ requiredAt: need.requiredAt, expectedLeadDays: need.expectedLeadDays, bufferDays: need.bufferDays, referenceDate, contracted: false }))
    .map((need) => {
      const deadline = requiredContractingDate(need.requiredAt, need.expectedLeadDays, need.bufferDays);
      const daysPastDeadline = daysUntil(referenceDate, deadline);
      return {
        id: buildExceptionId(ctx.organizationId, "procurement", "critical_need", need.id),
        organizationId: ctx.organizationId,
        economicGroupId: ctx.economicGroupId,
        companyId: ctx.companyId,
        projectId: ctx.projectId,
        projectName: ctx.projectName,
        domain: "procurement",
        type: "critical_need",
        title: `Compra crítica: ${need.description}`,
        summary: `Necessidade ${need.code} · requerida em ${need.requiredAt.toISOString().slice(0, 10)} · prazo de contratação já vencido`,
        severity: "ACAO_NECESSARIA" as const,
        impact: { schedule: true },
        materialityValue: null,
        dueDate: need.requiredAt.toISOString(),
        confidence: ALTA,
        source: "REDE",
        occurredAt: referenceDate.toISOString(),
        href: "/suprimentos",
        reason: `Prazo limite de contratação (lead time + margem) venceu há ${Math.max(0, daysPastDeadline)} dia(s) sem contrato.`,
        responsibleId: need.requesterId,
        status: "ABERTA",
        evidence: [need.code],
      } satisfies ExecutiveException;
    });
}

// ---------------------------------------------------------------------------
// Obra/Engenharia e Econômico — variação orçamentária relevante (plano §7 "OBRA"/"ECONÔMICO")
// ---------------------------------------------------------------------------

/** Reaproveita `BudgetBridgeRow` de `getOperationsWorkspace().bridge` — já classificado por `materialityFor()` contra a `MaterialityPolicy` da organização. Nenhum recálculo aqui. */
export function buildBudgetVarianceExceptions(ctx: ExceptionTenantContext, rows: BudgetBridgeRow[], referenceDate: Date): ExecutiveException[] {
  return rows
    .map((row): ExecutiveException | null => {
      const severity = mapMaterialityLevel(row.level);
      if (severity === "NORMAL") return null;
      return {
        id: buildExceptionId(ctx.organizationId, "operations", "budget_variance", row.category),
        organizationId: ctx.organizationId,
        economicGroupId: ctx.economicGroupId,
        companyId: ctx.companyId,
        projectId: ctx.projectId,
        projectName: ctx.projectName,
        domain: "operations",
        type: "budget_variance",
        title: `Variação orçamentária em ${row.category}`,
        summary: `Baseline R$ ${row.baseline.toLocaleString("pt-BR")} → Orçamento R$ ${row.budget.toLocaleString("pt-BR")}${row.percentage !== null ? ` (${(row.percentage * 100).toFixed(1)}%)` : ""}`,
        severity,
        impact: { financial: Math.abs(row.difference) },
        materialityValue: Math.abs(row.difference),
        dueDate: null,
        confidence: ALTA,
        source: "REDE",
        occurredAt: referenceDate.toISOString(),
        href: "/engenharia-obra",
        reason: `Variação classificada como ${row.level} pela política de materialidade da organização.`,
        // Sem responsável: `BudgetBridgeRow` agrega por categoria, não por um `BudgetLineItem`
        // único — atribuir um responsável aqui seria inventar um fato que a origem não tem (ordem
        // de serviço §4).
        status: "ABERTA",
        evidence: [row.category],
      } satisfies ExecutiveException;
    })
    .filter((item): item is ExecutiveException => item !== null);
}

// ---------------------------------------------------------------------------
// Integrações — instalações críticas/atenção e credenciais expirando (plano §7 "INTEGRAÇÕES")
// Escopo: organização (não por projeto — `getIntegrationsWorkspace` confirma que instalações
// cobrem Grupo/Empresa/SPE/Empreendimento simultaneamente; nunca repetir por projeto em carteira.
// ---------------------------------------------------------------------------

export interface IntegrationInstallationSignal extends InstallationStateInput {
  id: string;
  name: string;
  scopeLabel: string;
  lastSyncAt: Date | null;
  credentialExpiresAt: Date | null;
}

export function buildIntegrationExceptions(organizationId: string, installations: IntegrationInstallationSignal[], referenceDate: Date): ExecutiveException[] {
  return installations
    .map((installation): ExecutiveException | null => {
      const uiState: InstallationUiState = classifyInstallationState(installation);
      const severity = mapIntegrationUiState(uiState);
      if (severity === "NORMAL") return null;
      return {
        id: buildExceptionId(organizationId, "integrations", "installation_health", installation.id),
        organizationId,
        domain: "integrations",
        type: "installation_health",
        title: `Integração ${installation.name}: ${uiState === "CRITICAL" ? "crítica" : uiState === "ATTENTION" ? "requer atenção" : "desatualizada"}`,
        summary: `${installation.scopeLabel}${installation.lastSyncAt ? ` · última sincronização em ${installation.lastSyncAt.toISOString().slice(0, 16).replace("T", " ")}` : " · nunca sincronizou"}`,
        severity,
        impact: {},
        materialityValue: null,
        dueDate: installation.credentialExpiresAt?.toISOString() ?? null,
        confidence: ALTA,
        source: installation.name,
        occurredAt: (installation.lastSyncAt ?? referenceDate).toISOString(),
        href: "/integracoes",
        reason: `Estado de saúde da instalação: ${uiState}.`,
        status: "ABERTA",
        evidence: [installation.id],
      } satisfies ExecutiveException;
    })
    .filter((item): item is ExecutiveException => item !== null);
}

// ---------------------------------------------------------------------------
// Viabilidade — achados do motor de risco pré-investimento (plano §12: "risco jurídico/técnico
// existente"; `analyzeRisk` opera sobre `FinancialResult` do estudo ativo, não sobre dado
// operacional em curso — ver relatório de investigação da 9K.2). O achado estrutural "model-gaps"
// (limitação do motor v1, idêntico em qualquer projeto) é deliberadamente excluído: não muda de
// projeto para projeto e não é uma decisão acionável, então incluí-lo violaria "poucos itens
// relevantes" (ordem de serviço §16) sem agregar nenhum sinal novo.
// ---------------------------------------------------------------------------

export interface RiskFindingSignal {
  id: string;
  severity: "critical" | "warning" | "positive";
  title: string;
  evidence: string;
}

const STRUCTURAL_FINDING_IDS = new Set(["model-gaps"]);

export function buildViabilityExceptions(ctx: ExceptionTenantContext, findings: RiskFindingSignal[], referenceDate: Date): ExecutiveException[] {
  return findings
    .filter((finding) => !STRUCTURAL_FINDING_IDS.has(finding.id))
    .map((finding): ExecutiveException | null => {
      const severity = mapRiskFindingSeverity(finding.severity);
      if (severity === "NORMAL") return null;
      return {
        id: buildExceptionId(ctx.organizationId, "viability", finding.id, ctx.projectId),
        organizationId: ctx.organizationId,
        economicGroupId: ctx.economicGroupId,
        companyId: ctx.companyId,
        projectId: ctx.projectId,
        projectName: ctx.projectName,
        domain: "viability",
        type: finding.id,
        title: finding.title,
        summary: finding.evidence,
        severity,
        impact: {},
        materialityValue: null,
        dueDate: null,
        confidence: ALTA,
        source: "REDE",
        occurredAt: referenceDate.toISOString(),
        href: "/viabilidade?f=risks",
        reason: finding.evidence,
        status: "ABERTA",
        evidence: [finding.id],
      } satisfies ExecutiveException;
    })
    .filter((item): item is ExecutiveException => item !== null);
}

// ---------------------------------------------------------------------------
// Decisões/Aprovações pendentes (plano §12; reaproveita ApprovalRequest de Suprimentos/Comercial)
// ---------------------------------------------------------------------------

export interface ApprovalRequestSignal {
  id: string;
  actType: string;
  entityType: string;
  amount: number;
  requestedAt: Date;
  projectId: string | null;
  projectName: string | null;
  /** Quem solicitou a aprovação (`ApprovalRequest.requestedById`) — não é quem decide (isso é alçada, ver `requiredRole`). */
  requestedById?: string;
  /** Alçada da política vinculada (`ApprovalPolicy.requiredRole`), quando a solicitação tem uma política associada. */
  requiredRole?: import("@prisma/client").MembershipRole | null;
}

export function buildApprovalExceptions(organizationId: string, requests: ApprovalRequestSignal[], referenceDate: Date): ExecutiveException[] {
  return requests.map((request) => ({
    id: buildExceptionId(organizationId, "approvals", "pending_request", request.id),
    organizationId,
    projectId: request.projectId,
    projectName: request.projectName,
    domain: "approvals",
    type: "pending_request",
    title: `Aprovação pendente: ${request.entityType}`,
    summary: `${request.actType} · R$ ${request.amount.toLocaleString("pt-BR")} · solicitada em ${request.requestedAt.toISOString().slice(0, 10)}`,
    severity: "DECISAO" as const,
    impact: { financial: request.amount },
    materialityValue: request.amount,
    dueDate: null,
    confidence: ALTA,
    source: "REDE",
    occurredAt: referenceDate.toISOString(),
    href: request.entityType === "SALE" ? "/comercial" : "/suprimentos",
    reason: "Alçada de aprovação ainda não decidida (ApprovalRequest.status = PENDING).",
    // `responsibleId` fica ausente de propósito: quem "resolve" uma aprovação é quem tem a alçada
    // (role), não uma pessoa específica atribuída — inventar um responsável aqui violaria a regra
    // de não atribuir artificialmente (plano §4/§M). `requestedById` fica só como evidência.
    status: "ABERTA",
    evidence: [request.id, ...(request.requestedById ? [request.requestedById] : [])],
    approvalCapability: request.requiredRole ? { requiredRole: request.requiredRole } : null,
  }));
}
