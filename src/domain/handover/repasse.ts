import Decimal from "decimal.js";

/**
 * Fase 9R — conciliação pura do repasse bancário. Nunca ajusta o valor esperado nem o
 * recebível silenciosamente: qualquer diferença acima da tolerância marca a
 * conciliação como divergente e devolve a diferença exata para decisão humana.
 */

export interface ReconciliationInput {
  disbursedAmount: string | number;
  installmentAmount: string | number;
  toleranceCents?: number;
}

export interface ReconciliationResult {
  matches: boolean;
  differenceCents: number;
}

export function evaluateDisbursementReconciliation(input: ReconciliationInput): ReconciliationResult {
  const disbursed = new Decimal(input.disbursedAmount);
  const installment = new Decimal(input.installmentAmount);
  const differenceCents = disbursed.minus(installment).times(100).toDecimalPlaces(0).toNumber();
  const tolerance = input.toleranceCents ?? 0;
  return { matches: Math.abs(differenceCents) <= tolerance, differenceCents };
}
