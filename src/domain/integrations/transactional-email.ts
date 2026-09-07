import { z } from "zod";
import type { RetryableErrorClass } from "./retry-policy";

export const EMAIL_CODE = "TRANSACTIONAL_EMAIL_LOCAL_V1";
export const EMAIL_JOB = "SEND_TRANSACTIONAL_EMAIL";
export const emailConfiguration = z.object({ mode: z.enum(["DISABLED", "MOCK", "REAL"]), perMinute: z.number().int().min(1).max(60).default(10) }).strict();
const safeText = z.string().trim().min(1).max(160).refine(value => !/[\r\n\x00-\x1f\x7f]/.test(value));
export const emailInput = z.object({
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/),
  to: z.string().email().max(254).refine(value => !/[\r\n]/.test(value)),
  template: z.enum(["NOTICE_V1", "APPROVAL_REQUIRED_V1"]),
  variables: z.object({ name: safeText, reference: safeText }).strict(),
}).strict();
export type EmailInput = z.infer<typeof emailInput>;
export interface EmailMessage { to: string; subject: string; text: string; html: string }
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export function renderEmail(raw: unknown): EmailMessage {
  const input = emailInput.parse(raw);
  const title = input.template === "NOTICE_V1" ? "Atualização disponível" : "Aprovação humana necessária";
  return { to: input.to, subject: title, text: `${input.variables.name}, ${title.toLowerCase()}: ${input.variables.reference}. Consulte a REDE Intelligence.`, html: `<p>${escape(input.variables.name)}, ${title.toLowerCase()}: <strong>${escape(input.variables.reference)}</strong>.</p><p>Consulte a REDE Intelligence.</p>` };
}
export class EmailError extends Error {
  constructor(readonly reason: "DISABLED" | "REAL_NOT_CONFIGURED" | "FORBIDDEN" | "INVALID_INPUT" | "IDEMPOTENCY_CONFLICT" | "LEASE_LOST" | "RATE_LIMIT" | "TRANSPORT_FAILURE" | "INVALID_RECEIPT" | "CONTENT_UNAVAILABLE", readonly errorClass: RetryableErrorClass = "VALIDATION", readonly retryAfterMs: number | null = null) { super(`EMAIL_${reason}`); }
}
/** Only the local simulator is injectable in this phase. No native HTTP transport exists. */
export interface EmailTransport {
  readonly kind: "LOCAL_SIMULATION";
  send(message: Readonly<EmailMessage>, options: { idempotencyKey: string; signal: AbortSignal }): Promise<{ disposition: "SIMULATED" }>;
}
export const mockEmailTransport: EmailTransport = { kind: "LOCAL_SIMULATION", async send(_message, { signal }) { signal.throwIfAborted(); return { disposition: "SIMULATED" }; } };
export async function deliverEmail(mode: "DISABLED" | "MOCK" | "REAL", message: EmailMessage, key: string, signal: AbortSignal, transport: EmailTransport = mockEmailTransport) {
  if (mode === "DISABLED") throw new EmailError("DISABLED", "BUSINESS_RULE");
  if (mode === "REAL") throw new EmailError("REAL_NOT_CONFIGURED", "BUSINESS_RULE");
  signal.throwIfAborted();
  if (transport.kind !== "LOCAL_SIMULATION") throw new EmailError("INVALID_INPUT");
  try {
    const receipt = await transport.send(message, { idempotencyKey: key, signal });
    signal.throwIfAborted();
    if (receipt?.disposition !== "SIMULATED") throw new EmailError("INVALID_RECEIPT");
    return { disposition: "SIMULATED" as const };
  } catch (error) { if (error instanceof EmailError) throw error; throw new EmailError("TRANSPORT_FAILURE", "NETWORK"); }
}
