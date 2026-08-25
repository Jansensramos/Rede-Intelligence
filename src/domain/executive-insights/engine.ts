/**
 * Fase 9K.4A — Perguntas Executivas e Simulações de Decisão (ordem de serviço da fase).
 *
 * Engines determinísticas e puras (sem I/O, sem LLM) que respondem às seis perguntas de negócio
 * pedidas pela fase:
 *  1. `computeSalesContribution` — quanto realmente sobra das vendas (contribuição/margem real).
 *  2. `computeRunwayScenarios` — quanto tempo o caixa aguenta (cenário atual + stress de vendas).
 *  3. `describeProjectBreakEven` / `aggregateCorporateBreakEven` — ponto de equilíbrio.
 *  4. `simulateHiring` — dá para contratar agora (simulação, nunca cria pessoa/folha).
 *  5. `simulateDiscount` — esse desconto ainda faz sentido (simulação por unidade/proposta).
 *  6. `computeFreeCashToInvest` — existe caixa livre para investir.
 *
 * Regras não-negociáveis (ver ordem de serviço): nunca inventar um número quando falta premissa —
 * usar `EngineAnswer` (`SEM_DADOS`/`SEM_EVIDENCIA`/`NAO_APLICAVEL`, ver `types.ts`) em vez de um
 * zero fabricado; nunca recomendar decisão (a conclusão descreve o impacto calculado, não diz
 * "aprove"/"contrate"); nenhuma função aqui muta estado — todas recebem dados já lidos pela camada
 * de aplicação (`src/application/executive-insights/`) e devolvem um resultado, nada mais.
 */
import { projectCashBalances, roundMoney, roundPercentage } from "@/domain/financial-ops/engine";
import { computeDiscount, requiresDiscountApproval } from "@/domain/sales/engine";
import { type EngineAnswer, noData, noEvidence, notApplicable, ok } from "./types";

// ---------------------------------------------------------------------------
// 1. Quanto realmente sobra das vendas (contribuição/margem real)
// ---------------------------------------------------------------------------

export interface SalesContributionInput {
  /** Soma de `Sale.soldPrice` das vendas aprovadas no escopo (real, não projetado). */
  vgvVendido: number;
  /** Soma de `Sale.discountAmount` das vendas aprovadas. */
  discountsGranted: number;
  /** Soma de `Sale.incentiveAmount` das vendas aprovadas. */
  incentivesGranted: number;
  /** Quantidade de vendas aprovadas no escopo — `0` aqui é o gatilho de `SEM_DADOS`. */
  salesCount: number;
  /** Soma de `SalesCommission.amount` já registrada (real) para vendas do escopo. */
  commissionsRecorded: number;
  /** VGV (soldPrice) das vendas do escopo que ainda não têm `SalesCommission` registrada. */
  vgvWithoutRecordedCommission: number;
  /** Taxa de comissão de política ativa (fração, ex. 0.05) para estimar a parcela sem registro — `null` quando não há política encontrada. */
  commissionPolicyRate: number | null;
  /** Taxa de imposto de referência (fração) — vem do cenário base do estudo de viabilidade ativo; `null` quando não há estudo ativo. */
  taxRate: number | null;
  /** Rótulo da fonte da taxa de imposto, para exibição de premissa (ex.: "Estudo de viabilidade ativo, cenário base"). */
  taxRateSource: string | null;
  /** Soma de pagamentos efetivamente realizados (`PayablePayment`) do empreendimento até a data de referência — `0` é um valor real válido (nenhum custo pago ainda), nunca confundido com ausência de dado. */
  costsIncurredToDate: number;
}

export interface SalesContributionResult {
  grossVgv: number;
  discountsGranted: number;
  incentivesGranted: number;
  netAfterDiscounts: number;
  commissions: { recorded: number; estimated: number; total: number; unresolvedVgv: number };
  taxes: { amount: number | null; rate: number | null; source: string | null };
  costsIncurredToDate: number;
  /** `null` quando falta uma premissa (imposto sem taxa de referência, ou comissão de parte do VGV sem política) — nunca um número que mistura real com inventado. */
  cashContributionToDate: number | null;
  notes: string[];
}

export function computeSalesContribution(input: SalesContributionInput): EngineAnswer<SalesContributionResult> {
  if (input.salesCount === 0) return noData("Nenhuma venda aprovada neste escopo.");

  const netAfterDiscounts = roundMoney(input.vgvVendido - input.discountsGranted - input.incentivesGranted);
  const notes: string[] = [];

  let estimatedCommission = 0;
  let unresolvedVgv = 0;
  if (input.vgvWithoutRecordedCommission > 0) {
    if (input.commissionPolicyRate !== null) {
      estimatedCommission = roundMoney(input.vgvWithoutRecordedCommission * input.commissionPolicyRate);
      notes.push(`Comissão de ${roundMoney(input.vgvWithoutRecordedCommission)} em VGV foi estimada pela política de comissão ativa (sem lançamento registrado ainda).`);
    } else {
      unresolvedVgv = input.vgvWithoutRecordedCommission;
      notes.push("Parte do VGV vendido não tem comissão registrada nem política de comissão ativa para estimar — comissão total tratada como sem evidência.");
    }
  }
  const commissions = { recorded: roundMoney(input.commissionsRecorded), estimated: estimatedCommission, total: roundMoney(input.commissionsRecorded + estimatedCommission), unresolvedVgv };

  const taxAmount = input.taxRate !== null ? roundMoney(netAfterDiscounts * input.taxRate) : null;
  if (taxAmount === null) notes.push("Sem taxa de imposto de referência: nenhum estudo de viabilidade ativo encontrado para este empreendimento.");

  const cashContributionToDate = taxAmount !== null && unresolvedVgv === 0 ? roundMoney(netAfterDiscounts - taxAmount - commissions.total - input.costsIncurredToDate) : null;

  return ok({
    grossVgv: roundMoney(input.vgvVendido),
    discountsGranted: roundMoney(input.discountsGranted),
    incentivesGranted: roundMoney(input.incentivesGranted),
    netAfterDiscounts,
    commissions,
    taxes: { amount: taxAmount, rate: input.taxRate, source: input.taxRateSource },
    costsIncurredToDate: roundMoney(input.costsIncurredToDate),
    cashContributionToDate,
    notes,
  });
}

// ---------------------------------------------------------------------------
// 2. Quanto tempo o caixa aguenta (runway + stress de vendas)
// ---------------------------------------------------------------------------

export type RunwayScenarioKey = "ATUAL" | "QUEDA_20" | "QUEDA_40" | "SEM_NOVAS_VENDAS";

export const RUNWAY_SCENARIO_FACTORS: Record<RunwayScenarioKey, number> = {
  ATUAL: 1,
  QUEDA_20: 0.8,
  QUEDA_40: 0.6,
  SEM_NOVAS_VENDAS: 0,
};

export const RUNWAY_SCENARIO_LABELS: Record<RunwayScenarioKey, string> = {
  ATUAL: "Cenário atual",
  QUEDA_20: "Vendas -20%",
  QUEDA_40: "Vendas -40%",
  SEM_NOVAS_VENDAS: "Sem novas vendas",
};

export interface RunwayBaseInput {
  /** Caixa livre atual (não restrito), real. */
  freeCash: number;
  /** Média mensal real de entradas NÃO ligadas a venda (últimos `historicalMonths`). */
  avgMonthlyOtherInflow: number;
  /** Média mensal real de entradas ligadas a venda/recebível de venda (últimos `historicalMonths`). */
  avgMonthlySalesInflow: number;
  /** Média mensal real de saídas realizadas (últimos `historicalMonths`). */
  avgMonthlyOutflow: number;
  /** Quantos meses de histórico real sustentam as médias acima (premissa exibida na UI). `0` dispara `SEM_EVIDENCIA`. */
  historicalMonths: number;
  /** Horizonte de projeção, em meses. Default 24. */
  horizonMonths?: number;
}

export interface RunwayScenarioResult {
  scenario: RunwayScenarioKey;
  label: string;
  monthlyInflow: number;
  monthlyOutflow: number;
  monthlyNet: number;
  /** Quantos meses até o caixa projetado ficar negativo — `null` quando não zera dentro do horizonte. */
  monthsOfRunway: number | null;
  exceedsHorizon: boolean;
  projectedRows: { month: number; closingBalance: number }[];
}

const DEFAULT_RUNWAY_HORIZON_MONTHS = 24;

function projectRunwayScenario(scenario: RunwayScenarioKey, input: RunwayBaseInput): RunwayScenarioResult {
  const horizon = input.horizonMonths ?? DEFAULT_RUNWAY_HORIZON_MONTHS;
  const factor = RUNWAY_SCENARIO_FACTORS[scenario];
  const monthlyInflow = roundMoney(input.avgMonthlyOtherInflow + input.avgMonthlySalesInflow * factor);
  const monthlyOutflow = roundMoney(input.avgMonthlyOutflow);
  const rows = projectCashBalances(
    input.freeCash,
    Array.from({ length: horizon }, (_, index) => ({ period: String(index + 1), inflow: monthlyInflow, outflow: monthlyOutflow })),
  );
  const depletionIndex = rows.findIndex((row) => row.closingBalance < 0);
  return {
    scenario,
    label: RUNWAY_SCENARIO_LABELS[scenario],
    monthlyInflow,
    monthlyOutflow,
    monthlyNet: roundMoney(monthlyInflow - monthlyOutflow),
    monthsOfRunway: depletionIndex === -1 ? null : depletionIndex + 1,
    exceedsHorizon: depletionIndex === -1,
    projectedRows: rows.map((row, index) => ({ month: index + 1, closingBalance: row.closingBalance })),
  };
}

export function computeRunwayScenarios(input: RunwayBaseInput): EngineAnswer<RunwayScenarioResult[]> {
  if (input.historicalMonths <= 0) return noEvidence("Sem histórico real de movimentação de caixa (pagamentos/recebimentos) suficiente para projetar consumo de caixa.");
  const scenarios: RunwayScenarioKey[] = ["ATUAL", "QUEDA_20", "QUEDA_40", "SEM_NOVAS_VENDAS"];
  return ok(scenarios.map((scenario) => projectRunwayScenario(scenario, input)));
}

/** Reaproveitado por `simulateHiring` para recalcular só o cenário ATUAL com um custo mensal adicional de saída. */
export function projectRunwayWithExtraMonthlyOutflow(input: RunwayBaseInput, extraMonthlyOutflow: number): RunwayScenarioResult {
  return projectRunwayScenario("ATUAL", { ...input, avgMonthlyOutflow: input.avgMonthlyOutflow + extraMonthlyOutflow });
}

// ---------------------------------------------------------------------------
// 3. Ponto de equilíbrio (empreendimento e corporativo)
// ---------------------------------------------------------------------------

export interface BreakEvenProjectResult {
  breakEvenVgv: number;
  breakEvenUnits: number;
  /** Fração do VGV total necessária para atingir o equilíbrio (ex.: 0.62 = 62%). */
  breakEvenRate: number;
  vgvVendido: number;
  /** Fração de progresso rumo ao equilíbrio (`vgvVendido / breakEvenVgv`) — pode superar 1 quando já ultrapassado. */
  progress: number;
  reached: boolean;
}

export function describeProjectBreakEven(breakEvenVgv: number, breakEvenUnits: number, breakEvenRate: number, vgvVendido: number): EngineAnswer<BreakEvenProjectResult> {
  if (breakEvenVgv <= 0) return noEvidence("VGV de equilíbrio calculado pelo estudo de viabilidade não é positivo — resultado não confiável para exibir.");
  return ok({
    breakEvenVgv: roundMoney(breakEvenVgv),
    breakEvenUnits,
    breakEvenRate: roundPercentage(breakEvenRate),
    vgvVendido: roundMoney(vgvVendido),
    progress: roundPercentage(vgvVendido / breakEvenVgv),
    reached: vgvVendido >= breakEvenVgv,
  });
}

export interface BreakEvenCorporateEntry {
  projectId: string;
  breakEvenVgv: number;
  vgvVendido: number;
}

export interface BreakEvenCorporateResult {
  totalBreakEvenVgv: number;
  totalVgvVendido: number;
  progress: number;
  projectsIncluded: number;
  projectsTotal: number;
  projectsExcluded: number;
}

export function aggregateCorporateBreakEven(entries: BreakEvenCorporateEntry[], projectsTotal: number): EngineAnswer<BreakEvenCorporateResult> {
  if (entries.length === 0) return noEvidence("Nenhum empreendimento no escopo tem estudo de viabilidade ativo para agregar o equilíbrio corporativo.");
  const totalBreakEvenVgv = roundMoney(entries.reduce((sum, entry) => sum + entry.breakEvenVgv, 0));
  const totalVgvVendido = roundMoney(entries.reduce((sum, entry) => sum + entry.vgvVendido, 0));
  return ok({
    totalBreakEvenVgv,
    totalVgvVendido,
    progress: totalBreakEvenVgv > 0 ? roundPercentage(totalVgvVendido / totalBreakEvenVgv) : 0,
    projectsIncluded: entries.length,
    projectsTotal,
    projectsExcluded: projectsTotal - entries.length,
  });
}

// ---------------------------------------------------------------------------
// 4. Dá para contratar agora (simulação, nunca cria pessoa/folha)
// ---------------------------------------------------------------------------

export interface HiringSimulationInput {
  /** Custo mensal da posição (R$/mês) — quando o usuário informa custo anual, a camada de aplicação normaliza antes de chamar esta função. */
  monthlyCost: number;
  runwayBase: RunwayBaseInput;
  /** Reserva mínima sugerida (real: compromissos que vencem nos próximos 30 dias) — nunca uma política inventada. */
  reserveMinimum: number;
}

export interface HiringSimulationResult {
  monthlyCost: number;
  before: RunwayScenarioResult;
  after: RunwayScenarioResult;
  freeCashAfterReserveToday: number;
  reserveMinimum: number;
  conclusion: string;
}

export function simulateHiring(input: HiringSimulationInput): EngineAnswer<HiringSimulationResult> {
  if (input.monthlyCost <= 0) throw new Error("O custo mensal simulado deve ser maior que zero.");
  if (input.runwayBase.historicalMonths <= 0) return noEvidence("Sem histórico real de caixa suficiente para simular o impacto da contratação.");

  const before = projectRunwayScenario("ATUAL", input.runwayBase);
  const after = projectRunwayWithExtraMonthlyOutflow(input.runwayBase, input.monthlyCost);
  const freeCashAfterReserveToday = roundMoney(input.runwayBase.freeCash - input.reserveMinimum);

  const beforeLabel = before.exceedsHorizon ? `acima de ${before.projectedRows.length} meses` : `${before.monthsOfRunway} mes(es)`;
  const afterLabel = after.exceedsHorizon ? `acima de ${after.projectedRows.length} meses` : `${after.monthsOfRunway} mes(es)`;
  const reserveOk = freeCashAfterReserveToday >= 0;
  const conclusion = reserveOk
    ? `Com o custo mensal simulado, o fôlego de caixa projetado passa de ${beforeLabel} para ${afterLabel}. O caixa livre hoje cobre a reserva mínima sugerida (compromissos dos próximos 30 dias).`
    : `Com o custo mensal simulado, o fôlego de caixa projetado passa de ${beforeLabel} para ${afterLabel}. Atenção: o caixa livre hoje já não cobre a reserva mínima sugerida (compromissos dos próximos 30 dias) antes mesmo de considerar a contratação.`;

  return ok({ monthlyCost: roundMoney(input.monthlyCost), before, after, freeCashAfterReserveToday, reserveMinimum: roundMoney(input.reserveMinimum), conclusion });
}

// ---------------------------------------------------------------------------
// 5. Esse desconto ainda faz sentido (simulação por unidade/proposta)
// ---------------------------------------------------------------------------

export interface DiscountSimulationInput {
  listPrice: number;
  proposedPrice: number;
  /** Fração (ex.: 0.05) — `null` quando não há política de comissão ativa para estimar. */
  commissionRate: number | null;
  /** Fração — `null` quando não há taxa de imposto de referência (estudo de viabilidade ativo). */
  taxRate: number | null;
  /** Piso de preço autorizado da unidade (`SalesPriceTableLine.minimumAuthorizedPrice`), quando existir. */
  minimumAuthorizedPrice: number | null;
  /**
   * Alçada aplicável a este valor de desconto, pela mesma faixa de `ApprovalPolicy` (`actType:
   * SALE_DISCOUNT`) já usada na aprovação real de uma venda (`src/application/sales/sales-service.ts`,
   * `findApplicablePolicy`) — nunca um segundo conceito de autoridade (plano §AN). `null` quando não
   * há nenhuma política cadastrada para a faixa (o fluxo real usa `ADMIN` como papel padrão nesse
   * caso — a camada de aplicação replica esse mesmo padrão antes de chamar esta função).
   */
  requiredApprovalRole: string | null;
  /** Meses de estoque da tipologia/unidade (real, `monthsOfStock`), quando calculável. */
  monthsOfStock: number | null;
}

export interface DiscountSimulationResult {
  discountAmount: number;
  discountPercentage: number;
  marginBeforeNet: number | null;
  marginAfterNet: number | null;
  requiredApprovalRole: string | null;
  belowMinimumAuthorizedPrice: boolean;
  cashImpact: number;
  monthsOfStock: number | null;
  conclusion: string;
}

function netMargin(price: number, commissionRate: number | null, taxRate: number | null): number | null {
  if (commissionRate === null || taxRate === null) return null;
  return roundMoney(price * (1 - commissionRate) * (1 - taxRate));
}

export function simulateDiscount(input: DiscountSimulationInput): EngineAnswer<DiscountSimulationResult> {
  if (input.listPrice <= 0) throw new Error("O preço de tabela deve ser maior que zero para simular o desconto.");
  if (input.proposedPrice < 0) throw new Error("O preço proposto não pode ser negativo.");

  const { discountAmount, discountPercentage } = computeDiscount(input.listPrice, input.proposedPrice);
  const discountAmountNumber = discountAmount.toNumber();
  const discountPercentageNumber = discountPercentage.toNumber();
  const belowMinimumAuthorizedPrice = requiresDiscountApproval(input.proposedPrice, input.minimumAuthorizedPrice);

  const marginBeforeNet = netMargin(input.listPrice, input.commissionRate, input.taxRate);
  const marginAfterNet = netMargin(input.proposedPrice, input.commissionRate, input.taxRate);

  const conclusionParts: string[] = [];
  conclusionParts.push(`Desconto de ${discountAmountNumber.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} (${(discountPercentageNumber * 100).toFixed(1)}%) sobre o preço de tabela.`);
  if (marginBeforeNet !== null && marginAfterNet !== null) {
    conclusionParts.push(`Margem líquida estimada (comissão e imposto de referência) cai de ${marginBeforeNet.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} para ${marginAfterNet.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} por unidade.`);
  } else {
    conclusionParts.push("Impacto na margem líquida não pôde ser calculado: falta taxa de comissão e/ou imposto de referência cadastrada.");
  }
  conclusionParts.push(input.requiredApprovalRole ? `Alçada necessária para este valor de desconto: ${input.requiredApprovalRole}.` : "Nenhuma política de desconto cadastrada para esta faixa de valor.");
  if (belowMinimumAuthorizedPrice) conclusionParts.push("O preço proposto fica abaixo do piso autorizado para esta unidade.");

  return ok({
    discountAmount: discountAmountNumber,
    discountPercentage: discountPercentageNumber,
    marginBeforeNet,
    marginAfterNet,
    requiredApprovalRole: input.requiredApprovalRole,
    belowMinimumAuthorizedPrice,
    cashImpact: roundMoney(input.proposedPrice - input.listPrice),
    monthsOfStock: input.monthsOfStock,
    conclusion: conclusionParts.join(" "),
  });
}

// ---------------------------------------------------------------------------
// 6. Existe caixa livre para investir
// ---------------------------------------------------------------------------

export interface FreeCashToInvestInput {
  /** Caixa livre (não restrito) — `null` quando a empresa não tem contas bancárias vinculadas (sem posição consolidada). */
  cashPosition: number | null;
  /** Compromissos reais que vencem nos próximos 30 dias (contas a pagar em aberto). */
  reserveMinimum: number;
  /** Compromissos reais que vencem entre 31 e 90 dias (contas a pagar em aberto). */
  obligationsNear: number;
}

export interface FreeCashToInvestResult {
  cashPosition: number;
  reserveMinimum: number;
  obligationsNear: number;
  freeToInvest: number;
}

export function computeFreeCashToInvest(input: FreeCashToInvestInput): EngineAnswer<FreeCashToInvestResult> {
  if (input.cashPosition === null) return noEvidence("Empresa sem conta bancária vinculada ao empreendimento — sem posição de caixa consolidada para avaliar.");
  const freeToInvest = roundMoney(input.cashPosition - input.reserveMinimum - input.obligationsNear);
  return ok({ cashPosition: roundMoney(input.cashPosition), reserveMinimum: roundMoney(input.reserveMinimum), obligationsNear: roundMoney(input.obligationsNear), freeToInvest });
}

export function isRunwayBurning(scenario: RunwayScenarioResult): boolean {
  return scenario.monthlyNet < 0;
}

/** Wrapper de conveniência: quando o caixa não está de fato "queimando" no cenário atual, a pergunta "quanto tempo aguenta" não se aplica da forma tradicional. */
export function describeRunwayApplicability(scenarios: RunwayScenarioResult[]): EngineAnswer<RunwayScenarioResult[]> | null {
  const current = scenarios.find((item) => item.scenario === "ATUAL");
  if (current && !isRunwayBurning(current) && current.exceedsHorizon) {
    return notApplicable("No cenário atual, o caixa projetado não está sendo consumido (entradas médias reais cobrem as saídas médias reais) — não há um número de 'meses restantes' a reportar.");
  }
  return null;
}
