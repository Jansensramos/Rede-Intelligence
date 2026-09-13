import { describe, expect, it } from "vitest";
import { DisabledAiProviderAdapter } from "./disabled-provider-adapter";
import type { AiRequest } from "@/domain/ai-gateway";

describe("DisabledAiProviderAdapter", () => {
  it("sempre lanca PROVIDER_UNAVAILABLE permanente, sem tocar rede", async () => {
    const adapter = new DisabledAiProviderAdapter();
    const request: AiRequest = {
      correlationId: "corr-1", organizationId: "org-1", actorRef: "user-1", task: "CHAT",
      requiredCapabilities: ["TEXT_GENERATION"], dataClassification: "INTERNAL", criticality: "STANDARD",
      content: { systemInstructions: "sys", trustedContext: "ctx" },
    };
    await expect(adapter.execute(request, new AbortController().signal)).rejects.toMatchObject({ name: "AiGatewayError", code: "PROVIDER_UNAVAILABLE", retryable: false, correlationId: "corr-1" });
  });

  it("nao possui nenhuma capability (nunca e roteavel)", () => {
    expect(new DisabledAiProviderAdapter().profile.capabilities).toEqual([]);
  });
});
