/**
 * Fase 9N §1/§4/§8 — consultas de leitura que alimentam as engines de `domain/capital/*`.
 * Mesma disciplina de `executive-insights-queries.ts`: nenhuma tabela nova além das já aprovadas,
 * cada consulta busca só os campos necessários, sempre filtrado por `organizationId`. A Base
 * Aprovada é lida da mesma forma que `data-intelligence-service.ts` já faz
 * (`calculationRun.findFirst` por `calculatedAt` desc) — não inventamos um segundo critério de
 * "oficial" divergente do resto do REDE.
 */
import { prisma } from "@/infrastructure/database/prisma";
import type { BaseProjectEconomics } from "@/domain/capital/comparator-engine";
import { computeCapitalNeed } from "@/domain/capital/needs-engine";
import { simulateFundingScenario } from "@/domain/capital/scenarios";
import type { CapitalNeedResult, DisbursementScheduleEntry, FundingProposalInput } from "@/domain/capital/types";

const APORTE_COUNTED_STATUSES = ["APPROVED", "RECORDED", "CONSOLIDATED"] as const;

async function projectForTenant(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  return project;
}

async function latestCalculationRun(organizationId: string, projectId: string) {
  return prisma.calculationRun.findFirst({
    where: { organizationId, projectId },
    orderBy: { calculatedAt: "desc" },
    include: { result: true, cashFlow: { orderBy: { month: "asc" } } },
  });
}

async function equityContributed(organizationId: string, projectId: string) {
  const aggregate = await prisma.intercompanyTransaction.aggregate({
    where: { organizationId, toProjectId: projectId, nature: "APORTE", status: { in: [...APORTE_COUNTED_STATUSES] } },
    _sum: { amount: true },
  });
  return Number(aggregate._sum.amount ?? 0);
}

/**
 * §8 — só soma o que o 9B realmente confirmou: `FundingDisbursement.status = DISBURSED` E a
 * `BankTransaction` vinculada com `direction = CREDIT` e `status = RECONCILED`. Nunca soma
 * `PLANNED`/`REQUESTED`/`APPROVED`, e nunca confia em `actualAmount` sozinho — lê o valor
 * diretamente da transação bancária (fonte real), rejeitando a linha se a conciliação foi
 * desfeita depois da confirmação.
 */
async function fundingDisbursedConfirmed(organizationId: string, projectId: string) {
  const disbursements = await prisma.fundingDisbursement.findMany({
    where: { status: "DISBURSED", proposal: { organizationId, projectId } },
    include: { bankTransaction: true },
  });
  const confirmed = disbursements.filter((d) => d.bankTransaction && d.bankTransaction.direction === "CREDIT" && d.bankTransaction.status === "RECONCILED");
  const total = confirmed.reduce((sum, d) => sum + Number(d.bankTransaction!.amount), 0);
  return { total, confirmedCount: confirmed.length, unconfirmedCount: disbursements.length - confirmed.length };
}

export interface CapitalNeedView extends CapitalNeedResult {
  projectId: string;
  hasOfficialCalculation: boolean;
  calculationRunId: string | null;
  calculatedAt: string | null;
  /** Desembolsos marcados DISBURSED mas cuja transação bancária não está (mais) CREDIT/RECONCILED — não entraram na soma; ver `fundingDisbursedConfirmed`. */
  unconfirmedDisbursementCount: number;
}

/** §1 — necessidade de capital: lê a Base Aprovada oficial, nunca recalcula viabilidade. */
export async function getCapitalNeedForProject(context: Pick<{ organizationId: string }, "organizationId">, projectId: string): Promise<CapitalNeedView> {
  const project = await projectForTenant(context.organizationId, projectId);
  const [run, contributed, disbursed] = await Promise.all([
    latestCalculationRun(context.organizationId, project.id),
    equityContributed(context.organizationId, project.id),
    fundingDisbursedConfirmed(context.organizationId, project.id),
  ]);

  if (!run?.result) {
    return {
      projectId: project.id,
      hasOfficialCalculation: false,
      calculationRunId: null,
      calculatedAt: null,
      totalCapitalNeed: "0.00",
      peakExposureMonth: 0,
      monthlyCurve: [],
      deficitMonths: [],
      equityContributed: contributed.toFixed(2),
      fundingDisbursed: disbursed.total.toFixed(2),
      fundingStillNeeded: "0.00",
      fullyCovered: contributed + disbursed.total <= 0,
      unconfirmedDisbursementCount: disbursed.unconfirmedCount,
    };
  }

  const result = computeCapitalNeed(
    run.cashFlow.map((row) => ({ month: row.month, phase: row.phase as "aprovacao" | "obra" | "pos-entrega", cumulativeProjectCash: row.cumulativeProjectCash.toString() })),
    { maximumCashExposure: run.result.maximumCashExposure.toString(), maximumExposureMonth: run.result.maximumExposureMonth },
    contributed.toFixed(2),
    disbursed.total.toFixed(2),
  );

  return { ...result, projectId: project.id, hasOfficialCalculation: true, calculationRunId: run.id, calculatedAt: run.calculatedAt.toISOString(), unconfirmedDisbursementCount: disbursed.unconfirmedCount };
}

/** §4 — economia base do projeto para o comparador (`BaseProjectEconomics`), lida da mesma Base Aprovada. */
export async function getBaseProjectEconomicsForProject(context: Pick<{ organizationId: string }, "organizationId">, projectId: string): Promise<BaseProjectEconomics | null> {
  const project = await projectForTenant(context.organizationId, projectId);
  const run = await latestCalculationRun(context.organizationId, project.id);
  if (!run?.result) return null;
  return {
    vgv: run.result.vgv.toString(),
    profit: run.result.profit.toString(),
    totalCost: run.result.totalCost.toString(),
    operatingNetByMonth: run.cashFlow.map((row) => ({ month: row.month, operatingNet: row.operatingNet.toString() })),
  };
}

// ---------------------------------------------------------------------------
// §9 — workspace de leitura para a UI de Capital & Funding
// ---------------------------------------------------------------------------

export async function getFundingProposalsForProject(context: Pick<{ organizationId: string }, "organizationId">, projectId: string) {
  await projectForTenant(context.organizationId, projectId);
  return prisma.fundingProposal.findMany({
    where: { organizationId: context.organizationId, projectId },
    include: {
      guarantees: true,
      covenants: { include: { evaluations: { orderBy: { testedAt: "desc" } } } },
      conditions: true,
      disbursements: { include: { bankTransaction: true }, orderBy: { sequence: "asc" } },
    },
    orderBy: [{ code: "asc" }, { version: "desc" }],
  });
}

export async function getFundingProposalDetail(context: Pick<{ organizationId: string }, "organizationId">, proposalId: string) {
  const proposal = await prisma.fundingProposal.findFirst({
    where: { id: proposalId, organizationId: context.organizationId },
    include: {
      guarantees: true,
      covenants: { include: { evaluations: { orderBy: { testedAt: "desc" } } } },
      conditions: true,
      disbursements: { include: { bankTransaction: true }, orderBy: { sequence: "asc" } },
      financialEvents: { orderBy: [{ scheduleVersion: "desc" }, { installmentNumber: "asc" }] },
      previousVersion: { select: { id: true, version: true, status: true } },
      nextVersions: { select: { id: true, version: true, status: true } },
    },
  });
  if (!proposal) throw new Error("Proposta de funding não encontrada nesta organização.");
  return proposal;
}

/** §9/§10 — resumo de Capital/Funding para Gestão Executiva e para a tela dedicada. */
export async function getCapitalExecutiveSummary(context: Pick<{ organizationId: string }, "organizationId">, projectId: string) {
  const project = await projectForTenant(context.organizationId, projectId);
  const [capitalNeed, proposals] = await Promise.all([
    getCapitalNeedForProject(context, project.id),
    getFundingProposalsForProject(context, project.id),
  ]);

  const approved = proposals.filter((p) => p.status === "APPROVED");
  const contracted = approved.reduce((sum, p) => sum + Number(p.amount), 0);
  const allDisbursements = approved.flatMap((p) => p.disbursements);
  const confirmedDisbursements = allDisbursements.filter((d) => d.status === "DISBURSED" && d.bankTransaction?.direction === "CREDIT" && d.bankTransaction.status === "RECONCILED");
  const disbursedTotal = confirmedDisbursements.reduce((sum, d) => sum + Number(d.bankTransaction!.amount), 0);
  const pendingDisbursements = allDisbursements.filter((d) => d.status !== "DISBURSED" && d.status !== "CANCELLED");
  const balanceToRelease = pendingDisbursements.reduce((sum, d) => sum + Number(d.expectedAmount), 0);
  const nextRelease = pendingDisbursements.filter((d) => d.status !== "PLANNED" || true).sort((a, b) => a.expectedDate.getTime() - b.expectedDate.getTime())[0] ?? null;
  const averageCost = approved.length > 0 ? approved.reduce((sum, p) => sum + Number(p.annualNominalRate) * Number(p.amount), 0) / Math.max(contracted, 1) : null;

  const covenantsAtRisk = approved.flatMap((p) => p.covenants).filter((c) => c.status === "WARNING" || c.status === "BREACHED");
  const conditionsPending = approved.flatMap((p) => p.conditions).filter((c) => c.status === "PENDING");

  return {
    projectId: project.id,
    fundingNecessario: Number(capitalNeed.fundingStillNeeded),
    fundingContratado: contracted,
    desembolsado: disbursedTotal,
    saldoALiberar: balanceToRelease,
    custoMedio: averageCost,
    proximaLiberacao: nextRelease ? { disbursementId: nextRelease.id, proposalId: nextRelease.proposalId, expectedDate: nextRelease.expectedDate.toISOString(), expectedAmount: Number(nextRelease.expectedAmount) } : null,
    covenantsEmRisco: covenantsAtRisk.length,
    condicoesPendentes: conditionsPending.length,
    capitalNeed,
  };
}

export type CapitalExecutiveSummary = Awaited<ReturnType<typeof getCapitalExecutiveSummary>>;
export type FundingWorkspaceProposal = Awaited<ReturnType<typeof getFundingProposalsForProject>>[number];

/**
 * §4/§5/§9 — comparação A vs B vs C das propostas ainda em decisão (DRAFT/SUBMITTED/UNDER_REVIEW).
 * Simulação pura em memória (`domain/capital/scenarios.ts`): nunca grava nada, nunca altera a Base
 * Aprovada nem as propostas — só recombina o serviço da dívida de cada proposta com o
 * `operatingNet` real da viabilidade oficial. Propostas já `APPROVED` mostram seu
 * `decisionSnapshot` (congelado no momento da decisão) em vez de serem recomparadas aqui.
 */
export async function compareOpenFundingProposals(context: Pick<{ organizationId: string }, "organizationId">, projectId: string) {
  const project = await projectForTenant(context.organizationId, projectId);
  const [base, capitalNeed, openProposals] = await Promise.all([
    getBaseProjectEconomicsForProject(context, project.id),
    getCapitalNeedForProject(context, project.id),
    prisma.fundingProposal.findMany({ where: { organizationId: context.organizationId, projectId: project.id, status: { in: ["DRAFT", "SUBMITTED", "UNDER_REVIEW"] } } }),
  ]);
  if (!base || openProposals.length === 0) return [];

  const proposalInputs: FundingProposalInput[] = openProposals.map((p) => ({
    id: p.id,
    providerName: p.providerName,
    kind: p.kind,
    amount: p.amount.toString(),
    indexer: p.indexer,
    annualNominalRate: p.annualNominalRate.toString(),
    termMonths: p.termMonths,
    graceMonths: p.graceMonths,
    amortizationSystem: p.amortizationSystem,
    fees: { upfrontFeeRate: p.upfrontFeeRate.toString(), recurringFeeRateAnnual: p.recurringFeeRateAnnual.toString(), iofRate: p.iofRate?.toString() },
    disbursementSchedule: (p.disbursementSchedule as DisbursementScheduleEntry[] | null) ?? undefined,
  }));

  const scenario = simulateFundingScenario("PROPOSAL_COMPARISON", proposalInputs, capitalNeed.monthlyCurve, base);
  return scenario.proposals;
}
