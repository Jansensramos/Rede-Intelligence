import { describe, expect, it } from "vitest";
import type { MembershipRole } from "@prisma/client";
import { ALL_PROTECTED_READ_CAPABILITIES, assertLegacyWorkspaceRead, defaultWorkspacePathForRole, hasProtectedReadCapability, protectedReadCapabilityForPath } from "./read-capabilities";

describe("matriz de leitura protegida", () => {
  const elevated: MembershipRole[] = ["OWNER", "ADMIN", "ANALYST", "REVIEWER"];
  it.each(elevated)("%s possui todas as capacidades explícitas", (role) => {
    expect(ALL_PROTECTED_READ_CAPABILITIES.every((capability) => hasProtectedReadCapability(role, capability))).toBe(true);
  });

  it("VIEWER não recebe dados financeiros ou operacionais protegidos", () => {
    for (const capability of [
      "EXECUTIVE_READ", "ENGINEERING_READ", "PROCUREMENT_READ", "FINANCIAL_READ", "CAPITAL_READ",
      "COMMERCIAL_READ", "LEGAL_READ", "PEOPLE_READ", "ACCOUNTING_READ", "INTEGRATIONS_READ",
      "DATA_INTELLIGENCE_READ", "ACTIONS_READ", "OPERATIONS_READ", "AI_READ",
    ] as const) expect(hasProtectedReadCapability("VIEWER", capability)).toBe(false);
  });

  it("VIEWER mantém somente leituras não protegidas previstas", () => {
    for (const capability of ["VIABILITY_READ", "MARKET_PRODUCT_READ", "ECOSYSTEM_READ", "HELP_READ"] as const) {
      expect(hasProtectedReadCapability("VIEWER", capability)).toBe(true);
    }
  });

  it.each([
    ["/executivo/projeto", "EXECUTIVE_READ"], ["/engenharia-obra", "ENGINEERING_READ"],
    ["/financeiro", "FINANCIAL_READ"], ["/comercial/cliente/externo", "COMMERCIAL_READ"],
    ["/assistente", "AI_READ"], ["/ajuda", "HELP_READ"],
  ] as const)("mapeia %s para %s", (path, capability) => {
    expect(protectedReadCapabilityForPath(path)).toBe(capability);
  });

  it("leva cada papel à primeira área autorizada", () => {
    expect(defaultWorkspacePathForRole("OWNER")).toBe("/executivo");
    expect(defaultWorkspacePathForRole("VIEWER")).toBe("/viabilidade");
  });

  it("nega ao VIEWER o workspace legado que agrega domínios protegidos", () => {
    expect(() => assertLegacyWorkspaceRead("VIEWER")).toThrow("Seu perfil não possui acesso a estes dados.");
    expect(() => assertLegacyWorkspaceRead("REVIEWER")).not.toThrow();
  });
});
