import { describe, expect, it } from "vitest";
import {
  assertUnitTransition, calculateCommissionAmount, calculateRescissionRefund, computeDiscount,
  isReservationExpired, monthsOfStock, pricePerM2, requiresDiscountApproval, vgvBreakdown, vgvToReceive, vso,
} from "./engine";

describe("engine comercial (unidades, preço, VGV, distrato, comissão)", () => {
  it("calcula preço por m² sem dividir por área zero", () => {
    expect(pricePerM2("500000", "100").toNumber()).toBe(5000);
    expect(pricePerM2("500000", "0").toNumber()).toBe(0);
  });

  it("calcula desconto absoluto e percentual sem recomputar a tabela depois", () => {
    const result = computeDiscount("500000", "475000");
    expect(result.discountAmount.toNumber()).toBe(25000);
    expect(result.discountPercentage.toNumber()).toBe(0.05);
  });

  it("exige alçada apenas quando o preço vendido fica abaixo do mínimo autorizado", () => {
    expect(requiresDiscountApproval("475000", "480000")).toBe(true);
    expect(requiresDiscountApproval("485000", "480000")).toBe(false);
    expect(requiresDiscountApproval("400000", null)).toBe(false);
  });

  it("permite reserva → venda mas bloqueia venda direta sem passar por reserva/proposta/disponível", () => {
    expect(() => assertUnitTransition("RESERVADA", "VENDIDA")).not.toThrow();
    expect(() => assertUnitTransition("VENDIDA", "DISPONIVEL")).toThrow("Transição de status de unidade inválida");
    expect(() => assertUnitTransition("DISTRATADA", "DISPONIVEL")).not.toThrow();
  });

  it("considera reserva expirada apenas quando ativa e vencida", () => {
    expect(isReservationExpired(new Date("2026-01-01T00:00:00Z"), "ACTIVE", new Date("2026-02-01T00:00:00Z"))).toBe(true);
    expect(isReservationExpired(new Date("2026-01-01T00:00:00Z"), "CONVERTED", new Date("2026-02-01T00:00:00Z"))).toBe(false);
    expect(isReservationExpired(new Date("2026-03-01T00:00:00Z"), "ACTIVE", new Date("2026-02-01T00:00:00Z"))).toBe(false);
  });

  it("calcula devolução de distrato retendo apenas a taxa configurada, nunca hardcoded", () => {
    const result = calculateRescissionRefund("100000", "0.1");
    expect(result.retainedAmount.toNumber()).toBe(10000);
    expect(result.refundAmount.toNumber()).toBe(90000);
    expect(() => calculateRescissionRefund("100000", "1.5")).toThrow();
  });

  it("calcula comissão pela base configurada (preço vendido ou valor recebido)", () => {
    expect(calculateCommissionAmount("SOLD_PRICE", "0.05", "500000").toNumber()).toBe(25000);
    expect(calculateCommissionAmount("RECEIVED_AMOUNT", "0.05", "500000", "100000").toNumber()).toBe(5000);
  });

  it("separa estoque, reservado, vendido, distratado e permutado sem dupla contagem", () => {
    const breakdown = vgvBreakdown(
      [{ status: "DISPONIVEL", listPrice: "500000" }, { status: "RESERVADA", listPrice: "480000" }, { status: "VENDIDA", listPrice: "520000" }],
      [{ status: "APPROVED", soldPrice: "500000", tradeInValue: "50000" }, { status: "CANCELLED", soldPrice: "470000" }],
    );
    expect(breakdown.total.toNumber()).toBe(1500000);
    expect(breakdown.disponivel.toNumber()).toBe(500000);
    expect(breakdown.reservado.toNumber()).toBe(480000);
    expect(breakdown.vendido.toNumber()).toBe(500000);
    expect(breakdown.distratado.toNumber()).toBe(470000);
    expect(breakdown.permutado.toNumber()).toBe(50000);
  });

  it("nunca soma vendido e a receber ao previsto (mesma disciplina da 9B)", () => {
    expect(vgvToReceive("500000", "150000").toNumber()).toBe(350000);
  });

  it("calcula VSO e meses de estoque sem depender de cron", () => {
    expect(vso(5, 45)).toBe(0.1);
    expect(vso(0, 0)).toBe(0);
    expect(monthsOfStock(40, 5)).toBe(8);
    expect(monthsOfStock(40, 0)).toBeNull();
  });
});
