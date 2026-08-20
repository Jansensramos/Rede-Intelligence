import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { designFileStorage } from "@/infrastructure/storage/design-file-storage";
import { compareBimElements, detectBimClashes, type BimElementGeometry, type BimGeometryArtifact } from "@/domain/design/bim-geometry";
import { parseIfcGeometry } from "@/domain/design/bim-parser";
import type { BimWorkspaceView } from "@/domain/design";
import type { Prisma } from "@prisma/client";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const mutationRoles = new Set(["OWNER", "ADMIN", "MANAGER", "ANALYST"]);

function assertCanMutate(context: Pick<AuthContext, "role">) {
  if (!mutationRoles.has(context.role)) throw new Error("Seu perfil não permite alterar o modelo BIM.");
}

function artifactElementData(element: BimElementGeometry) {
  return { expressId: element.expressId, ifcGuid: element.ifcGuid, ifcType: element.ifcType, name: element.name, code: element.code, parentExpressId: element.parentExpressId, building: element.building, tower: element.tower, storey: element.storey, space: element.space, geometry: json({ chunks: element.chunks.length, triangles: element.chunks.reduce((total, chunk) => total + Math.floor(chunk.indices.length / 3), 0) }), bounds: json(element.bounds), centroid: json(element.centroid), properties: json(element.properties), quantities: json(element.quantities), fingerprint: element.fingerprint, confidence: "HIGH" as const };
}

export async function processIfcBimFile(context: Pick<AuthContext, "organizationId" | "userId">, fileId: string, jobId: string) {
  const file = await prisma.designFile.findFirst({ where: { id: fileId, fileType: "IFC", package: { organizationId: context.organizationId } }, include: { package: true } });
  if (!file) throw new Error("Arquivo IFC não encontrado nesta organização.");
  const model = await prisma.bimModel.upsert({ where: { fileId }, update: { status: "PROCESSING", errorMessage: null }, create: { organizationId: context.organizationId, projectId: file.package.projectId, packageId: file.packageId, revisionId: file.revisionId, fileId, status: "PROCESSING" } });
  const started = Date.now();
  try {
    await prisma.designProcessingJob.update({ where: { id: jobId }, data: { status: "GEOMETRY", progress: 45, adapter: "web-ifc", adapterVersion: "0.0.77" } });
    const bytes = await designFileStorage.read(file.storageKey);
    const artifact = await parseIfcGeometry(bytes);
    await prisma.designProcessingJob.update({ where: { id: jobId }, data: { status: "INDEXING", progress: 72 } });
    const encoded = new TextEncoder().encode(JSON.stringify(artifact));
    const stored = await designFileStorage.put({ organizationId: context.organizationId, packageId: file.packageId, fileName: `${file.id}.rede-bim.json`, bytes: encoded });
    await prisma.$transaction(async (tx) => {
      await tx.designClash.deleteMany({ where: { modelId: model.id } });
      await tx.bimElement.deleteMany({ where: { modelId: model.id } });
      if (artifact.elements.length) await tx.bimElement.createMany({ data: artifact.elements.map((element) => ({ modelId: model.id, ...artifactElementData(element) })) });
      await tx.bimModel.update({ where: { id: model.id }, data: { status: "PROCESSED", ifcSchema: artifact.schema, geometryKey: stored.key, geometryChecksum: stored.checksum, spatialTree: json(artifact.spatialTree), bounds: json(artifact.bounds), elementCount: artifact.elements.length, triangleCount: artifact.triangleCount, fragmentCount: artifact.elements.reduce((sum, element) => sum + element.chunks.length, 0), processingMs: Date.now() - started, loadEstimateMs: Math.round(encoded.length / 2_000_000 * 1000), processedAt: new Date() } });
    });
    const records = await prisma.bimElement.findMany({ where: { modelId: model.id } });
    const byExpressId = new Map(records.map((element) => [element.expressId, element]));
    const clashes = detectBimClashes(artifact.elements);
    if (clashes.length) await prisma.designClash.createMany({ data: clashes.map((clash) => { const a = byExpressId.get(clash.a); const b = byExpressId.get(clash.b); return { modelId: model.id, revisionId: file.revisionId, elementAId: a?.id, elementBId: b?.id, clashType: clash.type, elementA: json({ expressId: a?.expressId, guid: a?.ifcGuid, type: a?.ifcType, name: a?.name }), elementB: json({ expressId: b?.expressId, guid: b?.ifcGuid, type: b?.ifcType, name: b?.name }), geometry: json({ method: clash.type === "HARD" ? "AABB_BROAD_PHASE_TRIANGLE_INTERSECTION_V1" : "AABB_PROXIMITY_V1" }), coordinate: json(clash.coordinate), description: clash.type === "HARD" ? "Interseção detectada entre triângulos das malhas dos elementos, após broad phase por caixa envolvente." : clash.type === "DUPLICATE" ? "Elementos com geometria e propriedades praticamente coincidentes." : "Elementos dentro do afastamento configurado.", severity: clash.severity, confidence: clash.confidence, status: "OPEN", origin: "CALCULATED" }; }) });
    await persistBimMetrics(file.revisionId, file.id, artifact);
    await persistDetectedUnits(file.revisionId, file.id, artifact);
    await persistBimComparison(file.packageId, file.revisionId, artifact);
    await prisma.designProcessingJob.update({ where: { id: jobId }, data: { status: "COMPLETED", progress: 100, result: json({ bimModelId: model.id, elements: artifact.elements.length, triangles: artifact.triangleCount, clashes: clashes.length, processingMs: Date.now() - started }), completedAt: new Date() } });
    await prisma.designFile.update({ where: { id: fileId }, data: { status: "READY", processingStatus: "COMPLETED", processingMetadata: json({ adapter: "web-ifc", adapterVersion: "0.0.77", bimModelId: model.id, elementCount: artifact.elements.length, triangleCount: artifact.triangleCount, geometryChecksum: stored.checksum, provenance: "EXTRACTED" }) } });
    return getBimWorkspace(context.organizationId, model.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida no processamento geométrico IFC.";
    await prisma.$transaction([prisma.bimModel.update({ where: { id: model.id }, data: { status: "ERROR", errorMessage: message } }), prisma.designProcessingJob.update({ where: { id: jobId }, data: { status: "FAILED", errorCode: "IFC_GEOMETRY_FAILED", errorMessage: message, completedAt: new Date() } }), prisma.designFile.update({ where: { id: fileId }, data: { status: "FAILED", processingStatus: "FAILED" } })]);
    throw error;
  }
}

async function persistBimMetrics(revisionId: string, fileId: string, artifact: BimGeometryArtifact) {
  await prisma.designMetric.deleteMany({ where: { revisionId, sourceFileId: fileId, method: { startsWith: "WEB_IFC_" } } });
  const spaces = artifact.elements.filter((element) => element.ifcType === "IFCSPACE");
  const units = spaces.filter((element) => /unidade|apartamento|apto|unit/i.test(element.name ?? ""));
  const totalSpaceArea = spaces.reduce((sum, element) => sum + element.quantities.boundingArea.value, 0);
  const privateArea = units.reduce((sum, element) => sum + element.quantities.boundingArea.value, 0);
  const metricRows: Prisma.DesignMetricCreateManyInput[] = [
    { revisionId, entityType: "BIM_MODEL", name: "BIM_ELEMENT_COUNT", value: artifact.elements.length, unit: "elementos", origin: "EXTRACTED" as const, confidence: "HIGH" as const, sourceFileId: fileId, method: "WEB_IFC_GEOMETRY_V1", evidence: json([{ ref: `FILE:${fileId}:BIM_ELEMENT_COUNT`, origin: "EXTRACTED", confidence: "HIGH" }]) },
    { revisionId, entityType: "BIM_MODEL", name: "BIM_TRIANGLE_COUNT", value: artifact.triangleCount, unit: "triângulos", origin: "EXTRACTED" as const, confidence: "HIGH" as const, sourceFileId: fileId, method: "WEB_IFC_GEOMETRY_V1", evidence: json([{ ref: `FILE:${fileId}:BIM_TRIANGLE_COUNT`, origin: "EXTRACTED", confidence: "HIGH" }]) },
  ];
  if (spaces.length) metricRows.push(
    { revisionId, entityType: "BIM_MODEL", name: "TOTAL_BUILT_AREA_M2", value: totalSpaceArea, unit: "m²", origin: "CALCULATED", confidence: "LOW", sourceFileId: fileId, method: "WEB_IFC_BOUNDING_FOOTPRINT_V1", evidence: json([{ ref: `FILE:${fileId}:IFCSPACE_AREA`, origin: "CALCULATED", confidence: "LOW", note: "Soma das projeções das caixas envolventes de IfcSpace; exige validação profissional." }]) },
    { revisionId, entityType: "BIM_MODEL", name: "PRIVATE_AREA_M2", value: privateArea, unit: "m²", origin: "CALCULATED", confidence: "LOW", sourceFileId: fileId, method: "WEB_IFC_BOUNDING_FOOTPRINT_V1", evidence: json([{ ref: `FILE:${fileId}:UNIT_SPACE_AREA`, origin: "CALCULATED", confidence: "LOW" }]) },
    { revisionId, entityType: "BIM_MODEL", name: "UNIT_COUNT", value: units.length, unit: "unidades", origin: "CALCULATED", confidence: "LOW", sourceFileId: fileId, method: "WEB_IFC_SPACE_CLASSIFICATION_V1", evidence: json([{ ref: `FILE:${fileId}:UNIT_SPACES`, origin: "INFERRED", confidence: "LOW" }]) },
    { revisionId, entityType: "BIM_MODEL", name: "EFFICIENCY_RATE", value: totalSpaceArea > 0 ? privateArea / totalSpaceArea : 0, unit: "ratio", origin: "CALCULATED", confidence: "LOW", sourceFileId: fileId, method: "WEB_IFC_SPACE_CLASSIFICATION_V1", evidence: json([{ ref: `FILE:${fileId}:EFFICIENCY`, origin: "CALCULATED", confidence: "LOW" }]) },
  );
  await prisma.designMetric.createMany({ data: metricRows });
}

async function persistDetectedUnits(revisionId: string, fileId: string, artifact: BimGeometryArtifact) {
  await prisma.detectedUnit.deleteMany({ where: { revisionId, sourceFileId: fileId } });
  const units = artifact.elements.filter((element) => element.ifcType === "IFCSPACE" && /unidade|apartamento|apto|unit/i.test(element.name ?? ""));
  if (units.length) await prisma.detectedUnit.createMany({ data: units.map((element) => ({ revisionId, sourceFileId: fileId, unitKey: element.ifcGuid ?? `IFCSPACE:${element.expressId}`, unitType: element.name ?? "Unidade não classificada", floor: element.storey, privateArea: element.quantities.boundingArea.value, confidence: "LOW", origin: "INFERRED", geometryRef: json({ expressId: element.expressId, bounds: element.bounds }) })) });
}

async function persistBimComparison(packageId: string, revisionId: string, current: BimGeometryArtifact) {
  const revision = await prisma.designRevision.findUnique({ where: { id: revisionId } });
  if (!revision?.sourceRevisionId) return;
  const previousModel = await prisma.bimModel.findFirst({ where: { revisionId: revision.sourceRevisionId, status: "PROCESSED", geometryKey: { not: null } }, orderBy: { processedAt: "desc" } });
  if (!previousModel?.geometryKey) return;
  const previous = JSON.parse(new TextDecoder().decode(await designFileStorage.read(previousModel.geometryKey))) as BimGeometryArtifact;
  const changes = compareBimElements(previous.elements, current.elements);
  const summary = Object.fromEntries(["ADDED", "REMOVED", "MODIFIED", "UNCHANGED"].map((kind) => [kind, changes.filter((change) => change.kind === kind).length]));
  await prisma.bimRevisionComparison.upsert({ where: { packageId_revisionFromId_revisionToId: { packageId, revisionFromId: revision.sourceRevisionId, revisionToId: revisionId } }, update: { summary: json(summary), changes: json(changes), tolerance: json({ strategy: "IFC_GUID_THEN_FINGERPRINT", coordinateToleranceM: 0.001 }) }, create: { packageId, revisionFromId: revision.sourceRevisionId, revisionToId: revisionId, summary: json(summary), changes: json(changes), tolerance: json({ strategy: "IFC_GUID_THEN_FINGERPRINT", coordinateToleranceM: 0.001 }) } });
}

export async function getBimWorkspace(organizationId: string, modelId: string): Promise<BimWorkspaceView> {
  const model = await prisma.bimModel.findFirst({ where: { id: modelId, organizationId, package: { organizationId } }, include: { elements: { orderBy: [{ storey: "asc" }, { ifcType: "asc" }, { expressId: "asc" }] }, clashes: { orderBy: [{ severity: "desc" }, { createdAt: "desc" }] } } });
  if (!model) throw new Error("Modelo BIM não encontrado nesta organização.");
  const comparison = await prisma.bimRevisionComparison.findFirst({ where: { packageId: model.packageId, revisionToId: model.revisionId }, orderBy: { createdAt: "desc" } });
  const detectedUnits = await prisma.detectedUnit.findMany({ where: { revisionId: model.revisionId, sourceFileId: model.fileId }, orderBy: [{ floor: "asc" }, { unitKey: "asc" }] });
  return { model: { id: model.id, fileId: model.fileId, revisionId: model.revisionId, status: model.status, schema: model.ifcSchema, elementCount: model.elementCount, triangleCount: model.triangleCount, processingMs: model.processingMs, bounds: model.bounds, processedAt: model.processedAt?.toISOString() ?? null }, elements: model.elements.map((element) => ({ id: element.id, expressId: element.expressId, guid: element.ifcGuid, type: element.ifcType, name: element.name, code: element.code, building: element.building, tower: element.tower, storey: element.storey, space: element.space, bounds: element.bounds, centroid: element.centroid, properties: element.properties, quantities: element.quantities, confidence: element.confidence })), clashes: model.clashes.map((clash) => ({ id: clash.id, type: clash.clashType, status: clash.status, severity: clash.severity, confidence: clash.confidence, description: clash.description, elementAId: clash.elementAId, elementBId: clash.elementBId, elementA: clash.elementA, elementB: clash.elementB, coordinate: clash.coordinate, findingId: clash.findingId })), detectedUnits: detectedUnits.map((unit) => ({ id: unit.id, key: unit.unitKey, type: unit.unitType, floor: unit.floor, privateArea: unit.privateArea === null ? null : Number(unit.privateArea), confidence: unit.confidence, origin: unit.origin })), comparison: comparison ? { summary: comparison.summary, changes: comparison.changes, tolerance: comparison.tolerance } : null };
}

export async function getLatestBimWorkspace(organizationId: string, packageId: string) {
  const model = await prisma.bimModel.findFirst({ where: { organizationId, packageId }, orderBy: { createdAt: "desc" } });
  return model ? getBimWorkspace(organizationId, model.id) : null;
}

export async function getBimArtifact(organizationId: string, modelId: string) {
  const model = await prisma.bimModel.findFirst({ where: { id: modelId, organizationId, status: "PROCESSED", geometryKey: { not: null } } });
  if (!model?.geometryKey) throw new Error("Geometria BIM ainda não está disponível.");
  return { bytes: await designFileStorage.read(model.geometryKey), checksum: model.geometryChecksum };
}

export async function createFindingFromClash(context: AuthContext, clashId: string) {
  assertCanMutate(context);
  const clash = await prisma.designClash.findFirst({ where: { id: clashId, revision: { package: { organizationId: context.organizationId } } }, include: { revision: { include: { package: true } } } });
  if (!clash) throw new Error("Conflito BIM não encontrado nesta organização.");
  if (clash.findingId) return clash.findingId;
  const finding = await prisma.designFinding.create({ data: { organizationId: context.organizationId, projectId: clash.revision.package.projectId, packageId: clash.revision.packageId, revisionId: clash.revisionId, discipline: "BIM", category: "COMPATIBILIZAÇÃO BIM", type: "COORDINATION", severity: clash.severity, confidence: clash.confidence, title: `Conflito BIM · ${clash.clashType}`, description: clash.description, implication: "O conflito deve ser validado pelos projetistas responsáveis antes de qualquer decisão.", recommendation: "Abrir o conflito no modelo, revisar os elementos e registrar a resposta técnica.", evidenceRefs: json([`BIM_CLASH:${clash.id}`]), geometryRef: clash.coordinate ? json({ coordinate: clash.coordinate }) : undefined, elementRefs: json([clash.elementA, clash.elementB]), status: "OPEN", priority: clash.severity, createdById: context.userId } });
  await prisma.designClash.update({ where: { id: clash.id }, data: { findingId: finding.id, status: "UNDER_REVIEW" } });
  return finding.id;
}
