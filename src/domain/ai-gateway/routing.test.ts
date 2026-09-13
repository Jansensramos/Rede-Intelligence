import { describe, expect, it } from "vitest";
import { requiresHumanApproval, selectRoute } from "./routing";
import type { AiModelProfile, AiRequest, AiRoutingPolicy } from "./types";

function request(overrides: Partial<AiRequest> = {}): AiRequest {
  return {
    correlationId: "corr-1",
    organizationId: "org-1",
    actorRef: "user-1",
    task: "CHAT",
    requiredCapabilities: ["TEXT_GENERATION"],
    dataClassification: "INTERNAL",
    criticality: "STANDARD",
    content: { systemInstructions: "sys", trustedContext: "ctx" },
    ...overrides,
  };
}

const disabledProfile: AiModelProfile = { provider: "disabled", modelRef: "disabled", capabilities: [], contextWindowTokens: 0, maxOutputTokens: 0, supportsJsonSchema: false, safetyTier: "RESTRICTED" };
const realProfile: AiModelProfile = { provider: "real", modelRef: "real-model", capabilities: ["TEXT_GENERATION"], contextWindowTokens: 8000, maxOutputTokens: 1000, supportsJsonSchema: true, safetyTier: "STANDARD" };

function policy(overrides: Partial<AiRoutingPolicy> = {}): AiRoutingPolicy {
  return {
    organizationId: "org-1",
    task: "CHAT",
    allowedProviders: ["disabled"],
    allowedModelsByCapability: { TEXT_GENERATION: ["disabled"], STRUCTURED_OUTPUT: [], EMBEDDINGS: [], VISION: [], TOOL_USE: [], STREAMING: [] },
    fallbackChain: [],
    maxFallbackAttempts: 0,
    ...overrides,
  };
}

describe("selectRoute", () => {
  it("sem candidato com as capabilities exigidas retorna null (sem fallback fabricado)", () => {
    const catalog = new Map([["disabled", disabledProfile]]);
    expect(selectRoute(policy(), request(), catalog)).toBeNull();
  });

  it("encontra o provider primario quando ele tem a capability exigida", () => {
    const catalog = new Map([["real", realProfile]]);
    const decision = selectRoute(policy({ allowedProviders: ["real"], allowedModelsByCapability: { TEXT_GENERATION: ["real"], STRUCTURED_OUTPUT: [], EMBEDDINGS: [], VISION: [], TOOL_USE: [], STREAMING: [] } }), request(), catalog);
    expect(decision?.candidate.providerRef).toBe("real");
    expect(decision?.fallbackCount).toBe(0);
  });

  it("nao roteia para um provider fora da allowlist do tenant mesmo se o catalogo tiver o profile", () => {
    const catalog = new Map([["real", realProfile]]);
    const decision = selectRoute(policy({ allowedProviders: ["disabled"] }), request(), catalog);
    expect(decision).toBeNull();
  });

  it("usa a cadeia de fallback respeitando maxFallbackAttempts (fallback so e valido se tambem estiver na allowlist do tenant)", () => {
    const catalog = new Map([["real", realProfile]]);
    const decision = selectRoute(
      policy({ allowedProviders: ["disabled", "real"], fallbackChain: ["real"], maxFallbackAttempts: 1, allowedModelsByCapability: { TEXT_GENERATION: ["disabled", "real"], STRUCTURED_OUTPUT: [], EMBEDDINGS: [], VISION: [], TOOL_USE: [], STREAMING: [] } }),
      request(),
      catalog,
    );
    expect(decision?.candidate.providerRef).toBe("real");
    expect(decision?.fallbackCount).toBe(1);
  });

  it("nunca cai para um fallback fora da allowlist do tenant, mesmo que o catalogo o conheca", () => {
    const catalog = new Map([["real", realProfile]]);
    const decision = selectRoute(
      policy({ allowedProviders: ["disabled"], fallbackChain: ["real"], maxFallbackAttempts: 1, allowedModelsByCapability: { TEXT_GENERATION: ["disabled", "real"], STRUCTURED_OUTPUT: [], EMBEDDINGS: [], VISION: [], TOOL_USE: [], STREAMING: [] } }),
      request(),
      catalog,
    );
    expect(decision).toBeNull();
  });

  it("nao excede maxFallbackAttempts", () => {
    const catalog = new Map([["real", realProfile]]);
    const decision = selectRoute(
      policy({ allowedProviders: ["disabled", "real"], fallbackChain: ["real"], maxFallbackAttempts: 0, allowedModelsByCapability: { TEXT_GENERATION: ["disabled", "real"], STRUCTURED_OUTPUT: [], EMBEDDINGS: [], VISION: [], TOOL_USE: [], STREAMING: [] } }),
      request(),
      catalog,
    );
    expect(decision).toBeNull();
  });
});

describe("requiresHumanApproval", () => {
  it("bloqueia criticidade HIGH quando a politica exige aprovacao acima de HIGH", () => {
    expect(requiresHumanApproval(policy({ requiresHumanApprovalAbove: "HIGH" }), request({ criticality: "HIGH" }))).toBe(true);
  });
  it("nao bloqueia criticidade STANDARD mesmo com a politica configurada", () => {
    expect(requiresHumanApproval(policy({ requiresHumanApprovalAbove: "HIGH" }), request({ criticality: "STANDARD" }))).toBe(false);
  });
  it("sem a politica configurada, nunca bloqueia (decisao nunca autonoma, mas tambem nunca inventada)", () => {
    expect(requiresHumanApproval(policy(), request({ criticality: "HIGH" }))).toBe(false);
  });
});
