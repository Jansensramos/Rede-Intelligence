import { describe, expect, it } from "vitest";
import {
  classifyProductionDependencyFailure,
  ProductionDependencyError,
  wrapProductionDependencyFailure,
  type ProductionDependencyFailureKind,
} from "./production-dependency-error";

function providerError(name: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error("segredo-bruto-que-nao-pode-vazar"), { name, ...extra });
}

describe("classificação segura de falhas de dependências de produção", () => {
  it.each<[string, unknown, ProductionDependencyFailureKind]>([
    ["credenciais do provider", providerError("CredentialsProviderError"), "MISSING_CREDENTIALS"],
    ["identidade expirada", providerError("Error", { code: "ExpiredTokenException" }), "MISSING_CREDENTIALS"],
    ["permissão pelo tipo", providerError("AccessDeniedException"), "PERMISSION_DENIED"],
    ["permissão por HTTP", providerError("ProviderError", { $metadata: { httpStatusCode: 403 } }), "PERMISSION_DENIED"],
    ["operação abortada", providerError("AbortError"), "TIMEOUT"],
    ["timeout por código", providerError("Error", { code: "ETIMEDOUT" }), "TIMEOUT"],
    ["serviço indisponível", providerError("ServiceUnavailable"), "SERVICE_UNAVAILABLE"],
    ["falha HTTP 500", providerError("ProviderError", { $metadata: { httpStatusCode: 500 } }), "SERVICE_UNAVAILABLE"],
    ["falha HTTP 503", providerError("ProviderError", { $metadata: { httpStatusCode: 503 } }), "SERVICE_UNAVAILABLE"],
    ["falha de transporte", providerError("Error", { code: "ECONNREFUSED" }), "SERVICE_UNAVAILABLE"],
    ["falha desconhecida", providerError("ProviderFailure"), "UNEXPECTED"],
    ["HTTP 401 (credencial ausente/inválida)", providerError("AlertTransportError", { statusCode: 401 }), "MISSING_CREDENTIALS"],
    ["HTTP 408 (timeout)", providerError("AlertTransportError", { statusCode: 408 }), "TIMEOUT"],
    ["HTTP 429 (throttling/indisponibilidade transitória)", providerError("AlertTransportError", { statusCode: 429 }), "SERVICE_UNAVAILABLE"],
  ])("classifica %s sem ler a mensagem", (_label, error, expected) => {
    expect(classifyProductionDependencyFailure(error).kind).toBe(expected);
  });

  it("encontra a evidência apenas no cause e preserva a causa original no erro seguro", () => {
    const root = providerError("AccessDeniedException");
    const outer = new Error("camada externa", { cause: root });
    const wrapped = wrapProductionDependencyFailure(outer, "AWS_KMS", "Falha segura.");
    expect(wrapped.kind).toBe("PERMISSION_DENIED");
    expect(wrapped.originalErrorClass).toBe("AccessDeniedException");
    expect(wrapped.cause).toBe(outer);
    expect(wrapped.message).toBe("Falha segura.");
    expect(JSON.stringify({ kind: wrapped.kind, errorClass: wrapped.originalErrorClass })).not.toContain("segredo-bruto");
  });

  it("encerra cadeias cíclicas ou excessivas sem promover erro desconhecido", () => {
    const cyclic = providerError("UnknownProviderError") as Error & { cause?: unknown };
    cyclic.cause = cyclic;
    expect(classifyProductionDependencyFailure(cyclic)).toEqual({ kind: "UNEXPECTED", errorClass: "UnknownProviderError" });

    let deep: Error = providerError("AccessDeniedException");
    for (let index = 0; index < 20; index += 1) deep = new Error("camada", { cause: deep });
    expect(classifyProductionDependencyFailure(deep).kind).toBe("UNEXPECTED");
  });

  it("mantém configuração já tipada como configuração inválida", () => {
    const error = new ProductionDependencyError("AWS_KMS", "INVALID_CONFIGURATION", "ConfigurationError", "Chave inválida.");
    expect(classifyProductionDependencyFailure(error)).toEqual({ kind: "INVALID_CONFIGURATION", errorClass: "ConfigurationError" });
  });

  it("falha fechado sem lançar quando propriedades são getters hostis", () => {
    const hostile = Object.create(null) as Record<string, unknown>;
    for (const property of ["name", "code", "__type", "$metadata", "statusCode", "status", "cause"]) {
      Object.defineProperty(hostile, property, { get: () => { throw new Error(`getter hostil: ${property}`); } });
    }
    expect(() => classifyProductionDependencyFailure(hostile)).not.toThrow();
    expect(classifyProductionDependencyFailure(hostile)).toEqual({ kind: "UNEXPECTED", errorClass: "UnknownError" });
  });

  it("falha fechado sem lançar diante de Proxy hostil", () => {
    const hostile = new Proxy({}, {
      get: () => { throw new Error("leitura proibida"); },
      getPrototypeOf: () => { throw new Error("protótipo proibido"); },
    });
    expect(classifyProductionDependencyFailure(hostile)).toEqual({ kind: "UNEXPECTED", errorClass: "UnknownError" });
  });
});
