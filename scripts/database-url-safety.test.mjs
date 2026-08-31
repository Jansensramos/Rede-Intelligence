import { describe, expect, it } from "vitest";
import { assertTestDatabaseUrl } from "./database-url-safety.mjs";

describe("guard do banco de testes", () => {
  it("aceita somente banco explicitamente de teste", () => {
    expect(assertTestDatabaseUrl("postgresql://u:p@localhost:5432/rede_intelligence_test?schema=public")).toContain("_test");
  });
  it("falha fechado para desenvolvimento, postgres e entrada ausente", () => {
    expect(() => assertTestDatabaseUrl("postgresql://u:p@localhost:5432/rede_intelligence")).toThrow(/bloqueada/);
    expect(() => assertTestDatabaseUrl("postgresql://u:p@localhost:5432/rede_intelligence_test_9p")).toThrow(/não é o banco de testes autorizado/);
    expect(() => assertTestDatabaseUrl("postgresql://u:p@localhost:5432/postgres")).toThrow(/não é o banco de testes autorizado/);
    expect(() => assertTestDatabaseUrl(undefined)).toThrow(/obrigatória/);
  });
});
