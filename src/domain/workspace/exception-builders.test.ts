import { describe, expect, it } from "vitest";
import {
  buildApprovalExceptions,
  buildBudgetVarianceExceptions,
  buildCommercialClosingExceptions,
  buildFinancialExceptions,
  buildIntegrationExceptions,
  buildLegalExceptions,
  buildProcurementExceptions,
  buildSalesExceptions,
  buildViabilityExceptions,
  type ExceptionTenantContext,
} from "./exception-builders";

const ctx: ExceptionTenantContext = { organizationId: "org-1", companyId: "company-1", economicGroupId: "group-1", projectId: "project-1", projectName: "START BUTANTÃ" };
const referenceDate = new Date("2026-08-25T00:00:00.000Z");
const days = (n: number) => new Date(referenceDate.getTime() + n * 86_400_000);

describe("buildLegalExceptions (plano §7 JURÍDICO — via mapLegalAlertSeverity, sem consultar LegalAlert)", () => {
  it("obrigação vencida vira CRITICO com materialidade = valor da obrigação", () => {
    const [result] = buildLegalExceptions(ctx, [{ id: "obl-1", code: "LEG-1", title: "Emolumento", dueAt: days(-5), amount: 12000 }], [], referenceDate);
    expect(result.severity).toBe("CRITICO");
    expect(result.materialityValue).toBe(12000);
    expect(result.href).toBe("/juridico");
    expect(result.projectId).toBe("project-1");
    expect(result.dueDate).toBe(days(-5).toISOString());
  });

  it("obrigação fora de qualquer marco de prazo (D-90 não atingido) não vira exceção", () => {
    const result = buildLegalExceptions(ctx, [{ id: "obl-2", code: "LEG-2", title: "Distante", dueAt: days(200), amount: null }], [], referenceDate);
    expect(result).toHaveLength(0);
  });

  it("licença vencendo em D-7 vira CRITICO; licença em D-85 (marco D-90/MEDIUM) vira AÇÃO_NECESSARIA", () => {
    // A régua oficial (DEFAULT_LEGAL_MILESTONES) não tem nenhum marco de criticidade LOW — o menor
    // marco existente (D-90) já é MEDIUM, que mapLegalAlertSeverity traduz para AÇÃO_NECESSARIA.
    // ATENÇÃO nesta fonte é, portanto, inatingível por desenho; o teste documenta esse fato.
    const soon = buildLegalExceptions(ctx, [], [{ id: "lic-1", code: "LIC-1", title: "Alvará", expiresAt: days(5) }], referenceDate);
    const far = buildLegalExceptions(ctx, [], [{ id: "lic-2", code: "LIC-2", title: "Habite-se", expiresAt: days(85) }], referenceDate);
    expect(soon[0].severity).toBe("CRITICO");
    expect(far[0].severity).toBe("ACAO_NECESSARIA");
  });

  it("cada exceção carrega organizationId/companyId/projectId para isolamento multi-tenant", () => {
    const [result] = buildLegalExceptions(ctx, [{ id: "obl-3", code: "LEG-3", title: "X", dueAt: days(-1), amount: null }], [], referenceDate);
    expect(result.organizationId).toBe("org-1");
    expect(result.companyId).toBe("company-1");
    expect(result.economicGroupId).toBe("group-1");
  });
});

describe("buildFinancialExceptions (plano §7 FINANCEIRO — via classifyDueSeverity)", () => {
  it("parcela com saldo zerado não vira exceção mesmo se vencida (já foi paga/baixada)", () => {
    const result = buildFinancialExceptions(ctx, [{ id: "p-1", description: "Boleto", counterpartyName: "Fornecedor X", dueDate: days(-10), balance: 0 }], [], referenceDate);
    expect(result).toHaveLength(0);
  });

  it("parcela vencida com saldo em aberto vira CRITICO com valor de materialidade = saldo", () => {
    const [result] = buildFinancialExceptions(ctx, [{ id: "p-2", description: "Boleto", counterpartyName: "Fornecedor Y", dueDate: days(-2), balance: 5000 }], [], referenceDate);
    expect(result.severity).toBe("CRITICO");
    expect(result.materialityValue).toBe(5000);
    expect(result.domain).toBe("financial");
    expect(result.href).toBe("/financeiro");
  });

  it("parcela que vence em 20 dias não é exceção (fora da janela de alerta de 3 dias)", () => {
    const result = buildFinancialExceptions(ctx, [{ id: "p-3", description: "Boleto", counterpartyName: null, dueDate: days(20), balance: 100 }], [], referenceDate);
    expect(result).toHaveLength(0);
  });

  it("recebível e pagável não se confundem no tipo/domínio", () => {
    const result = buildFinancialExceptions(ctx, [{ id: "p-4", description: "A pagar", counterpartyName: null, dueDate: days(-1), balance: 10 }], [{ id: "r-1", description: "A receber", counterpartyName: null, dueDate: days(-1), balance: 20 }], referenceDate);
    expect(result.find((item) => item.id.includes("p-4"))?.type).toBe("payable_due");
    expect(result.find((item) => item.id.includes("r-1"))?.type).toBe("receivable_due");
  });
});

describe("buildSalesExceptions (plano §7 COMERCIAL)", () => {
  it("recebível de venda vencido sempre vira exceção (severidade fixa AÇÃO_NECESSARIA)", () => {
    const [result] = buildSalesExceptions(ctx, [{ id: "sr-1", description: "Parcela 3/12", counterpartyName: "Cliente Z", dueDate: days(-30), balance: 8000 }], referenceDate);
    expect(result.severity).toBe("ACAO_NECESSARIA");
    expect(result.materialityValue).toBe(8000);
    expect(result.href).toBe("/comercial");
  });

  it("saldo zerado não gera exceção", () => {
    expect(buildSalesExceptions(ctx, [{ id: "sr-2", description: "Quitada", counterpartyName: null, dueDate: days(-30), balance: 0 }], referenceDate)).toHaveLength(0);
  });
});

describe("buildCommercialClosingExceptions (Fase 9K.4, plano item G — crédito/contrato/assinatura são fatos reais, não uma segunda central)", () => {
  const empty = { pendingApprovalSales: [], creditReviewRequired: [], signaturePending: [], signatureFailed: [] };

  it("venda em rascunho vira sale_awaiting_approval com responsibleId = quem criou", () => {
    const [result] = buildCommercialClosingExceptions(ctx, { ...empty, pendingApprovalSales: [{ id: "sale-1", unitCode: "UN-101", soldPrice: 500000, responsibleId: "user-1", createdAt: days(-2) }] }, referenceDate);
    expect(result.type).toBe("sale_awaiting_approval");
    expect(result.responsibleId).toBe("user-1");
    expect(result.materialityValue).toBe(500000);
    expect(result.href).toBe("/comercial");
  });

  it("crédito REQUER_ANALISE vira credit_review_required, nunca decide a venda sozinho (sem status de aprovação no campo)", () => {
    const [result] = buildCommercialClosingExceptions(ctx, { ...empty, creditReviewRequired: [{ id: "credit-1", customerName: "Maria Silva", responsibleId: "user-2", requestedAt: days(-1) }] }, referenceDate);
    expect(result.type).toBe("credit_review_required");
    expect(result.title).toContain("Maria Silva");
    expect(result.responsibleId).toBe("user-2");
  });

  it("assinatura pendente há mais de 7 dias vira ACAO_NECESSARIA; recente vira ATENCAO", () => {
    const [old] = buildCommercialClosingExceptions(ctx, { ...empty, signaturePending: [{ id: "sig-1", contractNumber: "CV-1", responsibleId: "user-3", dueDate: days(-10) }] }, referenceDate);
    const [recent] = buildCommercialClosingExceptions(ctx, { ...empty, signaturePending: [{ id: "sig-2", contractNumber: "CV-2", responsibleId: "user-3", dueDate: days(-1) }] }, referenceDate);
    expect(old.severity).toBe("ACAO_NECESSARIA");
    expect(recent.severity).toBe("ATENCAO");
  });

  it("assinatura recusada e assinatura com erro viram signature_failed distintos", () => {
    const results = buildCommercialClosingExceptions(ctx, { ...empty, signatureFailed: [
      { id: "sig-3", contractNumber: "CV-3", responsibleId: "user-4", status: "RECUSADO", errorMessage: null, updatedAt: days(0) },
      { id: "sig-4", contractNumber: "CV-4", responsibleId: "user-4", status: "ERRO", errorMessage: "timeout do provider", updatedAt: days(0) },
    ] }, referenceDate);
    expect(results).toHaveLength(2);
    expect(results[0].title).toContain("recusada");
    expect(results[1].summary).toBe("timeout do provider");
  });

  it("sem nenhum sinal, não gera exceção nenhuma", () => {
    expect(buildCommercialClosingExceptions(ctx, empty, referenceDate)).toHaveLength(0);
  });
});

describe("buildProcurementExceptions (plano §7 SUPRIMENTOS — via isCriticalPurchase)", () => {
  it("necessidade cujo prazo de contratação já venceu vira exceção", () => {
    const [result] = buildProcurementExceptions(ctx, [{ id: "need-1", code: "NEC-1", description: "Aço CA-50", requiredAt: days(5), expectedLeadDays: 30, bufferDays: 7 }], referenceDate);
    expect(result.severity).toBe("ACAO_NECESSARIA");
    expect(result.impact?.schedule).toBe(true);
    expect(result.href).toBe("/suprimentos");
  });

  it("necessidade com prazo confortável não vira exceção", () => {
    const result = buildProcurementExceptions(ctx, [{ id: "need-2", code: "NEC-2", description: "Cimento", requiredAt: days(120), expectedLeadDays: 15, bufferDays: 5 }], referenceDate);
    expect(result).toHaveLength(0);
  });
});

describe("buildBudgetVarianceExceptions (plano §7 OBRA/ECONÔMICO — via MaterialityPolicy)", () => {
  it("categoria classificada INFORMATIVO pela política não vira exceção (não inflar alerta)", () => {
    const result = buildBudgetVarianceExceptions(ctx, [{ category: "Fundações", baseline: 100000, budget: 100500, difference: 500, percentage: 0.005, level: "INFORMATIVO" }], referenceDate);
    expect(result).toHaveLength(0);
  });

  it("categoria CRITICO pela política vira exceção CRITICO com materialidade = diferença absoluta", () => {
    const [result] = buildBudgetVarianceExceptions(ctx, [{ category: "Estrutura", baseline: 1_000_000, budget: 1_150_000, difference: 150_000, percentage: 0.15, level: "CRITICO" }], referenceDate);
    expect(result.severity).toBe("CRITICO");
    expect(result.materialityValue).toBe(150_000);
  });
});

describe("buildIntegrationExceptions (plano §7 INTEGRAÇÕES — escopo organização, não por projeto)", () => {
  it("instalação saudável não vira exceção", () => {
    const result = buildIntegrationExceptions("org-1", [{ id: "inst-1", name: "Sienge", scopeLabel: "Empresa X", lastSyncAt: referenceDate, credentialExpiresAt: null, installationStatus: "ACTIVE", healthStatus: "HEALTHY", credentialStatus: "ACTIVE", stale: false }], referenceDate);
    expect(result).toHaveLength(0);
  });

  it("instalação com credencial expirada vira CRITICO", () => {
    const [result] = buildIntegrationExceptions("org-1", [{ id: "inst-2", name: "Banco Y", scopeLabel: "Grupo Z", lastSyncAt: referenceDate, credentialExpiresAt: days(-1), installationStatus: "ACTIVE", healthStatus: "HEALTHY", credentialStatus: "EXPIRED", stale: false }], referenceDate);
    expect(result.severity).toBe("CRITICO");
    expect(result.source).toBe("Banco Y");
  });

  it("resultado não tem projectId (o domínio é organizacional, não deve fingir escopo de projeto)", () => {
    const [result] = buildIntegrationExceptions("org-1", [{ id: "inst-3", name: "CRM", scopeLabel: "X", lastSyncAt: null, credentialExpiresAt: null, installationStatus: "ERROR", healthStatus: "DOWN", credentialStatus: "ERROR", stale: true }], referenceDate);
    expect(result.projectId).toBeUndefined();
  });
});

describe("buildViabilityExceptions (plano §12 — motor de risco pré-investimento, achado estrutural excluído)", () => {
  it("achado crítico vira exceção CRITICO", () => {
    const [result] = buildViabilityExceptions(ctx, [{ id: "policy-margin", severity: "critical", title: "Margem abaixo da política", evidence: "Margem de 8% contra mínimo de 12%." }], referenceDate);
    expect(result.severity).toBe("CRITICO");
    expect(result.href).toBe("/viabilidade?f=risks");
  });

  it("achado positivo não vira exceção", () => {
    expect(buildViabilityExceptions(ctx, [{ id: "policy-margin-ok", severity: "positive", title: "Margem ok", evidence: "" }], referenceDate)).toHaveLength(0);
  });

  it("achado estrutural 'model-gaps' é sempre excluído (limitação do motor, não sinal do projeto)", () => {
    expect(buildViabilityExceptions(ctx, [{ id: "model-gaps", severity: "warning", title: "Riscos não modelados", evidence: "" }], referenceDate)).toHaveLength(0);
  });
});

describe("buildApprovalExceptions (plano §12 — reaproveita ApprovalRequest, nunca cria workflow paralelo)", () => {
  it("toda aprovação pendente vira severidade DECISAO", () => {
    const [result] = buildApprovalExceptions("org-1", [{ id: "req-1", actType: "SALE_DISCOUNT", entityType: "SALE", amount: 25000, requestedAt: referenceDate, projectId: "project-1", projectName: "START BUTANTÃ" }], referenceDate);
    expect(result.severity).toBe("DECISAO");
    expect(result.href).toBe("/comercial");
  });
});
