import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseClicksignWebhook, validateClicksignWebhookSignature } from "./clicksign-service";

const bytes = (value: string) => new TextEncoder().encode(value);
const body = JSON.stringify({
  data: {
    id: "evt-1", type: "events",
    attributes: { event_name: "signer.signed", occurred_at: "2026-09-03T12:00:00Z" },
    relationships: { envelope: { data: { type: "envelopes", id: "env-1" } }, signer: { data: { type: "signers", id: "signer-1" } } },
  },
});

describe("webhook Clicksign", () => {
  it("valida HMAC SHA-256 com comparação de bytes", () => {
    const raw = bytes(body);
    const signature = createHmac("sha256", "webhook-secret").update(raw).digest("hex");
    expect(validateClicksignWebhookSignature(raw, signature, "webhook-secret")).toBe(true);
    expect(validateClicksignWebhookSignature(raw, `sha256=${signature}`, "webhook-secret")).toBe(true);
    expect(validateClicksignWebhookSignature(raw, signature.replace(/^./, "0"), "webhook-secret")).toBe(false);
    expect(validateClicksignWebhookSignature(raw, "curta", "webhook-secret")).toBe(false);
    expect(validateClicksignWebhookSignature(raw, null, "webhook-secret")).toBe(false);
  });

  it("interpreta somente após JSON válido e normaliza evento", () => {
    expect(parseClicksignWebhook(bytes(body))).toEqual({ eventId: "evt-1", eventType: "PARTY_SIGNED", envelopeId: "env-1", signerId: "signer-1", occurredAt: "2026-09-03T12:00:00Z" });
    expect(() => parseClicksignWebhook(bytes("{invalid"))).toThrow("malformado");
  });

  it.each([
    ["signer.declined", "PARTY_DECLINED"], ["envelope.closed", "ENVELOPE_CLOSED"], ["envelope.canceled", "ENVELOPE_CANCELLED"], ["envelope.failed", "ERROR"], ["new.future.event", "UNKNOWN"],
  ] as const)("mapeia %s para %s", (eventName, expected) => {
    const payload = JSON.parse(body);
    payload.data.attributes.event_name = eventName;
    expect(parseClicksignWebhook(bytes(JSON.stringify(payload))).eventType).toBe(expected);
  });

  it("não aceita tenant do corpo como substituto do envelope", () => {
    const payload = { organizationId: "tenant-atacante", data: { id: "evt", type: "events", attributes: { event_name: "envelope.closed" } } };
    expect(() => parseClicksignWebhook(bytes(JSON.stringify(payload)))).toThrow("identificadores obrigatórios");
  });
});
