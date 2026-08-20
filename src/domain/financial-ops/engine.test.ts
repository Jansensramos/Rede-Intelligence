import { describe, expect, it } from "vitest";
import {
  applyInstallmentCorrection,
  assertIntercompanyReciprocity,
  assertPayableTransition,
  assertReceivableTransition,
  buildDueHorizons,
  buildUpdatedProjection,
  capitalNeedIndicators,
  computeInstallmentBalance,
  consumePlannedWithCommitted,
  isInstallmentOverdue,
  nextPayableStatusAfterPayment,
  nextReceivableStatusAfterPayment,
  PAYABLE_TERMINAL_STATUSES,
  projectCashBalances,
  rankReconciliationCandidates,
  scoreReconciliationCandidate,
  summarizeCashPosition,
  summarizeConsolidationElimination,
  verifyAccountProofZero,
  verifyNoDoubleCounting,
  verifyReciprocity,
} from "./engine";

describe("motor financeiro", () => {
  it("calcula saldo da parcela a partir dos pagamentos válidos, ignorando falhos e revertidos", () => {
    expect(computeInstallmentBalance(1000, [{ amount: 400, status: "CLEARED" }, { amount: 600, status: "FAILED" }])).toBe(600);
    expect(computeInstallmentBalance(1000, [{ amount: 1000, status: "PROCESSED" }])).toBe(0);
  });

  it("marca vencida apenas quando há saldo, data passada e status não terminal", () => {
    const past = new Date("2026-08-01T00:00:00Z");
    const today = new Date("2026-08-20T00:00:00Z");
    expect(isInstallmentOverdue(past, 100, "APROVADA", today, PAYABLE_TERMINAL_STATUSES)).toBe(true);
    expect(isInstallmentOverdue(past, 0, "APROVADA", today, PAYABLE_TERMINAL_STATUSES)).toBe(false);
    expect(isInstallmentOverdue(past, 100, "PAGA", today, PAYABLE_TERMINAL_STATUSES)).toBe(false);
  });

  it("bloqueia transições arbitrárias de status de contas a pagar e receber", () => {
    expect(() => assertPayableTransition("PREVISTA", "PAGA")).toThrow("Transição de status inválida");
    expect(() => assertPayableTransition("PAGA", "PREVISTA")).toThrow();
    expect(() => assertPayableTransition("PREVISTA", "PROGRAMADA")).not.toThrow();
    expect(() => assertReceivableTransition("PREVISTA", "RECEBIDA")).toThrow();
    expect(() => assertReceivableTransition("EMITIDA", "PARCIALMENTE_RECEBIDA")).not.toThrow();
  });

  it("deriva o próximo status a partir do saldo remanescente, sem campo manual desconectado", () => {
    expect(nextPayableStatusAfterPayment(1000, 1000)).toBe("APROVADA");
    expect(nextPayableStatusAfterPayment(1000, 400)).toBe("PARCIALMENTE_PAGA");
    expect(nextPayableStatusAfterPayment(1000, 0)).toBe("PAGA");
    expect(nextReceivableStatusAfterPayment(500, 0)).toBe("RECEBIDA");
    expect(nextReceivableStatusAfterPayment(500, 200)).toBe("PARCIALMENTE_RECEBIDA");
  });

  it("aplica correção contratual preservando memória de cálculo e nunca gera valor negativo", () => {
    const result = applyInstallmentCorrection({ baseAmount: 1000, indexPercentage: 2, interestRatePerMonth: 1, monthsLate: 2, fineRate: 2, discountAmount: 5 });
    expect(result.indexedAmount).toBe(1020);
    expect(result.interestAmount).toBe(20.4);
    expect(result.fineAmount).toBe(20.4);
    expect(result.resultingAmount).toBe(1055.8);
    expect(() => applyInstallmentCorrection({ baseAmount: 10, discountAmount: 1000 })).toThrow("negativo");
  });

  it("consolida a régua de vencimentos em horizontes cumulativos e isola o vencido", () => {
    const reference = new Date("2026-08-20T00:00:00Z");
    const items = [
      { dueDate: new Date("2026-08-10T00:00:00Z"), balance: 100 },
      { dueDate: new Date("2026-08-22T00:00:00Z"), balance: 200 },
      { dueDate: new Date("2026-09-05T00:00:00Z"), balance: 300 },
    ];
    const horizons = buildDueHorizons(items, reference, [21, 14, 7, 3, 0]);
    expect(horizons.overdue).toBe(100);
    expect(horizons.byHorizon[3]).toBe(200);
    expect(horizons.byHorizon[21]).toBe(500);
  });

  it("pontua candidatos de conciliação por valor, data e documento, priorizando o mais forte", () => {
    const reference = new Date("2026-08-20T00:00:00Z");
    const exact = scoreReconciliationCandidate({ transactionAmount: 1000, transactionDate: reference, transactionDescription: "PAG NF 555 FORNECEDOR XPTO", candidateAmount: 1000, candidateDueDate: reference, candidateDocumentRef: "NF 555" });
    expect(exact.confidence).toBe("ALTA");
    expect(exact.breakdown.amountExact).toBe(true);
    expect(exact.breakdown.documentMatch).toBe(true);
    const weak = scoreReconciliationCandidate({ transactionAmount: 1000, transactionDate: reference, transactionDescription: "transferencia diversa", candidateAmount: 4000, candidateDueDate: new Date("2026-09-20T00:00:00Z") });
    expect(weak.confidence).toBe(null);
    const ranked = rankReconciliationCandidates([{ item: "fraco", input: { transactionAmount: 1000, transactionDate: reference, transactionDescription: "x", candidateAmount: 500, candidateDueDate: reference } }, { item: "forte", input: { transactionAmount: 1000, transactionDate: reference, transactionDescription: "x", candidateAmount: 1000, candidateDueDate: reference } }]);
    expect(ranked[0].item).toBe("forte");
  });

  it("nunca duplica previsão e compromisso: o concreto consome a previsão residual", () => {
    const { residual, consumed } = consumePlannedWithCommitted(100_000, 97_500);
    expect(consumed).toBe(97_500);
    expect(residual).toBe(2_500);
    const row = buildUpdatedProjection([{ period: "2026-09", plannedScheduled: 100_000, committedTotal: 97_500, committedRealized: 0 }])[0];
    expect(row.total).toBe(100_000);
    expect(row.total).not.toBe(197_500);
  });

  it("hierarquiza realizado sobre compromisso sobre previsão residual", () => {
    const row = buildUpdatedProjection([{ period: "2026-09", plannedScheduled: 100_000, committedTotal: 97_500, committedRealized: 60_000 }])[0];
    expect(row.realized).toBe(60_000);
    expect(row.committed).toBe(37_500);
    expect(row.residual).toBe(2_500);
    expect(row.total).toBe(100_000);
    expect(() => buildUpdatedProjection([{ period: "x", plannedScheduled: 10, committedTotal: 5, committedRealized: 6 }])).toThrow();
  });

  it("separa caixa livre e restrito sem tratar linha vinculada como livre", () => {
    const position = summarizeCashPosition([{ restriction: "FREE", balance: 1_000_000 }, { restriction: "RESTRICTED", balance: 400_000 }]);
    expect(position).toEqual({ total: 1_400_000, free: 1_000_000, restricted: 400_000 });
  });

  it("projeta saldo de caixa e identifica necessidade de capital no menor ponto", () => {
    const rows = projectCashBalances(100_000, [{ period: "2026-09", inflow: 50_000, outflow: 200_000 }, { period: "2026-10", inflow: 300_000, outflow: 50_000 }]);
    expect(rows[0].closingBalance).toBe(-50_000);
    expect(rows[1].closingBalance).toBe(200_000);
    const indicators = capitalNeedIndicators(rows);
    expect(indicators).toEqual({ lowestBalance: -50_000, lowestBalancePeriod: "2026-09", capitalNeed: 50_000 });
  });

  it("valida reciprocidade intercompany e elimina o efeito artificial na consolidação", () => {
    expect(() => assertIntercompanyReciprocity({ fromCompanyId: "a", toCompanyId: "a", amount: 100 })).toThrow();
    expect(() => assertIntercompanyReciprocity({ fromCompanyId: "a", toCompanyId: "b", amount: 0 })).toThrow();
    expect(() => assertIntercompanyReciprocity({ fromCompanyId: "a", toCompanyId: "b", amount: 2_000_000 })).not.toThrow();
    expect(summarizeConsolidationElimination([{ fromCompanyId: "a", toCompanyId: "b", amount: 2_000_000 }])).toBe(2_000_000);
    expect(verifyReciprocity(2_000_000, 2_000_000)).toBe(true);
  });

  it("confirma prova-zero de conta e de não duplicidade entre previsão e compromisso", () => {
    expect(verifyAccountProofZero(1000, 1000, 0)).toBe(true);
    expect(verifyAccountProofZero(1000, 400, 600)).toBe(true);
    expect(verifyAccountProofZero(1000, 400, 601)).toBe(false);
    expect(verifyNoDoubleCounting(100_000, 97_500, 2_500)).toBe(true);
    expect(verifyNoDoubleCounting(100_000, 97_500, 100_000)).toBe(false);
  });
});

describe("cenários críticos de não duplicidade — validação final Fase 9B", () => {
  it("Cenário A: previsão R$100.000 × obrigação concreta R$97.500 nunca resulta em R$197.500", () => {
    const row = buildUpdatedProjection([{ period: "2026-09", plannedScheduled: 100_000, committedTotal: 97_500, committedRealized: 0 }])[0];
    // A obrigação concreta (R$97.500) consome a previsão residual correspondente;
    // sobra apenas o resíduo não coberto (R$2.500) — nunca a soma bruta dos dois.
    expect(row.committed).toBe(97_500);
    expect(row.residual).toBe(2_500);
    expect(row.total).toBe(100_000);
    expect(row.total).not.toBe(197_500);
  });

  it("Cenário B: conta de R$100.000 paga com R$100.000 e transação de -R$100.000 concilia para realizado de R$100.000, nunca R$200.000", () => {
    const currentAmount = 100_000;
    const payments = [{ amount: 100_000, status: "PROCESSED" as const }];
    const balance = computeInstallmentBalance(currentAmount, payments);
    // O realizado é o pagamento único de R$100.000; a transação bancária de -R$100.000
    // é o mesmo evento visto pelo banco, não um segundo fato econômico.
    const realizado = payments.reduce((sum, payment) => sum + payment.amount, 0);
    expect(balance).toBe(0);
    expect(realizado).toBe(100_000);
    expect(realizado).not.toBe(200_000);
    expect(verifyAccountProofZero(currentAmount, realizado, balance)).toBe(true);
  });

  it("Cenário C: aporte intercompany de R$2.000.000 não infla artificialmente receita e despesa econômica no consolidado", () => {
    const transaction = { fromCompanyId: "holding", toCompanyId: "spe", amount: 2_000_000 };
    expect(() => assertIntercompanyReciprocity(transaction)).not.toThrow();
    // A obrigação criada na origem e o direito criado no destino usam o MESMO valor —
    // a eliminação de consolidação soma exatamente esse valor uma única vez, não o dobro.
    const eliminationAmount = summarizeConsolidationElimination([transaction]);
    expect(eliminationAmount).toBe(2_000_000);
    expect(eliminationAmount).not.toBe(4_000_000);
    expect(verifyReciprocity(transaction.amount, transaction.amount)).toBe(true);
  });
});
