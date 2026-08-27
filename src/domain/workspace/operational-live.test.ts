import { describe, expect, it } from "vitest";
import type { ExecutiveException } from "./exceptions";
import {
  actionToOperationalEvent,
  buildDailyOperationalSummary,
  deriveOperationalActions,
  enrichOperationalAction,
  isAutomaticExecutionAllowed,
  sortRoutinePriority,
} from "./operational-live";

const referenceDate = new Date("2026-08-27T12:00:00.000Z");
const days = (offset: number) => new Date(referenceDate.getTime() + offset * 86_400_000).toISOString();

function action(overrides: Partial<ExecutiveException> = {}): ExecutiveException {
  return {
    id: "org-1:financial:payable_due:installment-1",
    organizationId: "org-1",
    projectId: "project-1",
    projectName: "START BUTANTÃ",
    domain: "financial",
    type: "payable_due",
    title: "Conta a pagar vencida",
    summary: "Fornecedor · R$ 10.000",
    severity: "CRITICO",
    impact: { financial: 10_000 },
    materialityValue: 10_000,
    dueDate: days(-1),
    confidence: "ALTA",
    source: "REDE",
    occurredAt: referenceDate.toISOString(),
    href: "/financeiro",
    reason: "Saldo em aberto vencido.",
    status: "ABERTA",
    evidence: ["installment-1"],
    ...overrides,
  };
}

describe("evento operacional canônico", () => {
  it("aponta para a origem oficial e preserva tenant/projeto", () => {
    const event = actionToOperationalEvent(action());
    expect(event.organizationId).toBe("org-1");
    expect(event.projectId).toBe("project-1");
    expect(event.sourceType).toBe("PayableInstallment");
    expect(event.sourceId).toBe("installment-1");
    expect(event.processingStatus).toBe("PROCESSADO");
  });

  it("o mesmo evento repetido gera o mesmo id e zero ação duplicada", () => {
    const original = action();
    expect(actionToOperationalEvent(original).id).toBe(actionToOperationalEvent(original).id);
    expect(deriveOperationalActions([original, original])).toHaveLength(1);
  });

  it("organizações diferentes nunca compartilham o identificador canônico", () => {
    expect(actionToOperationalEvent(action({ organizationId: "org-1" })).id).not.toBe(actionToOperationalEvent(action({ organizationId: "org-2" })).id);
  });

  it("auditoria adversarial 9L: dois fatos distintos que reaproveitam o mesmo código de negócio (evidence[0]) nunca colidem no id canônico — só `action.id` (já único) decide identidade", () => {
    // `FundingCondition.code`/`FundingCovenant.code` só são únicos por proposta (`@@unique([proposalId, code])`),
    // não pela organização — duas propostas diferentes usando o mesmo código "CP-01" são um caso real.
    const conditionA = action({ id: "org-1:capital:condition_pending:condition-id-A", domain: "capital", type: "condition_pending", evidence: ["CP-01", "proposal-A"] });
    const conditionB = action({ id: "org-1:capital:condition_pending:condition-id-B", domain: "capital", type: "condition_pending", evidence: ["CP-01", "proposal-B"] });
    expect(actionToOperationalEvent(conditionA).id).not.toBe(actionToOperationalEvent(conditionB).id);
    // Também não pode desaparecer silenciosamente ao derivar a lista de ações.
    expect(deriveOperationalActions([conditionA, conditionB])).toHaveLength(2);
  });
});

describe("próximo passo e automação segura", () => {
  it("prepara solicitação, mas nunca executa pagamento", () => {
    const result = enrichOperationalAction(action());
    expect(result.automation.level).toBe("PREPARAR");
    expect(result.automation.requiresHumanConfirmation).toBe(true);
    expect(result.nextStep.what).toContain("solicitação de aprovação");
    expect(isAutomaticExecutionAllowed(result)).toBe(false);
  });

  it("não inventa responsável quando a origem não possui um", () => {
    const result = enrichOperationalAction(action({ responsibleId: undefined }));
    expect(result.nextStep.responsibleId).toBeUndefined();
  });

  it("aprovação pendente permanece recomendação para decisão humana", () => {
    const result = enrichOperationalAction(action({ domain: "approvals", type: "pending_request", evidence: ["approval-1"] }));
    expect(result.automation.level).toBe("RECOMENDAR");
    expect(result.automation.requiresHumanConfirmation).toBe(true);
  });
});

describe("resumo e prioridade do dia", () => {
  it("resume Financeiro, Comercial, Suprimentos e Capital sem IA", () => {
    const actions = [
      action(),
      action({ id: "receivable", domain: "sales", type: "receivable_overdue", evidence: ["receivable-1"] }),
      action({ id: "approval", domain: "approvals", type: "pending_request", severity: "DECISAO", dueDate: null, evidence: ["approval-1"] }),
      action({ id: "purchase", domain: "procurement", type: "critical_need", evidence: ["need-1"] }),
      action({ id: "condition", domain: "capital", type: "condition_pending", evidence: ["condition-1"] }),
    ];
    const summary = buildDailyOperationalSummary(actions, referenceDate);
    expect(summary.importantPayments).toBe(1);
    expect(summary.overdueReceivables).toBe(1);
    expect(summary.pendingApprovals).toBe(1);
    expect(summary.procurementRisks).toBe(1);
    expect(summary.fundingConditions).toBe(1);
  });

  it("ordena crítica vencida, crítica de hoje, aprovação, próxima com risco e demais", () => {
    const ordered = sortRoutinePriority([
      action({ id: "other", severity: "ATENCAO", dueDate: null }),
      action({ id: "future", severity: "ACAO_NECESSARIA", dueDate: days(2) }),
      action({ id: "approval", domain: "approvals", type: "pending_request", severity: "DECISAO", dueDate: null }),
      action({ id: "today", dueDate: days(0) }),
      action({ id: "overdue", dueDate: days(-1) }),
    ], referenceDate);
    expect(ordered.map((item) => item.id)).toEqual(["overdue", "today", "approval", "future", "other"]);
  });
});
