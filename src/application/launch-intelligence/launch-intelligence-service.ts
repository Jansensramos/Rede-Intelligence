import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { Prisma, type LaunchScenarioKind } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { getCapitalExecutiveSummary } from "@/application/capital/capital-queries";
import { getEngineeringExecutiveSignals } from "@/application/engineering/engineering-service";
import { getMarketOverview, type MarketOverview } from "@/application/market-product/market-metrics-service";
import { getLatestStudyForProject } from "@/application/studies/study-service";
import { calculateProject } from "@/domain/financial/engine";
import type { ProjectAssumptions } from "@/domain/financial/types";
import {
  LAUNCH_ASSUMPTION_REGISTRY,
  LAUNCH_ENGINE_VERSION,
  MACRO_INDICATOR_REGISTRY,
  assertLaunchIntelligenceCapability,
  createCustomLaunchScenarioSchema,
  createLaunchTriggerSchema,
  decideLaunchSchema,
  evaluateFreshness,
  evaluateLaunchTrigger,
  generateLaunchScenariosSchema,
  hasLaunchIntelligenceCapability,
  launchMetric,
  macroIndicator,
  macroScenarioAdjustments,
  normalizeMacroValue,
  recommendLaunch,
  registerMacroObservationSchema,
  selectPreferredObservation,
  type CreateCustomLaunchScenarioInput,
  type CreateLaunchTriggerInput,
  type DecideLaunchInput,
  type GenerateLaunchScenariosInput,
  type RegisterMacroObservationInput,
} from "@/domain/launch-intelligence";
import { prisma } from "@/infrastructure/database/prisma";

export type LaunchIntelligenceContext = Pick<AuthContext, "organizationId" | "userId" | "role">;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function checksum(value: unknown) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

async function assertContext(context: LaunchIntelligenceContext): Promise<null>;
async function assertContext(context: LaunchIntelligenceContext, projectId: string): Promise<{ id: string; name: string; city: string; state: string }>;
async function assertContext(context: LaunchIntelligenceContext, projectId?: string) {
  const membership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: context.organizationId, userId: context.userId } }, select: { role: true } });
  if (!membership || membership.role !== context.role) throw new Error("Sessão sem vínculo ativo com esta organização.");
  if (!projectId) return null;
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: context.organizationId }, select: { id: true, name: true, city: true, state: true } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  return project;
}

function expectedFreshnessDays(code: string) {
  if (["SELIC", "CAMBIO_BRL_USD", "TAXA_FINANCIAMENTO", "SPREAD_FUNDING"].includes(code)) return 35;
  if (["PIB", "DESEMPREGO", "RENDA_DOMICILIAR"].includes(code)) return 120;
  return 50;
}

function categoryFor(code: string) {
  if (["INCC", "CUB", "SINAPI", "IGPM"].includes(code)) return "CUSTOS";
  if (["TAXA_FINANCIAMENTO", "CREDITO_IMOBILIARIO", "SBPE", "FGTS", "SPREAD_FUNDING"].includes(code)) return "CRÉDITO";
  return "MACROECONOMIA";
}

/** Usuários de tenant só registram série ORGANIZATION. Séries GLOBAL são exclusivas de provider/system. */
export async function registerMacroObservation(context: LaunchIntelligenceContext, raw: RegisterMacroObservationInput) {
  assertLaunchIntelligenceCapability(context.role, "OBSERVATION_MANAGE");
  await assertContext(context);
  const input = registerMacroObservationSchema.parse(raw);
  const definition = macroIndicator(input.code);
  if (!definition) throw new Error("Indicador não cadastrado no catálogo canônico.");
  const normalized = normalizeMacroValue(input);
  const observationChecksum = checksum({ ...input, referenceDate: input.referenceDate.toISOString(), collectedAt: input.collectedAt.toISOString(), normalizedValue: normalized.normalizedValue });

  return prisma.$transaction(async (tx) => {
    const series = await tx.macroIndicatorSeries.upsert({
      where: { id: (await tx.macroIndicatorSeries.findFirst({ where: { organizationId: context.organizationId, code: input.code }, select: { id: true } }))?.id ?? "__new__" },
      create: { organizationId: context.organizationId, code: input.code, name: definition.label, category: categoryFor(input.code), canonicalUnit: definition.unit, frequency: "MONTHLY", visibility: "ORGANIZATION", expectedFreshnessDays: expectedFreshnessDays(input.code), description: "Série organizacional com proveniência e histórico append-only.", createdById: context.userId },
      update: {},
    });
    const replay = await tx.macroIndicatorObservation.findUnique({ where: { seriesId_checksum: { seriesId: series.id, checksum: observationChecksum } } });
    if (replay) return replay;
    const current = await tx.macroIndicatorObservation.findFirst({ where: { seriesId: series.id, referenceDate: input.referenceDate, regionLevel: input.regionLevel, regionCode: input.regionCode, corrections: { none: {} } }, orderBy: { revision: "desc" } });
    return tx.macroIndicatorObservation.create({ data: {
      seriesId: series.id, previousObservationId: current?.id ?? null, revision: (current?.revision ?? 0) + 1, isCorrection: Boolean(current),
      referenceDate: input.referenceDate, collectedAt: input.collectedAt, regionLevel: input.regionLevel, regionCode: input.regionCode,
      rawValue: input.rawValue, rawUnit: input.rawUnit, normalizedValue: normalized.normalizedValue, canonicalUnit: normalized.canonicalUnit,
      normalizationKey: input.normalizationKey, normalizationMetadata: json(normalized.metadata), sourceProvider: input.sourceProvider,
      sourceUrl: input.sourceUrl ?? null, sourceMethod: input.sourceMethod, confidenceLevel: input.confidenceLevel,
      confidenceScore: input.confidenceScore ?? null, provenance: json(input.provenance), checksum: observationChecksum, createdById: context.userId,
    } });
  });
}

type CurrentMacro = Awaited<ReturnType<typeof loadCurrentMacro>>[number];
async function loadCurrentMacro(organizationId: string, project: { id: string; state: string }, marketAreaId?: string | null) {
  const rows = await prisma.macroIndicatorObservation.findMany({
    where: { series: { isActive: true, OR: [{ organizationId }, { organizationId: null }] }, corrections: { none: {} } },
    include: { series: true }, orderBy: [{ referenceDate: "desc" }, { createdAt: "desc" }], take: 200,
  });
  const codes = [...new Set([...Object.keys(MACRO_INDICATOR_REGISTRY), ...rows.map((row) => row.series.code)])];
  return codes.map((code) => {
    const candidates = rows.filter((row) => row.series.code === code).map((row) => {
      const freshness = evaluateFreshness({ referenceDate: row.referenceDate, expectedFreshnessDays: row.series.expectedFreshnessDays });
      const regionCompatible = row.regionLevel === "NATIONAL" && row.regionCode === "BR"
        || row.regionLevel === "STATE" && row.regionCode === `BR-${project.state}`
        || row.regionLevel === "MARKET_AREA" && row.regionCode === `market-area:${marketAreaId}`;
      return { ...row, organizationId: row.series.organizationId, freshness: freshness.status, ageDays: freshness.ageDays, regionCompatible };
    });
    const preferred = selectPreferredObservation(candidates);
    return { code, label: macroIndicator(code)?.label ?? code, selected: preferred.observation, precedence: preferred.reason };
  });
}

function selectedMacroValue(macro: CurrentMacro[], code: string) {
  const selected = macro.find((item) => item.code === code)?.selected;
  return selected ? Number(selected.normalizedValue) : null;
}

async function loadMarket(context: LaunchIntelligenceContext, projectId: string) {
  const area = await prisma.marketArea.findFirst({ where: { organizationId: context.organizationId, OR: [{ projectId }, { projectId: null, isDefault: true }] }, orderBy: [{ projectId: "desc" }, { createdAt: "desc" }] });
  if (!area) return { area: null, overview: null as MarketOverview | null };
  return { area, overview: await getMarketOverview(context, area.id) };
}

async function safeSignals(context: LaunchIntelligenceContext, projectId: string) {
  const [capital, engineering] = await Promise.all([
    getCapitalExecutiveSummary(context, projectId).catch(() => null),
    getEngineeringExecutiveSignals(context.organizationId, projectId).catch(() => null),
  ]);
  return { capital, engineering };
}

function adjustmentAssumptions(base: ProjectAssumptions, adjustments: ReturnType<typeof macroScenarioAdjustments>) {
  return {
    ...base,
    unitPrice: new Decimal(base.unitPrice).mul(adjustments.priceRate).toDecimalPlaces(2).toString(),
    salesVelocityUnitsMonth: Decimal.max(0.01, new Decimal(base.salesVelocityUnitsMonth).mul(adjustments.salesVelocityRate)).toDecimalPlaces(4).toString(),
    constructionCostPerM2: new Decimal(base.constructionCostPerM2).mul(adjustments.constructionCostRate).toDecimalPlaces(2).toString(),
    annualFinancingRate: Decimal.max(0, new Decimal(base.annualFinancingRate).add(adjustments.fundingRateDeltaPercentagePoints)).toDecimalPlaces(4).toString(),
  } satisfies ProjectAssumptions;
}

function assumptionsForPersistence(base: ProjectAssumptions, adjusted: ProjectAssumptions, adjustments: ReturnType<typeof macroScenarioAdjustments>) {
  return [
    ["PRECO_M2", new Decimal(base.unitPrice).div(base.privateAreaPerUnitM2).toNumber(), new Decimal(adjusted.unitPrice).div(adjusted.privateAreaPerUnitM2).toNumber()],
    ["VELOCIDADE_VENDAS", Number(base.salesVelocityUnitsMonth), Number(adjusted.salesVelocityUnitsMonth)],
    ["CUSTO_CONSTRUCAO_M2", Number(base.constructionCostPerM2), Number(adjusted.constructionCostPerM2)],
    ["TAXA_FUNDING", Number(base.annualFinancingRate), Number(adjusted.annualFinancingRate)],
    ["ATRASO_LANCAMENTO", 0, 0],
  ].map(([key, original, value]) => ({ key: String(key) as keyof typeof LAUNCH_ASSUMPTION_REGISTRY, original: Number(original), adjusted: Number(value), rate: adjustments }));
}

interface CalculationSources { study: Awaited<ReturnType<typeof getLatestStudyForProject>>; market: Awaited<ReturnType<typeof loadMarket>>; macro: CurrentMacro[]; signals: Awaited<ReturnType<typeof safeSignals>>; }
async function loadCalculationSources(context: LaunchIntelligenceContext, projectId: string): Promise<CalculationSources> {
  const project = await assertContext(context, projectId);
  const [study, market, signals] = await Promise.all([getLatestStudyForProject(context.organizationId, projectId), loadMarket(context, projectId), safeSignals(context, projectId)]);
  const macro = await loadCurrentMacro(context.organizationId, project!, market.area?.id);
  return { study, market, macro, signals };
}

function calculateEvaluation(kind: LaunchScenarioKind, base: ProjectAssumptions, adjustments: ReturnType<typeof macroScenarioAdjustments>, sources: CalculationSources) {
  const adjusted = adjustmentAssumptions(base, adjustments);
  const financial = calculateProject(adjusted, "base");
  const overview = sources.market.overview;
  const affordabilityRatio = overview?.affordability.affordableTicket ? Number(adjusted.unitPrice) / overview.affordability.affordableTicket * 100 : null;
  const hasMarketInventory = Boolean(overview?.competitors.some((item) => item.latestInventory));
  const incc = selectedMacroValue(sources.macro, "INCC");
  const financingRate = selectedMacroValue(sources.macro, "TAXA_FINANCIAMENTO");
  const missingMacro = [incc == null ? "INCC atualizado" : null, financingRate == null ? "Taxa média de financiamento atualizada" : null].filter((item): item is string => Boolean(item));
  const recommendation = recommendLaunch({
    marginPercentage: Number(financial.metrics.marginOnVgv) * 100,
    minimumMarginPercentage: Number(base.policy.minimumMarginRate),
    affordabilityRatioPercentage: affordabilityRatio,
    vsoPercentage: hasMarketInventory ? overview!.aggregateVsoPercentage * 100 : null,
    monthsOfStock: hasMarketInventory ? overview!.monthsOfStockRegion : null,
    constructionInflationPercentage: incc,
    criticalEvidenceMissing: [...missingMacro, ...(sources.market.overview ? [] : ["Inteligência de mercado local"])],
  });
  const indicators = {
    macro: sources.macro.map((item) => ({ code: item.code, label: item.label, value: item.selected ? Number(item.selected.normalizedValue) : null, unit: item.selected?.canonicalUnit ?? null, referenceDate: item.selected?.referenceDate.toISOString() ?? null, freshness: item.selected?.freshness ?? "NO_EVIDENCE", source: item.selected?.sourceProvider ?? null, confidenceLevel: item.selected?.confidenceLevel ?? null, precedence: item.precedence })),
    market: overview ? { vsoPercentage: hasMarketInventory ? overview.aggregateVsoPercentage * 100 : null, monthsOfStock: hasMarketInventory ? overview.monthsOfStockRegion : null, pricePerSqm: overview.priceStats.median || null, affordabilityRatioPercentage: affordabilityRatio, confidence: overview.confidence, isDemoData: overview.isDemoData } : null,
    engineering: sources.signals.engineering ? { approvedBudget: sources.signals.engineering.budgeted || null, projectedFinalCost: sources.signals.engineering.finalProjected, itemsWithoutEvidence: sources.signals.engineering.noEvidence.length } : null,
    capital: sources.signals.capital ? { fundingNeeded: sources.signals.capital.fundingNecessario, contracted: sources.signals.capital.fundingContratado, averageCost: sources.signals.capital.custoMedio } : null,
    financial: { marginOnVgvPercentage: Number(financial.metrics.marginOnVgv) * 100, constructionCostPerM2: Number(adjusted.constructionCostPerM2), fundingNeed: Number(financial.metrics.fundingNeed) },
  };
  return { kind, adjusted, financial, recommendation, indicators, assumptions: assumptionsForPersistence(base, adjusted, adjustments) };
}

async function persistCalculation(context: LaunchIntelligenceContext, projectId: string, name: string, kind: LaunchScenarioKind, rationale: string, adjustments: ReturnType<typeof macroScenarioAdjustments>, sources: CalculationSources, seriesKey: string) {
  if (!sources.study) throw new Error("O empreendimento não possui estudo de viabilidade oficial para calcular cenários de lançamento.");
  const study = sources.study;
  const result = calculateEvaluation(kind, study.assumptions, adjustments, sources);
  const inputChecksum = checksum({ studyVersionId: study.studyVersionId, kind, adjustments, indicators: result.indicators });
  const previous = await prisma.launchScenario.findFirst({ where: { organizationId: context.organizationId, projectId, seriesKey, status: "LOCKED" }, include: { evaluations: true }, orderBy: { version: "desc" } });
  const replay = previous?.evaluations.find((item) => item.inputChecksum === inputChecksum);
  if (replay) return replay;

  return prisma.$transaction(async (tx) => {
    const scenario = await tx.launchScenario.create({ data: { organizationId: context.organizationId, projectId, seriesKey, version: (previous?.version ?? 0) + 1, previousScenarioId: previous?.id ?? null, name, kind, status: "DRAFT", referenceDate: new Date(), rationale, createdById: context.userId } });
    for (const assumption of result.assumptions) {
      const definition = LAUNCH_ASSUMPTION_REGISTRY[assumption.key];
      await tx.launchScenarioAssumption.create({ data: { organizationId: context.organizationId, projectId, scenarioId: scenario.id, assumptionKey: assumption.key, originalValue: json(assumption.original), adjustedValue: json(assumption.adjusted), unit: definition.unit, sourceType: definition.origin, sourceRef: study.studyVersionId, confidenceLevel: "HIGH", justification: rationale, createdById: context.userId } });
    }
    await tx.launchScenario.update({ where: { id: scenario.id }, data: { status: "CALCULATED" } });
    const evaluation = await tx.launchEvaluation.create({ data: {
      organizationId: context.organizationId, projectId, scenarioId: scenario.id, recommendation: result.recommendation.recommendation,
      confidenceLevel: result.recommendation.confidenceLevel, confidenceScore: result.recommendation.confidenceScore,
      favorableFactors: json(result.recommendation.favorableFactors), unfavorableFactors: json(result.recommendation.unfavorableFactors), criticalFactors: json(result.recommendation.criticalFactors), missingEvidence: json(result.recommendation.missingEvidence),
      economicImpactSnapshot: json({ metrics: result.financial.metrics, assumptions: result.adjusted, engineVersion: result.financial.engineVersion }), indicatorSnapshot: json(result.indicators), conditionsForChange: json(result.recommendation.conditionsForChange), engineVersion: LAUNCH_ENGINE_VERSION, inputChecksum, createdById: context.userId,
    } });
    await tx.launchScenario.update({ where: { id: scenario.id }, data: { status: "LOCKED", lockedAt: new Date() } });
    if (previous) await tx.launchScenario.update({ where: { id: previous.id }, data: { status: "SUPERSEDED" } });
    return evaluation;
  }, { timeout: 30_000 });
}

export async function generateLaunchScenarios(context: LaunchIntelligenceContext, raw: GenerateLaunchScenariosInput) {
  assertLaunchIntelligenceCapability(context.role, "SCENARIO_CREATE");
  const input = generateLaunchScenariosSchema.parse(raw);
  await assertContext(context, input.projectId);
  const sources = await loadCalculationSources(context, input.projectId);
  const kinds = ["BASE", "FAVORABLE", "STRESSED"] as const;
  const names = { BASE: "Cenário Base", FAVORABLE: "Cenário Favorável", STRESSED: "Cenário Estressado" };
  const output = [];
  for (const kind of kinds) output.push(await persistCalculation(context, input.projectId, names[kind], kind, input.rationale, macroScenarioAdjustments(kind), sources, `launch:${input.projectId}:${kind.toLowerCase()}`));
  return output;
}

export async function createCustomLaunchScenario(context: LaunchIntelligenceContext, raw: CreateCustomLaunchScenarioInput) {
  assertLaunchIntelligenceCapability(context.role, "SCENARIO_CREATE");
  const input = createCustomLaunchScenarioSchema.parse(raw);
  await assertContext(context, input.projectId);
  const sources = await loadCalculationSources(context, input.projectId);
  return persistCalculation(context, input.projectId, input.name, "CUSTOM", input.rationale, input.adjustments, sources, `launch:${input.projectId}:custom:${checksum(input.name).slice(0, 16)}`);
}

export async function createLaunchTrigger(context: LaunchIntelligenceContext, raw: CreateLaunchTriggerInput) {
  assertLaunchIntelligenceCapability(context.role, "TRIGGER_MANAGE");
  const input = createLaunchTriggerSchema.parse(raw);
  await assertContext(context, input.projectId);
  const metric = launchMetric(input.metricKey);
  if (!metric?.triggerEligible) throw new Error("Métrica não elegível para gatilho.");
  const previous = await prisma.launchTrigger.findFirst({ where: { organizationId: context.organizationId, projectId: input.projectId, code: input.code, status: { in: ["ACTIVE", "PAUSED"] } }, orderBy: { version: "desc" } });
  return prisma.$transaction(async (tx) => {
    const created = await tx.launchTrigger.create({ data: { organizationId: context.organizationId, projectId: input.projectId, seriesKey: previous?.seriesKey ?? `trigger:${input.projectId}:${input.code}`, version: (previous?.version ?? 0) + 1, previousTriggerId: previous?.id ?? null, code: input.code, metricKey: input.metricKey, operator: input.operator, thresholdValue: input.thresholdValue, thresholdValueEnd: input.operator === "BETWEEN" ? input.thresholdValueEnd : null, unit: metric.unit, minimumConfidence: input.minimumConfidence ?? null, recommendationOnMatch: input.recommendationOnMatch ?? null, rationale: input.rationale, createdById: context.userId } });
    if (previous) await tx.launchTrigger.update({ where: { id: previous.id }, data: { status: "SUPERSEDED" } });
    return created;
  });
}

export async function decideLaunch(context: LaunchIntelligenceContext, raw: DecideLaunchInput) {
  assertLaunchIntelligenceCapability(context.role, "DECIDE");
  const input = decideLaunchSchema.parse(raw);
  await assertContext(context);
  const evaluation = await prisma.launchEvaluation.findFirst({ where: { id: input.evaluationId, organizationId: context.organizationId }, include: { scenario: true, decisions: true } });
  if (!evaluation) throw new Error("Avaliação de lançamento não encontrada nesta organização.");
  await assertContext(context, evaluation.projectId);
  if (evaluation.scenario.status !== "LOCKED") throw new Error("A decisão exige um cenário calculado e bloqueado.");
  const decisionChecksum = checksum({ evaluationId: evaluation.id, humanDecision: input.humanDecision, rationale: input.rationale, evidenceRefs: input.evidenceRefs });
  const existing = evaluation.decisions[0];
  if (existing) {
    if (existing.checksum === decisionChecksum) return existing;
    throw new Error("Esta avaliação já possui decisão imutável. Gere um novo ciclo de cenário para revisar a decisão.");
  }
  return prisma.launchDecision.create({ data: { organizationId: context.organizationId, projectId: evaluation.projectId, evaluationId: evaluation.id, recommendationSnapshot: json({ recommendation: evaluation.recommendation, confidenceLevel: evaluation.confidenceLevel, confidenceScore: evaluation.confidenceScore, calculatedAt: evaluation.calculatedAt }), humanDecision: input.humanDecision, rationale: input.rationale, evidenceRefs: json(input.evidenceRefs), decidedById: context.userId, checksum: decisionChecksum } });
}

function metricValue(snapshot: Record<string, unknown>, metricKey: string) {
  const market = snapshot.market as Record<string, unknown> | null;
  const capital = snapshot.capital as Record<string, unknown> | null;
  const financial = snapshot.financial as Record<string, unknown> | null;
  const macro = Array.isArray(snapshot.macro) ? snapshot.macro as Array<Record<string, unknown>> : [];
  if (metricKey in MACRO_INDICATOR_REGISTRY) { const item = macro.find((row) => row.code === metricKey); const confidence = typeof item?.confidenceLevel === "string" ? item.confidenceLevel as "LOW" | "MEDIUM" | "HIGH" : null; return { value: typeof item?.value === "number" ? item.value : null, unit: typeof item?.unit === "string" ? item.unit : null, freshness: typeof item?.freshness === "string" ? item.freshness : "NO_EVIDENCE", confidence }; }
  if (metricKey === "VSO") return { value: typeof market?.vsoPercentage === "number" ? market.vsoPercentage : null, unit: "%", freshness: market ? "UPDATED" : "NO_EVIDENCE", confidence: null };
  if (metricKey === "ESTOQUE_MESES") return { value: typeof market?.monthsOfStock === "number" ? market.monthsOfStock : null, unit: "meses", freshness: market ? "UPDATED" : "NO_EVIDENCE", confidence: null };
  if (metricKey === "PRECO_M2") return { value: typeof market?.pricePerSqm === "number" ? market.pricePerSqm : null, unit: "R$/m²", freshness: market ? "UPDATED" : "NO_EVIDENCE", confidence: null };
  if (metricKey === "AFFORDABILITY_RATIO") return { value: typeof market?.affordabilityRatioPercentage === "number" ? market.affordabilityRatioPercentage : null, unit: "%", freshness: market ? "UPDATED" : "NO_EVIDENCE", confidence: null };
  if (metricKey === "MARGEM_VGV") return { value: typeof financial?.marginOnVgvPercentage === "number" ? financial.marginOnVgvPercentage : null, unit: "%", freshness: financial ? "UPDATED" : "NO_EVIDENCE", confidence: "HIGH" as const };
  if (metricKey === "CUSTO_CONSTRUCAO_M2") return { value: typeof financial?.constructionCostPerM2 === "number" ? financial.constructionCostPerM2 : null, unit: "R$/m²", freshness: financial ? "UPDATED" : "NO_EVIDENCE", confidence: "HIGH" as const };
  if (metricKey === "NECESSIDADE_CAPITAL") return { value: typeof capital?.fundingNeeded === "number" ? capital.fundingNeeded : null, unit: "R$", freshness: capital ? "UPDATED" : "NO_EVIDENCE", confidence: null };
  return { value: null, unit: null, freshness: "NO_EVIDENCE", confidence: null };
}

export async function getLaunchIntelligenceWorkspace(context: LaunchIntelligenceContext, projectId: string) {
  assertLaunchIntelligenceCapability(context.role, "VIEW");
  const project = await assertContext(context, projectId);
  const market = await loadMarket(context, projectId);
  const [macro, scenarios, triggers] = await Promise.all([
    loadCurrentMacro(context.organizationId, project!, market.area?.id),
    prisma.launchScenario.findMany({ where: { organizationId: context.organizationId, projectId }, include: { assumptions: true, evaluations: { include: { decisions: true }, orderBy: { calculatedAt: "desc" }, take: 1 } }, orderBy: [{ referenceDate: "desc" }, { kind: "asc" }], take: 40 }),
    prisma.launchTrigger.findMany({ where: { organizationId: context.organizationId, projectId, status: { in: ["ACTIVE", "PAUSED"] } }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const latest = scenarios.find((item) => item.kind === "BASE" && item.status === "LOCKED") ?? scenarios.find((item) => item.status === "LOCKED") ?? null;
  const snapshot = (latest?.evaluations[0]?.indicatorSnapshot ?? {}) as Record<string, unknown>;
  const triggerEvaluations = triggers.map((trigger) => { const fact = metricValue(snapshot, trigger.metricKey); return { trigger, result: evaluateLaunchTrigger({ operator: trigger.operator, value: fact.value, threshold: Number(trigger.thresholdValue), thresholdEnd: trigger.thresholdValueEnd == null ? null : Number(trigger.thresholdValueEnd), unit: trigger.unit, actualUnit: fact.unit, freshness: fact.freshness as "UPDATED" | "AGING" | "STALE" | "NO_EVIDENCE", confidenceLevel: fact.confidence, minimumConfidence: trigger.minimumConfidence }) }; });
  return {
    project, marketArea: market.area,
    macro: macro.map((item) => ({ code: item.code, label: item.label, precedence: item.precedence, observation: item.selected ? { id: item.selected.id, value: Number(item.selected.normalizedValue), unit: item.selected.canonicalUnit, referenceDate: item.selected.referenceDate, collectedAt: item.selected.collectedAt, sourceProvider: item.selected.sourceProvider, confidenceLevel: item.selected.confidenceLevel, confidenceScore: item.selected.confidenceScore, freshness: item.selected.freshness, ageDays: item.selected.ageDays, regionLevel: item.selected.regionLevel, regionCode: item.selected.regionCode, isCorrection: item.selected.isCorrection, revision: item.selected.revision } : null })),
    scenarios, triggers: triggerEvaluations, latestEvaluation: latest?.evaluations[0] ?? null,
    capabilities: { manageObservations: hasLaunchIntelligenceCapability(context.role, "OBSERVATION_MANAGE"), createScenarios: hasLaunchIntelligenceCapability(context.role, "SCENARIO_CREATE"), manageTriggers: hasLaunchIntelligenceCapability(context.role, "TRIGGER_MANAGE"), decide: hasLaunchIntelligenceCapability(context.role, "DECIDE") },
  };
}

export async function getLaunchExecutiveSignals(context: Pick<LaunchIntelligenceContext, "organizationId" | "role"> & Partial<Pick<LaunchIntelligenceContext, "userId">>, projectId: string) {
  assertLaunchIntelligenceCapability(context.role, "VIEW");
  if (context.userId) await assertContext(context as LaunchIntelligenceContext, projectId);
  else if (!await prisma.project.findFirst({ where: { id: projectId, organizationId: context.organizationId }, select: { id: true } })) throw new Error("Empreendimento não encontrado nesta organização.");
  const [latest, activeTriggers] = await Promise.all([
    prisma.launchEvaluation.findFirst({ where: { organizationId: context.organizationId, projectId, scenario: { kind: "BASE", status: "LOCKED" } }, include: { scenario: true, decisions: true }, orderBy: { calculatedAt: "desc" } }),
    prisma.launchTrigger.count({ where: { organizationId: context.organizationId, projectId, status: "ACTIVE" } }),
  ]);
  if (!latest) return { recommendation: null, confidenceLevel: null, confidenceScore: null, mainRisk: null, mainOpportunity: null, changeCondition: null, calculatedAt: null, evaluationId: null, pendingDecision: false, activeTriggers };
  const critical = latest.criticalFactors as string[];
  const unfavorable = latest.unfavorableFactors as string[];
  const favorable = latest.favorableFactors as string[];
  const conditions = latest.conditionsForChange as string[];
  return { recommendation: latest.recommendation, confidenceLevel: latest.confidenceLevel, confidenceScore: latest.confidenceScore, mainRisk: critical[0] ?? unfavorable[0] ?? null, mainOpportunity: favorable[0] ?? null, changeCondition: conditions[0] ?? null, calculatedAt: latest.calculatedAt, evaluationId: latest.id, pendingDecision: latest.decisions.length === 0, activeTriggers };
}
