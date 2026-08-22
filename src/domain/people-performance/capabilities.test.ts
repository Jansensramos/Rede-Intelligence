import { describe, expect, it } from "vitest";
import { assertPeopleCapability, hasPeopleCapability } from "./capabilities";

describe("capacidades da Fase 9F", () => {
  it("não confunde usuário autenticado com perfil profissional", () => {
    expect(hasPeopleCapability("VIEWER", "PEOPLE_READ")).toBe(true);
    expect(hasPeopleCapability("VIEWER", "PEOPLE_MANAGE")).toBe(false);
  });

  it("restringe remuneração a administrador e proprietário", () => {
    expect(hasPeopleCapability("ANALYST", "COMPENSATION_READ")).toBe(false);
    expect(hasPeopleCapability("ADMIN", "COMPENSATION_READ")).toBe(true);
    expect(hasPeopleCapability("OWNER", "COMPENSATION_MANAGE")).toBe(true);
    expect(() => assertPeopleCapability("REVIEWER", "COMPENSATION_READ")).toThrow(/capacidade/);
  });

  it("separa simulação de aprovação", () => {
    expect(hasPeopleCapability("ANALYST", "INCENTIVE_SIMULATE")).toBe(true);
    expect(hasPeopleCapability("ANALYST", "INCENTIVE_APPROVE")).toBe(false);
    expect(hasPeopleCapability("ADMIN", "INCENTIVE_APPROVE")).toBe(true);
  });
});
