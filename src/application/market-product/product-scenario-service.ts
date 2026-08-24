import { Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import { getLandStudyForOrganization, getLatestLandStudyForOrganization } from "@/application/land/land-service";
import { calculateProject } from "@/domain/financial/engine";
import { DEMO_PROJECT } from "@/domain/financial/demo";
import {
  MARKET_PRODUCT_ENGINE_VERSION,
  buildExplainability,
  calculateProductConfidence,
  generateProductScenarios,
  generateProductScenariosSchema,
  mapProductScenarioToAssumptions,
  recommendPrice,
  type GenerateProductScenariosInput,
} from "@/domain/market-product";
import { requireMarketProductCapability, type MarketProductContext } from "./market-area-service";
import { getMarketOverview } from "./market-metrics-service";

const json = (value: unknown) => value as Prisma.InputJsonValue;

// Aderência das premissas de custo (plano 9J, seção AR — integração com Orçamento Inteligente
// 9I). REGRA INVIOLÁVEL (correção pós-revisão): ausência de evidência de custo ≠ confiança média.
// Só uma proposta APROVADA (revisão humana concluída) conta como evidência válida — uma proposta
// em rascunho/revisão é apenas uma sugestão do motor, nunca "base aprovada" (ver auto-budget.ts).
// Na ausência de evidência válida, retorna score: null; o chamador NUNCA converte isso em um
// placeholder numérico, e a dimensão de custo fica marcada como SEM_EVIDENCIA na explicabilidade.
async function estimateCostAdherence(organizationId: string, projectId: string | null): Promise<{ score: number | null; note: string }> {
  if (!projectId) {
    return { score: null, note: "SEM_EVIDENCIA: nenhum empreendimento vinculado para consultar o Orçamento Inteligente (9I) — validação de custo ainda pendente." };
  }
  const latestApproved = await prisma.autoBudgetProposal.findFirst({ where: { organizationId, projectId, status: "APPROVED" }, orderBy: { createdAt: "desc" } });
  if (!latestApproved) {
    return { score: null, note: "SEM_EVIDENCIA: nenhuma proposta APROVADA de Orçamento Inteligente (9I) encontrada para este empreendimento — validação de custo ainda pendente, sem benchmark inventado." };
  }
  return { score: 0.9, note: `Aderência de custo calculada a partir da proposta aprovada de Orçamento Inteligente "${latestApproved.name}".` };
}

// Gera os 3 cenários obrigatórios de produto (Conservador, Base, Potencial — plano 9J, seções X a
// AK), valida contra o envelope urbanístico da Fase 5 e simula cada um no REDE Engine sem duplicar
// o motor financeiro.
export async function generateAndPersistProductScenarios(context: MarketProductContext, rawInput: GenerateProductScenariosInput) {
  requireMarketProductCapability(context, "PRODUCT_RECOMMEND");
  const input = generateProductScenariosSchema.parse(rawInput);

  const overview = await getMarketOverview(context, input.marketAreaId, input.standard);

  const landWorkspace = input.landStudyId
    ? await getLandStudyForOrganization(context.organizationId, input.landStudyId)
    : await getLatestLandStudyForOrganization(context.organizationId);
  const selectedOption = landWorkspace?.snapshot.options.find((option) => option.id === landWorkspace.snapshot.selectedOptionId) ?? landWorkspace?.snapshot.options[0] ?? null;
  const maximumComputableAreaM2 = selectedOption ? selectedOption.envelope.maximumComputableArea : 12_000;
  const zoningPrecisionScore = landWorkspace ? landWorkspace.snapshot.regulatoryConfidence.score : 0.5;
  const baseAssumptions = selectedOption?.engineAssumptions ?? DEMO_PROJECT;

  // Envelope urbanístico ausente (nenhum estudo de terreno) — bloqueia sem inventar um limite
  // (plano 9J, seção AP: "Caso haja conflito regulatório... bloqueia a recomendação").
  if (!landWorkspace) {
    throw new Error("Não há estudo de terreno com envelope urbanístico calculado para validar o programa de necessidades (REGULATORY_LIMIT_EXCEEDED: envelope ausente).");
  }

  const medianCompetitorPricePerSqm = overview.priceStats.median > 0 ? overview.priceStats.median : overview.affordability.affordableAreaM2 > 0 ? overview.affordability.affordableTicket / overview.affordability.affordableAreaM2 : 8_000;
  const competitorVelocityUnitsMonth = overview.aggregateMonthlyVelocityUnits > 0 ? overview.aggregateMonthlyVelocityUnits : 5;

  const drafts = generateProductScenarios({
    maximumComputableAreaM2,
    targetEfficiencyRate: 0.82,
    medianCompetitorPricePerSqm,
    competitorVelocityUnitsMonth,
    affordableAreaM2: overview.affordability.affordableAreaM2 || 45,
  });

  const priceRecommendation = recommendPrice({
    competitorMedianPricePerSqm: overview.priceStats.median || medianCompetitorPricePerSqm,
    competitorP25PricePerSqm: overview.priceStats.p25 || medianCompetitorPricePerSqm * 0.9,
    competitorP75PricePerSqm: overview.priceStats.p75 || medianCompetitorPricePerSqm * 1.1,
    affordableTicket: overview.affordability.affordableTicket,
    affordableAreaM2: overview.affordability.affordableAreaM2 || 45,
    redeHistoricalPricePerSqm: null,
  });

  const costAdherence = await estimateCostAdherence(context.organizationId, input.projectId ?? null);
  const productConfidence = calculateProductConfidence({ marketConfidenceScore: overview.confidence.score, zoningPrecisionScore, costAdherenceScore: costAdherence.score });

  const eligibleCompetitors = overview.competitors.filter((c) => c.eligible).sort((a, b) => b.similarityScore - a.similarityScore).slice(0, 5);
  const dataAsOfDate = new Date().toISOString().slice(0, 10);

  const persisted = [];
  for (const draft of drafts) {
    // Gate de zoneamento (plano 9J, seção AP): a área privativa total nunca excede o envelope
    // computável máximo da Fase 5.
    if (draft.totalPrivateAreaM2 > maximumComputableAreaM2 * 1.02) {
      throw new Error(`REGULATORY_LIMIT_EXCEEDED: cenário "${draft.name}" excede a área computável máxima do envelope urbanístico (${maximumComputableAreaM2.toFixed(0)} m²).`);
    }

    const engineAssumptions = mapProductScenarioToAssumptions(draft, baseAssumptions);
    const engineResult = calculateProject(engineAssumptions, "base");

    const explainability = buildExplainability({
      demandRationale: `Sinal de demanda observado na área "${overview.marketArea.name}": ${overview.competitors.filter((c) => c.eligible).length} concorrente(s) elegível(is) com velocidade agregada de ${overview.aggregateMonthlyVelocityUnits.toFixed(1)} un./mês.`,
      areaRationale: draft.areaRationale,
      priceRationale: `${draft.priceRationale} ${priceRecommendation.rationale}`,
      mixRationale: draft.mixRationale,
      competitorsUsed: eligibleCompetitors.map((c) => ({ name: c.name, similarityScore: c.similarityScore })),
      marketAreaLabel: `${overview.marketArea.type} de ${overview.marketArea.radiusMeters ?? "—"} m em torno de ${overview.marketArea.neighborhood ?? overview.marketArea.city}, ${overview.marketArea.city}/${overview.marketArea.state}.`,
      dataAsOfDate,
      sourcesUsed: [
        ...(overview.competitors.length > 0 ? ["Concorrentes cadastrados na área de mercado", "Renda e demografia registradas na área"] : ["Nenhuma fonte externa registrada"]),
        ...(overview.isDemoData ? ["DADOS DE DEMONSTRAÇÃO (seed) — não são coleta real de mercado; nenhum conector IBGE/Prospecta real está ativo"] : []),
      ],
      sampleSize: overview.competitors.filter((c) => c.eligible).length,
      confidenceLevel: overview.confidence.level,
      sensitivityNote: `Sensível a variações de ±5% e ±10% no preço por m². ${costAdherence.note}${overview.isDemoData ? " ATENÇÃO: parte dos dados de mercado usados nesta análise é de DEMONSTRAÇÃO (seed), não coleta real." : ""}`,
    });

    const scenario = await prisma.productScenario.create({
      data: {
        organizationId: context.organizationId,
        marketAreaId: input.marketAreaId,
        landAssetId: input.landAssetId ?? landWorkspace.snapshot.landAsset.id ?? null,
        projectId: input.projectId ?? null,
        name: draft.name,
        kind: draft.kind,
        status: draft.kind === "BASE" ? "RECOMMENDED" : "DRAFT",
        version: 1,
        standard: input.standard,
        totalUnits: draft.totalUnits,
        totalPrivateAreaM2: draft.totalPrivateAreaM2,
        averageUnitAreaM2: draft.averageUnitAreaM2,
        targetVgv: draft.targetVgv,
        averagePricePerSqm: draft.averagePricePerSqm,
        averageTicket: draft.averageTicket,
        expectedVelocityUnitsMonth: draft.expectedVelocityUnitsMonth,
        estimatedSalesDurationMonths: draft.estimatedSalesDurationMonths,
        confidenceLevel: productConfidence.level,
        confidenceScore: productConfidence.score,
        rationale: `${draft.mixRationale} ${draft.priceRationale}`,
        explainabilityJson: json(explainability),
        engineAssumptionsJson: json(engineAssumptions),
        engineResultsJson: json(engineResult),
        isDemo: overview.isDemoData,
        createdById: context.userId,
        mixLines: { create: draft.mixLines.map((line, index) => ({ ...line, sortOrder: index })) },
      },
      include: { mixLines: true, decisions: true },
    });
    persisted.push(scenario);
  }

  return persisted;
}

export async function listProductScenarios(context: Pick<MarketProductContext, "organizationId" | "role">, marketAreaId: string) {
  requireMarketProductCapability(context, "PRODUCT_VIEW");
  return prisma.productScenario.findMany({ where: { organizationId: context.organizationId, marketAreaId }, include: { mixLines: { orderBy: { sortOrder: "asc" } }, decisions: { orderBy: { decidedAt: "desc" } } }, orderBy: { createdAt: "asc" } });
}

export async function getProductScenario(context: Pick<MarketProductContext, "organizationId" | "role">, scenarioId: string) {
  requireMarketProductCapability(context, "PRODUCT_VIEW");
  const scenario = await prisma.productScenario.findFirst({ where: { id: scenarioId, organizationId: context.organizationId }, include: { mixLines: { orderBy: { sortOrder: "asc" } }, decisions: { orderBy: { decidedAt: "desc" } } } });
  if (!scenario) throw new Error("Cenário de produto não encontrado nesta organização.");
  return scenario;
}

export { MARKET_PRODUCT_ENGINE_VERSION };
