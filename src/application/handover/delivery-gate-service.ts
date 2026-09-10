import type { Prisma, PrismaClient } from "@prisma/client";
import { evaluateDeliveryGate, type DeliveryGateResult } from "@/domain/handover/gates";

/** Aceita tanto o client global quanto um client de transação — achado TOCTOU da
 * reauditoria 9R exige que `markUnitDelivered` releia todos os gates DENTRO da
 * mesma transação que efetiva a entrega, não antes dela. */
type Client = PrismaClient | Prisma.TransactionClient;

const OVERDUE_STATUSES = ["PREVISTA", "EMITIDA", "PARCIALMENTE_RECEBIDA"] as const;
const PENDING_DISBURSEMENT_STATUSES_EXCLUDED = ["RECONCILED", "CANCELLED"] as const;

/**
 * Fase 9R — busca os fatos dos três gates (técnico/jurídico/financeiro) e delega a
 * decisão para `evaluateDeliveryGate` (regra pura). Único ponto de leitura reaproveitado
 * tanto pela pré-visualização da UI quanto por `markUnitDelivered` (9E) — nenhuma
 * segunda implementação do gate.
 *
 * Gate técnico (corrigido — achado Alto da reauditoria): busca a vistoria MAIS
 * RECENTE da unidade/venda (`scheduledAt` desc, desempate por `createdAt` e `id`,
 * ambos desc — totalmente determinístico), nunca "qualquer vistoria aceita alguma
 * vez". Vistorias com `scheduledAt` no futuro são ignoradas (ainda não aconteceram de
 * fato) — nunca liberam o gate mesmo se, por dado inconsistente, já tiverem um
 * `outcome` registrado. Escopo explícito por `organizationId`+`salesUnitId`+`saleId`
 * (defesa em profundidade, além do tenant já garantido a montante pelo chamador).
 *
 * Gate jurídico: lê `LegalLicense` (9D) por projeto — fonte oficial, sem duplicar
 * checklist ou regra jurídica (decisões 3/4 do contrato 9R).
 */
export async function evaluateUnitDeliveryReadiness(
  client: Client,
  organizationId: string,
  projectId: string,
  salesUnitId: string,
  saleId: string,
  now: Date = new Date(),
): Promise<DeliveryGateResult> {
  const [mostRecentInspection, licenses, overdueInstallmentCount, pendingDisbursementCount] = await Promise.all([
    client.salesUnitInspection.findFirst({
      where: { saleId, salesUnitId, salesUnit: { organizationId }, scheduledAt: { lte: now } },
      orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: { id: true, outcome: true, nextInspectionAt: true },
    }),
    client.legalLicense.findMany({ where: { organizationId, projectId }, select: { id: true, status: true } }),
    client.receivableInstallment.count({
      where: { receivableAccount: { saleId, organizationId }, status: { in: [...OVERDUE_STATUSES] }, dueDate: { lt: now } },
    }),
    client.bankFinancingDisbursement.count({
      where: { organizationId, saleId, status: { notIn: [...PENDING_DISBURSEMENT_STATUSES_EXCLUDED] } },
    }),
  ]);

  return evaluateDeliveryGate({
    technical: { mostRecentInspection },
    legal: { licenses },
    financial: { overdueInstallmentCount, pendingDisbursementCount },
  });
}
