import type { Prisma, PrismaClient } from "@prisma/client";
import { evaluatePostSaleImpediment, evaluateProjectClosureGate, type ProjectClosureGateResult } from "@/domain/closure/gates";

/** Aceita tanto o client global quanto um client de transação — mesmo padrão de
 * `delivery-gate-service.ts` (9R): permite reler todos os subgates DENTRO da mesma
 * transação que efetiva a aprovação do encerramento, evitando TOCTOU. */
type Client = PrismaClient | Prisma.TransactionClient;

const RECEIVABLE_OVERDUE_STATUSES = ["PREVISTA", "EMITIDA", "PARCIALMENTE_RECEBIDA"] as const;
const PAYABLE_OVERDUE_STATUSES = ["PREVISTA", "PROGRAMADA", "AGUARDANDO_APROVACAO", "APROVADA", "PARCIALMENTE_PAGA"] as const;
const OPERATIONAL_CONTRACT_TERMINAL_STATUSES = ["CLOSED", "CANCELLED", "TERMINATED"] as const;
const FUNDING_DISBURSEMENT_TERMINAL_STATUSES = ["DISBURSED", "CANCELLED"] as const;

/**
 * Fase 9S — busca os fatos reais dos 5 subgates do encerramento (operacional,
 * contratual/obra, jurídico, financeiro, contábil) e delega a decisão a
 * `evaluateProjectClosureGate` (regra pura). Único ponto de leitura reaproveitado
 * tanto pela pré-visualização quanto pela aprovação — nenhuma segunda implementação
 * do gate.
 */
export async function evaluateProjectClosureReadiness(
  client: Client,
  organizationId: string,
  projectId: string,
  now: Date = new Date(),
): Promise<ProjectClosureGateResult> {
  const project = await client.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, companyId: true } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");

  const materialityPolicy = await client.materialityPolicy.findFirst({
    where: { organizationId, isActive: true },
    orderBy: { createdAt: "desc" },
    select: { absoluteThreshold: true },
  });

  const [unitsPendingDeliveryCount, condominiumSetup, postSaleRequests, openContracts, legalObligations, closureDiligenceCase, overdueReceivableCount, overduePayableCount, pendingFundingCount, accountingPeriods, financialPeriodClosures] = await Promise.all([
    client.salesUnit.count({ where: { organizationId, projectId, status: "VENDIDA" } }),
    client.condominiumSetup.findUnique({ where: { projectId }, select: { status: true } }),
    client.postSaleRequest.findMany({
      where: { organizationId, salesUnit: { projectId }, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] } },
      select: { id: true, category: true, status: true, slaDueAt: true, responsibleId: true, supplierId: true, recurrenceOfId: true, estimatedCost: true, actualCost: true },
    }),
    client.operationalContract.findMany({ where: { organizationId, projectId, status: { notIn: [...OPERATIONAL_CONTRACT_TERMINAL_STATUSES] } }, select: { id: true } }),
    client.legalObligation.findMany({ where: { organizationId, projectId }, select: { id: true, status: true } }),
    client.legalDueDiligenceCase.findFirst({
      where: { organizationId, projectId, code: { startsWith: "SPE-ENCERRAMENTO-" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, status: true,
        checklistItems: { select: { id: true, status: true, criticality: true, reviewedById: true, notes: true, evidenceDocumentIds: true } },
        documentRequests: { select: { id: true, status: true, documentLinkId: true } },
        // Decisão mais recente do caso: maior `version` (monotônica, atribuída por recordLegalDecision), com
        // createdAt/id como desempate determinístico adicional (defesa em profundidade — correção Bloqueador).
        decisions: { orderBy: [{ version: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: 1, select: { decision: true, conditions: true } },
      },
    }),
    client.receivableInstallment.count({ where: { receivableAccount: { organizationId, projectId }, status: { in: [...RECEIVABLE_OVERDUE_STATUSES] }, dueDate: { lt: now } } }),
    client.payableInstallment.count({ where: { payableAccount: { organizationId, projectId }, status: { in: [...PAYABLE_OVERDUE_STATUSES] }, dueDate: { lt: now } } }),
    client.fundingDisbursement.count({ where: { proposal: { organizationId, projectId }, status: { notIn: [...FUNDING_DISBURSEMENT_TERMINAL_STATUSES] } } }),
    project.companyId ? client.accountingPeriod.findMany({ where: { organizationId, companyId: project.companyId }, select: { id: true, status: true, closeChecksum: true } }) : Promise.resolve([]),
    project.companyId ? client.financialPeriodClosure.findMany({ where: { organizationId, companyId: project.companyId }, select: { id: true, status: true } }) : Promise.resolve([]),
  ]);

  // Evidência de balancete de fechamento (LedgerSnapshot) — só existe estruturalmente para
  // AccountingPeriod (FinancialPeriodClosure não tem esse relacionamento no schema). Consultada
  // por periodId (nunca por org/company soltos), o que já impede cross-tenant/cross-period por
  // construção (correção Médio #5 pós-reauditoria REPROVADA).
  const closedAccountingPeriodIds = accountingPeriods.filter((period) => period.status === "CLOSED").map((period) => period.id);
  const ledgerSnapshots = closedAccountingPeriodIds.length
    ? await client.ledgerSnapshot.findMany({
        where: { organizationId, periodId: { in: closedAccountingPeriodIds }, snapshotType: "CLOSING_TRIAL_BALANCE" },
        select: { periodId: true, checksum: true },
      })
    : [];
  const ledgerSnapshotChecksumByPeriodId = new Map(ledgerSnapshots.map((snapshot) => [snapshot.periodId, snapshot.checksum]));

  // Evidência jurídica canônica (correção estrutural final — `LegalEvidenceDocument`):
  // só `VERIFIED`, vinculada ao MESMO caso de encerramento societário e à MESMA
  // organização/projeto (defesa em profundidade — já garantido estruturalmente por
  // FK + trigger de validação na migration). `documentLinkId`/`evidenceDocumentIds`
  // legados nunca são consultados para decisão positiva (ver `gates.ts`).
  const verifiedEvidence = closureDiligenceCase
    ? await client.legalEvidenceDocument.findMany({
        where: { organizationId, projectId, diligenceCaseId: closureDiligenceCase.id, status: "VERIFIED" },
        select: { checklistItemId: true, documentRequestId: true },
      })
    : [];
  const checklistItemIdsWithVerifiedEvidence = new Set(verifiedEvidence.map((item) => item.checklistItemId).filter((id): id is string => id !== null));
  const documentRequestIdsWithVerifiedEvidence = new Set(verifiedEvidence.map((item) => item.documentRequestId).filter((id): id is string => id !== null));

  // Provisões ativas de assistência técnica, por chamado (convenção economicIdentityKey = "post_sale_request:<id>").
  const provisionedRequestIds = postSaleRequests.length
    ? new Set((await client.accountingProvision.findMany({
        where: { organizationId, status: "ACTIVE", economicIdentityKey: { in: postSaleRequests.map((request) => `post_sale_request:${request.id}`) } },
        select: { economicIdentityKey: true },
      })).map((provision) => provision.economicIdentityKey.replace("post_sale_request:", "")))
    : new Set<string>();

  const impeditivePostSaleRequestIds = postSaleRequests
    .filter((request) => evaluatePostSaleImpediment({
      id: request.id, category: request.category, status: request.status, slaDueAt: request.slaDueAt,
      responsibleId: request.responsibleId, supplierId: request.supplierId, recurrenceOfId: request.recurrenceOfId,
      estimatedCost: request.estimatedCost?.toString() ?? null, actualCost: request.actualCost?.toString() ?? null, now,
      hasActiveProvision: provisionedRequestIds.has(request.id),
      materialityThreshold: materialityPolicy?.absoluteThreshold?.toString() ?? null,
    }).impeditive)
    .map((request) => request.id);

  return evaluateProjectClosureGate({
    operational: {
      unitsPendingDeliveryCount,
      condominiumStatus: condominiumSetup?.status ?? null,
      impeditivePostSaleRequestIds,
    },
    contractual: { openContractIds: openContracts.map((contract) => contract.id) },
    legal: {
      obligations: legalObligations,
      closureDiligenceCase: closureDiligenceCase
        ? {
            id: closureDiligenceCase.id,
            status: closureDiligenceCase.status,
            checklistItems: closureDiligenceCase.checklistItems.map((item) => ({ ...item, hasVerifiedEvidence: checklistItemIdsWithVerifiedEvidence.has(item.id) })),
            documentRequests: closureDiligenceCase.documentRequests.map((item) => ({ ...item, hasVerifiedEvidence: documentRequestIdsWithVerifiedEvidence.has(item.id) })),
            latestDecision: closureDiligenceCase.decisions[0]
              ? { decision: closureDiligenceCase.decisions[0].decision, conditions: closureDiligenceCase.decisions[0].conditions }
              : null,
          }
        : null,
    },
    financial: { overdueInstallmentCount: overdueReceivableCount + overduePayableCount, pendingDisbursementCount: pendingFundingCount },
    accounting: {
      periods: [
        ...accountingPeriods.map((period) => ({
          id: period.id,
          status: period.status,
          ledgerEvidence: period.status !== "CLOSED" ? undefined
            : !ledgerSnapshotChecksumByPeriodId.has(period.id) ? ("MISSING" as const)
            : period.closeChecksum !== null && ledgerSnapshotChecksumByPeriodId.get(period.id) === period.closeChecksum ? ("VALID" as const)
            : ("INCONSISTENT" as const),
        })),
        ...financialPeriodClosures.map((period) => ({ id: period.id, status: period.status })),
      ],
    },
  });
}
