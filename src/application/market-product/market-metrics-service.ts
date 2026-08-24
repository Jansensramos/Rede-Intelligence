import { prisma } from "@/infrastructure/database/prisma";
import { calculateConfidence, summarizeDistribution } from "@/domain/data-intelligence";
import { monthsOfStock, vso } from "@/domain/sales/engine";
import {
  calculateAffordability,
  calculateAffordableAreaM2,
  calculateCompetitorSimilarity,
  checkCompetitorEligibility,
  type MarketProductStandard,
} from "@/domain/market-product";
import { requireMarketProductCapability, type MarketProductContext } from "./market-area-service";

const DEFAULT_COMPARABILITY_WEIGHTS = { distance: 0.25, productStandard: 0.25, typology: 0.2, pricePoint: 0.15, recency: 0.15 };
const DEFAULT_CONFIDENCE_WEIGHTS = { sampleSize: 0.3, recency: 0.2, dispersion: 0.2, similarity: 0.15, provenance: 0.15 };

// Política versionada de capacidade de financiamento (plano 9J, seção BD) — parâmetro auditável,
// nunca constante embutida. Idempotente: reaproveita a versão ativa existente.
export async function ensureDefaultAffordabilityPolicy(context: MarketProductContext) {
  const existing = await prisma.affordabilityPolicy.findFirst({ where: { organizationId: context.organizationId, isActive: true }, orderBy: { version: "desc" } });
  if (existing) return existing;
  return prisma.affordabilityPolicy.create({
    data: {
      organizationId: context.organizationId,
      name: "Política Padrão de Capacidade de Pagamento",
      version: 1,
      maxCommitmentRate: 0.3,
      annualInterestRate: 0.11,
      termMonths: 360,
      minDownPaymentRate: 0.2,
      isActive: true,
      createdById: context.userId,
    },
  });
}

export async function ensureDefaultComparabilityPolicy(context: MarketProductContext) {
  const existing = await prisma.marketComparabilityPolicy.findFirst({ where: { organizationId: context.organizationId, isActive: true }, orderBy: { version: "desc" } });
  if (existing) return existing;
  return prisma.marketComparabilityPolicy.create({
    data: {
      organizationId: context.organizationId,
      name: "Política Padrão de Comparabilidade de Mercado",
      version: 1,
      distanceWeight: DEFAULT_COMPARABILITY_WEIGHTS.distance,
      standardWeight: DEFAULT_COMPARABILITY_WEIGHTS.productStandard,
      typologyWeight: DEFAULT_COMPARABILITY_WEIGHTS.typology,
      pricePointWeight: DEFAULT_COMPARABILITY_WEIGHTS.pricePoint,
      recencyWeight: DEFAULT_COMPARABILITY_WEIGHTS.recency,
      minimumSampleSize: 3,
      isActive: true,
      createdById: context.userId,
    },
  });
}

function monthsBetween(a: Date, b: Date) {
  return Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 30);
}

// Nenhum conector real 9H para IBGE/Prospecta/portais existe ainda (fora de escopo da 9J) — a
// única fonte possível para observações externas hoje é o seed de demonstração. Este helper lê a
// marcação isDemo persistida dentro de provenance (não requer coluna dedicada nas tabelas de
// observação) para nunca deixar dado sintético ser exibido/descrito como coleta real.
function isDemoProvenance(provenance: unknown): boolean {
  return typeof provenance === "object" && provenance !== null && (provenance as { isDemo?: unknown }).isDemo === true;
}

export interface CompetitorView {
  id: string;
  name: string;
  standard: string;
  stage: string;
  distanceMeters: number;
  eligible: boolean;
  eligibilityReason: string | null;
  similarityScore: number;
  averagePricePerSqm: number | null;
  latestInventory: { asOfDate: Date; availableUnits: number; soldUnits: number } | null;
  monthlyVelocityUnits: number | null;
  isDemo: boolean;
}

export interface MarketOverview {
  marketArea: Awaited<ReturnType<typeof prisma.marketArea.findFirstOrThrow>>;
  demographics: Awaited<ReturnType<typeof prisma.demographicObservation.findFirst>>;
  income: Awaited<ReturnType<typeof prisma.incomeObservation.findFirst>>;
  affordability: { maxInstallment: number; financeableAmount: number; affordableTicket: number; affordableAreaM2: number };
  competitors: CompetitorView[];
  priceStats: ReturnType<typeof summarizeDistribution>;
  confidence: ReturnType<typeof calculateConfidence>;
  aggregateMonthlyVelocityUnits: number;
  aggregateVsoPercentage: number;
  monthsOfStockRegion: number | null;
  launches: Awaited<ReturnType<typeof prisma.marketLaunchHistory.findMany>>;
  // true quando QUALQUER dado desta visão (área, demografia, renda ou concorrentes) é sintético de
  // demonstração — nunca deve ser descrito como coleta real de mercado (UI e REDE AI leem esta flag).
  isDemoData: boolean;
}

// Consulta demografia, renda, oferta e métricas consolidadas da área de influência do terreno
// (plano 9J, seção U — Catálogo de Métricas de Mercado). Nunca um score único: cada dimensão é
// retornada decomposta e explicável.
export async function getMarketOverview(context: MarketProductContext, marketAreaId: string, standard: MarketProductStandard = "MEDIO"): Promise<MarketOverview> {
  requireMarketProductCapability(context, "MARKET_VIEW");
  const marketArea = await prisma.marketArea.findFirstOrThrow({ where: { id: marketAreaId, organizationId: context.organizationId } });
  const [demographics, income, affordabilityPolicy, comparabilityPolicy, developments] = await Promise.all([
    prisma.demographicObservation.findFirst({ where: { organizationId: context.organizationId, marketAreaId }, orderBy: { referenceYear: "desc" } }),
    prisma.incomeObservation.findFirst({ where: { organizationId: context.organizationId, marketAreaId }, orderBy: { referenceYear: "desc" } }),
    ensureDefaultAffordabilityPolicy(context),
    ensureDefaultComparabilityPolicy(context),
    prisma.marketDevelopment.findMany({
      where: { organizationId: context.organizationId, marketAreaId },
      include: { priceObservations: true, inventorySnapshots: { orderBy: { asOfDate: "asc" } } },
    }),
  ]);

  const affordabilityResult = calculateAffordability(income ? Number(income.medianHouseholdIncome) : 0, {
    maxCommitmentRate: Number(affordabilityPolicy.maxCommitmentRate),
    annualInterestRate: Number(affordabilityPolicy.annualInterestRate),
    termMonths: affordabilityPolicy.termMonths,
    minDownPaymentRate: Number(affordabilityPolicy.minDownPaymentRate),
  });

  const now = new Date();
  const subject = { latitude: Number(marketArea.centerLatitude), longitude: Number(marketArea.centerLongitude), standard, targetTicket: affordabilityResult.affordableTicket || 400_000, targetAreaM2: 50, targetBedrooms: 2, asOfDate: now };
  const weights = { distance: Number(comparabilityPolicy.distanceWeight), productStandard: Number(comparabilityPolicy.standardWeight), typology: Number(comparabilityPolicy.typologyWeight), pricePoint: Number(comparabilityPolicy.pricePointWeight), recency: Number(comparabilityPolicy.recencyWeight) };

  const eligiblePricesPerSqm: number[] = [];
  const eligibleSimilarities: number[] = [];
  const eligibleAgesMonths: number[] = [];
  const eligibleProvenanceScores: number[] = [];
  let aggregateMonthlyVelocityUnits = 0;
  let unitsSoldAcrossPeriod = 0;
  let unitsAvailableAtStart = 0;
  let availableUnitsNow = 0;

  const competitors: CompetitorView[] = developments.map((development) => {
    const eligibility = checkCompetitorEligibility(subject.standard, development.standard);
    const averageAreaM2 = development.priceObservations.length > 0 ? development.priceObservations.reduce((sum, o) => sum + Number(o.privateAreaM2), 0) / development.priceObservations.length : 50;
    const averageTicket = development.priceObservations.length > 0 ? development.priceObservations.reduce((sum, o) => sum + Number(o.totalPrice), 0) / development.priceObservations.length : 0;
    const bedrooms = development.priceObservations[0]?.bedrooms ?? 2;
    const similarity = calculateCompetitorSimilarity(subject, { latitude: Number(development.latitude), longitude: Number(development.longitude), standard: development.standard, averageTicket, averageAreaM2, bedrooms, observedAt: development.updatedAt }, weights);

    const averagePricePerSqm = development.priceObservations.length > 0 ? development.priceObservations.reduce((sum, o) => sum + Number(o.pricePerSqm), 0) / development.priceObservations.length : null;

    let monthlyVelocityUnits: number | null = null;
    if (development.inventorySnapshots.length >= 2) {
      const earliest = development.inventorySnapshots[0];
      const latest = development.inventorySnapshots[development.inventorySnapshots.length - 1];
      const months = Math.max(0.5, monthsBetween(earliest.asOfDate, latest.asOfDate));
      monthlyVelocityUnits = Math.max(0, (latest.soldUnits - earliest.soldUnits) / months);
      if (eligibility.eligible) {
        aggregateMonthlyVelocityUnits += monthlyVelocityUnits;
        unitsSoldAcrossPeriod += Math.max(0, latest.soldUnits - earliest.soldUnits);
        unitsAvailableAtStart += earliest.availableUnits;
        availableUnitsNow += latest.availableUnits;
      }
    }
    const latestInventory = development.inventorySnapshots.length > 0 ? development.inventorySnapshots[development.inventorySnapshots.length - 1] : null;

    if (eligibility.eligible) {
      eligibleSimilarities.push(similarity.score);
      for (const observation of development.priceObservations) {
        eligiblePricesPerSqm.push(Number(observation.pricePerSqm));
        eligibleAgesMonths.push(monthsBetween(observation.observedAt, now));
        eligibleProvenanceScores.push(observation.confidenceScore);
      }
    }

    return {
      id: development.id,
      name: development.name,
      standard: development.standard,
      stage: development.stage,
      distanceMeters: development.distanceMeters,
      eligible: eligibility.eligible,
      eligibilityReason: eligibility.reason,
      similarityScore: similarity.score,
      averagePricePerSqm,
      latestInventory: latestInventory ? { asOfDate: latestInventory.asOfDate, availableUnits: latestInventory.availableUnits, soldUnits: latestInventory.soldUnits } : null,
      monthlyVelocityUnits,
      isDemo: development.isDemo,
    };
  });

  const priceStats = summarizeDistribution(eligiblePricesPerSqm);
  const confidence = calculateConfidence(
    {
      sampleSize: competitors.filter((c) => c.eligible).length,
      minimumSampleSize: comparabilityPolicy.minimumSampleSize,
      averageAgeMonths: eligibleAgesMonths.length > 0 ? eligibleAgesMonths.reduce((sum, v) => sum + v, 0) / eligibleAgesMonths.length : 36,
      coefficientOfVariation: priceStats.coefficientOfVariation,
      averageSimilarity: eligibleSimilarities.length > 0 ? eligibleSimilarities.reduce((sum, v) => sum + v, 0) / eligibleSimilarities.length : 0,
      provenanceScore: eligibleProvenanceScores.length > 0 ? eligibleProvenanceScores.reduce((sum, v) => sum + v, 0) / eligibleProvenanceScores.length : 0,
    },
    DEFAULT_CONFIDENCE_WEIGHTS,
  );

  const affordableAreaM2 = calculateAffordableAreaM2({ affordableTicket: affordabilityResult.affordableTicket, pricePerSqm: priceStats.median || subject.targetTicket / subject.targetAreaM2 });

  const launches = await prisma.marketLaunchHistory.findMany({ where: { organizationId: context.organizationId, developmentId: { in: developments.map((d) => d.id) } }, orderBy: { launchDate: "desc" } });

  const isDemoData = marketArea.isDemo
    || isDemoProvenance(demographics?.provenance)
    || isDemoProvenance(income?.provenance)
    || competitors.some((competitor) => competitor.isDemo)
    || launches.some((launch) => isDemoProvenance(launch.provenance));

  return {
    marketArea,
    demographics,
    income,
    affordability: { maxInstallment: affordabilityResult.maxInstallment, financeableAmount: affordabilityResult.financeableAmount, affordableTicket: affordabilityResult.affordableTicket, affordableAreaM2 },
    competitors,
    priceStats,
    confidence,
    aggregateMonthlyVelocityUnits,
    aggregateVsoPercentage: vso(unitsSoldAcrossPeriod, unitsAvailableAtStart),
    monthsOfStockRegion: monthsOfStock(availableUnitsNow, aggregateMonthlyVelocityUnits),
    launches,
    isDemoData,
  };
}
