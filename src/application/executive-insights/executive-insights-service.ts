/**
 * Fase 9K.4A — "O que você precisa saber para decidir". Orquestra as engines puras de
 * `src/domain/executive-insights/engine.ts` sobre as consultas enxutas de
 * `executive-insights-queries.ts`. Read model transversal — nunca uma segunda fonte de verdade
 * (mesmo princípio de `src/application/executive/executive-service.ts`, 9K.2/9K.3): cada resposta
 * aponta para dado já existente, nada é persistido por este módulo.
 *
 * RBAC (ordem de serviço §10): reaproveita `hasWorkspaceCapability` — usuário sem `FINANCIAL_VIEW`
 * nunca recebe runway/caixa/contratação/caixa livre; usuário sem `COMMERCIAL_VIEW` nunca recebe
 * contribuição de vendas/desconto. Quando a capacidade falta, a chave correspondente do retorno
 * fica ausente (nunca `null` fabricado) — mesmo padrão de gate 2 do fechamento da 9K.2.
 */
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { getLatestStudyForProject } from "@/application/studies/study-service";
import { queryStudyUpdatedAt } from "@/application/executive/executive-queries";
import { calculateProject } from "@/domain/financial/engine";
import { rate } from "@/domain/financial/math";
import type { ProjectAssumptions } from "@/domain/financial/types";
import { hasWorkspaceCapability } from "@/domain/workspace/capabilities";
import { resolveDomainFreshness, type DomainFreshness } from "@/domain/workspace/freshness";
import { computeDiscount } from "@/domain/sales/engine";
import {
  aggregateCorporateBreakEven,
  computeFreeCashToInvest,
  computeRunwayScenarios,
  computeSalesContribution,
  describeProjectBreakEven,
  describeRunwayApplicability,
  simulateDiscount,
  simulateHiring,
  type BreakEvenCorporateResult,
  type BreakEvenProjectResult,
  type DiscountSimulationResult,
  type FreeCashToInvestResult,
  type HiringSimulationResult,
  type RunwayBaseInput,
  type RunwayScenarioResult,
  type SalesContributionResult,
} from "@/domain/executive-insights/engine";
import type { AnswerStatus, Confidence } from "@/domain/executive-insights/types";
import {
  queryCashHistorySignals,
  queryDiscountApprovalRole,
  queryFreeCashPosition,
  queryMonthsOfStockSignal,
  queryPayableHorizonAmounts,
  querySalesContributionSignals,
  querySimulableSalesUnits,
} from "./executive-insights-queries";

export interface DecisionAnswer<T> {
  id: string;
  title: string;
  status: AnswerStatus;
  headline: string;
  explanation: string;
  premises: string[];
  confidence: Confidence | null;
  source: string;
  freshness: DomainFreshness;
  data: T | null;
}

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percentage = (value: number) => `${(value * 100).toFixed(1)}%`;

/** `ProjectAssumptions.taxRate` é armazenado em PONTOS PERCENTUAIS (ex.: "6" = 6%), mesma convenção de `rate()` em `src/domain/financial/math.ts` — nunca uma fração direta. Converte para fração aqui, uma única vez, para as engines de 9K.4A (que esperam fração, ex.: 0.06). */
function taxRateFraction(assumptions: ProjectAssumptions): number {
  return rate(assumptions.taxRate).toNumber();
}

async function projectForTenant(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  return project;
}

async function resolveRunwayBase(organizationId: string, projectId: string, companyId: string | null, referenceDate: Date): Promise<{ base: RunwayBaseInput; freshness: DomainFreshness }> {
  const [cashPosition, history] = await Promise.all([queryFreeCashPosition(organizationId, companyId), queryCashHistorySignals(organizationId, projectId, referenceDate)]);
  return {
    base: {
      freeCash: cashPosition?.free ?? 0,
      avgMonthlyOtherInflow: history.avgMonthlyOtherInflow,
      avgMonthlySalesInflow: history.avgMonthlySalesInflow,
      avgMonthlyOutflow: history.avgMonthlyOutflow,
      historicalMonths: cashPosition ? history.historicalMonths : 0,
    },
    freshness: resolveDomainFreshness(null, referenceDate, cashPosition !== null),
  };
}

// ---------------------------------------------------------------------------
// Pergunta 1 — quanto realmente sobra das vendas
// ---------------------------------------------------------------------------

async function buildSalesContributionAnswer(organizationId: string, projectId: string, referenceDate: Date): Promise<DecisionAnswer<SalesContributionResult>> {
  const [signals, study] = await Promise.all([querySalesContributionSignals(organizationId, projectId, referenceDate), getLatestStudyForProject(organizationId, projectId)]);
  // A premissa é a taxa de imposto de ENTRADA do cenário base (mesma usada no cálculo de impostos do estudo) — o estudo em si não precisa ser recalculado aqui.
  const effectiveTaxRate = study ? taxRateFraction(study.assumptions) : null;
  const taxRateSource = study ? "Estudo de viabilidade ativo, taxa de imposto do cenário base" : null;

  const answer = computeSalesContribution({ ...signals, taxRate: effectiveTaxRate, taxRateSource });
  const premises: string[] = [
    `${signals.salesCount} venda(s) aprovada(s) considerada(s) no escopo.`,
    effectiveTaxRate !== null ? `Taxa de imposto de referência: ${percentage(effectiveTaxRate)} (${taxRateSource}).` : "Sem taxa de imposto de referência: nenhum estudo de viabilidade ativo.",
    `Custos considerados: pagamentos efetivamente realizados até ${referenceDate.toLocaleDateString("pt-BR")}.`,
  ];

  const headline =
    answer.status === "OK" && answer.data
      ? answer.data.cashContributionToDate !== null
        ? `${currency.format(answer.data.cashContributionToDate)} de contribuição líquida até agora`
        : "Contribuição parcial — falta ao menos uma premissa (ver observações)"
      : "Sem dados suficientes";

  return {
    id: "sales_contribution",
    title: "Quanto realmente sobra das vendas?",
    status: answer.status,
    headline,
    explanation: "Receita vendida menos descontos/incentivos concedidos, impostos (taxa de referência), comissões e custos já desembolsados — nunca confundido com o VGV vendido (receita) sozinho.",
    premises,
    confidence: answer.data && answer.data.commissions.unresolvedVgv === 0 && answer.data.taxes.amount !== null ? "ALTA" : answer.data ? "MEDIA" : null,
    source: "REDE — Comercial + Financeiro + Viabilidade",
    freshness: resolveDomainFreshness(null, referenceDate, signals.salesCount > 0),
    data: answer.data,
  };
}

// ---------------------------------------------------------------------------
// Pergunta 2 — quanto tempo o caixa aguenta
// ---------------------------------------------------------------------------

async function buildRunwayAnswer(organizationId: string, projectId: string, companyId: string | null, referenceDate: Date): Promise<DecisionAnswer<RunwayScenarioResult[]>> {
  const { base, freshness } = await resolveRunwayBase(organizationId, projectId, companyId, referenceDate);
  const answer = computeRunwayScenarios(base);
  // `NAO_APLICAVEL` (caixa não está sendo consumido) só troca o RÓTULO/status exibido — os 4
  // cenários calculados continuam presentes em `data` (nunca descartados), porque ainda são a
  // resposta correta às perguntas "e se vendas caírem 20%/40%/pararem?" mesmo quando o cenário
  // ATUAL não está queimando caixa.
  const applicability = answer.data ? describeRunwayApplicability(answer.data) : null;
  const status = applicability?.status ?? answer.status;

  const current = answer.data?.find((item) => item.scenario === "ATUAL");
  const headline =
    answer.status === "OK" && current
      ? current.exceedsHorizon
        ? `Acima de ${current.projectedRows.length} meses no cenário atual`
        : `${current.monthsOfRunway} mes(es) no cenário atual`
      : "Sem histórico suficiente para projetar";

  return {
    id: "runway",
    title: "Quanto tempo o caixa aguenta?",
    status,
    headline: applicability ? "Caixa não está sendo consumido no cenário atual" : headline,
    explanation: "Projeção a partir da média mensal REAL de entradas e saídas de caixa dos últimos 3 meses — não é um novo fluxo de caixa detalhado por atividade, é uma leitura de ritmo de consumo.",
    premises: [
      `Caixa livre atual: ${currency.format(base.freeCash)}.`,
      `Janela histórica usada: ${base.historicalMonths} mês(es) de pagamentos/recebimentos reais.`,
      `Entrada média/mês ligada a vendas: ${currency.format(base.avgMonthlySalesInflow)} · outras entradas: ${currency.format(base.avgMonthlyOtherInflow)} · saída média/mês: ${currency.format(base.avgMonthlyOutflow)}.`,
      "Cenários de stress reduzem só a entrada ligada a vendas (-20%, -40%, 0%) — as demais entradas/saídas permanecem no ritmo médio real.",
    ],
    confidence: base.historicalMonths >= 3 ? "ALTA" : base.historicalMonths > 0 ? "MEDIA" : null,
    source: "REDE — Financeiro (pagamentos e recebimentos realizados)",
    freshness,
    data: answer.data,
  };
}

// ---------------------------------------------------------------------------
// Pergunta 3 — ponto de equilíbrio
// ---------------------------------------------------------------------------

async function buildBreakEvenProjectAnswer(organizationId: string, projectId: string, referenceDate: Date): Promise<DecisionAnswer<BreakEvenProjectResult>> {
  const [study, soldAggregate, studyUpdatedAt] = await Promise.all([
    getLatestStudyForProject(organizationId, projectId),
    prisma.sale.aggregate({ where: { organizationId, projectId, status: "APPROVED" }, _sum: { soldPrice: true } }),
    queryStudyUpdatedAt(organizationId, projectId),
  ]);
  const vgvVendido = Number(soldAggregate._sum.soldPrice ?? 0);
  if (!study) {
    return {
      id: "break_even_project",
      title: "Qual é o ponto de equilíbrio? (empreendimento)",
      status: "SEM_EVIDENCIA",
      headline: "Sem estudo de viabilidade ativo",
      explanation: "O ponto de equilíbrio deste empreendimento vem do estudo de viabilidade ativo — sem um estudo promovido, não há VGV de equilíbrio para reportar.",
      premises: ["Nenhum estudo de viabilidade ativo encontrado para este empreendimento."],
      confidence: null,
      source: "REDE — Viabilidade",
      freshness: resolveDomainFreshness(null, referenceDate, false),
      data: null,
    };
  }
  const result = calculateProject(study.assumptions, "base");
  const answer = describeProjectBreakEven(Number(result.metrics.breakEvenVgv), result.metrics.breakEvenUnits, Number(result.metrics.breakEvenRate), vgvVendido);
  return {
    id: "break_even_project",
    title: "Qual é o ponto de equilíbrio? (empreendimento)",
    status: answer.status,
    headline: answer.data
      ? `${currency.format(answer.data.breakEvenVgv)} · ${answer.data.breakEvenUnits} unidade(s) · ${percentage(answer.data.breakEvenRate)} do VGV`
      : "Não foi possível calcular",
    explanation: "VGV, unidades e % do VGV necessários para cobrir custos fixos, de construção e financeiros do cenário base do estudo de viabilidade ativo.",
    premises: [
      studyUpdatedAt ? `Cenário base do estudo de viabilidade ativo (atualizado em ${studyUpdatedAt.toLocaleDateString("pt-BR")}).` : "Cenário base do estudo de viabilidade ativo.",
      `VGV vendido até agora: ${currency.format(vgvVendido)}.`,
    ],
    confidence: "ALTA",
    source: "REDE — Viabilidade",
    freshness: resolveDomainFreshness(studyUpdatedAt, referenceDate, true),
    data: answer.data,
  };
}

interface CorporateBreakEvenScopeProject {
  id: string;
}

async function buildBreakEvenCorporateAnswer(organizationId: string, scopeProjects: CorporateBreakEvenScopeProject[], referenceDate: Date): Promise<DecisionAnswer<BreakEvenCorporateResult> | null> {
  if (scopeProjects.length <= 1) return null;
  const entries = await Promise.all(
    scopeProjects.map(async (project) => {
      const [study, soldAggregate] = await Promise.all([
        getLatestStudyForProject(organizationId, project.id),
        prisma.sale.aggregate({ where: { organizationId, projectId: project.id, status: "APPROVED" }, _sum: { soldPrice: true } }),
      ]);
      if (!study) return null;
      const result = calculateProject(study.assumptions, "base");
      return { projectId: project.id, breakEvenVgv: Number(result.metrics.breakEvenVgv), vgvVendido: Number(soldAggregate._sum.soldPrice ?? 0) };
    }),
  );
  const validEntries = entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const answer = aggregateCorporateBreakEven(validEntries, scopeProjects.length);
  return {
    id: "break_even_corporate",
    title: "Qual é o ponto de equilíbrio? (corporativo)",
    status: answer.status,
    headline: answer.data ? `${currency.format(answer.data.totalBreakEvenVgv)} somando ${answer.data.projectsIncluded} empreendimento(s) com estudo ativo` : "Sem empreendimentos com estudo ativo no escopo",
    explanation: "Soma do VGV de equilíbrio dos empreendimentos do escopo que têm estudo de viabilidade ativo — empreendimentos sem estudo ficam de fora e são reportados separadamente, nunca estimados.",
    premises: [`${scopeProjects.length} empreendimento(s) no escopo corporativo.`, answer.data ? `${answer.data.projectsExcluded} sem estudo de viabilidade ativo (excluído(s) da soma).` : "Nenhum empreendimento do escopo tem estudo ativo."],
    confidence: answer.data && answer.data.projectsExcluded === 0 ? "ALTA" : answer.data ? "MEDIA" : null,
    source: "REDE — Viabilidade (agregado por empreendimento)",
    freshness: resolveDomainFreshness(null, referenceDate, validEntries.length > 0),
    data: answer.data,
  };
}

// ---------------------------------------------------------------------------
// Pergunta 6 — existe caixa livre para investir
// ---------------------------------------------------------------------------

async function buildFreeCashAnswer(organizationId: string, projectId: string, companyId: string | null, referenceDate: Date): Promise<DecisionAnswer<FreeCashToInvestResult>> {
  const [cashPosition, horizons] = await Promise.all([queryFreeCashPosition(organizationId, companyId), queryPayableHorizonAmounts(organizationId, projectId, referenceDate)]);
  const answer = computeFreeCashToInvest({ cashPosition: cashPosition?.free ?? null, reserveMinimum: horizons.reserveMinimum, obligationsNear: horizons.obligationsNear });
  return {
    id: "free_cash_to_invest",
    title: "Existe caixa livre para investir?",
    status: answer.status,
    headline: answer.data ? currency.format(answer.data.freeToInvest) : "Sem posição de caixa consolidada",
    explanation: "Caixa livre menos compromissos que vencem nos próximos 30 dias (reserva mínima) e obrigações que vencem entre 31 e 90 dias — nunca só o saldo bancário.",
    premises: [
      cashPosition ? `Caixa livre em contas da empresa: ${currency.format(cashPosition.free)}.` : "Empresa sem conta bancária vinculada ao empreendimento.",
      `Reserva mínima (compromissos ≤ 30 dias): ${currency.format(horizons.reserveMinimum)}.`,
      `Obrigações entre 31 e 90 dias: ${currency.format(horizons.obligationsNear)}.`,
    ],
    confidence: cashPosition ? "ALTA" : null,
    source: "REDE — Financeiro",
    freshness: resolveDomainFreshness(null, referenceDate, cashPosition !== null),
    data: answer.data,
  };
}

// ---------------------------------------------------------------------------
// Bundle principal (RBAC — ordem de serviço §10)
// ---------------------------------------------------------------------------

export interface DecisionInsightsBundle {
  projectId: string;
  generatedAt: string;
  salesContribution?: DecisionAnswer<SalesContributionResult>;
  runway?: DecisionAnswer<RunwayScenarioResult[]>;
  breakEvenProject?: DecisionAnswer<BreakEvenProjectResult>;
  breakEvenCorporate?: DecisionAnswer<BreakEvenCorporateResult>;
  freeCashToInvest?: DecisionAnswer<FreeCashToInvestResult>;
  /** `true` quando o usuário pode acionar a simulação de contratação (Financeiro) — a simulação em si roda por ação de servidor separada, nunca aqui. */
  hiringSimulationAvailable: boolean;
  /** `true` quando o usuário pode acionar a simulação de desconto (Comercial). */
  discountSimulationAvailable: boolean;
}

export async function getDecisionInsights(
  authContext: Pick<AuthContext, "organizationId" | "role">,
  project: { id: string; companyId: string | null },
  scopeProjects: CorporateBreakEvenScopeProject[],
  referenceDate = new Date(),
): Promise<DecisionInsightsBundle> {
  const organizationId = authContext.organizationId;
  await projectForTenant(organizationId, project.id);
  const canViewFinancial = hasWorkspaceCapability(authContext.role, "FINANCIAL_VIEW");
  const canViewCommercial = hasWorkspaceCapability(authContext.role, "COMMERCIAL_VIEW");

  const [salesContribution, runway, breakEvenProject, breakEvenCorporate, freeCashToInvest] = await Promise.all([
    canViewFinancial && canViewCommercial ? buildSalesContributionAnswer(organizationId, project.id, referenceDate) : Promise.resolve(undefined),
    canViewFinancial ? buildRunwayAnswer(organizationId, project.id, project.companyId, referenceDate) : Promise.resolve(undefined),
    canViewFinancial ? buildBreakEvenProjectAnswer(organizationId, project.id, referenceDate) : Promise.resolve(undefined),
    canViewFinancial ? buildBreakEvenCorporateAnswer(organizationId, scopeProjects, referenceDate) : Promise.resolve(undefined),
    canViewFinancial ? buildFreeCashAnswer(organizationId, project.id, project.companyId, referenceDate) : Promise.resolve(undefined),
  ]);

  return {
    projectId: project.id,
    generatedAt: referenceDate.toISOString(),
    salesContribution,
    runway,
    breakEvenProject,
    breakEvenCorporate: breakEvenCorporate ?? undefined,
    freeCashToInvest,
    hiringSimulationAvailable: canViewFinancial,
    discountSimulationAvailable: canViewCommercial,
  };
}

// ---------------------------------------------------------------------------
// Pergunta 4 — simulação de contratação (leitura + cálculo, nunca cria pessoa/folha)
// ---------------------------------------------------------------------------

export async function simulateHiringForProject(
  authContext: Pick<AuthContext, "organizationId" | "role">,
  projectId: string,
  monthlyCost: number,
  referenceDate = new Date(),
): Promise<DecisionAnswer<HiringSimulationResult>> {
  if (!hasWorkspaceCapability(authContext.role, "FINANCIAL_VIEW")) throw new Error("Seu perfil não tem a capacidade Financeiro necessária para simular contratação.");
  const organizationId = authContext.organizationId;
  const project = await projectForTenant(organizationId, projectId);
  const [{ base }, horizons] = await Promise.all([resolveRunwayBase(organizationId, projectId, project.companyId, referenceDate), queryPayableHorizonAmounts(organizationId, projectId, referenceDate)]);
  const answer = simulateHiring({ monthlyCost, runwayBase: base, reserveMinimum: horizons.reserveMinimum });
  return {
    id: "hiring_simulation",
    title: "Dá para contratar agora?",
    status: answer.status,
    headline: answer.data ? answer.data.conclusion : "Sem histórico suficiente para simular",
    explanation: "Simulação somente — nenhuma pessoa ou folha é criada. Compara o fôlego de caixa projetado antes e depois de somar o custo mensal informado às saídas médias reais.",
    premises: [`Custo mensal simulado: ${currency.format(monthlyCost)}.`, `Reserva mínima sugerida (compromissos ≤ 30 dias): ${currency.format(horizons.reserveMinimum)}.`, `Janela histórica: ${base.historicalMonths} mês(es) real(is).`],
    confidence: base.historicalMonths >= 3 ? "ALTA" : base.historicalMonths > 0 ? "MEDIA" : null,
    source: "REDE — Financeiro (simulação)",
    freshness: resolveDomainFreshness(null, referenceDate, base.historicalMonths > 0),
    data: answer.data,
  };
}

// ---------------------------------------------------------------------------
// Pergunta 5 — simulação de desconto (leitura + cálculo, nunca altera venda/proposta)
// ---------------------------------------------------------------------------

export interface SimulableSalesUnit {
  id: string;
  code: string;
  typology: string;
  listPrice: number;
  minimumAuthorizedPrice: number | null;
}

export async function listSimulableSalesUnits(authContext: Pick<AuthContext, "organizationId" | "role">, projectId: string): Promise<SimulableSalesUnit[]> {
  if (!hasWorkspaceCapability(authContext.role, "COMMERCIAL_VIEW")) return [];
  await projectForTenant(authContext.organizationId, projectId);
  return querySimulableSalesUnits(authContext.organizationId, projectId);
}

export async function simulateDiscountForUnit(
  authContext: Pick<AuthContext, "organizationId" | "role">,
  projectId: string,
  salesUnitId: string,
  proposedPrice: number,
  referenceDate = new Date(),
): Promise<DecisionAnswer<DiscountSimulationResult>> {
  if (!hasWorkspaceCapability(authContext.role, "COMMERCIAL_VIEW")) throw new Error("Seu perfil não tem a capacidade Comercial necessária para simular desconto.");
  const organizationId = authContext.organizationId;
  await projectForTenant(organizationId, projectId);

  const unit = await prisma.salesUnit.findFirst({
    where: { id: salesUnitId, organizationId, projectId },
    select: { priceLines: { where: { priceTable: { status: "ACTIVE" } }, select: { listPrice: true, minimumAuthorizedPrice: true }, take: 1 } },
  });
  if (!unit || unit.priceLines.length === 0) throw new Error("Unidade sem tabela de preço ativa nesta organização/empreendimento.");
  const listPrice = Number(unit.priceLines[0].listPrice);
  const minimumAuthorizedPrice = unit.priceLines[0].minimumAuthorizedPrice ? Number(unit.priceLines[0].minimumAuthorizedPrice) : null;

  const { discountAmount } = computeDiscount(listPrice, proposedPrice);
  const discountAmountNumber = discountAmount.toNumber();
  const [commissionPolicy, study, requiredApprovalRole, stockSignal] = await Promise.all([
    prisma.salesCommissionPolicy.findFirst({ where: { organizationId, isActive: true, OR: [{ projectId }, { projectId: null }] }, orderBy: { projectId: "desc" }, select: { percentage: true } }),
    getLatestStudyForProject(organizationId, projectId),
    queryDiscountApprovalRole(organizationId, projectId, discountAmountNumber),
    queryMonthsOfStockSignal(organizationId, projectId, referenceDate),
  ]);
  const taxRate = study ? taxRateFraction(study.assumptions) : null;
  const monthsOfStock = stockSignal.averageMonthlyVelocity > 0 ? Math.round((stockSignal.availableCount / stockSignal.averageMonthlyVelocity) * 100) / 100 : null;

  const answer = simulateDiscount({
    listPrice,
    proposedPrice,
    commissionRate: commissionPolicy ? Number(commissionPolicy.percentage) : null,
    taxRate,
    minimumAuthorizedPrice,
    requiredApprovalRole,
    monthsOfStock,
  });

  return {
    id: "discount_simulation",
    title: "Esse desconto ainda faz sentido?",
    status: answer.status,
    headline: answer.data ? answer.data.conclusion : "Não foi possível simular",
    explanation: "Simulação sobre a unidade escolhida — nenhuma proposta ou venda é criada/alterada. Compara preço de tabela e preço proposto, com margem líquida quando há taxa de comissão e imposto de referência.",
    premises: [
      `Preço de tabela: ${currency.format(listPrice)}.`,
      commissionPolicy ? `Taxa de comissão de referência: ${percentage(Number(commissionPolicy.percentage))} (política ativa).` : "Sem política de comissão ativa para referência.",
      taxRate !== null ? `Taxa de imposto de referência: ${percentage(taxRate)} (estudo de viabilidade ativo).` : "Sem taxa de imposto de referência (nenhum estudo de viabilidade ativo).",
      minimumAuthorizedPrice !== null ? `Piso de preço autorizado da unidade: ${currency.format(minimumAuthorizedPrice)}.` : "Unidade sem piso de preço autorizado cadastrado.",
    ],
    confidence: commissionPolicy && taxRate !== null ? "ALTA" : "MEDIA",
    source: "REDE — Comercial (simulação)",
    freshness: resolveDomainFreshness(null, referenceDate, true),
    data: answer.data,
  };
}

export type { RunwayBaseInput };
