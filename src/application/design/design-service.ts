import type { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { getLatestStudyForOrganization } from "@/application/studies/study-service";
import {
  createAlternativeSchema,
  createDesignDemoReviewInput,
  createDesignPackageSchema,
  createDesignRevisionSchema,
  createFindingSchema,
  manualScaleCalibration,
  compareDesignMetrics,
  processDesignFile,
  reviewDesign,
  SUPPORTED_DESIGN_FORMATS,
  uploadDesignFileSchema,
  validateDesignUpload,
  type DesignConfidence,
  type DesignEvidence,
  type DesignFindingDraft,
  type DesignMetricInput,
  type DesignReviewInput,
  type DesignReviewOutput,
  type DesignWorkspaceView,
  type VEOpportunityDraft,
} from "@/domain/design";
import { calculateAllScenarios } from "@/domain/financial/engine";
import type { ProjectAssumptions } from "@/domain/financial/types";
import { calculateRedeScore } from "@/domain/score";
import { calculateSensitivity } from "@/domain/sensitivity";
import { prisma } from "@/infrastructure/database/prisma";
import { designFileStorage } from "@/infrastructure/storage/design-file-storage";
import { inspectUpload } from "@/infrastructure/storage/upload-policy";
import { enqueueJob } from "@/application/integrations/job-runner";
import { getLatestBimWorkspace, processIfcBimFile } from "./bim-service";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const record = (value: Prisma.JsonValue | null | undefined) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const array = (value: Prisma.JsonValue | null | undefined) => Array.isArray(value) ? value : [];

function assertCanMutate(context: Pick<AuthContext, "role">) {
  if (context.role === "VIEWER") throw new Error("Seu papel possui acesso somente para leitura.");
}

function disciplineDocumentCategory(discipline: string) {
  if (discipline === "ARCHITECTURE") return "ARCHITECTURE";
  if (["STRUCTURAL", "FOUNDATION"].includes(discipline)) return "STRUCTURAL";
  if (["ELECTRICAL", "PLUMBING", "HVAC", "FIRE"].includes(discipline)) return "MEP";
  if (discipline === "BIM") return "BIM";
  if (discipline === "COST") return "VALUE_ENGINEERING";
  return "PROJECT_REVIEW";
}

async function packageForTenant(organizationId: string, packageId: string) {
  const designPackage = await prisma.designProjectPackage.findFirst({ where: { id: packageId, organizationId, project: { organizationId } } });
  if (!designPackage) throw new Error("Project Package não encontrado nesta organização.");
  return designPackage;
}

function reviewContexts(designPackage: { brief: Prisma.JsonValue | null; targets: Prisma.JsonValue | null }) {
  const targets = record(designPackage.targets);
  return {
    brief: Object.keys(record(designPackage.brief)).length ? record(designPackage.brief) as DesignReviewInput["brief"] : undefined,
    urban: Object.keys(record(targets.urban as Prisma.JsonValue)).length ? record(targets.urban as Prisma.JsonValue) as unknown as DesignReviewInput["urban"] : undefined,
    economics: Object.keys(record(targets.economics as Prisma.JsonValue)).length ? record(targets.economics as Prisma.JsonValue) as unknown as DesignReviewInput["economics"] : undefined,
    documents: array(targets.documents as Prisma.JsonValue) as unknown as DesignReviewInput["documents"],
  };
}

function evidenceFromMetric(metric: { id: string; name: string; value: Prisma.Decimal; unit: string; origin: string; confidence: string; method: string; evidence: Prisma.JsonValue | null; sourceFileId: string | null; sourceSheetId: string | null }): DesignEvidence[] {
  const stored = array(metric.evidence);
  if (stored.length) return stored as unknown as DesignEvidence[];
  return [{ ref: `DESIGN_METRIC:${metric.id}`, label: metric.name, value: `${metric.value.toString()} ${metric.unit}`, origin: metric.origin as DesignEvidence["origin"], confidence: metric.confidence as DesignConfidence, fileId: metric.sourceFileId ?? undefined, sheetId: metric.sourceSheetId ?? undefined, method: metric.method }];
}

async function runReview(context: Pick<AuthContext, "organizationId" | "userId">, packageId: string, revisionId: string) {
  const designPackage = await prisma.designProjectPackage.findFirstOrThrow({ where: { id: packageId, organizationId: context.organizationId }, include: { project: true } });
  const revision = await prisma.designRevision.findFirstOrThrow({ where: { id: revisionId, packageId }, include: { files: { include: { sheets: true } }, metrics: true } });
  const contexts = reviewContexts(designPackage);
  const reviewInput: DesignReviewInput = {
    revisionId,
    projectName: designPackage.project.name,
    reviewMode: designPackage.reviewMode,
    brief: contexts.brief,
    urban: contexts.urban,
    economics: contexts.economics,
    documents: revision.files.length ? revision.files.map((file) => {
      const metadata = record(file.processingMetadata);
      return { id: file.id, name: file.fileName, extension: file.fileType.toLowerCase(), discipline: file.discipline, pageCount: file.sheets.length, scaleConfidence: file.sheets.some((sheet) => sheet.scaleConfidence === "CONFIRMED") ? "CONFIRMED" : (file.sheets[0]?.scaleConfidence ?? "UNKNOWN"), support: (metadata.support as "SUPPORTED" | "PARTIAL" | "CONVERSION_REQUIRED" | "UNSUPPORTED") ?? (file.status === "READY" ? "SUPPORTED" : "PARTIAL") };
    }) : contexts.documents,
    metrics: revision.metrics.map((metric) => ({ name: metric.name, value: Number(metric.value), unit: metric.unit, entityType: metric.entityType, entityId: metric.entityId ?? undefined, origin: metric.origin, confidence: metric.confidence, evidence: evidenceFromMetric(metric) })),
    areaToleranceM2: 20,
    areaToleranceRate: 0.01,
  };
  const output = reviewDesign(reviewInput);
  const automatedKeys = output.findings.map((finding) => finding.key);
  const existingAutomated = await prisma.designFinding.findMany({ where: { packageId, revisionId, sourceRuleKey: { not: null } }, select: { id: true, sourceRuleKey: true, status: true } });
  const removable = existingAutomated.filter((finding) => finding.sourceRuleKey && !automatedKeys.includes(finding.sourceRuleKey) && ["OPEN", "UNDER_REVIEW", "POSSIBLY_RESOLVED"].includes(finding.status)).map((finding) => finding.id);
  const roundCount = await prisma.designReviewRound.count({ where: { packageId } });

  await prisma.$transaction(async (tx) => {
    await tx.designMetric.deleteMany({ where: { revisionId, origin: "CALCULATED" } });
    const derived = output.calculatedMetrics.filter((metric) => metric.origin === "CALCULATED");
    if (derived.length) await tx.designMetric.createMany({ data: derived.map((metric) => ({ revisionId, entityType: metric.entityType ?? "REVISION", entityId: metric.entityId, name: metric.name, value: metric.value, unit: metric.unit, origin: metric.origin, confidence: metric.confidence, method: "REDE_DESIGN_REVIEW_V1", evidence: json(metric.evidence) })) });
    if (removable.length) await tx.designFinding.updateMany({ where: { id: { in: removable } }, data: { status: "POSSIBLY_RESOLVED" } });
    for (const finding of output.findings) {
      const existing = await tx.designFinding.findFirst({ where: { packageId, revisionId, sourceRuleKey: finding.key } });
      const data = {
        organizationId: context.organizationId,
        projectId: designPackage.projectId,
        packageId,
        revisionId,
        discipline: finding.discipline as never,
        category: finding.category,
        type: finding.type as never,
        severity: finding.severity,
        confidence: finding.confidence,
        title: finding.title,
        description: finding.description,
        implication: finding.implication,
        recommendation: finding.recommendation,
        evidenceRefs: json(finding.evidence.map((item) => item.ref)),
        geometryRef: finding.evidence.find((item) => item.region) ? json(finding.evidence.find((item) => item.region)!.region) : undefined,
        relatedMetric: finding.relatedMetric,
        potentialImpact: finding.potentialImpact ? json(finding.potentialImpact) : undefined,
        sourceRuleKey: finding.key,
        createdById: context.userId,
      };
      const row = existing ? await tx.designFinding.update({ where: { id: existing.id }, data: { ...data, status: existing.status === "POSSIBLY_RESOLVED" ? "OPEN" : existing.status } }) : await tx.designFinding.create({ data });
      await tx.designFindingEvidence.deleteMany({ where: { findingId: row.id } });
      if (finding.evidence.length) await tx.designFindingEvidence.createMany({ data: finding.evidence.map((evidence) => ({ findingId: row.id, ref: evidence.ref, label: evidence.label, value: evidence.value, sourceType: evidence.origin, confidence: evidence.confidence, location: evidence.region ? json({ page: evidence.page, region: evidence.region }) : undefined, metadata: json({ method: evidence.method, fileId: evidence.fileId, sheetId: evidence.sheetId, elementId: evidence.elementId }) })) });
    }
    await tx.vEOpportunity.deleteMany({ where: { packageId, revisionId, status: "IDENTIFIED" } });
    if (output.opportunities.length) await tx.vEOpportunity.createMany({ data: output.opportunities.map((opportunity) => ({ packageId, revisionId, title: opportunity.title, category: opportunity.category as never, currentCondition: opportunity.currentCondition, proposedCondition: opportunity.proposedCondition, evidenceRefs: json(opportunity.evidence.map((item) => item.ref)), relatedFindingIds: json(opportunity.relatedFindingKeys), designImpact: json({ ...opportunity.designImpact, valueRank: opportunity.valueRank }), costImpact: opportunity.costImpact, revenueImpact: opportunity.revenueImpact, scheduleImpactMonths: opportunity.scheduleImpactMonths, riskImpact: opportunity.riskImpact, confidence: opportunity.confidence, effort: opportunity.effort, requiresProfessionalValidation: true, createdById: context.userId })) });
    await tx.designReviewRound.create({ data: { packageId, revisionId, roundNumber: roundCount + 1, mode: designPackage.reviewMode, status: "AUTOMATED_REVIEW", preflightStatus: output.preflight.status, limitations: json(output.preflight.limitations), summary: json({ schemaVersion: output.schemaVersion, scorecard: output.scorecard, summary: output.summary, insights: output.insights, missingInformation: output.preflight.missingInformation }), startedById: context.userId, startedAt: new Date(), completedAt: new Date() } });
    await tx.designProjectPackage.update({ where: { id: packageId }, data: { status: output.preflight.status === "NOT_READY" ? "PARTIALLY_PROCESSED" : "READY", preflightStatus: output.preflight.status, preflightLimits: json([...output.preflight.limitations, ...output.preflight.missingInformation]), currentRevisionId: revisionId } });
    await tx.designRevision.update({ where: { id: revisionId }, data: { status: output.preflight.status === "NOT_READY" ? "PARTIALLY_PROCESSED" : "READY" } });
    await tx.designAuditLog.create({ data: { organizationId: context.organizationId, packageId, userId: context.userId, action: "AUTOMATED_REVIEW_COMPLETED", entityType: "DesignRevision", entityId: revisionId, after: json(output.summary), metadata: json({ reviewVersion: output.schemaVersion, limitations: output.preflight.limitations }) } });
  });
  return output;
}

async function createDemoPackage(context: Pick<AuthContext, "organizationId" | "userId">, projectId: string, investmentCaseId?: string) {
  const input = createDesignDemoReviewInput();
  const designPackage = await prisma.designProjectPackage.create({ data: { organizationId: context.organizationId, projectId, investmentCaseId, name: "Projeto Arquitetônico · Demo derivada", description: "Pacote demonstrativo da Fase 8. Métricas de entrada são identificadas; findings e oportunidades são derivados pelo Review Engine.", disciplineSet: json(["ARCHITECTURE", "STRUCTURAL", "BIM"]), template: "RESIDENTIAL_VERTICAL", status: "PROCESSING", reviewMode: "FULL_REVIEW", preflightStatus: "READY_WITH_LIMITATIONS", brief: json(input.brief), targets: json({ urban: input.urban, economics: input.economics, documents: input.documents }), createdById: context.userId } });
  const revision = await prisma.designRevision.create({ data: { packageId: designPackage.id, versionNumber: 1, label: "PROJECT V1 · Rev 04", description: "Baseline demonstrativa", status: "PROCESSING", createdById: context.userId } });
  await prisma.designProjectPackage.update({ where: { id: designPackage.id }, data: { currentRevisionId: revision.id, baselineRevisionId: revision.id } });
  await prisma.designBaseline.create({ data: { packageId: designPackage.id, revisionId: revision.id, name: "Baseline do estudo", targets: json(input.brief), metrics: json(input.economics), frozenById: context.userId } });
  await prisma.designRequirement.createMany({ data: [
    { packageId: designPackage.id, key: "TARGET_UNITS", category: "PRODUCT", title: "Quantidade de unidades", requiredValue: json({ value: input.brief?.targetUnits, unit: "units" }), status: "NOT_VERIFIED", evidenceRefs: json(["PROJECT_BRIEF:TARGET_UNITS"]), createdById: context.userId },
    { packageId: designPackage.id, key: "TARGET_EFFICIENCY", category: "EFFICIENCY", title: "Eficiência privativa", requiredValue: json({ value: input.brief?.targetEfficiencyRate, unit: "ratio" }), status: "NOT_VERIFIED", evidenceRefs: json(["PROJECT_BRIEF:TARGET_EFFICIENCY"]), createdById: context.userId },
  ] });
  await prisma.designMetric.createMany({ data: input.metrics.map((metric) => ({ revisionId: revision.id, entityType: "REVISION", name: metric.name, value: metric.value, unit: metric.unit, origin: metric.origin, confidence: metric.confidence, method: metric.evidence[0]?.method ?? "DEMO_VERIFIED_INPUT", evidence: json(metric.evidence) })) });
  await runReview(context, designPackage.id, revision.id);
  return designPackage.id;
}

export async function ensureDesignWorkspace(context: Pick<AuthContext, "organizationId" | "userId">, projectId?: string): Promise<DesignWorkspaceView> {
  const project = await prisma.project.findFirst({ where: { organizationId: context.organizationId, ...(projectId ? { id: projectId } : {}) }, orderBy: { updatedAt: "desc" } });
  if (!project) throw new Error("Crie um empreendimento antes de iniciar o Design Intelligence.");
  let designPackage = await prisma.designProjectPackage.findFirst({ where: { organizationId: context.organizationId, projectId: project.id }, orderBy: { updatedAt: "desc" } });
  if (!designPackage) {
    const investmentCase = await prisma.investmentCase.findFirst({ where: { organizationId: context.organizationId, projectId: project.id }, orderBy: { updatedAt: "desc" } });
    const id = await createDemoPackage(context, project.id, investmentCase?.id);
    designPackage = await prisma.designProjectPackage.findUniqueOrThrow({ where: { id } });
  }
  return getDesignWorkspace(context.organizationId, designPackage.id);
}

export async function createDesignPackage(context: AuthContext, raw: unknown) {
  assertCanMutate(context);
  const input = createDesignPackageSchema.parse(raw);
  const project = await prisma.project.findFirst({ where: { id: input.projectId, organizationId: context.organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  const latest = await prisma.designProjectPackage.aggregate({ where: { organizationId: context.organizationId, projectId: input.projectId, name: input.name }, _max: { version: true } });
  const designPackage = await prisma.designProjectPackage.create({ data: { organizationId: context.organizationId, projectId: input.projectId, investmentCaseId: input.investmentCaseId, name: input.name, description: input.description, disciplineSet: json([]), version: (latest._max.version ?? 0) + 1, template: input.template, reviewMode: input.reviewMode, createdById: context.userId } });
  const revision = await prisma.designRevision.create({ data: { packageId: designPackage.id, versionNumber: 1, label: "PROJECT V1", status: "UPLOADING", createdById: context.userId } });
  await prisma.designProjectPackage.update({ where: { id: designPackage.id }, data: { currentRevisionId: revision.id } });
  await prisma.designAuditLog.create({ data: { organizationId: context.organizationId, packageId: designPackage.id, userId: context.userId, action: "PACKAGE_CREATED", entityType: "DesignProjectPackage", entityId: designPackage.id, after: json(input) } });
  return getDesignWorkspace(context.organizationId, designPackage.id);
}

export async function createDesignRevision(context: AuthContext, raw: unknown) {
  assertCanMutate(context);
  const input = createDesignRevisionSchema.parse(raw);
  const designPackage = await packageForTenant(context.organizationId, input.packageId);
  const latest = await prisma.designRevision.findFirst({ where: { packageId: designPackage.id }, orderBy: { versionNumber: "desc" } });
  const revision = await prisma.designRevision.create({ data: { packageId: designPackage.id, versionNumber: (latest?.versionNumber ?? 0) + 1, label: input.label, description: input.description, status: "UPLOADING", sourceRevisionId: designPackage.currentRevisionId ?? latest?.id, createdById: context.userId } });
  await prisma.designProjectPackage.update({ where: { id: designPackage.id }, data: { currentRevisionId: revision.id, status: "UPLOADING", preflightStatus: "NOT_READY", preflightLimits: json(["Nova revisão ainda não processada."]) } });
  await prisma.designAuditLog.create({ data: { organizationId: context.organizationId, packageId: designPackage.id, userId: context.userId, action: "REVISION_CREATED", entityType: "DesignRevision", entityId: revision.id, after: json({ versionNumber: revision.versionNumber, label: revision.label, sourceRevisionId: revision.sourceRevisionId }) } });
  return getDesignWorkspace(context.organizationId, designPackage.id);
}

export async function uploadAndProcessDesignFile(context: AuthContext, raw: { packageId: string; revisionId: string; discipline: string; revision: string; file: File }, options: { deferProcessing?: boolean } = {}) {
  assertCanMutate(context);
  const input = uploadDesignFileSchema.parse(raw);
  const designPackage = await packageForTenant(context.organizationId, input.packageId);
  const revision = await prisma.designRevision.findFirst({ where: { id: input.revisionId, packageId: designPackage.id } });
  if (!revision) throw new Error("Revisão não pertence ao Project Package informado.");
  const bytes = new Uint8Array(await raw.file.arrayBuffer());
  const validation = validateDesignUpload({ fileName: raw.file.name, mimeType: raw.file.type, bytes });
  const inspection = await inspectUpload({ fileName: raw.file.name, bytes });
  const checksum = inspection.checksum;
  const duplicate = await prisma.designFile.findFirst({ where: { packageId: designPackage.id, revisionId: revision.id, checksum } });
  if (duplicate) return getDesignWorkspace(context.organizationId, designPackage.id);
  const stored = await designFileStorage.put({ organizationId: context.organizationId, packageId: designPackage.id, fileName: raw.file.name, bytes });
  const documentVersion = designPackage.investmentCaseId ? await prisma.projectDocument.count({ where: { investmentCaseId: designPackage.investmentCaseId, title: raw.file.name } }) + 1 : 1;
  const document = designPackage.investmentCaseId ? await prisma.projectDocument.create({ data: { investmentCaseId: designPackage.investmentCaseId, category: disciplineDocumentCategory(input.discipline), title: raw.file.name, version: documentVersion, status: "RECEIVED", confidentiality: "STRICTLY_CONFIDENTIAL", fileName: raw.file.name, mimeType: validation.mimeType, fileSize: stored.size, checksum: stored.checksum, source: "DESIGN_INTELLIGENCE_PRIVATE_STORAGE", metadata: json({ provider: stored.provider, storageKey: stored.key, designPackageId: designPackage.id, revisionId: revision.id }), createdById: context.userId } }) : null;
  const file = await prisma.designFile.create({ data: { packageId: designPackage.id, revisionId: revision.id, documentId: document?.id, fileName: raw.file.name, fileType: validation.extension.toUpperCase(), mimeType: validation.mimeType, discipline: input.discipline, revision: input.revision, status: "VALIDATED", checksum: stored.checksum, fileSize: stored.size, storageProvider: stored.provider, storageKey: stored.key, uploadedById: context.userId, processingStatus: "QUEUED", processingMetadata: json({ validation: { mime: validation.mimeType, extension: validation.extension, checksumAlgorithm: "SHA-256", malwareScanner: inspection.scanner }, untrusted: true }) }, include: { jobs: true } });
  const job = await prisma.designProcessingJob.create({ data: { fileId: file.id, status: "QUEUED", progress: 0 } });
  if (file.fileType === "IFC") await prisma.bimModel.create({ data: { organizationId: context.organizationId, projectId: designPackage.projectId, packageId: designPackage.id, revisionId: revision.id, fileId: file.id, status: "UPLOADED" } });
  await prisma.designProjectPackage.update({ where: { id: designPackage.id }, data: { status: "PROCESSING", disciplineSet: json([...new Set([...array(designPackage.disciplineSet).map(String), input.discipline])]) } });
  await prisma.designAuditLog.create({ data: { organizationId: context.organizationId, packageId: designPackage.id, userId: context.userId, action: "FILE_UPLOADED", entityType: "DesignFile", entityId: file.id, after: json({ fileName: file.fileName, checksum, discipline: input.discipline, revision: input.revision, documentId: document?.id }) } });
  if (options.deferProcessing) {
    await enqueueJob({ organizationId: context.organizationId, jobType: "PROCESS_DESIGN_FILE", payload: { fileId: file.id, designJobId: job.id, userId: context.userId }, correlationId: `design:${file.id}` });
  } else await processStoredFile(context, file.id, job.id);
  return getDesignWorkspace(context.organizationId, designPackage.id);
}

export async function processStoredFile(context: Pick<AuthContext, "organizationId" | "userId">, fileId: string, jobId: string) {
  const file = await prisma.designFile.findFirst({ where: { id: fileId, package: { organizationId: context.organizationId } }, include: { package: true } });
  if (!file) throw new Error("Arquivo não encontrado nesta organização.");
  await prisma.designProcessingJob.update({ where: { id: jobId }, data: { status: "VALIDATING", progress: 10, attempts: { increment: 1 }, startedAt: new Date() } });
  try {
    const bytes = await designFileStorage.read(file.storageKey);
    await prisma.designProcessingJob.update({ where: { id: jobId }, data: { status: "EXTRACTING", progress: 35 } });
    if (file.fileType === "IFC") {
      await processIfcBimFile(context, fileId, jobId);
      await runReview(context, file.packageId, file.revisionId);
      return;
    }
    const result = await processDesignFile({ fileName: file.fileName, mimeType: file.mimeType, bytes });
    await prisma.designProcessingJob.update({ where: { id: jobId }, data: { status: "ANALYZING", progress: 65, adapter: result.adapter, adapterVersion: result.version } });
    await prisma.$transaction(async (tx) => {
      await tx.designSheet.deleteMany({ where: { fileId } });
      if (result.sheets.length) await tx.designSheet.createMany({ data: result.sheets.map((sheet) => ({ fileId, pageNumber: sheet.pageNumber, title: sheet.title, sheetNumber: sheet.sheetNumber, revision: sheet.revision, discipline: file.discipline, widthPoints: sheet.widthPoints, heightPoints: sheet.heightPoints, scaleDenominator: sheet.scaleDenominator, scaleConfidence: sheet.scaleConfidence, extractedText: sheet.extractedText, textConfidence: sheet.textConfidence, metadata: sheet.metadata ? json(sheet.metadata) : undefined })) });
      for (const item of result.extracted.filter((item) => typeof item.value === "number")) await tx.designMetric.create({ data: { revisionId: file.revisionId, entityType: item.kind, name: item.key.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase(), value: Number(item.value), unit: item.unit ?? "count", origin: item.origin, confidence: item.confidence, sourceFileId: file.id, method: item.method, evidence: json([{ ref: `FILE:${file.id}:${item.key}`, label: `${file.fileName} · ${item.key}`, value: String(item.value), origin: item.origin, confidence: item.confidence, fileId: file.id, method: item.method }]) } });
      await tx.designFile.update({ where: { id: fileId }, data: { status: result.support === "CONVERSION_REQUIRED" ? "UNSUPPORTED" : result.status === "COMPLETED" ? "READY" : "PARTIAL", processingStatus: result.status === "COMPLETED" ? "COMPLETED" : "PARTIAL", processingMetadata: json({ ...result.metadata, adapter: result.adapter, adapterVersion: result.version, support: result.support, limitations: result.limitations, untrusted: true }) } });
      await tx.designProcessingJob.update({ where: { id: jobId }, data: { status: result.status === "COMPLETED" ? "COMPLETED" : "PARTIAL", progress: 100, result: json({ support: result.support, sheets: result.sheets.length, extracted: result.extracted.length, limitations: result.limitations }), completedAt: new Date() } });
    });
    await runReview(context, file.packageId, file.revisionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida no parser.";
    await prisma.$transaction([
      prisma.designFile.update({ where: { id: fileId }, data: { status: "FAILED", processingStatus: "FAILED", processingMetadata: json({ error: message, untrusted: true }) } }),
      prisma.designProcessingJob.update({ where: { id: jobId }, data: { status: "FAILED", errorCode: "DESIGN_PROCESSING_FAILED", errorMessage: message, completedAt: new Date() } }),
      prisma.designProjectPackage.update({ where: { id: file.packageId }, data: { status: "PARTIALLY_PROCESSED" } }),
    ]);
  }
}

export async function calibrateDesignSheet(context: AuthContext, raw: { sheetId: string; pixelDistance: number; realDistance: number; unit: "mm" | "cm" | "m"; pointA: { x: number; y: number }; pointB: { x: number; y: number } }) {
  assertCanMutate(context);
  const sheet = await prisma.designSheet.findFirst({ where: { id: raw.sheetId, file: { package: { organizationId: context.organizationId } } }, include: { file: true } });
  if (!sheet) throw new Error("Prancha não encontrada nesta organização.");
  const calibration = manualScaleCalibration(raw);
  await prisma.designSheet.update({ where: { id: sheet.id }, data: { scaleConfidence: "CONFIRMED", calibration: json({ ...calibration, realDistance: raw.realDistance, unit: raw.unit, pixelDistance: raw.pixelDistance, pointA: raw.pointA, pointB: raw.pointB, calibratedById: context.userId, calibratedAt: new Date().toISOString() }) } });
  await runReview(context, sheet.file.packageId, sheet.file.revisionId);
  return getDesignWorkspace(context.organizationId, sheet.file.packageId);
}

export async function createManualDesignFinding(context: AuthContext, raw: unknown) {
  assertCanMutate(context);
  const input = createFindingSchema.parse(raw);
  const designPackage = await packageForTenant(context.organizationId, input.packageId);
  const revision = await prisma.designRevision.findFirst({ where: { id: input.revisionId, packageId: designPackage.id } });
  if (!revision) throw new Error("Revisão inválida para este Project Package.");
  const evidence: DesignEvidence[] = [{ ref: `USER_FINDING:${context.userId}:${Date.now()}`, label: "Finding criado durante revisão humana", origin: "USER_PROVIDED", confidence: "HIGH", fileId: input.fileId, sheetId: input.sheetId, region: input.region, method: "HUMAN_REVIEW" }];
  const finding = await prisma.designFinding.create({ data: { organizationId: context.organizationId, projectId: designPackage.projectId, packageId: designPackage.id, revisionId: revision.id, fileId: input.fileId, sheetId: input.sheetId, discipline: input.discipline, category: input.category, type: input.type, severity: input.severity, confidence: "HIGH", title: input.title, description: input.description, implication: "Requer avaliação no fluxo de revisão.", recommendation: input.recommendation, evidenceRefs: json(evidence.map((item) => item.ref)), geometryRef: input.region ? json({ region: input.region }) : undefined, priority: input.severity, createdById: context.userId, evidence: { create: evidence.map((item) => ({ ref: item.ref, label: item.label, sourceType: item.origin, confidence: item.confidence, location: item.region ? json({ region: item.region }) : undefined, metadata: json({ method: item.method, fileId: item.fileId, sheetId: item.sheetId }) })) } } });
  await prisma.designAuditLog.create({ data: { organizationId: context.organizationId, packageId: designPackage.id, userId: context.userId, action: "FINDING_CREATED", entityType: "DesignFinding", entityId: finding.id, after: json({ title: finding.title, severity: finding.severity, fileId: finding.fileId, sheetId: finding.sheetId }) } });
  return getDesignWorkspace(context.organizationId, designPackage.id);
}

function serializeEngineMetrics(metrics: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, value && typeof value === "object" && "toString" in value ? String(value) : value]));
}

function applyDesignDelta(base: ProjectAssumptions, changes: { builtAreaM2?: number; privateAreaM2?: number; units?: number; parkingSpaces?: number; constructionMonths?: number }) {
  const next = structuredClone(base);
  const currentPrivateArea = Number(base.privateAreaPerUnitM2) * base.units;
  const units = Math.max(1, changes.units ?? base.units);
  const privateArea = Math.max(1, changes.privateAreaM2 ?? currentPrivateArea);
  next.units = units;
  next.privateAreaPerUnitM2 = String(privateArea / units);
  if (changes.builtAreaM2 !== undefined) next.efficiencyRate = String(Math.max(1, Math.min(99, privateArea / changes.builtAreaM2 * 100)));
  if (changes.constructionMonths !== undefined) next.constructionMonths = Math.max(1, changes.constructionMonths);
  return next;
}

export async function createAndCalculateAlternative(context: AuthContext, raw: unknown) {
  assertCanMutate(context);
  const input = createAlternativeSchema.parse(raw);
  const designPackage = await packageForTenant(context.organizationId, input.packageId);
  const revision = await prisma.designRevision.findFirst({ where: { id: input.revisionId, packageId: designPackage.id } });
  if (!revision) throw new Error("Revisão de origem inválida.");
  const study = await getLatestStudyForOrganization(context.organizationId);
  if (!study) throw new Error("Não há StudyVersion para enviar esta hipótese ao REDE Engine.");
  const beforeSensitivity = calculateSensitivity(study.assumptions);
  const before = calculateAllScenarios(study.assumptions, beforeSensitivity.calculatedAt).base;
  const assumptions = applyDesignDelta(study.assumptions, input.changes);
  const afterSensitivity = calculateSensitivity(assumptions);
  const after = calculateAllScenarios(assumptions, afterSensitivity.calculatedAt).base;
  const scoreBefore = calculateRedeScore({ result: before, resilience: beforeSensitivity.resilience });
  const scoreAfter = calculateRedeScore({ result: after, resilience: afterSensitivity.resilience });
  const metricKeys = ["vgv", "netRevenue", "totalCost", "profit", "marginOnNetRevenue", "roi", "annualIrr", "npv", "maximumCashExposure", "equityCapitalRequired"] as const;
  const financialImpact = Object.fromEntries(metricKeys.map((key) => [key, { before: String(before.metrics[key]), after: String(after.metrics[key]), delta: String(Number(after.metrics[key]) - Number(before.metrics[key])) }]));
  const alternative = await prisma.designAlternative.create({ data: { packageId: designPackage.id, sourceRevisionId: revision.id, name: input.name, description: input.description, changes: json(input.changes), productChanges: json({ units: input.changes.units ?? null, parkingSpaces: input.changes.parkingSpaces ?? null }), areaChanges: json({ builtAreaM2: input.changes.builtAreaM2 ?? null, privateAreaM2: input.changes.privateAreaM2 ?? null }), financialImpact: json(financialImpact), scoreImpact: json({ before: scoreBefore.totalScore, after: scoreAfter.totalScore, delta: scoreAfter.totalScore - scoreBefore.totalScore }), status: "CALCULATED", createdById: context.userId } });
  await prisma.designSimulationImpact.create({ data: { alternativeId: alternative.id, studyVersionId: study.studyVersionId, engineVersion: after.engineVersion, delta: json(input.changes), assumptions: json(assumptions), engineResult: json({ metrics: serializeEngineMetrics(after.metrics as unknown as Record<string, unknown>), scenario: "base" }), scoreResult: json({ before: scoreBefore.totalScore, after: scoreAfter.totalScore, delta: scoreAfter.totalScore - scoreBefore.totalScore, classification: scoreAfter.classification }), calculatedAt: after.calculatedAt } });
  await prisma.designAuditLog.create({ data: { organizationId: context.organizationId, packageId: designPackage.id, userId: context.userId, action: "DESIGN_ALTERNATIVE_ENGINE_CALCULATED", entityType: "DesignAlternative", entityId: alternative.id, after: json({ changes: input.changes, financialImpact, scoreImpact: { before: scoreBefore.totalScore, after: scoreAfter.totalScore } }), metadata: json({ studyVersionId: study.studyVersionId, engineVersion: after.engineVersion }) } });
  return getDesignWorkspace(context.organizationId, designPackage.id);
}

export async function getDesignWorkspace(organizationId: string, packageId: string): Promise<DesignWorkspaceView> {
  const designPackage = await prisma.designProjectPackage.findFirst({ where: { id: packageId, organizationId, project: { organizationId } }, include: { revisions: { orderBy: { versionNumber: "desc" } }, files: { include: { sheets: { orderBy: { pageNumber: "asc" } } }, orderBy: { uploadedAt: "desc" } }, findings: { include: { evidence: true }, orderBy: [{ severity: "desc" }, { createdAt: "desc" }] }, opportunities: { orderBy: { createdAt: "desc" } }, alternatives: { orderBy: { createdAt: "desc" } }, reviewRounds: { orderBy: { roundNumber: "desc" }, take: 1 } } });
  if (!designPackage) throw new Error("Project Package não encontrado nesta organização.");
  const revision = designPackage.revisions.find((item) => item.id === designPackage.currentRevisionId) ?? designPackage.revisions[0];
  if (!revision) throw new Error("Project Package sem revisão ativa.");
  const metrics = await prisma.designMetric.findMany({ where: { revisionId: revision.id }, orderBy: { createdAt: "asc" } });
  const previousRevision = [...designPackage.revisions].filter((item) => item.versionNumber < revision.versionNumber).sort((a, b) => b.versionNumber - a.versionNumber)[0];
  const previousMetrics = previousRevision ? await prisma.designMetric.findMany({ where: { revisionId: previousRevision.id }, orderBy: { createdAt: "asc" } }) : [];
  const toMetricInput = (item: typeof metrics[number]): DesignMetricInput => ({ name: item.name, value: Number(item.value), unit: item.unit, entityType: item.entityType, entityId: item.entityId ?? undefined, origin: item.origin, confidence: item.confidence, evidence: evidenceFromMetric(item) });
  const revisionDiff = previousRevision ? compareDesignMetrics(previousMetrics.map(toMetricInput), metrics.map(toMetricInput)) : [];
  const latestSummary = record(designPackage.reviewRounds[0]?.summary);
  const persistedCard = array(latestSummary.scorecard as Prisma.JsonValue) as unknown as DesignReviewOutput["scorecard"];
  const persistedSummary = record(latestSummary.summary as Prisma.JsonValue) as unknown as DesignReviewOutput["summary"];
  const severityIndex = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 } as const;
  const findings = designPackage.findings.filter((finding) => finding.revisionId === revision.id).sort((a, b) => severityIndex[b.severity] - severityIndex[a.severity]).map((finding) => ({ id: finding.id, key: finding.sourceRuleKey ?? finding.id, discipline: finding.discipline, category: finding.category, type: finding.type, severity: finding.severity, confidence: finding.confidence, title: finding.title, description: finding.description, implication: finding.implication, recommendation: finding.recommendation, evidence: finding.evidence.map((evidence) => ({ ref: evidence.ref, label: evidence.label, value: evidence.value ?? undefined, origin: evidence.sourceType, confidence: evidence.confidence, method: String(record(evidence.metadata).method ?? "PERSISTED_EVIDENCE"), ...(record(evidence.location).region ? { region: record(evidence.location).region as DesignEvidence["region"] } : {}) })), relatedMetric: finding.relatedMetric ?? undefined, potentialImpact: finding.potentialImpact ? record(finding.potentialImpact) as Record<string, number | string | null> : undefined, status: finding.status, fileId: finding.fileId ?? undefined, sheetId: finding.sheetId ?? undefined, ownerId: finding.ownerId ?? undefined, dueDate: finding.dueDate?.toISOString() } satisfies DesignFindingDraft & { id: string; fileId?: string; sheetId?: string; ownerId?: string; dueDate?: string }));
  const opportunities = designPackage.opportunities.filter((opportunity) => opportunity.revisionId === revision.id).map((opportunity) => ({ id: opportunity.id, key: opportunity.id, title: opportunity.title, category: opportunity.category, currentCondition: opportunity.currentCondition, proposedCondition: opportunity.proposedCondition, evidence: [], relatedFindingKeys: array(opportunity.relatedFindingIds).map(String), designImpact: record(opportunity.designImpact) as Record<string, number | string | null>, costImpact: opportunity.costImpact === null ? null : Number(opportunity.costImpact), revenueImpact: opportunity.revenueImpact === null ? null : Number(opportunity.revenueImpact), scheduleImpactMonths: opportunity.scheduleImpactMonths, riskImpact: opportunity.riskImpact, confidence: opportunity.confidence, effort: opportunity.effort, requiresProfessionalValidation: true as const, valueRank: Number(record(opportunity.designImpact).valueRank ?? 0), status: opportunity.status } satisfies VEOpportunityDraft & { id: string; status: string })).sort((a, b) => b.valueRank - a.valueRank);
  const computedSummary = { criticalFindings: findings.filter((finding) => finding.severity === "CRITICAL").length, openFindings: findings.filter((finding) => !["RESOLVED", "REJECTED", "WONT_FIX", "SUPERSEDED"].includes(finding.status)).length, quantifiedOpportunities: opportunities.filter((opportunity) => opportunity.costImpact !== null || opportunity.revenueImpact !== null).length, efficiencyRate: Number(metrics.find((metric) => metric.name === "PRIVATE_TOTAL_RATE")?.value ?? 0) || null, designDriftRate: Number(metrics.find((metric) => metric.name === "BUILT_AREA_ENGINE_DRIFT_RATE")?.value ?? 0) || null };
  const bim = await getLatestBimWorkspace(organizationId, designPackage.id);
  return {
    package: { id: designPackage.id, projectId: designPackage.projectId, name: designPackage.name, description: designPackage.description, status: designPackage.status, template: designPackage.template, reviewMode: designPackage.reviewMode, preflightStatus: designPackage.preflightStatus, limitations: array(designPackage.preflightLimits).map(String) },
    revision: { id: revision.id, label: revision.label, versionNumber: revision.versionNumber, status: revision.status },
    revisions: designPackage.revisions.map((item) => ({ id: item.id, label: item.label, versionNumber: item.versionNumber, status: item.status, createdAt: item.createdAt.toISOString() })),
    revisionDiff,
    files: designPackage.files.filter((file) => file.revisionId === revision.id).map((file) => ({ id: file.id, name: file.fileName, type: file.fileType, mimeType: file.mimeType, discipline: file.discipline, status: file.status, processingStatus: file.processingStatus, size: file.fileSize, metadata: record(file.processingMetadata), sheets: file.sheets.map((sheet) => ({ id: sheet.id, pageNumber: sheet.pageNumber, title: sheet.title, sheetNumber: sheet.sheetNumber, scaleConfidence: sheet.scaleConfidence })) })),
    metrics: metrics.map((metric) => ({ id: metric.id, name: metric.name, value: Number(metric.value), unit: metric.unit, origin: metric.origin, confidence: metric.confidence, evidenceRefs: evidenceFromMetric(metric).map((item) => item.ref) })),
    findings,
    opportunities,
    alternatives: designPackage.alternatives.map((alternative) => ({ id: alternative.id, name: alternative.name, description: alternative.description, status: alternative.status, changes: record(alternative.changes), financialImpact: alternative.financialImpact ? record(alternative.financialImpact) : null, scoreImpact: alternative.scoreImpact ? record(alternative.scoreImpact) : null })),
    scorecard: persistedCard,
    summary: Object.keys(persistedSummary).length ? persistedSummary : computedSummary,
    insights: array(latestSummary.insights as Prisma.JsonValue).map(String),
    supportedFormats: SUPPORTED_DESIGN_FORMATS,
    bim,
  };
}

export async function getLatestDesignWorkspace(organizationId: string, projectId: string) {
  const designPackage = await prisma.designProjectPackage.findFirst({ where: { organizationId, projectId, project: { organizationId } }, orderBy: { updatedAt: "desc" }, select: { id: true } });
  return designPackage ? getDesignWorkspace(organizationId, designPackage.id) : null;
}

export async function getDesignFileForDownload(organizationId: string, fileId: string) {
  const file = await prisma.designFile.findFirst({ where: { id: fileId, package: { organizationId, project: { organizationId } } } });
  if (!file) throw new Error("Arquivo não encontrado nesta organização.");
  return { file, bytes: await designFileStorage.read(file.storageKey) };
}

export const designServiceInternals = { applyDesignDelta, runReview, createDemoPackage };
