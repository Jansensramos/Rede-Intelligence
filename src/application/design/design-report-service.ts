import type { AuthContext } from "@/application/auth/session";
import { getInvestmentCaseForOrganization } from "@/application/investment/investment-service";
import { buildDesignReviewDocument } from "@/domain/design";
import { renderDocumentPdf } from "@/domain/investment";
import { prisma } from "@/infrastructure/database/prisma";
import { getDesignWorkspace } from "./design-service";

export async function generateDesignReviewReport(context: AuthContext, packageId: string) {
  if (context.role === "VIEWER") throw new Error("Seu perfil não pode gerar relatórios.");
  const designPackage = await prisma.designProjectPackage.findFirst({ where: { id: packageId, organizationId: context.organizationId, project: { organizationId: context.organizationId } }, include: { project: true } });
  if (!designPackage?.investmentCaseId) throw new Error("Vincule o Project Package a um Investment Case para gerar o relatório no REDE Studio.");
  const investment = await getInvestmentCaseForOrganization(context.organizationId, designPackage.investmentCaseId);
  if (!investment) throw new Error("Investment Case não encontrado nesta organização.");
  const workspace = await getDesignWorkspace(context.organizationId, designPackage.id);
  const model = buildDesignReviewDocument(workspace, { projectName: designPackage.project.name, city: designPackage.project.city, state: designPackage.project.state });
  const version = await prisma.studioArtifact.count({ where: { investmentCaseId: investment.id, type: "DESIGN_REVIEW_REPORT" } }) + 1;
  const reportId = `DR-${designPackage.id.slice(-6).toUpperCase()}-R${workspace.revision.versionNumber.toString().padStart(2, "0")}-V${version}`;
  const rendered = await renderDocumentPdf(model, investment.brand, { reportId, reportVersion: version, watermark: "CONFIDENTIAL" });
  const fileName = `REDE_Design_Review_${workspace.revision.label.replace(/[^a-zA-Z0-9]+/g, "_")}_v${version}.pdf`;
  const artifact = await prisma.studioArtifact.create({ data: { investmentCaseId: investment.id, snapshotBundleId: investment.bundleId, type: "DESIGN_REVIEW_REPORT", version, status: "FINAL", generationStatus: "COMPLETED", documentModel: JSON.parse(JSON.stringify(model)), templateVersion: model.schemaVersion, fileName, mimeType: "application/pdf", content: Buffer.from(rendered.bytes), fileSize: rendered.bytes.length, pageCount: rendered.pageCount, checksumAlgorithm: rendered.checksumAlgorithm, checksum: rendered.checksum, confidentiality: "STRICTLY_CONFIDENTIAL", generatedById: context.userId, generatedAt: new Date() } });
  await prisma.projectDocument.create({ data: { investmentCaseId: investment.id, sourceArtifactId: artifact.id, category: "DESIGN_REPORT", title: `Design Review Report · ${workspace.revision.label}`, version, status: "VERIFIED", confidentiality: "STRICTLY_CONFIDENTIAL", fileName, mimeType: "application/pdf", fileSize: rendered.bytes.length, checksum: rendered.checksum, source: "REDE_STUDIO_DESIGN_INTELLIGENCE", metadata: { designPackageId: designPackage.id, designRevisionId: workspace.revision.id, reportId }, createdById: context.userId } });
  await prisma.designAuditLog.create({ data: { organizationId: context.organizationId, packageId: designPackage.id, userId: context.userId, action: "DESIGN_REVIEW_REPORT_GENERATED", entityType: "StudioArtifact", entityId: artifact.id, after: { reportId, version, pageCount: rendered.pageCount, checksum: rendered.checksum } } });
  return { artifactId: artifact.id, reportId, fileName, mimeType: "application/pdf", content: rendered.bytes, checksum: rendered.checksum, pageCount: rendered.pageCount };
}
