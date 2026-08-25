import { createHash } from "node:crypto";
import { LandVersionStatus, Prisma, UrbanSourceType as DbUrbanSourceType, type LandStudy, type PrismaClient } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { createDemoLandSnapshot, DEMO_LAND_ASSET, LAND_ENGINE_VERSION, ZONING_SOLVER_VERSION, type LandStudySnapshot, type LandWorkspaceView, type UrbanScenarioUpdateInput } from "@/domain/land";
import { polygonArea } from "@/domain/land/geometry";
import { prisma } from "@/infrastructure/database/prisma";

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toView(version: { id: string; versionNumber: number; snapshot: Prisma.JsonValue }): LandWorkspaceView {
  return { landStudyId: (version.snapshot as unknown as LandStudySnapshot).landStudyId, versionId: version.id, versionNumber: version.versionNumber, snapshot: version.snapshot as unknown as LandStudySnapshot };
}

function previousParameters(snapshot: LandStudySnapshot | null) {
  return snapshot?.scenarios.find((scenario) => scenario.isHypothetical)?.parameters ?? null;
}

async function appendLandVersion(
  tx: Tx,
  context: Pick<AuthContext, "userId" | "organizationId">,
  study: LandStudy,
  update: UrbanScenarioUpdateInput | null,
  justification: string,
): Promise<LandWorkspaceView> {
  if (study.organizationId !== context.organizationId) throw new Error("Estudo de terreno não encontrado nesta organização.");
  if (update && update.expectedVersionNumber !== study.currentVersionNumber) throw new Error("O estudo recebeu uma nova versão. Recarregue antes de salvar.");
  const previous = study.currentVersionNumber > 0 ? await tx.landStudyVersion.findFirst({ where: { landStudyId: study.id, versionStatus: LandVersionStatus.SNAPSHOT }, orderBy: { versionNumber: "desc" }, select: { snapshot: true } }) : null;
  const versionNumber = study.currentVersionNumber + 1;
  const overrides = update?.parameters;
  const snapshot = createDemoLandSnapshot(context.organizationId, versionNumber, overrides, update?.product, update?.polygon);
  snapshot.landStudyId = study.id;
  snapshot.landAsset.id = study.landAssetId;
  if (update?.polygon) {
    snapshot.landAsset.polygon = update.polygon;
    snapshot.landAsset.area = polygonArea(update.polygon);
    const [first, second] = update.polygon.coordinates;
    snapshot.landAsset.frontage = Math.hypot(second.x - first.x, second.y - first.y);
    await tx.landAsset.update({ where: { id: study.landAssetId }, data: { polygonGeometry: json(update.polygon), area: snapshot.landAsset.area, frontage: snapshot.landAsset.frontage, sourceRef: "BARUERI_MANUAL_PARCEL", updatedById: context.userId } });
  }
  snapshot.scenarios.forEach((scenario) => { scenario.landAssetId = study.landAssetId; });
  snapshot.createdAt = new Date().toISOString();

  const version = await tx.landStudyVersion.create({
    data: {
      landStudyId: study.id,
      versionNumber,
      analysisStatus: snapshot.status,
      landEngineVersion: LAND_ENGINE_VERSION,
      zoningSolverVersion: ZONING_SOLVER_VERSION,
      inputHash: hash({ land: snapshot.landAsset, scenarios: snapshot.scenarios, options: snapshot.options.map((option) => option.product) }),
      selectedScenarioCode: snapshot.selectedScenarioId,
      selectedOptionCode: snapshot.selectedOptionId,
      regulatoryConfidence: snapshot.regulatoryConfidence.score,
      snapshot: json(snapshot),
      createdById: context.userId,
    },
  });
  snapshot.id = version.id;

  await tx.urbanSourceRecord.createMany({ data: snapshot.sources.map((source) => ({
    landStudyVersionId: version.id,
    sourceRef: source.id,
    type: source.type,
    authority: source.authority,
    title: source.title,
    url: source.url,
    legislation: source.legislation,
    effectiveDate: source.effectiveDate ? new Date(`${source.effectiveDate}T00:00:00.000Z`) : null,
    accessedAt: new Date(source.accessedAt),
    version: source.version,
    confidence: source.confidence,
    notes: source.notes,
  })) });

  const scenarioIds = new Map<string, string>();
  for (const scenario of snapshot.scenarios) {
    const row = await tx.urbanScenarioRecord.create({ data: {
      landStudyVersionId: version.id,
      code: scenario.id,
      name: scenario.name,
      type: scenario.type,
      status: scenario.status,
      zoningCode: scenario.parameters.zoningCode.value,
      isHypothetical: scenario.isHypothetical,
      disclaimer: scenario.disclaimer,
      parameters: json(scenario.parameters),
      sourceRefs: json(scenario.sourceIds),
    } });
    scenarioIds.set(scenario.id, row.id);
    if (scenario.restrictions.length) await tx.urbanRestrictionRecord.createMany({ data: scenario.restrictions.map((restriction) => ({
      urbanScenarioId: row.id,
      code: restriction.id,
      type: restriction.type,
      severity: restriction.severity,
      geometry: restriction.geometry ? json(restriction.geometry) : Prisma.JsonNull,
      description: restriction.description,
      sourceRef: restriction.sourceId,
      confidence: restriction.confidence,
      impact: restriction.impact,
      verification: restriction.verificationStatus,
    })) });
    const envelope = snapshot.options.find((option) => option.scenarioId === scenario.id)?.envelope;
    if (envelope) await tx.buildableEnvelopeRecord.create({ data: {
      urbanScenarioId: row.id,
      engineVersion: envelope.version,
      groundPolygon: json(envelope.buildableGroundPolygon),
      maximumFootprintArea: envelope.maximumFootprintArea,
      maximumComputableArea: envelope.maximumComputableArea,
      estimatedNonComputable: envelope.estimatedNonComputableArea,
      maximumTotalArea: envelope.maximumTotalArea,
      maximumHeight: envelope.maximumHeight,
      estimatedFloors: envelope.estimatedFloors,
      constraints: json(envelope.regulatoryConstraints),
      warnings: json(envelope.warnings),
    } });
  }

  await tx.landOptionRecord.createMany({ data: snapshot.options.map((option) => ({
    landStudyVersionId: version.id,
    urbanScenarioId: scenarioIds.get(option.scenarioId)!,
    code: option.id,
    name: option.name,
    massingType: option.massingType,
    rank: option.rank,
    paretoEfficient: option.paretoEfficient,
    product: json(option.product),
    masterplan: json(option.masterplan),
    massing: json(option.massing),
    areaSchedule: json(option.areaSchedule),
    engineAssumptions: json(option.engineAssumptions),
    engineResult: json(option.financialResult),
    scoreResult: json(option.score),
    warnings: json(option.warnings),
    engineVersion: option.financialResult.engineVersion,
    scoreVersion: option.score.policyVersion,
  })) });
  await tx.reverseZoningRun.create({ data: { landStudyVersionId: version.id, solverVersion: snapshot.reverseZoning.version, target: json({ units: 1300, averageUnitArea: 47, minimumMarginRate: 25, minimumScore: 75, numberOfTowers: 12 }), result: json(snapshot.reverseZoning) } });
  await tx.urbanGapAnalysisRecord.create({ data: { landStudyVersionId: version.id, result: json(snapshot.gapAnalysis) } });
  await tx.urbanUpliftAnalysisRecord.create({ data: { landStudyVersionId: version.id, result: json(snapshot.upliftAnalysis) } });

  const before = previousParameters(previous?.snapshot as unknown as LandStudySnapshot | null);
  const after = previousParameters(snapshot)!;
  const candidateAuditKeys: [string, unknown, unknown][] = [
    ["polygon", (previous?.snapshot as unknown as LandStudySnapshot | undefined)?.landAsset.polygon, snapshot.landAsset.polygon],
    ["permittedUses", before?.permittedUses.value, after.permittedUses.value],
    ["maximumFAR", before?.maximumFAR.value, after.maximumFAR.value],
    ["occupancyRate", before?.occupancyRate.value, after.occupancyRate.value],
    ["permeabilityRate", before?.permeabilityRate.value, after.permeabilityRate.value],
    ["maximumHeight", before?.maximumHeight.value, after.maximumHeight.value],
    ["maximumFloors", before?.maximumFloors.value, after.maximumFloors.value],
    ["setbacks", before?.setbacks.value, after.setbacks.value],
    ["parkingRequirement", before?.parkingRequirement.value, after.parkingRequirement.value],
    ["residentialDensity", before?.residentialDensity.value, after.residentialDensity.value],
    ["product", (previous?.snapshot as unknown as LandStudySnapshot | undefined)?.options.find((option) => option.id === "land-option-a")?.product, snapshot.options.find((option) => option.id === "land-option-a")?.product],
  ];
  const auditKeys: [string, unknown, unknown][] = update
    ? candidateAuditKeys.filter(([, oldValue, newValue]) => JSON.stringify(oldValue) !== JSON.stringify(newValue))
    : [["INITIAL_SNAPSHOT", null, { versionNumber, scenario: snapshot.selectedScenarioId }]];
  await tx.landAuditLog.createMany({ data: auditKeys.map(([parameter, oldValue, newValue]) => ({
    organizationId: context.organizationId,
    landStudyId: study.id,
    userId: context.userId,
    parameter,
    previousValue: oldValue === null || oldValue === undefined ? Prisma.JsonNull : json(oldValue),
    newValue: json(newValue),
    origin: DbUrbanSourceType.USER_INPUT,
    justification,
  })) });

  await tx.landStudyVersion.update({ where: { id: version.id }, data: { snapshot: json(snapshot), versionStatus: LandVersionStatus.SNAPSHOT, lockedAt: new Date() } });
  await tx.landStudy.update({ where: { id: study.id }, data: { currentVersionNumber: versionNumber, updatedById: context.userId } });
  return { landStudyId: study.id, versionId: version.id, versionNumber, snapshot };
}

export async function getLatestLandStudyForOrganization(organizationId: string): Promise<LandWorkspaceView | null> {
  const version = await prisma.landStudyVersion.findFirst({
    where: { versionStatus: LandVersionStatus.SNAPSHOT, landStudy: { organizationId, landAsset: { organizationId } } },
    orderBy: { createdAt: "desc" },
    select: { id: true, versionNumber: true, snapshot: true },
  });
  return version ? toView(version) : null;
}

/**
 * Fechamento da 9K.1 (revisão pós-fechamento): variante escopada por projeto de
 * `getLatestLandStudyForOrganization`. A versão original busca "o terreno mais recente de toda a
 * organização" — com a troca de contexto real que a 9K.1 introduziu, isso podia mostrar na aba
 * Terreno de um projeto o terreno de OUTRO projeto da mesma organização (nunca de outra
 * organização — `organizationId` já era filtrado nos dois níveis — mas ainda assim uma
 * inconsistência real de contexto: "terreno exibido" deixava de corresponder a "projeto ativo").
 *
 * Usa a relação real e já existente `LandAsset.projectId` (FK opcional, `onDelete: SetNull`,
 * schema.prisma:2490-2511) — nunca o nome do projeto, nunca o `createdAt` mais recente da
 * organização. Se este projeto não tiver nenhum `LandAsset` vinculado, devolve `null` — nunca cai
 * para o terreno de outro projeto nem para o mais recente da organização. Não requer migration: o
 * campo e a FK já existem, só não são populados por nenhum fluxo de criação real hoje (o único
 * criador de `LandAsset`, `createDemoLandStudy`, é usado apenas por `prisma/seed.ts`, que depois
 * vincula manualmente o terreno de demonstração ao projeto START BUTANTÃ via
 * `prisma.landAsset.update({ data: { projectId } })` — não existe ainda uma ação de produto real
 * para "vincular este terreno a este projeto"; isso é uma lacuna de funcionalidade a ser endereçada
 * em fase futura, não algo que esta função deva inventar ou contornar).
 */
export async function getLatestLandStudyForProject(organizationId: string, projectId: string): Promise<LandWorkspaceView | null> {
  const version = await prisma.landStudyVersion.findFirst({
    where: { versionStatus: LandVersionStatus.SNAPSHOT, landStudy: { organizationId, landAsset: { organizationId, projectId } } },
    orderBy: { createdAt: "desc" },
    select: { id: true, versionNumber: true, snapshot: true },
  });
  return version ? toView(version) : null;
}

export async function getLandStudyForOrganization(organizationId: string, landStudyId: string): Promise<LandWorkspaceView | null> {
  const version = await prisma.landStudyVersion.findFirst({
    where: { versionStatus: LandVersionStatus.SNAPSHOT, landStudy: { id: landStudyId, organizationId, landAsset: { organizationId } } },
    orderBy: { versionNumber: "desc" },
    select: { id: true, versionNumber: true, snapshot: true },
  });
  return version ? toView(version) : null;
}

export async function createDemoLandStudy(context: Pick<AuthContext, "userId" | "organizationId">): Promise<LandWorkspaceView> {
  return prisma.$transaction(async (tx) => {
    const asset = await tx.landAsset.create({ data: {
      organizationId: context.organizationId,
      projectId: null,
      name: DEMO_LAND_ASSET.name,
      address: DEMO_LAND_ASSET.address,
      number: DEMO_LAND_ASSET.number,
      neighborhood: DEMO_LAND_ASSET.neighborhood,
      city: DEMO_LAND_ASSET.city,
      state: DEMO_LAND_ASSET.state,
      postalCode: DEMO_LAND_ASSET.postalCode,
      latitude: DEMO_LAND_ASSET.latitude,
      longitude: DEMO_LAND_ASSET.longitude,
      cadastralIdentifier: DEMO_LAND_ASSET.cadastralIdentifier,
      municipalRegistration: DEMO_LAND_ASSET.municipalRegistration,
      area: DEMO_LAND_ASSET.area,
      frontage: DEMO_LAND_ASSET.frontage,
      polygonGeometry: json(DEMO_LAND_ASSET.polygon),
      sourceRef: DEMO_LAND_ASSET.sourceId,
      createdById: context.userId,
      updatedById: context.userId,
    } });
    const study = await tx.landStudy.create({ data: { organizationId: context.organizationId, landAssetId: asset.id, name: "Estudo preliminar de potencial construtivo", createdById: context.userId, updatedById: context.userId } });
    return appendLandVersion(tx, context, study, null, "Criação do estudo demonstrativo REDE Land.");
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function ensureDemoLandStudy(context: Pick<AuthContext, "userId" | "organizationId">): Promise<LandWorkspaceView> {
  const existing = await getLatestLandStudyForOrganization(context.organizationId);
  return existing ?? createDemoLandStudy(context);
}

export async function saveUrbanScenarioSnapshot(context: Pick<AuthContext, "userId" | "organizationId">, input: UrbanScenarioUpdateInput): Promise<LandWorkspaceView> {
  return prisma.$transaction(async (tx) => {
    const study = await tx.landStudy.findFirst({ where: { id: input.landStudyId, organizationId: context.organizationId, landAsset: { organizationId: context.organizationId } } });
    if (!study) throw new Error("Estudo de terreno não encontrado nesta organização.");
    return appendLandVersion(tx, context, study, input, input.justification);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
