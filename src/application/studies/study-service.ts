import { createHash } from "node:crypto";
import {
  AssumptionCategory,
  AnalysisRunStatus,
  FindingCategory as DbFindingCategory,
  FindingSeverity as DbFindingSeverity,
  Prisma,
  RecommendationStatus as DbRecommendationStatus,
  ScenarioKind,
  StudyVersionStatus,
  type AssumptionSnapshot,
} from "@prisma/client";
import { calculateAllScenarios } from "@/domain/financial/engine";
import { SCENARIOS } from "@/domain/financial/scenarios";
import { ENGINE_VERSION, type FinancialResult, type ProjectAssumptions, type ScenarioKey } from "@/domain/financial/types";
import { analyzeRisk, type ProjectRecommendation, type RiskFinding } from "@/domain/risk/rules";
import { calculateRedeScore, type RedeScoreResult } from "@/domain/score";
import { calculateSensitivity, SENSITIVITY_VARIABLES, type SensitivityResult } from "@/domain/sensitivity";
import { buildEvidencePack, createDisabledProvider, runRedTeam, type RedTeamReport } from "@/domain/red-team";
import { prisma } from "@/infrastructure/database/prisma";
import type { AuthContext } from "@/application/auth/session";
import type { PersistedStudyView } from "./contracts";

const scenarioKeys: ScenarioKey[] = ["conservative", "base", "aggressive"];
const dimensionNames: Record<RedeScoreResult["dimensions"][number]["key"], string> = {
  RETURN: "Retorno",
  CAPITAL: "Capital e funding",
  COMMERCIAL: "Comercial",
  COST: "Custos",
  RESILIENCE: "Resiliência",
  EXECUTION: "Execução",
};

interface StructuredAssumption {
  key: string;
  category: AssumptionCategory;
  value: string | number;
  unit: string;
  source?: string;
  notes?: string;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function inputHash(value: ProjectAssumptions) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function severity(value: RiskFinding["severity"]): DbFindingSeverity {
  return value === "critical" ? DbFindingSeverity.CRITICAL : value === "warning" ? DbFindingSeverity.WARNING : DbFindingSeverity.POSITIVE;
}

function category(value: RiskFinding["category"]): DbFindingCategory {
  const categories: Record<RiskFinding["category"], DbFindingCategory> = {
    financeiro: DbFindingCategory.FINANCIAL,
    comercial: DbFindingCategory.MARKET,
    engenharia: DbFindingCategory.ENGINEERING,
    governanca: DbFindingCategory.GOVERNANCE,
  };
  return categories[value];
}

function recommendationStatus(value: ProjectRecommendation["status"]): DbRecommendationStatus {
  if (value === "NAO_AVANCAR") return DbRecommendationStatus.DO_NOT_PROCEED;
  if (value === "AVANCAR_COM_AJUSTES") return DbRecommendationStatus.PROCEED_WITH_ADJUSTMENTS;
  return DbRecommendationStatus.PROCEED_TO_DILIGENCE;
}

function scenarioKind(key: ScenarioKey): ScenarioKind {
  if (key === "conservative") return ScenarioKind.CONSERVATIVE;
  if (key === "aggressive") return ScenarioKind.AGGRESSIVE;
  return ScenarioKind.BASE;
}

function scenarioKey(kind: ScenarioKind): ScenarioKey {
  if (kind === ScenarioKind.CONSERVATIVE) return "conservative";
  if (kind === ScenarioKind.AGGRESSIVE) return "aggressive";
  return "base";
}

function calculateAnalytics(input: ProjectAssumptions, calculatedAt = new Date().toISOString()) {
  const results = calculateAllScenarios(input, calculatedAt);
  const sensitivity = calculateSensitivity(input, "base", calculatedAt);
  const scores = Object.fromEntries(scenarioKeys.map((key) => [
    key,
    key === "base" ? sensitivity.baseScore : calculateRedeScore({ result: results[key], resilience: sensitivity.resilience }),
  ])) as Record<ScenarioKey, RedeScoreResult>;
  return { results, sensitivity, scores };
}

function analyticsFromPersistence(
  input: ProjectAssumptions,
  scoreRows: { scenario: { kind: ScenarioKind }; explanation: Prisma.JsonValue }[],
  sensitivityRows: { results: Prisma.JsonValue }[],
) {
  const persistedSensitivity = sensitivityRows[0]?.results as unknown as SensitivityResult | undefined;
  const persistedScores = new Map(scoreRows.map((row) => [scenarioKey(row.scenario.kind), row.explanation as unknown as RedeScoreResult]));
  if (persistedSensitivity && scenarioKeys.every((key) => persistedScores.has(key))) {
    return {
      sensitivity: persistedSensitivity,
      scores: Object.fromEntries(scenarioKeys.map((key) => [key, persistedScores.get(key)!])) as Record<ScenarioKey, RedeScoreResult>,
    };
  }
  const calculated = calculateAnalytics(input);
  return { sensitivity: persistedSensitivity ?? calculated.sensitivity, scores: Object.fromEntries(scenarioKeys.map((key) => [key, persistedScores.get(key) ?? calculated.scores[key]])) as Record<ScenarioKey, RedeScoreResult> };
}

function structuredAssumptions(input: ProjectAssumptions): StructuredAssumption[] {
  const source = "USER_INPUT";
  return [
    { key: "projectName", category: AssumptionCategory.IDENTIFICATION, value: input.projectName, unit: "text", source },
    { key: "city", category: AssumptionCategory.IDENTIFICATION, value: input.city, unit: "text", source },
    { key: "state", category: AssumptionCategory.IDENTIFICATION, value: input.state, unit: "UF", source },
    { key: "landAreaM2", category: AssumptionCategory.LAND, value: input.landAreaM2, unit: "m2", source },
    { key: "units", category: AssumptionCategory.PRODUCT, value: input.units, unit: "unit", source },
    { key: "privateAreaPerUnitM2", category: AssumptionCategory.PRODUCT, value: input.privateAreaPerUnitM2, unit: "m2/unit", source },
    { key: "grossBuiltAreaM2", category: AssumptionCategory.PRODUCT, value: input.grossBuiltAreaM2 ?? "AUTO", unit: "m2", source, notes: input.grossBuiltAreaM2 ? undefined : "Calculada pelo Engine a partir da eficiência." },
    { key: "efficiencyRate", category: AssumptionCategory.PRODUCT, value: input.efficiencyRate, unit: "percent", source },
    { key: "unitPrice", category: AssumptionCategory.REVENUE, value: input.unitPrice, unit: "BRL/unit", source },
    { key: "landPrice", category: AssumptionCategory.LAND, value: input.landPrice, unit: "BRL", source },
    { key: "constructionCostPerM2", category: AssumptionCategory.COST, value: input.constructionCostPerM2, unit: "BRL/m2", source },
    { key: "indirectCostsRate", category: AssumptionCategory.COST, value: input.indirectCostsRate, unit: "percent", source },
    { key: "contingencyRate", category: AssumptionCategory.COST, value: input.contingencyRate, unit: "percent", source },
    { key: "taxRate", category: AssumptionCategory.TAX, value: input.taxRate, unit: "percent", source },
    { key: "commissionRate", category: AssumptionCategory.SALES, value: input.commissionRate, unit: "percent", source },
    { key: "marketingRate", category: AssumptionCategory.SALES, value: input.marketingRate, unit: "percent", source },
    { key: "approvalMonths", category: AssumptionCategory.TIMELINE, value: input.approvalMonths, unit: "month", source },
    { key: "constructionMonths", category: AssumptionCategory.TIMELINE, value: input.constructionMonths, unit: "month", source },
    { key: "salesVelocityUnitsMonth", category: AssumptionCategory.SALES, value: input.salesVelocityUnitsMonth, unit: "unit/month", source },
    { key: "salesStartDelayMonths", category: AssumptionCategory.TIMELINE, value: input.salesStartDelayMonths, unit: "month", source },
    { key: "downPaymentRate", category: AssumptionCategory.SALES, value: input.downPaymentRate, unit: "percent", source },
    { key: "duringConstructionRate", category: AssumptionCategory.SALES, value: input.duringConstructionRate, unit: "percent", source },
    { key: "onDeliveryRate", category: AssumptionCategory.SALES, value: input.onDeliveryRate, unit: "percent", source },
    { key: "financingLimit", category: AssumptionCategory.FUNDING, value: input.financingLimit, unit: "BRL", source },
    { key: "annualFinancingRate", category: AssumptionCategory.FUNDING, value: input.annualFinancingRate, unit: "percent/year", source },
    { key: "annualDiscountRate", category: AssumptionCategory.POLICY, value: input.annualDiscountRate, unit: "percent/year", source },
    { key: "minimumMarginRate", category: AssumptionCategory.POLICY, value: input.policy.minimumMarginRate, unit: "percent", source },
    { key: "minimumRoiRate", category: AssumptionCategory.POLICY, value: input.policy.minimumRoiRate, unit: "percent", source },
    { key: "minimumIrrRate", category: AssumptionCategory.POLICY, value: input.policy.minimumIrrRate, unit: "percent/year", source },
    { key: "maximumExposure", category: AssumptionCategory.POLICY, value: input.policy.maximumExposure, unit: "BRL", source },
    { key: "minimumContingencyRate", category: AssumptionCategory.POLICY, value: input.policy.minimumContingencyRate, unit: "percent", source },
  ];
}

function assumptionEntryData(input: ProjectAssumptions, userId: string) {
  return structuredAssumptions(input).map((entry) => ({
    key: entry.key,
    category: entry.category,
    value: json({ value: entry.value }),
    unit: entry.unit,
    source: entry.source,
    notes: entry.notes,
    createdById: userId,
  }));
}

function scenarioOverrideData(base: ProjectAssumptions, scenarioInput: ProjectAssumptions, key: ScenarioKey, userId: string) {
  if (key === "base") return [];
  const baseByKey = new Map(structuredAssumptions(base).map((entry) => [entry.key, entry]));
  return structuredAssumptions(scenarioInput)
    .filter((entry) => baseByKey.get(entry.key)?.value !== entry.value)
    .map((entry) => ({
      assumptionKey: entry.key,
      value: json({ value: entry.value }),
      unit: entry.unit,
      source: `SCENARIO_PRESET_${key.toUpperCase()}`,
      notes: SCENARIOS[key].changes.join("; "),
      createdById: userId,
    }));
}

async function ensureInvestmentPolicy(
  tx: Prisma.TransactionClient,
  context: Pick<AuthContext, "userId" | "organizationId">,
  input: ProjectAssumptions,
) {
  const policy = input.policy;
  const existing = await tx.investmentPolicy.findFirst({
    where: {
      organizationId: context.organizationId,
      name: "Política padrão",
      isActive: true,
      minimumMarginRate: policy.minimumMarginRate,
      minimumRoiRate: policy.minimumRoiRate,
      minimumIrrRate: policy.minimumIrrRate,
      maximumExposure: policy.maximumExposure,
    },
  });
  if (existing) return existing;

  const latest = await tx.investmentPolicy.findFirst({
    where: { organizationId: context.organizationId, name: "Política padrão" },
    orderBy: { version: "desc" },
  });
  await tx.investmentPolicy.updateMany({
    where: { organizationId: context.organizationId, name: "Política padrão", isActive: true },
    data: { isActive: false, updatedById: context.userId },
  });
  return tx.investmentPolicy.create({
    data: {
      organizationId: context.organizationId,
      name: "Política padrão",
      version: (latest?.version ?? 0) + 1,
      minimumMarginRate: policy.minimumMarginRate,
      minimumRoiRate: policy.minimumRoiRate,
      minimumIrrRate: policy.minimumIrrRate,
      maximumExposure: policy.maximumExposure,
      createdById: context.userId,
      updatedById: context.userId,
    },
  });
}

function assumptionData(input: ProjectAssumptions, userId: string) {
  return {
    projectName: input.projectName,
    city: input.city,
    state: input.state,
    landAreaM2: input.landAreaM2,
    units: input.units,
    privateAreaPerUnitM2: input.privateAreaPerUnitM2,
    grossBuiltAreaM2: input.grossBuiltAreaM2,
    efficiencyRate: input.efficiencyRate,
    unitPrice: input.unitPrice,
    landPrice: input.landPrice,
    constructionCostPerM2: input.constructionCostPerM2,
    indirectCostsRate: input.indirectCostsRate,
    contingencyRate: input.contingencyRate,
    taxRate: input.taxRate,
    commissionRate: input.commissionRate,
    marketingRate: input.marketingRate,
    approvalMonths: input.approvalMonths,
    constructionMonths: input.constructionMonths,
    salesVelocityUnitsMonth: input.salesVelocityUnitsMonth,
    salesStartDelayMonths: input.salesStartDelayMonths,
    downPaymentRate: input.downPaymentRate,
    duringConstructionRate: input.duringConstructionRate,
    onDeliveryRate: input.onDeliveryRate,
    financingLimit: input.financingLimit,
    annualFinancingRate: input.annualFinancingRate,
    annualDiscountRate: input.annualDiscountRate,
    minimumMarginRate: input.policy.minimumMarginRate,
    minimumRoiRate: input.policy.minimumRoiRate,
    minimumIrrRate: input.policy.minimumIrrRate,
    maximumExposure: input.policy.maximumExposure,
    minimumContingencyRate: input.policy.minimumContingencyRate,
    createdById: userId,
    updatedById: userId,
    entries: { create: assumptionEntryData(input, userId) },
  };
}

export function snapshotToAssumptions(snapshot: AssumptionSnapshot): ProjectAssumptions {
  return {
    projectName: snapshot.projectName,
    city: snapshot.city,
    state: snapshot.state,
    landAreaM2: snapshot.landAreaM2.toString(),
    units: snapshot.units,
    privateAreaPerUnitM2: snapshot.privateAreaPerUnitM2.toString(),
    grossBuiltAreaM2: snapshot.grossBuiltAreaM2?.toString() ?? null,
    efficiencyRate: snapshot.efficiencyRate.toString(),
    unitPrice: snapshot.unitPrice.toString(),
    landPrice: snapshot.landPrice.toString(),
    constructionCostPerM2: snapshot.constructionCostPerM2.toString(),
    indirectCostsRate: snapshot.indirectCostsRate.toString(),
    contingencyRate: snapshot.contingencyRate.toString(),
    taxRate: snapshot.taxRate.toString(),
    commissionRate: snapshot.commissionRate.toString(),
    marketingRate: snapshot.marketingRate.toString(),
    approvalMonths: snapshot.approvalMonths,
    constructionMonths: snapshot.constructionMonths,
    salesVelocityUnitsMonth: snapshot.salesVelocityUnitsMonth.toString(),
    salesStartDelayMonths: snapshot.salesStartDelayMonths,
    downPaymentRate: snapshot.downPaymentRate.toString(),
    duringConstructionRate: snapshot.duringConstructionRate.toString(),
    onDeliveryRate: snapshot.onDeliveryRate.toString(),
    financingLimit: snapshot.financingLimit.toString(),
    annualFinancingRate: snapshot.annualFinancingRate.toString(),
    annualDiscountRate: snapshot.annualDiscountRate.toString(),
    policy: {
      minimumMarginRate: snapshot.minimumMarginRate.toString(),
      minimumRoiRate: snapshot.minimumRoiRate.toString(),
      minimumIrrRate: snapshot.minimumIrrRate.toString(),
      maximumExposure: snapshot.maximumExposure.toString(),
      minimumContingencyRate: snapshot.minimumContingencyRate.toString(),
    },
  };
}

function resultData(result: FinancialResult) {
  const metrics = result.metrics;
  return {
    payload: json(result),
    vgv: metrics.vgv,
    netRevenue: metrics.netRevenue,
    totalCost: metrics.totalCost,
    profit: metrics.profit,
    marginOnVgv: metrics.marginOnVgv,
    marginOnNetRevenue: metrics.marginOnNetRevenue,
    roi: metrics.roi,
    annualIrr: metrics.annualIrr,
    npv: metrics.npv,
    paybackMonth: metrics.paybackMonth,
    maximumCashExposure: metrics.maximumCashExposure,
    maximumExposureMonth: metrics.maximumExposureMonth,
    equityCapitalRequired: metrics.equityCapitalRequired,
    fundingNeed: metrics.fundingNeed,
    breakEvenVgv: metrics.breakEvenVgv,
    breakEvenUnits: metrics.breakEvenUnits,
  };
}

function metricUnit(key: keyof FinancialResult["metrics"]) {
  if (["marginOnVgv", "marginOnNetRevenue", "roi", "annualIrr", "breakEvenRate"].includes(key)) return "ratio";
  if (["paybackMonth", "maximumExposureMonth", "deliveryMonth", "salesEndMonth"].includes(key)) return "month";
  if (["breakEvenUnits"].includes(key)) return "unit";
  if (["totalPrivateAreaM2", "grossBuiltAreaM2"].includes(key)) return "m2";
  return "BRL";
}

function metricCategory(key: keyof FinancialResult["metrics"]) {
  if (["paybackMonth", "maximumExposureMonth", "deliveryMonth", "salesEndMonth"].includes(key)) return "TIMELINE";
  if (["totalPrivateAreaM2", "grossBuiltAreaM2", "breakEvenUnits", "breakEvenRate"].includes(key)) return "PRODUCT";
  return "FINANCIAL";
}

function calculatedMetricData(result: FinancialResult) {
  return (Object.entries(result.metrics) as [keyof FinancialResult["metrics"], string | number | null][]).map(([key, value]) => ({
    key,
    value: json({ value }),
    unit: metricUnit(key),
    category: metricCategory(key),
  }));
}

async function persistRedTeamReport(
  tx: Prisma.TransactionClient,
  context: Pick<AuthContext, "userId" | "organizationId">,
  studyVersionId: string,
  scenarioId: string,
  report: RedTeamReport,
) {
  const run = await tx.redTeamRun.create({
    data: {
      organizationId: context.organizationId,
      studyVersionId,
      scenarioId,
      modelProvider: report.provider.name,
      modelName: report.provider.model,
      promptVersion: report.promptVersion,
      engineVersion: report.evidencePack.engineResult.engineVersion,
      scoreVersion: report.evidencePack.score.policyVersion,
      redTeamVersion: report.redTeamVersion,
      status: AnalysisRunStatus.COMPLETED,
      startedAt: new Date(report.startedAt),
      finishedAt: new Date(report.finishedAt),
      output: json(report),
      evidencePack: json(report.evidencePack),
      conclusion: json(report.conclusion),
      calls: report.observability.calls,
      durationMs: report.observability.durationMs,
      inputTokens: report.observability.inputTokens,
      outputTokens: report.observability.outputTokens,
      retries: report.observability.retries,
      error: report.observability.errors.length ? report.observability.errors.join("\n") : null,
      createdById: context.userId,
    },
  });

  await tx.redTeamAgentResult.createMany({ data: report.agents.map((agent) => ({
    runId: run.id,
    agent: agent.agent,
    label: agent.label,
    status: agent.status,
    confidence: agent.confidence,
    opinion: agent.opinion,
    questions: json(agent.questions),
    providerUsed: agent.providerUsed,
  })) });
  await tx.redTeamEvidenceItem.createMany({ data: report.evidencePack.items.map((item) => ({
    runId: run.id,
    ref: item.ref,
    kind: item.kind,
    label: item.label,
    value: json(item.value),
    source: item.source,
    trust: item.trust,
  })) });
  await tx.redTeamAssumptionChallenge.createMany({ data: report.assumptionChallenges.map((challenge) => ({
    runId: run.id,
    code: challenge.id,
    assumptionKey: challenge.assumptionKey,
    classification: challenge.classification,
    reason: challenge.reason,
    evidenceRefs: json(challenge.evidenceRefs),
  })) });

  const evidenceRows = await tx.redTeamEvidenceItem.findMany({ where: { runId: run.id }, select: { id: true, ref: true } });
  const evidenceIds = new Map(evidenceRows.map((item) => [item.ref, item.id]));
  const findingIds = new Map<string, string>();
  for (const finding of report.findings) {
    const row = await tx.redTeamFinding.create({
      data: {
        runId: run.id,
        code: finding.id,
        agent: finding.agent,
        category: finding.category,
        type: finding.type,
        severity: finding.severity,
        confidence: finding.confidence,
        title: finding.title,
        description: finding.description,
        implication: finding.implication,
        recommendedAction: finding.recommendedAction,
        status: finding.status,
        evidenceLinks: { create: finding.evidenceRefs.map((evidenceRef) => ({ evidenceRef, evidenceItemId: evidenceIds.get(evidenceRef)! })) },
      },
    });
    findingIds.set(finding.id, row.id);
  }

  await tx.redTeamEvidenceRequest.createMany({ data: report.evidenceRequests.map((request) => ({
    runId: run.id,
    code: request.id,
    category: request.category,
    requestedDocument: request.requestedDocument,
    reason: request.reason,
    priority: request.priority,
    relatedFindingId: request.relatedFindingId ? findingIds.get(request.relatedFindingId) : null,
    evidenceRefs: json(request.evidenceRefs),
    status: request.status,
  })) });
  await tx.redTeamCrossReview.createMany({ data: report.crossReviews.map((review) => ({
    runId: run.id,
    code: review.id,
    findingId: findingIds.get(review.findingId)!,
    originalAgent: review.originalAgent,
    reviewerAgent: review.reviewerAgent,
    decision: review.decision,
    rationale: review.rationale,
  })) });
  await tx.redTeamDisagreement.createMany({ data: report.disagreements.map((disagreement) => ({
    runId: run.id,
    code: disagreement.id,
    findingAId: findingIds.get(disagreement.findingAId)!,
    findingBId: findingIds.get(disagreement.findingBId)!,
    agents: json(disagreement.agents),
    description: disagreement.description,
    resolution: disagreement.resolution,
    status: disagreement.status,
  })) });
  await tx.redTeamExecutiveConclusion.create({ data: {
    runId: run.id,
    decision: report.conclusion.decision,
    confidence: report.conclusion.confidence,
    dominantRisk: report.conclusion.dominantRisk,
    topFindingIds: json(report.conclusion.topFindingIds),
    decisionBlockerIds: json(report.conclusion.decisionBlockerIds),
    requiredActions: json(report.conclusion.requiredActions),
    evidenceRequestIds: json(report.conclusion.evidenceRequestIds),
    disagreementIds: json(report.conclusion.disagreementIds),
    strengths: json(report.conclusion.strengths),
    mitigations: json(report.conclusion.mitigations),
    residualRisk: report.conclusion.residualRisk,
    whatWouldChangeDecision: json(report.conclusion.whatWouldChangeDecision),
    enginePosition: report.conclusion.enginePosition,
    executiveSummary: report.conclusion.executiveSummary,
  } });
  return run;
}

async function appendVersion(
  tx: Prisma.TransactionClient,
  context: Pick<AuthContext, "userId" | "organizationId">,
  projectId: string,
  studyId: string,
  input: ProjectAssumptions,
): Promise<PersistedStudyView> {
  const ownedStudy = await tx.viabilityStudy.findFirst({
    where: { id: studyId, project: { id: projectId, organizationId: context.organizationId } },
    include: { project: true },
  });
  if (!ownedStudy) throw new Error("Estudo não encontrado nesta organização.");

  const updatedProject = await tx.project.update({
    where: { id: projectId },
    data: { name: input.projectName, city: input.city, state: input.state, updatedById: context.userId },
  });
  const study = await tx.viabilityStudy.update({
    where: { id: studyId },
    data: { currentVersionNumber: { increment: 1 }, updatedById: context.userId },
  });
  const hash = inputHash(input);
  const calculatedAt = new Date();
  const { results, sensitivity, scores } = calculateAnalytics(input, calculatedAt.toISOString());
  const policy = await ensureInvestmentPolicy(tx, context, input);
  const version = await tx.studyVersion.create({
    data: {
      studyId,
      versionNumber: study.currentVersionNumber,
      status: StudyVersionStatus.DRAFT,
      label: `Versão ${study.currentVersionNumber}`,
      notes: "Snapshot gerado a partir das premissas aprovadas na interface.",
      inputHash: hash,
      engineVersion: ENGINE_VERSION,
      policyId: policy.id,
      createdById: context.userId,
      updatedById: context.userId,
      assumptions: { create: assumptionData(input, context.userId) },
    },
  });
  const assumptionSnapshot = await tx.assumptionSnapshot.findUniqueOrThrow({ where: { studyVersionId: version.id } });

  const scenarioIds = new Map<ScenarioKey, string>();
  for (const key of scenarioKeys) {
    const result = results[key];
    const analysis = analyzeRisk(result);
    const scenario = await tx.scenario.create({
      data: {
        studyVersionId: version.id,
        name: SCENARIOS[key].label,
        kind: scenarioKind(key),
        description: SCENARIOS[key].description,
        adjustments: json({ changes: SCENARIOS[key].changes }),
        createdById: context.userId,
        updatedById: context.userId,
        overrides: { create: scenarioOverrideData(input, result.assumptions, key, context.userId) },
      },
    });
    scenarioIds.set(key, scenario.id);

    await tx.calculationRun.create({
      data: {
        organizationId: context.organizationId,
        projectId,
        studyId,
        studyVersionId: version.id,
        scenarioId: scenario.id,
        engineVersion: ENGINE_VERSION,
        inputHash: inputHash(result.assumptions),
        calculatedAt,
        createdById: context.userId,
        metrics: { create: calculatedMetricData(result) },
        cashFlow: { create: result.cashFlow.map((row) => ({ ...row })) },
        result: { create: resultData(result) },
        traces: {
          create: result.auditTrail.map((trace) => ({
            metric: trace.metric,
            label: trace.label,
            formula: trace.formula,
            inputs: json(trace.inputs),
            result: trace.result,
            engineVersion: trace.engineVersion,
          })),
        },
        findings: {
          create: analysis.findings.map((finding) => ({
            severity: severity(finding.severity),
            category: category(finding.category),
            title: finding.title,
            evidence: finding.evidence,
            action: finding.action,
            classification: finding.classification,
            code: finding.id,
            description: finding.evidence,
            metric: finding.metric,
            actualValue: finding.actualValue,
            thresholdValue: finding.thresholdValue,
            scenarioId: scenario.id,
            createdById: context.userId,
          })),
        },
        recommendations: {
          create: {
            status: recommendationStatus(analysis.status),
            label: analysis.label,
            dominantReason: analysis.dominantReason,
            createdById: context.userId,
          },
        },
      },
    });
  }

  for (const key of scenarioKeys) {
    const score = scores[key];
    await tx.score.create({
      data: {
        studyVersionId: version.id,
        scenarioId: scenarioIds.get(key)!,
        policyVersion: score.policyVersion,
        globalScore: score.totalScore,
        rawScore: score.rawScore,
        scoreAfterPenalties: score.scoreAfterPenalties,
        classification: score.classification,
        gates: json(score.gates),
        penalties: json(score.penalties),
        explanation: json(score),
        createdById: context.userId,
        dimensions: {
          create: score.dimensions.map((dimension) => ({
            key: dimension.key,
            name: dimensionNames[dimension.key],
            score: dimension.score,
            weight: dimension.weight,
            weightedScore: dimension.weightedScore,
            explanation: json(dimension.reasons),
          })),
        },
        rules: {
          create: score.dimensions.flatMap((dimension) => dimension.reasons.map((rule) => ({
            dimensionKey: dimension.key,
            ruleKey: rule.ruleKey,
            label: rule.label,
            score: rule.score,
            tone: rule.tone,
            actualValue: rule.actualValue,
            benchmark: rule.benchmark,
            message: rule.message,
          }))),
        },
      },
    });
  }

  const sensitivityAnalysis = await tx.sensitivityAnalysis.create({
    data: {
      studyVersionId: version.id,
      baseScenarioId: scenarioIds.get("base"),
      name: "Sensibilidade e stress REDE v1",
      engineVersion: ENGINE_VERSION,
      configVersion: sensitivity.configVersion,
      variables: json(SENSITIVITY_VARIABLES),
      results: json(sensitivity),
      status: AnalysisRunStatus.COMPLETED,
      completedAt: calculatedAt,
      createdById: context.userId,
      cases: {
        create: sensitivity.cases.map((item) => ({
          variable: item.variable,
          label: item.label,
          variation: item.variation,
          variationUnit: item.variationUnit,
          baseValue: String(item.baseValue),
          stressedValue: String(item.stressedValue),
          metrics: json(item.metrics),
          policyViolations: json(item.policyViolations),
          score: item.score,
          classification: item.classification,
          scoreDelta: item.scoreDelta,
        })),
      },
      breakEvens: { create: sensitivity.breakEvens.map((item) => ({ ...item })) },
      stressTests: {
        create: sensitivity.stresses.map((item) => ({
          key: item.key,
          label: item.label,
          adjustments: json(item.adjustments),
          metrics: json(item.metrics),
          violatedPolicies: json(item.violatedPolicies),
          score: item.score,
          classification: item.classification,
          scoreDelta: item.scoreDelta,
          recommendationStatus: item.recommendationStatus,
          recommendationLabel: item.recommendationLabel,
        })),
      },
    },
  });

  const organization = await tx.organization.findUniqueOrThrow({ where: { id: context.organizationId } });
  const baseAnalysis = analyzeRisk(results.base);
  const evidencePack = buildEvidencePack({
    generatedAt: calculatedAt.toISOString(),
    organization: { id: organization.id, name: organization.name },
    project: { id: updatedProject.id, name: updatedProject.name, city: updatedProject.city, state: updatedProject.state },
    study: { id: ownedStudy.id, name: ownedStudy.name },
    studyVersion: { id: version.id, versionNumber: version.versionNumber, status: StudyVersionStatus.SNAPSHOT, inputHash: hash },
    scenario: "base",
    assumptions: input,
    assumptionSources: Object.fromEntries(structuredAssumptions(input).map((item) => [item.key, item.source ?? "USER_INPUT"])),
    engineResult: results.base,
    score: scores.base,
    sensitivity,
    alerts: baseAnalysis.findings,
  });
  const redTeam = await runRedTeam(evidencePack, createDisabledProvider(), calculatedAt.toISOString());
  const redTeamRun = await persistRedTeamReport(tx, context, version.id, scenarioIds.get("base")!, redTeam);

  await tx.studyVersion.update({
    where: { id: version.id },
    data: { status: StudyVersionStatus.SNAPSHOT, lockedAt: calculatedAt, updatedById: context.userId },
  });

  await tx.auditLog.createMany({
    data: [
      {
        organizationId: context.organizationId,
        userId: context.userId,
        projectId,
        studyId,
        action: "STUDY_VERSION_DRAFT_CREATED",
        entityType: "StudyVersion",
        entityId: version.id,
        after: json({ versionNumber: version.versionNumber, status: StudyVersionStatus.DRAFT }),
      },
      {
        organizationId: context.organizationId,
        userId: context.userId,
        projectId,
        studyId,
        action: "ASSUMPTIONS_SNAPSHOTTED",
        entityType: "AssumptionSnapshot",
        entityId: assumptionSnapshot.id,
        after: json({ count: structuredAssumptions(input).length, inputHash: hash }),
      },
      {
        organizationId: context.organizationId,
        userId: context.userId,
        projectId,
        studyId,
        action: "STUDY_SNAPSHOT_CREATED",
        entityType: "StudyVersion",
        entityId: version.id,
        after: json({ versionNumber: version.versionNumber, status: StudyVersionStatus.SNAPSHOT, inputHash: hash, engineVersion: ENGINE_VERSION, policyId: policy.id }),
      },
      {
        organizationId: context.organizationId,
        userId: context.userId,
        projectId,
        studyId,
        action: "SENSITIVITY_COMPLETED",
        entityType: "SensitivityAnalysis",
        entityId: sensitivityAnalysis.id,
        after: json({ configVersion: sensitivity.configVersion, cases: sensitivity.cases.length, stressTests: sensitivity.stresses.length }),
      },
      {
        organizationId: context.organizationId,
        userId: context.userId,
        projectId,
        studyId,
        action: "REDE_SCORE_CALCULATED",
        entityType: "Score",
        entityId: version.id,
        after: json({ policyVersion: sensitivity.baseScore.policyVersion, scenarios: scenarioKeys.length }),
      },
      {
        organizationId: context.organizationId,
        userId: context.userId,
        projectId,
        studyId,
        action: "RED_TEAM_COMPLETED",
        entityType: "RedTeamRun",
        entityId: redTeamRun.id,
        after: json({ redTeamVersion: redTeam.redTeamVersion, decision: redTeam.conclusion.decision, findings: redTeam.findings.length, provider: redTeam.provider.name }),
      },
    ],
  });

  return {
    projectId,
    studyId,
    studyVersionId: version.id,
    versionNumber: version.versionNumber,
    assumptions: input,
    analytics: { sensitivity, scores },
    redTeam,
  };
}

export async function getLatestStudyForOrganization(organizationId: string): Promise<PersistedStudyView | null> {
  const study = await prisma.viabilityStudy.findFirst({
    where: { status: "ACTIVE", project: { organizationId } },
    orderBy: { updatedAt: "desc" },
    include: {
      project: true,
      versions: {
        where: { status: StudyVersionStatus.SNAPSHOT },
        orderBy: { versionNumber: "desc" },
        take: 1,
        include: {
          assumptions: true,
          scores: { include: { scenario: { select: { kind: true } } } },
          sensitivity: { where: { status: AnalysisRunStatus.COMPLETED }, orderBy: { createdAt: "desc" }, take: 1 },
          redTeamRuns: { where: { status: AnalysisRunStatus.COMPLETED }, orderBy: { createdAt: "desc" }, take: 1, select: { output: true } },
        },
      },
    },
  });
  const version = study?.versions[0];
  if (!study || !version?.assumptions) return null;
  return {
    projectId: study.projectId,
    studyId: study.id,
    studyVersionId: version.id,
    versionNumber: version.versionNumber,
    assumptions: snapshotToAssumptions(version.assumptions),
    analytics: analyticsFromPersistence(snapshotToAssumptions(version.assumptions), version.scores, version.sensitivity),
    redTeam: version.redTeamRuns[0]?.output as unknown as RedTeamReport | undefined ?? null,
  };
}

/**
 * Fase 9K.0 (fechamento, gate 2): busca o estudo ACTIVE mais recente de UM projeto já
 * determinado — diferente de `getLatestStudyForOrganization`, que escolhe o próprio projeto pela
 * atividade mais recente em toda a organização. Ordenar por recência é legítimo *dentro* de um
 * projeto já resolvido (qual versão de estudo está em vigor); não é legítimo para decidir *qual*
 * projeto é o contexto operacional ativo — essa decisão é responsabilidade exclusiva de
 * `resolveOperationalContext` (`src/application/workspace/operational-context.ts`).
 */
export async function getLatestStudyForProject(organizationId: string, projectId: string): Promise<PersistedStudyView | null> {
  const study = await prisma.viabilityStudy.findFirst({
    where: { status: "ACTIVE", projectId, project: { organizationId } },
    orderBy: { updatedAt: "desc" },
    include: {
      versions: {
        where: { status: StudyVersionStatus.SNAPSHOT },
        orderBy: { versionNumber: "desc" },
        take: 1,
        include: {
          assumptions: true,
          scores: { include: { scenario: { select: { kind: true } } } },
          sensitivity: { where: { status: AnalysisRunStatus.COMPLETED }, orderBy: { createdAt: "desc" }, take: 1 },
          redTeamRuns: { where: { status: AnalysisRunStatus.COMPLETED }, orderBy: { createdAt: "desc" }, take: 1, select: { output: true } },
        },
      },
    },
  });
  const version = study?.versions[0];
  if (!study || !version?.assumptions) return null;
  return {
    projectId: study.projectId,
    studyId: study.id,
    studyVersionId: version.id,
    versionNumber: version.versionNumber,
    assumptions: snapshotToAssumptions(version.assumptions),
    analytics: analyticsFromPersistence(snapshotToAssumptions(version.assumptions), version.scores, version.sensitivity),
    redTeam: version.redTeamRuns[0]?.output as unknown as RedTeamReport | undefined ?? null,
  };
}

export async function getStudyForOrganization(organizationId: string, studyId: string): Promise<PersistedStudyView | null> {
  const study = await prisma.viabilityStudy.findFirst({
    where: { id: studyId, status: "ACTIVE", project: { organizationId } },
    include: {
      versions: {
        where: { status: StudyVersionStatus.SNAPSHOT },
        orderBy: { versionNumber: "desc" },
        take: 1,
        include: {
          assumptions: true,
          scores: { include: { scenario: { select: { kind: true } } } },
          sensitivity: { where: { status: AnalysisRunStatus.COMPLETED }, orderBy: { createdAt: "desc" }, take: 1 },
          redTeamRuns: { where: { status: AnalysisRunStatus.COMPLETED }, orderBy: { createdAt: "desc" }, take: 1, select: { output: true } },
        },
      },
    },
  });
  const version = study?.versions[0];
  if (!study || !version?.assumptions) return null;
  return {
    projectId: study.projectId,
    studyId: study.id,
    studyVersionId: version.id,
    versionNumber: version.versionNumber,
    assumptions: snapshotToAssumptions(version.assumptions),
    analytics: analyticsFromPersistence(snapshotToAssumptions(version.assumptions), version.scores, version.sensitivity),
    redTeam: version.redTeamRuns[0]?.output as unknown as RedTeamReport | undefined ?? null,
  };
}

export async function getRedTeamRunForOrganization(organizationId: string, runId: string): Promise<RedTeamReport | null> {
  const run = await prisma.redTeamRun.findFirst({
    where: {
      id: runId,
      organizationId,
      studyVersion: { study: { project: { organizationId } } },
    },
    select: { output: true },
  });
  return run?.output as unknown as RedTeamReport | undefined ?? null;
}

export async function createStudy(context: Pick<AuthContext, "userId" | "organizationId">, input: ProjectAssumptions) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        organizationId: context.organizationId,
        name: input.projectName,
        city: input.city,
        state: input.state,
        createdById: context.userId,
        updatedById: context.userId,
      },
    });
    const study = await tx.viabilityStudy.create({
      data: {
        projectId: project.id,
        name: "Estudo de viabilidade",
        createdById: context.userId,
        updatedById: context.userId,
      },
    });
    await tx.auditLog.createMany({
      data: [
        {
          organizationId: context.organizationId,
          userId: context.userId,
          projectId: project.id,
          action: "PROJECT_CREATED",
          entityType: "Project",
          entityId: project.id,
          after: json({ name: project.name, city: project.city, state: project.state }),
        },
        {
          organizationId: context.organizationId,
          userId: context.userId,
          projectId: project.id,
          studyId: study.id,
          action: "STUDY_CREATED",
          entityType: "ViabilityStudy",
          entityId: study.id,
          after: json({ name: study.name, status: study.status }),
        },
      ],
    });
    return appendVersion(tx, context, project.id, study.id, input);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function createStudyVersion(
  context: Pick<AuthContext, "userId" | "organizationId">,
  projectId: string,
  studyId: string,
  input: ProjectAssumptions,
) {
  return prisma.$transaction(
    (tx) => appendVersion(tx, context, projectId, studyId, input),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
