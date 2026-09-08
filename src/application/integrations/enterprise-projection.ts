import { Prisma, type MembershipRole } from "@prisma/client";
import { EnterpriseError, enterpriseData, type EnterpriseEntity } from "@/domain/integrations/enterprise-provider";
import { assertWorkspaceCapability } from "@/domain/workspace/capabilities";
import { assertAccountingCapability } from "@/domain/accounting/capabilities";

// Identifiers below are a closed, server-owned allowlist. No caller supplies SQL identifiers.
const projections = {
  COMPANY: { table: "companies", scope: "company", columns: { status: "status" } },
  PROJECT: { table: "projects", scope: "projectSelf", columns: { status: "status", currency: "currency" } },
  COST_CENTER: { table: "cost_centers", scope: "project", columns: { code: "code", status: "status" } },
  SUPPLIER: { table: "suppliers", scope: "organization", columns: { status: "status" } },
  CUSTOMER: { table: "customers", scope: "organization", columns: { status: "status" } },
  BUDGET: { table: "budgets", scope: "project", columns: { status: "status", version: "version", currency: "currency", totalBudget: "total_budget" } },
  ECONOMIC_ITEM: { table: "economic_items", scope: "project", columns: { code: "code", unit: "unit" } },
  OPERATIONAL_CONTRACT: { table: "operational_contracts", scope: "project", columns: { status: "status", currency: "currency", originalAmount: "original_amount" } },
  MEASUREMENT: { table: "measurement_certificates", scope: "project", columns: { status: "status", version: "version", grossAmount: "gross_amount", netAmount: "net_amount" } },
  FINANCIAL_OBLIGATION: { table: "financial_obligations", scope: "project", columns: { status: "status", amount: "amount" } },
  ACCOUNTING_ENTRY: { table: "accounting_entries", scope: "project", columns: { status: "status", totalDebit: "total_debit", totalCredit: "total_credit" } },
  LEAD: { table: "sales_leads", scope: "project", columns: { stage: "stage" } },
  SALES_PROPOSAL: { table: "sales_proposals", scope: "project", columns: { status: "status", proposedPrice: "proposed_price" } },
  SALES_UNIT: { table: "sales_units", scope: "project", columns: { code: "code", status: "status" } },
  SALE: { table: "sales", scope: "project", columns: { status: "status", version: "version", soldPrice: "sold_price" } },
  SALES_CONTRACT: { table: "sales_contracts", scope: "project", columns: { status: "status", version: "version", soldPrice: "sold_price" } },
} as const;
const monetary = new Set(["totalBudget", "originalAmount", "grossAmount", "netAmount", "amount", "totalDebit", "totalCredit", "proposedPrice", "soldPrice"]);
export function authorizeEnterpriseData(role: MembershipRole, entity: EnterpriseEntity) {
  try {
    assertWorkspaceCapability(role, ["LEAD", "CUSTOMER", "SALES_PROPOSAL", "SALES_UNIT", "SALE", "SALES_CONTRACT"].includes(entity) ? "COMMERCIAL_VIEW" : "FINANCIAL_VIEW");
    if (entity === "ACCOUNTING_ENTRY") assertAccountingCapability(role, "ACCOUNTING_VIEW");
  } catch { throw new EnterpriseError("FORBIDDEN", "AUTHORIZATION"); }
}
export async function readEnterpriseProjection(tx: Prisma.TransactionClient, organizationId: string, projectId: string, entity: EnterpriseEntity, entityId: string) {
  const project = await tx.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, companyId: true } });
  if (!project) throw new EnterpriseError("FORBIDDEN", "AUTHORIZATION");
  const spec = projections[entity];
  const fields = Object.entries(spec.columns).map(([key, column]) => Prisma.raw(`"${column}" AS "${key}"`));
  const revision = entity === "ACCOUNTING_ENTRY" ? Prisma.sql`checksum AS revision` : Prisma.sql`updated_at AS revision`;
  const scope = spec.scope === "project" ? Prisma.sql`AND project_id=${projectId}` : spec.scope === "company" ? Prisma.sql`AND id=${project.companyId ?? ""}` : spec.scope === "projectSelf" ? Prisma.sql`AND id=${projectId}` : Prisma.empty;
  const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`SELECT ${Prisma.join(fields)}, ${revision} FROM ${Prisma.raw(spec.table)} WHERE id=${entityId} AND organization_id=${organizationId} ${scope} FOR SHARE`);
  if (!rows[0]) throw new EnterpriseError("FORBIDDEN", "AUTHORIZATION");
  const { revision: rowRevision, ...values } = rows[0];
  for (const field of Object.keys(values)) if (monetary.has(field)) values[field] = new Prisma.Decimal(String(values[field])).toFixed(2);
  const parsed = enterpriseData[entity].safeParse(values); if (!parsed.success) throw new EnterpriseError("CONTENT_UNAVAILABLE");
  return { data: parsed.data, revision: rowRevision instanceof Date ? rowRevision.toISOString() : String(rowRevision) };
}
