import { describe, expect, it, vi } from "vitest";
import { resolveCorrelationId } from "./correlation";
import { logger, sanitizeLogValue } from "./logger";

describe("observabilidade segura", () => {
  it("preserva correlação válida e substitui entrada hostil", () => {
    expect(resolveCorrelationId("req-123")).toBe("req-123");
    expect(resolveCorrelationId("quebra\nde-header")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("remove segredos, CPF, cookie e token dos logs estruturados", () => {
    const value = sanitizeLogValue({ password: "senha", nested: { cpf: "123.456.789-00" }, message: "Bearer abc.def", cookie: "rede_session=abc" });
    expect(JSON.stringify(value)).not.toContain("senha");
    expect(JSON.stringify(value)).not.toContain("123.456");
    expect(JSON.stringify(value)).not.toContain("abc.def");
  });

  it("emite JSON com contexto de tenant, job e correlação", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logger.info("feito", { organizationId: "org-a", jobId: "job-a", correlationId: "corr-a" });
    const parsed = JSON.parse(String(output.mock.calls[0][0]));
    expect(parsed).toMatchObject({ organizationId: "org-a", jobId: "job-a", correlationId: "corr-a" });
    output.mockRestore();
  });
});
