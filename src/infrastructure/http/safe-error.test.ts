import { describe, expect, it, vi } from "vitest";
import { reportInternalError, safeOperatorError } from "./safe-error";

describe("fronteira de erro para o operador", () => {
  it("mantém detalhe no log sanitizado e retorna somente correlação", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const correlationId = reportInternalError(new Error("password=conteudo-sintetico"), { component: "teste", event: "falha", correlationId: "corr-teste" });
    const publicMessage = safeOperatorError(correlationId);
    expect(publicMessage).toContain("corr-teste");
    expect(publicMessage).not.toContain("conteudo-sintetico");
    expect(String(output.mock.calls[0][0])).not.toContain("conteudo-sintetico");
    output.mockRestore();
  });
});
