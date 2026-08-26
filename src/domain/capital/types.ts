/**
 * Fase 9N — Capital & Funding Intelligence.
 * Tipos do domínio de necessidade/estruturação de capital. Nada aqui recalcula viabilidade:
 * a curva de caixa e os indicadores oficiais (`maximumCashExposure`, `equityCapitalRequired`,
 * `operatingNet`, `annualIrr`, `npv`) vêm sempre do REDE Engine (`@/domain/financial`), Base
 * Aprovada — este módulo só lê, combina com estrutura de funding e nunca substitui esses valores.
 */
import type { DecimalString } from "@/domain/financial/types";

export type FundingProposalKind =
  | "EQUITY_PROPRIO"
  | "INVESTIDOR"
  | "MUTUO"
  | "BANCO"
  | "FINANCIAMENTO_PRODUCAO"
  | "SBPE"
  | "FGTS"
  | "CRI"
  | "SECURITIZACAO"
  | "FUNDO"
  | "MEZANINO"
  | "PERMUTA_FINANCEIRA"
  | "PERMUTA_ECONOMICA"
  | "HIBRIDO"
  | "OUTRO";

export type FundingIndexer = "CDI" | "IPCA" | "IGPM" | "TR" | "SELIC" | "PRE_FIXADO" | "OUTRO";

export type AmortizationSystem = "PRICE" | "SAC" | "BULLET";

export type FundingScenarioKind = "NO_FUNDING" | "EQUITY" | "DEBT" | "HYBRID" | "PROPOSAL_COMPARISON";

/** Curva mensal de necessidade de capital, derivada de `CashFlowMonth[]` da Base Aprovada. */
export interface CapitalNeedMonth {
  month: number;
  phase: "aprovacao" | "obra" | "pos-entrega";
  /** `cumulativeProjectCash` do REDE Engine — caixa do projeto antes de qualquer decisão de funding. */
  projectCashBalance: DecimalString;
  /** `max(0, -projectCashBalance)` — quanto falta cobrir naquele mês. */
  deficit: DecimalString;
}

export interface CapitalNeedInput {
  cashFlow: CapitalNeedMonth[];
  /** Igual a `metrics.maximumCashExposure` da Base Aprovada — nunca recalculado aqui. */
  totalCapitalNeed: DecimalString;
  peakExposureMonth: number;
  /** Aportes reais já registrados (ex.: `IntercompanyTransaction` nature=APORTE aprovados). */
  equityContributed: DecimalString;
  /** Soma de liberações já efetivadas de funding aprovado (0 até existir persistência da Fase 9N). */
  fundingDisbursed: DecimalString;
}

export interface CapitalNeedResult {
  totalCapitalNeed: DecimalString;
  peakExposureMonth: number;
  monthlyCurve: CapitalNeedMonth[];
  deficitMonths: number[];
  equityContributed: DecimalString;
  fundingDisbursed: DecimalString;
  fundingStillNeeded: DecimalString;
  fullyCovered: boolean;
}

export interface FundingFeeInput {
  /** Taxa de estruturação/originação, percentual sobre o valor liberado, cobrada no desembolso. */
  upfrontFeeRate: DecimalString;
  /** Taxas recorrentes (ex.: taxa de administração anual), percentual ao ano sobre saldo devedor. */
  recurringFeeRateAnnual: DecimalString;
  /** IOF quando aplicável, percentual sobre o valor liberado — custo nomeado à parte de `upfrontFeeRate` (revisão do schema §3), cobrado junto ao desembolso. */
  iofRate?: DecimalString;
}

/** Cronograma de liberação — quando o capital efetivamente entra no caixa do empreendimento. */
export interface DisbursementScheduleEntry {
  month: number;
  amount: DecimalString;
}

export interface FundingProposalInput {
  id: string;
  providerName: string;
  kind: FundingProposalKind;
  amount: DecimalString;
  indexer: FundingIndexer;
  /** Taxa nominal anual total já com spread sobre o indexador (referência informada na proposta). */
  annualNominalRate: DecimalString;
  termMonths: number;
  graceMonths: number;
  amortizationSystem: AmortizationSystem;
  fees: FundingFeeInput;
  /** Se omitido, assume-se um único desembolso no mês 0. */
  disbursementSchedule?: DisbursementScheduleEntry[];
}

export interface DebtServiceMonth {
  month: number;
  disbursement: DecimalString;
  openingBalance: DecimalString;
  interest: DecimalString;
  amortization: DecimalString;
  fees: DecimalString;
  installment: DecimalString;
  closingBalance: DecimalString;
}

export interface ProposalComparisonResult {
  proposalId: string;
  providerName: string;
  nominalAnnualCost: DecimalString;
  /** Custo Efetivo Total anualizado — IRR do fluxo (líquido de fees) sob a ótica do tomador. */
  effectiveAnnualCost: DecimalString | null;
  totalCost: DecimalString;
  peakDebt: DecimalString;
  debtService: DebtServiceMonth[];
  /** Impacto no caixa do projeto: `projectCashBalance` original somado ao fluxo desta proposta. */
  cashImpact: { month: number; balanceWithFunding: DecimalString }[];
  /** Margem/TIR/ROI recombinando `operatingNet` da Base Aprovada com o serviço da dívida — nunca mutando a Base. */
  impact: {
    totalCostWithFinancing: DecimalString;
    marginOnVgvWithFinancing: DecimalString;
    annualIrrWithFinancing: DecimalString | null;
    roiWithFinancing: DecimalString | null;
    peakEquityExposureWithFinancing: DecimalString;
  };
  /** DSCR médio (NOI/serviço da dívida) somente nos meses com serviço de dívida > 0; null se não houver dados suficientes. */
  averageDebtServiceCoverage: DecimalString | null;
  riskFlags: string[];
}

export interface FundingScenarioResult {
  kind: FundingScenarioKind;
  proposals: ProposalComparisonResult[];
  /** Quando há mais de uma proposta (híbrido), soma agregada do serviço de dívida combinado. */
  combinedImpact: ProposalComparisonResult["impact"] | null;
}
