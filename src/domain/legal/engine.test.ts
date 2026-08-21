import { describe, expect, it } from "vitest";
import { daysUntil, legalReadiness, milestonesReached, obligationStatus } from "./engine";

describe("motor jurídico determinístico", () => {
  const today = new Date("2026-08-21T12:00:00.000Z");
  it("classifica vencimentos sem depender de horário local", () => {
    expect(daysUntil(new Date("2026-08-28"), today)).toBe(7);
    expect(obligationStatus(new Date("2026-08-20"), "ACTIVE", today)).toBe("OVERDUE");
    expect(obligationStatus(new Date("2026-09-10"), "ACTIVE", today)).toBe("DUE_SOON");
  });
  it("emite marcos configuráveis incluindo vencido", () => {
    expect(milestonesReached(new Date("2026-08-28"), today).map((item) => item.code)).toContain("D-7");
    expect(milestonesReached(new Date("2026-08-20"), today).map((item) => item.code)).toEqual(["VENCIDO"]);
  });
  it("bloqueia prontidão por achado crítico ou obrigação vencida", () => {
    const result = legalReadiness({ checklist: [{ status: "COMPLIANT", criticality: "HIGH" }], findings: [{ status: "UNDER_REVIEW", severity: "CRITICAL" }], obligations: [{ status: "OVERDUE" }] });
    expect(result.ready).toBe(false);
    expect(result.score).toBe(70);
  });
});
