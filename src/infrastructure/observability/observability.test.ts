import { describe, expect, it, vi } from "vitest";
import { resolveCorrelationId } from "./correlation";
import { logger, sanitizeLogValue } from "./logger";

describe("observabilidade segura", () => {
  it("preserva correlação válida e substitui entrada hostil", () => {
    expect(resolveCorrelationId("req-123")).toBe("req-123");
    expect(resolveCorrelationId("quebra\nde-header")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("remove segredos, CPF, cookie e token dos logs estruturados", () => {
    const value = sanitizeLogValue({ password: "senha", nested: { cpf: "123.456.789-00" }, message: "Bearer abc.def password=conteudo-sintetico postgresql://usuario:conteudo-sintetico@db/producao", cookie: "rede_session=abc" });
    expect(JSON.stringify(value)).not.toContain("senha");
    expect(JSON.stringify(value)).not.toContain("123.456");
    expect(JSON.stringify(value)).not.toContain("abc.def");
    expect(JSON.stringify(value)).not.toContain("conteudo-sintetico");
  });

  it("redige CNPJ formatado ou numérico em objetos, arrays e mensagens sem apagar números arbitrários", () => {
    const formatted = `${["12", "345", "678"].join(".")}/${"0001"}-${"90"}`;
    const digits = ["12345678", "000190"].join("");
    const cpf = ["123", "456", "789", "00"].join(".").replace(".00", "-00");
    const harmless = ["111111", "111111"].join("");
    const value = sanitizeLogValue({
      companyCnpj: formatted,
      nested: { taxId: digits, message: `Fornecedor ${formatted}; CPF ${cpf}` },
      array: [digits, { cnpj: formatted }],
      harmless: `Pedido ${harmless}`,
    });
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain(formatted);
    expect(serialized).not.toContain(digits);
    expect(serialized).not.toContain(cpf);
    expect(serialized).toContain(harmless);
  });

  it("emite JSON com contexto de tenant, job e correlação", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logger.info("feito", { organizationId: "org-a", jobId: "job-a", correlationId: "corr-a" });
    const parsed = JSON.parse(String(output.mock.calls[0][0]));
    expect(parsed).toMatchObject({ organizationId: "org-a", jobId: "job-a", correlationId: "corr-a" });
    output.mockRestore();
  });
});
