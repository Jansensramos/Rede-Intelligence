import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";

export type ServiceOrderStatus = "DRAFT" | "IN_APPROVAL" | "APPROVED" | "ISSUED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export type ServiceOrderView = {
  id: string;
  contractId: string;
  contractNumber: string;
  contractTitle: string;
  number: string;
  title: string;
  scope: string;
  status: ServiceOrderStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  authorizedAmount: number;
  notes: string | null;
  items: Array<{
    id: string;
    contractItemId: string;
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    amount: number;
  }>;
};

export type CreateServiceOrderInput = {
  projectId: string;
  contractId: string;
  number: string;
  title: string;
  scope: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
  notes?: string | null;
  items: Array<{ contractItemId: string; quantity: number }>;
};

const mutableRoles = new Set(["OWNER", "ADMIN", "ANALYST"]);
const approvalRoles = new Set(["OWNER", "ADMIN"]);

function assertMutable(context: Pick<AuthContext, "role">) {
  if (!mutableRoles.has(context.role)) throw new Error("Seu perfil não pode alterar ordens de serviço.");
}

function assertApprover(context: Pick<AuthContext, "role">) {
  if (!approvalRoles.has(context.role)) throw new Error("Somente Administrador ou Owner pode aprovar uma ordem de serviço.");
}

function assertTransition(from: ServiceOrderStatus, to: ServiceOrderStatus) {
  const allowed: Record<ServiceOrderStatus, ServiceOrderStatus[]> = {
    DRAFT: ["IN_APPROVAL", "CANCELLED"],
    IN_APPROVAL: ["APPROVED", "DRAFT", "CANCELLED"],
    APPROVED: ["ISSUED", "CANCELLED"],
    ISSUED: ["IN_PROGRESS", "CANCELLED"],
    IN_PROGRESS: ["COMPLETED", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
  };
  if (!allowed[from].includes(to)) throw new Error(`Transição de ${from} para ${to} não permitida.`);
}

export async function getServiceOrders(context: Pick<AuthContext, "organizationId">, projectId: string): Promise<ServiceOrderView[]> {
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    contract_id: string;
    contract_number: string;
    contract_title: string;
    number: string;
    title: string;
    scope: string;
    status: ServiceOrderStatus;
    starts_at: Date | null;
    ends_at: Date | null;
    authorized_amount: Prisma.Decimal;
    notes: string | null;
  }>>(Prisma.sql`
    SELECT so.id, so.contract_id, oc.number AS contract_number, oc.title AS contract_title,
           so.number, so.title, so.scope, so.status, so.starts_at, so.ends_at,
           so.authorized_amount, so.notes
      FROM service_orders so
      JOIN operational_contracts oc ON oc.id = so.contract_id
     WHERE so.organization_id = ${context.organizationId}
       AND so.project_id = ${projectId}
     ORDER BY so.created_at DESC
  `);

  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const items = await prisma.$queryRaw<Array<{
    id: string;
    service_order_id: string;
    contract_item_id: string;
    description: string;
    quantity: Prisma.Decimal;
    unit: string;
    unit_price: Prisma.Decimal;
    amount: Prisma.Decimal;
  }>>(Prisma.sql`
    SELECT id, service_order_id, contract_item_id, description, quantity, unit, unit_price, amount
      FROM service_order_items
     WHERE service_order_id IN (${Prisma.join(ids)})
     ORDER BY sort_order ASC
  `);

  return rows.map((row) => ({
    id: row.id,
    contractId: row.contract_id,
    contractNumber: row.contract_number,
    contractTitle: row.contract_title,
    number: row.number,
    title: row.title,
    scope: row.scope,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    authorizedAmount: Number(row.authorized_amount),
    notes: row.notes,
    items: items.filter((item) => item.service_order_id === row.id).map((item) => ({
      id: item.id,
      contractItemId: item.contract_item_id,
      description: item.description,
      quantity: Number(item.quantity),
      unit: item.unit,
      unitPrice: Number(item.unit_price),
      amount: Number(item.amount),
    })),
  }));
}

export async function createServiceOrder(context: AuthContext, input: CreateServiceOrderInput) {
  assertMutable(context);
  if (!input.number.trim() || !input.title.trim() || !input.scope.trim()) throw new Error("Número, título e escopo são obrigatórios.");
  if (input.items.length === 0) throw new Error("Selecione ao menos um item do contrato.");
  if (input.items.some((item) => !Number.isFinite(item.quantity) || item.quantity <= 0)) throw new Error("As quantidades da ordem de serviço devem ser maiores que zero.");

  const contract = await prisma.operationalContract.findFirst({
    where: { id: input.contractId, organizationId: context.organizationId, projectId: input.projectId, status: { in: ["APPROVED", "ACTIVE"] } },
    include: { items: true },
  });
  if (!contract) throw new Error("Contrato aprovado/ativo não encontrado neste empreendimento.");

  const itemMap = new Map(contract.items.map((item) => [item.id, item]));
  const normalized = input.items.map((entry, index) => {
    const contractItem = itemMap.get(entry.contractItemId);
    if (!contractItem) throw new Error("Um dos itens não pertence ao contrato selecionado.");
    if (new Prisma.Decimal(entry.quantity).greaterThan(contractItem.quantity)) throw new Error(`Quantidade da OS excede o contratado para ${contractItem.code}.`);
    const amount = new Prisma.Decimal(entry.quantity).mul(contractItem.unitPrice);
    return { id: randomUUID(), index, contractItem, quantity: new Prisma.Decimal(entry.quantity), amount };
  });
  const authorizedAmount = normalized.reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
  const id = randomUUID();
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO service_orders (
        id, organization_id, company_id, project_id, contract_id, number, title, scope, status,
        starts_at, ends_at, responsible_id, authorized_amount, notes, created_by_id, updated_by_id, created_at, updated_at
      ) VALUES (
        ${id}, ${context.organizationId}, ${contract.companyId}, ${contract.projectId}, ${contract.id}, ${input.number.trim()}, ${input.title.trim()}, ${input.scope.trim()}, 'DRAFT',
        ${input.startsAt ?? null}, ${input.endsAt ?? null}, ${context.userId}, ${authorizedAmount}, ${input.notes?.trim() || null}, ${context.userId}, ${context.userId}, ${now}, ${now}
      )
    `);

    for (const item of normalized) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO service_order_items (
          id, service_order_id, contract_item_id, description, quantity, unit, unit_price, amount, sort_order
        ) VALUES (
          ${item.id}, ${id}, ${item.contractItem.id}, ${item.contractItem.description}, ${item.quantity}, ${item.contractItem.unit}, ${item.contractItem.unitPrice}, ${item.amount}, ${item.index}
        )
      `);
    }

    await tx.auditLog.create({ data: {
      organizationId: context.organizationId,
      userId: context.userId,
      projectId: contract.projectId,
      action: "SERVICE_ORDER_CREATED",
      entityType: "ServiceOrder",
      entityId: id,
      after: { number: input.number.trim(), contractId: contract.id, authorizedAmount: authorizedAmount.toString(), items: normalized.length },
    } });
  });

  return { id, status: "DRAFT" as const, authorizedAmount: Number(authorizedAmount) };
}

export async function transitionServiceOrder(context: AuthContext, serviceOrderId: string, to: ServiceOrderStatus, reason?: string) {
  assertMutable(context);
  const rows = await prisma.$queryRaw<Array<{ id: string; project_id: string; status: ServiceOrderStatus }>>(Prisma.sql`
    SELECT id, project_id, status
      FROM service_orders
     WHERE id = ${serviceOrderId}
       AND organization_id = ${context.organizationId}
     LIMIT 1
  `);
  const current = rows[0];
  if (!current) throw new Error("Ordem de serviço não encontrada nesta organização.");
  assertTransition(current.status, to);
  if (to === "APPROVED") assertApprover(context);
  if (to === "CANCELLED" && !reason?.trim()) throw new Error("Informe o motivo do cancelamento.");

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      UPDATE service_orders
         SET status = ${to},
             updated_by_id = ${context.userId},
             updated_at = ${now},
             approved_by_id = CASE WHEN ${to} = 'APPROVED' THEN ${context.userId} ELSE approved_by_id END,
             approved_at = CASE WHEN ${to} = 'APPROVED' THEN ${now} ELSE approved_at END,
             issued_at = CASE WHEN ${to} = 'ISSUED' THEN ${now} ELSE issued_at END,
             started_at = CASE WHEN ${to} = 'IN_PROGRESS' THEN ${now} ELSE started_at END,
             completed_at = CASE WHEN ${to} = 'COMPLETED' THEN ${now} ELSE completed_at END,
             cancelled_at = CASE WHEN ${to} = 'CANCELLED' THEN ${now} ELSE cancelled_at END,
             cancellation_reason = CASE WHEN ${to} = 'CANCELLED' THEN ${reason?.trim() || null} ELSE cancellation_reason END
       WHERE id = ${serviceOrderId}
         AND organization_id = ${context.organizationId}
         AND status = ${current.status}
    `);
    await tx.auditLog.create({ data: {
      organizationId: context.organizationId,
      userId: context.userId,
      projectId: current.project_id,
      action: "SERVICE_ORDER_TRANSITIONED",
      entityType: "ServiceOrder",
      entityId: serviceOrderId,
      after: { from: current.status, to, reason: reason ?? null },
    } });
  });
  return { id: serviceOrderId, status: to };
}

export async function linkMeasurementToServiceOrder(context: AuthContext, measurementId: string, serviceOrderId: string) {
  assertMutable(context);
  const rows = await prisma.$queryRaw<Array<{ project_id: string; contract_id: string }>>(Prisma.sql`
    SELECT project_id, contract_id FROM service_orders
     WHERE id = ${serviceOrderId} AND organization_id = ${context.organizationId} LIMIT 1
  `);
  const serviceOrder = rows[0];
  if (!serviceOrder) throw new Error("Ordem de serviço não encontrada.");
  const measurement = await prisma.measurementCertificate.findFirst({
    where: { id: measurementId, organizationId: context.organizationId, projectId: serviceOrder.project_id, contractId: serviceOrder.contract_id },
  });
  if (!measurement) throw new Error("A medição não pertence ao mesmo contrato da ordem de serviço.");
  await prisma.$executeRaw(Prisma.sql`
    UPDATE measurement_certificates SET service_order_id = ${serviceOrderId}, updated_by_id = ${context.userId}, updated_at = ${new Date()}
     WHERE id = ${measurementId} AND organization_id = ${context.organizationId}
  `);
  return { measurementId, serviceOrderId };
}
