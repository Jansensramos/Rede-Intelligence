/**
 * Fase 9N §3/§4 — geração determinística de cronograma de serviço da dívida (PRICE/SAC/BULLET).
 * Puro cálculo financeiro, sem I/O e sem LLM — mesma disciplina de `domain/financial/math.ts`.
 */
import Decimal from "decimal.js";
import { annualToMonthlyRate, D, moneyString, ONE, ZERO } from "@/domain/financial/math";
import type { AmortizationSystem, DebtServiceMonth, DisbursementScheduleEntry, FundingFeeInput } from "./types";

function defaultSchedule(amount: Decimal): DisbursementScheduleEntry[] {
  return [{ month: 0, amount: moneyString(amount) }];
}

/**
 * Retorna o cronograma mês a mês (0-indexado) cobrindo carência + amortização.
 * `graceMonths` paga somente juros (carência); a amortização do principal começa em seguida.
 */
export function buildDebtServiceSchedule(input: {
  amount: string | number;
  annualNominalRate: string | number;
  termMonths: number;
  graceMonths: number;
  amortizationSystem: AmortizationSystem;
  fees: FundingFeeInput;
  disbursementSchedule?: DisbursementScheduleEntry[];
}): DebtServiceMonth[] {
  const totalAmount = D(input.amount);
  const monthlyRate = annualToMonthlyRate(input.annualNominalRate);
  const monthlyRecurringFeeRate = annualToMonthlyRate(input.fees.recurringFeeRateAnnual);
  const schedule = input.disbursementSchedule?.length ? input.disbursementSchedule : defaultSchedule(totalAmount);
  const amortizationMonths = Math.max(input.termMonths - input.graceMonths, 1);
  const totalMonths = input.termMonths;

  const disbursementByMonth = new Map<number, Decimal>();
  for (const entry of schedule) disbursementByMonth.set(entry.month, (disbursementByMonth.get(entry.month) ?? ZERO).plus(entry.amount));

  const rows: DebtServiceMonth[] = [];
  let balance = ZERO;
  // PRICE: parcela constante calculada uma única vez sobre o saldo consolidado ao fim da carência.
  let priceInstallment: Decimal | null = null;
  const sacAmortization = totalAmount.div(amortizationMonths);

  for (let month = 0; month <= totalMonths; month += 1) {
    const disbursement = disbursementByMonth.get(month) ?? ZERO;
    const openingBalance = balance.plus(disbursement);
    const upfrontFee = disbursement.gt(0) ? disbursement.times(D(input.fees.upfrontFeeRate).plus(input.fees.iofRate ?? 0)).div(100) : ZERO;
    const interest = openingBalance.times(monthlyRate);
    const recurringFee = openingBalance.times(monthlyRecurringFeeRate);

    const inGrace = month <= input.graceMonths;
    const isAmortizing = month > input.graceMonths && month <= totalMonths;
    let amortization = ZERO;

    if (isAmortizing) {
      if (input.amortizationSystem === "BULLET") {
        amortization = month === totalMonths ? openingBalance : ZERO;
      } else if (input.amortizationSystem === "SAC") {
        amortization = month === totalMonths ? openingBalance : Decimal.min(sacAmortization, openingBalance);
      } else {
        if (priceInstallment === null) {
          priceInstallment = monthlyRate.eq(0)
            ? openingBalance.div(amortizationMonths)
            : openingBalance.times(monthlyRate).div(ONE.minus(ONE.plus(monthlyRate).pow(-amortizationMonths)));
        }
        amortization = month === totalMonths ? openingBalance : Decimal.min(priceInstallment.minus(interest), openingBalance);
      }
    }

    const closingBalance = openingBalance.minus(amortization);
    const installment = interest.plus(amortization).plus(recurringFee).plus(upfrontFee);

    rows.push({
      month,
      disbursement: moneyString(disbursement),
      openingBalance: moneyString(openingBalance),
      interest: moneyString(interest),
      amortization: moneyString(amortization),
      fees: moneyString(recurringFee.plus(upfrontFee)),
      installment: moneyString(installment),
      closingBalance: moneyString(closingBalance),
    });

    balance = closingBalance;
    if (inGrace) priceInstallment = null; // recalculado ao sair da carência com o saldo consolidado
  }

  return rows;
}
