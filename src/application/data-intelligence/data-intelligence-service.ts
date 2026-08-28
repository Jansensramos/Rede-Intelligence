import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { appendSmartBudgetLineReview, approveSmartBudgetProposal, createSmartBudgetProposal, rejectSmartBudgetProposal } from "@/application/engineering/engineering-service";
import {
  DATA_INTELLIGENCE_ENGINE_VERSION,
  assertDataIntelligenceCapability,
  calculateConfidence,
  calculateSimilarity,
  checkEligibility,
  convertUnit,
  detectOutliersIqr,
  detectOutliersMad,
  evaluateForecastAccuracy,
  hasDataIntelligenceCapability,
  suggestUnitCost,
  summarizeBias,
  summarizeDistribution,
  type ComparableContext,
  type DataIntelligenceCapability,
} from "@/domain/data-intelligence";

type DIContext = Pick<AuthContext, "organizationId" | "userId" | "role">;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const checksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function requireCapability(context: Pick<DIContext, "role">, capability: DataIntelligenceCapability) {
  assertDataIntelligenceCapability(context.role, capability);
}

async function assertProjectScope(context: Pick<DIContext, "organizationId">, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: context.organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  return project;
}

// ============================================================================
// A. Analytics Contracts + Metric Registry + Comparability Policy — fundação
// ============================================================================

const DEFAULT_CONTRACTS = [
  {
    key: "custo-orcamento-linha",
    name: "Custo orçado por linha",
    sourceModule: "9A",
    sourceEntities: ["BudgetLineItem"],
    grain: "orçamento + linha",
    dimensions: ["economicItem", "costCenter", "operatingUnit", "unidade"],
    measureDefinition: { measure: "unitCost", aggregation: "LAST" },
    temporality: "estado vigente do orçamento oficial (baseDate)",
  },
  {
    key: "custo-suprimentos-preco",
    name: "Preço de compras e contratos",
    sourceModule: "9C",
    sourceEntities: ["PurchaseOrderItem", "OperationalContractItem"],
    grain: "pedido/contrato + item",
    dimensions: ["economicItem", "fornecedor", "unidade", "estágio"],
    measureDefinition: { measure: "unitPrice", aggregation: "LAST" },
    temporality: "data de emissão do pedido/contrato",
  },
  {
    key: "custo-medicao",
    name: "Custo medido/executado",
    sourceModule: "9C",
    sourceEntities: ["MeasurementLine"],
    grain: "medição + linha + competência",
    dimensions: ["economicItem", "competência"],
    measureDefinition: { measure: "amount / periodQuantity", aggregation: "LAST" },
    temporality: "competência da medição",
  },
  {
    key: "preco-observado-externo",
    name: "Preço observado externo",
    sourceModule: "9H",
    sourceEntities: ["ExternalPriceObservation"],
    grain: "item/especificação + fonte + data",
    dimensions: ["item", "região", "fonte"],
    measureDefinition: { measure: "price + freight + taxes", aggregation: "LAST" },
    temporality: "observedAt",
  },
  {
    key: "previsto-realizado-contrato",
    name: "Previsto x realizado — contrato",
    sourceModule: "9C",
    sourceEntities: ["OperationalContract", "ContractAmendment"],
    grain: "contrato + aditivo aprovado",
    dimensions: ["economicItem", "estágio", "horizonte"],
    measureDefinition: { measure: "originalAmount + amendments.value (APPROVED)", aggregation: "SUM" },
    temporality: "effectiveAt do aditivo mais recente aprovado",
  },
] as const;

export async function ensureAnalyticsContracts(context: DIContext) {
  requireCapability(context, "DATA_CONTRACT_MANAGE");
  const results = [];
  for (const contract of DEFAULT_CONTRACTS) {
    const payload = { grain: contract.grain, dimensions: contract.dimensions, measureDefinition: contract.measureDefinition, sourceEntities: contract.sourceEntities };
    const row = await prisma.analyticsDataContract.upsert({
      where: { organizationId_key_version: { organizationId: context.organizationId, key: contract.key, version: 1 } },
      update: {},
      create: {
        organizationId: context.organizationId,
        key: contract.key,
        version: 1,
        name: contract.name,
        sourceModule: contract.sourceModule,
        sourceEntities: json(contract.sourceEntities),
        grain: contract.grain,
        dimensions: json(contract.dimensions),
        measureDefinition: json(contract.measureDefinition),
        temporality: contract.temporality,
        ownerId: context.userId,
        status: "ACTIVE",
        effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
        checksum: checksum(payload),
        createdById: context.userId,
      },
    });
    results.push(row);
  }
  return results;
}

const DEFAULT_METRICS = [
  {
    key: "custo_unitario_item",
    name: "Custo unitário por item econômico",
    definition: "Valor por unidade de medida de um EconomicItem em um estágio econômico (orçado, contratado, medido ou observado externamente).",
    formula: "amount / quantity, na unidade de medida original do fato",
    unit: "R$/unidade",
    aggregation: "MEDIAN" as const,
    grain: "economicItem + estágio",
    dimensions: ["economicItem", "estágio", "região", "unidade"],
    contractKey: "custo-orcamento-linha",
  },
  {
    key: "desvio_contratual",
    name: "Desvio contratual (aditivos aprovados)",
    definition: "Diferença entre o valor original de um contrato e o valor após aditivos aprovados.",
    formula: "originalAmount_atualizado - originalAmount_inicial",
    unit: "R$",
    aggregation: "SUM" as const,
    grain: "contrato",
    dimensions: ["economicItem", "fornecedor"],
    contractKey: "previsto-realizado-contrato",
  },
  {
    key: "avanco_fisico_medido",
    name: "Avanço físico medido",
    definition: "Percentual físico acumulado informado na medição mais recente de um contrato.",
    formula: "cumulativeQuantity / contractedQuantity",
    unit: "%",
    aggregation: "LAST" as const,
    grain: "contrato + linha",
    dimensions: ["economicItem"],
    contractKey: "custo-medicao",
  },
  {
    key: "margem_bruta_projeto",
    name: "Margem bruta do projeto",
    definition: "Margem sobre VGV calculada pelo motor de viabilidade (REDE Score/Financeiro), sem recálculo pela 9I.",
    formula: "FinancialResult.marginOnVgv (reutilizado, não recalculado)",
    unit: "%",
    aggregation: "LAST" as const,
    grain: "projeto",
    dimensions: ["projeto"],
    contractKey: "custo-orcamento-linha",
  },
  {
    key: "absorcao_comercial",
    name: "Absorção comercial (VSO simplificado)",
    definition: "Proporção de unidades vendidas ou entregues sobre o total de unidades do empreendimento.",
    formula: "count(SalesUnit em VENDIDA/EM_RESERVA/RESERVADA) / count(SalesUnit)",
    unit: "%",
    aggregation: "LAST" as const,
    grain: "projeto",
    dimensions: ["projeto"],
    contractKey: "custo-orcamento-linha",
  },
] as const;

export async function ensureMetricCatalog(context: DIContext) {
  requireCapability(context, "METRIC_MANAGE");
  const contracts = await prisma.analyticsDataContract.findMany({ where: { organizationId: context.organizationId } });
  const results = [];
  for (const metric of DEFAULT_METRICS) {
    const contract = contracts.find((c) => c.key === metric.contractKey);
    const row = await prisma.metricDefinition.upsert({
      where: { organizationId_key_version: { organizationId: context.organizationId, key: metric.key, version: 1 } },
      update: {},
      create: {
        organizationId: context.organizationId,
        contractId: contract?.id ?? null,
        key: metric.key,
        name: metric.name,
        version: 1,
        definition: metric.definition,
        formula: metric.formula,
        engineVersion: DATA_INTELLIGENCE_ENGINE_VERSION,
        unit: metric.unit,
        aggregation: metric.aggregation,
        grain: metric.grain,
        dimensions: json(metric.dimensions),
        ownerId: context.userId,
        status: "ACTIVE",
        effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
        createdById: context.userId,
      },
    });
    results.push(row);
  }
  return results;
}

const DEFAULT_POLICY = {
  key: "default",
  eligibilityRules: { requireSameCurrency: true, requireCompatibleUnit: true, requireSameEconomicStageOrLater: false, maxAgeMonths: 36, allowedRegions: null },
  similarityWeights: { region: 3, economicStage: 2, productStandard: 3, recency: 1 },
  confidenceWeights: { sampleSize: 3, recency: 2, dispersion: 2, similarity: 2, provenance: 1 },
  outlierMethod: "IQR" as const,
  outlierThresholds: { iqrMultiplier: 1.5, madThreshold: 3.5 },
  minimumSampleSize: 3,
};

export async function ensureComparabilityPolicy(context: DIContext) {
  requireCapability(context, "DATA_CONTRACT_MANAGE");
  return prisma.comparabilityPolicy.upsert({
    where: { organizationId_key_version: { organizationId: context.organizationId, key: DEFAULT_POLICY.key, version: 1 } },
    update: {},
    create: {
      organizationId: context.organizationId,
      key: DEFAULT_POLICY.key,
      version: 1,
      name: "Política padrão de comparabilidade",
      eligibilityRules: json(DEFAULT_POLICY.eligibilityRules),
      similarityWeights: json(DEFAULT_POLICY.similarityWeights),
      confidenceWeights: json(DEFAULT_POLICY.confidenceWeights),
      outlierMethod: DEFAULT_POLICY.outlierMethod,
      outlierThresholds: json(DEFAULT_POLICY.outlierThresholds),
      minimumSampleSize: DEFAULT_POLICY.minimumSampleSize,
      status: "ACTIVE",
      createdById: context.userId,
    },
  });
}

// ============================================================================
// B. Refresh — constrói AnalyticsFact a partir dos módulos operacionais (9A/9C/9H)
// ============================================================================

interface FactSeed {
  factType: "COST" | "PROCUREMENT_PRICE" | "MEASUREMENT" | "PRICE_OBSERVATION";
  economicStage: "BUDGETED" | "CONTRACTED" | "MEASURED" | null;
  sourceModule: string;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceVersion: string | null;
  economicItemId: string | null;
  costCenterId: string | null;
  operatingUnitId: string | null;
  eventDate: Date;
  observedAt: Date;
  currency: string;
  amount: number | null;
  quantity: number | null;
  unit: string | null;
  measures: Record<string, unknown>;
  dimensions: Record<string, unknown>;
  provenance: Record<string, unknown>;
}

export async function refreshAnalyticsFacts(context: DIContext, projectId: string) {
  requireCapability(context, "ANALYTICS_REPROCESS");
  const project = await assertProjectScope(context, projectId);
  const contracts = await prisma.analyticsDataContract.findMany({ where: { organizationId: context.organizationId } });
  const contractByKey = new Map(contracts.map((c) => [c.key, c.id]));

  const refreshRun = await prisma.analyticsRefreshRun.create({
    data: { organizationId: context.organizationId, scopeKey: `project:${projectId}`, status: "RUNNING", triggeredById: context.userId },
  });

  try {
    const [budgetLines, purchaseOrderItems, contractItems, measurementLines, priceObservations] = await Promise.all([
      prisma.budgetLineItem.findMany({ where: { budget: { projectId, organizationId: context.organizationId, status: { in: ["OFFICIAL", "APPROVED"] } }, totalCost: { gt: 0 }, economicItemId: { not: null } }, include: { budget: true, economicItem: true } }),
      prisma.purchaseOrderItem.findMany({ where: { purchaseOrder: { projectId, organizationId: context.organizationId } }, include: { purchaseOrder: true, economicItem: true } }),
      prisma.operationalContractItem.findMany({ where: { contract: { projectId, organizationId: context.organizationId } }, include: { contract: { include: { amendments: true } }, economicItem: true } }),
      prisma.measurementLine.findMany({ where: { measurement: { projectId, organizationId: context.organizationId } }, include: { measurement: true, economicItem: true } }),
      prisma.externalPriceObservation.findMany({ where: { organizationId: context.organizationId } }),
    ]);

    const seeds: FactSeed[] = [];

    for (const line of budgetLines) {
      seeds.push({
        factType: "COST", economicStage: "BUDGETED", sourceModule: "9A", sourceEntityType: "BudgetLineItem", sourceEntityId: line.id,
        sourceVersion: String(line.budget.version), economicItemId: line.economicItemId, costCenterId: line.costCenterId, operatingUnitId: line.operatingUnitId,
        eventDate: line.budget.baseDate, observedAt: line.updatedAt, currency: line.budget.currency, amount: Number(line.totalCost), quantity: Number(line.quantity), unit: line.unit,
        measures: { unitCost: Number(line.unitCost), totalCost: Number(line.totalCost), phase: line.phase, category: line.category },
        dimensions: { economicItemCode: line.economicItem?.code ?? null, region: `${project.city}/${project.state}`, economicStage: "BUDGETED", productStandard: "MCMV" },
        provenance: { sourceModule: "9A", budgetId: line.budgetId, budgetStatus: line.budget.status },
      });
    }

    for (const item of purchaseOrderItems) {
      seeds.push({
        factType: "PROCUREMENT_PRICE", economicStage: "CONTRACTED", sourceModule: "9C", sourceEntityType: "PurchaseOrderItem", sourceEntityId: item.id,
        sourceVersion: item.purchaseOrder.status, economicItemId: item.economicItemId, costCenterId: item.costCenterId, operatingUnitId: item.operatingUnitId,
        eventDate: item.purchaseOrder.issuedAt ?? item.purchaseOrder.createdAt, observedAt: item.purchaseOrder.updatedAt, currency: item.purchaseOrder.currency, amount: Number(item.totalAmount), quantity: Number(item.quantity), unit: item.unit,
        measures: { unitPrice: Number(item.unitPrice), totalAmount: Number(item.totalAmount), description: item.description },
        dimensions: { economicItemCode: item.economicItem?.code ?? null, region: `${project.city}/${project.state}`, economicStage: "CONTRACTED", productStandard: "MCMV", supplierId: item.purchaseOrder.supplierId },
        provenance: { sourceModule: "9C", purchaseOrderId: item.purchaseOrderId, purchaseOrderNumber: item.purchaseOrder.number },
      });
    }

    for (const item of contractItems) {
      const approvedAmendments = item.contract.amendments.filter((a) => a.status === "APPROVED");
      const adjustedAmount = Number(item.originalAmount) + approvedAmendments.reduce((sum, a) => sum + Number(a.value), 0);
      seeds.push({
        factType: "COST", economicStage: "CONTRACTED", sourceModule: "9C", sourceEntityType: "OperationalContractItem", sourceEntityId: item.id,
        sourceVersion: item.contract.status, economicItemId: item.economicItemId, costCenterId: item.costCenterId, operatingUnitId: item.operatingUnitId,
        eventDate: item.contract.startsAt, observedAt: item.contract.updatedAt, currency: item.contract.currency, amount: adjustedAmount, quantity: Number(item.quantity), unit: item.unit,
        measures: { unitPrice: Number(item.unitPrice), originalAmount: Number(item.originalAmount), adjustedAmount, approvedAmendmentsTotal: adjustedAmount - Number(item.originalAmount), description: item.description },
        dimensions: { economicItemCode: item.economicItem?.code ?? null, region: `${project.city}/${project.state}`, economicStage: "CONTRACTED", productStandard: "MCMV", supplierId: item.contract.supplierId },
        provenance: { sourceModule: "9C", contractId: item.contractId, contractNumber: item.contract.number, amendmentsConsidered: approvedAmendments.length },
      });
    }

    for (const line of measurementLines) {
      seeds.push({
        factType: "MEASUREMENT", economicStage: "MEASURED", sourceModule: "9C", sourceEntityType: "MeasurementLine", sourceEntityId: line.id,
        sourceVersion: String(line.measurement.version), economicItemId: line.economicItemId, costCenterId: line.costCenterId ?? null, operatingUnitId: null,
        eventDate: line.measurement.competenceDate, observedAt: line.measurement.updatedAt, currency: "BRL", amount: Number(line.amount), quantity: Number(line.periodQuantity), unit: line.unit,
        measures: { unitPrice: Number(line.unitPrice), periodQuantity: Number(line.periodQuantity), cumulativeQuantity: Number(line.cumulativeQuantity), contractedQuantity: Number(line.contractedQuantity), physicalProgress: line.measurement.physicalProgress ? Number(line.measurement.physicalProgress) : null },
        dimensions: { economicItemCode: line.economicItem?.code ?? null, region: `${project.city}/${project.state}`, economicStage: "MEASURED", productStandard: "MCMV" },
        provenance: { sourceModule: "9C", measurementId: line.measurementId, measurementNumber: line.measurement.number, measurementStatus: line.measurement.status },
      });
    }

    // Observações externas de preço (9H) não pertencem a um projeto por natureza — associamos ao
    // projeto que está sendo atualizado apenas para caber no grain de AnalyticsFact (que exige
    // projectId); a fonte real (ExternalPriceObservation, organização) permanece a verdade.
    for (const observation of priceObservations) {
      seeds.push({
        factType: "PRICE_OBSERVATION", economicStage: null, sourceModule: "9H", sourceEntityType: "ExternalPriceObservation", sourceEntityId: observation.id,
        sourceVersion: null, economicItemId: observation.mappedEconomicItemId, costCenterId: null, operatingUnitId: null,
        eventDate: observation.observedAt, observedAt: observation.observedAt, currency: observation.currency, amount: Number(observation.price), quantity: observation.quantity ? Number(observation.quantity) : null, unit: observation.unit,
        measures: { price: Number(observation.price), freight: observation.freight ? Number(observation.freight) : 0, taxes: observation.taxes ? Number(observation.taxes) : 0, confidence: observation.confidence },
        dimensions: { itemCode: observation.itemCode, region: observation.region, economicStage: null, productStandard: null, sourceProvider: observation.sourceProvider },
        provenance: { sourceModule: "9H", sourceProvider: observation.sourceProvider, sourceUrl: observation.sourceUrl, evidenceChecksum: observation.evidenceChecksum },
      });
    }

    let created = 0;
    let updated = 0;
    for (const seed of seeds) {
      const contractId = contractByKey.get(seed.factType === "COST" && seed.economicStage === "BUDGETED" ? "custo-orcamento-linha" : seed.factType === "PROCUREMENT_PRICE" ? "custo-suprimentos-preco" : seed.factType === "COST" ? "custo-suprimentos-preco" : seed.factType === "MEASUREMENT" ? "custo-medicao" : "preco-observado-externo") ?? null;
      const grainKey = `${seed.factType}:${seed.sourceEntityType}:${seed.sourceEntityId}`;
      const payload = {
        organizationId: context.organizationId, projectId, contractId,
        factType: seed.factType, economicStage: seed.economicStage, grainKey,
        sourceModule: seed.sourceModule, sourceEntityType: seed.sourceEntityType, sourceEntityId: seed.sourceEntityId, sourceVersion: seed.sourceVersion,
        economicItemId: seed.economicItemId, costCenterId: seed.costCenterId, operatingUnitId: seed.operatingUnitId,
        eventDate: seed.eventDate, currency: seed.currency, amount: seed.amount, quantity: seed.quantity, unit: seed.unit,
        measures: json(seed.measures), dimensions: json(seed.dimensions), provenance: json(seed.provenance), observedAt: seed.observedAt,
      };
      const checksumValue = checksum(payload);
      const existing = await prisma.analyticsFact.findUnique({ where: { organizationId_factType_sourceEntityType_sourceEntityId: { organizationId: context.organizationId, factType: seed.factType, sourceEntityType: seed.sourceEntityType, sourceEntityId: seed.sourceEntityId } } });
      await prisma.analyticsFact.upsert({
        where: { organizationId_factType_sourceEntityType_sourceEntityId: { organizationId: context.organizationId, factType: seed.factType, sourceEntityType: seed.sourceEntityType, sourceEntityId: seed.sourceEntityId } },
        update: { ...payload, checksum: checksumValue, calculatedAt: new Date() },
        create: { ...payload, checksum: checksumValue },
      });
      if (existing) updated += 1; else created += 1;
    }

    return prisma.analyticsRefreshRun.update({
      where: { id: refreshRun.id },
      data: { status: "SUCCESS", finishedAt: new Date(), rowsProcessed: seeds.length, factsCreated: created, factsUpdated: updated },
    });
  } catch (error) {
    await prisma.analyticsRefreshRun.update({ where: { id: refreshRun.id }, data: { status: "FAILED", finishedAt: new Date(), errors: json({ message: (error as Error).message }) } });
    throw error;
  }
}

// ============================================================================
// C. Benchmark Engine — comparabilidade, similaridade, estatística e confiança
// ============================================================================

export interface BenchmarkOptions {
  economicItemId: string;
  metricKey: string;
  subjectType?: "ECONOMIC_ITEM";
  projectId: string;
}

export async function runCostBenchmark(context: DIContext, options: BenchmarkOptions) {
  requireCapability(context, "BENCHMARK_MANAGE");
  const project = await assertProjectScope(context, options.projectId);
  const [metric, policy] = await Promise.all([
    prisma.metricDefinition.findFirst({ where: { organizationId: context.organizationId, key: options.metricKey, status: "ACTIVE" } }),
    prisma.comparabilityPolicy.findFirst({ where: { organizationId: context.organizationId, key: "default", status: "ACTIVE" } }),
  ]);
  if (!metric) throw new Error(`Métrica "${options.metricKey}" não está registrada no catálogo.`);
  if (!policy) throw new Error("Política de comparabilidade padrão não encontrada — execute a fundação primeiro.");

  const eligibilityRules = policy.eligibilityRules as unknown as import("@/domain/data-intelligence").EligibilityRules;
  const similarityWeights = policy.similarityWeights as unknown as import("@/domain/data-intelligence").SimilarityWeights;
  const confidenceWeights = policy.confidenceWeights as unknown as import("@/domain/data-intelligence").ConfidenceWeights;

  const candidates = await prisma.analyticsFact.findMany({
    where: { organizationId: context.organizationId, economicItemId: options.economicItemId, amount: { not: null }, quantity: { not: null, gt: 0 } },
    include: { economicItem: true, project: true },
    orderBy: { id: "asc" },
  });

  const asOfDate = new Date();

  // Escolhe a unidade de referência determinísticamente: entre as unidades presentes nos fatos,
  // usa a que deixa o maior número de outros fatos unit-compatíveis (maximiza a amostra útil),
  // com empate resolvido por ordem alfabética — nunca "a primeira unidade que a consulta trouxe",
  // que não é uma ordem estável e produzia benchmarks não reprodutíveis entre execuções.
  const distinctUnits = [...new Set(candidates.map((c) => c.unit).filter((u): u is string => Boolean(u)))].sort();
  const referenceUnit = distinctUnits.length === 0 ? "unidade" : distinctUnits.reduce((best, unit) => {
    const compatibleCount = (target: string) => candidates.filter((c) => c.unit === target || (c.unit && convertUnit(1, c.unit, target).compatible)).length;
    return compatibleCount(unit) > compatibleCount(best) ? unit : best;
  }, distinctUnits[0]);

  const subjectContext: ComparableContext = { currency: "BRL", unit: referenceUnit, region: `${project.city}/${project.state}`, economicStage: null, productStandard: "MCMV", projectId: options.projectId, asOfDate };

  const members: { fact: (typeof candidates)[number]; eligible: boolean; reasons: string[]; unitPriceBrl: number | null; similarity: ReturnType<typeof calculateSimilarity> | null }[] = [];

  for (const fact of candidates) {
    const factContext: ComparableContext = { currency: fact.currency, unit: fact.unit ?? "unidade", region: (fact.dimensions as Record<string, unknown>)?.region as string ?? null, economicStage: fact.economicStage, productStandard: (fact.dimensions as Record<string, unknown>)?.productStandard as string ?? null, projectId: fact.projectId, asOfDate: fact.eventDate };
    const eligibility = checkEligibility(subjectContext, factContext, eligibilityRules);
    const conversion = fact.unit ? convertUnit(1, fact.unit, referenceUnit) : { compatible: false };
    const unitPriceRaw = fact.amount != null && fact.quantity != null && Number(fact.quantity) !== 0 ? Number(fact.amount) / Number(fact.quantity) : null;
    const unitCompatible = fact.unit === referenceUnit || conversion.compatible;
    const unitPriceBrl = unitPriceRaw != null && unitCompatible && fact.unit ? unitPriceRaw / (convertUnit(1, fact.unit, referenceUnit).factor || 1) : null;
    const reasons = [...eligibility.reasons];
    if (!unitCompatible) reasons.push(`Unidade "${fact.unit}" incompatível com a unidade de referência "${referenceUnit}".`);
    const similarity = eligibility.eligible && unitCompatible ? calculateSimilarity(subjectContext, factContext, similarityWeights) : null;
    members.push({ fact, eligible: reasons.length === 0, reasons, unitPriceBrl, similarity });
  }

  const eligibleValues = members.filter((m) => m.eligible && m.unitPriceBrl != null).map((m) => m.unitPriceBrl as number);
  const outlierMethod = policy.outlierMethod as "IQR" | "MAD";
  const thresholds = policy.outlierThresholds as { iqrMultiplier?: number; madThreshold?: number };
  const outlierFlags = outlierMethod === "MAD" ? detectOutliersMad(eligibleValues, thresholds.madThreshold) : detectOutliersIqr(eligibleValues, thresholds.iqrMultiplier);
  const summary = summarizeDistribution(eligibleValues);

  const averageSimilarity = members.filter((m) => m.similarity).reduce((sum, m) => sum + (m.similarity?.score ?? 0), 0) / (members.filter((m) => m.similarity).length || 1);
  const averageAgeMonths = members.filter((m) => m.eligible).reduce((sum, m) => sum + Math.abs(asOfDate.getTime() - m.fact.eventDate.getTime()) / (1000 * 60 * 60 * 24 * 30), 0) / (members.filter((m) => m.eligible).length || 1);
  const provenanceScore = members.filter((m) => m.eligible).length > 0 ? 0.7 : 0;

  const confidence = calculateConfidence({ sampleSize: eligibleValues.length, minimumSampleSize: policy.minimumSampleSize, averageAgeMonths, coefficientOfVariation: summary.coefficientOfVariation, averageSimilarity, provenanceScore }, confidenceWeights);

  const benchmarkRun = await prisma.benchmarkRun.create({
    data: {
      organizationId: context.organizationId, projectId: options.projectId, metricDefinitionId: metric.id, policyId: policy.id,
      subjectType: "ECONOMIC_ITEM", subjectId: options.economicItemId, asOfDate, filters: json({ economicItemId: options.economicItemId, referenceUnit }),
      sampleSize: eligibleValues.length, eligibleCount: eligibleValues.length,
      median: eligibleValues.length ? summary.median : null, mean: eligibleValues.length ? summary.mean : null, p25: eligibleValues.length ? summary.p25 : null, p75: eligibleValues.length ? summary.p75 : null, stdDev: eligibleValues.length ? summary.stdDev : null,
      unit: `R$/${referenceUnit}`, confidenceLevel: confidence.level, confidenceScore: confidence.score, confidenceFactors: json(confidence.factors),
      checksum: checksum({ candidates: candidates.map((c) => c.id), policyId: policy.id }), engineVersion: DATA_INTELLIGENCE_ENGINE_VERSION, createdById: context.userId,
      members: {
        create: members.map((m) => ({
          factId: m.fact.id, sourceEntityType: m.fact.sourceEntityType, sourceEntityId: m.fact.sourceEntityId, projectId: m.fact.projectId,
          rawValue: m.fact.quantity && m.fact.amount ? Number(m.fact.amount) / Number(m.fact.quantity) : 0, normalizedValue: m.unitPriceBrl ?? 0, unit: `R$/${referenceUnit}`,
          similarityScore: m.similarity?.score ?? 0, similarityFactors: json(m.similarity?.factors ?? m.reasons), eligible: m.eligible, exclusionReason: m.reasons.join(" ") || null, includedInStats: m.eligible && m.unitPriceBrl != null,
        })),
      },
    },
    include: { members: true },
  });

  for (const flag of outlierFlags) {
    const eligibleMembers = benchmarkRun.members.filter((m) => m.includedInStats);
    const member = eligibleMembers[flag.index];
    if (member) await prisma.benchmarkOutlier.create({ data: { benchmarkRunId: benchmarkRun.id, memberId: member.id, method: flag.method, score: flag.score === Infinity ? 999999 : flag.score, decision: "PENDING" } });
  }

  return prisma.benchmarkRun.findUniqueOrThrow({ where: { id: benchmarkRun.id }, include: { members: true, outliers: true, metricDefinition: true, policy: true } });
}

export async function decideOutlier(context: DIContext, outlierId: string, decision: "VALID" | "ERROR" | "EXTRAORDINARY" | "DIFFERENT_SCOPE" | "EXCLUDED", rationale: string) {
  requireCapability(context, "BENCHMARK_MANAGE");
  const outlier = await prisma.benchmarkOutlier.findFirst({ where: { id: outlierId, benchmarkRun: { organizationId: context.organizationId } } });
  if (!outlier) throw new Error("Ponto fora do padrão não encontrado nesta organização.");
  return prisma.benchmarkOutlier.update({ where: { id: outlierId }, data: { decision, rationale, decidedById: context.userId, decidedAt: new Date() } });
}

// ============================================================================
// D. Previsto x Realizado / Forecast Accuracy
// ============================================================================

export async function evaluateForecasts(context: DIContext, projectId: string) {
  requireCapability(context, "ANALYTICS_REPROCESS");
  await assertProjectScope(context, projectId);
  const metric = await prisma.metricDefinition.findFirst({ where: { organizationId: context.organizationId, key: "desvio_contratual", status: "ACTIVE" } });
  if (!metric) throw new Error("Métrica desvio_contratual não registrada — execute a fundação primeiro.");

  const contracts = await prisma.operationalContract.findMany({ where: { organizationId: context.organizationId, projectId }, include: { amendments: true, items: true } });
  const results = [];
  for (const contract of contracts) {
    const approvedAmendments = contract.amendments.filter((a) => a.status === "APPROVED");
    const predictedValue = Number(contract.originalAmount);
    const actualValue = predictedValue + approvedAmendments.reduce((sum, a) => sum + Number(a.value), 0);
    const evaluation = evaluateForecastAccuracy({ predictedValue, actualValue });
    const horizonStage = contract.status === "ACTIVE" || contract.status === "APPROVED" ? "CONSTRUCTION_START" : "CONSTRUCTION_MID";
    const payload = {
      organizationId: context.organizationId, projectId, metricDefinitionId: metric.id,
      forecastSourceType: "OperationalContract", forecastSourceId: contract.id, forecastVersion: 1,
      predictedValue, predictedAsOfDate: contract.startsAt, horizonStage: horizonStage as "CONSTRUCTION_START" | "CONSTRUCTION_MID",
      actualValue, actualAsOfDate: approvedAmendments.length ? approvedAmendments[approvedAmendments.length - 1].effectiveAt ?? new Date() : null,
      actualSourceType: approvedAmendments.length ? "ContractAmendment" : null, actualSourceId: approvedAmendments.length ? approvedAmendments[approvedAmendments.length - 1].id : null,
      unit: "R$", absoluteError: evaluation.absoluteError, percentError: evaluation.percentError, bias: evaluation.bias, evaluated: true,
    };
    const row = await prisma.forecastEvaluation.upsert({
      where: { organizationId_forecastSourceType_forecastSourceId_forecastVersion_metricDefinitionId: { organizationId: context.organizationId, forecastSourceType: "OperationalContract", forecastSourceId: contract.id, forecastVersion: 1, metricDefinitionId: metric.id } },
      update: { ...payload, checksum: checksum(payload), calculatedAt: new Date() },
      create: { ...payload, checksum: checksum(payload) },
    });
    results.push(row);
  }
  return results;
}

// ============================================================================
// E. Data Quality
// ============================================================================

const DEFAULT_QUALITY_RULES = [
  { key: "unidade-invalida", name: "Unidade fora do registro canônico", datasetKey: "analytics_facts", dimension: "VALIDITY" as const, severity: "WARNING" as const },
  { key: "proveniencia-ausente", name: "Fato sem proveniência registrada", datasetKey: "analytics_facts", dimension: "PROVENANCE" as const, severity: "CRITICAL" as const },
  { key: "observacao-externa-desatualizada", name: "Observação de preço externa desatualizada (>180 dias)", datasetKey: "external_price_observations", dimension: "FRESHNESS" as const, severity: "WARNING" as const },
  { key: "item-sem-fato", name: "EconomicItem sem nenhum fato analítico associado", datasetKey: "analytics_facts", dimension: "COMPLETENESS" as const, severity: "INFO" as const },
] as const;

export async function ensureDataQualityRules(context: DIContext) {
  requireCapability(context, "DATA_QUALITY_MANAGE");
  const rows = [];
  for (const rule of DEFAULT_QUALITY_RULES) {
    const row = await prisma.dataQualityRule.upsert({
      where: { organizationId_key_version: { organizationId: context.organizationId, key: rule.key, version: 1 } },
      update: {},
      create: { organizationId: context.organizationId, key: rule.key, name: rule.name, datasetKey: rule.datasetKey, dimension: rule.dimension, severity: rule.severity, config: json({}), status: "ACTIVE", createdById: context.userId },
    });
    rows.push(row);
  }
  return rows;
}

export async function runDataQualityChecks(context: DIContext, projectId: string) {
  requireCapability(context, "DATA_QUALITY_MANAGE");
  await assertProjectScope(context, projectId);
  const rules = await prisma.dataQualityRule.findMany({ where: { organizationId: context.organizationId, status: "ACTIVE" } });
  const facts = await prisma.analyticsFact.findMany({ where: { organizationId: context.organizationId, projectId } });
  const observations = await prisma.externalPriceObservation.findMany({ where: { organizationId: context.organizationId } });
  const economicItems = await prisma.economicItem.findMany({ where: { organizationId: context.organizationId, projectId } });
  const runs = [];

  for (const rule of rules) {
    let rowsEvaluated = 0;
    let issues: { entityType: string; entityId: string; message: string }[] = [];

    if (rule.key === "unidade-invalida") {
      rowsEvaluated = facts.length;
      const { unitDimension } = await import("@/domain/data-intelligence/normalization");
      issues = facts.filter((f) => f.unit && !unitDimension(f.unit)).map((f) => ({ entityType: "AnalyticsFact", entityId: f.id, message: `Unidade "${f.unit}" não está no registro canônico.` }));
    } else if (rule.key === "proveniencia-ausente") {
      rowsEvaluated = facts.length;
      issues = facts.filter((f) => !f.provenance || Object.keys(f.provenance as object).length === 0).map((f) => ({ entityType: "AnalyticsFact", entityId: f.id, message: "Fato sem campos de proveniência." }));
    } else if (rule.key === "observacao-externa-desatualizada") {
      rowsEvaluated = observations.length;
      const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
      issues = observations.filter((o) => o.observedAt.getTime() < cutoff).map((o) => ({ entityType: "ExternalPriceObservation", entityId: o.id, message: `Observação de ${o.observedAt.toISOString().slice(0, 10)} está desatualizada (>180 dias).` }));
    } else if (rule.key === "item-sem-fato") {
      rowsEvaluated = economicItems.length;
      const withFacts = new Set(facts.map((f) => f.economicItemId).filter(Boolean));
      issues = economicItems.filter((item) => !withFacts.has(item.id)).map((item) => ({ entityType: "EconomicItem", entityId: item.id, message: `Item "${item.code} — ${item.description}" ainda não possui fato analítico.` }));
    }

    const run = await prisma.dataQualityRun.create({
      data: {
        organizationId: context.organizationId, ruleId: rule.id, datasetKey: rule.datasetKey, rowsEvaluated, rowsFailed: issues.length, passed: issues.length === 0,
        summary: json({ ruleKey: rule.key, rowsEvaluated, rowsFailed: issues.length }),
        issues: { create: issues.map((issue) => ({ entityType: issue.entityType, entityId: issue.entityId, severity: rule.severity, message: issue.message, status: "OPEN" as const })) },
      },
      include: { issues: true, rule: true },
    });
    runs.push(run);
  }
  return runs;
}

// ============================================================================
// F. Carteira de Empreendimentos (Portfolio Snapshot)
// ============================================================================

export interface PortfolioScorecardDimension {
  value: number | null;
  unit: string | null;
  note: string;
}

export interface PortfolioScorecard {
  financeiro: PortfolioScorecardDimension;
  comercial: PortfolioScorecardDimension;
  engenharia: PortfolioScorecardDimension;
  juridico: PortfolioScorecardDimension;
  cronograma: PortfolioScorecardDimension;
  capital: PortfolioScorecardDimension;
  dados: PortfolioScorecardDimension;
}

export interface PortfolioMetrics {
  orcado: number;
  contratado: number;
  medido: number;
  absorcao: number;
  progressoFisico: number;
  margemVgv: number | null;
  vgv: number | null;
  exposicaoMaxima: number | null;
}

export async function buildPortfolioSnapshot(context: DIContext, projectId: string) {
  requireCapability(context, "ANALYTICS_REPROCESS");
  await assertProjectScope(context, projectId);
  const [budget, contracts, measurements, salesUnits, legalCases, latestRun, qualityIssuesOpen] = await Promise.all([
    prisma.budget.findFirst({ where: { organizationId: context.organizationId, projectId, status: { in: ["OFFICIAL", "APPROVED"] } }, orderBy: { version: "desc" } }),
    prisma.operationalContract.findMany({ where: { organizationId: context.organizationId, projectId }, include: { amendments: true } }),
    prisma.measurementCertificate.findMany({ where: { organizationId: context.organizationId, projectId } }),
    prisma.salesUnit.findMany({ where: { organizationId: context.organizationId, projectId } }),
    prisma.legalDueDiligenceCase.findMany({ where: { organizationId: context.organizationId, projectId } }),
    prisma.calculationRun.findFirst({ where: { organizationId: context.organizationId, projectId }, orderBy: { calculatedAt: "desc" }, include: { result: true } }),
    prisma.dataQualityIssue.count({ where: { status: "OPEN", run: { rule: { organizationId: context.organizationId } } } }),
  ]);

  const orcado = budget ? Number(budget.totalBudget) : 0;
  const contratado = contracts.reduce((sum, c) => sum + Number(c.originalAmount) + c.amendments.filter((a) => a.status === "APPROVED").reduce((s, a) => s + Number(a.value), 0), 0);
  const medido = measurements.reduce((sum, m) => sum + Number(m.netAmount), 0);
  const soldOrDelivered = salesUnits.filter((u) => ["VENDIDA", "EM_RESERVA", "RESERVADA"].includes(u.status)).length;
  const absorcao = salesUnits.length ? soldOrDelivered / salesUnits.length : 0;
  const openLegal = legalCases.filter((c) => c.status !== "COMPLETED" && c.status !== "CANCELLED").length;
  const progressoFisico = measurements.length ? Number(measurements[measurements.length - 1].physicalProgress ?? 0) : 0;

  const metrics: PortfolioMetrics = {
    orcado, contratado, medido, absorcao, progressoFisico,
    margemVgv: latestRun?.result ? Number(latestRun.result.marginOnVgv) : null,
    vgv: latestRun?.result ? Number(latestRun.result.vgv) : null,
    exposicaoMaxima: latestRun?.result ? Number(latestRun.result.maximumCashExposure) : null,
  };

  const scorecard: PortfolioScorecard = {
    financeiro: { value: metrics.margemVgv, unit: "%", note: latestRun ? "Margem calculada pelo motor de viabilidade (não recalculada pela 9I)." : "Sem cálculo de viabilidade disponível." },
    comercial: { value: absorcao, unit: "%", note: `${soldOrDelivered} de ${salesUnits.length} unidades vendidas/reservadas.` },
    engenharia: { value: progressoFisico, unit: "%", note: "Avanço físico da última medição aprovada." },
    juridico: { value: openLegal, unit: "casos abertos", note: `${openLegal} de ${legalCases.length} diligências ainda não concluídas.` },
    cronograma: { value: null, unit: null, note: "Fundação: cronograma reutilizado da 9A, sem métrica própria calculada nesta fase." },
    capital: { value: metrics.exposicaoMaxima, unit: "R$", note: "Exposição máxima de caixa do motor financeiro." },
    dados: { value: qualityIssuesOpen, unit: "achados abertos", note: `${qualityIssuesOpen} achado(s) de qualidade de dados em aberto na organização.` },
  };

  return prisma.portfolioSnapshot.upsert({
    where: { organizationId_scopeType_scopeId_asOfDate: { organizationId: context.organizationId, scopeType: "PROJECT", scopeId: projectId, asOfDate: new Date(new Date().toISOString().slice(0, 10)) } },
    update: { metrics: json(metrics), scorecard: json(scorecard), dataQuality: json({ openIssues: qualityIssuesOpen }), checksum: checksum(metrics), calculatedAt: new Date() },
    create: {
      organizationId: context.organizationId, scopeType: "PROJECT", scopeId: projectId, asOfDate: new Date(new Date().toISOString().slice(0, 10)),
      metrics: json(metrics), scorecard: json(scorecard), dataQuality: json({ openIssues: qualityIssuesOpen }), checksum: checksum(metrics), engineVersion: DATA_INTELLIGENCE_ENGINE_VERSION, createdById: context.userId,
    },
  });
}

// ============================================================================
// G. Orçamento Inteligente (Auto Budget Foundation)
// ============================================================================

export async function createAutoBudgetProposal(context: DIContext, input: { projectId: string; economicItemId: string; quantity: number; unit: string; name: string }) {
  requireCapability(context, "AUTOBUDGET_BUILD");
  await assertProjectScope(context, input.projectId);
  const policy = await prisma.comparabilityPolicy.findFirstOrThrow({ where: { organizationId: context.organizationId, key: "default", status: "ACTIVE" } });
  const benchmark = await prisma.benchmarkRun.findFirst({ where: { organizationId: context.organizationId, subjectType: "ECONOMIC_ITEM", subjectId: input.economicItemId }, orderBy: { calculatedAt: "desc" }, include: { members: { include: { fact: { include: { project: true } } } } } });

  const projectNames = benchmark ? [...new Set(benchmark.members.filter((m) => m.includedInStats).map((m) => m.fact?.project?.name ?? "projeto interno"))] : [];

  // O benchmark é calculado em R$/<unidade-de-referência-do-benchmark>, que pode não ser a mesma
  // unidade do item que está sendo orçado (ex.: benchmark em "unidade de serviço", proposta em
  // "VB"). Aplicar um preço por unidade a uma quantidade de outra unidade incompatível produziria
  // um total sem sentido — o mesmo princípio de comparabilidade do benchmark vale aqui: sem
  // conversão válida, não há sugestão numérica, só a exceção explicando o motivo.
  const benchmarkUnit = benchmark?.unit?.startsWith("R$/") ? benchmark.unit.slice(3) : null;
  const conversion = benchmarkUnit ? convertUnit(1, benchmarkUnit, input.unit) : null;
  const unitCompatible = !benchmark || (conversion?.compatible ?? false);
  const priceConversionFactor = conversion?.compatible ? conversion.factor : 1;

  const suggestion = suggestUnitCost({
    quantity: input.quantity,
    benchmarkMedian: benchmark?.median && unitCompatible ? Number(benchmark.median) / priceConversionFactor : 0,
    benchmarkP25: benchmark?.p25 && unitCompatible ? Number(benchmark.p25) / priceConversionFactor : 0,
    benchmarkP75: benchmark?.p75 && unitCompatible ? Number(benchmark.p75) / priceConversionFactor : 0,
    confidenceLevel: unitCompatible ? (benchmark?.confidenceLevel ?? "LOW") : "LOW",
    sampleSize: benchmark?.sampleSize ?? 0,
    sampleProjectNames: projectNames,
    unit: input.unit,
  });
  if (benchmark && !unitCompatible) {
    suggestion.exceptions.push(`O comparativo mais recente para este item está em "${benchmarkUnit}", incompatível com "${input.unit}" desta proposta — nenhum valor numérico foi sugerido a partir dele.`);
    suggestion.rationale = `Sem sugestão numérica: o comparativo mais recente para este item está em "${benchmarkUnit}" (${benchmark.sampleSize} observação(ões)), incompatível com a unidade "${input.unit}" desta proposta. Peça um comparativo na unidade correta antes de orçar este item.`;
  }

  void policy; void suggestion;
  return createSmartBudgetProposal(context, { projectId: input.projectId, name: input.name, rationale: suggestion.rationale, lines: [{ economicItemId: input.economicItemId, quantity: input.quantity, unit: input.unit, quantityOrigin: "ESTIMATE", benchmarkRunId: benchmark?.id ?? null, evidenceRequired: true }] });
}

export async function moveAutoBudgetProposalToReview(context: DIContext, proposalId: string) {
  requireCapability(context, "AUTOBUDGET_REVIEW");
  const proposal = await prisma.autoBudgetProposal.findFirst({ where: { id: proposalId, organizationId: context.organizationId } });
  if (!proposal) throw new Error("Proposta não encontrada nesta organização.");
  if (proposal.status !== "DRAFT") throw new Error(`Proposta em status ${proposal.status} não pode ir para revisão.`);
  return prisma.autoBudgetProposal.update({ where: { id: proposalId }, data: { status: "REVIEW", reviewedById: context.userId, reviewedAt: new Date() } });
}

export async function decideAutoBudgetProposal(context: DIContext, proposalId: string, decision: "APPROVED" | "REJECTED", input: { rejectionReason?: string; lineReviews?: { lineId: string; reviewedUnitCost?: number; reviewNote?: string }[] }) {
  requireCapability(context, decision === "APPROVED" ? "AUTOBUDGET_APPROVE" : "AUTOBUDGET_REVIEW");
  const proposal = await prisma.autoBudgetProposal.findFirst({ where: { id: proposalId, organizationId: context.organizationId } });
  if (!proposal) throw new Error("Proposta não encontrada nesta organização.");
  if (proposal.status !== "REVIEW" && proposal.status !== "DRAFT") throw new Error(`Proposta em status ${proposal.status} não pode ser decidida.`);

  // rejectSmartBudgetProposal/approveSmartBudgetProposal exigem status REVIEW — leva o DRAFT
  // legado para lá antes de decidir, nas duas direções (aprovação já fazia isso só para APPROVED).
  if (proposal.status === "DRAFT") await prisma.autoBudgetProposal.update({ where: { id: proposal.id }, data: { status: "REVIEW", reviewedById: context.userId, reviewedAt: new Date() } });
  if (decision === "REJECTED") return rejectSmartBudgetProposal(context, proposalId, input.rejectionReason ?? "Proposta rejeitada na revisão humana.");
  for (const review of input.lineReviews ?? []) await appendSmartBudgetLineReview(context, { lineId: review.lineId, decision: review.reviewedUnitCost == null ? "ACCEPTED" : "ADJUSTED", revisedUnitCost: review.reviewedUnitCost, justification: review.reviewNote ?? "Revisão humana registrada pelo fluxo legado 9I." });
  return approveSmartBudgetProposal(context, proposalId);
}

// ============================================================================
// H. Orquestração — atualização completa idempotente (usada pelo seed e pela UI)
// ============================================================================

export async function refreshDataIntelligence(context: DIContext, projectId: string) {
  requireCapability(context, "ANALYTICS_REPROCESS");
  await ensureAnalyticsContracts(context);
  await ensureMetricCatalog(context);
  await ensureComparabilityPolicy(context);
  await ensureDataQualityRules(context);
  const refresh = await refreshAnalyticsFacts(context, projectId);

  const project = await assertProjectScope(context, projectId);
  const officialLine = await prisma.budgetLineItem.findFirst({ where: { budget: { projectId, organizationId: context.organizationId, status: { in: ["OFFICIAL", "APPROVED"] } }, totalCost: { gt: 0 } }, orderBy: { totalCost: "desc" } });

  const benchmarks = [];
  if (officialLine?.economicItemId) {
    benchmarks.push(await runCostBenchmark(context, { economicItemId: officialLine.economicItemId, metricKey: "custo_unitario_item", projectId }));
  }
  const forecastEvaluations = await evaluateForecasts(context, projectId);
  const qualityRuns = await runDataQualityChecks(context, projectId);
  const portfolioSnapshot = await buildPortfolioSnapshot(context, projectId);

  return { refresh, benchmarks, forecastEvaluations, qualityRuns, portfolioSnapshot, project };
}

// ============================================================================
// I. Leitura — workspace para a UI
// ============================================================================

export async function getDataIntelligenceWorkspace(context: DIContext, projectId: string) {
  requireCapability(context, "DATA_VIEW");
  await assertProjectScope(context, projectId);

  const [contracts, metrics, facts, benchmarks, forecastEvaluations, qualityRuns, qualityIssues, portfolioSnapshot, autoBudgetProposals, economicItems] = await Promise.all([
    prisma.analyticsDataContract.findMany({ where: { organizationId: context.organizationId }, orderBy: { key: "asc" } }),
    prisma.metricDefinition.findMany({ where: { organizationId: context.organizationId }, orderBy: { key: "asc" } }),
    prisma.analyticsFact.findMany({ where: { organizationId: context.organizationId, projectId }, include: { economicItem: true }, orderBy: { eventDate: "desc" }, take: 200 }),
    prisma.benchmarkRun.findMany({ where: { organizationId: context.organizationId, projectId }, include: { members: { include: { fact: true } }, outliers: true, metricDefinition: true }, orderBy: { calculatedAt: "desc" }, take: 100 }),
    prisma.forecastEvaluation.findMany({ where: { organizationId: context.organizationId, projectId }, orderBy: { calculatedAt: "desc" }, take: 50 }),
    prisma.dataQualityRun.findMany({ where: { organizationId: context.organizationId }, include: { rule: true, issues: true }, orderBy: { executedAt: "desc" }, take: 100 }),
    prisma.dataQualityIssue.findMany({ where: { status: "OPEN", run: { rule: { organizationId: context.organizationId } } }, include: { run: { include: { rule: true } } }, take: 50 }),
    prisma.portfolioSnapshot.findFirst({ where: { organizationId: context.organizationId, scopeType: "PROJECT", scopeId: projectId }, orderBy: { asOfDate: "desc" } }),
    prisma.autoBudgetProposal.findMany({ where: { organizationId: context.organizationId, projectId }, include: { lines: true }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.economicItem.findMany({ where: { organizationId: context.organizationId, projectId }, orderBy: { code: "asc" } }),
  ]);

  const biasSummary = summarizeBias(forecastEvaluations.filter((e) => e.evaluated).map((e) => ({ bias: e.bias ?? "NEUTRAL", percentError: e.percentError ? Number(e.percentError) : null })));

  // Cada refresh gera um novo BenchmarkRun/DataQualityRun — histórico auditável por natureza (não
  // sobrescrito). A leitura da UI mostra só a execução mais recente por assunto/regra; o histórico
  // completo continua no banco e é reconstruível a partir dele, nunca é perdido.
  function keepFirstPerKey<T>(rows: T[], keyOf: (row: T) => string): T[] {
    const seen = new Set<string>();
    const kept: T[] = [];
    for (const row of rows) {
      const key = keyOf(row);
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(row);
    }
    return kept;
  }
  const latestBenchmarkPerSubject = keepFirstPerKey(benchmarks, (b) => `${b.subjectType}:${b.subjectId}:${b.metricDefinitionId}`);
  const latestQualityRunPerRule = keepFirstPerKey(qualityRuns, (r) => r.ruleId);

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    permissions: {
      canReprocess: hasDataIntelligenceCapability(context.role, "ANALYTICS_REPROCESS"),
      canManageBenchmark: hasDataIntelligenceCapability(context.role, "BENCHMARK_MANAGE"),
      canManageQuality: hasDataIntelligenceCapability(context.role, "DATA_QUALITY_MANAGE"),
      canBuildAutoBudget: hasDataIntelligenceCapability(context.role, "AUTOBUDGET_BUILD"),
      canReviewAutoBudget: hasDataIntelligenceCapability(context.role, "AUTOBUDGET_REVIEW"),
      canApproveAutoBudget: hasDataIntelligenceCapability(context.role, "AUTOBUDGET_APPROVE"),
    },
    contracts: contracts.map((c) => ({ id: c.id, key: c.key, name: c.name, version: c.version, sourceModule: c.sourceModule, grain: c.grain, status: c.status, effectiveFrom: c.effectiveFrom.toISOString() })),
    metrics: metrics.map((m) => ({ id: m.id, key: m.key, name: m.name, version: m.version, unit: m.unit, aggregation: m.aggregation, definition: m.definition, formula: m.formula, status: m.status })),
    economicItems: economicItems.map((item) => ({ id: item.id, code: item.code, description: item.description, category: item.category, unit: item.unit })),
    facts: facts.map((f) => ({ id: f.id, factType: f.factType, economicStage: f.economicStage, economicItemCode: f.economicItem?.code ?? null, amount: f.amount ? Number(f.amount) : null, quantity: f.quantity ? Number(f.quantity) : null, unit: f.unit, unitPrice: f.amount && f.quantity && Number(f.quantity) !== 0 ? Number(f.amount) / Number(f.quantity) : null, eventDate: f.eventDate.toISOString(), sourceModule: f.sourceModule, sourceEntityType: f.sourceEntityType })),
    benchmarks: latestBenchmarkPerSubject.map((b) => ({
      id: b.id, subjectType: b.subjectType, subjectId: b.subjectId, metricKey: b.metricDefinition.key, metricName: b.metricDefinition.name, unit: b.unit,
      sampleSize: b.sampleSize, median: b.median ? Number(b.median) : null, mean: b.mean ? Number(b.mean) : null, p25: b.p25 ? Number(b.p25) : null, p75: b.p75 ? Number(b.p75) : null, stdDev: b.stdDev ? Number(b.stdDev) : null,
      confidenceLevel: b.confidenceLevel, confidenceScore: b.confidenceScore, confidenceFactors: b.confidenceFactors, asOfDate: b.asOfDate.toISOString(),
      members: b.members.map((m) => ({ id: m.id, sourceEntityType: m.sourceEntityType, rawValue: Number(m.rawValue), normalizedValue: Number(m.normalizedValue), unit: m.unit, similarityScore: m.similarityScore, eligible: m.eligible, exclusionReason: m.exclusionReason, includedInStats: m.includedInStats })),
      outliers: b.outliers.map((o) => ({ id: o.id, method: o.method, score: Number(o.score), decision: o.decision, rationale: o.rationale })),
    })),
    forecastEvaluations: forecastEvaluations.map((e) => ({ id: e.id, forecastSourceType: e.forecastSourceType, predictedValue: Number(e.predictedValue), actualValue: e.actualValue ? Number(e.actualValue) : null, absoluteError: e.absoluteError ? Number(e.absoluteError) : null, percentError: e.percentError ? Number(e.percentError) : null, bias: e.bias, horizonStage: e.horizonStage, evaluated: e.evaluated })),
    biasSummary,
    dataQuality: {
      runs: latestQualityRunPerRule.map((r) => ({ id: r.id, ruleName: r.rule.name, dimension: r.rule.dimension, severity: r.rule.severity, rowsEvaluated: r.rowsEvaluated, rowsFailed: r.rowsFailed, passed: r.passed, executedAt: r.executedAt.toISOString() })),
      openIssues: qualityIssues.map((i) => ({ id: i.id, entityType: i.entityType, entityId: i.entityId, severity: i.severity, message: i.message, ruleName: i.run.rule.name })),
    },
    portfolio: portfolioSnapshot ? { asOfDate: portfolioSnapshot.asOfDate.toISOString(), metrics: portfolioSnapshot.metrics as unknown as PortfolioMetrics, scorecard: portfolioSnapshot.scorecard as unknown as PortfolioScorecard, dataQuality: portfolioSnapshot.dataQuality } : null,
    autoBudgetProposals: autoBudgetProposals.map((p) => ({
      id: p.id, name: p.name, status: p.status, rationale: p.rationale, createdAt: p.createdAt.toISOString(),
      lines: p.lines.map((l) => ({ id: l.id, description: l.description, quantity: Number(l.quantity), unit: l.unit, suggestedUnitCost: Number(l.suggestedUnitCost), suggestedTotalCost: Number(l.suggestedTotalCost), rangeLow: l.rangeLow ? Number(l.rangeLow) : null, rangeHigh: l.rangeHigh ? Number(l.rangeHigh) : null, confidenceLevel: l.confidenceLevel, rationale: l.rationale, exceptions: l.exceptions, reviewedUnitCost: l.reviewedUnitCost ? Number(l.reviewedUnitCost) : null, reviewNote: l.reviewNote })),
    })),
  };
}

export type DataIntelligenceWorkspace = Awaited<ReturnType<typeof getDataIntelligenceWorkspace>>;
