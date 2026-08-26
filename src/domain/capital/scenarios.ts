/**
 * Fase 9N §5 — Cenários (Sem funding / Equity / Dívida / Híbrido / comparação de propostas).
 * Toda simulação aqui é uma projeção paralela em memória: nunca grava em `FinancialResult`,
 * `CashFlowEntry` ou em qualquer tabela da Base Aprovada.
 */
import Decimal from "decimal.js";
import { D, irr, moneyString, ZERO } from "@/domain/financial/math";
import { compareFundingProposals, type BaseProjectEconomics } from "./comparator-engine";
import type { CapitalNeedMonth, FundingProposalInput, FundingScenarioKind, FundingScenarioResult, ProposalComparisonResult } from "./types";

function equityImpactFromFlows(operatingNet: Decimal[], profit: Decimal, vgv: Decimal, totalCost: Decimal): ProposalComparisonResult["impact"] {
  let cumulative = ZERO;
  let peak = ZERO;
  for (const flow of operatingNet) {
    cumulative = cumulative.plus(flow);
    if (cumulative.lt(peak)) peak = cumulative;
  }
  const monthlyIrr = irr(operatingNet);
  const annualIrr = monthlyIrr ? moneyString(monthlyIrr.plus(1).pow(12).minus(1).times(100)) : null;
  const peakExposure = peak.neg();
  const roi = peakExposure.gt(0) ? moneyString(profit.div(peakExposure).times(100)) : null;
  return {
    totalCostWithFinancing: moneyString(totalCost),
    marginOnVgvWithFinancing: vgv.gt(0) ? moneyString(profit.div(vgv).times(100)) : moneyString(ZERO),
    annualIrrWithFinancing: annualIrr,
    roiWithFinancing: roi,
    peakEquityExposureWithFinancing: moneyString(peakExposure),
  };
}

/** Cenário 100% equity: nenhuma proposta, o próprio fluxo operacional é o fluxo do acionista. */
function noFundingImpact(base: BaseProjectEconomics): ProposalComparisonResult["impact"] {
  const flows = base.operatingNetByMonth.map((row) => D(row.operatingNet));
  return equityImpactFromFlows(flows, D(base.profit), D(base.vgv), D(base.totalCost));
}

/** Recombina o fluxo de serviço da dívida de todas as propostas simultaneamente contra o `operatingNet` — não é a média/soma dos impactos individuais, e sim um novo fluxo de caixa único. */
function combinedHybridImpact(compared: ProposalComparisonResult[], base: BaseProjectEconomics): ProposalComparisonResult["impact"] {
  const operatingNetByMonth = new Map(base.operatingNetByMonth.map((row) => [row.month, D(row.operatingNet)]));
  const debtFlowByMonth = new Map<number, Decimal>();
  let totalFinancingCost = ZERO;
  for (const proposal of compared) {
    totalFinancingCost = totalFinancingCost.plus(proposal.totalCost);
    for (const row of proposal.debtService) {
      const net = D(row.disbursement).minus(row.installment);
      debtFlowByMonth.set(row.month, (debtFlowByMonth.get(row.month) ?? ZERO).plus(net));
    }
  }
  const lastMonth = Math.max(...operatingNetByMonth.keys(), ...debtFlowByMonth.keys());
  const flows: Decimal[] = [];
  for (let month = 0; month <= lastMonth; month += 1) {
    flows.push((operatingNetByMonth.get(month) ?? ZERO).plus(debtFlowByMonth.get(month) ?? ZERO));
  }
  const profitWithFinancing = D(base.profit).minus(totalFinancingCost);
  const totalCostWithFinancing = D(base.totalCost).plus(totalFinancingCost);
  return equityImpactFromFlows(flows, profitWithFinancing, D(base.vgv), totalCostWithFinancing);
}

export function simulateFundingScenario(
  kind: FundingScenarioKind,
  proposals: FundingProposalInput[],
  capitalNeed: CapitalNeedMonth[],
  base: BaseProjectEconomics,
): FundingScenarioResult {
  if (kind === "NO_FUNDING" || kind === "EQUITY") {
    return { kind, proposals: [], combinedImpact: noFundingImpact(base) };
  }
  const compared = compareFundingProposals(proposals, capitalNeed, base);
  if (kind === "HYBRID") return { kind, proposals: compared, combinedImpact: compared.length ? combinedHybridImpact(compared, base) : noFundingImpact(base) };
  // DEBT (proposta única) e PROPOSAL_COMPARISON (A vs B vs C) expõem cada proposta lado a lado;
  // só há "combinedImpact" único quando sobra exatamente uma proposta para decidir.
  return { kind, proposals: compared, combinedImpact: compared.length === 1 ? compared[0].impact : null };
}
