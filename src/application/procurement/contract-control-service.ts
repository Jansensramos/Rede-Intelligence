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