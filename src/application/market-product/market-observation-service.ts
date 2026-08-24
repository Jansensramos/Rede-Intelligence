import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import {
  haversineDistanceMeters,
  isCanonicalMatch,
  normalizedNameSimilarity,
  ingestDemographicObservationSchema,
  ingestIncomeObservationSchema,
  ingestMarketDevelopmentSchema,
  ingestMarketPriceObservationSchema,
  ingestMarketInventorySnapshotSchema,
  type IngestDemographicObservationInput,
  type IngestIncomeObservationInput,
  type IngestMarketDevelopmentInput,
  type IngestMarketPriceObservationInput,
  type IngestMarketInventorySnapshotInput,
} from "@/domain/market-product";
import { requireMarketProductCapability, type MarketProductContext } from "./market-area-service";

const json = (value: unknown) => value as Prisma.InputJsonValue;
export const evidenceChecksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function assertMarketAreaScope(organizationId: string, marketAreaId: string) {
  const marketArea = await prisma.marketArea.findFirst({ where: { id: marketAreaId, organizationId } });
  if (!marketArea) throw new Error("Área de mercado não encontrada nesta organização.");
  return marketArea;
}

// Demografia e Renda (plano 9J, seções G e H) — upsert por [organização, área, ano, fonte]: nunca
// duplica a mesma competência da mesma fonte, mas preserva séries históricas por ano.
export async function ingestDemographicObservation(context: MarketProductContext, rawInput: IngestDemographicObservationInput, isDemo = false) {
  requireMarketProductCapability(context, "MARKET_MANAGE");
  const input = ingestDemographicObservationSchema.parse(rawInput);
  await assertMarketAreaScope(context.organizationId, input.marketAreaId);

  return prisma.demographicObservation.upsert({
    where: { organizationId_marketAreaId_referenceYear_sourceProvider: { organizationId: context.organizationId, marketAreaId: input.marketAreaId, referenceYear: input.referenceYear, sourceProvider: input.provenance.sourceProvider } },
    update: {},
    create: {
      organizationId: context.organizationId,
      marketAreaId: input.marketAreaId,
      referenceYear: input.referenceYear,
      totalPopulation: input.totalPopulation,
      projectedPopulation: input.projectedPopulation ?? null,
      annualGrowthRate: input.annualGrowthRate ?? null,
      totalHouseholds: input.totalHouseholds,
      personsPerHousehold: input.personsPerHousehold,
      urbanizationRate: input.urbanizationRate ?? null,
      ageDistribution: json(input.ageDistribution),
      householdComposition: json(input.householdComposition),
      educationLevels: input.educationLevels ? json(input.educationLevels) : Prisma.JsonNull,
      sourceProvider: input.provenance.sourceProvider,
      confidenceScore: input.provenance.confidenceLevel === "HIGH" ? 1 : input.provenance.confidenceLevel === "MEDIUM" ? 0.6 : 0.3,
      provenance: json({ ...input.provenance, evidenceChecksum: input.provenance.evidenceChecksum || evidenceChecksum(input), isDemo: isDemo || input.provenance.isDemo }),
    },
  });
}

export async function ingestIncomeObservation(context: MarketProductContext, rawInput: IngestIncomeObservationInput, isDemo = false) {
  requireMarketProductCapability(context, "MARKET_MANAGE");
  const input = ingestIncomeObservationSchema.parse(rawInput);
  await assertMarketAreaScope(context.organizationId, input.marketAreaId);

  return prisma.incomeObservation.upsert({
    where: { organizationId_marketAreaId_referenceYear_sourceProvider: { organizationId: context.organizationId, marketAreaId: input.marketAreaId, referenceYear: input.referenceYear, sourceProvider: input.provenance.sourceProvider } },
    update: {},
    create: {
      organizationId: context.organizationId,
      marketAreaId: input.marketAreaId,
      referenceYear: input.referenceYear,
      averageHouseholdIncome: input.averageHouseholdIncome,
      medianHouseholdIncome: input.medianHouseholdIncome,
      perCapitaIncome: input.perCapitaIncome ?? null,
      totalIncomeMassMonthly: input.totalIncomeMassMonthly ?? null,
      incomeBracketDistribution: json(input.incomeBracketDistribution),
      sourceProvider: input.provenance.sourceProvider,
      provenance: json({ ...input.provenance, evidenceChecksum: input.provenance.evidenceChecksum || evidenceChecksum(input), isDemo: isDemo || input.provenance.isDemo }),
    },
  });
}

export interface IngestMarketDevelopmentResult {
  development: Awaited<ReturnType<typeof prisma.marketDevelopment.create>>;
  wasCanonicalMatch: boolean;
}

// Resolução de identidade e deduplicação canônica (plano 9J, seção BB) — Caso Crítico A: quando
// dois provedores externos enviam o mesmo empreendimento, o resultado é uma única entidade
// canônica, nunca um registro duplicado. O matching nunca sobrescreve o registro existente; apenas
// evita criar um segundo.
export async function ingestMarketDevelopment(context: MarketProductContext, rawInput: IngestMarketDevelopmentInput, isDemo = false): Promise<IngestMarketDevelopmentResult> {
  requireMarketProductCapability(context, "MARKET_MANAGE");
  const input = ingestMarketDevelopmentSchema.parse(rawInput);
  const marketArea = await assertMarketAreaScope(context.organizationId, input.marketAreaId);

  const candidatesInArea = await prisma.marketDevelopment.findMany({ where: { organizationId: context.organizationId, marketAreaId: input.marketAreaId, isCanonical: true } });
  const canonicalMatch = candidatesInArea.find((candidate) => {
    const distanceMeters = haversineDistanceMeters({ latitude: input.latitude, longitude: input.longitude }, { latitude: Number(candidate.latitude), longitude: Number(candidate.longitude) });
    const nameSimilarity = normalizedNameSimilarity(input.name, candidate.name);
    return isCanonicalMatch({ distanceMeters, nameSimilarity, sameUnitsCount: candidate.totalUnits === input.totalUnits });
  });

  if (canonicalMatch) return { development: canonicalMatch, wasCanonicalMatch: true };

  const distanceMeters = Math.round(haversineDistanceMeters({ latitude: Number(marketArea.centerLatitude), longitude: Number(marketArea.centerLongitude) }, { latitude: input.latitude, longitude: input.longitude }));

  const development = await prisma.marketDevelopment.create({
    data: {
      organizationId: context.organizationId,
      marketAreaId: input.marketAreaId,
      name: input.name,
      developerName: input.developerName ?? null,
      builderName: input.builderName ?? null,
      address: input.address,
      neighborhood: input.neighborhood,
      city: input.city,
      state: input.state,
      latitude: input.latitude,
      longitude: input.longitude,
      distanceMeters,
      stage: input.stage,
      standard: input.standard,
      launchDate: input.launchDate ? new Date(input.launchDate) : null,
      expectedDeliveryDate: input.expectedDeliveryDate ? new Date(input.expectedDeliveryDate) : null,
      totalTowers: input.totalTowers,
      totalFloors: input.totalFloors ?? null,
      totalUnits: input.totalUnits,
      amenities: input.amenities ? json(input.amenities) : Prisma.JsonNull,
      isCanonical: true,
      isDemo: isDemo || input.provenance.isDemo,
      confidenceScore: input.provenance.confidenceLevel === "HIGH" ? 1 : input.provenance.confidenceLevel === "MEDIUM" ? 0.6 : 0.3,
      provenance: json({ ...input.provenance, evidenceChecksum: input.provenance.evidenceChecksum || evidenceChecksum(input), isDemo: isDemo || input.provenance.isDemo }),
      createdById: context.userId,
    },
  });
  return { development, wasCanonicalMatch: false };
}

export async function ingestMarketPriceObservation(context: MarketProductContext, rawInput: IngestMarketPriceObservationInput, isDemo = false) {
  requireMarketProductCapability(context, "MARKET_MANAGE");
  const input = ingestMarketPriceObservationSchema.parse(rawInput);
  const development = await prisma.marketDevelopment.findFirst({ where: { id: input.developmentId, organizationId: context.organizationId } });
  if (!development) throw new Error("Empreendimento concorrente não encontrado nesta organização.");

  const pricePerSqm = input.totalPrice / input.privateAreaM2;
  return prisma.marketPriceObservation.create({
    data: {
      organizationId: context.organizationId,
      developmentId: input.developmentId,
      typologyDescription: input.typologyDescription,
      bedrooms: input.bedrooms,
      suites: input.suites,
      bathrooms: input.bathrooms,
      parkingSpaces: input.parkingSpaces,
      privateAreaM2: input.privateAreaM2,
      totalPrice: input.totalPrice,
      pricePerSqm,
      priceType: input.priceType,
      discountRate: input.discountRate ?? null,
      observedAt: new Date(input.observedAt),
      sourceProvider: input.provenance.sourceProvider,
      confidenceScore: input.provenance.confidenceLevel === "HIGH" ? 1 : input.provenance.confidenceLevel === "MEDIUM" ? 0.6 : 0.3,
      provenance: json({ ...input.provenance, evidenceChecksum: input.provenance.evidenceChecksum || evidenceChecksum(input), isDemo: isDemo || input.provenance.isDemo }),
    },
  });
}

// Estoque estritamente temporal (plano 9J, seção N) — cada chamada cria uma NOVA linha; a
// restrição única por [organização, empreendimento, data, fonte] impede sobrescrever uma
// observação de estoque já registrada para a mesma competência.
export async function ingestMarketInventorySnapshot(context: MarketProductContext, rawInput: IngestMarketInventorySnapshotInput, isDemo = false) {
  requireMarketProductCapability(context, "MARKET_MANAGE");
  const input = ingestMarketInventorySnapshotSchema.parse(rawInput);
  const development = await prisma.marketDevelopment.findFirst({ where: { id: input.developmentId, organizationId: context.organizationId } });
  if (!development) throw new Error("Empreendimento concorrente não encontrado nesta organização.");

  const existing = await prisma.marketInventorySnapshot.findUnique({
    where: { organizationId_developmentId_asOfDate_sourceProvider: { organizationId: context.organizationId, developmentId: input.developmentId, asOfDate: new Date(input.asOfDate), sourceProvider: input.provenance.sourceProvider } },
  });
  if (existing) throw new Error("Já existe uma observação de estoque para esta data e fonte — o histórico nunca é sobrescrito.");

  return prisma.marketInventorySnapshot.create({
    data: {
      organizationId: context.organizationId,
      developmentId: input.developmentId,
      asOfDate: new Date(input.asOfDate),
      totalUnits: input.totalUnits,
      availableUnits: input.availableUnits,
      soldUnits: input.soldUnits,
      reservedUnits: input.reservedUnits,
      sourceProvider: input.provenance.sourceProvider,
      provenance: json({ ...input.provenance, evidenceChecksum: input.provenance.evidenceChecksum || evidenceChecksum(input), isDemo: isDemo || input.provenance.isDemo }),
    },
  });
}
