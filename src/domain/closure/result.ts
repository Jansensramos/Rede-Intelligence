import Decimal from "decimal.js";

/**
 * Fase 9S — fórmulas puras do resultado realizado final e da validação de
 * distribuição. Nenhuma consulta a banco aqui. Política central (decisão 5): ausência
 * de evidência em qualquer componente nunca vira zero — o agregado herda
 * `SEM_EVIDENCIA` do pior componente que usa, nunca soma com 0 implícito.
 */

export type EvidenceStatus = "COM_EVIDENCIA" | "SEM_EVIDENCIA";

export interface EvidenceValue {
  status: EvidenceStatus;
  /** String decimal — só definido quando `status === "COM_EVIDENCIA"`. */
  value: string | null;
}

const SEM_EVIDENCIA: EvidenceValue = { status: "SEM_EVIDENCIA", value: null };
/** Limite defensivo contra corrupção/erro de unidade — nenhum valor realista do domínio (R$) se aproxima disto. */
const MAX_MAGNITUDE = new Decimal("1e15");

function isSaneDecimal(value: Decimal): boolean {
  return value.isFinite() && value.abs().lessThanOrEqualTo(MAX_MAGNITUDE);
}

function toEvidence(value: Decimal): EvidenceValue {
  if (!isSaneDecimal(value)) return SEM_EVIDENCIA;
  return { status: "COM_EVIDENCIA", value: value.toFixed(2) };
}

export interface RealizedResultInputs {
  realizedRevenue: EvidenceValue;
  realizedCost: EvidenceValue;
  /** Decisão 5 não lista "despesas" entre os campos que bloqueiam `FINAL` (só receita,
   * custo, tributos, despesas financeiras, resultado e margem). Sem uma linha contábil
   * própria e segregada para despesas operacionais adicionais (já refletidas em custo/
   * tributos nas fontes reaproveitadas), a ausência aqui é tratada como 0 na fórmula do
   * resultado — nunca bloqueia — mas o campo `evidenceStatus.realizedExpenses` do
   * `ProjectClosureResult` continua mostrando `SEM_EVIDENCIA` honestamente quando não há
   * fonte própria, sem fingir que o valor foi apurado. */
  realizedExpenses: EvidenceValue;
  realizedTaxes: EvidenceValue;
  realizedFinancialCosts: EvidenceValue;
  realizedVgv: EvidenceValue;
  realizedNetRevenue: EvidenceValue;
}

export interface RealizedResultOutcome {
  realizedResult: EvidenceValue;
  realizedMarginOnVgv: EvidenceValue;
  realizedMarginOnNetRevenue: EvidenceValue;
}

/**
 * `resultado = receita − custo − despesas − tributos − custos financeiros`.
 * Margem = resultado / VGV (ou / receita líquida). Receita/custo/tributos/custos
 * financeiros `SEM_EVIDENCIA` tornam o resultado (e a margem) `SEM_EVIDENCIA` —
 * decisão 5. Despesas ausentes entram como 0 na soma (ver nota no tipo acima), nunca
 * bloqueiam sozinhas.
 */
export function computeRealizedResult(inputs: RealizedResultInputs): RealizedResultOutcome {
  const blockingComponents = [inputs.realizedRevenue, inputs.realizedCost, inputs.realizedTaxes, inputs.realizedFinancialCosts];
  if (blockingComponents.some((component) => component.status === "SEM_EVIDENCIA")) {
    return { realizedResult: SEM_EVIDENCIA, realizedMarginOnVgv: SEM_EVIDENCIA, realizedMarginOnNetRevenue: SEM_EVIDENCIA };
  }
  const expenses = inputs.realizedExpenses.status === "COM_EVIDENCIA" ? new Decimal(inputs.realizedExpenses.value!) : new Decimal(0);
  const result = new Decimal(inputs.realizedRevenue.value!)
    .minus(inputs.realizedCost.value!)
    .minus(expenses)
    .minus(inputs.realizedTaxes.value!)
    .minus(inputs.realizedFinancialCosts.value!);
  const realizedResult = toEvidence(result);
  if (realizedResult.status === "SEM_EVIDENCIA") {
    return { realizedResult, realizedMarginOnVgv: SEM_EVIDENCIA, realizedMarginOnNetRevenue: SEM_EVIDENCIA };
  }
  const marginOnVgv = marginAgainst(result, inputs.realizedVgv);
  const marginOnNetRevenue = marginAgainst(result, inputs.realizedNetRevenue);
  return { realizedResult, realizedMarginOnVgv: marginOnVgv, realizedMarginOnNetRevenue: marginOnNetRevenue };
}

function marginAgainst(result: Decimal, base: EvidenceValue): EvidenceValue {
  if (base.status === "SEM_EVIDENCIA") return SEM_EVIDENCIA;
  const baseValue = new Decimal(base.value!);
  if (baseValue.isZero()) return SEM_EVIDENCIA;
  const margin = result.dividedBy(baseValue);
  if (!margin.isFinite()) return SEM_EVIDENCIA;
  return { status: "COM_EVIDENCIA", value: margin.toFixed(8) };
}

/**
 * Decisão 5 — campos centrais (receita, custo, tributos, despesas financeiras,
 * resultado, margem) bloqueiam `FINAL` se `SEM_EVIDENCIA`. Campos qualitativos
 * (notas, lições aprendidas) nunca bloqueiam.
 */
export interface CentralEvidenceInputs {
  realizedRevenue: EvidenceValue;
  realizedCost: EvidenceValue;
  realizedTaxes: EvidenceValue;
  realizedFinancialCosts: EvidenceValue;
  realizedResult: EvidenceValue;
  realizedMarginOnVgv: EvidenceValue;
}

export function missingCentralEvidence(inputs: CentralEvidenceInputs): string[] {
  const labels: Array<[keyof CentralEvidenceInputs, string]> = [
    ["realizedRevenue", "receita realizada"],
    ["realizedCost", "custo realizado"],
    ["realizedTaxes", "tributos realizados"],
    ["realizedFinancialCosts", "despesas financeiras realizadas"],
    ["realizedResult", "resultado realizado"],
    ["realizedMarginOnVgv", "margem realizada"],
  ];
  return labels.filter(([key]) => inputs[key].status === "SEM_EVIDENCIA").map(([, label]) => label);
}

// ---------------------------------------------------------------------------
// Validação de distribuição (decisão 8 — distribuição simples, sem waterfall)
// ---------------------------------------------------------------------------

export type ProjectDistributionNatureInput = "CAPITAL_CONTRIBUTION" | "CAPITAL_RETURN" | "REMUNERATION" | "RESULT_DISTRIBUTION" | "RETENTION" | "PROVISION";
/** Naturezas pagas a partir do resultado realizado (nunca do capital aportado). */
const RESULT_BASED_NATURES = new Set<ProjectDistributionNatureInput>(["REMUNERATION", "RESULT_DISTRIBUTION", "RETENTION", "PROVISION"]);

export interface DistributionValidationInput {
  nature: ProjectDistributionNatureInput;
  amount: string;
  /** Soma de `CAPITAL_CONTRIBUTION` já `APPROVED` para o projeto (todas as versões de encerramento — aporte é um fato do ciclo de vida, não de uma versão específica). */
  existingApprovedCapitalContributed: string;
  /** Soma de `CAPITAL_RETURN` já `APPROVED` para o projeto. */
  existingApprovedCapitalReturned: string;
  /** Soma de `REMUNERATION`+`RESULT_DISTRIBUTION`+`RETENTION`+`PROVISION` já `APPROVED` para esta versão de encerramento. */
  existingApprovedResultBased: string;
  realizedResult: EvidenceValue;
}

export interface DistributionValidationOutcome {
  allowed: boolean;
  reason?: string;
}

/**
 * `CAPITAL_RETURN` nunca pode exceder o total de `CAPITAL_CONTRIBUTION` já
 * registrado (não infere aportes anteriores não registrados — decisão 6). Naturezas
 * pagas a partir do resultado nunca podem, somadas, exceder o `realizedResult` da
 * versão de encerramento corrente; se o resultado for `SEM_EVIDENCIA`, nenhuma
 * distribuição dessas naturezas é permitida (falha fechado).
 */
export function validateDistributionAgainstAvailable(input: DistributionValidationInput): DistributionValidationOutcome {
  const amount = new Decimal(input.amount);
  if (!isSaneDecimal(amount) || amount.lessThanOrEqualTo(0)) {
    return { allowed: false, reason: "Valor de distribuição inválido." };
  }

  if (input.nature === "CAPITAL_RETURN") {
    const contributed = new Decimal(input.existingApprovedCapitalContributed);
    const alreadyReturned = new Decimal(input.existingApprovedCapitalReturned);
    const available = contributed.minus(alreadyReturned);
    if (amount.greaterThan(available)) {
      return { allowed: false, reason: `Retorno de capital solicitado (${amount.toFixed(2)}) excede o capital aportado disponível (${available.toFixed(2)}).` };
    }
    return { allowed: true };
  }

  if (input.nature === "CAPITAL_CONTRIBUTION") {
    return { allowed: true };
  }

  if (RESULT_BASED_NATURES.has(input.nature)) {
    if (input.realizedResult.status === "SEM_EVIDENCIA") {
      return { allowed: false, reason: "O resultado realizado do encerramento está sem evidência — nenhuma distribuição baseada em resultado pode ser aprovada." };
    }
    const result = new Decimal(input.realizedResult.value!);
    const alreadyDistributed = new Decimal(input.existingApprovedResultBased);
    const available = result.minus(alreadyDistributed);
    if (amount.greaterThan(available)) {
      return { allowed: false, reason: `Distribuição solicitada (${amount.toFixed(2)}) excede o resultado disponível (${available.toFixed(2)}).` };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: "Natureza de distribuição desconhecida." };
}

export interface DistributionAggregateValidationInput {
  existingApprovedCapitalContributed: string;
  existingApprovedCapitalReturned: string;
  existingApprovedResultBased: string;
  realizedResult: EvidenceValue;
}

/**
 * Revalidação agregada (correção Alto #3 pós-reauditoria REPROVADA) — chamada na
 * aprovação final do `ProjectClosureResult` (DRAFT → FINAL), sem adicionar nenhum
 * valor novo: apenas confirma que a soma das distribuições já `APPROVED` continua
 * compatível com os valores vigentes do encerramento no instante da aprovação. Nunca
 * altera nem "corrige" uma distribuição — só bloqueia a transição do resultado se a
 * soma já não couber mais (estado contraditório, falha fechado).
 */
export function validateApprovedDistributionsAggregate(input: DistributionAggregateValidationInput): DistributionValidationOutcome {
  const contributed = new Decimal(input.existingApprovedCapitalContributed);
  const returned = new Decimal(input.existingApprovedCapitalReturned);
  if (returned.greaterThan(contributed)) {
    return { allowed: false, reason: `O total de CAPITAL_RETURN aprovado (${returned.toFixed(2)}) excede o total de CAPITAL_CONTRIBUTION aprovado (${contributed.toFixed(2)}).` };
  }

  const resultBased = new Decimal(input.existingApprovedResultBased);
  if (resultBased.isZero()) return { allowed: true };
  if (input.realizedResult.status === "SEM_EVIDENCIA") {
    return { allowed: false, reason: "Há distribuição baseada em resultado já aprovada, mas o resultado realizado do encerramento está sem evidência." };
  }
  const result = new Decimal(input.realizedResult.value!);
  if (resultBased.greaterThan(result)) {
    return { allowed: false, reason: `O total de distribuições baseadas em resultado já aprovado (${resultBased.toFixed(2)}) excede o resultado realizado vigente (${result.toFixed(2)}).` };
  }
  return { allowed: true };
}
