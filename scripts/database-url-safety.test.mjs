import { describe, expect, it } from "vitest";
import { assertNotArchivedDatabase, assertTestDatabaseUrl, DatabaseUrlSafetyError } from "./database-url-safety.mjs";

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

describe("guard contra banco arquivado (achado M2 / bloqueador da reauditoria 9Q.2B)", () => {
  it.each([
    "postgresql://u:p@localhost:5432/rede_intelligence_test_archived_20260904",
    "postgresql://u:p@localhost:5432/rede_intelligence_test_ARCHIVED_20260904",
    "postgresql://u:p@localhost:5432/archived_rede_intelligence_test",
    "postgresql://u:p@localhost:5432/rede_intelligence_archived",
    "postgresql://u:p@localhost:5432/rede%5Farchived%5Ftest", // "rede_archived_test" percent-encoded
    // Radical "archiv" — cobre archive/archival além de archived (lacuna confirmada
    // na reauditoria: o regex anterior só bloqueava a palavra exata "archived").
    "postgresql://u:p@localhost:5432/rede_intelligence_archive",
    "postgresql://u:p@localhost:5432/rede_intelligence_ARCHIVE",
    "postgresql://u:p@localhost:5432/rede_intelligence_archival",
    "postgresql://u:p@localhost:5432/rede_intelligence_archival_backup",
    "postgresql://u:p@localhost:5432/archive-2026-09-04-rede",
    "postgresql://u:p@localhost:5432/rede-archive-2026-09-04",
    "postgresql://u:p@localhost:5432/redeArchivalCopy",
  ])("recusa %s", (url) => {
    expect(() => assertNotArchivedDatabase(url, "TEST_DATABASE_URL")).toThrow(/arquivado/);
    expect(() => assertNotArchivedDatabase(url, "TEST_DATABASE_URL")).toThrow(DatabaseUrlSafetyError);
  });

  it("assertTestDatabaseUrl também recusa o banco arquivado, mesmo que o nome exato mudasse no futuro", () => {
    expect(() => assertTestDatabaseUrl("postgresql://u:p@localhost:5432/rede_intelligence_test_archived_20260904")).toThrow(/arquivado/);
    expect(() => assertTestDatabaseUrl("postgresql://u:p@localhost:5432/rede_intelligence_archive")).toThrow(/arquivado/);
  });

  it("permite um banco novo, não arquivado", () => {
    expect(() => assertNotArchivedDatabase("postgresql://u:p@localhost:5432/rede_intelligence_test", "TEST_DATABASE_URL")).not.toThrow();
    expect(() => assertNotArchivedDatabase("postgresql://u:p@localhost:5432/rede_intelligence", "DATABASE_URL")).not.toThrow();
  });

  it("é inerte para entrada ausente — exigir presença é responsabilidade do chamador", () => {
    expect(() => assertNotArchivedDatabase(undefined, "TEST_DATABASE_URL")).not.toThrow();
    expect(() => assertNotArchivedDatabase(null, "TEST_DATABASE_URL")).not.toThrow();
    expect(() => assertNotArchivedDatabase("", "TEST_DATABASE_URL")).not.toThrow();
  });

  it("falha fechado (bloqueia) para URL inválida, em vez de deixar passar sem checar — corrigido nesta rodada", () => {
    expect(() => assertNotArchivedDatabase("not-a-url", "DATABASE_URL")).toThrow(DatabaseUrlSafetyError);
    expect(() => assertNotArchivedDatabase("not-a-url", "DATABASE_URL")).toThrow(/válida/);
  });

  it("falha fechado para percent-encoding malformado no pathname", () => {
    expect(() => assertNotArchivedDatabase("postgresql://u:p@localhost:5432/%zz", "DATABASE_URL")).toThrow(DatabaseUrlSafetyError);
  });

  it("falha fechado para entrada não textual (objeto hostil, número, getter)", () => {
    expect(() => assertNotArchivedDatabase(123, "DATABASE_URL")).toThrow(DatabaseUrlSafetyError);
    expect(() => assertNotArchivedDatabase({ toString: () => { throw new Error("getter hostil"); } }, "DATABASE_URL")).toThrow(DatabaseUrlSafetyError);
    expect(() => assertNotArchivedDatabase(["postgresql://u:p@localhost/db"], "DATABASE_URL")).toThrow(DatabaseUrlSafetyError);
  });

  it("não confunde usuário, senha ou parâmetros de query com o nome do banco — só o pathname é checado", () => {
    // Usuário/senha/schema contendo "archiv" não deve bloquear um banco legítimo, e não
    // deve criar um bypass (a checagem sempre olha só o pathname, nunca a string toda).
    expect(() => assertNotArchivedDatabase("postgresql://archived_user:archive_pw@localhost:5432/rede_intelligence?schema=archival", "DATABASE_URL")).not.toThrow();
  });

  it("URL sem pathname/banco não é tratada como arquivada (outros validadores exigem presença de banco)", () => {
    expect(() => assertNotArchivedDatabase("postgresql://localhost:5432", "DATABASE_URL")).not.toThrow();
    expect(() => assertNotArchivedDatabase("postgresql://localhost:5432/", "DATABASE_URL")).not.toThrow();
  });

  it("mensagem de erro nunca inclui usuário, senha, host ou parâmetros", () => {
    const url = "postgresql://usuario_secreto:senha_secreta@db-interno.exemplo:5432/rede_archived?schema=public&sslmode=require";
    try {
      assertNotArchivedDatabase(url, "DATABASE_URL");
      throw new Error("deveria ter lançado");
    } catch (error) {
      expect(error.message).not.toContain("usuario_secreto");
      expect(error.message).not.toContain("senha_secreta");
      expect(error.message).not.toContain("db-interno.exemplo");
      expect(error.message).not.toContain("sslmode");
    }
  });
});
