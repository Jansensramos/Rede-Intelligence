import { describe, expect, it } from "vitest";
import type { MembershipRole } from "@prisma/client";
import { assertAiCapability, assertAiUse, hasAiCapability, isAiAccessDeniedError, type AiCapability } from "./rbac";

const ALL_ROLES: MembershipRole[] = ["OWNER", "ADMIN", "ANALYST", "REVIEWER", "VIEWER"];
const ALL_CAPABILITIES: AiCapability[] = ["AI_USE", "AI_ADMIN", "AI_BUDGET_READ", "AI_BUDGET_MANAGE", "AI_AUDIT_READ"];

const EXPECTED: Record<AiCapability, MembershipRole[]> = {
  AI_USE: ["OWNER", "ADMIN", "ANALYST", "REVIEWER"],
  AI_ADMIN: ["OWNER"],
  AI_BUDGET_READ: ["OWNER", "ADMIN"],
  AI_BUDGET_MANAGE: ["OWNER"],
  AI_AUDIT_READ: ["OWNER", "ADMIN", "REVIEWER"],
};

describe("matriz RBAC de IA (decisao 11) — todas as combinacoes papel x capacidade", () => {
  for (const capability of ALL_CAPABILITIES) {
    for (const role of ALL_ROLES) {
      const expected = EXPECTED[capability].includes(role);
      it(`${role} ${expected ? "TEM" : "NAO tem"} ${capability}`, () => {
        expect(hasAiCapability(role, capability)).toBe(expected);
      });
    }
  }

  it("VIEWER nunca possui nenhuma capacidade de IA", () => {
    for (const capability of ALL_CAPABILITIES) expect(hasAiCapability("VIEWER", capability)).toBe(false);
  });

  it("assertAiCapability lanca AiAccessDeniedError quando o papel nao tem a capacidade", () => {
    expect(() => assertAiCapability("VIEWER", "AI_USE")).toThrow();
    try { assertAiCapability("VIEWER", "AI_USE"); } catch (error) { expect(isAiAccessDeniedError(error)).toBe(true); }
  });
});

describe("assertAiUse — AI_USE sempre acumula a capacidade do dominio (decisao 12)", () => {
  it("ANALYST com AI_USE e FINANCIAL_READ passa", () => {
    expect(() => assertAiUse({ role: "ANALYST" }, "FINANCIAL_READ")).not.toThrow();
  });

  it("VIEWER nunca passa, mesmo tendo a capacidade de leitura do dominio", () => {
    expect(() => assertAiUse({ role: "VIEWER" }, "VIABILITY_READ")).toThrow();
  });

  it("ANALYST tem AI_USE mas nao FINANCIAL_READ especificamente bloqueado nao existe hoje (todas as roles nao-VIEWER tem full read) — o teste real e a combinacao correta nao falhar", () => {
    expect(() => assertAiUse({ role: "REVIEWER" }, "LEGAL_READ")).not.toThrow();
  });

  it("sem capacidade de dominio informada, so exige AI_USE", () => {
    expect(() => assertAiUse({ role: "ANALYST" })).not.toThrow();
    expect(() => assertAiUse({ role: "VIEWER" })).toThrow();
  });
});
