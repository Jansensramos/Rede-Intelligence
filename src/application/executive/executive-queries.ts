/**
 * Consultas enxutas para a Gestão Executiva (Fase 9K.2, plano §18 "Performance" e §AS: "criar
 * consultas/read models executivos específicos... evitar carregar workspaces gigantes apenas para
 * extrair um número"). Deliberadamente NÃO reaproveita `getFinancialWorkspace`/`getSalesWorkspace`/
 * `getAccountingWorkspace`/`getPeoplePerformanceWorkspace` inteiros: essas funções carregam grafos
 * completos (parcelas sem `take`, unidades com `take: 2000`, vendas com 5 níveis de include) — o
 * dobro do problema de performance que a 9K.1 já resolveu para a navegação por área não pode
 * reaparecer aqui.
 *
 * Duas exceções deliberadas, confirmadas como já enxutas:
 *  - `getOperationsWorkspace` (5 `findFirst` limitados a "a versão mais recente", sem lista
 *    ilimitada) — reaproveitado tal como está.
 *  - `getIntegrationsWorkspace`/`getMarketProductWorkspace` são, na prática, ORGANIZACIONAIS (o
 *    `projectId` de `getIntegrationsWorkspace` é só guarda de tenant — todas as instalações do
 *    Grupo/Empresa/SPE/Empreendimento voltam juntas) — nunca chamar em loop por projeto.
 *
 * `getLegalWorkspace` também foi deliberadamente EVITADO aqui: ele dispara `refreshLegalDeadlines`
 * como efeito colateral a cada leitura (upsert em `LegalAlert`), o que tornaria a Gestão Executiva
 * — uma tela de leitura — uma fonte de escrita a cada navegação/refresh, inclusive numa varredura
 * de carteira com N projetos. Este módulo computa a severidade jurídica diretamente de
 * `LegalObligation.dueAt`/`LegalLicense.expiresAt` via as mesmas funções puras que
 * `refreshLegalDeadlines` usa (`src/domain/legal/engine.ts`), sem gravar nada.
 */
import { prisma } from "@/infrastructure/database/prisma";
import { PAYABLE_TERMINAL_STATUSES, RECEIVABLE_TERMINAL_STATUSES, computeInstallmentBalance, type InstallmentPaymentLike } from "@/domain/financial-ops/engine";
import type { InstallmentSignal } from "@/domain/workspace/exception-builders";
import { latestTimestamp } from "@/domain/workspace/freshness";

async function projectForTenant(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  return project;
}

// ---------------------------------------------------------------------------
// Jurídico
// ---------------------------------------------------------------------------

export async function queryLegalSignals(organizationId: string, projectId: string) {
  const [obligations, licenses] = await Promise.all([
    prisma.legalObligation.findMany({
      where: { organizationId, projectId, status: { notIn: ["FULFILLED", "WAIVED", "CANCELLED"] } },
      select: { id: true, code: true, title: true, dueAt: true, amount: true, updatedAt: true, responsibleId: true },
      orderBy: { dueAt: "asc" },
      take: 50,
    }),
    prisma.legalLicense.findMany({
      where: { organizationId, projectId, expiresAt: { not: null }, status: { notIn: ["REJECTED", "SUSPENDED", "EXPIRED"] } },
      select: { id: true, code: true, title: true, expiresAt: true, updatedAt: true, responsibleId: true },
      orderBy: { expiresAt: "asc" },
      take: 50,
    }),
  ]);
  // Gate 3 do fechamento da 9K.2 (freshness real): o timestamp mais recente entre os próprios
  // registros já buscados — nunca uma consulta adicional só para isso.
  const latestUpdatedAt = latestTimestamp([...obligations.map((item) => item.updatedAt), ...licenses.map((item) => item.updatedAt)]);
  return {
    // `responsibleId` é obrigatório na origem (`LegalObligation`/`LegalLicense`) — sempre presente aqui, nunca inventado (plano §L/9K.3).
    obligations: obligations.map((item) => ({ id: item.id, code: item.code, title: item.title, dueAt: item.dueAt, amount: item.amount ? Number(item.amount) : null, responsibleId: item.responsibleId })),
    licenses: licenses.map((item) => ({ id: item.id, code: item.code, title: item.title, expiresAt: item.expiresAt!, responsibleId: item.responsibleId })),
    latestUpdatedAt,
  };
}

// ---------------------------------------------------------------------------
// Financeiro — só o horizonte relevante para `classifyDueSeverity` (vencido ou vence em ≤ 3 dias),
// filtrado no banco (não com `take` sobre uma lista maior). Recebíveis de venda (`saleId` presente)
// ficam fora daqui — eles são inadimplência Comercial (`querySalesSignals`), nunca os dois ao
// mesmo tempo (ordem de serviço §4, "não duplicar verdade").
// ---------------------------------------------------------------------------

function toInstallmentSignal(item: { id: string; currentAmount: unknown; dueDate: Date; description: string; counterpartyName: string | null; responsibleId?: string | null; payments: { amount: unknown; status: string }[] }): InstallmentSignal {
  return {
    id: item.id,
    description: item.description,
    counterpartyName: item.counterpartyName,
    dueDate: item.dueDate,
    balance: computeInstallmentBalance(Number(item.currentAmount), item.payments.map((payment) => ({ amount: Number(payment.amount), status: payment.status as InstallmentPaymentLike["status"] }))),
    // `PayableAccount.responsibleId`/`ReceivableAccount.responsibleId` são opcionais na origem — repassado tal como está, nunca inventado (plano §L/9K.3).
    responsibleId: item.responsibleId ?? null,
  };
}

export async function queryFinancialSignals(organizationId: string, projectId: string, companyId: string | null, referenceDate: Date) {
  const horizon = new Date(referenceDate.getTime() + 7 * 86_400_000);
  const [payables, receivables, cashRows] = await Promise.all([
    prisma.payableInstallment.findMany({
      where: { payableAccount: { organizationId, projectId }, status: { notIn: [...PAYABLE_TERMINAL_STATUSES] }, dueDate: { lte: horizon } },
      select: { id: true, currentAmount: true, dueDate: true, updatedAt: true, payableAccount: { select: { description: true, responsibleId: true, supplier: { select: { name: true } } } }, payments: { select: { amount: true, status: true } } },
      orderBy: { dueDate: "asc" },
      take: 100,
    }),
    prisma.receivableInstallment.findMany({
      where: { receivableAccount: { organizationId, projectId, saleId: null }, status: { notIn: [...RECEIVABLE_TERMINAL_STATUSES] }, dueDate: { lte: horizon } },
      select: { id: true, currentAmount: true, dueDate: true, updatedAt: true, receivableAccount: { select: { description: true, responsibleId: true, customer: { select: { name: true } } } }, payments: { select: { amount: true, status: true } } },
      orderBy: { dueDate: "asc" },
      take: 100,
    }),
    companyId
      ? Promise.all([
          prisma.bankAccount.aggregate({ where: { organizationId, companyId }, _sum: { openingBalance: true } }),
          prisma.bankTransaction.aggregate({ where: { bankAccount: { companyId }, direction: "CREDIT" }, _sum: { amount: true } }),
          prisma.bankTransaction.aggregate({ where: { bankAccount: { companyId }, direction: "DEBIT" }, _sum: { amount: true } }),
        ])
      : null,
  ]);

  const cashPosition = cashRows
    ? Number(cashRows[0]._sum.openingBalance ?? 0) + Number(cashRows[1]._sum.amount ?? 0) - Number(cashRows[2]._sum.amount ?? 0)
    : null;
  // Gate 3 (freshness real): cash é um agregado ao vivo (sem registro único para ancorar); as
  // parcelas têm `updatedAt` real — usamos o mais recente entre elas quando existir.
  const latestUpdatedAt = latestTimestamp([...payables.map((item) => item.updatedAt), ...receivables.map((item) => item.updatedAt)]);

  return {
    payables: payables.map((item) => toInstallmentSignal({ id: item.id, currentAmount: item.currentAmount, dueDate: item.dueDate, description: item.payableAccount.description, counterpartyName: item.payableAccount.supplier?.name ?? null, responsibleId: item.payableAccount.responsibleId, payments: item.payments })),
    receivables: receivables.map((item) => toInstallmentSignal({ id: item.id, currentAmount: item.currentAmount, dueDate: item.dueDate, description: item.receivableAccount.description, counterpartyName: item.receivableAccount.customer?.name ?? null, responsibleId: item.receivableAccount.responsibleId, payments: item.payments })),
    cashPosition,
    latestUpdatedAt,
  };
}

// ---------------------------------------------------------------------------
// Comercial — contagem de unidades por status + VGV vendido (agregados, sem carregar as 2000
// unidades/500 vendas que `getSalesWorkspace` carrega) + recebíveis de venda inadimplentes.
// ---------------------------------------------------------------------------

export async function querySalesSignals(organizationId: string, projectId: string, referenceDate: Date) {
  const [unitGroups, soldAggregate, overdueReceivables, pendingApprovalSales, creditReviewRequired, signaturePending, signatureFailed] = await Promise.all([
    prisma.salesUnit.groupBy({ by: ["status"], where: { organizationId, projectId }, _count: { _all: true } }),
    prisma.sale.aggregate({ where: { organizationId, projectId, status: "APPROVED" }, _sum: { soldPrice: true }, _count: { _all: true } }),
    prisma.receivableInstallment.findMany({
      where: { receivableAccount: { organizationId, projectId, saleId: { not: null } }, status: { notIn: [...RECEIVABLE_TERMINAL_STATUSES] }, dueDate: { lt: referenceDate } },
      select: { id: true, currentAmount: true, dueDate: true, updatedAt: true, receivableAccount: { select: { description: true, responsibleId: true, customer: { select: { name: true } } } }, payments: { select: { amount: true, status: true } } },
      orderBy: { dueDate: "asc" },
      take: 50,
    }),
    // Fechamento Comercial 360 (9K.4) — mesmo padrão enxuto do resto deste arquivo (select mínimo, take limitado).
    prisma.sale.findMany({
      where: { organizationId, projectId, status: "DRAFT" },
      select: { id: true, soldPrice: true, createdById: true, createdAt: true, salesUnit: { select: { code: true } } },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
    prisma.creditBureauConsultation.findMany({
      where: { organizationId, projectId, status: "COMPLETED", result: "REQUER_ANALISE" },
      select: { id: true, requestedById: true, requestedAt: true, customer: { select: { name: true } } },
      orderBy: { requestedAt: "asc" },
      take: 50,
    }),
    prisma.signatureRequest.findMany({
      where: { organizationId, projectId, status: { in: ["ENVIADO", "AGUARDANDO_ASSINATURAS"] } },
      select: { id: true, createdById: true, preparedAt: true, sentAt: true, contract: { select: { number: true } } },
      orderBy: { preparedAt: "asc" },
      take: 50,
    }),
    prisma.signatureRequest.findMany({
      where: { organizationId, projectId, status: { in: ["RECUSADO", "ERRO"] } },
      select: { id: true, createdById: true, status: true, errorMessage: true, updatedAt: true, contract: { select: { number: true } } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
  ]);

  const unitsByStatus = Object.fromEntries(unitGroups.map((group) => [group.status, group._count._all]));
  return {
    unitsAvailable: unitsByStatus["DISPONIVEL"] ?? 0,
    unitsSold: (unitsByStatus["VENDIDA"] ?? 0) + (unitsByStatus["ENTREGUE"] ?? 0),
    unitsTotal: unitGroups.reduce((sum, group) => sum + group._count._all, 0),
    vgvVendido: Number(soldAggregate._sum.soldPrice ?? 0),
    salesApprovedCount: soldAggregate._count._all,
    overdueReceivables: overdueReceivables.map((item) => toInstallmentSignal({ id: item.id, currentAmount: item.currentAmount, dueDate: item.dueDate, description: item.receivableAccount.description, counterpartyName: item.receivableAccount.customer?.name ?? null, responsibleId: item.receivableAccount.responsibleId, payments: item.payments })),
    pendingApprovalSales: pendingApprovalSales.map((sale) => ({ id: sale.id, unitCode: sale.salesUnit.code, soldPrice: Number(sale.soldPrice), responsibleId: sale.createdById, createdAt: sale.createdAt })),
    creditReviewRequired: creditReviewRequired.map((item) => ({ id: item.id, customerName: item.customer.name, responsibleId: item.requestedById, requestedAt: item.requestedAt })),
    signaturePending: signaturePending.map((item) => ({ id: item.id, contractNumber: item.contract.number, responsibleId: item.createdById, dueDate: item.sentAt ?? item.preparedAt })),
    signatureFailed: signatureFailed.map((item) => ({ id: item.id, contractNumber: item.contract.number, responsibleId: item.createdById, status: item.status as "RECUSADO" | "ERRO", errorMessage: item.errorMessage, updatedAt: item.updatedAt })),
    // Gate 3 (freshness real): agregados de venda/unidade são ao vivo; a única âncora real
    // disponível sem consulta extra é o `updatedAt` dos recebíveis já buscados.
    latestUpdatedAt: latestTimestamp(overdueReceivables.map((item) => item.updatedAt)),
  };
}

// ---------------------------------------------------------------------------
// Suprimentos
// ---------------------------------------------------------------------------

export async function queryProcurementSignals(organizationId: string, projectId: string) {
  const [needs, pendingMeasurements] = await Promise.all([
    prisma.procurementNeed.findMany({
      where: { organizationId, projectId, status: { notIn: ["DISCARDED"] } },
      select: { id: true, code: true, description: true, requiredAt: true, expectedLeadDays: true, bufferDays: true, updatedAt: true, requesterId: true },
      orderBy: { requiredAt: "asc" },
      take: 50,
    }),
    prisma.measurementCertificate.findMany({
      where: { organizationId, projectId, status: { in: ["SUBMITTED", "IN_TECHNICAL_REVIEW", "TECHNICALLY_APPROVED", "IN_APPROVAL"] } },
      select: { id: true, number: true, dueDate: true, netAmount: true, responsibleId: true, status: true, updatedAt: true, contract: { select: { number: true } } },
      orderBy: { dueDate: "asc" },
      take: 50,
    }),
  ]);
  return {
    needs,
    pendingMeasurements: pendingMeasurements.map((item) => ({ id: item.id, number: item.number, dueDate: item.dueDate, netAmount: Number(item.netAmount), responsibleId: item.responsibleId, status: item.status, contractNumber: item.contract.number })),
    latestUpdatedAt: latestTimestamp([...needs.map((item) => item.updatedAt), ...pendingMeasurements.map((item) => item.updatedAt)]),
  };
}

// ---------------------------------------------------------------------------
// Contabilidade — só o status do período mais recente (nunca o workspace inteiro, que tem
// múltiplas consultas sem `take` e uma `ConsolidationRun` sem filtro de projeto — ver relatório
// de investigação da 9K.2).
// ---------------------------------------------------------------------------

export async function queryAccountingSignal(organizationId: string, companyId: string | null) {
  if (!companyId) return null;
  const period = await prisma.accountingPeriod.findFirst({
    where: { organizationId, companyId },
    orderBy: { referenceMonth: "desc" },
    select: { referenceMonth: true, status: true, closedAt: true, updatedAt: true },
  });
  return period;
}

// ---------------------------------------------------------------------------
// Viabilidade — só o `updatedAt` do estudo ativo, para a freshness real (gate 3 do fechamento da
// 9K.2). Consulta separada e mínima (um campo, `findFirst`) para não alterar `PersistedStudyView`
// nem `getLatestStudyForProject`, usados por outras telas fora do escopo deste fechamento.
// ---------------------------------------------------------------------------

export async function queryStudyUpdatedAt(organizationId: string, projectId: string) {
  const study = await prisma.viabilityStudy.findFirst({
    where: { status: "ACTIVE", projectId, project: { organizationId } },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  return study?.updatedAt ?? null;
}

// ---------------------------------------------------------------------------
// Integrações — organizacional (nunca em loop por projeto de carteira; ver cabeçalho do arquivo).
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export async function queryIntegrationSignals(organizationId: string) {
  const now = new Date();
  const installations = await prisma.connectorInstallation.findMany({
    where: { organizationId },
    select: {
      id: true,
      name: true,
      status: true,
      healthStatus: true,
      lastSyncAt: true,
      economicGroup: { select: { name: true } },
      company: { select: { name: true } },
      project: { select: { name: true } },
      credential: { select: { status: true, expiresAt: true } },
    },
    take: 200,
  });
  return installations.map((item) => ({
    id: item.id,
    name: item.name,
    scopeLabel: item.project?.name ?? item.company?.name ?? item.economicGroup?.name ?? "Organização",
    lastSyncAt: item.lastSyncAt,
    credentialExpiresAt: item.credential?.expiresAt ?? null,
    installationStatus: item.status,
    healthStatus: item.healthStatus,
    credentialStatus: item.credential?.status ?? ("PENDING" as const),
    stale: !item.lastSyncAt || now.getTime() - item.lastSyncAt.getTime() > STALE_THRESHOLD_MS,
  }));
}

// ---------------------------------------------------------------------------
// Aprovações pendentes (plano §12; reaproveita `ApprovalRequest` de Suprimentos/Comercial)
// ---------------------------------------------------------------------------

export async function queryPendingApprovals(organizationId: string, projectIds?: string[]) {
  const requests = await prisma.approvalRequest.findMany({
    where: { organizationId, status: "PENDING", ...(projectIds ? { projectId: { in: projectIds } } : {}) },
    // `policy` é opcional na origem (`ApprovalRequest.policyId` pode ser nulo) — `requiredRole` só
    // existe quando há política vinculada; nunca inferido quando ausente (plano §L "alcada"/§AN).
    select: { id: true, actType: true, entityType: true, amount: true, requestedAt: true, projectId: true, requestedById: true, policy: { select: { requiredRole: true } } },
    orderBy: { requestedAt: "asc" },
    take: 30,
  });
  return requests.map((item) => ({
    id: item.id,
    actType: item.actType,
    entityType: item.entityType,
    amount: Number(item.amount),
    requestedAt: item.requestedAt,
    projectId: item.projectId,
    requestedById: item.requestedById,
    requiredRole: item.policy?.requiredRole ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Capital & Funding (Fase 9N) — só o subconjunto usado pelos builders de exceção; o workspace
// completo (propostas, garantias, cronograma) vive em `application/capital/capital-queries.ts`.
// ---------------------------------------------------------------------------

export async function queryCapitalSignals(organizationId: string, projectId: string) {
  const proposals = await prisma.fundingProposal.findMany({
    where: { organizationId, projectId },
    select: {
      id: true, code: true, providerName: true, amount: true, status: true, validUntil: true, updatedAt: true,
      conditions: { where: { status: "PENDING" }, select: { id: true, code: true, category: true, description: true, dueAt: true, responsibleId: true } },
      covenants: { where: { status: { in: ["WARNING", "BREACHED"] } }, select: { id: true, code: true, description: true, status: true, nextTestDate: true } },
      disbursements: { where: { status: { notIn: ["DISBURSED", "CANCELLED"] } }, select: { id: true, sequence: true, status: true, expectedDate: true, expectedAmount: true } },
    },
    take: 50,
  });

  const conditions = proposals.flatMap((p) => p.conditions.map((c) => ({ ...c, proposalId: p.id })));
  const covenants = proposals.flatMap((p) => p.covenants.map((c) => ({ ...c, proposalId: p.id })));
  const disbursements = proposals.flatMap((p) => p.disbursements.map((d) => ({ id: d.id, proposalId: p.id, sequence: d.sequence, status: d.status, expectedDate: d.expectedDate, expectedAmount: Number(d.expectedAmount) })));
  const proposalsAwaitingDecision = proposals.filter((p) => p.status === "SUBMITTED" || p.status === "UNDER_REVIEW").map((p) => ({ id: p.id, code: p.code, providerName: p.providerName, amount: Number(p.amount), status: p.status, validUntil: p.validUntil }));

  return {
    conditions,
    covenants,
    disbursements,
    proposalsAwaitingDecision,
    fundingContratado: proposals.filter((p) => p.status === "APPROVED").reduce((sum, p) => sum + Number(p.amount), 0),
    latestUpdatedAt: latestTimestamp(proposals.map((p) => p.updatedAt)),
  };
}

export { projectForTenant };
