// Motor determinístico de Capacidade de Pagamento e Compra (plano 9J, seção I). Regras de
// crédito são parâmetros versionados (AffordabilityPolicy) — nunca constantes universais
// embutidas no código. O sistema nunca substitui a análise de crédito individual de um banco;
// projeta a fronteira de acessibilidade econômica da população local.

export interface AffordabilityPolicyParams {
  maxCommitmentRate: number; // ex.: 0.30 — comprometimento máximo de renda com a prestação
  annualInterestRate: number; // ex.: 0.11 — taxa efetiva anual do financiamento
  termMonths: number; // ex.: 360
  minDownPaymentRate: number; // ex.: 0.20
}

export interface AffordabilityResult {
  maxInstallment: number;
  financeableAmount: number;
  affordableTicket: number;
}

// PV de uma anuidade constante (aproximação Price parametrizada) — usada apenas para projetar a
// fronteira de financiamento suportável, nunca uma oferta bancária real.
function presentValueAnnuity(payment: number, monthlyRate: number, months: number): number {
  if (monthlyRate === 0) return payment * months;
  return (payment * (1 - Math.pow(1 + monthlyRate, -months))) / monthlyRate;
}

export function calculateAffordability(medianHouseholdIncome: number, policy: AffordabilityPolicyParams): AffordabilityResult {
  const maxInstallment = medianHouseholdIncome * policy.maxCommitmentRate;
  const monthlyRate = Math.pow(1 + policy.annualInterestRate, 1 / 12) - 1;
  const financeableAmount = presentValueAnnuity(maxInstallment, monthlyRate, policy.termMonths);
  const affordableTicket = policy.minDownPaymentRate >= 1 ? financeableAmount : financeableAmount / (1 - policy.minDownPaymentRate);
  return { maxInstallment, financeableAmount, affordableTicket };
}

export interface AffordableAreaInput {
  affordableTicket: number;
  pricePerSqm: number;
}

// Área máxima suportável = Ticket suportável / Preço por m² da região (plano 9J, seção AB.1).
export function calculateAffordableAreaM2(input: AffordableAreaInput): number {
  if (input.pricePerSqm <= 0) return 0;
  return input.affordableTicket / input.pricePerSqm;
}
