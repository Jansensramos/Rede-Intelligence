import Decimal from "decimal.js";
import { projectAssumptionsSchema } from "./schema";
import {
  D,
  HUNDRED,
  ONE,
  ZERO,
  annualToMonthlyRate,
  decimalString,
  irr,
  moneyString,
  normalizedConstructionWeights,
  npv,
  rate,
} from "./math";
import { applyScenario, SCENARIOS } from "./scenarios";
import {
  ENGINE_VERSION,
  type CalculationTrace,
  type CashFlowMonth,
  type FinancialMetrics,
  type FinancialResult,
  type ProjectAssumptions,
  type ScenarioKey,
} from "./types";

interface MutableMonth {
  month: number;
  unitsSold: Decimal;
  salesValue: Decimal;
  receipts: Decimal;
  landCost: Decimal;
  constructionCost: Decimal;
  indirectCosts: Decimal;
  contingency: Decimal;
  marketing: Decimal;
  commission: Decimal;
  taxes: Decimal;
  operatingNet: Decimal;
  interest: Decimal;
  financingDraw: Decimal;
  financingRepayment: Decimal;
  equityFlow: Decimal;
  cumulativeProjectCash: Decimal;
  cumulativeEquityCash: Decimal;
  outstandingDebt: Decimal;
}

function emptyMonth(month: number): MutableMonth {
  return {
    month,
    unitsSold: ZERO,
    salesValue: ZERO,
    receipts: ZERO,
    landCost: ZERO,
    constructionCost: ZERO,
    indirectCosts: ZERO,
    contingency: ZERO,
    marketing: ZERO,
    commission: ZERO,
    taxes: ZERO,
    operatingNet: ZERO,
    interest: ZERO,
    financingDraw: ZERO,
    financingRepayment: ZERO,
    equityFlow: ZERO,
    cumulativeProjectCash: ZERO,
    cumulativeEquityCash: ZERO,
    outstandingDebt: ZERO,
  };
}

function sum(rows: MutableMonth[], field: keyof MutableMonth): Decimal {
  return rows.reduce((total, row) => {
    const value = row[field];
    return value instanceof Decimal ? total.plus(value) : total;
  }, ZERO);
}

function trace(
  metric: keyof FinancialMetrics,
  label: string,
  formula: string,
  inputs: CalculationTrace["inputs"],
  result: string,
): CalculationTrace {
  return { id: `${ENGINE_VERSION}:${metric}`, metric, label, classification: "calculo", formula, inputs, result, engineVersion: ENGINE_VERSION };
}

export function calculateProject(
  rawInput: ProjectAssumptions,
  scenario: ScenarioKey = "base",
  calculatedAt = new Date().toISOString(),
): FinancialResult {
  const baseInput = projectAssumptionsSchema.parse(rawInput) as ProjectAssumptions;
  const input = applyScenario(baseInput, scenario);

  const units = D(input.units);
  const totalPrivateArea = units.times(input.privateAreaPerUnitM2);
  const grossBuiltArea = input.grossBuiltAreaM2
    ? D(input.grossBuiltAreaM2)
    : totalPrivateArea.div(rate(input.efficiencyRate));
  const vgv = units.times(input.unitPrice);
  const landCost = D(input.landPrice);
  const constructionCost = grossBuiltArea.times(input.constructionCostPerM2);
  const indirectCosts = constructionCost.times(rate(input.indirectCostsRate));
  const contingency = constructionCost.times(rate(input.contingencyRate));
  const commission = vgv.times(rate(input.commissionRate));
  const marketing = vgv.times(rate(input.marketingRate));
  const deliveryMonth = input.approvalMonths + input.constructionMonths;
  const salesStartMonth = input.approvalMonths + input.salesStartDelayMonths;
  const activeSalesMonths = Math.ceil(units.div(input.salesVelocityUnitsMonth).toNumber());
  const salesEndMonth = salesStartMonth + activeSalesMonths - 1;
  const totalMonths = Math.max(deliveryMonth, salesEndMonth) + 1;
  const rows = Array.from({ length: totalMonths }, (_, month) => emptyMonth(month));

  rows[0].landCost = landCost;

  let remainingUnits = units;
  for (let month = salesStartMonth; month <= salesEndMonth && remainingUnits.gt(0); month += 1) {
    const sold = Decimal.min(D(input.salesVelocityUnitsMonth), remainingUnits);
    const saleValue = sold.times(input.unitPrice);
    rows[month].unitsSold = sold;
    rows[month].salesValue = saleValue;
    remainingUnits = remainingUnits.minus(sold);

    if (month >= deliveryMonth) {
      rows[month].receipts = rows[month].receipts.plus(saleValue);
    } else {
      rows[month].receipts = rows[month].receipts.plus(saleValue.times(rate(input.downPaymentRate)));
      const installmentMonths = deliveryMonth - month;
      const installment = saleValue.times(rate(input.duringConstructionRate)).div(installmentMonths);
      for (let paymentMonth = month + 1; paymentMonth <= deliveryMonth; paymentMonth += 1) {
        rows[paymentMonth].receipts = rows[paymentMonth].receipts.plus(installment);
      }
      rows[deliveryMonth].receipts = rows[deliveryMonth].receipts.plus(saleValue.times(rate(input.onDeliveryRate)));
    }
  }

  const weights = normalizedConstructionWeights(input.constructionMonths);
  weights.forEach((weight, index) => {
    const month = input.approvalMonths + index;
    rows[month].constructionCost = constructionCost.times(weight);
    rows[month].indirectCosts = indirectCosts.times(weight);
    rows[month].contingency = contingency.times(weight);
  });

  rows[salesStartMonth].marketing = rows[salesStartMonth].marketing.plus(marketing.times("0.30"));
  for (let month = salesStartMonth; month <= salesEndMonth; month += 1) {
    const salesShare = rows[month].salesValue.div(vgv);
    rows[month].marketing = rows[month].marketing.plus(marketing.times("0.70").times(salesShare));
    rows[month].commission = rows[month].salesValue.times(rate(input.commissionRate));
  }

  const monthlyFinancingRate = annualToMonthlyRate(input.annualFinancingRate);
  const financingLimit = D(input.financingLimit);
  let outstandingDebt = ZERO;
  let cumulativeProjectCash = ZERO;
  let cumulativeEquityCash = ZERO;

  rows.forEach((row) => {
    row.taxes = row.receipts.times(rate(input.taxRate));
    const operatingOutflow = row.landCost
      .plus(row.constructionCost)
      .plus(row.indirectCosts)
      .plus(row.contingency)
      .plus(row.marketing)
      .plus(row.commission)
      .plus(row.taxes);
    row.operatingNet = row.receipts.minus(operatingOutflow);
    row.interest = outstandingDebt.times(monthlyFinancingRate);
    const cashBeforeFunding = row.operatingNet.minus(row.interest);

    if (cashBeforeFunding.lt(0)) {
      row.financingDraw = Decimal.min(cashBeforeFunding.neg(), financingLimit.minus(outstandingDebt));
      outstandingDebt = outstandingDebt.plus(row.financingDraw);
      row.equityFlow = cashBeforeFunding.plus(row.financingDraw);
    } else {
      row.financingRepayment = Decimal.min(cashBeforeFunding, outstandingDebt);
      outstandingDebt = outstandingDebt.minus(row.financingRepayment);
      row.equityFlow = cashBeforeFunding.minus(row.financingRepayment);
    }

    cumulativeProjectCash = cumulativeProjectCash.plus(cashBeforeFunding);
    cumulativeEquityCash = cumulativeEquityCash.plus(row.equityFlow);
    row.cumulativeProjectCash = cumulativeProjectCash;
    row.cumulativeEquityCash = cumulativeEquityCash;
    row.outstandingDebt = outstandingDebt;
  });

  if (outstandingDebt.gt(0)) {
    const finalRow = rows.at(-1)!;
    finalRow.financingRepayment = finalRow.financingRepayment.plus(outstandingDebt);
    finalRow.equityFlow = finalRow.equityFlow.minus(outstandingDebt);
    finalRow.outstandingDebt = ZERO;
    outstandingDebt = ZERO;
    cumulativeEquityCash = ZERO;
    rows.forEach((row) => {
      cumulativeEquityCash = cumulativeEquityCash.plus(row.equityFlow);
      row.cumulativeEquityCash = cumulativeEquityCash;
    });
  }

  const taxes = sum(rows, "taxes");
  const financingCost = sum(rows, "interest");
  const fundingNeed = sum(rows, "financingDraw");
  const totalCost = landCost
    .plus(constructionCost)
    .plus(indirectCosts)
    .plus(contingency)
    .plus(commission)
    .plus(marketing)
    .plus(taxes)
    .plus(financingCost);
  const netRevenue = vgv.minus(commission).minus(marketing).minus(taxes);
  const profit = vgv.minus(totalCost);
  const marginOnVgv = profit.div(vgv);
  const marginOnNetRevenue = netRevenue.eq(0) ? ZERO : profit.div(netRevenue);

  let minimumProjectCash = ZERO;
  let maximumExposureMonth = 0;
  let minimumEquityCash = ZERO;
  rows.forEach((row) => {
    if (row.cumulativeProjectCash.lt(minimumProjectCash)) {
      minimumProjectCash = row.cumulativeProjectCash;
      maximumExposureMonth = row.month;
    }
    if (row.cumulativeEquityCash.lt(minimumEquityCash)) minimumEquityCash = row.cumulativeEquityCash;
  });
  const maximumCashExposure = minimumProjectCash.neg();
  const equityCapitalRequired = minimumEquityCash.neg();
  const roi = equityCapitalRequired.gt(0) ? profit.div(equityCapitalRequired) : null;
  const equityFlows = rows.map((row) => row.equityFlow);
  const monthlyIrr = irr(equityFlows);
  const annualIrr = monthlyIrr ? ONE.plus(monthlyIrr).pow(12).minus(ONE) : null;
  const monthlyDiscountRate = annualToMonthlyRate(input.annualDiscountRate);
  const projectNpv = npv(equityFlows, monthlyDiscountRate);

  let hasBeenNegative = false;
  let paybackMonth: number | null = null;
  rows.forEach((row) => {
    if (row.cumulativeEquityCash.lt(0)) hasBeenNegative = true;
    if (hasBeenNegative && paybackMonth === null && row.cumulativeEquityCash.gte(0)) paybackMonth = row.month;
  });

  const variableRate = rate(input.taxRate).plus(rate(input.commissionRate)).plus(rate(input.marketingRate));
  const fixedAndFinancialCosts = landCost.plus(constructionCost).plus(indirectCosts).plus(contingency).plus(financingCost);
  const breakEvenVgv = fixedAndFinancialCosts.div(ONE.minus(variableRate));
  const breakEvenUnits = breakEvenVgv.div(input.unitPrice).ceil().toNumber();
  const breakEvenRate = breakEvenVgv.div(vgv);

  const metrics: FinancialMetrics = {
    totalPrivateAreaM2: decimalString(totalPrivateArea),
    grossBuiltAreaM2: decimalString(grossBuiltArea),
    vgv: moneyString(vgv),
    netRevenue: moneyString(netRevenue),
    landCost: moneyString(landCost),
    constructionCost: moneyString(constructionCost),
    indirectCosts: moneyString(indirectCosts),
    contingency: moneyString(contingency),
    commission: moneyString(commission),
    marketing: moneyString(marketing),
    taxes: moneyString(taxes),
    financingCost: moneyString(financingCost),
    totalCost: moneyString(totalCost),
    profit: moneyString(profit),
    marginOnVgv: decimalString(marginOnVgv),
    marginOnNetRevenue: decimalString(marginOnNetRevenue),
    roi: roi ? decimalString(roi) : null,
    annualIrr: annualIrr ? decimalString(annualIrr) : null,
    npv: moneyString(projectNpv),
    paybackMonth,
    maximumCashExposure: moneyString(maximumCashExposure),
    maximumExposureMonth,
    equityCapitalRequired: moneyString(equityCapitalRequired),
    fundingNeed: moneyString(fundingNeed),
    breakEvenVgv: moneyString(breakEvenVgv),
    breakEvenUnits,
    breakEvenRate: decimalString(breakEvenRate),
    deliveryMonth,
    salesEndMonth,
    salesStartMonth,
  };

  const cashFlow: CashFlowMonth[] = rows.map((row) => ({
    month: row.month,
    phase: row.month < input.approvalMonths ? "aprovacao" : row.month < deliveryMonth ? "obra" : "pos-entrega",
    unitsSold: decimalString(row.unitsSold),
    salesValue: decimalString(row.salesValue),
    receipts: decimalString(row.receipts),
    landCost: decimalString(row.landCost),
    constructionCost: decimalString(row.constructionCost),
    indirectCosts: decimalString(row.indirectCosts),
    contingency: decimalString(row.contingency),
    marketing: decimalString(row.marketing),
    commission: decimalString(row.commission),
    taxes: decimalString(row.taxes),
    operatingNet: decimalString(row.operatingNet),
    interest: decimalString(row.interest),
    financingDraw: decimalString(row.financingDraw),
    financingRepayment: decimalString(row.financingRepayment),
    equityFlow: decimalString(row.equityFlow),
    cumulativeProjectCash: decimalString(row.cumulativeProjectCash),
    cumulativeEquityCash: decimalString(row.cumulativeEquityCash),
    outstandingDebt: decimalString(row.outstandingDebt),
  }));

  const auditTrail: CalculationTrace[] = [
    trace("vgv", "VGV", "unidades × preço por unidade", [
      { label: "Unidades", value: input.units.toString(), source: "premissa" },
      { label: "Preço por unidade", value: input.unitPrice, source: "premissa" },
    ], metrics.vgv),
    trace("grossBuiltAreaM2", "Área construída", input.grossBuiltAreaM2 ? "área construída informada" : "área privativa total ÷ eficiência", [
      { label: "Área privativa total", value: metrics.totalPrivateAreaM2, source: "calculo" },
      { label: "Eficiência", value: input.efficiencyRate, source: "premissa" },
    ], metrics.grossBuiltAreaM2),
    trace("constructionCost", "Custo de construção", "área construída × custo de obra/m²", [
      { label: "Área construída", value: metrics.grossBuiltAreaM2, source: "calculo" },
      { label: "Custo de obra/m²", value: input.constructionCostPerM2, source: "premissa" },
    ], metrics.constructionCost),
    trace("profit", "Lucro", "VGV - custo total", [
      { label: "VGV", value: metrics.vgv, source: "calculo" },
      { label: "Custo total", value: metrics.totalCost, source: "calculo" },
    ], metrics.profit),
    trace("maximumCashExposure", "Exposição máxima", "módulo do menor fluxo acumulado antes do funding", [
      { label: "Mês crítico", value: metrics.maximumExposureMonth.toString(), source: "calculo" },
    ], metrics.maximumCashExposure),
    trace("roi", "ROI", "lucro ÷ capital próprio necessário", [
      { label: "Lucro", value: metrics.profit, source: "calculo" },
      { label: "Capital próprio", value: metrics.equityCapitalRequired, source: "calculo" },
    ], metrics.roi ?? "não calculável"),
    trace("annualIrr", "TIR anual", "(1 + TIR mensal do fluxo do equity)^12 - 1", [
      { label: "Fluxos mensais", value: `${cashFlow.length} competências`, source: "calculo" },
    ], metrics.annualIrr ?? "não calculável"),
    trace("breakEvenVgv", "VGV de equilíbrio", "custos fixos e financeiros ÷ (1 - taxas variáveis)", [
      { label: "Taxas variáveis", value: variableRate.times(HUNDRED).toFixed(2) + "%", source: "premissa" },
    ], metrics.breakEvenVgv),
  ];

  return {
    scenario,
    scenarioLabel: SCENARIOS[scenario].label,
    assumptions: input,
    metrics,
    cashFlow,
    auditTrail,
    engineVersion: ENGINE_VERSION,
    calculatedAt,
  };
}

export function calculateAllScenarios(input: ProjectAssumptions, calculatedAt = new Date().toISOString()): Record<ScenarioKey, FinancialResult> {
  return {
    conservative: calculateProject(input, "conservative", calculatedAt),
    base: calculateProject(input, "base", calculatedAt),
    aggressive: calculateProject(input, "aggressive", calculatedAt),
  };
}
