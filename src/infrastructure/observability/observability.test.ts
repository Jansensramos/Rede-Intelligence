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

  it("redige e-mail e query string de URL temporária", () => {
    const value = sanitizeLogValue({ message: "falha para pessoa@example.test em https://app.clicksign.com/file.pdf?token=abc&expires=123", signerEmail: "pessoa@example.test" });
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain("pessoa@example.test");
    expect(serialized).not.toContain("token=abc");
    expect(serialized).toContain("[REDACTED]");
  });

  it("redige telefone BR formatado e não formatado em texto livre, sem apagar números pequenos legítimos (achado da reauditoria 9Q.2B)", () => {
    const formatted = sanitizeLogValue("contato: +55 11 98765-4321") as string;
    const parens = sanitizeLogValue("ligar em (11) 98765-4321 ou (11) 3456-7890") as string;
    const bare = sanitizeLogValue("telefone 11987654321 informado") as string;
    expect(formatted).not.toContain("98765-4321");
    expect(parens).not.toMatch(/98765-4321|3456-7890/);
    expect(bare).not.toContain("11987654321");
    expect(sanitizeLogValue("Pedido 111111111111 confirmado")).toBe("Pedido 111111111111 confirmado");
    expect(sanitizeLogValue("CEP 01310-100")).toBe("CEP 01310-100");
    expect(sanitizeLogValue("total R$ 1.234,56")).toBe("total R$ 1.234,56");
  });

  it("redige JWT nu (sem prefixo bearer/token) em texto livre", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const value = sanitizeLogValue(`token retornado: ${jwt}`) as string;
    expect(value).not.toContain(jwt);
    expect(value).toContain("[REDACTED]");
  });

  it("redige organizationId/installationId/inboxId/userId embutidos como texto livre, não só como chave de objeto", () => {
    const message = "erro ao processar organizationId=org-real-uuid-1234 installationId=inst-real-9999 inboxId=inbox-real-8888 userId=user-real-7777";
    const value = sanitizeLogValue(message) as string;
    expect(value).not.toContain("org-real-uuid-1234");
    expect(value).not.toContain("inst-real-9999");
    expect(value).not.toContain("inbox-real-8888");
    expect(value).not.toContain("user-real-7777");
  });

  it("redige em objetos aninhados, arrays, Error e cause — não só em mensagens soltas", () => {
    const cause = new Error("Authorization: Bearer sk_live_abcdef1234567890");
    const outer = new Error("falha ao contatar +55 11 98765-4321", { cause });
    const value = sanitizeLogValue({
      error: outer,
      // "note" é texto livre (deve ser redigido); "installationId" como CHAVE de objeto
      // estruturado permanece legível de propósito — logs internos continuam depuráveis
      // por instalação; só o payload externo de alerta usa tenantRef hasheado.
      list: ["contato +55 11 98765-4321", { installationId: "inst-livre-000", note: "installationId=inst-livre-000" }],
    }) as Record<string, unknown>;
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain("98765-4321");
    expect(serialized).not.toContain("sk_live_abcdef1234567890");
    expect(serialized).toContain('"installationId":"inst-livre-000"');
    expect(serialized).toContain('"note":"[REDACTED]"');
  });
});
