/**
 * Consultas enxutas do lado "RESOLVIDA" da Central de Ações (Fase 9K.3, plano §18 "Performance").
 * Mesma filosofia de `src/application/executive/executive-queries.ts`: cada função busca só o
 * horizonte relevante (filtrado no banco, nunca com `take` sobre uma lista maior) e nunca reaproveita
 * um workspace de módulo inteiro.
 *
 * `windowStart` decide o que é "recente" — ver `RECENTLY_RESOLVED_WINDOW_DAYS` em `action-service.ts`
 * (mesma decisão de arquitetura que `WHAT_CHANGED_WINDOW_DAYS` em `executive-service.ts`: janela
 * fixa e documentada, sem "última visita" persistida nesta sprint).
 */
import { prisma } from "@/infrastructure/database/prisma";
import type { ResolvedInstallmentSignal } from "@/domain/workspace/resolved-actions";

const VOIDED_PAYMENT_STATUSES = new Set(["FAILED", "REVERSED"]);

// ---------------------------------------------------------------------------
// Jurídico — obrigações cumpridas (`LegalObligation.fulfilledAt` real).
// ---------------------------------------------------------------------------

export async function queryResolvedLegalSignals(organizationId: string, projectId: string, windowStart: Date) {
  const obligations = await prisma.legalObligation.findMany({
    where: { organizationId, projectId, status: "FULFILLED", fulfilledAt: { not: null, gte: windowStart } },
    select: { id: true, code: true, title: true, fulfilledAt: true, amount: true, responsibleId: true },
    orderBy: { fulfilledAt: "desc" },
    take: 30,
  });
  // `fulfilledAt` é obrigatório pelo `where` acima (nunca null aqui) — o `!` só documenta o filtro, não infere nada.
  return obligations.map((item) => ({ id: item.id, code: item.code, title: item.title, fulfilledAt: item.fulfilledAt!, amount: item.amount ? Number(item.amount) : null, responsibleId: item.responsibleId }));
}

// ---------------------------------------------------------------------------
// Financeiro — parcelas liquidadas. `resolvedAt` vem do pagamento real mais recente não estornado
// (mesmo critério de `VOIDED_PAYMENT_STATUSES` de `src/domain/financial-ops/engine.ts`, reaproveitado
// aqui em vez de importado para não acoplar esta consulta ao motor de cálculo de saldo) — nunca o
// `updatedAt` genérico da parcela, que pode mudar por outros motivos.
// ---------------------------------------------------------------------------

function latestValidPayment(payments: { amount: unknown; paidAt: Date; status: string }[]): { amount: number; paidAt: Date } | null {
  const valid = payments.filter((payment) => !VOIDED_PAYMENT_STATUSES.has(payment.status));
  if (valid.length === 0) return null;
  return valid.reduce((latest, payment) => (payment.paidAt > latest.paidAt ? { amount: Number(payment.amount), paidAt: payment.paidAt } : latest), { amount: Number(valid[0].amount), paidAt: valid[0].paidAt });
}

export async function queryResolvedFinancialSignals(organizationId: string, projectId: string, windowStart: Date): Promise<{ payables: ResolvedInstallmentSignal[]; receivables: ResolvedInstallmentSignal[] }> {
  const [payables, receivables] = await Promise.all([
    prisma.payableInstallment.findMany({
      where: { payableAccount: { organizationId, projectId }, status: "PAGA", updatedAt: { gte: windowStart } },
      select: { id: true, payableAccount: { select: { description: true, responsibleId: true, supplier: { select: { name: true } } } }, payments: { select: { amount: true, paidAt: true, status: true } } },
      take: 50,
    }),
    prisma.receivableInstallment.findMany({
      where: { receivableAccount: { organizationId, projectId }, status: "RECEBIDA", updatedAt: { gte: windowStart } },
      select: { id: true, receivableAccount: { select: { description: true, responsibleId: true, customer: { select: { name: true } } } }, payments: { select: { amount: true, receivedAt: true, status: true } } },
      take: 50,
    }),
  ]);

  return {
    // Item sem nenhum pagamento válido dentro do que foi buscado nunca é emitido — nunca fabricar um `completedAt` (plano §L).
    payables: payables
      .map((item): ResolvedInstallmentSignal | null => {
        const payment = latestValidPayment(item.payments.map((p) => ({ amount: p.amount, paidAt: p.paidAt, status: p.status })));
        if (!payment) return null;
        return { id: item.id, description: item.payableAccount.description, counterpartyName: item.payableAccount.supplier?.name ?? null, amount: payment.amount, completedAt: payment.paidAt, responsibleId: item.payableAccount.responsibleId };
      })
      .filter((item): item is ResolvedInstallmentSignal => item !== null),
    receivables: receivables
      .map((item): ResolvedInstallmentSignal | null => {
        const payment = latestValidPayment(item.payments.map((p) => ({ amount: p.amount, paidAt: p.receivedAt, status: p.status })));
        if (!payment) return null;
        return { id: item.id, description: item.receivableAccount.description, counterpartyName: item.receivableAccount.customer?.name ?? null, amount: payment.amount, completedAt: payment.paidAt, responsibleId: item.receivableAccount.responsibleId };
      })
      .filter((item): item is ResolvedInstallmentSignal => item !== null),
  };
}

// ---------------------------------------------------------------------------
// Decisões/Aprovações concluídas (`ApprovalRequest.completedAt` real).
// ---------------------------------------------------------------------------

export async function queryResolvedApprovals(organizationId: string, projectIds: string[], windowStart: Date) {
  const requests = await prisma.approvalRequest.findMany({
    where: { organizationId, status: { in: ["APPROVED", "REJECTED"] }, completedAt: { not: null, gte: windowStart }, projectId: { in: projectIds } },
    select: { id: true, actType: true, entityType: true, amount: true, completedAt: true, status: true, projectId: true, requestedById: true, policy: { select: { requiredRole: true } } },
    orderBy: { completedAt: "desc" },
    take: 30,
  });
  return requests.map((item) => ({
    id: item.id,
    actType: item.actType,
    entityType: item.entityType,
    amount: Number(item.amount),
    // `completedAt`/`status` restritos pelo `where` acima (nunca null, sempre APPROVED/REJECTED aqui).
    completedAt: item.completedAt!,
    decision: item.status as "APPROVED" | "REJECTED",
    projectId: item.projectId,
    requestedById: item.requestedById,
    requiredRole: item.policy?.requiredRole ?? null,
  }));
}
