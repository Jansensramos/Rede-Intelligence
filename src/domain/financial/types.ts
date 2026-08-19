export const ENGINE_VERSION = "1.0.0";

export type DecimalString = string;
export type ScenarioKey = "conservative" | "base" | "aggressive";

export interface ProjectAssumptions {
  projectName: string;
  city: string;
  state: string;
  landAreaM2: DecimalString;
  units: number;
  privateAreaPerUnitM2: DecimalString;
  grossBuiltAreaM2: DecimalString | null;
  efficiencyRate: DecimalString;
  unitPrice: DecimalString;
  landPrice: DecimalString;
  constructionCostPerM2: DecimalString;
  indirectCostsRate: DecimalString;
  contingencyRate: DecimalString;
  taxRate: DecimalString;
  commissionRate: DecimalString;
  marketingRate: DecimalString;
  approvalMonths: number;
  constructionMonths: number;
  salesVelocityUnitsMonth: DecimalString;
  salesStartDelayMonths: number;
  downPaymentRate: DecimalString;
  duringConstructionRate: DecimalString;
  onDeliveryRate: DecimalString;
  financingLimit: DecimalString;
  annualFinancingRate: DecimalString;
  annualDiscountRate: DecimalString;
  policy: {
    minimumMarginRate: DecimalString;
    minimumRoiRate: DecimalString;
    minimumIrrRate: DecimalString;
    maximumExposure: DecimalString;
    minimumContingencyRate: DecimalString;
  };
}

export interface CashFlowMonth {
  month: number;
  phase: "aprovacao" | "obra" | "pos-entrega";
  unitsSold: DecimalString;
  salesValue: DecimalString;
  receipts: DecimalString;
  landCost: DecimalString;
  constructionCost: DecimalString;
  indirectCosts: DecimalString;
  contingency: DecimalString;
  marketing: DecimalString;
  commission: DecimalString;
  taxes: DecimalString;
  operatingNet: DecimalString;
  interest: DecimalString;
  financingDraw: DecimalString;
  financingRepayment: DecimalString;
  equityFlow: DecimalString;
  cumulativeProjectCash: DecimalString;
  cumulativeEquityCash: DecimalString;
  outstandingDebt: DecimalString;
}

export interface FinancialMetrics {
  totalPrivateAreaM2: DecimalString;
  grossBuiltAreaM2: DecimalString;
  vgv: DecimalString;
  netRevenue: DecimalString;
  landCost: DecimalString;
  constructionCost: DecimalString;
  indirectCosts: DecimalString;
  contingency: DecimalString;
  commission: DecimalString;
  marketing: DecimalString;
  taxes: DecimalString;
  financingCost: DecimalString;
  totalCost: DecimalString;
  profit: DecimalString;
  marginOnVgv: DecimalString;
  marginOnNetRevenue: DecimalString;
  roi: DecimalString | null;
  annualIrr: DecimalString | null;
  npv: DecimalString;
  paybackMonth: number | null;
  maximumCashExposure: DecimalString;
  maximumExposureMonth: number;
  equityCapitalRequired: DecimalString;
  fundingNeed: DecimalString;
  breakEvenVgv: DecimalString;
  breakEvenUnits: number;
  breakEvenRate: DecimalString;
  deliveryMonth: number;
  salesEndMonth: number;
  salesStartMonth: number;
}

export interface CalculationTraceInput {
  label: string;
  value: string;
  source: "premissa" | "calculo";
}

export interface CalculationTrace {
  id: string;
  metric: keyof FinancialMetrics;
  label: string;
  classification: "calculo";
  formula: string;
  inputs: CalculationTraceInput[];
  result: string;
  engineVersion: string;
}

export interface FinancialResult {
  scenario: ScenarioKey;
  scenarioLabel: string;
  assumptions: ProjectAssumptions;
  metrics: FinancialMetrics;
  cashFlow: CashFlowMonth[];
  auditTrail: CalculationTrace[];
  engineVersion: string;
  calculatedAt: string;
}

export interface ScenarioDefinition {
  key: ScenarioKey;
  label: string;
  description: string;
  changes: string[];
}
