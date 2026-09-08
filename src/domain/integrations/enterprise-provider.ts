import { z } from "zod";
import type { RetryableErrorClass } from "./retry-policy";

export const ENTERPRISE_CODE = "ENTERPRISE_LOCAL_V1";
export const ENTERPRISE_JOB = "ENTERPRISE_SYNC";
export const opaqueId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const enterpriseEntity = z.enum(["COMPANY", "PROJECT", "COST_CENTER", "SUPPLIER", "CUSTOMER", "BUDGET", "ECONOMIC_ITEM", "OPERATIONAL_CONTRACT", "MEASUREMENT", "FINANCIAL_OBLIGATION", "ACCOUNTING_ENTRY", "LEAD", "SALES_PROPOSAL", "SALES_UNIT", "SALE", "SALES_CONTRACT"]);
export type EnterpriseEntity = z.infer<typeof enterpriseEntity>;
export const enterpriseConfiguration = z.object({
  mode: z.enum(["DISABLED", "MOCK", "REAL"]), capability: z.enum(["ERP", "CRM"]),
  sourceKey: opaqueId, perMinute: z.number().int().min(1).max(60), retentionDays: z.number().int().min(1).max(180),
}).strict();
export type EnterpriseConfiguration = z.infer<typeof enterpriseConfiguration>;
export const enterpriseRequest = z.object({ idempotencyKey: opaqueId, entityType: enterpriseEntity }).strict();
export const enterpriseBinding = z.object({ entityType: enterpriseEntity, entityId: opaqueId, externalId: opaqueId }).strict();
const status = z.string().min(1).max(60).regex(/^[A-Z][A-Z0-9_]*$/);
const money = z.string().regex(/^(0|[1-9]\d{0,17})\.\d{2}$/);
const code = z.string().min(1).max(80);
const currency = z.string().regex(/^[A-Z]{3}$/);
const version = z.number().int().positive();
export const enterpriseData = {
  COMPANY: z.object({ status }).strict(), PROJECT: z.object({ status, currency }).strict(),
  COST_CENTER: z.object({ code, status }).strict(), SUPPLIER: z.object({ status }).strict(), CUSTOMER: z.object({ status }).strict(),
  BUDGET: z.object({ status, version, currency, totalBudget: money }).strict(),
  ECONOMIC_ITEM: z.object({ code, unit: code }).strict(),
  OPERATIONAL_CONTRACT: z.object({ status, currency, originalAmount: money }).strict(),
  MEASUREMENT: z.object({ status, version, grossAmount: money, netAmount: money }).strict(),
  FINANCIAL_OBLIGATION: z.object({ status, amount: money }).strict(),
  ACCOUNTING_ENTRY: z.object({ status, totalDebit: money, totalCredit: money }).strict(),
  LEAD: z.object({ stage: status }).strict(), SALES_PROPOSAL: z.object({ status, proposedPrice: money }).strict(),
  SALES_UNIT: z.object({ code, status }).strict(), SALE: z.object({ status, version, soldPrice: money }).strict(),
  SALES_CONTRACT: z.object({ status, version, soldPrice: money }).strict(),
} as const;
export const enterpriseItem = z.object({ externalId: opaqueId, externalVersion: opaqueId, entityType: enterpriseEntity, data: z.record(z.string(), z.unknown()) }).strict();
export type EnterpriseItem = z.infer<typeof enterpriseItem>;
const pageSchema = z.object({ items: z.array(enterpriseItem).max(100), nextCursor: opaqueId.nullable(), checkpoint: opaqueId }).strict();
export function supportsEnterpriseEntity(capability: "ERP" | "CRM", entity: EnterpriseEntity) {
  return capability === "ERP" ? !["LEAD", "SALES_PROPOSAL"].includes(entity) : ["LEAD", "CUSTOMER", "SALES_PROPOSAL", "SALES_UNIT", "SALE", "SALES_CONTRACT"].includes(entity);
}
export class EnterpriseError extends Error {
  constructor(readonly reason: "FORBIDDEN" | "INVALID_INPUT" | "DISABLED" | "REAL_NOT_CONFIGURED" | "IDEMPOTENCY_CONFLICT" | "LEASE_LOST" | "RATE_LIMIT" | "TRANSPORT_FAILURE" | "INVALID_RESPONSE" | "PAGINATION_LIMIT" | "EVIDENCE_CONFLICT" | "CONTENT_UNAVAILABLE" | "EXPIRED" | "UNMAPPED" | "STALE_REVIEW", readonly errorClass: RetryableErrorClass = "VALIDATION", readonly retryAfterMs: number | null = null) { super(`ENTERPRISE_${reason}`); }
}
export interface EnterpriseTransportRequest { entityType: EnterpriseEntity; requestKey: string; cursor: string | null }
export interface EnterpriseTransport { readonly kind: "LOCAL_SIMULATION"; pull(request: EnterpriseTransportRequest, signal: AbortSignal): Promise<unknown> }
export const mockEnterpriseTransport: EnterpriseTransport = { kind: "LOCAL_SIMULATION", async pull(_request, signal) { signal.throwIfAborted(); return { items: [], nextCursor: null, checkpoint: "mock-empty" }; } };
export function normalizeEnterpriseItem(raw: unknown): EnterpriseItem {
  const parsed = enterpriseItem.safeParse(raw);
  if (!parsed.success) throw new EnterpriseError("INVALID_RESPONSE");
  const data = enterpriseData[parsed.data.entityType].safeParse(parsed.data.data);
  if (!data.success) throw new EnterpriseError("INVALID_RESPONSE");
  return { ...parsed.data, data: data.data };
}
export async function pullEnterprisePage(mode: EnterpriseConfiguration["mode"], request: EnterpriseTransportRequest, signal: AbortSignal, transport: EnterpriseTransport = mockEnterpriseTransport) {
  if (mode === "REAL") throw new EnterpriseError("REAL_NOT_CONFIGURED", "BUSINESS_RULE");
  if (mode !== "MOCK") throw new EnterpriseError("DISABLED", "BUSINESS_RULE");
  if (transport.kind !== "LOCAL_SIMULATION") throw new EnterpriseError("INVALID_INPUT");
  try {
    signal.throwIfAborted();
    const raw = await transport.pull(request, signal); signal.throwIfAborted();
    const page = pageSchema.safeParse(raw); if (!page.success) throw new EnterpriseError("INVALID_RESPONSE");
    const items = page.data.items.map(normalizeEnterpriseItem);
    if (items.some(item => item.entityType !== request.entityType)) throw new EnterpriseError("INVALID_RESPONSE");
    return { ...page.data, items };
  } catch (error) { if (error instanceof EnterpriseError) throw error; throw new EnterpriseError("TRANSPORT_FAILURE", "NETWORK"); }
}
