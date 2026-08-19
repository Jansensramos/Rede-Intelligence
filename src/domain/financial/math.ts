import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export const D = (value: Decimal.Value): Decimal => new Decimal(value);
export const ZERO = D(0);
export const ONE = D(1);
export const HUNDRED = D(100);

export function rate(percent: Decimal.Value): Decimal {
  return D(percent).div(HUNDRED);
}

export function annualToMonthlyRate(annualPercent: Decimal.Value): Decimal {
  const annual = rate(annualPercent);
  return ONE.plus(annual).pow(ONE.div(12)).minus(ONE);
}

export function decimalString(value: Decimal): string {
  return value.toDecimalPlaces(8).toFixed();
}

export function moneyString(value: Decimal): string {
  return value.toDecimalPlaces(2).toFixed(2);
}

export function normalizedConstructionWeights(months: number): Decimal[] {
  if (months <= 0) return [];
  const raw = Array.from({ length: months }, (_, index) => {
    const angle = Math.PI * ((index + 0.5) / months);
    return D(Math.sin(angle).toString());
  });
  const total = raw.reduce((sum, item) => sum.plus(item), ZERO);
  return raw.map((item) => item.div(total));
}

export function npv(cashFlows: Decimal[], monthlyRate: Decimal): Decimal {
  return cashFlows.reduce(
    (total, cashFlow, month) => total.plus(cashFlow.div(ONE.plus(monthlyRate).pow(month))),
    ZERO,
  );
}

function npvAtRate(cashFlows: Decimal[], monthlyRate: Decimal): Decimal {
  return npv(cashFlows, monthlyRate);
}

export function irr(cashFlows: Decimal[]): Decimal | null {
  const hasNegative = cashFlows.some((value) => value.lt(0));
  const hasPositive = cashFlows.some((value) => value.gt(0));
  if (!hasNegative || !hasPositive) return null;

  let low = D("-0.999999");
  let high = D(1);
  let lowValue = npvAtRate(cashFlows, low);
  let highValue = npvAtRate(cashFlows, high);

  for (let attempt = 0; lowValue.times(highValue).gt(0) && attempt < 12; attempt += 1) {
    high = high.times(2);
    highValue = npvAtRate(cashFlows, high);
  }
  if (lowValue.times(highValue).gt(0)) return null;

  for (let iteration = 0; iteration < 180; iteration += 1) {
    const middle = low.plus(high).div(2);
    const middleValue = npvAtRate(cashFlows, middle);
    if (middleValue.abs().lt("0.0000001")) return middle;
    if (lowValue.times(middleValue).lte(0)) {
      high = middle;
    } else {
      low = middle;
      lowValue = middleValue;
    }
  }
  return low.plus(high).div(2);
}
