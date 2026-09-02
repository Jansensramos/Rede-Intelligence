import { describe, expect, it } from "vitest";
import { decideLoginOrganization } from "./organization-selection";

const membership = (organizationId: string, name = organizationId) => ({ organizationId, organization: { name } });

describe("seleção organizacional no login", () => {
  it("seleciona diretamente a única organização ativa", () => {
    expect(decideLoginOrganization([membership("org-a")], "")).toMatchObject({ kind: "SELECTED", membership: { organizationId: "org-a" } });
  });

  it("exige seleção explícita quando há múltiplas organizações", () => {
    expect(decideLoginOrganization([membership("org-a"), membership("org-b")], "")).toEqual({
      kind: "SELECTION_REQUIRED",
      organizations: [{ id: "org-a", name: "org-a" }, { id: "org-b", name: "org-b" }],
    });
  });

  it("aceita somente uma organização presente nos memberships ativos do usuário", () => {
    expect(decideLoginOrganization([membership("org-a"), membership("org-b")], "org-b")).toMatchObject({ kind: "SELECTED", membership: { organizationId: "org-b" } });
    expect(decideLoginOrganization([membership("org-a")], "org-de-outro-usuario")).toEqual({ kind: "REJECTED" });
  });

  it("rejeita usuário sem membership", () => {
    expect(decideLoginOrganization([], "")).toEqual({ kind: "REJECTED" });
  });
});
