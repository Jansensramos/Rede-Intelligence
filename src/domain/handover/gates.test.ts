import { describe, expect, it } from "vitest";
import { evaluateDeliveryGate, evaluatePostSaleSla, isValidPostSaleRecurrence } from "./gates";

describe("gate de entrega (Fase 9R) — regra pura", () => {
  const acceptedInspection = { id: "insp-1", outcome: "ACCEPTED" as const, nextInspectionAt: null };
  const aptoInput = {
    technical: { mostRecentInspection: acceptedInspection },
    legal: { licenses: [{ id: "lic-1", status: "APPROVED" as const }] },
    financial: { overdueInstallmentCount: 0, pendingDisbursementCount: 0 },
  };

  it("APTO quando os três gates passam", () => {
    const result = evaluateDeliveryGate(aptoInput);
    expect(result.overall).toBe("APTO");
    expect(result.technical.status).toBe("APTO");
    expect(result.legal.status).toBe("APTO");
    expect(result.financial.status).toBe("APTO");
    expect(result.technical.snapshot).toEqual({ inspectionId: "insp-1" });
  });

  // ---------------------------------------------------------------------------
  // Achado Alto da reauditoria 9R: a vistoria mais recente decide, nunca uma
  // aprovação antiga usada como fallback.
  // ---------------------------------------------------------------------------

  it("SEM_EVIDENCIA quando não há nenhuma vistoria registrada — nunca tratado como aprovação", () => {
    const result = evaluateDeliveryGate({ ...aptoInput, technical: { mostRecentInspection: null } });
    expect(result.overall).toBe("BLOQUEADO");
    expect(result.technical.status).toBe("SEM_EVIDENCIA");
    expect(result.technical.snapshot).toEqual({ inspectionId: null });
  });

  it("bloqueia quando a vistoria MAIS RECENTE foi rejeitada, mesmo existindo uma aceita mais antiga no histórico (o chamador já resolveu qual é a mais recente)", () => {
    // O contrato desta função é: o chamador já escolheu a vistoria mais recente
    // (ordenada por scheduledAt/createdAt/id) e passa só ela. Esta regra pura nunca
    // olha para outras vistorias — o teste de integração cobre a escolha da mais
    // recente contra o banco real.
    const result = evaluateDeliveryGate({ ...aptoInput, technical: { mostRecentInspection: { id: "insp-recente", outcome: "REJECTED", nextInspectionAt: null } } });
    expect(result.overall).toBe("BLOQUEADO");
    expect(result.technical.status).toBe("PENDENTE");
    expect(result.technical.snapshot.inspectionId).toBe("insp-recente");
  });

  it("bloqueia quando a vistoria mais recente ainda não tem resultado (outcome nulo — incompleta)", () => {
    const result = evaluateDeliveryGate({ ...aptoInput, technical: { mostRecentInspection: { id: "insp-2", outcome: null, nextInspectionAt: null } } });
    expect(result.overall).toBe("BLOQUEADO");
    expect(result.technical.status).toBe("PENDENTE");
  });

  it("ACCEPTED_WITH_PENDING libera quando não há reinspeção de acompanhamento em aberto", () => {
    const result = evaluateDeliveryGate({ ...aptoInput, technical: { mostRecentInspection: { id: "insp-3", outcome: "ACCEPTED_WITH_PENDING", nextInspectionAt: null } } });
    expect(result.technical.status).toBe("APTO");
  });

  it("ACCEPTED_WITH_PENDING bloqueia quando há reinspeção de acompanhamento ainda em aberto (pendência impeditiva não encerrada)", () => {
    const result = evaluateDeliveryGate({ ...aptoInput, technical: { mostRecentInspection: { id: "insp-4", outcome: "ACCEPTED_WITH_PENDING", nextInspectionAt: new Date("2099-01-01") } } });
    expect(result.overall).toBe("BLOQUEADO");
    expect(result.technical.status).toBe("PENDENTE");
  });

  // ---------------------------------------------------------------------------

  it("SEM_EVIDENCIA quando não há nenhuma licença 9D cadastrada — nunca tratado como aprovação", () => {
    const result = evaluateDeliveryGate({ ...aptoInput, legal: { licenses: [] } });
    expect(result.overall).toBe("BLOQUEADO");
    expect(result.legal.status).toBe("SEM_EVIDENCIA");
    expect(result.legal.snapshot).toEqual({ licenseCount: 0, blockingCount: 0, blockingLicenseIds: [] });
  });

  it.each([
    "NOT_STARTED", "IN_PREPARATION", "SUBMITTED", "UNDER_REVIEW", "REJECTED", "SUSPENDED", "EXPIRED", "RENEWAL_REQUIRED",
  ] as const)("bloqueia com licença em status %s", (status) => {
    const result = evaluateDeliveryGate({ ...aptoInput, legal: { licenses: [{ id: "lic-1", status }] } });
    expect(result.overall).toBe("BLOQUEADO");
    expect(result.legal.status).toBe("PENDENTE");
    expect(result.legal.snapshot.blockingLicenseIds).toEqual(["lic-1"]);
  });

  it("APROVED_WITH_CONDITIONS conta como apto (mesma semântica de PROCEED_WITH_CONDITIONS já usada em outros domínios)", () => {
    const result = evaluateDeliveryGate({ ...aptoInput, legal: { licenses: [{ id: "lic-1", status: "APPROVED_WITH_CONDITIONS" as const }] } });
    expect(result.legal.status).toBe("APTO");
  });

  it("uma licença bloqueante entre várias aprovadas ainda bloqueia (snapshot lista só a bloqueante)", () => {
    const result = evaluateDeliveryGate({
      ...aptoInput,
      legal: { licenses: [{ id: "lic-ok", status: "APPROVED" as const }, { id: "lic-bad", status: "REJECTED" as const }] },
    });
    expect(result.legal.status).toBe("PENDENTE");
    expect(result.legal.snapshot).toEqual({ licenseCount: 2, blockingCount: 1, blockingLicenseIds: ["lic-bad"] });
  });

  it("bloqueia com parcela vencida", () => {
    const result = evaluateDeliveryGate({ ...aptoInput, financial: { overdueInstallmentCount: 2, pendingDisbursementCount: 0 } });
    expect(result.overall).toBe("BLOQUEADO");
    expect(result.financial.status).toBe("PENDENTE");
    expect(result.financial.reason).toContain("2 parcela(s)");
  });

  it("bloqueia com repasse bancário não conciliado", () => {
    const result = evaluateDeliveryGate({ ...aptoInput, financial: { overdueInstallmentCount: 0, pendingDisbursementCount: 1 } });
    expect(result.overall).toBe("BLOQUEADO");
    expect(result.financial.status).toBe("PENDENTE");
    expect(result.financial.reason).toContain("repasse");
  });

  it("nunca é APTO por engano quando qualquer um dos três estiver ruim, mesmo os outros dois OK", () => {
    const onlyTechnicalBad = evaluateDeliveryGate({ ...aptoInput, technical: { mostRecentInspection: null } });
    const onlyLegalBad = evaluateDeliveryGate({ ...aptoInput, legal: { licenses: [] } });
    const onlyFinancialBad = evaluateDeliveryGate({ ...aptoInput, financial: { overdueInstallmentCount: 1, pendingDisbursementCount: 0 } });
    expect([onlyTechnicalBad, onlyLegalBad, onlyFinancialBad].every((result) => result.overall === "BLOQUEADO")).toBe(true);
  });

  // Combinatória completa: as 7 combinações incompletas bloqueiam, só a 8ª (todos OK) libera.
  it("varre as 8 combinações de bom/ruim entre os 3 gates — só a combinação 3x boa libera", () => {
    const good = { technical: acceptedInspection, legal: [{ id: "lic-1", status: "APPROVED" as const }], financialOverdue: 0 };
    const bad = { technical: null, legal: [] as { id: string; status: "APPROVED" }[], financialOverdue: 1 };
    const combos: boolean[][] = [];
    for (let i = 0; i < 8; i += 1) combos.push([Boolean(i & 1), Boolean(i & 2), Boolean(i & 4)]);
    for (const [t, l, f] of combos) {
      const result = evaluateDeliveryGate({
        technical: { mostRecentInspection: t ? good.technical : bad.technical },
        legal: { licenses: t2licenses(l) },
        financial: { overdueInstallmentCount: f ? 0 : 1, pendingDisbursementCount: 0 },
      });
      const allGood = t && l && f;
      expect(result.overall).toBe(allGood ? "APTO" : "BLOQUEADO");
    }
    function t2licenses(ok: boolean) { return ok ? good.legal : bad.legal; }
  });
});

describe("SLA de assistência técnica (Fase 9R) — sempre derivado, nunca persistido", () => {
  const now = new Date("2026-09-10T12:00:00.000Z");

  it("não violado sem slaDueAt", () => {
    expect(evaluatePostSaleSla({ slaDueAt: null, status: "OPEN", now }).violated).toBe(false);
  });

  it("violado quando slaDueAt está no passado e o chamado continua aberto", () => {
    expect(evaluatePostSaleSla({ slaDueAt: new Date("2026-09-01T00:00:00.000Z"), status: "OPEN", now }).violated).toBe(true);
    expect(evaluatePostSaleSla({ slaDueAt: new Date("2026-09-01T00:00:00.000Z"), status: "IN_PROGRESS", now }).violated).toBe(true);
    expect(evaluatePostSaleSla({ slaDueAt: new Date("2026-09-01T00:00:00.000Z"), status: "WAITING_CUSTOMER", now }).violated).toBe(true);
  });

  it("não violado quando o chamado já foi resolvido/encerrado, mesmo com prazo vencido", () => {
    expect(evaluatePostSaleSla({ slaDueAt: new Date("2026-09-01T00:00:00.000Z"), status: "RESOLVED", now }).violated).toBe(false);
    expect(evaluatePostSaleSla({ slaDueAt: new Date("2026-09-01T00:00:00.000Z"), status: "CLOSED", now }).violated).toBe(false);
  });

  it("não violado quando o prazo ainda não chegou", () => {
    expect(evaluatePostSaleSla({ slaDueAt: new Date("2026-09-20T00:00:00.000Z"), status: "OPEN", now }).violated).toBe(false);
  });
});

describe("reincidência de assistência técnica (Fase 9R) — nunca autorreferente, sempre mesma unidade", () => {
  it("válida quando é outro chamado da mesma unidade", () => {
    const result = isValidPostSaleRecurrence({ currentId: "r2", currentSalesUnitId: "u1", previousId: "r1", previousSalesUnitId: "u1" });
    expect(result.valid).toBe(true);
  });
  it("inválida quando referencia a si mesmo", () => {
    const result = isValidPostSaleRecurrence({ currentId: "r1", currentSalesUnitId: "u1", previousId: "r1", previousSalesUnitId: "u1" });
    expect(result.valid).toBe(false);
  });
  it("inválida quando a unidade é diferente", () => {
    const result = isValidPostSaleRecurrence({ currentId: "r2", currentSalesUnitId: "u1", previousId: "r1", previousSalesUnitId: "u2" });
    expect(result.valid).toBe(false);
  });
});
