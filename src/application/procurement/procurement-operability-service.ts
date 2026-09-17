import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";

export async function getProcurementOperabilityMetadata(context: Pick<AuthContext, "organizationId" | "userId">, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId: context.organizationId },
    select: { id: true, companyId: true },
  });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");

  const [quotations, contracts, orders] = await Promise.all([
    prisma.quotationProcess.findMany({
      where: { organizationId: context.organizationId, projectId },
      include: {
        requisition: { include: { items: true } },
        invitations: { include: { supplier: true } },
        decision: {
          include: {
            selectedProposal: { include: { supplier: true, items: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.operationalContract.findMany({
      where: { organizationId: context.organizationId, projectId },
      include: { items: true, amendments: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.purchaseOrder.findMany({
      where: { organizationId: context.organizationId, projectId },
      include: { supplier: true, items: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  return {
    projectId,
    companyId: project.companyId,
    currentUserId: context.userId,
    quotations: quotations.map((quotation) => ({
      id: quotation.id,
      number: quotation.number,
      title: quotation.title,
      status: quotation.status,
      invitedSuppliers: quotation.invitations.map((invitation) => ({
        supplierId: invitation.supplierId,
        supplierName: invitation.supplier.name,
        status: invitation.status,
      })),
      requisitionItems: quotation.requisition.items.map((item) => ({
        id: item.id,
        description: item.description,
        quantity: Number(item.quantity),
        unit: item.unit,
        economicItemId: item.economicItemId,
        budgetLineItemId: item.budgetLineItemId,
        costCenterId: item.costCenterId,
      })),
      selectedProposal: quotation.decision?.selectedProposal ? {
        id: quotation.decision.selectedProposal.id,
        supplierId: quotation.decision.selectedProposal.supplierId,
        supplierName: quotation.decision.selectedProposal.supplier.name,
        items: quotation.decision.selectedProposal.items.map((item) => ({
          requisitionItemId: item.requisitionItemId,
          description: item.description,
          quantity: Number(item.quantity),
          unit: item.unit,
          unitPrice: Number(item.unitPrice),
        })),
      } : null,
    })),
    orders: orders.map((order) => ({
      id: order.id,
      number: order.number,
      title: order.title,
      status: order.status,
      supplierName: order.supplier.name,
      scope: order.scope,
      deliveryAt: order.deliveryAt?.toISOString() ?? null,
      paymentTerms: order.paymentTerms,
      items: order.items.map((item) => ({
        id: item.id,
        description: item.description,
        quantity: Number(item.quantity),
        unit: item.unit,
        unitPrice: Number(item.unitPrice),
        amount: Number(item.quantity) * Number(item.unitPrice),
      })),
    })),
    contracts: contracts.map((contract) => ({
      id: contract.id,
      number: contract.number,
      title: contract.title,
      status: contract.status,
      type: contract.type,
      billingModel: contract.billingModel,
      items: contract.items.map((item) => ({
        id: item.id,
        code: item.code,
        description: item.description,
        quantity: Number(item.quantity),
        unit: item.unit,
        unitPrice: Number(item.unitPrice),
      })),
      amendments: contract.amendments.map((amendment) => ({ id: amendment.id, number: amendment.number, status: amendment.status })),
    })),
  };
}

export type ProcurementOperabilityMetadata = Awaited<ReturnType<typeof getProcurementOperabilityMetadata>>;