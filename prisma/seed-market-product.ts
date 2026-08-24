import { MembershipRole, type PrismaClient } from "@prisma/client";
import {
  decideProductScenario,
  generateAndPersistProductScenarios,
  getOrCreateDefaultMarketArea,
  ingestDemographicObservation,
  ingestIncomeObservation,
  ingestMarketDevelopment,
  ingestMarketInventorySnapshot,
  ingestMarketPriceObservation,
  listProductScenarios,
} from "../src/application/market-product";
import type { MarketDevelopmentStage, MarketProductStandard } from "../src/domain/market-product";

// Demonstração START BUTANTÃ (plano 9J, seção BF) — aditivo e idempotente: reaproveita a área de
// mercado, os concorrentes e os cenários já existentes em execuções repetidas do seed, nunca
// duplica linhas históricas de preço/estoque.

type SeedMarketProductInput = {
  organizationId: string;
  userId: string;
  projectId: string;
  landAssetId: string;
  landStudyId: string;
};

// Nenhum conector real 9H para IBGE/Prospecta/portais de mercado existe ainda (fora do escopo da
// 9J). Todo dado externo deste seed é sintético, formulado para fins de demonstração — nunca uma
// coleta real. `collectionMethod: "DEMO_SYNTHETIC"`, `dataLicense: "INTERNAL_DEMO_DATA"` e
// `isDemo: true` tornam essa origem inequívoca em toda a cadeia (provenance JSON, colunas isDemo
// em MarketArea/MarketDevelopment/ProductScenario, UI e ferramentas da REDE AI).
const DEMO_PROVENANCE_BASE = {
  collectedAt: "2026-08-01T00:00:00.000Z",
  collectionMethod: "DEMO_SYNTHETIC" as const,
  confidenceLevel: "HIGH" as const,
  dataLicense: "INTERNAL_DEMO_DATA" as const,
  evidenceChecksum: "",
  isDemo: true,
};

const DEMOGRAPHIC_PROVENANCE = { ...DEMO_PROVENANCE_BASE, sourceProvider: "DEMO_IBGE_REFERENCIA", referenceDate: "2022-08-01" };
const COMPETITOR_PROVENANCE = { ...DEMO_PROVENANCE_BASE, sourceProvider: "DEMO_PROSPECTA_REFERENCIA", referenceDate: "2026-08-01" };

interface CompetitorSeed {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  stage: MarketDevelopmentStage;
  standard: MarketProductStandard;
  totalUnits: number;
  launchDate: string;
  priceObservations: { typologyDescription: string; bedrooms: number; privateAreaM2: number; totalPrice: number }[];
  inventory: { asOfDate: string; totalUnits: number; availableUnits: number; soldUnits: number }[];
}

// 4 concorrentes demonstrativos na região do Butantã/SP (plano 9J, seção BF) — marcados
// explicitamente como demonstração (isDemo: true) em todas as linhas persistidas.
const COMPETITOR_SEEDS: CompetitorSeed[] = [
  {
    name: "Residencial Vital Brasil", address: "Rua Vital Brasil, 150", latitude: -23.5711, longitude: -46.7114,
    stage: "LANCAMENTO", standard: "MEDIO", totalUnits: 176, launchDate: "2026-03-01",
    priceObservations: [
      { typologyDescription: "2 dormitórios", bedrooms: 2, privateAreaM2: 47, totalPrice: 405_000 },
      { typologyDescription: "3 dormitórios com suíte", bedrooms: 3, privateAreaM2: 68, totalPrice: 585_000 },
    ],
    inventory: [
      { asOfDate: "2026-04-01", totalUnits: 176, availableUnits: 160, soldUnits: 16 },
      { asOfDate: "2026-07-01", totalUnits: 176, availableUnits: 128, soldUnits: 48 },
    ],
  },
  {
    name: "Estilo Butantã", address: "Av. Corifeu de Azevedo Marques, 620", latitude: -23.5722, longitude: -46.7091,
    stage: "EM_OBRAS", standard: "MEDIO", totalUnits: 152, launchDate: "2025-09-01",
    priceObservations: [{ typologyDescription: "2 dormitórios compacto", bedrooms: 2, privateAreaM2: 44, totalPrice: 388_000 }],
    inventory: [
      { asOfDate: "2026-01-01", totalUnits: 152, availableUnits: 120, soldUnits: 32 },
      { asOfDate: "2026-07-01", totalUnits: 152, availableUnits: 74, soldUnits: 78 },
    ],
  },
  {
    name: "Vila Universitária", address: "Rua Prof. Lineu Prestes, 910", latitude: -23.5688, longitude: -46.7132,
    stage: "PRONTO_NOVO", standard: "MEDIO_ALTO", totalUnits: 118, launchDate: "2024-11-01",
    priceObservations: [{ typologyDescription: "3 dormitórios plenus", bedrooms: 3, privateAreaM2: 82, totalPrice: 738_000 }],
    inventory: [
      { asOfDate: "2026-02-01", totalUnits: 118, availableUnits: 40, soldUnits: 78 },
      { asOfDate: "2026-07-01", totalUnits: 118, availableUnits: 22, soldUnits: 96 },
    ],
  },
  {
    name: "Plaza Corifeu", address: "Av. Corifeu de Azevedo Marques, 1400", latitude: -23.5735, longitude: -46.7078,
    stage: "BREVE_LANCAMENTO", standard: "MEDIO", totalUnits: 200, launchDate: "2026-11-01",
    priceObservations: [{ typologyDescription: "2 dormitórios com suíte", bedrooms: 2, privateAreaM2: 55, totalPrice: 486_000 }],
    inventory: [],
  },
];

export async function seedMarketProductDemo(prisma: PrismaClient, input: SeedMarketProductInput) {
  const context = { organizationId: input.organizationId, userId: input.userId, role: MembershipRole.OWNER };

  const marketArea = await getOrCreateDefaultMarketArea(context, {
    name: "Área de Influência — START BUTANTÃ (raio de 3 km)",
    type: "RADIUS",
    landAssetId: input.landAssetId,
    projectId: input.projectId,
    centerLatitude: -23.5705,
    centerLongitude: -46.7108,
    radiusMeters: 3_000,
    neighborhood: "Butantã",
    city: "São Paulo",
    state: "SP",
  }, { isDemo: true });

  await ingestDemographicObservation(context, {
    marketAreaId: marketArea.id,
    referenceYear: 2022,
    totalPopulation: 428_217,
    projectedPopulation: 441_500,
    annualGrowthRate: 0.006,
    totalHouseholds: 168_430,
    personsPerHousehold: 2.54,
    urbanizationRate: 0.99,
    ageDistribution: { "0-14": 0.15, "15-24": 0.15, "25-39": 0.27, "40-59": 0.26, "60+": 0.17 },
    householdComposition: { casalComFilhos: 0.31, casalSemFilhos: 0.23, monoparental: 0.17, unipessoal: 0.21, outros: 0.08 },
    educationLevels: { fundamental: 0.12, medio: 0.33, superior: 0.42, posGraduacao: 0.13 },
    provenance: DEMOGRAPHIC_PROVENANCE,
  }, true);

  await ingestIncomeObservation(context, {
    marketAreaId: marketArea.id,
    referenceYear: 2022,
    averageHouseholdIncome: 11_850,
    medianHouseholdIncome: 8_400,
    perCapitaIncome: 4_150,
    totalIncomeMassMonthly: 1_995_000_000,
    incomeBracketDistribution: { "ate2SM": 0.09, "2a4SM": 0.19, "4a6SM": 0.21, "6a10SM": 0.23, "10a20SM": 0.19, "acima20SM": 0.09 },
    provenance: DEMOGRAPHIC_PROVENANCE,
  }, true);

  for (const competitor of COMPETITOR_SEEDS) {
    const { development, wasCanonicalMatch } = await ingestMarketDevelopment(context, {
      marketAreaId: marketArea.id,
      name: competitor.name,
      address: competitor.address,
      neighborhood: "Butantã",
      city: "São Paulo",
      state: "SP",
      latitude: competitor.latitude,
      longitude: competitor.longitude,
      stage: competitor.stage,
      standard: competitor.standard,
      totalUnits: competitor.totalUnits,
      launchDate: competitor.launchDate,
      totalTowers: 1,
      provenance: COMPETITOR_PROVENANCE,
    }, true);

    // Só ingere preço/estoque na primeira criação — reexecuções do seed reaproveitam o
    // concorrente canônico e nunca duplicam observações históricas.
    if (!wasCanonicalMatch) {
      for (const price of competitor.priceObservations) {
        await ingestMarketPriceObservation(context, { developmentId: development.id, ...price, observedAt: "2026-08-01", provenance: COMPETITOR_PROVENANCE }, true);
      }
      for (const snapshot of competitor.inventory) {
        await ingestMarketInventorySnapshot(context, { developmentId: development.id, ...snapshot, provenance: { ...COMPETITOR_PROVENANCE, referenceDate: snapshot.asOfDate } }, true);
      }
    }
  }

  let scenarios = await listProductScenarios(context, marketArea.id);
  if (scenarios.length === 0) {
    scenarios = await generateAndPersistProductScenarios(context, {
      marketAreaId: marketArea.id,
      landAssetId: input.landAssetId,
      projectId: input.projectId,
      landStudyId: input.landStudyId,
      standard: "MEDIO",
    });
  }

  const baseScenario = scenarios.find((scenario) => scenario.kind === "BASE");
  let baseScenarioStatus = baseScenario?.status ?? "DRAFT";
  if (baseScenario && ["DRAFT", "UNDER_REVIEW", "RECOMMENDED"].includes(baseScenario.status)) {
    const decision = await decideProductScenario(context, {
      scenarioId: baseScenario.id,
      decision: "APPROVED",
      decisionRationale: "Cenário Base aprovado para a demonstração START BUTANTÃ: melhor equilíbrio entre margem, velocidade de vendas e exposição de caixa entre os 3 cenários analisados pelo comitê de teste.",
    });
    baseScenarioStatus = decision.decision;
  }

  return {
    marketAreaId: marketArea.id,
    competitorsCount: COMPETITOR_SEEDS.length,
    scenariosCount: scenarios.length,
    baseScenarioStatus,
  };
}
