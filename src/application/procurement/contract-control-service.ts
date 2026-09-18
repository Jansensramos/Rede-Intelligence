import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";

export type ContractControlView = {
  id: string;
  number: string;
  title: string;
  status: string;
  supplierName: string;
  originalAmount: number;
  approvedAmendments: number;
  currentAmount: number;
  authorizedByServiceOrders: number;
  measuredGross: number;
  approvedForPayment: number;
  paidAmount: number;
  contractBalance: number;
  authorizationBalance: number;
  measurementBalance: number;
};

export type ServiceOrderMeasurementView = {
  id: string;
  contractId: string;
  contractNumber: string;
  number: string;
  title: string;
  status: string;
  items: Array<{
    serviceOrderItemId: string;
    contractItemId: string;
    description: string;
    unit: string;
    unitPrice: number;
    authorizedQuantity: number;
    previousMeasuredQuantity: number;
    remainingQuantity: number;
  }>;
};

export async function getContractControl(context: Pick<AuthContext, "organizationId">, projectId: string): Promise<ContractControlView[]> {
  const contracts = await prisma.$queryRaw<Array<{
    id: string;
    number: string;
    title: string;
    status: string;
    supplier_name: string;
    original_amount: Prisma.Decimal;
  }>>(Prisma.sql`
    SELECT oc.id, oc.number, oc.title, oc.status::text AS status, s.name AS supplier_name, oc.original_amount
      FROM operational_contracts oc
      JOIN suppliers s ON s.id = oc.supplier_id
     WHERE oc.organization_id = ${context.organizationId}
       AND oc.project_id = ${projectId}
     ORDER BY oc.created_at DESC
  `);

  if (contracts.length === 0) return [];
  const ids = contracts.map((item) => item.id);

  const [amendments, orders, measurements, paid] = await Promise.all([
    prisma.$queryRaw<Array<{ contract_id: string; amount: Prisma.Decimal }>>(Prisma.sql`
      SELECT contract_id,
             COALESCE(SUM(CASE WHEN type::text = 'SUPPRESSION' THEN -value ELSE value END), 0) AS amount
        FROM contract_amendments
       WHERE contract_id IN (${Prisma.join(ids)})
         AND status::text = 'APPROVED'
       GROUP BY contract_id
    `),
    prisma.$queryRaw<Array<{ contract_id: string; amount: Prisma.Decimal }>>(Prisma.sql`
      SELECT contract_id, COALESCE(SUM(authorized_amount), 0) AS amount
        FROM service_orders
       WHERE contract_id IN (${Prisma.join(ids)})
         AND status NOT IN ('DRAFT', 'IN_APPROVAL', 'CANCELLED')
       GROUP BY contract_id
    `),
    prisma.$queryRaw<Array<{ contract_id: string; measured: Prisma.Decimal; approved: Prisma.Decimal }>>(Prisma.sql`
      SELECT contract_id,
             COALESCE(SUM(CASE WHEN status::text NOT IN ('REVERSED','CANCELLED') THEN gross_amount ELSE 0 END), 0) AS measured,
             COALESCE(SUM(CASE WHEN status::text IN ('APPROVED','SENT_TO_FINANCE') THEN net_amount ELSE 0 END), 0) AS approved
        FROM measurement_certificates
       WHERE contract_id IN (${Prisma.join(ids)})
       GROUP BY contract_id
    `),
    prisma.$queryRaw<Array<{ contract_id: string; amount: Prisma.Decimal }>>(Prisma.sql`
      SELECT mc.contract_id, COALESCE(SUM(pp.amount), 0) AS amount
        FROM measurement_certificates mc
        JOIN financial_integration_events fie ON fie.measurement_id = mc.id AND fie.payable_account_id IS NOT NULL
        JOIN payable_accounts pa ON pa.id = fie.payable_account_id
        JOIN payable_installments pi ON pi.payable_account_id = pa.id
        JOIN payable_payments pp ON pp.installment_id = pi.id
       WHERE mc.contract_id IN (${Prisma.join(ids)})
         AND pp.status::text IN ('PROCESSED','CLEARED')
         AND pp.reversed_at IS NULL
       GROUP BY mc.contract_id
    `),
  ]);

  const amendmentMap = new Map(amendments.map((item) => [item.contract_id, Number(item.amount)]));
  const orderMap = new Map(orders.map((item) => [item.contract_id, Number(item.amount)]));
  const measurementMap = new Map(measurements.map((item) => [item.contract_id, { measured: Number(item.measured), approved: Number(item.approved) }]));
  const paidMap = new Map(paid.map((item) => [item.contract_id, Number(item.amount)]));

  return contracts.map((contract) => {
    const originalAmount = Number(contract.original_amount);
    const approvedAmendments = amendmentMap.get(contract.id) ?? 0;
    const currentAmount = originalAmount + approvedAmendments;
    const authorizedByServiceOrders = orderMap.get(contract.id) ?? 0;
    const measured = measurementMap.get(contract.id) ?? { measured: 0, approved: 0 };
    const paidAmount = paidMap.get(contract.id) ?? 0;
    return {
      id: contract.id,
      number: contract.number,
      title: contract.title,
      status: contract.status,
      supplierName: contract.supplier_name,
      originalAmount,
      approvedAmendments,
      currentAmount,
      authorizedByServiceOrders,
      measuredGross: measured.measured,
      approvedForPayment: measured.approved,
      paidAmount,
      contractBalance: Math.max(0, currentAmount - measured.measured),
      authorizationBalance: Math.max(0, currentAmount - authorizedByServiceOrders),
      measurementBalance: Math.max(0, authorizedByServiceOrders - measured.measured),
    };
  });
}

export async function getServiceOrderMeasurementAvailability(context: Pick<AuthContext, "organizationId">, projectId: string): Promise<ServiceOrderMeasurementView[]> {
  const orders = await prisma.$queryRaw<Array<{
    id: string;
    contract_id: string;
    contract_number: string;
    number: string;
    title: string;
    status: string;
  }>>(Prisma.sql`
    SELECT so.id, so.contract_id, oc.number AS contract_number, so.number, so.title, so.status
      FROM service_orders so
      JOIN operational_contracts oc ON oc.id = so.contract_id
     WHERE so.organization_id = ${context.organizationId}
       AND so.project_id = ${projectId}
       AND so.status IN ('ISSUED','IN_PROGRESS','COMPLETED')
     ORDER BY so.created_at DESC
  `);

  if (orders.length === 0) return [];
  const orderIds = orders.map((item) => item.id);
  const items = await prisma.$queryRaw<Array<{
    service_order_id: string;
    service_order_item_id: string;
    contract_item_id: string;
    description: string;
    unit: string;
    unit_price: Prisma.Decimal;
    authorized_quantity: Prisma.Decimal;
    measured_quantity: Prisma.Decimal;
  }>>(Prisma.sql`
    SELECT soi.service_order_id,
           soi.id AS service_order_item_id,
           soi.contract_item_id,
           soi.description,
           soi.unit,
           soi.unit_price,
           soi.quantity AS authorized_quantity,
           COALESCE(SUM(CASE WHEN mc.status::text NOT IN ('REVERSED','CANCELLED') THEN ml.period_quantity ELSE 0 END), 0) AS measured_quantity
      FROM service_order_items soi
      LEFT JOIN measurement_certificates mc ON mc.service_order_id = soi.service_order_id
      LEFT JOIN measurement_lines ml ON ml.measurement_id = mc.id AND ml.contract_item_id = soi.contract_item_id
     WHERE soi.service_order_id IN (${Prisma.join(orderIds)})
     GROUP BY soi.service_order_id, soi.id, soi.contract_item_id, soi.description, soi.unit, soi.unit_price, soi.quantity, soi.sort_order
     ORDER BY soi.service_order_id, soi.sort_order
  `);

  return orders.map((order) => ({
    id: order.id,
    contractId: order.contract_id,
    contractNumber: order.contract_number,
    number: order.number,
    title: order.title,
    status: order.status,
    items: items.filter((item) => item.service_order_id === order.id).map((item) => {
      const authorizedQuantity = Number(item.authorized_quantity);
      const previousMeasuredQuantity = Number(item.measured_quantity);
      return {
        serviceOrderItemId: item.service_order_item_id,
        contractItemId: item.contract_item_id,
        description: item.description,
        unit: item.unit,
        unitPrice: Number(item.unit_price),
        authorizedQuantity,
        previousMeasuredQuantity,
        remainingQuantity: Math.max(0, authorizedQuantity - previousMeasuredQuantity),
      };
    }),
  }));
}