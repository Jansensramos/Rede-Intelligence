import { describe, expect, it } from "vitest";
import { buildResolvedApprovalExceptions, buildResolvedFinancialExceptions, buildResolvedLegalExceptions } from "./resolved-actions";
import { buildLegalExceptions, type ExceptionTenantContext } from "./exception-builders";
import { buildExceptionId } from "./exceptions";

const ctx: ExceptionTenantContext = { organizationId: "org-1", companyId: "company-1", economicGroupId: "group-1", projectId: "project-1", projectName: "START BUTANTÃ" };
const referenceDate = new Date("2026-08-25T00:00:00.000Z");
const days = (n: number) => new Date(referenceDate.getTime() + n * 86_400_000);

describe("buildResolvedLegalExceptions (9K.3 — RESOLVIDA a partir de LegalObligation.fulfilledAt real)", () => {
  it("emite status RESOLVIDA com resolvedAt igual ao fulfilledAt real da origem, nunca um carimbo de UX", () => {
    const fulfilledAt = days(-2);
    const [result] = buildResolvedLegalExceptions(ctx, [{ id: "obl-1", code: "LEG-1", title: "Emolumento", fulfilledAt, amount: 12000, responsibleId: "user-1" }]);
    expect(result.status).toBe("RESOLVIDA");
    expect(result.resolvedAt).toBe(fulfilledAt.toISOString());
    expect(result.occurredAt).toBe(fulfilledAt.toISOString());
    expect(result.severity).toBe("NORMAL");
    expect(result.responsibleId).toBe("user-1");
    expect(result.evidence).toEqual(["LEG-1"]);
  });

  it("nunca inventa responsável quando a origem não tem um", () => {
    const [result] = buildResolvedLegalExceptions(ctx, [{ id: "obl-2", code: "LEG-2", title: "X", fulfilledAt: days(-1), amount: null, responsibleId: null }]);
    expect(result.responsibleId).toBeNull();
  });

  it("idempotência: mesma origem recomputada duas vezes produz o mesmo id", () => {
    const signal = { id: "obl-3", code: "LEG-3", title: "Y", fulfilledAt: days(-1), amount: 100 };
    const a = buildResolvedLegalExceptions(ctx, [signal])[0];
    const b = buildResolvedLegalExceptions(ctx, [signal])[0];
    expect(a.id).toBe(b.id);
  });

  it("id do lado RESOLVIDA nunca colide com o id do lado ABERTA para o mesmo registro (tipos diferentes)", () => {
    const openId = buildLegalExceptions(ctx, [{ id: "obl-4", code: "LEG-4", title: "Z", dueAt: days(-1), amount: 100 }], [], referenceDate)[0]?.id;
    const resolvedId = buildResolvedLegalExceptions(ctx, [{ id: "obl-4", code: "LEG-4", title: "Z", fulfilledAt: days(-1), amount: 100 }])[0].id;
    expect(openId).not.toBe(resolvedId);
    expect(resolvedId).toBe(buildExceptionId("org-1", "legal", "obligation_fulfilled", "obl-4"));
  });
});

describe("buildResolvedFinancialExceptions (9K.3 — RESOLVIDA a partir do pagamento/recebimento real)", () => {
  it("pagável concluído usa o timestamp real de liquidação, não uma data fabricada", () => {
    const paidAt = days(-3);
    const [result] = buildResolvedFinancialExceptions(ctx, [{ id: "pay-1", description: "Boleto", counterpartyName: "Fornecedor X", amount: 5000, completedAt: paidAt, responsibleId: "user-2" }], []);
    expect(result.type).toBe("payable_paid");
    expect(result.resolvedAt).toBe(paidAt.toISOString());
    expect(result.status).toBe("RESOLVIDA");
    expect(result.materialityValue).toBe(5000);
  });

  it("recebível e pagável concluídos não se confundem no tipo", () => {
    const result = buildResolvedFinancialExceptions(
      ctx,
      [{ id: "pay-2", description: "A pagar", counterpartyName: null, amount: 10, completedAt: days(-1) }],
      [{ id: "rec-1", description: "A receber", counterpartyName: null, amount: 20, completedAt: days(-1) }],
    );
    expect(result.find((item) => item.id.includes("pay-2"))?.type).toBe("payable_paid");
    expect(result.find((item) => item.id.includes("rec-1"))?.type).toBe("receivable_received");
  });
});

describe("buildResolvedApprovalExceptions (9K.3 — RESOLVIDA a partir de ApprovalRequest concluída)", () => {
  it("aprovação decidida (aprovada) nunca tem responsável inventado e carrega a alçada quando existir", () => {
    const completedAt = days(-1);
    const [result] = buildResolvedApprovalExceptions("org-1", [{ id: "req-1", actType: "PURCHASE_ORDER_ISSUE", entityType: "PURCHASE_ORDER", amount: 90000, completedAt, decision: "APPROVED", projectId: "project-1", projectName: "START BUTANTÃ", requiredRole: "ADMIN" }]);
    expect(result.status).toBe("RESOLVIDA");
    expect(result.resolvedAt).toBe(completedAt.toISOString());
    expect(result.responsibleId).toBeUndefined();
    expect(result.approvalCapability).toEqual({ requiredRole: "ADMIN" });
    expect(result.title).toContain("aprovada");
  });

  it("aprovação rejeitada usa rótulo distinto e mesma severidade NORMAL (não é mais um alerta acionável)", () => {
    const [result] = buildResolvedApprovalExceptions("org-1", [{ id: "req-2", actType: "SALE_APPROVE", entityType: "SALE", amount: 1000, completedAt: days(-1), decision: "REJECTED", projectId: null, projectName: null }]);
    expect(result.title).toContain("rejeitada");
    expect(result.severity).toBe("NORMAL");
    expect(result.approvalCapability).toBeNull();
  });
});
