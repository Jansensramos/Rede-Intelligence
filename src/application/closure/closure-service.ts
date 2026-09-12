import { randomUUID, createHash } from "node:crypto";
import Decimal from "decimal.js";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { evaluateProjectClosureReadiness } from "./closure-gate-service";
import { loadDistributionTotals } from "./distribution-service";
import { computeRealizedResult, missingCentralEvidence, validateApprovedDistributionsAggregate, type EvidenceValue } from "@/domain/closure/result";
import { evaluateForecastAccuracy } from "@/domain/data-intelligence";
import { prepareProjectClosureResultSchema, approveProjectClosureResultSchema, reopenProjectClosureResultSchema, type PrepareProjectClosureResultInput, type ApproveProjectClosureResultInput, type ReopenProjectClosureResultInput } from "@/domain/closure/schemas";

/**
 * Fase 9S — encerramento do empreendimento: resultado realizado final e memória
 * histórica. Reaproveita obrigatoriamente `RevenueRecognitionRun` (receita/custo),
 * `TaxAssessment` (tributos), `PayableInstallment`/`FinancialObligation` (custos
 * financeiros de funding e devoluções de distrato — via `documentRef` já usado por
 * `external-obligation-port.ts`, nenhum campo novo), `FundingDisbursement` (funding
 * desembolsado), `AccountingProvision` (provisões), `Sale`/`SalesUnit` (distratos),
 * `ReceivableInstallment` (inadimplência), `AssumptionSnapshot`/`DecisionLedgerEntry`/
 * `RiskFinding` (memória histórica) — nenhuma segunda contabilidade, nenhum
 * recálculo paralelo do que essas fontes já produzem.
 */

const mutableRoles = new Set(["OWNER", "ADMIN", "ANALYST"]);
const approverRoles = new Set(["OWNER", "ADMIN"]);
const REOPEN_MAX_ATTEMPTS = 3;
const PREPARE_MAX_ATTEMPTS = 3;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const checksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Engine version travado nesta correção — muda só se a fórmula de comparação previsto×realizado do encerramento mudar. */
const CLOSURE_FORECAST_ENGINE_VERSION = "9S-CLOSURE-FORECAST-V1";

/** Cliente Prisma global ou de transação — mesmo padrão de `loadDistributionTotals`/`closure-gate-service.ts`: permite que a mesma lógica de escrita seja reaproveitada dentro de uma transação `Serializable`. */
type ClosureClient = typeof prisma | Prisma.TransactionClient;

/**
 * Erro classificado (correção focal final — TOCTOU): `reasonCode` estático e seguro
 * (nunca texto jurídico, PII ou valor bruto), `correlationId` sempre gerado no
 * servidor. Nunca reexecutado automaticamente — é sempre uma recusa de negócio
 * definitiva (estado incompatível), nunca um conflito transiente de serialização.
 */
export class ClosurePreparationError extends Error {
  constructor(message: string, readonly reasonCode: "APPROVED_DISTRIBUTION_LOCK" | "CONCURRENCY_CONFLICT", readonly correlationId: string) {
    super(message);
    this.name = "ClosurePreparationError";
  }
}

function assertMutable(context: Pick<AuthContext, "role">) {
  if (!mutableRoles.has(context.role)) throw new Error("Seu perfil não pode preparar o encerramento do empreendimento.");
}
function assertApprover(context: Pick<AuthContext, "role">) {
  if (!approverRoles.has(context.role)) throw new Error("Seu perfil não pode aprovar o encerramento do empreendimento.");
}
/** Decisão 3 — só OWNER pode solicitar reabertura. */
function assertReopener(context: Pick<AuthContext, "role">) {
  if (context.role !== "OWNER") throw new Error("Somente o perfil OWNER pode reabrir um encerramento aprovado.");
}

/** correlationId sempre gerado no servidor — nunca aceito de entrada do cliente. */
const audit = (
  context: Pick<AuthContext, "organizationId" | "userId">,
  projectId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  after: unknown,
  extra: { before?: unknown; correlationId: string },
) => ({
  organizationId: context.organizationId, userId: context.userId, projectId, action, entityType, entityId,
  after: after === undefined ? undefined : json(after),
  ...(extra.before !== undefined ? { before: json(extra.before) } : {}),
  metadata: json({ correlationId: extra.correlationId, operationType: action }),
});
const newCorrelationId = () => randomUUID();

async function projectForTenant(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  return project;
}
async function closureResultForTenant(organizationId: string, closureResultId: string) {
  const result = await prisma.projectClosureResult.findFirst({ where: { id: closureResultId, organizationId } });
  if (!result) throw new Error("Encerramento não encontrado nesta organização.");
  return result;
}

const evidence = (value: string | null | undefined, sourceType?: string, sourceId?: string, asOfDate?: Date): { field: EvidenceValue; ref: Record<string, unknown> | null } => {
  if (value === null || value === undefined) return { field: { status: "SEM_EVIDENCIA", value: null }, ref: null };
  return { field: { status: "COM_EVIDENCIA", value }, ref: { sourceType, sourceId, asOfDate: asOfDate?.toISOString() } };
};

/**
 * Reúne os fatos reais para o resultado realizado — puro no sentido de nunca escrever,
 * só ler. Usado tanto por `prepareProjectClosureResult` quanto (via releitura) por
 * `approveProjectClosureResult` dentro da mesma transação.
 */
async function gatherRealizedFacts(organizationId: string, project: { id: string; companyId: string | null }, now: Date) {
  const [revenueRun, taxAssessments, fundingCostAccounts, fundingDisbursements, capitalContributed, refundAccounts, rescissions, delinquency, provisions] = await Promise.all([
    prisma.revenueRecognitionRun.findFirst({ where: { organizationId, projectId: project.id }, orderBy: [{ cutoffDate: "desc" }, { version: "desc" }] }),
    project.companyId ? prisma.taxAssessment.findMany({ where: { organizationId, companyId: project.companyId, projectId: project.id, status: { in: ["APPROVED", "POSTED", "CLOSED"] } } }) : Promise.resolve([]),
    prisma.payableAccount.findMany({ where: { organizationId, projectId: project.id, obligation: { documentRef: { startsWith: "FUNDING_PROPOSAL:" } } }, include: { installments: { where: { status: "PAGA" } } } }),
    prisma.fundingDisbursement.findMany({ where: { proposal: { organizationId, projectId: project.id }, status: "DISBURSED", bankTransactionId: { not: null } } }),
    prisma.projectClosureDistribution.aggregate({ where: { organizationId, projectId: project.id, nature: "CAPITAL_CONTRIBUTION", status: "APPROVED" }, _sum: { amount: true } }),
    prisma.payableAccount.findMany({ where: { organizationId, projectId: project.id, obligation: { documentRef: { startsWith: "SALE_RESCISSION:" } } }, include: { installments: { where: { status: "PAGA" } } } }),
    prisma.sale.findMany({ where: { organizationId, projectId: project.id, status: "CANCELLED", cancelledReason: { not: null } }, select: { id: true, soldPrice: true } }),
    prisma.receivableInstallment.aggregate({ where: { receivableAccount: { organizationId, projectId: project.id }, status: { in: ["PREVISTA", "EMITIDA", "PARCIALMENTE_RECEBIDA"] }, dueDate: { lt: now } }, _sum: { currentAmount: true } }),
    prisma.accountingProvision.aggregate({ where: { organizationId, projectId: project.id, status: "ACTIVE" }, _sum: { amount: true } }),
  ]);

  const sumInstallments = (accounts: Array<{ installments: Array<{ currentAmount: Prisma.Decimal }> }>) =>
    accounts.reduce((sum, account) => sum + account.installments.reduce((inner, installment) => inner + Number(installment.currentAmount), 0), 0);

  const realizedVgv = revenueRun ? evidence(revenueRun.totalVgv.toString(), "RevenueRecognitionRun", revenueRun.id, revenueRun.createdAt) : evidence(null);
  const realizedRevenue = revenueRun ? evidence(revenueRun.recognizedRevenue.toString(), "RevenueRecognitionRun", revenueRun.id, revenueRun.createdAt) : evidence(null);
  const realizedCost = revenueRun ? evidence(revenueRun.recognizedCost.toString(), "RevenueRecognitionRun", revenueRun.id, revenueRun.createdAt) : evidence(null);
  const realizedTaxes = taxAssessments.length
    ? evidence(taxAssessments.reduce((sum, item) => sum + Number(item.assessedAmount), 0).toString(), "TaxAssessment", taxAssessments.map((item) => item.id).join(","), now)
    : evidence(null);
  const financialCostsPaid = sumInstallments(fundingCostAccounts);
  const realizedFinancialCosts = fundingCostAccounts.length ? evidence(financialCostsPaid.toString(), "PayableAccount", fundingCostAccounts.map((a) => a.id).join(","), now) : evidence(null);
  const fundingDisbursedTotal = fundingDisbursements.reduce((sum, item) => sum + Number(item.actualAmount ?? 0), 0);
  const realizedFundingDisbursed = fundingDisbursements.length ? evidence(fundingDisbursedTotal.toString(), "FundingDisbursement", fundingDisbursements.map((item) => item.id).join(","), now) : evidence(null);
  const realizedCapitalContributed = capitalContributed._sum.amount ? evidence(capitalContributed._sum.amount.toString(), "ProjectClosureDistribution", "CAPITAL_CONTRIBUTION", now) : evidence(null);
  const refundsPaid = sumInstallments(refundAccounts);
  const realizedRefunds = refundAccounts.length ? evidence(refundsPaid.toString(), "PayableAccount", refundAccounts.map((a) => a.id).join(","), now) : evidence(null);
  const rescissionsAmount = rescissions.reduce((sum, sale) => sum + Number(sale.soldPrice), 0);
  const realizedDelinquency = evidence((delinquency._sum.currentAmount ?? 0).toString(), "ReceivableInstallment", "overdue", now);
  const realizedProvisions = evidence((provisions._sum.amount ?? 0).toString(), "AccountingProvision", "ACTIVE", now);

  const { realizedResult, realizedMarginOnVgv, realizedMarginOnNetRevenue } = computeRealizedResult({
    realizedRevenue: realizedRevenue.field, realizedCost: realizedCost.field, realizedExpenses: evidence(null).field,
    realizedTaxes: realizedTaxes.field, realizedFinancialCosts: realizedFinancialCosts.field, realizedVgv: realizedVgv.field, realizedNetRevenue: realizedRevenue.field,
  });

  const evidenceStatus: Record<string, unknown> = {
    realizedVgv: { ...realizedVgv.field, ...realizedVgv.ref }, realizedRevenue: { ...realizedRevenue.field, ...realizedRevenue.ref }, realizedCost: { ...realizedCost.field, ...realizedCost.ref },
    realizedExpenses: { status: "SEM_EVIDENCIA", value: null }, realizedTaxes: { ...realizedTaxes.field, ...realizedTaxes.ref },
    realizedFinancialCosts: { ...realizedFinancialCosts.field, ...realizedFinancialCosts.ref }, realizedFundingDisbursed: { ...realizedFundingDisbursed.field, ...realizedFundingDisbursed.ref },
    realizedCapitalContributed: { ...realizedCapitalContributed.field, ...realizedCapitalContributed.ref }, realizedRefunds: { ...realizedRefunds.field, ...realizedRefunds.ref },
    realizedResult: { ...realizedResult }, realizedMarginOnVgv: { ...realizedMarginOnVgv }, realizedMarginOnNetRevenue: { ...realizedMarginOnNetRevenue },
  };

  return {
    realizedVgv: realizedVgv.field.value, realizedRevenue: realizedRevenue.field.value, realizedCost: realizedCost.field.value,
    realizedExpenses: null as string | null, realizedTaxes: realizedTaxes.field.value, realizedFinancialCosts: realizedFinancialCosts.field.value,
    realizedFundingDisbursed: realizedFundingDisbursed.field.value, realizedCapitalContributed: realizedCapitalContributed.field.value,
    realizedRefunds: realizedRefunds.field.value, realizedRescissionsAmount: rescissionsAmount.toString(), realizedRescissionsCount: rescissions.length,
    realizedDelinquency: realizedDelinquency.field.value, realizedProvisions: realizedProvisions.field.value,
    realizedResult: realizedResult.value, realizedMarginOnVgv: realizedMarginOnVgv.value, realizedMarginOnNetRevenue: realizedMarginOnNetRevenue.value,
    realizedRoi: null as string | null, realizedIrr: null as string | null,
    evidenceStatus,
    revenueRecognitionRunId: revenueRun?.id ?? null,
    missingCentral: missingCentralEvidence({
      realizedRevenue: realizedRevenue.field, realizedCost: realizedCost.field, realizedTaxes: realizedTaxes.field,
      realizedFinancialCosts: realizedFinancialCosts.field, realizedResult, realizedMarginOnVgv,
    }),
  };
}

/** Memória histórica — decisão do contrato §4.6: referências, nunca duplicação de conteúdo. */
async function gatherHistoricalRefs(organizationId: string, projectId: string) {
  const [assumptionSnapshot, decisionEntries, riskFindings] = await Promise.all([
    prisma.assumptionSnapshot.findFirst({ where: { studyVersion: { study: { projectId, project: { organizationId } } } }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    prisma.decisionLedgerEntry.findMany({ where: { investmentCase: { organizationId, projectId } }, select: { id: true }, take: 50 }),
    prisma.riskFinding.findMany({ where: { calculationRun: { organizationId, projectId } }, select: { id: true }, take: 50 }),
  ]);
  return {
    assumptionSnapshotId: assumptionSnapshot?.id ?? null,
    decisionRefs: decisionEntries.map((entry) => ({ type: "DecisionLedgerEntry", id: entry.id })),
    materializedRiskRefs: riskFindings.map((finding) => ({ type: "RiskFinding", id: finding.id })),
  };
}

/**
 * Previsto × realizado (correção Alto #2 pós-reauditoria REPROVADA) — fonte prevista
 * elegível: a `StudyVersion` `SNAPSHOT` mais recente do projeto (mesma convenção já
 * usada por `createInvestmentCase`/9L para "a versão congelada vigente" — nunca
 * `DRAFT`, que é mutável), o cenário `BASE` dessa versão, e o `CalculationRun` mais
 * recente desse par versão+cenário. Nenhum desses é presumido: ausência em qualquer
 * elo (sem SNAPSHOT, sem cenário BASE, sem run, sem `FinancialResult`) retorna tudo
 * `null` — nunca fabrica um previsto.
 */
async function gatherForecastLink(organizationId: string, project: { id: string }) {
  const snapshotVersion = await prisma.studyVersion.findFirst({
    where: { status: "SNAPSHOT", study: { projectId: project.id, project: { organizationId } } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const baseScenario = snapshotVersion
    ? await prisma.scenario.findFirst({ where: { studyVersionId: snapshotVersion.id, kind: "BASE" }, orderBy: { createdAt: "desc" }, select: { id: true } })
    : null;
  const calculationRun = snapshotVersion && baseScenario
    ? await prisma.calculationRun.findFirst({
        where: { organizationId, projectId: project.id, studyVersionId: snapshotVersion.id, scenarioId: baseScenario.id },
        orderBy: { calculatedAt: "desc" },
        include: { result: true },
      })
    : null;
  if (!calculationRun?.result) {
    return { financialResultId: null, calculationRunId: null, calculatedAt: null, netRevenue: null, totalCost: null, profit: null, marginOnNetRevenue: null };
  }
  return {
    financialResultId: calculationRun.result.id, calculationRunId: calculationRun.id, calculatedAt: calculationRun.calculatedAt,
    netRevenue: calculationRun.result.netRevenue, totalCost: calculationRun.result.totalCost, profit: calculationRun.result.profit,
    marginOnNetRevenue: calculationRun.result.marginOnNetRevenue,
  };
}
type ForecastLink = Awaited<ReturnType<typeof gatherForecastLink>>;

/**
 * Registra/atualiza (idempotente) as 4 `ForecastEvaluation` (receita, custo, resultado,
 * margem) desta versão do encerramento — `forecastVersion = ProjectClosureResult.version`,
 * nunca a mesma chave entre versões diferentes, então uma versão `FINAL` já aprovada
 * nunca tem suas avaliações reescritas por uma versão posterior (decisão explícita da
 * correção: "não altere snapshots FINAL anteriores"). Métrica sem fonte prevista sã
 * (não finita) é pulada inteira — nunca vira zero. Métrica com previsto mas sem
 * realizado ainda é gravada com `evaluated: false, actualValue: null` (nunca 0).
 */
async function upsertClosureForecastEvaluations(
  client: ClosureClient,
  context: AuthContext,
  project: { id: string },
  link: ForecastLink,
  closureResult: { id: string; version: number },
  facts: { realizedRevenue: string | null; realizedCost: string | null; realizedResult: string | null; realizedMarginOnNetRevenue: string | null },
): Promise<string[]> {
  if (link.financialResultId === null || link.calculationRunId === null || link.calculatedAt === null) return [];
  const metrics: Array<{ key: string; name: string; unit: string; aggregation: "LAST" | "RATIO"; predicted: Prisma.Decimal | null; actual: string | null }> = [
    { key: "encerramento_receita_realizada", name: "Receita realizada no encerramento (9S)", unit: "BRL", aggregation: "LAST", predicted: link.netRevenue, actual: facts.realizedRevenue },
    { key: "encerramento_custo_realizado", name: "Custo realizado no encerramento (9S)", unit: "BRL", aggregation: "LAST", predicted: link.totalCost, actual: facts.realizedCost },
    { key: "encerramento_resultado_realizado", name: "Resultado realizado no encerramento (9S)", unit: "BRL", aggregation: "LAST", predicted: link.profit, actual: facts.realizedResult },
    { key: "encerramento_margem_realizada", name: "Margem realizada no encerramento (9S, s/ receita líquida)", unit: "RATIO", aggregation: "RATIO", predicted: link.marginOnNetRevenue, actual: facts.realizedMarginOnNetRevenue },
  ];

  const ids: string[] = [];
  for (const metric of metrics) {
    if (metric.predicted === null || !metric.predicted.isFinite()) continue;
    const metricDefinition = await client.metricDefinition.upsert({
      where: { organizationId_key_version: { organizationId: context.organizationId, key: metric.key, version: 1 } },
      update: {},
      create: {
        organizationId: context.organizationId, key: metric.key, name: metric.name, version: 1,
        definition: "Comparação previsto (CalculationRun/FinancialResult da versão SNAPSHOT/cenário BASE) × realizado (ProjectClosureResult) no encerramento do empreendimento — Fase 9S, correção pós-reauditoria REPROVADA.",
        formula: metric.aggregation === "RATIO" ? "realizado (já calculado) / previsto (já calculado)" : "realizado (já calculado) − previsto (já calculado)",
        engineVersion: CLOSURE_FORECAST_ENGINE_VERSION, unit: metric.unit, aggregation: metric.aggregation, grain: "PROJECT_CLOSURE",
        dimensions: json({}), ownerId: context.userId, status: "ACTIVE", effectiveFrom: new Date(), createdById: context.userId,
      },
    });

    const actual = metric.actual !== null ? new Decimal(metric.actual) : null;
    const evaluated = actual !== null;
    const absoluteError = actual !== null ? actual.minus(metric.predicted).abs() : null;
    const percentError = actual !== null && !metric.predicted.isZero() ? actual.minus(metric.predicted).dividedBy(metric.predicted.abs()) : null;
    const bias = actual !== null ? evaluateForecastAccuracy({ predictedValue: metric.predicted.toNumber(), actualValue: actual.toNumber() }).bias : null;

    const payload = {
      organizationId: context.organizationId, projectId: project.id, metricDefinitionId: metricDefinition.id,
      forecastSourceType: "CalculationRun", forecastSourceId: link.calculationRunId, forecastVersion: closureResult.version,
      predictedValue: metric.predicted, predictedAsOfDate: link.calculatedAt, horizonStage: "DELIVERED" as const,
      actualValue: actual, actualAsOfDate: evaluated ? new Date() : null,
      actualSourceType: evaluated ? "ProjectClosureResult" : null, actualSourceId: evaluated ? closureResult.id : null,
      unit: metric.unit, absoluteError, percentError, bias, evaluated,
    };
    const row = await client.forecastEvaluation.upsert({
      where: {
        organizationId_forecastSourceType_forecastSourceId_forecastVersion_metricDefinitionId: {
          organizationId: context.organizationId, forecastSourceType: "CalculationRun", forecastSourceId: link.calculationRunId,
          forecastVersion: closureResult.version, metricDefinitionId: metricDefinition.id,
        },
      },
      update: { ...payload, checksum: checksum(payload), calculatedAt: new Date() },
      create: { ...payload, checksum: checksum(payload) },
    });
    ids.push(row.id);
  }
  return ids;
}

/**
 * Aplica o resultado de `upsertClosureForecastEvaluations` no próprio `ProjectClosureResult`
 * — 2ª escrita pequena, sempre sobre uma linha ainda mutável (DRAFT) no momento em que é
 * chamada. Genérico em `T` só para preservar o tipo completo da linha (create/update) no
 * retorno — os dois call sites sempre passam a linha inteira. Recebe `client` (correção
 * focal final — TOCTOU): quando chamada dentro de `prisma.$transaction`, todo o upsert de
 * `MetricDefinition`/`ForecastEvaluation` e esta atualização final acontecem na MESMA
 * transação `Serializable` do guard+CAS — se a transação abortar (P2034) ou for recusada
 * pelo guard, tudo é revertido junto, nunca deixando avaliação órfã ou parcial.
 */
async function finalizeClosureResultForecast<T extends { id: string; version: number }>(
  client: ClosureClient,
  context: AuthContext,
  project: { id: string },
  link: ForecastLink,
  result: T,
  facts: { realizedRevenue: string | null; realizedCost: string | null; realizedResult: string | null; realizedMarginOnNetRevenue: string | null },
): Promise<T> {
  const forecastEvaluationIds = await upsertClosureForecastEvaluations(client, context, project, link, result, facts);
  if (forecastEvaluationIds.length === 0) return result;
  return client.projectClosureResult.update({ where: { id: result.id }, data: { forecastEvaluationIds: json(forecastEvaluationIds) } }) as unknown as Promise<T>;
}

/**
 * Prepara (ou recalcula) o `ProjectClosureResult` em DRAFT — nunca exige o gate
 * `APTO` (é um rascunho de acompanhamento). Cálculo puro (`gatherRealizedFacts`,
 * `gatherHistoricalRefs`, `gatherForecastLink`, o gate de leitura) acontece ANTES,
 * fora de qualquer transação; a releitura decisiva (status do rascunho + contagem
 * de distribuições `APPROVED`) e toda escrita acontecem DENTRO de uma transação
 * `Serializable` (correção focal final — TOCTOU, achado Bloqueador): o Postgres
 * detecta, via SSI, qualquer aprovação concorrente de distribuição que crie
 * "write skew" com esta releitura, e aborta uma das duas transações (P2034,
 * retry limitado). Nunca deixa persistência parcial: se o guard recusar ou a
 * transação abortar, nada é escrito — nem o `ProjectClosureResult`, nem
 * `MetricDefinition`/`ForecastEvaluation`, nem `AuditLog`.
 */
export async function prepareProjectClosureResult(context: AuthContext, raw: PrepareProjectClosureResultInput) {
  assertMutable(context);
  const input = prepareProjectClosureResultSchema.parse(raw);
  const project = await projectForTenant(context.organizationId, input.projectId);
  const correlationId = newCorrelationId();

  const [facts, historicalRefs, forecastLink, gate, latestVersion] = await Promise.all([
    gatherRealizedFacts(context.organizationId, project, new Date()),
    gatherHistoricalRefs(context.organizationId, project.id),
    gatherForecastLink(context.organizationId, project),
    evaluateProjectClosureReadiness(prisma, context.organizationId, project.id),
    prisma.projectClosureResult.findFirst({ where: { organizationId: context.organizationId, projectId: project.id }, orderBy: { version: "desc" } }),
  ]);

  const data = {
    realizedVgv: facts.realizedVgv, realizedRevenue: facts.realizedRevenue, realizedCost: facts.realizedCost, realizedExpenses: facts.realizedExpenses,
    realizedTaxes: facts.realizedTaxes, realizedFinancialCosts: facts.realizedFinancialCosts, realizedFundingDisbursed: facts.realizedFundingDisbursed,
    realizedCapitalContributed: facts.realizedCapitalContributed, realizedRefunds: facts.realizedRefunds, realizedRescissionsAmount: facts.realizedRescissionsAmount,
    realizedRescissionsCount: facts.realizedRescissionsCount, realizedDelinquency: facts.realizedDelinquency, realizedProvisions: facts.realizedProvisions,
    realizedResult: facts.realizedResult, realizedMarginOnVgv: facts.realizedMarginOnVgv, realizedMarginOnNetRevenue: facts.realizedMarginOnNetRevenue,
    realizedRoi: facts.realizedRoi, realizedIrr: facts.realizedIrr,
    evidenceStatus: json(facts.evidenceStatus), revenueRecognitionRunId: facts.revenueRecognitionRunId, financialResultId: forecastLink.financialResultId,
    assumptionSnapshotId: historicalRefs.assumptionSnapshotId, decisionRefs: json(historicalRefs.decisionRefs), materializedRiskRefs: json(historicalRefs.materializedRiskRefs),
    gateSnapshot: json(gate),
  };

  if (latestVersion?.status === "DRAFT") {
    return recalculateExistingDraft(context, project, latestVersion, data, forecastLink, facts, gate.overall, correlationId);
  }

  return createNewClosureResult(context, project, latestVersion, data, forecastLink, facts, gate.overall, correlationId);
}

/** Forma exata do `data` construído em `prepareProjectClosureResult`, reaproveitado (nunca redigitado) pelos dois ramos abaixo. */
interface ClosurePreparationData {
  realizedVgv: string | null; realizedRevenue: string | null; realizedCost: string | null; realizedExpenses: string | null;
  realizedTaxes: string | null; realizedFinancialCosts: string | null; realizedFundingDisbursed: string | null;
  realizedCapitalContributed: string | null; realizedRefunds: string | null; realizedRescissionsAmount: string;
  realizedRescissionsCount: number; realizedDelinquency: string | null; realizedProvisions: string | null;
  realizedResult: string | null; realizedMarginOnVgv: string | null; realizedMarginOnNetRevenue: string | null;
  realizedRoi: string | null; realizedIrr: string | null;
  evidenceStatus: Prisma.InputJsonValue; revenueRecognitionRunId: string | null; financialResultId: string | null;
  assumptionSnapshotId: string | null; decisionRefs: Prisma.InputJsonValue; materializedRiskRefs: Prisma.InputJsonValue;
  gateSnapshot: Prisma.InputJsonValue;
}

/**
 * Ramo que reaproveita um `DRAFT` existente (achado Bloqueador — TOCTOU corrigido
 * aqui). Guard (contagem de distribuições `APPROVED`) + CAS (`updateMany`
 * condicionado a `id`+`organizationId`+`projectId`+`status: "DRAFT"`+`version`) +
 * upsert de `ForecastEvaluation`/`MetricDefinition` + `AuditLog`, tudo dentro da
 * MESMA transação `Serializable`. Retry limitado exclusivamente a `P2034`
 * (conflito de serialização real) — uma recusa de negócio (`ClosurePreparationError`)
 * nunca é reexecutada automaticamente, e qualquer outro erro Prisma (ex.: `P2002`)
 * propaga imediatamente, sem retry.
 */
async function recalculateExistingDraft(
  context: AuthContext,
  project: { id: string },
  existingDraft: { id: string },
  data: ClosurePreparationData,
  forecastLink: ForecastLink,
  facts: { realizedRevenue: string | null; realizedCost: string | null; realizedResult: string | null; realizedMarginOnNetRevenue: string | null },
  gateOverall: string,
  correlationId: string,
) {
  for (let attempt = 1; attempt <= PREPARE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const current = await tx.projectClosureResult.findUniqueOrThrow({ where: { id: existingDraft.id } });
        if (current.status !== "DRAFT") {
          throw new ClosurePreparationError("Este encerramento mudou de estado durante a preparação e não é mais um rascunho — outra operação o alterou primeiro.", "CONCURRENCY_CONFLICT", correlationId);
        }

        // Releitura decisiva DENTRO da transação Serializable — é esta leitura, combinada com o
        // UPDATE mais abaixo na mesma transação, que dá ao Postgres (SSI) a chance de detectar
        // "write skew" contra uma `approveProjectClosureDistribution` concorrente (também
        // Serializable) e abortar uma das duas com conflito de serialização real (P2034).
        const approvedDistributionCount = await tx.projectClosureDistribution.count({
          where: { organizationId: context.organizationId, projectId: project.id, closureResultId: current.id, status: "APPROVED" },
        });
        if (approvedDistributionCount > 0) {
          throw new ClosurePreparationError("Este rascunho de encerramento já possui distribuição aprovada vinculada e não pode mais ser recalculado — os fatos que autorizaram a distribuição ficam congelados. Use a reabertura (reopenProjectClosureResult) para criar uma nova versão formal do encerramento.", "APPROVED_DISTRIBUTION_LOCK", correlationId);
        }

        const updated = await tx.projectClosureResult.updateMany({
          where: { id: current.id, organizationId: context.organizationId, projectId: project.id, status: "DRAFT", version: current.version },
          data,
        });
        if (updated.count !== 1) {
          throw new ClosurePreparationError("O rascunho de encerramento mudou de estado durante a preparação — outra operação o alterou primeiro.", "CONCURRENCY_CONFLICT", correlationId);
        }

        await finalizeClosureResultForecast(tx, context, project, forecastLink, { id: current.id, version: current.version }, facts);
        await tx.auditLog.create({ data: audit(context, project.id, "PROJECT_CLOSURE_RESULT_RECALCULATED", "ProjectClosureResult", current.id, { version: current.version, gateOverall }, { correlationId }) });
        return tx.projectClosureResult.findUniqueOrThrow({ where: { id: current.id } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
    } catch (error) {
      if (error instanceof ClosurePreparationError) throw error; // recusa de negócio definitiva — nunca retry
      if (!isTransientWriteConflict(error)) throw error; // erro desconhecido (ex.: P2002) propaga imediatamente, nunca reclassificado
      // Bug real encontrado na autorrevisão adversarial: no esgotamento do retry, o P2034 cru
      // escapava sem classificação (o `throw` abaixo do loop nunca era alcançado). Corrigido —
      // mesmo na última tentativa, o conflito de serialização é sempre devolvido como erro
      // classificado, nunca o `PrismaClientKnownRequestError` bruto do Prisma.
      if (attempt === PREPARE_MAX_ATTEMPTS) {
        throw new ClosurePreparationError("Não foi possível concluir a preparação do encerramento após múltiplas tentativas — conflito de concorrência persistente.", "CONCURRENCY_CONFLICT", correlationId);
      }
      await jitterDelay(attempt);
    }
  }
  throw new ClosurePreparationError("Não foi possível concluir a preparação do encerramento após múltiplas tentativas — conflito de concorrência persistente.", "CONCURRENCY_CONFLICT", correlationId);
}

/** Ramo que cria uma nova versão (primeira preparação, ou nova versão após um `FINAL` reaberto). Sem CAS/retry — não há estado anterior a proteger; um `P2002` (colisão de versão) propaga sem retry, como qualquer outro erro. */
async function createNewClosureResult(
  context: AuthContext,
  project: { id: string },
  latestVersion: { id: string; version: number; status: string } | null,
  data: ClosurePreparationData,
  forecastLink: ForecastLink,
  facts: { realizedRevenue: string | null; realizedCost: string | null; realizedResult: string | null; realizedMarginOnNetRevenue: string | null },
  gateOverall: string,
  correlationId: string,
) {
  const version = (latestVersion?.version ?? 0) + 1;
  return prisma.$transaction(async (tx) => {
    const created = await tx.projectClosureResult.create({
      data: { organizationId: context.organizationId, projectId: project.id, version, supersedesId: latestVersion?.status === "FINAL" ? latestVersion.id : null, status: "DRAFT", correlationId, createdById: context.userId, ...data },
    });
    await finalizeClosureResultForecast(tx, context, project, forecastLink, created, facts);
    await tx.auditLog.create({ data: audit(context, project.id, "PROJECT_CLOSURE_RESULT_PREPARED", "ProjectClosureResult", created.id, { version: created.version, gateOverall }, { correlationId }) });
    return tx.projectClosureResult.findUniqueOrThrow({ where: { id: created.id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
}

function isTransientWriteConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}
function jitterDelay(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 60)));
}

/**
 * Aprova o `ProjectClosureResult` corrente (`DRAFT` → `FINAL`). Achado TOCTOU
 * evitado pelo mesmo padrão de `markUnitDelivered` (9R): gate e campos centrais
 * relidos inteiramente DENTRO da transação `Serializable` que grava o `FINAL` e
 * transiciona `Project.status = CLOSED` — nunca decidido fora dela.
 */
export async function approveProjectClosureResult(context: AuthContext, raw: ApproveProjectClosureResultInput) {
  assertApprover(context);
  const input = approveProjectClosureResultSchema.parse(raw);
  const closureResult = await closureResultForTenant(context.organizationId, input.closureResultId);
  const correlationId = newCorrelationId();

  for (let attempt = 1; attempt <= REOPEN_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const current = await tx.projectClosureResult.findUniqueOrThrow({ where: { id: closureResult.id } });
        if (current.status === "FINAL") return current; // idempotente: outra chamada concorrente já aprovou
        if (current.status !== "DRAFT") throw new Error("Somente um encerramento em rascunho pode ser aprovado.");
        if (current.createdById === context.userId) throw new Error("Quem preparou o encerramento não pode ser o mesmo a aprová-lo — segregação de função obrigatória.");

        const project = await tx.project.findUniqueOrThrow({ where: { id: current.projectId } });
        const gate = await evaluateProjectClosureReadiness(tx, context.organizationId, project.id);
        if (gate.overall !== "APTO") {
          throw new Error(`Encerramento bloqueado — operacional: ${gate.operational.status} (${gate.operational.reason}); contratual: ${gate.contractual.status} (${gate.contractual.reason}); jurídico: ${gate.legal.status} (${gate.legal.reason}); financeiro: ${gate.financial.status} (${gate.financial.reason}); contábil: ${gate.accounting.status} (${gate.accounting.reason}).`);
        }
        const missingCentral = missingCentralEvidence({
          realizedRevenue: toEvidenceValue(current.realizedRevenue), realizedCost: toEvidenceValue(current.realizedCost),
          realizedTaxes: toEvidenceValue(current.realizedTaxes), realizedFinancialCosts: toEvidenceValue(current.realizedFinancialCosts),
          realizedResult: toEvidenceValue(current.realizedResult), realizedMarginOnVgv: toEvidenceValue(current.realizedMarginOnVgv),
        });
        if (missingCentral.length > 0) {
          throw new Error(`Encerramento bloqueado — sem evidência para: ${missingCentral.join(", ")}. Recalcule o rascunho antes de aprovar.`);
        }

        // Correção Alto #3 (pós-reauditoria REPROVADA): revalida atomicamente, dentro da
        // mesma transação Serializable, que a soma das distribuições já APPROVED desta
        // versão continua compatível com os valores vigentes — nunca corrige/move uma
        // distribuição, só recusa a transição para FINAL se a soma já não couber mais.
        const distributionTotals = await loadDistributionTotals(tx, context.organizationId, project.id, current.id);
        const distributionAggregate = validateApprovedDistributionsAggregate({ ...distributionTotals, realizedResult: toEvidenceValue(current.realizedResult) });
        if (!distributionAggregate.allowed) {
          throw new Error(`Encerramento bloqueado — distribuições já aprovadas incompatíveis com o resultado vigente: ${distributionAggregate.reason}`);
        }

        const result = await tx.projectClosureResult.updateMany({ where: { id: current.id, status: "DRAFT" }, data: { status: "FINAL", gateSnapshot: json(gate), approvedById: context.userId, approvedAt: new Date() } });
        if (result.count === 0) throw new Error("O encerramento mudou de estado — outra operação o alterou primeiro.");
        const projectResult = await tx.project.updateMany({ where: { id: project.id, status: { not: "CLOSED" } }, data: { status: "CLOSED" } });
        if (projectResult.count === 0) throw new Error("O empreendimento já não está mais no estado esperado — outra operação o alterou primeiro.");

        await tx.auditLog.create({
          data: audit(context, project.id, "PROJECT_CLOSURE_RESULT_APPROVED", "ProjectClosureResult", current.id,
            { version: current.version, gateSnapshot: gate }, { before: { status: current.status }, correlationId }),
        });
        await tx.auditLog.create({
          data: audit(context, project.id, "PROJECT_CLOSED", "Project", project.id, { status: "CLOSED", closureResultId: current.id }, { before: { status: project.status }, correlationId }),
        });
        return tx.projectClosureResult.findUniqueOrThrow({ where: { id: current.id } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
    } catch (error) {
      if (!isTransientWriteConflict(error) || attempt === REOPEN_MAX_ATTEMPTS) throw error;
      await jitterDelay(attempt);
    }
  }
  throw new Error("Não foi possível concluir a aprovação do encerramento após múltiplas tentativas.");
}

function toEvidenceValue(value: Prisma.Decimal | null): EvidenceValue {
  return value === null ? { status: "SEM_EVIDENCIA", value: null } : { status: "COM_EVIDENCIA", value: value.toString() };
}

/**
 * Reabertura — decisão 3: só `OWNER`, exige justificativa e evidência, cria uma nova
 * versão (`supersedesId` aponta para a linha anterior) e nunca altera a linha anterior
 * (protegida por trigger para `FINAL`, ver migration; um `DRAFT` travado por
 * distribuição aprovada é protegido pelo guard de `prepareProjectClosureResult` —
 * correção Alto #3). `Project.status` só volta a `UNDER_REVIEW` quando a origem era
 * `FINAL` (um `DRAFT` travado nunca fechou o projeto).
 *
 * Além do `FINAL` aprovado, também aceita um `DRAFT` que já tenha alguma
 * `ProjectClosureDistribution` `APPROVED` vinculada — esse é o único caminho formal
 * para registrar fatos atualizados depois que `prepareProjectClosureResult` passa a
 * recusar recalcular esse rascunho (correção pós-reauditoria REPROVADA, achado Alto
 * #3): a versão travada é preservada integralmente, e uma nova versão mutável é criada.
 */
export async function reopenProjectClosureResult(context: AuthContext, raw: ReopenProjectClosureResultInput) {
  assertReopener(context);
  const input = reopenProjectClosureResultSchema.parse(raw);
  const current = await closureResultForTenant(context.organizationId, input.closureResultId);
  const reopeningApprovedFinal = current.status === "FINAL";
  if (!reopeningApprovedFinal) {
    if (current.status !== "DRAFT") throw new Error("Somente um encerramento aprovado (FINAL), ou um rascunho com distribuição já aprovada, pode ser reaberto/revisado.");
    const approvedDistributionCount = await prisma.projectClosureDistribution.count({
      where: { organizationId: context.organizationId, closureResultId: current.id, status: "APPROVED" },
    });
    if (approvedDistributionCount === 0) throw new Error("Somente um encerramento aprovado (FINAL), ou um rascunho com distribuição já aprovada, pode ser reaberto/revisado.");
  }
  const correlationId = newCorrelationId();

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findUniqueOrThrow({ where: { id: current.projectId } });
    const newDraft = await tx.projectClosureResult.create({
      data: {
        organizationId: context.organizationId, projectId: current.projectId, version: current.version + 1, supersedesId: current.id, status: "DRAFT",
        correlationId, createdById: context.userId,
        evidenceStatus: json({ reopenReason: input.reason, reopenEvidenceRefs: input.evidenceRefs }),
      },
    });
    if (reopeningApprovedFinal) {
      const projectResult = await tx.project.updateMany({ where: { id: project.id, status: "CLOSED" }, data: { status: "UNDER_REVIEW" } });
      if (projectResult.count === 0) throw new Error("O empreendimento não está mais encerrado — outra operação o alterou primeiro.");
    }

    await tx.auditLog.create({
      data: audit(context, project.id, reopeningApprovedFinal ? "PROJECT_CLOSURE_REOPENED" : "PROJECT_CLOSURE_RESULT_VERSIONED_AFTER_APPROVED_DISTRIBUTION", "ProjectClosureResult", newDraft.id,
        { newVersion: newDraft.version, supersedesId: current.id, reason: input.reason, evidenceRefs: input.evidenceRefs },
        { before: { status: current.status, version: current.version }, correlationId }),
    });
    return newDraft;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
}

/** Leitura do overview — sem escrita, sem exigir capacidade de mutação. */
export async function getProjectClosureOverview(context: Pick<AuthContext, "organizationId">, projectId: string) {
  const project = await projectForTenant(context.organizationId, projectId);
  const [latest, gate] = await Promise.all([
    prisma.projectClosureResult.findFirst({ where: { organizationId: context.organizationId, projectId: project.id }, orderBy: { version: "desc" } }),
    evaluateProjectClosureReadiness(prisma, context.organizationId, project.id),
  ]);
  return { latest, gate };
}
