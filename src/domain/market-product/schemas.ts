import { z } from "zod";

export const marketAreaTypeSchema = z.enum(["RADIUS", "NEIGHBORHOOD", "MUNICIPALITY", "CUSTOM_POLYGON", "ISOCHRONE"]);
export const marketDevelopmentStageSchema = z.enum(["BREVE_LANCAMENTO", "LANCAMENTO", "EM_OBRAS", "PRONTO_NOVO", "PRONTO_USADO"]);
export const marketProductStandardSchema = z.enum(["ECONOMICO_MCMV", "MEDIO_BAIXO", "MEDIO", "MEDIO_ALTO", "ALTO", "LUXO"]);
export const marketPriceTypeSchema = z.enum(["LIST_PRICE", "ADVERTISED", "NEGOTIATED", "TRANSACTED_REGISTRY", "REDE_ACTUAL_SALE"]);

export const provenanceSchema = z.object({
  sourceProvider: z.string().trim().min(1).max(120),
  sourceUrl: z.string().trim().url().optional(),
  collectedAt: z.string().min(1),
  referenceDate: z.string().min(1),
  // "DEMO_SYNTHETIC" marca explicitamente dado sintético de demonstração — nunca deve ser
  // confundido com "API"/"STRUCTURED_IMPORT" (que implicam coleta real via conector 9H).
  collectionMethod: z.enum(["API", "STRUCTURED_IMPORT", "MANUAL_FIELD_SURVEY", "INFERRED_MODEL", "DEMO_SYNTHETIC"]),
  confidenceLevel: z.enum(["HIGH", "MEDIUM", "LOW"]),
  // "INTERNAL_DEMO_DATA" marca licenciamento coerente com dado fabricado para demonstração —
  // nunca "PUBLIC_DOMAIN" (que implicaria uma fonte pública real como o IBGE).
  dataLicense: z.enum(["PUBLIC_DOMAIN", "COMMERCIAL_INTERNAL_USE", "PROPRIETARY", "INTERNAL_DEMO_DATA"]),
  // Vazio é aceito: os serviços de ingestão calculam o checksum determinístico do payload quando o
  // chamador não fornece um (plano 9J, seção R — evidenceChecksum sempre existe no registro final).
  evidenceChecksum: z.string().default(""),
  isDemo: z.boolean().default(false),
});

export const createMarketAreaSchema = z.object({
  name: z.string().trim().min(3).max(160),
  type: marketAreaTypeSchema.default("RADIUS"),
  landAssetId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  centerLatitude: z.number().min(-90).max(90),
  centerLongitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(100).max(50_000).optional(),
  neighborhood: z.string().trim().max(160).optional(),
  city: z.string().trim().min(1).max(160),
  state: z.string().trim().length(2),
});
export type CreateMarketAreaInput = z.input<typeof createMarketAreaSchema>;

export const ingestDemographicObservationSchema = z.object({
  marketAreaId: z.string().min(1),
  referenceYear: z.number().int().min(1990).max(2100),
  totalPopulation: z.number().int().min(0),
  projectedPopulation: z.number().int().min(0).optional(),
  annualGrowthRate: z.number().min(-0.5).max(0.5).optional(),
  totalHouseholds: z.number().int().min(0),
  personsPerHousehold: z.number().min(0.5).max(10),
  urbanizationRate: z.number().min(0).max(1).optional(),
  ageDistribution: z.record(z.string(), z.number()),
  householdComposition: z.record(z.string(), z.number()),
  educationLevels: z.record(z.string(), z.number()).optional(),
  provenance: provenanceSchema,
});
export type IngestDemographicObservationInput = z.input<typeof ingestDemographicObservationSchema>;

export const ingestIncomeObservationSchema = z.object({
  marketAreaId: z.string().min(1),
  referenceYear: z.number().int().min(1990).max(2100),
  averageHouseholdIncome: z.number().min(0),
  medianHouseholdIncome: z.number().min(0),
  perCapitaIncome: z.number().min(0).optional(),
  totalIncomeMassMonthly: z.number().min(0).optional(),
  incomeBracketDistribution: z.record(z.string(), z.number()),
  provenance: provenanceSchema,
});
export type IngestIncomeObservationInput = z.input<typeof ingestIncomeObservationSchema>;

export const ingestMarketDevelopmentSchema = z.object({
  marketAreaId: z.string().min(1),
  name: z.string().trim().min(2).max(200),
  developerName: z.string().trim().max(200).optional(),
  builderName: z.string().trim().max(200).optional(),
  address: z.string().trim().min(3).max(300),
  neighborhood: z.string().trim().min(1).max(160),
  city: z.string().trim().min(1).max(160),
  state: z.string().trim().length(2),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  stage: marketDevelopmentStageSchema.default("LANCAMENTO"),
  standard: marketProductStandardSchema.default("MEDIO"),
  launchDate: z.string().optional(),
  expectedDeliveryDate: z.string().optional(),
  totalTowers: z.number().int().min(1).max(100).default(1),
  totalFloors: z.number().int().min(1).max(200).optional(),
  totalUnits: z.number().int().min(1).max(20_000),
  amenities: z.array(z.string()).optional(),
  provenance: provenanceSchema,
});
export type IngestMarketDevelopmentInput = z.input<typeof ingestMarketDevelopmentSchema>;

export const ingestMarketPriceObservationSchema = z.object({
  developmentId: z.string().min(1),
  typologyDescription: z.string().trim().min(1).max(160),
  bedrooms: z.number().int().min(0).max(10),
  suites: z.number().int().min(0).max(10).default(0),
  bathrooms: z.number().int().min(1).max(10).default(1),
  parkingSpaces: z.number().int().min(0).max(10).default(1),
  privateAreaM2: z.number().min(10).max(2000),
  totalPrice: z.number().min(1),
  priceType: marketPriceTypeSchema.default("LIST_PRICE"),
  discountRate: z.number().min(0).max(1).optional(),
  observedAt: z.string().min(1),
  provenance: provenanceSchema,
});
export type IngestMarketPriceObservationInput = z.input<typeof ingestMarketPriceObservationSchema>;

export const ingestMarketInventorySnapshotSchema = z.object({
  developmentId: z.string().min(1),
  asOfDate: z.string().min(1),
  totalUnits: z.number().int().min(0),
  availableUnits: z.number().int().min(0),
  soldUnits: z.number().int().min(0),
  reservedUnits: z.number().int().min(0).default(0),
  provenance: provenanceSchema,
});
export type IngestMarketInventorySnapshotInput = z.input<typeof ingestMarketInventorySnapshotSchema>;

export const generateProductScenariosSchema = z.object({
  marketAreaId: z.string().min(1),
  landAssetId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  landStudyId: z.string().min(1).optional(),
  standard: marketProductStandardSchema.default("MEDIO"),
});
export type GenerateProductScenariosInput = z.input<typeof generateProductScenariosSchema>;

export const decideProductScenarioSchema = z.object({
  scenarioId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  decisionRationale: z.string().trim().min(8).max(2000),
  finalOverrides: z.object({
    totalUnits: z.number().int().min(1).optional(),
    averageUnitAreaM2: z.number().min(10).optional(),
    averageTicket: z.number().min(1).optional(),
  }).optional(),
});
export type DecideProductScenarioInput = z.input<typeof decideProductScenarioSchema>;
