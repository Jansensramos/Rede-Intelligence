import { describe, expect, it } from "vitest";
import { buildInstallmentPositions, sumClientFinancialPositions, summarizeClientFinancialPosition } from "./customer-360";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("Cliente 360 — posição financeira (domínio puro)", () => {
  it("classifica parcela paga, em aberto e vencida usando a mesma régua de saldo/vencimento do Financeiro", () => {
    const referenceDate = day("2026-06-15");
    const positions = buildInstallmentPositions(
      [
        { id: "p1", number: 1, dueDate: day("2026-05-01"), currentAmount: 1000, status: "RECEBIDA", payments: [{ amount: 1000, status: "CLEARED" }] },
        { id: "p2", number: 2, dueDate: day("2026-05-10"), currentAmount: 1000, status: "EMITIDA", payments: [] },
        { id: "p3", number: 3, dueDate: day("2026-07-01"), currentAmount: 1000, status: "PREVISTA", payments: [] },
      ],
      referenceDate,
    );
    expect(positions.find((item) => item.id === "p1")!.overdue).toBe(false);
    expect(positions.find((item) => item.id === "p1")!.balance).toBe(0);
    expect(positions.find((item) => item.id === "p2")!.overdue).toBe(true);
    expect(positions.find((item) => item.id === "p3")!.overdue).toBe(false);
  });

  it("nunca conta saldo de parcela cancelada/renegociada como aberto ou vencido", () => {
    const referenceDate = day("2026-06-15");
    const positions = buildInstallmentPositions(
      [{ id: "p1", number: 1, dueDate: day("2026-05-01"), currentAmount: 1000, status: "CANCELADA", payments: [] }],
      referenceDate,
    );
    const summary = summarizeClientFinancialPosition(positions, 1000);
    expect(summary.open).toBe(0);
    expect(summary.overdue).toBe(0);
  });

  it("resume contratado/pago/aberto/vencido e o próximo vencimento a partir das parcelas em aberto", () => {
    const referenceDate = day("2026-06-15");
    const positions = buildInstallmentPositions(
      [
        { id: "p1", number: 1, dueDate: day("2026-05-01"), currentAmount: 1000, status: "RECEBIDA", payments: [{ amount: 1000, status: "CLEARED" }] },
        { id: "p2", number: 2, dueDate: day("2026-05-10"), currentAmount: 500, status: "EMITIDA", payments: [] },
        { id: "p3", number: 3, dueDate: day("2026-07-01"), currentAmount: 800, status: "PREVISTA", payments: [] },
      ],
      referenceDate,
    );
    const summary = summarizeClientFinancialPosition(positions, 2300);
    expect(summary.contracted).toBe(2300);
    expect(summary.paid).toBe(1000);
    expect(summary.open).toBe(1300);
    expect(summary.overdue).toBe(500);
    expect(summary.overdueCount).toBe(1);
    expect(summary.nextDueDate).toBe(day("2026-07-01").toISOString());
    expect(summary.nextDueAmount).toBe(800);
  });

  it("quando não há nenhuma parcela em aberto, não inventa um próximo vencimento", () => {
    const referenceDate = day("2026-06-15");
    const positions = buildInstallmentPositions(
      [{ id: "p1", number: 1, dueDate: day("2026-05-01"), currentAmount: 1000, status: "RECEBIDA", payments: [{ amount: 1000, status: "CLEARED" }] }],
      referenceDate,
    );
    const summary = summarizeClientFinancialPosition(positions, 1000);
    expect(summary.nextDueDate).toBeNull();
    expect(summary.nextDueAmount).toBeNull();
  });

  it("soma posições de múltiplas vendas/contratos e escolhe o próximo vencimento mais próximo entre todas", () => {
    const total = sumClientFinancialPositions([
      { contracted: 1000, paid: 200, open: 800, overdue: 100, overdueCount: 1, nextDueDate: "2026-08-01T00:00:00.000Z", nextDueAmount: 400 },
      { contracted: 2000, paid: 2000, open: 0, overdue: 0, overdueCount: 0, nextDueDate: null, nextDueAmount: null },
      { contracted: 500, paid: 0, open: 500, overdue: 0, overdueCount: 0, nextDueDate: "2026-07-01T00:00:00.000Z", nextDueAmount: 500 },
    ]);
    expect(total.contracted).toBe(3500);
    expect(total.paid).toBe(2200);
    expect(total.open).toBe(1300);
    expect(total.overdue).toBe(100);
    expect(total.overdueCount).toBe(1);
    expect(total.nextDueDate).toBe("2026-07-01T00:00:00.000Z");
    expect(total.nextDueAmount).toBe(500);
  });

  it("sem nenhuma venda com próximo vencimento, o total também não inventa um", () => {
    const total = sumClientFinancialPositions([]);
    expect(total.nextDueDate).toBeNull();
    expect(total.contracted).toBe(0);
  });
});
