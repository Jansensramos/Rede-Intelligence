import { describe, expect, it } from "vitest";
import { assertIsolatedRestoreTarget, UnsafeRestoreTargetError } from "./restore-safety";

const source = "postgresql://user:pass@prod-db.example.invalid:5432/rede_producao";

describe("guarda de restauração isolada (nunca sobre a fonte)", () => {
  it("aceita alvo isolado com prefixo comprovado e host diferente", () => {
    const result = assertIsolatedRestoreTarget({ sourceUrl: source, targetUrl: "postgresql://user:pass@restore-db.example.invalid:5432/rede_restore_abc123" });
    expect(result.target.database).toBe("rede_restore_abc123");
  });

  it("rejeita quando o alvo é exatamente a fonte (mesmo host, porta e banco)", () => {
    expect(() => assertIsolatedRestoreTarget({ sourceUrl: source, targetUrl: source })).toThrow(UnsafeRestoreTargetError);
  });

  it("rejeita quando o alvo é o mesmo host/porta mudando só o texto do banco mas sem prefixo de isolamento", () => {
    expect(() => assertIsolatedRestoreTarget({ sourceUrl: source, targetUrl: "postgresql://user:pass@prod-db.example.invalid:5432/rede_producao_copy" }))
      .toThrow(/precisa começar com/);
  });

  it("rejeita URL malformada sem vazar a URL original na mensagem", () => {
    expect(() => assertIsolatedRestoreTarget({ sourceUrl: source, targetUrl: "nao-e-uma-url" })).toThrow(/não é uma URL de banco válida/);
  });

  it("rejeita protocolo diferente de postgres", () => {
    expect(() => assertIsolatedRestoreTarget({ sourceUrl: source, targetUrl: "mysql://user:pass@host/rede_restore_x" })).toThrow(/PostgreSQL/);
  });

  it("aceita prefixo de isolamento customizado", () => {
    const result = assertIsolatedRestoreTarget({ sourceUrl: source, targetUrl: "postgresql://user:pass@restore.example.invalid/pitr_drill_2026_09", isolationPrefix: "pitr_drill_" });
    expect(result.target.database).toBe("pitr_drill_2026_09");
  });

  it("recusa banco arquivado como ORIGEM (achado alto da reauditoria 9Q.2B: mesma política central do runtime)", () => {
    expect(() => assertIsolatedRestoreTarget({
      sourceUrl: "postgresql://user:pass@prod-db.example.invalid:5432/rede_intelligence_archived_20260904",
      targetUrl: "postgresql://user:pass@restore-db.example.invalid:5432/rede_restore_abc123",
    })).toThrow(UnsafeRestoreTargetError);
  });

  it("recusa banco arquivado como DESTINO", () => {
    expect(() => assertIsolatedRestoreTarget({
      sourceUrl: source,
      targetUrl: "postgresql://user:pass@restore-db.example.invalid:5432/rede_restore_archive_copy",
    })).toThrow(UnsafeRestoreTargetError);
  });

  it("recusa a variante 'archive'/'archival' (não só 'archived') como origem ou destino", () => {
    expect(() => assertIsolatedRestoreTarget({
      sourceUrl: "postgresql://user:pass@prod-db.example.invalid:5432/rede_intelligence_archive",
      targetUrl: "postgresql://user:pass@restore-db.example.invalid:5432/rede_restore_abc123",
    })).toThrow(UnsafeRestoreTargetError);
    expect(() => assertIsolatedRestoreTarget({
      sourceUrl: source,
      targetUrl: "postgresql://user:pass@restore-db.example.invalid:5432/rede_restore_archival",
    })).toThrow(UnsafeRestoreTargetError);
  });
});
