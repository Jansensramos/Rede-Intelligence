import { describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "./runtime-config";

describe("contrato de ambiente", () => {
  it("falha cedo em produção sem revelar valores", () => {
    const environment = { NODE_ENV: "production", DATABASE_URL: "postgresql://user:super-secret@db/prod" };
    expect(() => parseRuntimeConfig(environment)).toThrow(/APP_PUBLIC_URL|SESSION_SECRET|STORAGE/);
    try { parseRuntimeConfig(environment); } catch (error) { expect(String(error)).not.toContain("super-secret"); }
  });
  it("aceita configuração mínima de teste", () => {
    expect(parseRuntimeConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://localhost/rede_intelligence_test" }).STORAGE_PROVIDER).toBe("local");
  });
});
