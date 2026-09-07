import { z } from "zod";
import type { RetryableErrorClass } from "./retry-policy";
export const FINANCIAL_CODE = "FINANCIAL_PROVIDER_LOCAL_V1";
export const FINANCIAL_JOB = "FINANCIAL_PROVIDER";
const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const financialConfiguration = z.object({ mode: z.enum(["DISABLED", "MOCK", "REAL"]), capability: z.enum(["BANK", "BUREAU", "FUNDING"]), perMinute: z.number().int().min(1).max(60), retentionDays: z.number().int().min(1).max(180) }).strict();
const base = { idempotencyKey: id, targetId: id };
export const financialRequest = z.discriminatedUnion("operation", [
  z.object({ ...base, operation: z.literal("BANK_SYNC") }).strict(),
  z.object({ ...base, operation: z.literal("BUREAU_CONSULT"), purpose: z.enum(["SALE_PROPOSAL_ANALYSIS", "CONTRACT_RENEWAL"]), legalBasis: z.enum(["CONSENT", "CREDIT_PROTECTION", "LEGITIMATE_INTEREST"]) }).strict(),
  z.object({ ...base, operation: z.literal("FUNDING_SUBMIT") }).strict(),
  z.object({ ...base, operation: z.literal("FUNDING_STATUS"), submissionId: id }).strict(),
]);
export type FinancialRequest = z.infer<typeof financialRequest>;
export const operationCapability = { BANK_SYNC: "BANK", BUREAU_CONSULT: "BUREAU", FUNDING_SUBMIT: "FUNDING", FUNDING_STATUS: "FUNDING" } as const;
const money = z.string().regex(/^(0|[1-9]\d{0,13})\.\d{2}$/);
const timestamp = z.string().datetime();
export const bankPage = z.object({ transactions: z.array(z.object({ externalId: id, occurredAt: timestamp, amount: money.refine(value => value !== "0.00"), direction: z.enum(["CREDIT", "DEBIT"]) }).strict()).max(100), nextCursor: id.nullable(), checkpoint: id }).strict();
export const bureauResult = z.object({ externalId: id, score: z.number().int().min(0).max(1000).nullable(), findingsCount: z.number().int().min(0).max(10000), recommendation: z.enum(["REVIEW_REQUIRED", "INSUFFICIENT_DATA"]) }).strict();
export const fundingResult = z.object({ externalId: id, state: z.enum(["SUBMITTED", "PENDING", "UPDATED", "RELEASE_REPORTED"]), amount: money.optional() }).strict();
export type FinancialOperation = FinancialRequest["operation"];
export interface FinancialTransportRequest { operation: FinancialOperation; targetId: string; requestKey: string; cursor: string | null; submissionReference?: string; dossier?: Readonly<Record<string, unknown>>; proposal?: { id: string; version: number; amount: string; currency: string; projectId: string } }
export interface FinancialTransport { readonly kind: "LOCAL_SIMULATION"; execute(request: FinancialTransportRequest, signal: AbortSignal): Promise<unknown> }
export class FinancialProviderError extends Error {
  constructor(readonly reason: "FORBIDDEN" | "INVALID_INPUT" | "DISABLED" | "REAL_NOT_CONFIGURED" | "IDEMPOTENCY_CONFLICT" | "LEASE_LOST" | "RATE_LIMIT" | "TRANSPORT_FAILURE" | "INVALID_RESPONSE" | "PAGINATION_LIMIT" | "EVIDENCE_CONFLICT" | "CONTENT_UNAVAILABLE" | "EXPIRED", readonly errorClass: RetryableErrorClass = "VALIDATION", readonly retryAfterMs: number | null = null) { super(`FINANCIAL_${reason}`); }
}
export const mockFinancialTransport: FinancialTransport = { kind: "LOCAL_SIMULATION", async execute(request, signal) {
  signal.throwIfAborted();
  if (request.operation === "BANK_SYNC") return { transactions: [], nextCursor: null, checkpoint: "mock-empty" };
  if (request.operation === "BUREAU_CONSULT") return { externalId: request.requestKey, score: null, findingsCount: 0, recommendation: "INSUFFICIENT_DATA" };
  return { externalId: request.submissionReference ?? request.requestKey, state: request.operation === "FUNDING_SUBMIT" ? "SUBMITTED" : "PENDING" };
} };
export async function executeFinancialTransport(mode: "DISABLED" | "MOCK" | "REAL", request: FinancialTransportRequest, signal: AbortSignal, transport: FinancialTransport = mockFinancialTransport) {
  if (mode === "REAL") throw new FinancialProviderError("REAL_NOT_CONFIGURED", "BUSINESS_RULE");
  if (mode === "DISABLED") throw new FinancialProviderError("DISABLED", "BUSINESS_RULE");
  if (transport.kind !== "LOCAL_SIMULATION") throw new FinancialProviderError("INVALID_INPUT");
  signal.throwIfAborted();
  let raw: unknown;
  try { raw = await transport.execute(request, signal); signal.throwIfAborted(); }
  catch (error) { if (error instanceof FinancialProviderError) throw error; throw new FinancialProviderError("TRANSPORT_FAILURE", "NETWORK"); }
  const schema = request.operation === "BANK_SYNC" ? bankPage : request.operation === "BUREAU_CONSULT" ? bureauResult : fundingResult;
  const result = schema.safeParse(raw); if (!result.success) throw new FinancialProviderError("INVALID_RESPONSE");
  if (request.operation === "FUNDING_SUBMIT" && fundingResult.parse(result.data).state !== "SUBMITTED") throw new FinancialProviderError("INVALID_RESPONSE");
  if (request.operation === "FUNDING_STATUS") { const status = fundingResult.parse(result.data); if (status.externalId !== request.submissionReference || status.state === "SUBMITTED") throw new FinancialProviderError("INVALID_RESPONSE"); }
  return result.data;
}
