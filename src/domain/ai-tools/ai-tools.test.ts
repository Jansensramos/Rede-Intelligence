import { describe, expect, it } from "vitest";
import {
  AI_TOOLS_LAYER_VERSION, AiToolArgumentsSchema, AiToolCatalogEntrySchema, AiToolError,
  AiToolInvocationRequestSchema, AiToolNameSchema, AiToolResultSchema, AI_TOOL_ERROR_CODES,
} from "./contracts";

const validRequest = () => ({
  toolName: "getActiveRisks",
  correlationId: "corr-1",
  organizationId: "org-1",
  userId: "user-1",
  conversationId: "conv-1",
  arguments: {},
  requestedAt: "2026-09-15T12:00:00.000Z",
});

describe("Tool Layer contracts (Fase 10C) - dominio puro", () => {
  it("aceita um nome de ferramenta do registro fechado e rejeita qualquer outro", () => {
    expect(AiToolNameSchema.safeParse("getActiveRisks").success).toBe(true);
    expect(AiToolNameSchema.safeParse("dropTable").success).toBe(false);
    expect(AiToolNameSchema.safeParse("").success).toBe(false);
  });

  it("rejeita argumentos com propriedade nao enumeravel, getter, Symbol e Proxy antes de qualquer execucao - sem acionar o getter", () => {
    let getterCalls = 0;
    const hostileGetter: Record<string, unknown> = {};
    Object.defineProperty(hostileGetter, "extra", { enumerable: true, get: () => { getterCalls += 1; return "evil"; } });
    expect(AiToolArgumentsSchema.safeParse(hostileGetter).success).toBe(false);
    expect(getterCalls).toBe(0);

    const hidden: Record<string, unknown> = {};
    Object.defineProperty(hidden, "hidden", { enumerable: false, value: "x" });
    expect(AiToolArgumentsSchema.safeParse(hidden).success).toBe(false);

    const withSymbol: Record<string | symbol, unknown> = { [Symbol("s")]: 1 };
    expect(AiToolArgumentsSchema.safeParse(withSymbol).success).toBe(false);

    const proxied = new Proxy({}, { ownKeys() { throw new Error("hostile trap"); } });
    expect(AiToolArgumentsSchema.safeParse(proxied).success).toBe(false);

    // Object.create(null) tem prototype null (!= Object.prototype) - isPlainContextData recusa, mesmo vazio.
    const nullProto = Object.create(null);
    expect(AiToolArgumentsSchema.safeParse(nullProto).success).toBe(false);
  });

  it("so aceita objeto de argumentos vazio - qualquer chave extra e recusada (allowlist minima do piloto)", () => {
    expect(AiToolArgumentsSchema.safeParse({}).success).toBe(true);
    expect(AiToolArgumentsSchema.safeParse({ sourceId: "x" }).success).toBe(false);
    expect(AiToolArgumentsSchema.safeParse({ organizationId: "x" }).success).toBe(false);
  });

  it("AiToolInvocationRequestSchema exige forma estrita e recusa campos extras/objetos hostis", () => {
    expect(AiToolInvocationRequestSchema.safeParse(validRequest()).success).toBe(true);
    expect(AiToolInvocationRequestSchema.safeParse({ ...validRequest(), role: "OWNER" }).success).toBe(false);
    expect(AiToolInvocationRequestSchema.safeParse({ ...validRequest(), toolName: "unknown" }).success).toBe(false);
    expect(AiToolInvocationRequestSchema.safeParse({ ...validRequest(), requestedAt: "2026-09-15" }).success).toBe(false);

    let getterCalls = 0;
    const hostile = { ...validRequest() };
    Object.defineProperty(hostile, "organizationId", { enumerable: true, get: () => { getterCalls += 1; return "org-1"; } });
    expect(AiToolInvocationRequestSchema.safeParse(hostile).success).toBe(false);
    expect(getterCalls).toBe(0);
  });

  it("AiToolResultSchema aceita COMPLETED com evidence/medidas e recusa a uniao com campos misturados", () => {
    const completed = {
      name: "getActiveRisks", status: "COMPLETED", correlationId: "corr-1", toolsVersion: AI_TOOLS_LAYER_VERSION,
      contextPolicyVersion: "CONTEXT_POLICY_V1.0.0", purpose: "RISK_REVIEW",
      measurements: { itemCount: 1, byteCount: 100, estimatedTokens: 34 },
      evidence: "{}", durationMs: 12,
    };
    expect(AiToolResultSchema.safeParse(completed).success).toBe(true);
    expect(AiToolResultSchema.safeParse({ ...completed, error: { code: "TOOL_UNKNOWN" } }).success).toBe(false);

    const refused = {
      name: "UNKNOWN", status: "REFUSED", correlationId: "corr-1", toolsVersion: AI_TOOLS_LAYER_VERSION,
      error: { code: "TOOL_UNKNOWN", message: "x", correlationId: "corr-1", retryable: false },
      durationMs: 3,
    };
    expect(AiToolResultSchema.safeParse(refused).success).toBe(true);
    expect(AiToolResultSchema.safeParse({ ...refused, purpose: "RISK_REVIEW" }).success).toBe(false);
  });

  it("AiToolError so aceita codigos fechados, mensagem estatica por codigo e retryable derivado da politica", () => {
    for (const code of AI_TOOL_ERROR_CODES) {
      const error = new AiToolError(code, "corr-1");
      expect(error.code).toBe(code);
      expect(error.correlationId).toBe("corr-1");
      expect(typeof error.retryable).toBe("boolean");
      expect(error.message.length).toBeGreaterThan(0);
    }
    expect(new AiToolError("TOOL_ACCESS_DENIED", "corr-1").retryable).toBe(false);
    expect(new AiToolError("TOOL_CONCURRENT_CHANGE", "corr-1").retryable).toBe(true);
    // TOOL_ACCESS_DENIED nunca distingue "outro tenant" de "inexistente" - mesma mensagem estatica sempre.
    expect(new AiToolError("TOOL_ACCESS_DENIED", "corr-1").message).toBe(new AiToolError("TOOL_ACCESS_DENIED", "corr-2").message);
  });

  it("catalogo publico nunca expoe execute/logica interna - apenas metadado fechado", () => {
    const entry = {
      name: "getActiveRisks", description: "x", mode: "READ_ONLY", requiredCapability: "VIABILITY_READ",
      contextPurpose: "RISK_REVIEW", toolsVersion: AI_TOOLS_LAYER_VERSION,
    };
    expect(AiToolCatalogEntrySchema.safeParse(entry).success).toBe(true);
    expect(AiToolCatalogEntrySchema.safeParse({ ...entry, execute: () => undefined }).success).toBe(false);
    expect(AiToolCatalogEntrySchema.safeParse({ ...entry, mode: "MUTATION" }).success).toBe(false);
  });
});
