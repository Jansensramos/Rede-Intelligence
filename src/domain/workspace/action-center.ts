/**
 * Funções puras da Central de Ações / Minha Rotina (Fase 9K.3, plano §L). Nenhuma consulta aqui —
 * recebem a lista de `ExecutiveException` já montada (ABERTA + RESOLVIDA, ver
 * `src/application/actions/action-service.ts`) e apenas filtram/ordenam. Mesmo princípio das
 * demais funções puras deste diretório (`exceptions.ts`, `exception-builders.ts`): mesma entrada,
 * mesma saída, sem I/O, testável sem banco.
 *
 * "Minhas"/"Minha Rotina" (ordem de serviço §M): um item só é atribuível a alguém quando o FATO de
 * origem já tem um responsável real (`ExecutiveException.responsibleId`). Nunca inferido, nunca
 * "o usuário atual" por padrão — ver `filterMine`.
 */
import type { MembershipRole } from "@prisma/client";
import { sortExceptionsByActionPriority, type ExecutiveException } from "./exceptions";

/** Mesma régua de alçada já usada em `sales-service.ts`/`tool-registry.ts` — não um segundo conceito de hierarquia. */
const roleRank: Record<MembershipRole, number> = { VIEWER: 0, REVIEWER: 1, ANALYST: 2, ADMIN: 3, OWNER: 4 };

/** Horizonte de "Próximas" (itens com prazo à frente, ainda não vencidos) — janela fixa e documentada, mesma filosofia de `WHAT_CHANGED_WINDOW_DAYS`. */
export const UPCOMING_HORIZON_DAYS = 14;

function isoDay(value: string | Date): string {
  return (typeof value === "string" ? value : value.toISOString()).slice(0, 10);
}

function isOpen(item: ExecutiveException): boolean {
  return item.status === "ABERTA";
}

/** "Minhas" (Central de Ações) / base de "Minha Rotina": só entra quando o FATO original já tem `responsibleId` E ele é o usuário atual. Nunca atribui um item sem responsável real. */
export function filterMine(actions: ExecutiveException[], userId: string): ExecutiveException[] {
  return actions.filter((item) => item.responsibleId != null && item.responsibleId === userId);
}

/** "Hoje": itens ABERTOS com prazo (`dueDate`) no mesmo dia calendário de `referenceDate`. Itens sem prazo nunca entram (nunca fabricar data). */
export function filterDueToday(actions: ExecutiveException[], referenceDate: Date): ExecutiveException[] {
  const today = isoDay(referenceDate);
  return actions.filter((item) => isOpen(item) && item.dueDate != null && isoDay(item.dueDate) === today);
}

/** "Atrasadas": itens ABERTOS com prazo já vencido (dia calendário anterior a `referenceDate`). */
export function filterOverdue(actions: ExecutiveException[], referenceDate: Date): ExecutiveException[] {
  const today = isoDay(referenceDate);
  return actions.filter((item) => isOpen(item) && item.dueDate != null && isoDay(item.dueDate) < today);
}

/** "Próximas": itens ABERTOS com prazo futuro dentro do horizonte (`UPCOMING_HORIZON_DAYS` por padrão), sem incluir hoje nem itens vencidos. */
export function filterUpcoming(actions: ExecutiveException[], referenceDate: Date, horizonDays: number = UPCOMING_HORIZON_DAYS): ExecutiveException[] {
  const today = isoDay(referenceDate);
  const horizon = isoDay(new Date(referenceDate.getTime() + horizonDays * 86_400_000));
  return actions.filter((item) => isOpen(item) && item.dueDate != null && isoDay(item.dueDate) > today && isoDay(item.dueDate) <= horizon);
}

/** "Aguardando aprovação" (Central de Ações): qualquer item ABERTO com alçada mínima definida (`approvalCapability`), independente de quem pode decidir — RBAC de domínio já filtrou o que chega até aqui. */
export function filterAwaitingApproval(actions: ExecutiveException[]): ExecutiveException[] {
  return actions.filter((item) => isOpen(item) && item.approvalCapability != null);
}

/** "Aguardando minha aprovação" (Minha Rotina): igual à anterior, mas só quando o papel do usuário atende a alçada mínima (`ApprovalPolicy.requiredRole`, plano §AN) — nunca a role de quem só pode ver o domínio. */
export function filterAwaitingMyApproval(actions: ExecutiveException[], userRole: MembershipRole): ExecutiveException[] {
  return filterAwaitingApproval(actions).filter((item) => roleRank[userRole] >= roleRank[item.approvalCapability!.requiredRole]);
}

/** "Concluídas recentemente": só itens RESOLVIDA, mais recente primeiro (por `resolvedAt` real). */
export function sortRecentlyResolved(resolvedActions: ExecutiveException[]): ExecutiveException[] {
  return resolvedActions
    .filter((item) => item.status === "RESOLVIDA" && item.resolvedAt != null)
    .sort((a, b) => new Date(b.resolvedAt!).getTime() - new Date(a.resolvedAt!).getTime());
}

export { sortExceptionsByActionPriority };

export interface ActionCenterBuckets {
  all: ExecutiveException[];
  mine: ExecutiveException[];
  today: ExecutiveException[];
  overdue: ExecutiveException[];
  upcoming: ExecutiveException[];
  awaitingApproval: ExecutiveException[];
  recentlyResolved: ExecutiveException[];
}

export interface MyRoutineBuckets {
  today: ExecutiveException[];
  overdue: ExecutiveException[];
  upcoming: ExecutiveException[];
  awaitingMyApproval: ExecutiveException[];
  recentlyResolved: ExecutiveException[];
}

/** Central de Ações (ordem de serviço §4): as 7 abas do plano, sem restringir a "meus" exceto a própria aba "Minhas". */
export function buildActionCenterBuckets(openActions: ExecutiveException[], resolvedActions: ExecutiveException[], params: { referenceDate: Date; userId: string }): ActionCenterBuckets {
  const open = openActions.filter(isOpen);
  return {
    all: sortExceptionsByActionPriority(open),
    mine: sortExceptionsByActionPriority(filterMine(open, params.userId)),
    today: sortExceptionsByActionPriority(filterDueToday(open, params.referenceDate)),
    overdue: sortExceptionsByActionPriority(filterOverdue(open, params.referenceDate)),
    upcoming: sortExceptionsByActionPriority(filterUpcoming(open, params.referenceDate)),
    awaitingApproval: sortExceptionsByActionPriority(filterAwaitingApproval(open)),
    recentlyResolved: sortRecentlyResolved(resolvedActions),
  };
}

/**
 * Minha Rotina (ordem de serviço §5, "O que eu preciso fazer hoje?"): todo bucket de prazo é
 * primeiro restrito a `filterMine` — nunca mostra o item de outra pessoa. "Aguardando minha
 * aprovação" é a exceção: aprovações nunca têm `responsibleId` (decisão de `buildApprovalExceptions`
 * — quem decide é a alçada/role, não uma pessoa atribuída), então o filtro correto ali é
 * `filterAwaitingMyApproval` (por papel), não `filterMine`.
 */
export function buildMyRoutineBuckets(openActions: ExecutiveException[], resolvedActions: ExecutiveException[], params: { referenceDate: Date; userId: string; userRole: MembershipRole }): MyRoutineBuckets {
  const open = openActions.filter(isOpen);
  const mine = filterMine(open, params.userId);
  return {
    today: sortExceptionsByActionPriority(filterDueToday(mine, params.referenceDate)),
    overdue: sortExceptionsByActionPriority(filterOverdue(mine, params.referenceDate)),
    upcoming: sortExceptionsByActionPriority(filterUpcoming(mine, params.referenceDate)),
    awaitingMyApproval: sortExceptionsByActionPriority(filterAwaitingMyApproval(open, params.userRole)),
    recentlyResolved: sortRecentlyResolved(filterMine(resolvedActions, params.userId)),
  };
}
