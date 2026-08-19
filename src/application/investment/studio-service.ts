import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import {
  buildIntermediateDocumentModel,
  buildMasterReportModel,
  createMasterReportConfig,
  createReportId,
  masterReportFileName,
  renderDocumentPdf,
  renderDocumentPptx,
  runMasterReportPreflight,
  type AudienceProfile,
  type MasterReportConfig,
  type MasterReportLevel,
  type MasterReportPreflight,
  type StudioArtifactType,
} from "@/domain/investment";
import { prisma } from "@/infrastructure/database/prisma";
import { getInvestmentCaseForOrganization } from "./investment-service";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function preflightMasterReport(
  context: Pick<AuthContext, "organizationId">,
  investmentCaseId: string,
  level: MasterReportLevel,
  audience: AudienceProfile,
): Promise<{ config: MasterReportConfig; preflight: MasterReportPreflight }> {
  const workspace = await getInvestmentCaseForOrganization(context.organizationId, investmentCaseId);
  if (!workspace) throw new Error("Investment Case não encontrado nesta organização.");
  const config = createMasterReportConfig(workspace, level, audience);
  return { config, preflight: runMasterReportPreflight(workspace, config) };
}

export async function generateMasterReport(
  context: Pick<AuthContext, "userId" | "organizationId">,
  investmentCaseId: string,
  config: MasterReportConfig,
  final: boolean,
) {
  const workspace = await getInvestmentCaseForOrganization(context.organizationId, investmentCaseId);
  if (!workspace) throw new Error("Investment Case não encontrado nesta organização.");
  if (config.investmentCaseId !== workspace.id || config.snapshotBundleId !== workspace.bundleId) throw new Error("Configuração do relatório não corresponde ao snapshot selecionado.");
  const preflight = runMasterReportPreflight(workspace, config);
  if (!preflight.canGenerateDraft || (final && !preflight.canGenerateFinal)) throw new Error("Preflight bloqueou a geração do relatório.");
  const configRow = await prisma.masterReportConfigRecord.create({ data: {
    investmentCaseId: workspace.id,
    snapshotBundleId: workspace.bundleId,
    level: config.reportLevel,
    audience: config.audienceProfile,
    confidentiality: config.confidentiality,
    config: json(config),
    configDigest: digest(config),
    frozenAt: new Date(),
    createdById: context.userId,
  } });
  const job = await prisma.masterReportJob.create({ data: { investmentCaseId: workspace.id, configId: configRow.id, status: "QUEUED", progress: 0, currentStep: "QUEUED", sectionErrors: json([]), createdById: context.userId } });
  try {
    await prisma.masterReportJob.update({ where: { id: job.id }, data: { status: "VALIDATING", progress: 12, currentStep: "VALIDATING", startedAt: new Date() } });
    const version = await prisma.studioArtifact.count({ where: { investmentCaseId: workspace.id, type: "MASTER_REPORT" } }) + 1;
    const sequence = await prisma.studioArtifact.count({ where: { type: "MASTER_REPORT" } }) + 1;
    const reportId = createReportId(workspace.bundle.project.name, sequence, version);
    const generatedAt = new Date().toISOString();
    const model = buildMasterReportModel(workspace, config, reportId, version, generatedAt);
    await prisma.masterReportJob.update({ where: { id: job.id }, data: { status: "RENDERING", progress: 42, currentStep: "RENDERING" } });
    const rendered = await renderDocumentPdf(model, workspace.brand, { reportId, reportVersion: version, watermark: final ? "FINAL" : config.watermark, pageSize: config.pageSize });
    if (!rendered.bytes.byteLength || !rendered.pageCount || !rendered.checksum) throw new Error("Falha na validação de integridade do PDF.");
    await prisma.masterReportJob.update({ where: { id: job.id }, data: { status: "ASSEMBLING", progress: 76, currentStep: "ASSEMBLING" } });
    const fileName = masterReportFileName(workspace.bundle.project.name, workspace.bundle.studyVersionNumber, generatedAt);
    const result = await prisma.$transaction(async (tx) => {
      const artifact = await tx.studioArtifact.create({ data: {
        investmentCaseId: workspace.id,
        snapshotBundleId: workspace.bundleId,
        configId: configRow.id,
        reportId,
        type: "MASTER_REPORT",
        version,
        status: final ? "FINAL" : "DRAFT",
        generationStatus: "COMPLETED",
        documentModel: json(model),
        templateVersion: model.auditMetadata.templateVersion,
        fileName,
        mimeType: "application/pdf",
        content: Buffer.from(rendered.bytes),
        fileSize: rendered.bytes.byteLength,
        pageCount: rendered.pageCount,
        checksumAlgorithm: rendered.checksumAlgorithm,
        checksum: rendered.checksum,
        confidentiality: config.confidentiality,
        generatedById: context.userId,
        generatedAt: new Date(generatedAt),
      } });
      if (final && config.saveFinalToDataRoom) {
        const previous = await tx.projectDocument.findFirst({ where: { investmentCaseId: workspace.id, category: "14_RELATORIOS", title: "Dossiê Completo REDE" }, orderBy: { version: "desc" } });
        const document = await tx.projectDocument.create({ data: { investmentCaseId: workspace.id, sourceArtifactId: artifact.id, previousVersionId: previous?.id ?? null, category: "14_RELATORIOS", subcategory: "MASTER_REPORT", title: "Dossiê Completo REDE", version: (previous?.version ?? 0) + 1, status: "VERIFIED", confidentiality: config.confidentiality, fileName, mimeType: "application/pdf", content: Buffer.from(rendered.bytes), fileSize: rendered.bytes.byteLength, checksum: rendered.checksum, source: `StudioArtifact:${artifact.id}`, createdById: context.userId } });
        if (previous) await tx.projectDocument.update({ where: { id: previous.id }, data: { status: "SUPERSEDED" } });
        await tx.investmentAuditLog.create({ data: { investmentCaseId: workspace.id, userId: context.userId, action: "MASTER_REPORT_SAVED_TO_DATA_ROOM", entityType: "ProjectDocument", entityId: document.id, after: json({ reportId, version, snapshotBundleId: workspace.bundleId, checksum: rendered.checksum }) } });
      }
      await tx.investmentAuditLog.create({ data: { investmentCaseId: workspace.id, userId: context.userId, action: "MASTER_REPORT_GENERATED", entityType: "StudioArtifact", entityId: artifact.id, after: json({ reportId, version, pageCount: rendered.pageCount, status: final ? "FINAL" : "DRAFT", snapshotBundleId: workspace.bundleId }) } });
      return artifact;
    });
    await prisma.masterReportJob.update({ where: { id: job.id }, data: { artifactId: result.id, status: "COMPLETED", progress: 100, currentStep: "COMPLETED", completedAt: new Date() } });
    const refreshed = await getInvestmentCaseForOrganization(context.organizationId, workspace.id);
    if (!refreshed) throw new Error("Investment Case não encontrado após a geração.");
    return { artifactId: result.id, reportId, version, pageCount: rendered.pageCount, fileName, checksum: rendered.checksum, preflight, workspace: refreshed };
  } catch (error) {
    await prisma.masterReportJob.update({ where: { id: job.id }, data: { status: "FAILED", currentStep: "FAILED", error: error instanceof Error ? error.message : "Falha desconhecida", completedAt: new Date() } });
    throw error;
  }
}

export async function generateStudioArtifact(
  context: Pick<AuthContext, "userId" | "organizationId">,
  input: { investmentCaseId: string; type: Exclude<StudioArtifactType, "MASTER_REPORT">; audience: AudienceProfile; format: "PDF" | "PPTX" },
) {
  const workspace = await getInvestmentCaseForOrganization(context.organizationId, input.investmentCaseId);
  if (!workspace) throw new Error("Investment Case não encontrado nesta organização.");
  const generatedAt = new Date().toISOString();
  const model = buildIntermediateDocumentModel({ artifactType: input.type, audience: input.audience, bundle: workspace.bundle, readiness: workspace.readiness, approvalPath: workspace.approvalPath, urban: workspace.urbanTransformation, generatedAt });
  const version = await prisma.studioArtifact.count({ where: { investmentCaseId: workspace.id, type: input.type } }) + 1;
  const baseName = `${input.type}_${workspace.bundle.project.name.replace(/[^A-Za-z0-9]+/g, "_")}_v${version}`;
  const rendered = input.format === "PDF"
    ? await renderDocumentPdf(model, workspace.brand, { watermark: "DRAFT" })
    : await renderDocumentPptx(model, workspace.brand);
  const bytes = rendered.bytes;
  const fileName = `${baseName}.${input.format.toLowerCase()}`;
  const mimeType = input.format === "PDF" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  const artifact = await prisma.studioArtifact.create({ data: { investmentCaseId: workspace.id, snapshotBundleId: workspace.bundleId, type: input.type, version, status: "DRAFT", generationStatus: "COMPLETED", documentModel: json(model), templateVersion: "REDE_STUDIO_V1.0.0", fileName, mimeType, content: Buffer.from(bytes), fileSize: bytes.byteLength, pageCount: "pageCount" in rendered ? rendered.pageCount : rendered.slideCount, checksumAlgorithm: rendered.checksumAlgorithm, checksum: rendered.checksum, confidentiality: input.audience === "INTERNAL" || input.audience === "INVESTMENT_COMMITTEE" ? "STRICTLY_CONFIDENTIAL" : "CONFIDENTIAL", generatedById: context.userId, generatedAt: new Date(generatedAt) } });
  const refreshed = await getInvestmentCaseForOrganization(context.organizationId, workspace.id);
  if (!refreshed) throw new Error("Investment Case não encontrado após a geração.");
  return { artifactId: artifact.id, fileName, checksum: rendered.checksum, pagesOrSlides: "pageCount" in rendered ? rendered.pageCount : rendered.slideCount, workspace: refreshed };
}
