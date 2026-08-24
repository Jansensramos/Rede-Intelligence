import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hash } from "bcryptjs";
import { MembershipRole } from "@prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import { createDemoLandStudy } from "@/application/land/land-service";
import {
  decideProductScenario,
  generateAndPersistProductScenarios,
  getMarketOverview,
  getOrCreateDefaultMarketArea,
  ingestDemographicObservation,
  ingestIncomeObservation,
  ingestMarketDevelopment,
  ingestMarketInventorySnapshot,
  ingestMarketPriceObservation,
  listProductScenarios,
} from "./index";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function makeOrgWithRole(role: MembershipRole, tag: string) {
  const passwordHash = await hash("MarketProduct@Test1", 4);
  const user = await prisma.user.create({ data: { email: `mp-${tag}-${suffix}@test.local`, name: `MP ${tag} Tester`, passwordHash } });
  const organization = await prisma.organization.create({ data: { name: `MP Org ${tag} ${suffix}`, slug: `mp-org-${tag}-${suffix}` } });
  await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id, role } });
  return { organizationId: organization.id, userId: user.id, role };
}

let owner: { organizationId: string; userId: string; role: MembershipRole };
let analyst: { organizationId: string; userId: string; role: MembershipRole };
let reviewer: { organizationId: string; userId: string; role: MembershipRole };
let otherOrgOwner: { organizationId: string; userId: string; role: MembershipRole };

beforeAll(async () => {
  owner = await makeOrgWithRole(MembershipRole.OWNER, "owner");
  otherOrgOwner = await makeOrgWithRole(MembershipRole.OWNER, "other");
  // ANALYST e REVIEWER pertencem à MESMA organização do OWNER, para testar segregação de papéis
  // dentro do mesmo tenant (plano 9J, seção AW).
  const analystPasswordHash = await hash("MarketProduct@Test1", 4);
  const analystUser = await prisma.user.create({ data: { email: `mp-analyst-${suffix}@test.local`, name: "MP Analyst Tester", passwordHash: analystPasswordHash } });
  await prisma.organizationMembership.create({ data: { organizationId: owner.organizationId, userId: analystUser.id, role: MembershipRole.ANALYST } });
  analyst = { organizationId: owner.organizationId, userId: analystUser.id, role: MembershipRole.ANALYST };

  const reviewerPasswordHash = await hash("MarketProduct@Test1", 4);
  const reviewerUser = await prisma.user.create({ data: { email: `mp-reviewer-${suffix}@test.local`, name: "MP Reviewer Tester", passwordHash: reviewerPasswordHash } });
  await prisma.organizationMembership.create({ data: { organizationId: owner.organizationId, userId: reviewerUser.id, role: MembershipRole.REVIEWER } });
  reviewer = { organizationId: owner.organizationId, userId: reviewerUser.id, role: MembershipRole.REVIEWER };
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe.sequential("Fase 9J — Inteligência de Mercado e de Produto contra PostgreSQL real", () => {
  let landAssetId = "";
  let landStudyId = "";
  let marketAreaId = "";
  let firstDevelopmentId = "";

  it("cria a área de mercado ancorada ao terreno e ingere demografia e renda", async () => {
    const landStudy = await createDemoLandStudy({ organizationId: owner.organizationId, userId: owner.userId });
    landStudyId = landStudy.landStudyId;
    landAssetId = landStudy.snapshot.landAsset.id;

    const marketArea = await getOrCreateDefaultMarketArea(owner, {
      name: "Área de Influência — START BUTANTÃ (teste)",
      type: "RADIUS",
      landAssetId,
      centerLatitude: -23.5705,
      centerLongitude: -46.7108,
      radiusMeters: 3_000,
      neighborhood: "Butantã",
      city: "São Paulo",
      state: "SP",
    });
    marketAreaId = marketArea.id;
    expect(marketArea.isDefault).toBe(true);

    const nowIso = new Date().toISOString();
    const provenance = { sourceProvider: "IBGE_CENSO", collectedAt: nowIso, referenceDate: "2022-01-01", collectionMethod: "STRUCTURED_IMPORT" as const, confidenceLevel: "HIGH" as const, dataLicense: "PUBLIC_DOMAIN" as const, evidenceChecksum: "" };

    await ingestDemographicObservation(owner, {
      marketAreaId, referenceYear: 2022, totalPopulation: 420_000, totalHouseholds: 165_000, personsPerHousehold: 2.55,
      ageDistribution: { "0-14": 0.16, "15-24": 0.14, "25-39": 0.26, "40-59": 0.27, "60+": 0.17 },
      householdComposition: { casalComFilhos: 0.32, casalSemFilhos: 0.22, monoparental: 0.18, unipessoal: 0.2, outros: 0.08 },
      provenance,
    });
    await ingestIncomeObservation(owner, {
      marketAreaId, referenceYear: 2022, averageHouseholdIncome: 12_500, medianHouseholdIncome: 9_800,
      incomeBracketDistribution: { "ate2SM": 0.08, "2a4SM": 0.18, "4a6SM": 0.2, "6a10SM": 0.24, "10a20SM": 0.2, "acima20SM": 0.1 },
      provenance,
    });

    const overview = await getMarketOverview(owner, marketAreaId);
    expect(overview.income?.medianHouseholdIncome ? Number(overview.income.medianHouseholdIncome) : 0).toBe(9_800);
    expect(overview.affordability.affordableTicket).toBeGreaterThan(0);
  }, 30_000);

  it("amostra com menos de 3 concorrentes elegíveis nunca produz confiança ALTA (regra inviolável)", async () => {
    const nowIso = new Date().toISOString();
    const provenance = { sourceProvider: "PROSPECTA", collectedAt: nowIso, referenceDate: nowIso.slice(0, 10), collectionMethod: "API" as const, confidenceLevel: "HIGH" as const, dataLicense: "COMMERCIAL_INTERNAL_USE" as const, evidenceChecksum: "" };

    const first = await ingestMarketDevelopment(owner, {
      marketAreaId, name: "Residencial Vital Brasil", address: "Rua Vital Brasil, 100", neighborhood: "Butantã", city: "São Paulo", state: "SP",
      latitude: -23.5710, longitude: -46.7112, stage: "LANCAMENTO", standard: "MEDIO", totalUnits: 180, provenance,
    });
    firstDevelopmentId = first.development.id;
    expect(first.wasCanonicalMatch).toBe(false);

    await ingestMarketPriceObservation(owner, { developmentId: firstDevelopmentId, typologyDescription: "2 dorms", bedrooms: 2, privateAreaM2: 48, totalPrice: 420_000, observedAt: nowIso.slice(0, 10), provenance });

    const overview = await getMarketOverview(owner, marketAreaId);
    expect(overview.competitors.filter((c) => c.eligible).length).toBeLessThan(3);
    expect(overview.confidence.level).not.toBe("HIGH");
  }, 30_000);

  it("deduplica canonicamente um concorrente enviado por uma segunda fonte sem perder proveniência", async () => {
    const beforeCount = await prisma.marketDevelopment.count({ where: { organizationId: owner.organizationId, marketAreaId } });

    const provenanceSecondSource = { sourceProvider: "PORTAL_ZAP_SAMPLE", collectedAt: new Date().toISOString(), referenceDate: new Date().toISOString().slice(0, 10), collectionMethod: "API" as const, confidenceLevel: "MEDIUM" as const, dataLicense: "COMMERCIAL_INTERNAL_USE" as const, evidenceChecksum: "" };
    const duplicate = await ingestMarketDevelopment(owner, {
      marketAreaId, name: "Residencial Vital Brasil", address: "Rua Vital Brasil, 100", neighborhood: "Butantã", city: "São Paulo", state: "SP",
      latitude: -23.57101, longitude: -46.71121, // a poucos metros do original — mesmo empreendimento
      stage: "LANCAMENTO", standard: "MEDIO", totalUnits: 180, provenance: provenanceSecondSource,
    });

    expect(duplicate.wasCanonicalMatch).toBe(true);
    expect(duplicate.development.id).toBe(firstDevelopmentId);
    const afterCount = await prisma.marketDevelopment.count({ where: { organizationId: owner.organizationId, marketAreaId } });
    expect(afterCount).toBe(beforeCount); // nenhuma linha duplicada criada
  });

  it("nunca sobrescreve uma observação de estoque histórica já registrada (mesma data e fonte)", async () => {
    const asOfDate = "2026-06-01";
    const provenance = { sourceProvider: "PROSPECTA", collectedAt: new Date().toISOString(), referenceDate: asOfDate, collectionMethod: "API" as const, confidenceLevel: "HIGH" as const, dataLicense: "COMMERCIAL_INTERNAL_USE" as const, evidenceChecksum: "" };
    await ingestMarketInventorySnapshot(owner, { developmentId: firstDevelopmentId, asOfDate, totalUnits: 180, availableUnits: 150, soldUnits: 30, provenance });

    await expect(
      ingestMarketInventorySnapshot(owner, { developmentId: firstDevelopmentId, asOfDate, totalUnits: 180, availableUnits: 100, soldUnits: 80, provenance }),
    ).rejects.toThrow(/nunca é sobrescrito/);

    const historical = await prisma.marketInventorySnapshot.findMany({ where: { organizationId: owner.organizationId, developmentId: firstDevelopmentId } });
    expect(historical).toHaveLength(1);
    expect(historical[0].soldUnits).toBe(30); // o registro original permanece intacto
  });

  it("isola dados de mercado entre organizações distintas (multi-tenancy)", async () => {
    await expect(getMarketOverview(otherOrgOwner, marketAreaId)).rejects.toThrow();
    const crossTenantDevelopments = await prisma.marketDevelopment.findMany({ where: { organizationId: otherOrgOwner.organizationId, marketAreaId } });
    expect(crossTenantDevelopments).toHaveLength(0);
  });

  it("gera os 3 cenários obrigatórios de produto, respeita o envelope urbanístico e simula cada um no REDE Engine (ponta a ponta: Terreno → Mercado → Produto → Engine)", async () => {
    // Garante amostra suficiente para uma simulação de mercado mais robusta antes de gerar produto.
    const provenance = { sourceProvider: "PROSPECTA", collectedAt: new Date().toISOString(), referenceDate: new Date().toISOString().slice(0, 10), collectionMethod: "API" as const, confidenceLevel: "HIGH" as const, dataLicense: "COMMERCIAL_INTERNAL_USE" as const, evidenceChecksum: "" };
    const second = await ingestMarketDevelopment(owner, { marketAreaId, name: "Estilo Butantã", address: "Av. Corifeu de Azevedo Marques, 500", neighborhood: "Butantã", city: "São Paulo", state: "SP", latitude: -23.5720, longitude: -46.7095, stage: "EM_OBRAS", standard: "MEDIO", totalUnits: 140, provenance });
    const third = await ingestMarketDevelopment(owner, { marketAreaId, name: "Vila Universitária", address: "Rua Prof. Lineu Prestes, 800", neighborhood: "Butantã", city: "São Paulo", state: "SP", latitude: -23.5690, longitude: -46.7130, stage: "PRONTO_NOVO", standard: "MEDIO_ALTO", totalUnits: 120, provenance });
    await ingestMarketPriceObservation(owner, { developmentId: second.development.id, typologyDescription: "2 dorms", bedrooms: 2, privateAreaM2: 50, totalPrice: 445_000, observedAt: provenance.referenceDate, provenance });
    await ingestMarketPriceObservation(owner, { developmentId: third.development.id, typologyDescription: "3 dorms", bedrooms: 3, privateAreaM2: 70, totalPrice: 640_000, observedAt: provenance.referenceDate, provenance });
    await ingestMarketInventorySnapshot(owner, { developmentId: second.development.id, asOfDate: "2026-05-01", totalUnits: 140, availableUnits: 130, soldUnits: 10, provenance });
    await ingestMarketInventorySnapshot(owner, { developmentId: second.development.id, asOfDate: "2026-07-01", totalUnits: 140, availableUnits: 118, soldUnits: 22, provenance });

    const scenarios = await generateAndPersistProductScenarios(owner, { marketAreaId, landAssetId, landStudyId, standard: "MEDIO" });
    expect(scenarios).toHaveLength(3);
    expect(scenarios.map((s) => s.kind).sort()).toEqual(["AGGRESSIVE", "BASE", "CONSERVATIVE"].sort());

    for (const scenario of scenarios) {
      expect(scenario.mixLines.length).toBeGreaterThan(0);
      expect(scenario.engineResultsJson).not.toBeNull();
      const results = scenario.engineResultsJson as unknown as { metrics: { vgv: string; marginOnVgv: string; annualIrr: string | null } };
      expect(Number(results.metrics.vgv)).toBeGreaterThan(0);
      expect(results.metrics.marginOnVgv).toBeDefined();
      // Nenhum projectId foi informado nesta chamada → nenhuma proposta de Orçamento Inteligente
      // (9I) pode existir → a dimensão de custo fica SEM_EVIDENCIA e a confiança nunca é artificial.
      expect(scenario.confidenceLevel).not.toBe("HIGH");
    }

    const persisted = await listProductScenarios(owner, marketAreaId);
    expect(persisted).toHaveLength(3);
  }, 30_000);

  it("segrega RBAC: ANALYST simula mas não aprova; REVIEWER aprova mas não simula", async () => {
    const scenarios = await listProductScenarios(owner, marketAreaId);
    const baseScenario = scenarios.find((s) => s.kind === "BASE");
    expect(baseScenario).toBeDefined();

    // ANALYST consegue gerar/simular novos cenários (PRODUCT_RECOMMEND) mas não pode aprovar.
    await expect(
      decideProductScenario(analyst, { scenarioId: baseScenario!.id, decision: "APPROVED", decisionRationale: "Tentativa indevida do analista." }),
    ).rejects.toThrow(/não possui a capacidade/);

    // REVIEWER não pode gerar/simular novos cenários (falta PRODUCT_RECOMMEND).
    await expect(
      generateAndPersistProductScenarios(reviewer, { marketAreaId, landAssetId, landStudyId, standard: "MEDIO" }),
    ).rejects.toThrow(/não possui a capacidade/);

    // REVIEWER aprova formalmente o cenário Base recomendado (plano 9J, seção AL — máquina de estados).
    const decision = await decideProductScenario(reviewer, { scenarioId: baseScenario!.id, decision: "APPROVED", decisionRationale: "Cenário Base aprovado após revisão do comitê de teste." });
    expect(decision.decision).toBe("APPROVED");
    expect(decision.checksum).toHaveLength(64);

    const updated = await prisma.productScenario.findUniqueOrThrow({ where: { id: baseScenario!.id } });
    expect(updated.status).toBe("APPROVED");

    // Memória da decisão é imutável e consultável (plano 9J, seção AM).
    const records = await prisma.productDecisionRecord.findMany({ where: { organizationId: owner.organizationId, scenarioId: baseScenario!.id } });
    expect(records).toHaveLength(1);
    expect(records[0].decisionRationale).toContain("comitê de teste");
  }, 30_000);
});

// Correção pós-revisão (2026-08-24): (1) AUSÊNCIA DE EVIDÊNCIA DE CUSTO ≠ CONFIANÇA MÉDIA — sem
// proposta APROVADA de Orçamento Inteligente, a dimensão de custo nunca vira um placeholder
// numérico. (2) Dados sintéticos de demonstração nunca podem ser confundidos com fonte externa
// real — organização isolada e dedicada para não interferir nas contagens dos testes acima.
describe.sequential("Fase 9J — correções pós-revisão: confiança sem evidência de custo e marcação de dados demo", () => {
  let demoOrg: { organizationId: string; userId: string; role: MembershipRole };
  let demoLandAssetId = "";
  let demoLandStudyId = "";
  let demoMarketAreaId = "";

  it("prepara terreno e área de mercado isolados para o cenário de teste", async () => {
    demoOrg = await makeOrgWithRole(MembershipRole.OWNER, "demo-flags");
    const landStudy = await createDemoLandStudy({ organizationId: demoOrg.organizationId, userId: demoOrg.userId });
    demoLandStudyId = landStudy.landStudyId;
    demoLandAssetId = landStudy.snapshot.landAsset.id;

    const marketArea = await getOrCreateDefaultMarketArea(demoOrg, {
      name: "Área de teste — marcação demo", type: "RADIUS", landAssetId: demoLandAssetId,
      centerLatitude: -23.5705, centerLongitude: -46.7108, radiusMeters: 3_000,
      neighborhood: "Butantã", city: "São Paulo", state: "SP",
    }, { isDemo: true });
    demoMarketAreaId = marketArea.id;
    expect(marketArea.isDemo).toBe(true);
  }, 30_000);

  it("marca observações sintéticas como DEMONSTRAÇÃO e nunca as confunde com uma fonte externa real", async () => {
    const demoProvenance = {
      sourceProvider: "DEMO_PROSPECTA_REFERENCIA",
      collectedAt: new Date().toISOString(),
      referenceDate: "2026-08-01",
      collectionMethod: "DEMO_SYNTHETIC" as const,
      confidenceLevel: "HIGH" as const,
      dataLicense: "INTERNAL_DEMO_DATA" as const,
      evidenceChecksum: "",
      isDemo: true,
    };

    const { development } = await ingestMarketDevelopment(demoOrg, {
      marketAreaId: demoMarketAreaId, name: "Plaza Corifeu", address: "Av. Corifeu de Azevedo Marques, 1400",
      neighborhood: "Butantã", city: "São Paulo", state: "SP", latitude: -23.5735, longitude: -46.7078,
      stage: "BREVE_LANCAMENTO", standard: "MEDIO", totalUnits: 200, provenance: demoProvenance,
    }, true);

    expect(development.isDemo).toBe(true);
    const storedProvenance = development.provenance as { sourceProvider: string; collectionMethod: string; dataLicense: string; isDemo: boolean };
    expect(storedProvenance.isDemo).toBe(true);
    expect(storedProvenance.collectionMethod).toBe("DEMO_SYNTHETIC");
    expect(storedProvenance.dataLicense).toBe("INTERNAL_DEMO_DATA");
    // Nunca confundido com o nome de uma fonte pública/comercial real — a prova central deste teste.
    expect(storedProvenance.sourceProvider).not.toBe("PROSPECTA");
    expect(storedProvenance.sourceProvider).not.toBe("IBGE_CENSO");
    expect(storedProvenance.sourceProvider.startsWith("DEMO_")).toBe(true);

    const overview = await getMarketOverview(demoOrg, demoMarketAreaId);
    expect(overview.isDemoData).toBe(true);
    const competitorView = overview.competitors.find((c) => c.id === development.id);
    expect(competitorView?.isDemo).toBe(true);
  });

  it("sem proposta aprovada de Orçamento Inteligente, a REDE nunca retorna confiança Alta por artifício — dimensão de custo fica SEM_EVIDENCIA", async () => {
    // Nenhum AutoBudgetProposal existe para esta organização (nenhum projectId é informado):
    // caminho SEM_EVIDENCIA obrigatório.
    const scenarios = await generateAndPersistProductScenarios(demoOrg, {
      marketAreaId: demoMarketAreaId, landAssetId: demoLandAssetId, landStudyId: demoLandStudyId, standard: "MEDIO",
    });
    expect(scenarios).toHaveLength(3);
    for (const scenario of scenarios) {
      expect(scenario.confidenceLevel).not.toBe("HIGH");
      // O cenário herda a marcação de demonstração da amostra de mercado usada para simulá-lo —
      // nunca pode ser apresentado como uma recomendação baseada em coleta real.
      expect(scenario.isDemo).toBe(true);
      const explainability = scenario.explainabilityJson as { question: string; answer: string }[];
      const confidenceAnswer = explainability.find((item) => item.question.includes("nível de confiança"));
      expect(confidenceAnswer?.answer).toContain("SEM_EVIDENCIA");
      expect(confidenceAnswer?.answer).toMatch(/pendente/);
    }
  }, 30_000);
});
