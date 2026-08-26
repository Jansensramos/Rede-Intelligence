/**
 * Cliente 360 (Fase 9K.4B) — visão operacional única do cliente. Read model transversal: nunca uma
 * segunda fonte de verdade (mesmo princípio de `action-service.ts`/`executive-service.ts`) — cada
 * seção lê direto de `Sale`/`SalesContract`/`SignatureRequest`/`CreditBureauConsultation`/
 * `ReceivableInstallment`, já existentes desde 9E/9K.4, e nunca duplica o estado deles. Nenhuma
 * mutação — este arquivo só monta leitura.
 *
 * RBAC (item 8, "backend é autoridade"): `hasWorkspaceCapability` decide, aqui — nunca só na UI —
 * quais seções são POPULADAS. Uma seção sem a capacidade correspondente nunca dispara a consulta ao
 * banco (mesmo padrão de `authorizedExecutiveDomains`/`getExecutiveOpenExceptions`), e o payload
 * distingue explicitamente "sem permissão" (`authorized: false`) de "sem dados" (`authorized: true`,
 * lista vazia) — plano §10.
 */
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { hasWorkspaceCapability } from "@/domain/workspace/capabilities";
import { maskTaxId } from "@/domain/sales/contract-closing";
import { buildInstallmentPositions, summarizeClientFinancialPosition, sumClientFinancialPositions, type ClientFinancialPosition, type ClientInstallmentPosition } from "@/domain/sales/customer-360";
import {
  buildCommercialClosingExceptions, buildSalesExceptions,
  type CreditReviewSignal, type ExceptionTenantContext, type InstallmentSignal,
  type PendingApprovalSaleSignal, type SignatureFailedSignal, type SignaturePendingSignal,
} from "@/domain/workspace/exception-builders";
import { sortExceptionsByActionPriority, type ExecutiveException } from "@/domain/workspace/exceptions";
import { resolveResponsibleNames } from "@/application/actions/action-service";
import { listCreditConsultations } from "./credit-service";

type Capabilities = Pick<AuthContext, "organizationId" | "role">;

async function customerForTenant(organizationId: string, customerId: string) {
  return prisma.customer.findFirst({ where: { id: customerId, organizationId } });
}

const saleInclude = {
  salesUnit: { select: { id: true, code: true, status: true } },
  project: { select: { id: true, name: true } },
  parties: { include: { customer: { select: { id: true, name: true } } } },
  broker: { select: { id: true, name: true } },
  contract: {
    include: {
      documents: { orderBy: { createdAt: "desc" as const } },
      signatureRequests: { orderBy: { createdAt: "desc" as const }, include: { parties: true } },
    },
  },
  paymentPlans: {
    orderBy: { version: "desc" as const },
    include: { installments: { include: { receivableInstallment: { include: { payments: { select: { amount: true, status: true } } } } } } },
  },
  commissions: { include: { broker: { select: { id: true, name: true } } } },
} satisfies Prisma.SaleInclude;

type SaleWithRelations = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

function activePlanPositions(sale: SaleWithRelations, referenceDate: Date): ClientInstallmentPosition[] {
  const plan = sale.paymentPlans.find((item) => item.status === "ACTIVE");
  if (!plan) return [];
  return buildInstallmentPositions(
    plan.installments.map((item) => ({
      id: item.id,
      number: item.number,
      dueDate: item.dueDate,
      currentAmount: Number(item.receivableInstallment?.currentAmount ?? item.amount),
      status: item.receivableInstallment?.status ?? "PREVISTA",
      payments: (item.receivableInstallment?.payments ?? []).map((payment) => ({ amount: Number(payment.amount), status: payment.status })),
    })),
    referenceDate,
  );
}

// ---------------------------------------------------------------------------
// Central de Ações do cliente (item 6) — reaproveita 100% os builders puros da 9K.3/9K.4, só com
// sinais recortados por cliente em vez de por empreendimento inteiro. Nenhuma tarefa/exceção nova.
// ---------------------------------------------------------------------------

interface CreditReviewCandidate { id: string; projectId: string | null; requestedById: string; requestedAt: Date }

function buildClientActions(organizationId: string, customerName: string, sales: SaleWithRelations[], creditReviewCandidates: CreditReviewCandidate[], extraProjectNames: Map<string, string>, referenceDate: Date): ExecutiveException[] {
  const byProject = new Map<string, { ctx: ExceptionTenantContext; sales: SaleWithRelations[] }>();
  for (const sale of sales) {
    const entry = byProject.get(sale.projectId) ?? { ctx: { organizationId: sale.organizationId, companyId: sale.companyId, projectId: sale.projectId, projectName: sale.project.name }, sales: [] };
    entry.sales.push(sale);
    byProject.set(sale.projectId, entry);
  }
  // Cliente pode ter uma consulta de crédito num empreendimento onde ainda não há venda (proposta
  // só) — cria o grupo mesmo assim, desde que o nome do empreendimento tenha sido resolvido; nunca
  // inventa um nome quando `extraProjectNames` não o tem (ex.: consulta sem `projectId`).
  for (const candidate of creditReviewCandidates) {
    if (!candidate.projectId || byProject.has(candidate.projectId)) continue;
    const projectName = extraProjectNames.get(candidate.projectId);
    if (!projectName) continue;
    byProject.set(candidate.projectId, { ctx: { organizationId, companyId: null, projectId: candidate.projectId, projectName }, sales: [] });
  }

  const exceptions: ExecutiveException[] = [];
  for (const [projectId, { ctx, sales: projectSales }] of byProject.entries()) {
    const overdueReceivables: InstallmentSignal[] = [];
    const pendingApprovalSales: PendingApprovalSaleSignal[] = [];
    const signaturePending: SignaturePendingSignal[] = [];
    const signatureFailed: SignatureFailedSignal[] = [];

    for (const sale of projectSales) {
      if (sale.status === "DRAFT") pendingApprovalSales.push({ id: sale.id, unitCode: sale.salesUnit.code, soldPrice: Number(sale.soldPrice), responsibleId: sale.createdById, createdAt: sale.createdAt });

      for (const position of activePlanPositions(sale, referenceDate)) {
        if (!position.overdue) continue;
        overdueReceivables.push({ id: position.id, description: `${sale.contract?.title ?? sale.salesUnit.code} — parcela ${position.number}`, counterpartyName: customerName, dueDate: new Date(position.dueDate), balance: position.balance, responsibleId: sale.createdById });
      }

      const signatureRequest = sale.contract?.signatureRequests[0];
      if (signatureRequest && ["ENVIADO", "AGUARDANDO_ASSINATURAS"].includes(signatureRequest.status)) {
        signaturePending.push({ id: signatureRequest.id, contractNumber: sale.contract!.number, responsibleId: signatureRequest.createdById, dueDate: signatureRequest.sentAt ?? signatureRequest.preparedAt });
      }
      if (signatureRequest && ["RECUSADO", "ERRO"].includes(signatureRequest.status)) {
        signatureFailed.push({ id: signatureRequest.id, contractNumber: sale.contract!.number, responsibleId: signatureRequest.createdById, status: signatureRequest.status as "RECUSADO" | "ERRO", errorMessage: signatureRequest.errorMessage, updatedAt: signatureRequest.updatedAt });
      }
    }

    const creditReviewRequired: CreditReviewSignal[] = creditReviewCandidates.filter((item) => item.projectId === projectId).map((item) => ({ id: item.id, customerName, responsibleId: item.requestedById, requestedAt: item.requestedAt }));

    exceptions.push(...buildSalesExceptions(ctx, overdueReceivables, referenceDate));
    exceptions.push(...buildCommercialClosingExceptions(ctx, { pendingApprovalSales, creditReviewRequired, signaturePending, signatureFailed }, referenceDate));
  }
  return sortExceptionsByActionPriority(exceptions);
}

// ---------------------------------------------------------------------------
// Montagem principal
// ---------------------------------------------------------------------------

export interface Customer360View {
  customer: { id: string; name: string; personType: string; taxIdMasked: string | null; email: string | null; phone: string | null; status: string };
  generatedAt: string;
  capabilities: { commercialView: boolean; financialView: boolean; legalView: boolean };

  units: { authorized: boolean; items: { projectId: string; projectName: string; unitId: string; unitCode: string; unitStatus: string }[] };
  proposals: { authorized: boolean; items: { id: string; unitCode: string; projectName: string; broker: string | null; proposedPrice: number; discountAmount: number; validUntil: string; status: string }[] };
  reservations: { authorized: boolean; items: { id: string; unitCode: string; projectName: string; expiresAt: string; status: string }[] };
  sales: {
    authorized: boolean;
    items: {
      id: string; unitCode: string; projectName: string; soldPrice: number; discountAmount: number; status: string; broker: string | null;
      contract: { id: string; number: string; title: string; status: string; signatureStatus: string; effectiveFrom: string | null } | null;
      documents: { id: string; kind: string; status: string; version: number; fileName: string }[];
      signatureRequest: { id: string; status: string; provider: string; errorMessage: string | null; parties: { displayName: string; role: string; status: string; signedAt: string | null; declinedAt: string | null; declinedReason: string | null }[] } | null;
      paymentPlanVersions: { version: number; status: string; activatedAt: string | null; supersededAt: string | null; renegotiated: boolean }[];
      cancelledAt: string | null; cancelledReason: string | null;
    }[];
  };
  commissions: { authorized: boolean; items: { id: string; saleId: string; unitCode: string; broker: string; amount: number; status: string }[] };
  postSale: { authorized: boolean; items: { id: string; unitCode: string; category: string; status: string; updates: number; createdAt: string }[] };
  credit: { authorized: boolean; items: { id: string; provider: string; purpose: string; status: string; result: string | null; score: number | null; cpfMasked: string; findingsSummary: unknown; requestedAt: string; completedAt: string | null; retentionUntil: string | null; errorMessage: string | null }[] };

  financial: {
    authorized: boolean;
    totals: ClientFinancialPosition | null;
    bySale: { saleId: string; unitCode: string; contractNumber: string | null; projectName: string; position: ClientFinancialPosition; installments: ClientInstallmentPosition[] }[];
  };

  actions: { authorized: boolean; items: ExecutiveException[]; responsibleNames: Record<string, string> };
}

export async function getCustomer360(context: Capabilities, customerId: string, referenceDate = new Date()): Promise<Customer360View | null> {
  const customer = await customerForTenant(context.organizationId, customerId);
  if (!customer) return null;

  const commercialView = hasWorkspaceCapability(context.role, "COMMERCIAL_VIEW");
  const financialView = hasWorkspaceCapability(context.role, "FINANCIAL_VIEW");
  const legalView = hasWorkspaceCapability(context.role, "LEGAL_VIEW");

  const sales: SaleWithRelations[] = commercialView || financialView
    ? await prisma.sale.findMany({ where: { organizationId: context.organizationId, parties: { some: { customerId } } }, include: saleInclude, orderBy: { createdAt: "desc" }, take: 100 })
    : [];

  const [proposals, reservations, postSaleRequests, creditConsultations] = await Promise.all([
    commercialView
      ? prisma.salesProposal.findMany({ where: { organizationId: context.organizationId, customerId }, include: { salesUnit: { select: { code: true } }, project: { select: { name: true } }, broker: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 50 })
      : Promise.resolve([]),
    commercialView
      ? prisma.salesReservation.findMany({ where: { organizationId: context.organizationId, customerId }, include: { salesUnit: { select: { code: true } }, project: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 50 })
      : Promise.resolve([]),
    commercialView
      ? prisma.postSaleRequest.findMany({ where: { organizationId: context.organizationId, customerId }, include: { salesUnit: { select: { code: true } }, updates: true }, orderBy: { createdAt: "desc" }, take: 50 })
      : Promise.resolve([]),
    commercialView ? listCreditConsultations(context, customerId) : Promise.resolve([]),
  ]);

  // Gate 2 (item 8, "backend é autoridade"): sem COMMERCIAL_VIEW, os dados de unidade/venda nunca
  // chegam a ser montados no payload de resposta — não basta marcar `authorized: false` e mandar o
  // dado mesmo assim (isso vazaria via inspeção do payload, mesmo com a UI escondendo a seção).
  const unitsMap = new Map<string, { projectId: string; projectName: string; unitId: string; unitCode: string; unitStatus: string }>();
  if (commercialView) {
    for (const sale of sales) unitsMap.set(sale.salesUnit.id, { projectId: sale.projectId, projectName: sale.project.name, unitId: sale.salesUnit.id, unitCode: sale.salesUnit.code, unitStatus: sale.salesUnit.status });
    for (const proposal of proposals) unitsMap.set(`${proposal.salesUnitId}`, unitsMap.get(proposal.salesUnitId) ?? { projectId: proposal.projectId, projectName: proposal.project.name, unitId: proposal.salesUnitId, unitCode: proposal.salesUnit.code, unitStatus: "—" });
    for (const reservation of reservations) unitsMap.set(`${reservation.salesUnitId}`, unitsMap.get(reservation.salesUnitId) ?? { projectId: reservation.projectId, projectName: reservation.project.name, unitId: reservation.salesUnitId, unitCode: reservation.salesUnit.code, unitStatus: "—" });
  }

  const financialBySale = financialView
    ? sales.map((sale) => {
        const installments = activePlanPositions(sale, referenceDate);
        const position = summarizeClientFinancialPosition(installments, sale.status === "CANCELLED" ? 0 : Number(sale.soldPrice));
        return { saleId: sale.id, unitCode: sale.salesUnit.code, contractNumber: sale.contract?.number ?? null, projectName: sale.project.name, position, installments };
      })
    : [];

  let actions: ExecutiveException[] = [];
  if (commercialView) {
    const creditReviewCandidates = creditConsultations.filter((item) => item.status === "COMPLETED" && item.result === "REQUER_ANALISE").map((item) => ({ id: item.id, projectId: item.projectId, requestedById: item.requestedById, requestedAt: item.requestedAt }));
    const knownProjectIds = new Set(sales.map((sale) => sale.projectId));
    const missingProjectIds = [...new Set(creditReviewCandidates.map((item) => item.projectId).filter((id): id is string => id !== null && !knownProjectIds.has(id)))];
    const extraProjectNames = missingProjectIds.length > 0
      ? new Map((await prisma.project.findMany({ where: { organizationId: context.organizationId, id: { in: missingProjectIds } }, select: { id: true, name: true } })).map((project) => [project.id, project.name]))
      : new Map<string, string>();
    actions = buildClientActions(context.organizationId, customer.name, sales, creditReviewCandidates, extraProjectNames, referenceDate);
  }
  const responsibleNames = actions.length > 0 ? await resolveResponsibleNames(actions) : {};

  return {
    customer: { id: customer.id, name: customer.name, personType: customer.personType, taxIdMasked: customer.taxId ? maskTaxId(customer.taxId) : null, email: customer.email, phone: customer.phone, status: customer.status },
    generatedAt: referenceDate.toISOString(),
    capabilities: { commercialView, financialView, legalView },

    units: { authorized: commercialView, items: [...unitsMap.values()] },
    proposals: { authorized: commercialView, items: proposals.map((item) => ({ id: item.id, unitCode: item.salesUnit.code, projectName: item.project.name, broker: item.broker?.name ?? null, proposedPrice: Number(item.proposedPrice), discountAmount: Number(item.discountAmount), validUntil: item.validUntil.toISOString(), status: item.status })) },
    reservations: { authorized: commercialView, items: reservations.map((item) => ({ id: item.id, unitCode: item.salesUnit.code, projectName: item.project.name, expiresAt: item.expiresAt.toISOString(), status: item.status })) },
    sales: {
      authorized: commercialView,
      items: !commercialView ? [] : sales.map((sale) => ({
        id: sale.id, unitCode: sale.salesUnit.code, projectName: sale.project.name, soldPrice: Number(sale.soldPrice), discountAmount: Number(sale.discountAmount), status: sale.status, broker: sale.broker?.name ?? null,
        contract: sale.contract ? { id: sale.contract.id, number: sale.contract.number, title: sale.contract.title, status: sale.contract.status, signatureStatus: sale.contract.signatureStatus, effectiveFrom: sale.contract.effectiveFrom?.toISOString() ?? null } : null,
        documents: sale.contract?.documents.map((doc) => ({ id: doc.id, kind: doc.kind, status: doc.status, version: doc.version, fileName: doc.fileName })) ?? [],
        signatureRequest: sale.contract?.signatureRequests[0]
          ? { id: sale.contract.signatureRequests[0].id, status: sale.contract.signatureRequests[0].status, provider: sale.contract.signatureRequests[0].provider, errorMessage: sale.contract.signatureRequests[0].errorMessage, parties: sale.contract.signatureRequests[0].parties.map((party) => ({ displayName: party.displayName, role: party.role, status: party.status, signedAt: party.signedAt?.toISOString() ?? null, declinedAt: party.declinedAt?.toISOString() ?? null, declinedReason: party.declinedReason })) }
          : null,
        paymentPlanVersions: sale.paymentPlans.map((plan) => ({ version: plan.version, status: plan.status, activatedAt: plan.activatedAt?.toISOString() ?? null, supersededAt: plan.supersededAt?.toISOString() ?? null, renegotiated: plan.version > 1 })),
        cancelledAt: sale.cancelledAt?.toISOString() ?? null, cancelledReason: sale.cancelledReason,
      })),
    },
    commissions: { authorized: commercialView, items: !commercialView ? [] : sales.flatMap((sale) => sale.commissions.map((commission) => ({ id: commission.id, saleId: sale.id, unitCode: sale.salesUnit.code, broker: commission.broker.name, amount: Number(commission.amount), status: commission.status }))) },
    postSale: { authorized: commercialView, items: postSaleRequests.map((item) => ({ id: item.id, unitCode: item.salesUnit.code, category: item.category, status: item.status, updates: item.updates.length, createdAt: item.createdAt.toISOString() })) },
    credit: { authorized: commercialView, items: creditConsultations.map((item) => ({ id: item.id, provider: item.provider, purpose: item.purpose, status: item.status, result: item.result, score: item.score, cpfMasked: item.cpfMasked, findingsSummary: item.findingsSummary, requestedAt: item.requestedAt.toISOString(), completedAt: item.completedAt?.toISOString() ?? null, retentionUntil: item.retentionUntil?.toISOString() ?? null, errorMessage: item.errorMessage })) },

    financial: { authorized: financialView, totals: financialView ? sumClientFinancialPositions(financialBySale.map((item) => item.position)) : null, bySale: financialBySale },
    actions: { authorized: commercialView, items: actions, responsibleNames },
  };
}
