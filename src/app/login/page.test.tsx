import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LoginScreen } from "@/components/auth/login-screen";

vi.mock("@/components/rede-mark", () => ({ RedeMark: () => React.createElement("span", null, "REDE") }));
vi.mock("@/components/auth/login-form", () => ({ LoginForm: ({ demo }: { demo?: { email: string; password: string } }) => React.createElement("form", { "data-demo": demo ? "habilitado" : "desabilitado" }) }));

describe("tela de login em produção", () => {
  it("não renderiza dados demonstrativos quando a apresentação está desabilitada", () => {
    const html = renderToStaticMarkup(<LoginScreen demo={{ enabled: false }} />);
    expect(html).not.toContain("Demonstração:");
    expect(html).not.toContain("Acesso demonstrativo habilitado");
    expect(html).not.toMatch(/value="[^"]+"/);
  });
});
