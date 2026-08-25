import { describe, expect, it } from "vitest";
import { assertWorkspaceCapability, computeWorkspaceCapabilities, hasWorkspaceCapability } from "./capabilities";

describe("capacidades transversais da experiência operacional (9K.0)", () => {
  it("todo papel autenticado consegue visualizar", () => {
    for (const role of ["VIEWER", "REVIEWER", "ANALYST", "ADMIN", "OWNER"] as const) {
      expect(hasWorkspaceCapability(role, "WORKSPACE_VIEW")).toBe(true);
    }
  });

  it("edição fica restrita a quem já podia editar hoje (paridade com o padrão ad hoc existente)", () => {
    expect(hasWorkspaceCapability("VIEWER", "WORKSPACE_EDIT")).toBe(false);
    expect(hasWorkspaceCapability("REVIEWER", "WORKSPACE_EDIT")).toBe(false);
    expect(hasWorkspaceCapability("ANALYST", "WORKSPACE_EDIT")).toBe(true);
    expect(hasWorkspaceCapability("ADMIN", "WORKSPACE_EDIT")).toBe(true);
    expect(hasWorkspaceCapability("OWNER", "WORKSPACE_EDIT")).toBe(true);
  });

  it("aprovação e configuração de integrações exigem ADMIN ou OWNER", () => {
    expect(hasWorkspaceCapability("ANALYST", "WORKSPACE_APPROVE")).toBe(false);
    expect(hasWorkspaceCapability("REVIEWER", "WORKSPACE_APPROVE")).toBe(false);
    expect(hasWorkspaceCapability("ADMIN", "WORKSPACE_APPROVE")).toBe(true);
    expect(hasWorkspaceCapability("OWNER", "INTEGRATIONS_CONFIGURE")).toBe(true);
    expect(hasWorkspaceCapability("ANALYST", "INTEGRATIONS_CONFIGURE")).toBe(false);
  });

  it("dado confidencial fica restrito a OWNER", () => {
    expect(hasWorkspaceCapability("ADMIN", "CONFIDENTIAL_VIEW")).toBe(false);
    expect(hasWorkspaceCapability("OWNER", "CONFIDENTIAL_VIEW")).toBe(true);
  });

  it("assertWorkspaceCapability lança erro explicável quando a capacidade falta", () => {
    expect(() => assertWorkspaceCapability("VIEWER", "WORKSPACE_APPROVE")).toThrow(/capacidade/);
    expect(() => assertWorkspaceCapability("OWNER", "WORKSPACE_APPROVE")).not.toThrow();
  });

  it("computeWorkspaceCapabilities devolve um objeto plano e serializável", () => {
    const set = computeWorkspaceCapabilities("ANALYST");
    expect(set).toEqual({
      role: "ANALYST",
      WORKSPACE_VIEW: true,
      WORKSPACE_EDIT: true,
      WORKSPACE_REVIEW: false,
      WORKSPACE_APPROVE: false,
      INTEGRATIONS_CONFIGURE: false,
      CONFIDENTIAL_VIEW: false,
      FINANCIAL_VIEW: true,
      LEGAL_VIEW: true,
      COMMERCIAL_VIEW: true,
      PROCUREMENT_VIEW: true,
    });
    expect(JSON.parse(JSON.stringify(set))).toEqual(set);
  });

  it("visibilidade por domínio na Gestão Executiva (9K.2, gate 2): só VIEWER fica sem FINANCIAL_VIEW/LEGAL_VIEW/COMMERCIAL_VIEW/PROCUREMENT_VIEW", () => {
    for (const capability of ["FINANCIAL_VIEW", "LEGAL_VIEW", "COMMERCIAL_VIEW", "PROCUREMENT_VIEW"] as const) {
      expect(hasWorkspaceCapability("VIEWER", capability)).toBe(false);
      expect(hasWorkspaceCapability("REVIEWER", capability)).toBe(true);
      expect(hasWorkspaceCapability("ANALYST", capability)).toBe(true);
      expect(hasWorkspaceCapability("ADMIN", capability)).toBe(true);
      expect(hasWorkspaceCapability("OWNER", capability)).toBe(true);
    }
  });
});
