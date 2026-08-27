/**
 * Orquestração da Central de Ações / Minha Rotina (Fase 9K.3, plano §L). Read model transversal —
 * nunca uma segunda fonte de verdade (ordem de serviço §4/§24): reaproveita 100% da montagem de
 * exceções ABERTAS já existente (`getExecutiveOpenExceptions`, `src/application/executive/
 * executive-service.ts`) e adiciona só o lado RESOLVIDA, novo desta fase, via
 * `src/application/actions/action-queries.ts` + `src/domain/workspace/resolved-actions.ts`.
 *
 * A composição em abas ("Todas"/"Minhas"/"Hoje"/... e "Minha Rotina") é responsabilidade de
 * `src/domain/workspace/action-center.ts` (puro, sem I/O) — este módulo só busca e monta a lista
 * bruta de `ExecutiveException[]` que aquelas funções recebem.
 */
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { getExecutiveOpenExceptions, type ExecutiveProjectRef } from "@/application/executive/executive-service";
import { authorizedExecutiveDomains } from "@/domain/workspace/executive-capabilities";
import { buildResolvedApprovalExceptions, buildResolvedFinancialExceptions, buildResolvedLegalExceptions } from "@/domain/workspace/resolved-actions";
import type { ExceptionTenantContext } from "@/domain/workspace/exception-builders";
import type { ExecutiveDomain, ExecutiveException } from "@/domain/workspace/exceptions";
import { buildDailyOperationalSummary, deriveOperationalActions, type DailyOperationalSummary, type OperationalAction } from "@/domain/workspace/operational-live";
import { queryResolvedApprovals, queryResolvedFinancialSignals, queryResolvedLegalSignals } from "./action-queries";

/** "Recentemente concluída" — janela fixa e documentada, mesma filosofia de `WHAT_CHANGED_WINDOW_DAYS` (executive-service.ts): sem "última visita" persistida nesta sprint. */
export const RECENTLY_RESOLVED_WINDOW_DAYS = 14;

export interface ActionCenterOverview {
  project: ExecutiveProjectRef;
  generatedAt: string;
  /** Domínios que o papel do usuário está autorizado a ver (gate 2, mesmo mecanismo da Gestão Executiva). */
  authorizedDomains: ExecutiveDomain[];
  /** ABERTA — mesma lista, mesma ordenação de RBAC de `getExecutiveOpenExceptions`. */
  openActions: OperationalAction[];
  /** RESOLVIDA — recentemente concluídas dentro de `RECENTLY_RESOLVED_WINDOW_DAYS`. */
  resolvedActions: OperationalAction[];
  /** Resumo determinístico do dia; não depende de IA. */
  dailySummary: DailyOperationalSummary;
  /**
   * Nome de exibição por `responsibleId` (só os ids que de fato aparecem em `openActions`/
   * `resolvedActions` — nunca a organização inteira, para não virar uma segunda forma de carregar
   * um workspace completo). Chave ausente = id não encontrado (ex.: usuário removido) — a UI mostra
   * o id bruto como fallback, nunca "Sem responsável" (que é reservado para `responsibleId` ausente).
   */
  responsibleNames: Record<string, string>;
}

/** Resolve nome de exibição só para os `responsibleId` realmente presentes nas exceções desta leitura — uma única consulta enxuta, nunca a lista de membros da organização inteira. Exportada para reuso pelo Cliente 360 (Fase 9K.4B) — mesmo padrão, não um segundo resolvedor. */
export async function resolveResponsibleNames(exceptions: ExecutiveException[]): Promise<Record<string, string>> {
  const ids = [...new Set(exceptions.map((item) => item.responsibleId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return {};
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return Object.fromEntries(users.map((user) => [user.id, user.name]));
}

async function loadResolvedActions(organizationId: string, project: ExecutiveProjectRef, windowStart: Date, authorized: Set<ExecutiveDomain>): Promise<ExecutiveException[]> {
  const ctx: ExceptionTenantContext = {
    organizationId,
    economicGroupId: project.economicGroupId,
    companyId: project.companyId,
    projectId: project.id,
    projectName: project.name,
  };

  const [legal, financial, approvals] = await Promise.all([
    authorized.has("legal") ? queryResolvedLegalSignals(organizationId, project.id, windowStart) : Promise.resolve([]),
    authorized.has("financial") ? queryResolvedFinancialSignals(organizationId, project.id, windowStart) : Promise.resolve({ payables: [], receivables: [] }),
    authorized.has("approvals") ? queryResolvedApprovals(organizationId, [project.id], windowStart) : Promise.resolve([]),
  ]);

  return [
    ...buildResolvedLegalExceptions(ctx, legal),
    ...buildResolvedFinancialExceptions(ctx, financial.payables, financial.receivables),
    ...buildResolvedApprovalExceptions(organizationId, approvals.map((request) => ({ ...request, projectId: project.id, projectName: project.name }))),
  ];
}

export async function getActionCenterOverview(authContext: Pick<AuthContext, "organizationId" | "role">, project: ExecutiveProjectRef, referenceDate = new Date()): Promise<ActionCenterOverview> {
  const organizationId = authContext.organizationId;
  const authorized = authorizedExecutiveDomains(authContext.role);
  const windowStart = new Date(referenceDate.getTime() - RECENTLY_RESOLVED_WINDOW_DAYS * 86_400_000);

  const [{ exceptions, authorizedDomains }, resolvedActions] = await Promise.all([
    getExecutiveOpenExceptions(authContext, project, referenceDate),
    loadResolvedActions(organizationId, project, windowStart, authorized),
  ]);
  const openActions = deriveOperationalActions(exceptions);
  const completedActions = deriveOperationalActions(resolvedActions);
  const responsibleNames = await resolveResponsibleNames([...openActions, ...completedActions]);

  return {
    project,
    generatedAt: referenceDate.toISOString(),
    authorizedDomains,
    openActions,
    resolvedActions: completedActions,
    dailySummary: buildDailyOperationalSummary(openActions, referenceDate),
    responsibleNames,
  };
}
