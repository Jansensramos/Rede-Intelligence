/**
 * Fase 9N §1 — Necessidade de Capital.
 * Lê a projeção oficial (REDE Engine, Base Aprovada) e nunca recalcula VGV/custo/margem: apenas
 * organiza `cumulativeProjectCash` numa curva mensal e confronta com capital já disponível
 * (aportes reais + funding já desembolsado) para apurar quanto ainda falta captar.
 */
import { D, moneyString, ZERO } from "@/domain/financial/math";
import type { CashFlowMonth, DecimalString, FinancialMetrics } from "@/domain/financial/types";
import type { CapitalNeedMonth, CapitalNeedResult } from "./types";

export function buildCapitalNeedCurve(cashFlow: Pick<CashFlowMonth, "month" | "phase" | "cumulativeProjectCash">[]): CapitalNeedMonth[] {
  return cashFlow.map((row) => {
    const balance = D(row.cumulativeProjectCash);
    const deficit = balance.lt(0) ? balance.neg() : ZERO;
    return {
      month: row.month,
      phase: row.phase,
      projectCashBalance: moneyString(balance),
      deficit: moneyString(deficit),
    };
  });
}

export function computeCapitalNeed(
  cashFlow: Pick<CashFlowMonth, "month" | "phase" | "cumulativeProjectCash">[],
  metrics: Pick<FinancialMetrics, "maximumCashExposure" | "maximumExposureMonth">,
  equityContributed: DecimalString = "0",
  fundingDisbursed: DecimalString = "0",
): CapitalNeedResult {
  const monthlyCurve = buildCapitalNeedCurve(cashFlow);
  const deficitMonths = monthlyCurve.filter((row) => D(row.deficit).gt(0)).map((row) => row.month);

  const totalCapitalNeed = D(metrics.maximumCashExposure);
  const covered = D(equityContributed).plus(fundingDisbursed);
  const fundingStillNeeded = totalCapitalNeed.minus(covered);

  return {
    totalCapitalNeed: moneyString(totalCapitalNeed),
    peakExposureMonth: metrics.maximumExposureMonth,
    monthlyCurve,
    deficitMonths,
    equityContributed: moneyString(D(equityContributed)),
    fundingDisbursed: moneyString(D(fundingDisbursed)),
    fundingStillNeeded: moneyString(fundingStillNeeded.lt(0) ? ZERO : fundingStillNeeded),
    fullyCovered: fundingStillNeeded.lte(0),
  };
}
