import { describe, expect, it } from "vitest";
import { CLICKSIGN_WEBHOOK_MAX_BYTES } from "@/application/sales/clicksign-service";
import { readLimitedRequestBody } from "@/infrastructure/http/limited-request-body";
import { POST } from "./route";

describe("rota de webhook Clicksign", () => {
  it("rejeita Content-Type incompatível antes do domínio", async () => {
    const response = await POST(new Request("http://local/api/webhooks/clicksign/opaque", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }), { params: Promise.resolve({ installationId: "opaque" }) });
    expect(response.status).toBe(415);
  });

  it("rejeita Content-Length acima do limite sem ler o corpo", async () => {
    const request = new Request("http://local", { method: "POST", headers: { "content-length": String(CLICKSIGN_WEBHOOK_MAX_BYTES + 1) }, body: "x" });
    await expect(readLimitedRequestBody(request, CLICKSIGN_WEBHOOK_MAX_BYTES)).rejects.toThrow("PAYLOAD_TOO_LARGE");
  });

  it("interrompe stream que ultrapassa o limite declarado", async () => {
    const chunk = new Uint8Array(Math.floor(CLICKSIGN_WEBHOOK_MAX_BYTES / 2) + 1);
    const request = new Request("http://local", { method: "POST", body: new ReadableStream({ start(controller) { controller.enqueue(chunk); controller.enqueue(chunk); controller.close(); } }), duplex: "half" } as RequestInit & { duplex: "half" });
    await expect(readLimitedRequestBody(request, CLICKSIGN_WEBHOOK_MAX_BYTES)).rejects.toThrow("PAYLOAD_TOO_LARGE");
  });
});
