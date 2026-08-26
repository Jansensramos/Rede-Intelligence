import { describe, expect, it } from "vitest";
import type { MembershipRole } from "@prisma/client";
import { ALL_EXECUTIVE_DOMAINS, authorizedExecutiveDomains, canViewExecutiveDomain } from "./executive-capabilities";

const ALL_ROLES: MembershipRole[] = ["VIEWER", "REVIEWER", "ANALYST", "ADMIN", "OWNER"];

describe("canViewExecutiveDomain (9K.2, fechamento — gate 2 RBAC/capabilities)", () => {
  it("VIEWER não vê Financeiro, Jurídico, Comercial nem Suprimentos", () => {
    expect(canViewExecutiveDomain("VIEWER", "financial")).toBe(false);
    expect(canViewExecutiveDomain("VIEWER", "legal")).toBe(false);
    expect(canViewExecutiveDomain("VIEWER", "sales")).toBe(false);
    expect(canViewExecutiveDomain("VIEWER", "procurement")).toBe(false);
  });

  it("ANALYST, REVIEWER, ADMIN e OWNER veem Financeiro, Jurídico, Comercial e Suprimentos", () => {
    for (const role of ["ANALYST", "REVIEWER", "ADMIN", "OWNER"] as const) {
      expect(canViewExecutiveDomain(role, "financial")).toBe(true);
      expect(canViewExecutiveDomain(role, "legal")).toBe(true);
      expect(canViewExecutiveDomain(role, "sales")).toBe(true);
      expect(canViewExecutiveDomain(role, "procurement")).toBe(true);
    }
  });

  it("Decisões/Aprovações exigem alçada de gestor/admin (mesma WORKSPACE_APPROVE já existente)", () => {
    expect(canViewExecutiveDomain("VIEWER", "approvals")).toBe(false);
    expect(canViewExecutiveDomain("ANALYST", "approvals")).toBe(false);
    expect(canViewExecutiveDomain("REVIEWER", "approvals")).toBe(false);
    expect(canViewExecutiveDomain("ADMIN", "approvals")).toBe(true);
    expect(canViewExecutiveDomain("OWNER", "approvals")).toBe(true);
  });

  it("Contabilidade delega para ACCOUNTING_VIEW já existente (hoje universal para todo papel)", () => {
    for (const role of ALL_ROLES) expect(canViewExecutiveDomain(role, "accounting")).toBe(true);
  });

  it("Integrações delega para INTEGRATION_VIEW já existente (hoje universal para todo papel)", () => {
    for (const role of ALL_ROLES) expect(canViewExecutiveDomain(role, "integrations")).toBe(true);
  });

  it("Capital & Funding delega para CAPITAL_VIEW (9N) — VIEWER só enxerga, nunca aprova/edita", () => {
    for (const role of ALL_ROLES) expect(canViewExecutiveDomain(role, "capital")).toBe(true);
  });

  it("Viabilidade e Obra/Engenharia não têm gate de leitura (mesma política das telas de módulo hoje)", () => {
    for (const role of ALL_ROLES) {
      expect(canViewExecutiveDomain(role, "viability")).toBe(true);
      expect(canViewExecutiveDomain(role, "operations")).toBe(true);
    }
  });

  it("cobre exatamente os domínios usados pela Gestão Executiva, sem faltar nenhum", () => {
    for (const domain of ALL_EXECUTIVE_DOMAINS) expect(() => canViewExecutiveDomain("OWNER", domain)).not.toThrow();
  });
});

describe("authorizedExecutiveDomains", () => {
  it("VIEWER só recebe os domínios sem gate (viability, operations, accounting, integrations, capital)", () => {
    const allowed = authorizedExecutiveDomains("VIEWER");
    expect([...allowed].sort()).toEqual(["accounting", "capital", "integrations", "operations", "viability"].sort());
  });

  it("OWNER recebe todos os domínios", () => {
    const allowed = authorizedExecutiveDomains("OWNER");
    expect(allowed.size).toBe(ALL_EXECUTIVE_DOMAINS.length);
  });
});
