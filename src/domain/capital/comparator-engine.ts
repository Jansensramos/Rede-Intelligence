/**
 * Fase 9N §4 — Comparador determinístico de propostas de funding.
 * Nunca usa LLM. Recombina o serviço da dívida de cada proposta com o fluxo operacional
 * (`operatingNet`) da Base Aprovada para reapurar margem/TIR/ROI "com financiamento" — sem jamais
 * mutar `FinancialResult`/`CashFlowEntry` reais: tudo aqui é uma projeção paralela, em memória.
 */
import Decimal from "decimal.js";
import { D, irr, moneyString, ZERO } from "@/domain/financial/math";
import type { DecimalString } from "@/domain/financial/types";
import { buildDebtServiceSchedule } from "./amortization";
import type { CapitalNeedMonth, DebtServiceMonth, FundingProposalInput, ProposalComparisonResult } from "./types";

/** Custo Efetivo Total anualizado: IRR mensal do fluxo líquido de fees, sob a ótica do tomador. */
function effectiveAnnualCost(debtService: DebtServiceMonth[]): DecimalString | null {
  // Fluxo do tomador: recebe o desembolso e paga a parcela (juros + amortização + fees, inclusive
  // a fee de originação do próprio mês do desembolso) — o CET é a TIR mensal desse fluxo, anualizada.
  const flows = debtService.map((row) => D(row.disbursement).minus(row.installment));
  const monthlyIrr = irr(flows);
  if (!monthlyIrr) return null;
  const annual = monthlyIrr.plus(1).pow(12).minus(1);
  return moneyString(annual.times(100));
}

function averageCoverage(debtService: DebtServiceMonth[], operatingNetByMonth: Map<number, Decimal>): DecimalString | null {
  const rows = debtService.filter((row) => D(row.installment).gt(0));
  if (rows.length === 0) return null;
  const ratios: Decimal[] = [];
  for (const row of rows) {
    const noi = operatingNetByMonth.get(row.month);
    if (noi === undefined) continue;
    const installment = D(row.installment);
    if (installment.eq(0)) continue;
    ratios.push(noi.div(installment));
  }
  if (ratios.length === 0) return null;
  const sum = ratios.reduce((total, value) => total.plus(value), ZERO);
  return moneyString(sum.div(ratios.length));
}

export interface BaseProjectEconomics {
  vgv: DecimalString;
  profit: DecimalString;
  totalCost: DecimalString;
  /** `operatingNet` mês a mês da Base Aprovada — fluxo 100% desalavancado, nunca alterado. */
  operatingNetByMonth: { month: number; operatingNet: DecimalString }[];
}

export function compareFundingProposal(proposal: FundingProposalInput, capitalNeed: CapitalNeedMonth[], base: BaseProjectEconomics): ProposalComparisonResult {
  const debtService = buildDebtServiceSchedule({
    amount: proposal.amount,
    annualNominalRate: proposal.annualNominalRate,
    termMonths: proposal.termMonths,
    graceMonths: proposal.graceMonths,
    amortizationSystem: proposal.amortizationSystem,
    fees: proposal.fees,
    disbursementSchedule: proposal.disbursementSchedule,
  });

  const totalCost = debtService.reduce((sum, row) => sum.plus(row.interest).plus(row.fees), ZERO);
  const peakDebt = debtService.reduce((max, row) => Decimal.max(max, D(row.closingBalance)), ZERO);

  const balanceByMonth = new Map(capitalNeed.map((row) => [row.month, D(row.projectCashBalance)]));
  const cashImpact = debtService.map((row) => {
    const projectBalance = balanceByMonth.get(row.month) ?? ZERO;
    const net = D(row.disbursement).minus(row.installment);
    return { month: row.month, balanceWithFunding: moneyString(projectBalance.plus(net)) };
  });

  const operatingNetByMonth = new Map(base.operatingNetByMonth.map((row) => [row.month, D(row.operatingNet)]));
  const debtFlowByMonth = new Map(debtService.map((row) => [row.month, D(row.disbursement).minus(row.installment)]));
  const lastMonth = Math.max(...base.operatingNetByMonth.map((row) => row.month), ...debtService.map((row) => row.month));
  const equityFlows: Decimal[] = [];
  let cumulativeEquity = ZERO;
  let peakEquityExposure = ZERO;
  for (let month = 0; month <= lastMonth; month += 1) {
    const noi = operatingNetByMonth.get(month) ?? ZERO;
    const debtFlow = debtFlowByMonth.get(month) ?? ZERO;
    const equityFlow = noi.plus(debtFlow);
    equityFlows.push(equityFlow);
    cumulativeEquity = cumulativeEquity.plus(equityFlow);
    if (cumulativeEquity.lt(peakEquityExposure)) peakEquityExposure = cumulativeEquity;
  }
  const monthlyIrr = irr(equityFlows);
  const annualIrrWithFinancing = monthlyIrr ? moneyString(monthlyIrr.plus(1).pow(12).minus(1).times(100)) : null;
  const peakEquityExposureWithFinancing = peakEquityExposure.neg();
  const profitWithFinancing = D(base.profit).minus(totalCost);
  const roiWithFinancing = peakEquityExposureWithFinancing.gt(0) ? moneyString(profitWithFinancing.div(peakEquityExposureWithFinancing).times(100)) : null;
  const totalCostWithFinancing = D(base.totalCost).plus(totalCost);
  const marginOnVgvWithFinancing = D(base.vgv).gt(0) ? moneyString(profitWithFinancing.div(base.vgv).times(100)) : moneyString(ZERO);

  const riskFlags: string[] = [];
  if (peakDebt.gt(D(proposal.amount).times(1.0001))) riskFlags.push("Saldo devedor projetado excede o valor contratado.");
  if (annualIrrWithFinancing !== null && Number(annualIrrWithFinancing) < 0) riskFlags.push("TIR do projeto fica negativa com esta estrutura.");
  const coverage = averageCoverage(debtService, operatingNetByMonth);
  if (coverage !== null && Number(coverage) < 1) riskFlags.push("Cobertura média do serviço da dívida (NOI/parcela) abaixo de 1,0x.");

  return {
    proposalId: proposal.id,
    providerName: proposal.providerName,
    nominalAnnualCost: moneyString(D(proposal.annualNominalRate)),
    effectiveAnnualCost: effectiveAnnualCost(debtService),
    totalCost: moneyString(totalCost),
    peakDebt: moneyString(peakDebt),
    debtService,
    cashImpact,
    impact: {
      totalCostWithFinancing: moneyString(totalCostWithFinancing),
      marginOnVgvWithFinancing,
      annualIrrWithFinancing,
      roiWithFinancing,
      peakEquityExposureWithFinancing: moneyString(peakEquityExposureWithFinancing),
    },
    averageDebtServiceCoverage: coverage,
    riskFlags,
  };
}

export function compareFundingProposals(proposals: FundingProposalInput[], capitalNeed: CapitalNeedMonth[], base: BaseProjectEconomics): ProposalComparisonResult[] {
  return proposals.map((proposal) => compareFundingProposal(proposal, capitalNeed, base));
}
