import {
  CAPITAL_BENCHMARKS,
  COMMERCIAL_BENCHMARKS,
  COST_BENCHMARKS,
  DIMENSION_WEIGHTS,
  EXECUTION_BENCHMARKS,
  RESILIENCE_BENCHMARKS,
  SCORE_POLICY_VERSION,
  returnBenchmarks,
  type HigherIsBetterBands,
  type LowerIsBetterBands,
} from "./policy";
import type {
  RedeScoreResult,
  ScoreClassification,
  ScoreDimensionKey,
  ScoreDimensionResult,
  ScoreGate,
  ScoreInput,
  ScorePenalty,
  ScoreReason,
} from "./types";

const clamp = (value: number, minimum = 0, maximum = 100) => Math.min(maximum, Math.max(minimum, value));
const round = (value: number, digits = 1) => Number(value.toFixed(digits));
const interpolate = (value: number, start: number, end: number, startScore: number, endScore: number) => {
  if (end === start) return endScore;
  return startScore + ((value - start) / (end - start)) * (endScore - startScore);
};

export function higherIsBetter(value: number, bands: HigherIsBetterBands) {
  if (!Number.isFinite(value) || value <= bands.critical) return 0;
  if (value < bands.minimum) return interpolate(value, bands.critical, bands.minimum, 0, 50);
  if (value < bands.target) return interpolate(value, bands.minimum, bands.target, 50, 75);
  if (value < bands.excellent) return interpolate(value, bands.target, bands.excellent, 75, 100);
  return 100;
}

export function lowerIsBetter(value: number, bands: LowerIsBetterBands) {
  if (!Number.isFinite(value) || value >= bands.critical) return 0;
  if (value > bands.minimum) return interpolate(value, bands.minimum, bands.critical, 50, 0);
  if (value > bands.target) return interpolate(value, bands.target, bands.minimum, 75, 50);
  if (value > bands.excellent) return interpolate(value, bands.excellent, bands.target, 100, 75);
  return 100;
}

export function classifyScore(score: number): ScoreClassification {
  if (score >= 85) return "EXCELLENT";
  if (score >= 70) return "ATTRACTIVE";
  if (score >= 55) return "ATTENTION";
  if (score >= 40) return "FRAGILE";
  return "CRITICAL";
}

function reason(ruleKey: string, label: string, score: number, actualValue: string, benchmark: string, message: string): ScoreReason {
  return {
    ruleKey,
    label,
    score: round(clamp(score)),
    tone: score >= 75 ? "STRENGTH" : score < 50 ? "WEAKNESS" : "NEUTRAL",
    message,
    actualValue,
    benchmark,
  };
}

function dimension(key: ScoreDimensionKey, weightedReasons: { weight: number; reason: ScoreReason }[]): ScoreDimensionResult {
  const score = weightedReasons.reduce((total, item) => total + item.reason.score * item.weight, 0);
  return {
    key,
    score: round(score),
    weight: DIMENSION_WEIGHTS[key],
    weightedScore: round(score * DIMENSION_WEIGHTS[key], 2),
    reasons: weightedReasons.map((item) => item.reason),
  };
}

function pct(value: number) {
  return `${round(value, 1)}%`;
}

function ratioPct(value: number) {
  return pct(value * 100);
}

export function calculateRedeScore({ result, resilience }: ScoreInput): RedeScoreResult {
  const metrics = result.metrics;
  const input = result.assumptions;
  const vgv = Number(metrics.vgv);
  const policy = returnBenchmarks(input);
  const margin = Number(metrics.marginOnVgv) * 100;
  const roi = metrics.roi === null ? Number.NEGATIVE_INFINITY : Number(metrics.roi) * 100;
  const irr = metrics.annualIrr === null ? Number.NEGATIVE_INFINITY : Number(metrics.annualIrr) * 100;
  const npvToVgv = vgv === 0 ? -1 : Number(metrics.npv) / vgv;

  const returnDimension = dimension("RETURN", [
    { weight: 0.30, reason: reason("RETURN_MARGIN", "Margem sobre VGV", higherIsBetter(margin, policy.margin), pct(margin), `mínimo ${pct(policy.margin.minimum)}`, margin >= policy.margin.minimum ? "Margem com aderência à política." : "Margem abaixo da política de investimento.") },
    { weight: 0.25, reason: reason("RETURN_ROI", "ROI do equity", higherIsBetter(roi, policy.roi), Number.isFinite(roi) ? pct(roi) : "não calculável", `mínimo ${pct(policy.roi.minimum)}`, roi >= policy.roi.minimum ? "ROI remunera o capital próprio." : "ROI não alcança o retorno mínimo.") },
    { weight: 0.25, reason: reason("RETURN_IRR", "TIR anual", higherIsBetter(irr, policy.irr), Number.isFinite(irr) ? pct(irr) : "não calculável", `mínimo ${pct(policy.irr.minimum)}`, irr >= policy.irr.minimum ? "TIR supera a meta institucional." : "TIR abaixo da meta institucional.") },
    { weight: 0.20, reason: reason("RETURN_NPV", "VPL / VGV", higherIsBetter(npvToVgv, policy.npvToVgv), ratioPct(npvToVgv), "mínimo 0%", npvToVgv >= 0 ? "VPL positivo após o custo de capital." : "VPL negativo destrói valor econômico.") },
  ]);

  const exposurePolicyUse = Number(input.policy.maximumExposure) === 0 ? 2 : Number(metrics.maximumCashExposure) / Number(input.policy.maximumExposure);
  const equityToVgv = Number(metrics.equityCapitalRequired) / vgv;
  const maxDebt = Math.max(...result.cashFlow.map((row) => Number(row.outstandingDebt)), 0);
  const fundingLimitUse = Number(input.financingLimit) === 0 ? (maxDebt > 0 ? 2 : 0) : maxDebt / Number(input.financingLimit);
  const exposureDuration = result.cashFlow.filter((row) => Number(row.cumulativeProjectCash) < 0).length;
  const exposureToVgv = Number(metrics.maximumCashExposure) / vgv;
  const capitalDimension = dimension("CAPITAL", [
    { weight: 0.30, reason: reason("CAPITAL_EXPOSURE_POLICY", "Uso do limite de exposição", lowerIsBetter(exposurePolicyUse, CAPITAL_BENCHMARKS.exposurePolicyUse), ratioPct(exposurePolicyUse), "até 100% da política", exposurePolicyUse <= 1 ? "Exposição dentro da política." : "Exposição supera o limite institucional.") },
    { weight: 0.20, reason: reason("CAPITAL_EQUITY", "Capital próprio / VGV", lowerIsBetter(equityToVgv, CAPITAL_BENCHMARKS.equityToVgv), ratioPct(equityToVgv), "alvo até 22%", "Mede a intensidade de capital próprio exigida.") },
    { weight: 0.20, reason: reason("CAPITAL_FUNDING", "Uso do limite de funding", lowerIsBetter(fundingLimitUse, CAPITAL_BENCHMARKS.fundingLimitUse), ratioPct(fundingLimitUse), "alvo até 80%", fundingLimitUse <= 0.8 ? "Funding possui folga operacional." : "Funding opera com pouca folga.") },
    { weight: 0.15, reason: reason("CAPITAL_DURATION", "Duração da exposição", lowerIsBetter(exposureDuration, CAPITAL_BENCHMARKS.exposureDurationMonths), `${exposureDuration} meses`, "alvo até 18 meses", "Mede por quanto tempo o caixa do projeto permanece negativo.") },
    { weight: 0.15, reason: reason("CAPITAL_EXPOSURE_VGV", "Exposição / VGV", lowerIsBetter(exposureToVgv, CAPITAL_BENCHMARKS.exposureToVgv), ratioPct(exposureToVgv), "alvo até 35%", "Relaciona o pico de caixa ao porte econômico do projeto.") },
  ]);

  const units = input.units;
  const soldBeforeDelivery = result.cashFlow.filter((row) => row.month < metrics.deliveryMonth).reduce((sum, row) => sum + Number(row.unitsSold), 0) / units;
  const inventoryAtDelivery = Math.max(0, 1 - soldBeforeDelivery);
  const postDeliveryReceipts = result.cashFlow.filter((row) => row.month >= metrics.deliveryMonth).reduce((sum, row) => sum + Number(row.receipts), 0) / vgv;
  const receiptsBeforeDelivery = result.cashFlow.filter((row) => row.month < metrics.deliveryMonth).reduce((sum, row) => sum + Number(row.receipts), 0) / vgv;
  const salesDuration = Math.max(1, metrics.salesEndMonth - metrics.salesStartMonth + 1);
  const commercialDimension = dimension("COMMERCIAL", [
    { weight: 0.20, reason: reason("COMMERCIAL_DURATION", "Duração das vendas", lowerIsBetter(salesDuration, COMMERCIAL_BENCHMARKS.salesDurationMonths), `${salesDuration} meses`, "alvo até 18 meses", "Prazo necessário para absorver todas as unidades.") },
    { weight: 0.25, reason: reason("COMMERCIAL_PRE_DELIVERY", "Vendas antes da entrega", higherIsBetter(soldBeforeDelivery, COMMERCIAL_BENCHMARKS.soldBeforeDelivery), ratioPct(soldBeforeDelivery), "alvo 75%", soldBeforeDelivery >= 0.75 ? "Boa absorção antes da entrega." : "Estoque relevante permanece para a entrega.") },
    { weight: 0.20, reason: reason("COMMERCIAL_INVENTORY", "Estoque na entrega", lowerIsBetter(inventoryAtDelivery, COMMERCIAL_BENCHMARKS.inventoryAtDelivery), ratioPct(inventoryAtDelivery), "alvo até 20%", "Mede o estoque pronto que ainda precisa ser comercializado.") },
    { weight: 0.20, reason: reason("COMMERCIAL_POST_KEYS", "Receita pós-chaves", lowerIsBetter(postDeliveryReceipts, COMMERCIAL_BENCHMARKS.postDeliveryReceipts), ratioPct(postDeliveryReceipts), "alvo até 35%", postDeliveryReceipts <= 0.35 ? "Receita pouco concentrada após as chaves." : "Recebimentos concentrados após a entrega.") },
    { weight: 0.15, reason: reason("COMMERCIAL_RECEIPTS", "Recebimentos pré-entrega", higherIsBetter(receiptsBeforeDelivery, COMMERCIAL_BENCHMARKS.receiptsBeforeDelivery), ratioPct(receiptsBeforeDelivery), "alvo 60%", "Geração comercial de caixa durante aprovação e obra.") },
  ]);

  const totalCostToVgv = Number(metrics.totalCost) / vgv;
  const constructionToVgv = Number(metrics.constructionCost) / vgv;
  const landToVgv = Number(metrics.landCost) / vgv;
  const indirectRate = Number(input.indirectCostsRate);
  const commercialBurden = (Number(input.commissionRate) + Number(input.marketingRate) + Number(input.taxRate)) / 100;
  const contingency = Number(input.contingencyRate);
  const minimumContingency = Number(input.policy.minimumContingencyRate);
  const contingencyBands = { critical: 0, minimum: minimumContingency, target: minimumContingency + 2, excellent: minimumContingency + 4 };
  const costDimension = dimension("COST", [
    { weight: 0.25, reason: reason("COST_TOTAL", "Custo total / VGV", lowerIsBetter(totalCostToVgv, COST_BENCHMARKS.totalCostToVgv), ratioPct(totalCostToVgv), "alvo até 70%", "Eficiência econômica global da estrutura de custos.") },
    { weight: 0.20, reason: reason("COST_CONSTRUCTION", "Obra / VGV", lowerIsBetter(constructionToVgv, COST_BENCHMARKS.constructionToVgv), ratioPct(constructionToVgv), "alvo até 40%", "Peso da construção no valor potencial de vendas.") },
    { weight: 0.15, reason: reason("COST_LAND", "Terreno / VGV", lowerIsBetter(landToVgv, COST_BENCHMARKS.landToVgv), ratioPct(landToVgv), "alvo até 18%", "Pressão do terreno sobre a equação financeira.") },
    { weight: 0.15, reason: reason("COST_INDIRECT", "Custos indiretos", lowerIsBetter(indirectRate, COST_BENCHMARKS.indirectRate), pct(indirectRate), "alvo até 8%", "Carga indireta declarada sobre a obra.") },
    { weight: 0.15, reason: reason("COST_COMMERCIAL", "Comercial e tributos", lowerIsBetter(commercialBurden, COST_BENCHMARKS.commercialBurden), ratioPct(commercialBurden), "alvo até 8%", "Comissão, marketing e impostos sobre vendas.") },
    { weight: 0.10, reason: reason("COST_CONTINGENCY", "Contingência", higherIsBetter(contingency, contingencyBands), pct(contingency), `mínimo ${pct(minimumContingency)}`, contingency >= minimumContingency ? "Contingência atende à política." : "Contingência insuficiente para a política.") },
  ]);

  const breakRate = resilience.totalStressCases === 0 ? 0 : resilience.stressPolicyBreaks / resilience.totalStressCases;
  const resilienceDimension = dimension("RESILIENCE", [
    { weight: 0.25, reason: reason("RESILIENCE_MARGIN", "Perda de margem em stress", lowerIsBetter(resilience.worstMarginLossPoints, RESILIENCE_BENCHMARKS.marginLossPoints), `${round(resilience.worstMarginLossPoints)} p.p.`, "alvo até 6 p.p.", "Maior deterioração de margem observada.") },
    { weight: 0.20, reason: reason("RESILIENCE_ROI", "Perda de ROI", lowerIsBetter(resilience.worstRoiLossPoints, RESILIENCE_BENCHMARKS.roiLossPoints), `${round(resilience.worstRoiLossPoints)} p.p.`, "alvo até 25 p.p.", "Maior perda de retorno do equity.") },
    { weight: 0.20, reason: reason("RESILIENCE_IRR", "Deterioração da TIR", lowerIsBetter(resilience.worstIrrLossPoints, RESILIENCE_BENCHMARKS.irrLossPoints), `${round(resilience.worstIrrLossPoints)} p.p.`, "alvo até 15 p.p.", "Maior perda de TIR anual.") },
    { weight: 0.20, reason: reason("RESILIENCE_EXPOSURE", "Aumento de exposição", lowerIsBetter(resilience.worstExposureIncreaseRate, RESILIENCE_BENCHMARKS.exposureIncreaseRate), ratioPct(resilience.worstExposureIncreaseRate), "alvo até 15%", "Maior pressão adicional sobre caixa.") },
    { weight: 0.15, reason: reason("RESILIENCE_POLICIES", "Stress com políticas violadas", lowerIsBetter(breakRate, RESILIENCE_BENCHMARKS.stressPolicyBreakRate), `${resilience.stressPolicyBreaks}/${resilience.totalStressCases}`, "alvo nenhum", "Quantidade de combinações que rompem políticas mínimas.") },
  ]);

  const totalDuration = Math.max(metrics.deliveryMonth, metrics.salesEndMonth);
  const relevantCashMonth = result.cashFlow.find((row) => Number(row.receipts) >= vgv * 0.01)?.month ?? totalDuration;
  const outflows = result.cashFlow.map((row) => Number(row.landCost) + Number(row.constructionCost) + Number(row.indirectCosts) + Number(row.contingency) + Number(row.marketing) + Number(row.commission) + Number(row.taxes) + Number(row.interest));
  const outflowConcentration = Math.max(...outflows, 0) / Number(metrics.totalCost);
  const executionDimension = dimension("EXECUTION", [
    { weight: 0.25, reason: reason("EXECUTION_TOTAL", "Duração total", lowerIsBetter(totalDuration, EXECUTION_BENCHMARKS.totalDurationMonths), `${totalDuration} meses`, "alvo até 28 meses", "Tempo até entrega ou encerramento das vendas.") },
    { weight: 0.20, reason: reason("EXECUTION_APPROVAL", "Prazo de aprovação", lowerIsBetter(input.approvalMonths, EXECUTION_BENCHMARKS.approvalMonths), `${input.approvalMonths} meses`, "alvo até 8 meses", "Período regulatório antes da obra.") },
    { weight: 0.20, reason: reason("EXECUTION_BUILD", "Prazo de obra", lowerIsBetter(input.constructionMonths, EXECUTION_BENCHMARKS.constructionMonths), `${input.constructionMonths} meses`, "alvo até 24 meses", "Duração física da construção.") },
    { weight: 0.20, reason: reason("EXECUTION_CASH", "Primeira geração relevante de caixa", lowerIsBetter(relevantCashMonth, EXECUTION_BENCHMARKS.relevantCashMonth), `mês ${relevantCashMonth}`, "alvo até mês 12", "Primeiro recebimento mensal igual ou superior a 1% do VGV.") },
    { weight: 0.15, reason: reason("EXECUTION_OUTFLOW", "Concentração de desembolsos", lowerIsBetter(outflowConcentration, EXECUTION_BENCHMARKS.outflowConcentration), ratioPct(outflowConcentration), "alvo até 12%", "Maior desembolso mensal sobre o custo total.") },
  ]);

  const dimensions = [returnDimension, capitalDimension, commercialDimension, costDimension, resilienceDimension, executionDimension];
  const rawScore = round(dimensions.reduce((total, item) => total + item.score * item.weight, 0));
  const gates: ScoreGate[] = [];
  if (margin < policy.margin.critical) gates.push({ key: "GATE_CRITICAL_MARGIN", reason: `Margem de ${pct(margin)} abaixo do limite crítico de ${pct(policy.margin.critical)}.`, maximumScore: 54 });
  if (exposurePolicyUse > 1.5) gates.push({ key: "GATE_EXPOSURE", reason: "Exposição supera 150% do limite institucional.", maximumScore: 54 });
  if (Number(metrics.npv) < 0) gates.push({ key: "GATE_NEGATIVE_NPV", reason: "VPL negativo após o custo de capital.", maximumScore: 39 });
  if (Number(metrics.profit) < 0) gates.push({ key: "GATE_NEGATIVE_PROFIT", reason: "Estrutura apresenta prejuízo econômico.", maximumScore: 39 });
  if (resilience.basicStressInsolvent) gates.push({ key: "GATE_MODERATE_STRESS", reason: "Stress moderado torna lucro ou VPL negativo.", maximumScore: 54 });

  const penalties: ScorePenalty[] = [];
  if (postDeliveryReceipts > 0.60) penalties.push({ key: "PENALTY_POST_KEYS", reason: "Mais de 60% dos recebimentos estão concentrados após a entrega.", points: 5 });
  if (exposureDuration > 24) penalties.push({ key: "PENALTY_LONG_EXPOSURE", reason: "Exposição negativa persiste por mais de 24 meses.", points: 4 });
  const marginHeadroom = margin - Number(input.policy.minimumMarginRate);
  if (marginHeadroom >= 0 && marginHeadroom < 2) penalties.push({ key: "PENALTY_THIN_MARGIN", reason: "Margem possui menos de 2 p.p. de folga sobre o mínimo.", points: 4 });
  if (fundingLimitUse > 0.90) penalties.push({ key: "PENALTY_FUNDING_HEADROOM", reason: "Uso do limite de funding supera 90%.", points: 4 });

  const scoreAfterPenalties = clamp(rawScore - penalties.reduce((total, item) => total + item.points, 0));
  const gateLimit = gates.length ? Math.min(...gates.map((item) => item.maximumScore)) : 100;
  const totalScore = Math.round(Math.min(scoreAfterPenalties, gateLimit));
  const strengths = dimensions.flatMap((item) => item.reasons).filter((item) => item.tone === "STRENGTH").sort((a, b) => b.score - a.score).slice(0, 3).map((item) => item.message);
  const weaknesses = dimensions.flatMap((item) => item.reasons).filter((item) => item.tone === "WEAKNESS").sort((a, b) => a.score - b.score).slice(0, 3).map((item) => item.message);

  return {
    policyVersion: SCORE_POLICY_VERSION,
    totalScore,
    rawScore,
    scoreAfterPenalties: round(scoreAfterPenalties),
    classification: classifyScore(totalScore),
    dimensions,
    gates,
    penalties,
    explanation: {
      strengths,
      weaknesses,
      criticalFactors: [...gates.map((item) => item.reason), ...resilience.criticalFactors].slice(0, 4),
    },
  };
}
