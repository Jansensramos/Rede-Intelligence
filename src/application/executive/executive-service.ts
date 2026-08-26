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
import { prisma } from "@/infrastructure/database/prisma";
import { getOperationsWorkspace } from "@/application/operations/operations-service";
import { getCapitalNeedForProject } from "@/application/capital/capital-queries";
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
  buildSalesExceptions,
  buildViabilityExceptions,
  type ExceptionTenantContext,
} from "@/domain/workspace/exception-builders";
import { sortExceptionsByPriority, summarizeExceptionsBySeverity, highestSeverity, type ExecutiveDomain, type ExecutiveException } from "@/domain/workspace/exceptions";
import { CANONICAL_SEVERITY_ORDER, type CanonicalSeverity } from "@/domain/workspace/severity";
import { authorizedExecutiveDomains } from "@/domain/workspace/executive-capabilities";
import { latestTimestamp, resolveDomainFreshness, type DomainFreshness } from "@/domain/workspace/freshness";
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
/** Janela de "licença entrando em D-N" (regra fixa, não é diff — ordem de serviço §9, exemplo "licença entra em D-14"). */
const LICENSE_HORIZON_DAYS = 14;

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
  domain: string;
  href: string;
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
  capital?: { fundingNecessario: number; fundingContratado: number; covenantsEmRisco: number; condicoesPendentes: number };
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
  kpis: ExecutiveProjectKpis;
  freshness: ExecutiveFreshnessEntry[];
}

function sumBalance(items: { balance: number }[]) {
  return items.reduce((sum, item) => sum + item.balance, 0);
}

async function computeWhatChanged(organizationId: string, projectId: string, referenceDate: Date, authorized: Set<ExecutiveDomain>): Promise<WhatChangedItem[]> {
  const windowStart = new Date(referenceDate.getTime() - WHAT_CHANGED_WINDOW_DAYS * 86_400_000);
  const licenseHorizon = new Date(referenceDate.getTime() + LICENSE_HORIZON_DAYS * 86_400_000);
  // Gate 2 do fechamento da 9K.2: quando o papel não tem a capacidade do domínio, a consulta nem
  // dispara (placeholder resolvido localmente) — nunca é só filtrada depois de buscada.
  const [newSales, newObligations, newPayables, enteringLicenses] = await Promise.all([
    authorized.has("sales") ? prisma.sale.count({ where: { organizationId, projectId, status: "APPROVED", approvedAt: { gte: windowStart } } }) : Promise.resolve(0),
    authorized.has("legal") ? prisma.legalObligation.count({ where: { organizationId, projectId, createdAt: { gte: windowStart } } }) : Promise.resolve(0),
    authorized.has("financial") ? prisma.payableInstallment.count({ where: { payableAccount: { organizationId, projectId }, createdAt: { gte: windowStart } } }) : Promise.resolve(0),
    authorized.has("legal")
      ? prisma.legalLicense.findMany({ where: { organizationId, projectId, expiresAt: { gte: referenceDate, lte: licenseHorizon } }, select: { id: true, title: true, expiresAt: true }, take: 10 })
      : Promise.resolve([]),
  ]);

  const items: WhatChangedItem[] = [];
  if (newSales > 0) items.push({ id: "sales:new", label: `${newSales} nova(s) venda(s) aprovada(s)`, detail: `Nos últimos ${WHAT_CHANGED_WINDOW_DAYS} dias.`, domain: "sales", href: "/comercial" });
  if (newObligations > 0) items.push({ id: "legal:new-obligations", label: `${newObligations} nova(s) obrigação(ões) jurídica(s)`, detail: `Cadastradas nos últimos ${WHAT_CHANGED_WINDOW_DAYS} dias.`, domain: "legal", href: "/juridico" });
  if (newPayables > 0) items.push({ id: "financial:new-payables", label: `${newPayables} nova(s) conta(s) a pagar`, detail: `Lançadas nos últimos ${WHAT_CHANGED_WINDOW_DAYS} dias.`, domain: "financial", href: "/financeiro" });
  for (const license of enteringLicenses) {
    const days = Math.round((license.expiresAt!.getTime() - referenceDate.getTime()) / 86_400_000);
    items.push({ id: `legal:license:${license.id}`, label: `Licença "${license.title}" entra em D-${days}`, detail: "Regra de janela fixa, não depende de última visita.", domain: "legal", href: "/juridico" });
  }
  return items;
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
  const capitalNeed = authorized.has("capital") ? await getCapitalNeedForProject({ organizationId }, project.id) : null;

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
  if (authorized.has("procurement") && procurement) exceptions.push(...buildProcurementExceptions(ctx, procurement.needs, referenceDate));
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
  if (authorized.has("procurement") && procurement) kpis.procurement = { criticalPurchases: procurement.needs.length, pendingMeasurements: procurement.pendingMeasurements };
  if (authorized.has("legal") && legal) kpis.legal = { obligationsAtRisk: legal.obligations.length, licensesAtRisk: legal.licenses.length };
  if (authorized.has("accounting")) kpis.accounting = accounting ? { referenceMonth: accounting.referenceMonth.toISOString().slice(0, 7), status: accounting.status } : null;
  if (authorized.has("capital") && capital && capitalNeed) {
    kpis.capital = { fundingNecessario: Number(capitalNeed.fundingStillNeeded), fundingContratado: capital.fundingContratado, covenantsEmRisco: capital.covenants.length, condicoesPendentes: capital.conditions.length };
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
    capital: { label: "Capital & Funding", source: "REDE" },
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
