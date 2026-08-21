import { describe, expect, it } from "vitest";
import { calculateSaving, classifyComparability, currentContractValue, isCriticalPurchase, stageLedger, validateMeasurement } from "./engine";

describe("engine de suprimentos, contratos e medições", () => {
  it("não confunde menor preço com proposta comparável", () => {
    expect(classifyComparability({ sameUnit: true, sameQuantity: true, materialExclusions: true, explicitAdjustments: false })).toBe("NOT_COMPARABLE");
    expect(classifyComparability({ sameUnit: true, sameQuantity: true, materialExclusions: true, explicitAdjustments: true })).toBe("COMPARABLE_WITH_ADJUSTMENTS");
  });

  it("separa economia validada de redução sem equivalência de escopo", () => {
    expect(calculateSaving("1000000", "930000", true)).toMatchObject({ canValidate: true });
    expect(calculateSaving("1000000", "930000", true).nominalAmount.toNumber()).toBe(70000);
    expect(calculateSaving("1000000", "930000", true).percentage.toNumber()).toBe(0.07);
    expect(calculateSaving("1000000", "800000", false).canValidate).toBe(false);
  });

  it("preserva valor original e calcula valor atual por eventos aprovados", () => {
    const current = currentContractValue("1000000", [
      { type: "INCREASE", status: "APPROVED", value: "100000" }, { type: "SUPPRESSION", status: "APPROVED", value: "30000" },
      { type: "READJUSTMENT", status: "DRAFT", value: "999999" },
    ]);
    expect(current.toNumber()).toBe(1070000);
  });

  it("prova-zero bloqueia quantidade e valor acumulados acima do contrato", () => {
    expect(() => validateMeasurement({ contractCurrentAmount: "1000000", previouslyMeasuredAmount: "0", lines: [{ contractedQuantity: "100", previousQuantity: "90", periodQuantity: "11", unitPrice: "1000" }] })).toThrow("quantidade acumulada excede");
    expect(() => validateMeasurement({ contractCurrentAmount: "1000000", previouslyMeasuredAmount: "950000", lines: [{ contractedQuantity: "100", previousQuantity: "0", periodQuantity: "60", unitPrice: "1000" }] })).toThrow("valor contratual disponível");
  });

  it("fecha bruto, retenções, adiantamento e líquido", () => {
    const proof = validateMeasurement({ contractCurrentAmount: "1000000", previouslyMeasuredAmount: "0", retentionAmount: "10000", discountAmount: "5000", advanceAmortizationAmount: "15000", lines: [{ contractedQuantity: "1000", previousQuantity: "0", periodQuantity: "200", unitPrice: "1000" }] });
    expect(proof.grossAmount.toNumber()).toBe(200000);
    expect(proof.netAmount.toNumber()).toBe(170000);
    expect(proof.lines[0].remainingQuantity.toNumber()).toBe(800);
  });

  it("substitui planejamento por compromisso sem projetar 1,93 milhão", () => {
    const ledger = stageLedger({ budget: "1000000", contracted: "930000", measured: "200000", obligated: "200000", paid: "0" });
    expect(ledger.balanceToContract.toNumber()).toBe(70000);
    expect(ledger.updatedProjection.toNumber()).toBe(1000000);
  });

  it("identifica compra crítica pela data-limite de contratação", () => {
    expect(isCriticalPurchase({ requiredAt: new Date("2026-10-01T00:00:00Z"), expectedLeadDays: 45, bufferDays: 15, referenceDate: new Date("2026-08-20T00:00:00Z"), contracted: false })).toBe(true);
    expect(isCriticalPurchase({ requiredAt: new Date("2026-10-01T00:00:00Z"), expectedLeadDays: 45, bufferDays: 15, referenceDate: new Date("2026-08-20T00:00:00Z"), contracted: true })).toBe(false);
  });
});
