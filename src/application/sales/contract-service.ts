/**
 * Fechamento Comercial 360 — Contrato (Fase 9K.4, plano §1/§3/§6/§9). `SalesContract` (9E)
 * continua a origem econômica oficial; este arquivo só adiciona modelo/versão/documento em torno
 * dele — nenhum preço, parcela ou recebível é recalculado aqui.
 *
 * Documento nunca guarda bytes no Postgres: `contractFileStorage` é a mesma abstração de
 * `design-file-storage.ts` (`FileStorageProvider`), com raiz própria (`.rede-storage/contracts`).
 */
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { contractFileStorage } from "@/infrastructure/storage/contract-file-storage";
import { assertTemplateVersionEditable, renderContractTemplate, sha256Hex } from "@/domain/sales/contract-closing";

const mutableRoles = new Set(["OWNER", "ADMIN", "ANALYST"]);
const approvalRoles = new Set(["OWNER", "ADMIN"]);
const json = (value: unknown) => value as Prisma.InputJsonValue;

function assertMutable(context: Pick<AuthContext, "role">) {
  if (!mutableRoles.has(context.role)) throw new Error("Seu perfil não pode alterar dados comerciais.");
}
function assertApprover(context: Pick<AuthContext, "role">) {
  if (!approvalRoles.has(context.role)) throw new Error("Somente Administrador ou Owner pode aprovar este ato comercial.");
}
const audit = (context: Pick<AuthContext, "organizationId" | "userId">, projectId: string | null, action: string, entityType: string, entityId: string, after?: unknown) => ({
  organizationId: context.organizationId, userId: context.userId, projectId, action, entityType, entityId, after: after === undefined ? undefined : json(after),
});

async function contractForTenant(organizationId: string, contractId: string) {
  const contract = await prisma.salesContract.findFirst({ where: { id: contractId, organizationId }, include: { sale: { include: { salesUnit: true, parties: { include: { customer: true } } } }, project: true } });
  if (!contract) throw new Error("Contrato de venda não encontrado nesta organização.");
  return contract;
}

// ---------------------------------------------------------------------------
// Modelo contratual e versão (item 1/6)
// ---------------------------------------------------------------------------

export async function createContractTemplate(context: AuthContext, input: { projectId: string; name: string }) {
  assertMutable(context);
  const project = await prisma.project.findFirst({ where: { id: input.projectId, organizationId: context.organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  const template = await prisma.contractTemplate.create({ data: { organizationId: context.organizationId, projectId: input.projectId, name: input.name, createdById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, input.projectId, "CONTRACT_TEMPLATE_CREATED", "ContractTemplate", template.id, { name: template.name }) });
  return template;
}

/** Cria uma nova versão do modelo — nunca sobrescreve uma versão `APPROVED` existente (item 6). */
export async function createContractTemplateVersion(context: AuthContext, input: { templateId: string; content: string; variables?: Record<string, string> }) {
  assertMutable(context);
  const template = await prisma.contractTemplate.findFirst({ where: { id: input.templateId, organizationId: context.organizationId } });
  if (!template) throw new Error("Modelo contratual não encontrado nesta organização.");
  const last = await prisma.contractTemplateVersion.findFirst({ where: { templateId: template.id }, orderBy: { version: "desc" } });
  const version = (last?.version ?? 0) + 1;
  const created = await prisma.contractTemplateVersion.create({ data: { templateId: template.id, version, content: input.content, checksum: sha256Hex(input.content), variables: input.variables ? json(input.variables) : undefined, createdById: context.userId } });
  await prisma.auditLog.create({ data: audit(context, template.projectId, "CONTRACT_TEMPLATE_VERSION_CREATED", "ContractTemplateVersion", created.id, { templateId: template.id, version }) });
  return created;
}

/** Só permite editar `content` enquanto `DRAFT` (item 6). Depois de `APPROVED`, o único caminho é uma nova versão. */
export async function updateContractTemplateVersionDraft(context: AuthContext, input: { versionId: string; content: string; variables?: Record<string, string> }) {
  assertMutable(context);
  const version = await prisma.contractTemplateVersion.findFirst({ where: { id: input.versionId, template: { organizationId: context.organizationId } } });
  if (!version) throw new Error("Versão de modelo não encontrada nesta organização.");
  assertTemplateVersionEditable(version.status);
  return prisma.contractTemplateVersion.update({ where: { id: version.id }, data: { content: input.content, checksum: sha256Hex(input.content), variables: input.variables ? json(input.variables) : undefined } });
}

export async function approveContractTemplateVersion(context: AuthContext, versionId: string) {
  assertApprover(context);
  const version = await prisma.contractTemplateVersion.findFirst({ where: { id: versionId, template: { organizationId: context.organizationId } }, include: { template: true } });
  if (!version) throw new Error("Versão de modelo não encontrada nesta organização.");
  if (version.status !== "DRAFT") throw new Error("Somente uma versão em rascunho pode ser aprovada.");
  return prisma.$transaction(async (tx) => {
    const approved = await tx.contractTemplateVersion.update({ where: { id: version.id }, data: { status: "APPROVED", approvedById: context.userId, approvedAt: new Date() } });
    if (version.template.status === "DRAFT") await tx.contractTemplate.update({ where: { id: version.templateId }, data: { status: "ACTIVE" } });
    await tx.auditLog.create({ data: audit(context, version.template.projectId, "CONTRACT_TEMPLATE_VERSION_APPROVED", "ContractTemplateVersion", approved.id, { templateId: version.templateId, version: approved.version }) });
    return approved;
  });
}

// ---------------------------------------------------------------------------
// Documento contratual (item 3/9) — metadado + referência de storage, nunca bytes no Postgres
// ---------------------------------------------------------------------------

function buildContractVariables(contract: Awaited<ReturnType<typeof contractForTenant>>) {
  const buyers = contract.sale.parties.filter((party) => party.role === "BUYER" || party.role === "CO_BUYER").map((party) => party.customer.name);
  return {
    contractNumber: contract.number,
    contractTitle: contract.title,
    soldPrice: contract.soldPrice.toString(),
    unitCode: contract.sale.salesUnit.code,
    buyerNames: buyers.join(", "),
    effectiveFrom: contract.effectiveFrom ? contract.effectiveFrom.toISOString().slice(0, 10) : "",
  };
}

/** Gera o documento a partir de uma versão `APPROVED` do modelo (item 1: "versão aprovada"). Nunca usa uma versão `DRAFT`. */
export async function generateContractDocument(context: AuthContext, input: { contractId: string; templateVersionId: string }) {
  assertMutable(context);
  const contract = await contractForTenant(context.organizationId, input.contractId);
  const templateVersion = await prisma.contractTemplateVersion.findFirst({ where: { id: input.templateVersionId, template: { organizationId: context.organizationId, projectId: contract.projectId } }, include: { template: true } });
  if (!templateVersion) throw new Error("Versão de modelo não encontrada neste empreendimento.");
  if (templateVersion.status !== "APPROVED") throw new Error("Somente uma versão aprovada do modelo pode gerar documento contratual.");

  const { rendered } = renderContractTemplate(templateVersion.content, buildContractVariables(contract));
  const bytes = new TextEncoder().encode(rendered);
  const last = await prisma.contractDocument.findFirst({ where: { contractId: contract.id, kind: "MODEL_RENDER" }, orderBy: { version: "desc" } });
  const version = (last?.version ?? 0) + 1;
  const stored = await contractFileStorage.put({ organizationId: context.organizationId, packageId: contract.id, fileName: `${contract.number}-v${version}.txt`, bytes });

  return prisma.$transaction(async (tx) => {
    const document = await tx.contractDocument.create({ data: {
      organizationId: context.organizationId, contractId: contract.id, templateVersionId: templateVersion.id, kind: "MODEL_RENDER", status: "FINAL", version,
      title: `${templateVersion.template.name} v${templateVersion.version} — ${contract.number}`, fileName: `${contract.number}-v${version}.txt`, mimeType: "text/plain",
      storageProvider: stored.provider, storageKey: stored.key, fileSize: stored.size, checksum: stored.checksum, createdById: context.userId,
    } });
    await tx.salesContract.update({ where: { id: contract.id }, data: { templateVersionId: templateVersion.id } });
    await tx.auditLog.create({ data: audit(context, contract.projectId, "CONTRACT_DOCUMENT_GENERATED", "ContractDocument", document.id, { contractId: contract.id, templateVersionId: templateVersion.id, checksum: stored.checksum }) });
    return document;
  });
}

/** Anexo comercial livre (item 1: "anexos") — mesmo `ContractDocument`, `kind = ATTACHMENT`. */
export async function addContractAttachment(context: AuthContext, input: { contractId: string; fileName: string; mimeType: string; bytes: Uint8Array; title?: string }) {
  assertMutable(context);
  const contract = await contractForTenant(context.organizationId, input.contractId);
  const last = await prisma.contractDocument.findFirst({ where: { contractId: contract.id, kind: "ATTACHMENT" }, orderBy: { version: "desc" } });
  const version = (last?.version ?? 0) + 1;
  const stored = await contractFileStorage.put({ organizationId: context.organizationId, packageId: contract.id, fileName: input.fileName, bytes: input.bytes });
  const document = await prisma.contractDocument.create({ data: {
    organizationId: context.organizationId, contractId: contract.id, kind: "ATTACHMENT", status: "FINAL", version,
    title: input.title ?? input.fileName, fileName: input.fileName, mimeType: input.mimeType, storageProvider: stored.provider, storageKey: stored.key, fileSize: stored.size, checksum: stored.checksum, createdById: context.userId,
  } });
  await prisma.auditLog.create({ data: audit(context, contract.projectId, "CONTRACT_ATTACHMENT_ADDED", "ContractDocument", document.id, { contractId: contract.id, fileName: input.fileName }) });
  return document;
}

export async function readContractDocumentBytes(context: Pick<AuthContext, "organizationId">, documentId: string) {
  const document = await prisma.contractDocument.findFirst({ where: { id: documentId, organizationId: context.organizationId } });
  if (!document) throw new Error("Documento contratual não encontrado nesta organização.");
  const bytes = await contractFileStorage.read(document.storageKey);
  return { document, bytes };
}
