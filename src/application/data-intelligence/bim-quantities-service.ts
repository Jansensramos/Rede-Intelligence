import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { assertDataIntelligenceCapability, type ConfidenceLevel, type DataIntelligenceCapability } from "@/domain/data-intelligence";

type DIContext = Pick<AuthContext, "organizationId" | "userId" | "role">;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const checksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function requireCapability(context: Pick<DIContext, "role">, capability: DataIntelligenceCapability) {
  assertDataIntelligenceCapability(context.role, capability);
}

// ============================================================================
// Fundação de Quantidades BIM (plano 9I, seção 14.1)
// ============================================================================
//
// IFC/BIM → quantidade → EconomicItem → composição → custo. Liga um
// BimElement (já existente, 9A/8) a um EconomicItem por mapeamento
// versionado e revisável — nunca um takeoff automático que grava
// quantidade direto como fato de custo sem revisão humana.

export interface CreateBimQuantityMappingInput {
  projectId: string;
  bimElementId: string;
  economicItemId: string;
  quantityKind: "LENGTH" | "AREA" | "VOLUME" | "WEIGHT" | "COUNT";
  quantity: number;
  unit: string;
  extractionMethod: "MANUAL" | "IFC_PROPERTY" | "GEOMETRY_DERIVED";
  confidenceLevel: ConfidenceLevel;
}

async function assertProjectScope(context: Pick<DIContext, "organizationId">, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: context.organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  return project;
}

export async function createBimQuantityMapping(context: DIContext, input: CreateBimQuantityMappingInput) {
  requireCapability(context, "DATA_CONTRACT_MANAGE");
  await assertProjectScope(context, input.projectId);

  const bimElement = await prisma.bimElement.findFirst({ where: { id: input.bimElementId, model: { organizationId: context.organizationId, projectId: input.projectId } } });
  if (!bimElement) throw new Error("Elemento BIM não encontrado neste empreendimento.");
  const economicItem = await prisma.economicItem.findFirst({ where: { id: input.economicItemId, organizationId: context.organizationId, projectId: input.projectId } });
  if (!economicItem) throw new Error("Item econômico não encontrado neste empreendimento.");

  const previous = await prisma.bimQuantityMapping.findFirst({
    where: { organizationId: context.organizationId, bimElementId: input.bimElementId, economicItemId: input.economicItemId },
    orderBy: { version: "desc" },
  });
  const version = (previous?.version ?? 0) + 1;

  const provenance = {
    ifcType: bimElement.ifcType,
    ifcGuid: bimElement.ifcGuid,
    modelId: bimElement.modelId,
    extractionMethod: input.extractionMethod,
    capturedAt: new Date().toISOString(),
  };
  const payload = { organizationId: context.organizationId, projectId: input.projectId, bimElementId: input.bimElementId, economicItemId: input.economicItemId, quantityKind: input.quantityKind, quantity: input.quantity, unit: input.unit };

  return prisma.bimQuantityMapping.create({
    data: {
      organizationId: context.organizationId, projectId: input.projectId, bimElementId: input.bimElementId, economicItemId: input.economicItemId,
      ifcClassification: bimElement.ifcType, quantityKind: input.quantityKind, quantity: input.quantity, unit: input.unit,
      extractionMethod: input.extractionMethod, confidenceLevel: input.confidenceLevel, provenance: json(provenance),
      version, status: "DRAFT", checksum: checksum(payload), createdById: context.userId,
    },
  });
}

// Revisão humana obrigatória (plano 9I, seção 40): DRAFT → REVIEWED → APPROVED/REJECTED.
// Nunca pula direto de DRAFT para APPROVED.
export async function reviewBimQuantityMapping(context: DIContext, mappingId: string) {
  requireCapability(context, "DATA_CONTRACT_MANAGE");
  const mapping = await prisma.bimQuantityMapping.findFirst({ where: { id: mappingId, organizationId: context.organizationId } });
  if (!mapping) throw new Error("Mapeamento não encontrado nesta organização.");
  if (mapping.status !== "DRAFT") throw new Error(`Mapeamento em status ${mapping.status} não pode ser revisado.`);
  return prisma.bimQuantityMapping.update({ where: { id: mappingId }, data: { status: "REVIEWED", reviewedById: context.userId, reviewedAt: new Date() } });
}

export async function decideBimQuantityMapping(context: DIContext, mappingId: string, decision: "APPROVED" | "REJECTED", rejectionReason?: string) {
  requireCapability(context, "METRIC_APPROVE");
  const mapping = await prisma.bimQuantityMapping.findFirst({ where: { id: mappingId, organizationId: context.organizationId } });
  if (!mapping) throw new Error("Mapeamento não encontrado nesta organização.");
  if (mapping.status !== "REVIEWED") throw new Error(`Mapeamento em status ${mapping.status} não pode ser decidido — precisa passar por revisão primeiro.`);
  return prisma.bimQuantityMapping.update({
    where: { id: mappingId },
    data: decision === "APPROVED"
      ? { status: "APPROVED", approvedById: context.userId, approvedAt: new Date() }
      : { status: "REJECTED", rejectionReason: rejectionReason ?? null },
  });
}

export async function listBimQuantityMappings(context: DIContext, projectId: string) {
  requireCapability(context, "DATA_VIEW");
  await assertProjectScope(context, projectId);
  const mappings = await prisma.bimQuantityMapping.findMany({
    where: { organizationId: context.organizationId, projectId },
    include: { bimElement: true, economicItem: true },
    orderBy: { createdAt: "desc" },
  });
  return mappings.map((m) => ({
    id: m.id, bimElementId: m.bimElementId, economicItemId: m.economicItemId, economicItemCode: m.economicItem.code,
    ifcClassification: m.ifcClassification, quantityKind: m.quantityKind, quantity: Number(m.quantity), unit: m.unit,
    extractionMethod: m.extractionMethod, confidenceLevel: m.confidenceLevel, version: m.version, status: m.status,
    provenance: m.provenance, reviewedAt: m.reviewedAt?.toISOString() ?? null, approvedAt: m.approvedAt?.toISOString() ?? null,
  }));
}
