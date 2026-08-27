/**
 * Orquestração da Gestão Executiva (Fase 9K.2). Read model transversal — nunca cria uma segunda
 * fonte de verdade (ordem de serviço §4/§24): tudo aqui é computado on-the-fly a partir das
 * consultas enxutas de `executive-queries.ts` e dos tradutores puros de
 * `src/domain/workspace/exception-builders.ts`. Nada é persistido por este módulo.
 *
 * Duas variantes (ordem de serviço §6/§AG/§AH):
 *  - `getExecutiveProjectOverview` — leitura de UM empreendimento (Central do Empreendimento).
 *  - `getExecutivePortfolioOverview` — carteira consolidada quando o contexto permite nível
 *    corporativo/grupo (Central Corporativa), ordenada por severidade/materialidade, nunca
 *    alfabeticamente (ordem de serviço §8).
 */
import type { AuthContext } from "@/application/auth/session";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import { getOperationsWorkspace } from "@/application/operations/operations-service";
import { getCapitalExecutiveSummary } from "@/application/capital/capital-queries";
import { getLatestStudyForProject } from "@/application/studies/study-service";
import { calculateAllScenarios } from "@/domain/financial/engine";
import { analyzeRisk } from "@/domain/risk/rules";
import {
  buildApprovalExceptions,
  buildBudgetVarianceExceptions,
  buildCapitalExceptions,
  buildCommercialClosingExceptions,
  buildFinancialExceptions,
  buildIntegrationExceptions,
  buildLegalExceptions,
  buildProcurementExceptions,
  buildPendingMeasurementExceptions,
  buildSalesExceptions,
  buildViabilityExceptions,
  type ExceptionTenantContext,
} from "@/domain/workspace/exception-builders";
import { sortExceptionsByPriority, summarizeExceptionsBySeverity, highestSeverity, type ExecutiveDomain, type ExecutiveException } from "@/domain/workspace/exceptions";
import { CANONICAL_SEVERITY_ORDER, type CanonicalSeverity } from "@/domain/workspace/severity";
import { authorizedExecutiveDomains } from "@/domain/workspace/executive-capabilities";
import { latestTimestamp, resolveDomainFreshness, type DomainFreshness } from "@/domain/workspace/freshness";
import { buildDailyOperationalSummary, deriveOperationalActions, type DailyOperationalSummary, type OperationalAction } from "@/domain/workspace/operational-live";
import type { OperationalContext } from "@/application/workspace/operational-context";
import {
  queryAccountingSignal,
  queryCapitalSignals,
  queryFinancialSignals,
  queryIntegrationSignals,
  queryLegalSignals,
  queryPendingApprovals,
  queryProcurementSignals,
  querySalesSignals,
  queryStudyUpdatedAt,
} from "./executive-queries";

/** Janela determinística de "O que mudou" (ordem de serviço §9): sem `lastSeenAt` persistido nesta sprint, a comparação usa uma janela fixa e documentada. */
export const WHAT_CHANGED_WINDOW_DAYS = 7;
export interface ExecutiveProjectRef {
  id: string;
  name: string;
  city: string;
  state: string;
  companyId: string | null;
  companyName: string | null;
  economicGroupId: string | null;
  economicGroupName: string | null;
}

export interface WhatChangedItem {
  id: string;
  label: string;
  detail: string;
  domain: ExecutiveDomain;
  href: string;
  occurredAt: string;
  sourceType: string;
  sourceId: string;
  source: string;
  beforeAfter?: string;
}

/**
 * Gate 3 do fechamento da 9K.2 ("freshness real"): `kind` decide o texto exibido — nunca
 * "Atualizado agora" quando o que se sabe de fato é só "consultado agora" (ver
 * `src/domain/workspace/freshness.ts`). `source`/`kind`/`updatedAt`/`queriedAt` substituem o antigo
 * `asOf = instante da leitura`, que confundia as duas semânticas.
 */
export interface ExecutiveFreshnessEntry extends DomainFreshness {
  domain: ExecutiveDomain;
  label: string;
  source: string;
}

export interface ExecutiveViabilityKpis {
  scenarioLabel: string;
  vgv: number;
  marginOnVgv: number;
  maximumCashExposure: number;
  roi: number | null;
}

/**
 * Blocos por domínio são OPCIONAIS (`?:`), não `| null` — isso é o que garante o requisito do
 * gate 2 do fechamento ("dado não autorizado não aparece nem no payload do read model"): quando o
 * papel não tem a capacidade do domínio, a chave inteira fica ausente do objeto (nunca é
 * calculada, nunca é enviada), não apenas `null`. `null` continua reservado para "autorizado, mas
 * sem dado" (ex.: `accounting: null` = usuário pode ver Contabilidade, mas não há período
 * cadastrado) — os dois estados nunca se confundem. `viability` e `operations` não têm gate nesta
 * sprint (mesma política das telas de módulo correspondentes, sem `role` em
 * `getLatestStudyForProject`/`getOperationsWorkspace`) — sempre presentes.
 */
export interface ExecutiveProjectKpis {
  viability: ExecutiveViabilityKpis | null;
  operations: { scheduleStatus: string | null; budgetStatus: string | null; criticalVarianceCategories: number };
  commercial?: { unitsAvailable: number; unitsSold: number; unitsTotal: number; vgvVendido: number };
  financial?: { cashPosition: number | null; overduePayablesCount: number; overduePayablesAmount: number; overdueReceivablesCount: number; overdueReceivablesAmount: number };
  procurement?: { criticalPurchases: number; pendingMeasurements: number };
  legal?: { obligationsAtRisk: number; licensesAtRisk: number };
  accounting?: { referenceMonth: string; status: string } | null;
  integrations?: { criticalInstallations: number; attentionInstallations: number; expiringCredentials: number };
  capital?: {
    fundingNecessario: number;
    fundingContratado: number;
    desembolsado: number;
    saldoALiberar: number;
    custoMedio: number | null;
    proximaLiberacao: { expectedDate: string; expectedAmount: number } | null;
    covenantsEmRisco: number;
    condicoesPendentes: number;
  };
}

export interface ExecutiveProjectOverview {
  project: ExecutiveProjectRef;
  generatedAt: string;
  windowDays: number;
  /** Domínios que o papel do usuário está autorizado a ver nesta leitura (gate 2 do fechamento da 9K.2). */
  authorizedDomains: ExecutiveDomain[];
  exceptions: ExecutiveException[];
  attentionSummary: Record<CanonicalSeverity, number>;
  whatChanged: WhatChangedItem[];
  operationToday: {
    summary: DailyOperationalSummary;
    items: OperationalAction[];
    changedLast24h: number;
    materialImpacts: number;
  };
  kpis: ExecutiveProjectKpis;
  freshness: ExecutiveFreshnessEntry[];
}

function sumBalance(items: { balance: number }[]) {
  return items.reduce((sum, item) => sum + item.balance, 0);
}

async function computeWhatChanged(organizationId: string, projectId: string, referenceDate: Date, authorized: Set<ExecutiveDomain>): Promise<WhatChangedItem[]> {
  const windowStart = new Date(referenceDate.getTime() - WHAT_CHANGED_WINDOW_DAYS * 86_400_000);
  const rules: Array<{ domain: ExecutiveDomain; prefixes: string[]; href: string }> = [
    { domain: "financial", prefixes: ["PAYABLE_", "RECEIVABLE_", "BANK_", "FINANCIAL_"], href: "/financeiro" },
    { domain: "sales", prefixes: ["SALE_", "SALES_", "SIGNATURE_", "CREDIT_"], href: "/comercial" },
    { domain: "procurement", prefixes: ["PROCUREMENT_", "PURCHASE_", "MEASUREMENT_", "SUPPLIER_", "CONTRACT_"], href: "/suprimentos" },
    { domain: "legal", prefixes: ["LEGAL_", "LICENSE_", "OBLIGATION_"], href: "/juridico" },
    { domain: "capital", prefixes: ["FUNDING_"], href: "/capital-funding" },
    { domain: "operations", prefixes: ["BUDGET_", "SCHEDULE_", "OPERATIONAL_"], href: "/engenharia-obra" },
    { domain: "accounting", prefixes: ["ACCOUNTING_", "TAX_"], href: "/contabilidade-controladoria" },
    { domain: "integrations", prefixes: ["INTEGRATION_", "API_", "CONNECTOR_"], href: "/integracoes" },
    { domain: "viability", prefixes: ["STUDY_", "CALCULATION_", "SCENARIO_"], href: "/viabilidade" },
    { domain: "approvals", prefixes: ["APPROVAL_"], href: "/acoes" },
  ];
  const allowed = rules.filter((rule) => authorized.has(rule.domain));
  const actionFilters: Prisma.AuditLogWhereInput[] = allowed.flatMap((rule) => rule.prefixes.map((prefix) => ({ action: { startsWith: prefix } })));
  if (actionFilters.length === 0) return [];

  const logs = await prisma.auditLog.findMany({
    where: { organizationId, projectId, createdAt: { gte: windowStart }, OR: actionFilters },
    select: { id: true, action: true, entityType: true, entityId: true, before: true, after: true, createdAt: true, user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const entityLabels: Record<string, string> = {
    PayableAccount: "Conta a pagar", ReceivableAccount: "Conta a receber", Sale: "Venda", LegalObligation: "Obrigação",
    LegalLicense: "Licença", ProcurementNeed: "Necessidade de compra", PurchaseOrder: "Pedido de compra",
    MeasurementCertificate: "Medição", FundingProposal: "Proposta de financiamento", FundingDisbursement: "Desembolso",
    FundingCondition: "Condição de financiamento", Budget: "Orçamento", OperationalSchedule: "Cronograma", ApprovalRequest: "Aprovação",
  };
  const statusLabels: Record<string, string> = { PENDING: "Pendente", APPROVED: "Aprovado", REJECTED: "Rejeitado", COMPLETED: "Concluído", PAID: "Pago", RECEIVED: "Recebido", DRAFT: "Rascunho", ACTIVE: "Ativo", CLOSED: "Fechado", FAILED: "Falha" };
  const auditValue = (value: unknown) => typeof value === "number" ? value.toLocaleString("pt-BR") : String(value);
  const beforeAfter = (before: Prisma.JsonValue | null, after: Prisma.JsonValue | null): string | undefined => {
    if (!before || !after || Array.isArray(before) || Array.isArray(after) || typeof before !== "object" || typeof after !== "object") return undefined;
    const labels: Record<string, string> = { status: "Status", amount: "Valor", currentAmount: "Valor atual", expectedAmount: "Valor previsto", dueAt: "Prazo", dueDate: "Vencimento" };
    for (const key of Object.keys(labels)) {
      const previous = (before as Prisma.JsonObject)[key];
      const current = (after as Prisma.JsonObject)[key];
      if (previous != null && current != null && JSON.stringify(previous) !== JSON.stringify(current)) {
        if (key === "status") {
          const previousLabel = typeof previous === "string" ? statusLabels[previous] : undefined;
          const currentLabel = typeof current === "string" ? statusLabels[current] : undefined;
          return previousLabel && currentLabel ? `${labels[key]}: ${previousLabel} → ${currentLabel}` : undefined;
        }
        return `${labels[key]}: ${auditValue(previous)} → ${auditValue(current)}`;
      }
    }
    return undefined;
  };
  // O fato REAL de pagamento/recebimento/desembolso é gravado pelo módulo de origem com um nome de
  // ação próprio (nunca termina em "_PAID"/"_RECEIVED" — ver `financial-service.ts`/`capital-
  // service.ts`), então esses casos precisam de correspondência exata antes dos sufixos genéricos
  // abaixo (auditoria adversarial 9L: sem isso, o pagamento/recebimento real caía no rótulo vago
  // "Atualização de..." — nunca chegou a rotular como algo que NÃO aconteceu, mas ficava menos
  // informativo que o fato realmente ocorrido).
  const exactActionLabel: Record<string, string> = {
    PAYABLE_PAYMENT_REGISTERED: "Pagamento de conta a pagar",
    RECEIVABLE_PAYMENT_REGISTERED: "Recebimento de conta a receber",
    FUNDING_DISBURSEMENT_CONFIRMED: "Desembolso confirmado (transação bancária conciliada)",
  };
  const actionLabel = (action: string, entityType: string) => {
    if (exactActionLabel[action]) return exactActionLabel[action];
    const subject = entityLabels[entityType] ?? "Registro operacional";
    const lowerSubject = subject.toLocaleLowerCase("pt-BR");
    if (action.endsWith("_CREATED")) return `Criação de ${lowerSubject}`;
    if (action.endsWith("_APPROVED")) return `Aprovação de ${lowerSubject}`;
    if (action.endsWith("_SIGNED")) return `Assinatura de ${lowerSubject}`;
    if (action.endsWith("_FAILED")) return `Falha registrada em ${subject.toLowerCase()}`;
    return `Atualização de ${lowerSubject}`;
  };

  return logs.flatMap((log): WhatChangedItem[] => {
    const rule = allowed.find((candidate) => candidate.prefixes.some((prefix) => log.action.startsWith(prefix)));
    if (!rule) return [];
    return [{
      id: log.id,
      label: actionLabel(log.action, log.entityType),
      detail: `Registrado por ${log.user.name}.`,
      domain: rule.domain,
      href: rule.href,
      occurredAt: log.createdAt.toISOString(),
      sourceType: log.entityType,
      sourceId: log.entityId,
      source: "Trilha de auditoria REDE",
      beforeAfter: beforeAfter(log.before, log.after),
    }];
  });
}

/**
 * Gate 2 do fechamento da 9K.2: cada consulta só dispara se `authorized` contém o domínio — quando
 * não autorizado, o valor é `null` sem nenhuma chamada ao Prisma (a query nem é invocada, não é só
 * descartada depois). `operations`/`study` (Viabilidade) não têm gate nesta sprint.
 */
async function loadProjectSignals(organizationId: string, project: ExecutiveProjectRef, referenceDate: Date, authorized: Set<ExecutiveDomain>) {
  const [legal, financial, sales, procurement, operations, accounting, study, studyUpdatedAt, capital] = await Promise.all([
    authorized.has("legal") ? queryLegalSignals(organizationId, project.id) : Promise.resolve(null),
    authorized.has("financial") ? queryFinancialSignals(organizationId, project.id, project.companyId, referenceDate) : Promise.resolve(null),
    authorized.has("sales") ? querySalesSignals(organizationId, project.id, referenceDate) : Promise.resolve(null),
    authorized.has("procurement") ? queryProcurementSignals(organizationId, project.id) : Promise.resolve(null),
    getOperationsWorkspace({ organizationId }, project.id),
    authorized.has("accounting") ? queryAccountingSignal(organizationId, project.companyId) : Promise.resolve(null),
    getLatestStudyForProject(organizationId, project.id),
    queryStudyUpdatedAt(organizationId, project.id),
    authorized.has("capital") ? queryCapitalSignals(organizationId, project.id) : Promise.resolve(null),
  ]);
  return { legal, financial, sales, procurement, operations, accounting, study, studyUpdatedAt, capital };
}

/** Núcleo por-projeto (sem integrações/aprovações — organizacionais, buscadas uma única vez pelo chamador). */
async function buildProjectExceptionsAndKpis(organizationId: string, project: ExecutiveProjectRef, referenceDate: Date, authorized: Set<ExecutiveDomain>) {
  const { legal, financial, sales, procurement, operations, accounting, study, studyUpdatedAt, capital } = await loadProjectSignals(organizationId, project, referenceDate, authorized);
  // Reaproveita o mesmo read model exibido em /capital-funding (`getCapitalExecutiveSummary`) — o card da
  // Gestão Executiva nunca recalcula fundingContratado/desembolsado/saldoALiberar/custoMedio por conta própria.
  const capitalSummary = authorized.has("capital") ? await getCapitalExecutiveSummary({ organizationId }, project.id) : null;

  const ctx: ExceptionTenantContext = {
    organizationId,
    economicGroupId: project.economicGroupId,
    companyId: project.companyId,
    projectId: project.id,
    projectName: project.name,
  };

  const exceptions: ExecutiveException[] = [...buildBudgetVarianceExceptions(ctx, operations.bridge, referenceDate)];
  if (authorized.has("legal") && legal) exceptions.push(...buildLegalExceptions(ctx, legal.obligations, legal.licenses, referenceDate));
  if (authorized.has("financial") && financial) exceptions.push(...buildFinancialExceptions(ctx, financial.payables, financial.receivables, referenceDate));
  if (authorized.has("sales") && sales) {
    exceptions.push(...buildSalesExceptions(ctx, sales.overdueReceivables, referenceDate));
    exceptions.push(...buildCommercialClosingExceptions(ctx, sales, referenceDate));
  }
  if (authorized.has("procurement") && procurement) {
    exceptions.push(...buildProcurementExceptions(ctx, procurement.needs, referenceDate));
    exceptions.push(...buildPendingMeasurementExceptions(ctx, procurement.pendingMeasurements, referenceDate));
  }
  if (authorized.has("capital") && capital) exceptions.push(...buildCapitalExceptions(ctx, capital.conditions, capital.covenants, capital.disbursements, capital.proposalsAwaitingDecision, referenceDate));

  let viability: ExecutiveViabilityKpis | null = null;
  if (study) {
    const results = calculateAllScenarios(study.assumptions);
    const base = results.base;
    const recommendation = analyzeRisk(base);
    exceptions.push(...buildViabilityExceptions(ctx, recommendation.findings, referenceDate));
    viability = {
      scenarioLabel: base.scenarioLabel,
      vgv: Number(base.metrics.vgv),
      marginOnVgv: Number(base.metrics.marginOnVgv),
      maximumCashExposure: Number(base.metrics.maximumCashExposure),
      roi: base.metrics.roi ? Number(base.metrics.roi) : null,
    };
  }

  const kpis: ExecutiveProjectKpis = {
    viability,
    operations: { scheduleStatus: operations.schedule?.status ?? null, budgetStatus: operations.budget?.status ?? null, criticalVarianceCategories: operations.bridge.filter((row) => row.level === "CRITICO" || row.level === "RELEVANTE").length },
  };
  if (authorized.has("sales") && sales) kpis.commercial = { unitsAvailable: sales.unitsAvailable, unitsSold: sales.unitsSold, unitsTotal: sales.unitsTotal, vgvVendido: sales.vgvVendido };
  if (authorized.has("financial") && financial) {
    kpis.financial = {
      cashPosition: financial.cashPosition,
      overduePayablesCount: financial.payables.length,
      overduePayablesAmount: sumBalance(financial.payables),
      overdueReceivablesCount: financial.receivables.length,
      overdueReceivablesAmount: sumBalance(financial.receivables),
    };
  }
  if (authorized.has("procurement") && procurement) kpis.procurement = { criticalPurchases: procurement.needs.length, pendingMeasurements: procurement.pendingMeasurements.length };
  if (authorized.has("legal") && legal) kpis.legal = { obligationsAtRisk: legal.obligations.length, licensesAtRisk: legal.licenses.length };
  if (authorized.has("accounting")) kpis.accounting = accounting ? { referenceMonth: accounting.referenceMonth.toISOString().slice(0, 7), status: accounting.status } : null;
  if (authorized.has("capital") && capitalSummary) {
    kpis.capital = {
      fundingNecessario: capitalSummary.fundingNecessario,
      fundingContratado: capitalSummary.fundingContratado,
      desembolsado: capitalSummary.desembolsado,
      saldoALiberar: capitalSummary.saldoALiberar,
      custoMedio: capitalSummary.custoMedio,
      proximaLiberacao: capitalSummary.proximaLiberacao ? { expectedDate: capitalSummary.proximaLiberacao.expectedDate, expectedAmount: capitalSummary.proximaLiberacao.expectedAmount } : null,
      covenantsEmRisco: capitalSummary.covenantsEmRisco,
      condicoesPendentes: capitalSummary.condicoesPendentes,
    };
  }

  // Gate 3 do fechamento da 9K.2 (freshness real): timestamp real quando existir na própria
  // consulta já feita (nunca uma consulta nova só para isso); "queried_now" só para agregados ao
  // vivo sem registro para ancorar; "unavailable" quando o domínio nem tinha como ser consultado
  // (ex.: Viabilidade sem estudo ativo, Contabilidade sem empresa vinculada).
  const freshnessByDomain: Partial<Record<ExecutiveDomain, DomainFreshness>> = {
    viability: study ? resolveDomainFreshness(studyUpdatedAt, referenceDate, true) : resolveDomainFreshness(null, referenceDate, false),
    // `baseline.approvedAt` já vem como string ISO de `getOperationsWorkspace` (serializado ali) — reconvertida para Date antes de comparar timestamps.
    operations: resolveDomainFreshness(latestTimestamp([operations.baseline?.approvedAt ? new Date(operations.baseline.approvedAt) : null]), referenceDate, true),
  };
  if (authorized.has("sales") && sales) freshnessByDomain.sales = resolveDomainFreshness(sales.latestUpdatedAt, referenceDate, true);
  if (authorized.has("financial") && financial) freshnessByDomain.financial = resolveDomainFreshness(financial.latestUpdatedAt, referenceDate, true);
  if (authorized.has("procurement") && procurement) freshnessByDomain.procurement = resolveDomainFreshness(procurement.latestUpdatedAt, referenceDate, true);
  if (authorized.has("legal") && legal) freshnessByDomain.legal = resolveDomainFreshness(legal.latestUpdatedAt, referenceDate, true);
  if (authorized.has("accounting")) freshnessByDomain.accounting = resolveDomainFreshness(accounting?.updatedAt ?? null, referenceDate, Boolean(project.companyId));
  if (authorized.has("capital") && capital) freshnessByDomain.capital = resolveDomainFreshness(capital.latestUpdatedAt, referenceDate, true);

  return { exceptions, kpis, freshnessByDomain };
}

export async function getExecutiveProjectOverview(authContext: Pick<AuthContext, "organizationId" | "role">, project: ExecutiveProjectRef, referenceDate = new Date()): Promise<ExecutiveProjectOverview> {
  const organizationId = authContext.organizationId;
  const authorized = authorizedExecutiveDomains(authContext.role);

  const [{ exceptions, kpis, freshnessByDomain }, installations, whatChanged, pendingApprovals] = await Promise.all([
    buildProjectExceptionsAndKpis(organizationId, project, referenceDate, authorized),
    authorized.has("integrations") ? queryIntegrationSignals(organizationId) : Promise.resolve([]),
    computeWhatChanged(organizationId, project.id, referenceDate, authorized),
    authorized.has("approvals") ? queryPendingApprovals(organizationId, [project.id]) : Promise.resolve([]),
  ]);

  let integrationExceptions: ExecutiveException[] = [];
  if (authorized.has("integrations")) {
    integrationExceptions = buildIntegrationExceptions(organizationId, installations, referenceDate);
    kpis.integrations = {
      criticalInstallations: integrationExceptions.filter((item) => item.severity === "CRITICO").length,
      attentionInstallations: integrationExceptions.filter((item) => item.severity === "ACAO_NECESSARIA").length,
      expiringCredentials: installations.filter((item) => item.credentialExpiresAt && item.credentialExpiresAt.getTime() - referenceDate.getTime() < 30 * 86_400_000).length,
    };
    // Gate 3: cada conector já carrega seu próprio `lastSyncAt` real nas exceções de integração
    // (`buildIntegrationExceptions`); a linha agregada de freshness usa o mais recente entre eles.
    freshnessByDomain.integrations = resolveDomainFreshness(latestTimestamp(installations.map((item) => item.lastSyncAt)), referenceDate, installations.length > 0);
  }

  const approvalExceptions = authorized.has("approvals")
    ? buildApprovalExceptions(organizationId, pendingApprovals.map((request) => ({ ...request, projectName: project.name })), referenceDate)
    : [];

  const allExceptions = sortExceptionsByPriority([...exceptions, ...integrationExceptions, ...approvalExceptions]);
  const operationalActions = deriveOperationalActions(allExceptions);
  const last24h = referenceDate.getTime() - 86_400_000;
  const operationToday = {
    summary: buildDailyOperationalSummary(operationalActions, referenceDate),
    items: operationalActions.filter((item) => item.severity === "CRITICO" || item.severity === "DECISAO" || (item.dueDate != null && new Date(item.dueDate).getTime() <= referenceDate.getTime())).slice(0, 5),
    changedLast24h: whatChanged.filter((item) => new Date(item.occurredAt).getTime() >= last24h).length,
    materialImpacts: operationalActions.filter((item) => (item.materialityValue ?? 0) > 0).length,
  };

  const domainLabels: Record<ExecutiveDomain, { label: string; source: string }> = {
    viability: { label: "Viabilidade", source: "REDE" },
    sales: { label: "Comercial", source: "REDE" },
    financial: { label: "Financeiro", source: "REDE" },
    procurement: { label: "Suprimentos", source: "REDE" },
    legal: { label: "Jurídico", source: "REDE" },
    operations: { label: "Obra/Engenharia", source: "REDE" },
    accounting: { label: "Contabilidade", source: "REDE" },
    integrations: { label: "Integrações", source: "Conectores externos (ver cada item)" },
    approvals: { label: "Decisões", source: "REDE" },
    capital: { label: "Capital e Financiamento", source: "REDE" },
  };

  // Gate 2 + gate 3: só entram no payload os domínios autorizados (§2), e cada um carrega a
  // semântica real de freshness (§3) — nunca um `asOf` fabricado no instante da leitura.
  const freshness: ExecutiveFreshnessEntry[] = (Object.keys(freshnessByDomain) as ExecutiveDomain[])
    .filter((domain) => authorized.has(domain))
    .map((domain) => ({ domain, label: domainLabels[domain].label, source: domainLabels[domain].source, ...freshnessByDomain[domain]! }));

  return {
    project,
    generatedAt: referenceDate.toISOString(),
    windowDays: WHAT_CHANGED_WINDOW_DAYS,
    authorizedDomains: [...authorized],
    exceptions: allExceptions,
    attentionSummary: summarizeExceptionsBySeverity(allExceptions),
    whatChanged,
    operationToday,
    kpis,
    freshness,
  };
}

export interface ExecutiveOpenExceptions {
  exceptions: ExecutiveException[];
  authorizedDomains: ExecutiveDomain[];
}

/**
 * Só a lista de exceções ABERTAS, com o mesmo gate 2 (RBAC por domínio) e a mesma ordenação de
 * `getExecutiveProjectOverview` — para consumidores que precisam do CONJUNTO de exceções (Central
 * de Ações, 9K.3) mas não do painel de KPIs/"o que mudou"/freshness da Gestão Executiva. Reaproveita
 * `buildProjectExceptionsAndKpis` (a mesma função usada por `getExecutiveProjectOverview` e pela
 * carteira) em vez de recalcular a montagem de exceções — nunca uma segunda implementação da mesma
 * regra. Evita, deliberadamente, as consultas extras de `computeWhatChanged` (só relevantes para o
 * bloco "o que mudou" da Gestão Executiva), o que torna esta função mais enxuta que a acima para
 * quem só precisa da lista de ações.
 */
export async function getExecutiveOpenExceptions(authContext: Pick<AuthContext, "organizationId" | "role">, project: ExecutiveProjectRef, referenceDate = new Date()): Promise<ExecutiveOpenExceptions> {
  const organizationId = authContext.organizationId;
  const authorized = authorizedExecutiveDomains(authContext.role);

  const [{ exceptions }, installations, pendingApprovals] = await Promise.all([
    buildProjectExceptionsAndKpis(organizationId, project, referenceDate, authorized),
    authorized.has("integrations") ? queryIntegrationSignals(organizationId) : Promise.resolve([]),
    authorized.has("approvals") ? queryPendingApprovals(organizationId, [project.id]) : Promise.resolve([]),
  ]);

  const integrationExceptions = authorized.has("integrations") ? buildIntegrationExceptions(organizationId, installations, referenceDate) : [];
  const approvalExceptions = authorized.has("approvals")
    ? buildApprovalExceptions(organizationId, pendingApprovals.map((request) => ({ ...request, projectName: project.name })), referenceDate)
    : [];

  return {
    exceptions: sortExceptionsByPriority([...exceptions, ...integrationExceptions, ...approvalExceptions]),
    authorizedDomains: [...authorized],
  };
}

// ---------------------------------------------------------------------------
// Carteira / Central Corporativa (ordem de serviço §6/§8)
// ---------------------------------------------------------------------------

export interface ExecutivePortfolioEntry {
  project: { id: string; name: string; city: string; state: string; companyName: string | null };
  severitySummary: Record<CanonicalSeverity, number>;
  topSeverity: CanonicalSeverity;
  exceptionCount: number;
  /** `null` quando o domínio não tem dado OU quando o papel não tem a capacidade — nunca um zero fabricado (gate 2 do fechamento da 9K.2 também vale para a carteira). */
  headline: { vgvVendido: number | null; overdueFinancialAmount: number | null; cashPosition: number | null };
  href: string;
}

export interface ExecutivePortfolioOverview {
  scopeLabel: string;
  generatedAt: string;
  /** Domínios que o papel do usuário está autorizado a ver nesta leitura (gate 2 do fechamento da 9K.2) — mesma autorização aplicada a cada entrada da carteira. */
  authorizedDomains: ExecutiveDomain[];
  entries: ExecutivePortfolioEntry[];
  scopeExceptions: ExecutiveException[];
}

const severityWeight = Object.fromEntries(CANONICAL_SEVERITY_ORDER.map((severity, index) => [severity, index])) as Record<CanonicalSeverity, number>;

/** Limite defensivo de carteira nesta sprint — a mesma ordem de grandeza dos `take` já usados nas consultas de módulo (ordem de serviço §18). Acima disso, a 9K.3 deve paginar. */
const PORTFOLIO_PROJECT_LIMIT = 50;

async function resolvePortfolioProjects(organizationId: string, context: OperationalContext) {
  const where = context.economicGroup
    ? { organizationId, company: { economicGroupId: context.economicGroup.id } }
    : context.company
      ? { organizationId, companyId: context.company.id }
      : { organizationId };

  return prisma.project.findMany({
    where,
    select: { id: true, name: true, city: true, state: true, companyId: true, company: { select: { id: true, name: true, economicGroupId: true } } },
    orderBy: { name: "asc" },
    take: PORTFOLIO_PROJECT_LIMIT,
  });
}

export async function getExecutivePortfolioOverview(authContext: Pick<AuthContext, "organizationId" | "role">, context: OperationalContext, referenceDate = new Date()): Promise<ExecutivePortfolioOverview | null> {
  const organizationId = authContext.organizationId;
  const authorized = authorizedExecutiveDomains(authContext.role);
  const projects = await resolvePortfolioProjects(organizationId, context);
  if (projects.length <= 1) return null; // carteira só faz sentido com mais de um empreendimento no escopo

  const [entriesRaw, installations, pendingApprovals] = await Promise.all([
    Promise.all(
      projects.map(async (project) => {
        const ref: ExecutiveProjectRef = {
          id: project.id,
          name: project.name,
          city: project.city,
          state: project.state,
          companyId: project.companyId,
          companyName: project.company?.name ?? null,
          economicGroupId: project.company?.economicGroupId ?? null,
          economicGroupName: context.economicGroup?.name ?? null,
        };
        const { exceptions, kpis } = await buildProjectExceptionsAndKpis(organizationId, ref, referenceDate, authorized);
        return { ref, exceptions, kpis };
      }),
    ),
    authorized.has("integrations") ? queryIntegrationSignals(organizationId) : Promise.resolve([]),
    authorized.has("approvals") ? queryPendingApprovals(organizationId, projects.map((project) => project.id)) : Promise.resolve([]),
  ]);

  const projectNameById = new Map(projects.map((project) => [project.id, project.name]));
  const integrationExceptions = authorized.has("integrations") ? buildIntegrationExceptions(organizationId, installations, referenceDate) : [];
  const approvalExceptions = authorized.has("approvals")
    ? buildApprovalExceptions(
        organizationId,
        pendingApprovals.map((request) => ({ ...request, projectId: request.projectId, projectName: request.projectId ? (projectNameById.get(request.projectId) ?? null) : null })),
        referenceDate,
      )
    : [];

  const entries: ExecutivePortfolioEntry[] = entriesRaw
    .map(({ ref, exceptions, kpis }) => ({
      project: { id: ref.id, name: ref.name, city: ref.city, state: ref.state, companyName: ref.companyName },
      severitySummary: summarizeExceptionsBySeverity(exceptions),
      topSeverity: highestSeverity(exceptions),
      exceptionCount: exceptions.length,
      headline: {
        vgvVendido: kpis.commercial?.vgvVendido ?? null,
        overdueFinancialAmount: kpis.financial ? kpis.financial.overduePayablesAmount + kpis.financial.overdueReceivablesAmount : null,
        cashPosition: kpis.financial?.cashPosition ?? null,
      },
      href: `/executivo/${ref.id}`,
    }))
    .sort((a, b) => {
      const severityDelta = severityWeight[b.topSeverity] - severityWeight[a.topSeverity];
      if (severityDelta !== 0) return severityDelta;
      const countDelta = b.exceptionCount - a.exceptionCount;
      if (countDelta !== 0) return countDelta;
      return (b.headline.overdueFinancialAmount ?? 0) - (a.headline.overdueFinancialAmount ?? 0);
    });

  const scopeLabel = context.economicGroup?.name ?? context.company?.name ?? context.organization.name;

  return {
    scopeLabel,
    generatedAt: referenceDate.toISOString(),
    authorizedDomains: [...authorized],
    entries,
    scopeExceptions: sortExceptionsByPriority([...integrationExceptions, ...approvalExceptions]),
  };
}
