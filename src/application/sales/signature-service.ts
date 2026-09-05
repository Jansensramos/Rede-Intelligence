/**
 * Fechamento Comercial 360 — Assinatura (Fase 9K.4, plano §4). `SignatureProvider` é a única
 * interface que este arquivo conhece — a escolha do adapter concreto vive só em `providerFor`
 * O fluxo MOCK e a composição Clicksign permanecem explícitos; nenhum provider indisponível
 * é convertido em sucesso simulado.
 *
 * Webhook externo: reaproveita o transporte/idempotência já existentes da 9H
 * (`receiveWebhookEvent` → `IntegrationInboxEvent`, `@@unique([installationId, provider, eventId])`)
 * — `processSignatureWebhookEvent` só faz a PROJEÇÃO de domínio (`SignatureEvent`) depois que a
 * 9H já deduplicou o evento cru. Nenhuma segunda infraestrutura de webhook é criada aqui.
 */
import { Prisma, type SignatoryRole } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { contractFileStorage } from "@/infrastructure/storage/contract-file-storage";
import { mockSignatureProvider } from "@/infrastructure/adapters/signature/mock-signature-provider";
import { receiveWebhookEvent } from "@/application/integrations/integrations-service";
import { generateSaleReceivables } from "@/application/sales/sales-service";
import { mapToContractSignatureStatus, nextSignatureRequestStatus } from "@/domain/sales/contract-closing";
import { SignatureReconciliationError, type SignatureProvider, type SignatureReconciliationResult } from "@/domain/sales/signature-provider";

const mutableRoles = new Set(["OWNER", "ADMIN", "ANALYST"]);
const json = (value: unknown) => value as Prisma.InputJsonValue;

function assertMutable(context: Pick<AuthContext, "role">) {
  if (!mutableRoles.has(context.role)) throw new Error("Seu perfil não pode alterar dados comerciais.");
}
const audit = (context: Pick<AuthContext, "organizationId" | "userId">, projectId: string | null, action: string, entityType: string, entityId: string, after?: unknown) => ({
  organizationId: context.organizationId, userId: context.userId, projectId, action, entityType, entityId, after: after === undefined ? undefined : json(after),
});

/** Único ponto do arquivo que resolve um provider concreto. O import dinâmico mantém o domínio
 * desacoplado e evita inicialização circular com o processador assíncrono de webhooks. */
async function providerFor(code: string, organizationId: string): Promise<{ provider: SignatureProvider; installationId: string | null }> {
  if (code === "MOCK") return { provider: mockSignatureProvider, installationId: null };
  if (code === "CLICKSIGN") return (await import("./clicksign-service")).clicksignProviderForOrganization(organizationId);
  throw new Error(`Provider de assinatura "${code}" ainda não tem adapter real habilitado nesta fase — apenas MOCK está disponível.`);
}

async function requestForTenant(organizationId: string, requestId: string, reconciliation = false) {
  const request = await prisma.signatureRequest.findFirst({
    where: { id: requestId, organizationId },
    include: { parties: true, document: true, contract: true },
  });
  if (!request) {
    if (reconciliation) throw reconciliationFailure("VALIDATION", "SIGNATURE_EVIDENCE_INVALID");
    throw new Error("Solicitação de assinatura não encontrada nesta organização.");
  }
  return request;
}

// ---------------------------------------------------------------------------
// Preparação e envio (PREPARADO → ENVIADO/AGUARDANDO_ASSINATURAS)
// ---------------------------------------------------------------------------

const SIGNATORY_ROLES = new Set(["BUYER", "CO_BUYER", "REPRESENTATIVE", "GUARANTOR", "SELLER", "WITNESS"]);

export async function prepareSignatureRequest(context: AuthContext, input: {
  contractId: string; documentId: string; provider?: "MOCK" | "CLICKSIGN" | "MANUAL_UPLOAD";
  parties: { customerId?: string; displayName: string; email?: string; role: string }[];
}) {
  assertMutable(context);
  if (input.parties.length === 0) throw new Error("Uma solicitação de assinatura precisa de ao menos um signatário.");
  for (const party of input.parties) if (!SIGNATORY_ROLES.has(party.role)) throw new Error(`Papel de signatário inválido: ${party.role}.`);

  const contract = await prisma.salesContract.findFirst({ where: { id: input.contractId, organizationId: context.organizationId } });
  if (!contract) throw new Error("Contrato de venda não encontrado nesta organização.");
  const document = await prisma.contractDocument.findFirst({ where: { id: input.documentId, contractId: contract.id, organizationId: context.organizationId } });
  if (!document) throw new Error("Documento contratual não encontrado neste contrato.");

  return prisma.$transaction(async (tx) => {
    const request = await tx.signatureRequest.create({ data: {
      organizationId: context.organizationId, projectId: contract.projectId, contractId: contract.id, documentId: document.id,
      provider: input.provider ?? "MOCK", documentChecksum: document.checksum, createdById: context.userId,
      parties: { create: input.parties.map((party, index) => ({ customerId: party.customerId ?? null, displayName: party.displayName, email: party.email ?? null, role: party.role as SignatoryRole, order: index + 1 })) },
    }, include: { parties: true } });
    await tx.signatureEvent.create({ data: { organizationId: context.organizationId, requestId: request.id, eventType: "CREATED", occurredAt: new Date(), payload: json({ documentId: document.id }) } });
    await tx.auditLog.create({ data: audit(context, contract.projectId, "SIGNATURE_REQUEST_PREPARED", "SignatureRequest", request.id, { contractId: contract.id, parties: request.parties.length }) });
    return request;
  });
}

export async function sendSignatureRequest(context: AuthContext, requestId: string) {
  assertMutable(context);
  const request = await requestForTenant(context.organizationId, requestId);
  if (request.status !== "PREPARADO") return request; // idempotente: já enviada, no-op

  // Claim local antes da chamada externa: duas requisições concorrentes nunca criam dois envelopes.
  const claimed = await prisma.signatureRequest.updateMany({ where: { id: request.id, organizationId: context.organizationId, status: "PREPARADO" }, data: { status: "ENVIADO" } });
  if (claimed.count === 0) return requestForTenant(context.organizationId, request.id);

  let provider: SignatureProvider;
  let installationId: string | null;
  let result: Awaited<ReturnType<SignatureProvider["send"]>>;
  try {
    ({ provider, installationId } = await providerFor(request.provider, context.organizationId));
    const bytes = await contractFileStorage.read(request.document.storageKey);
    result = await provider.send({
      organizationId: context.organizationId, requestId: request.id,
      document: { fileName: request.document.fileName, mimeType: request.document.mimeType, checksum: request.document.checksum, bytes },
      parties: request.parties.map((party) => ({ displayName: party.displayName, email: party.email, role: party.role, order: party.order })),
    });
  } catch (error) {
    await markSignatureError(context, { requestId: request.id, message: error instanceof Error ? error.message : "Falha ao enviar solicitação de assinatura." });
    throw error;
  }

  // A transação só ESCREVE — nunca lê de volta via o `prisma` externo aqui dentro: uma leitura por
  // fora enxergaria o estado pré-commit (conexão separada, read-committed), reproduzindo estado
  // "PREPARADO" mesmo após o `UPDATE` ter sido aplicado. A releitura oficial acontece só depois
  // que a transação já retornou (commit garantido).
  await prisma.$transaction(async (tx) => {
    const update = await tx.signatureRequest.updateMany({ where: { id: request.id, status: "ENVIADO" }, data: { status: "AGUARDANDO_ASSINATURAS", externalId: result.externalId, sentAt: new Date() } });
    if (update.count === 0) return;
    for (const mapping of result.parties ?? []) await tx.signatureParty.updateMany({ where: { requestId: request.id, order: mapping.order }, data: { externalPartyId: mapping.externalPartyId } });
    if (installationId) await tx.externalEntityReference.create({ data: {
      organizationId: context.organizationId, installationId, entityType: "SignatureRequest", entityId: request.id,
      externalType: "CLICKSIGN_ENVELOPE", externalId: result.externalId, externalVersion: request.documentChecksum,
      metadata: json({ documentChecksum: request.documentChecksum }),
    } });
    await tx.signatureEvent.create({ data: { organizationId: context.organizationId, requestId: request.id, eventType: "SENT", occurredAt: new Date(), payload: json({ externalId: result.externalId }) } });
    await tx.auditLog.create({ data: audit(context, request.projectId, "SIGNATURE_REQUEST_SENT", "SignatureRequest", request.id, { externalId: result.externalId }) });
  });
  return requestForTenant(context.organizationId, request.id);
}

// ---------------------------------------------------------------------------
// Efeito de domínio compartilhado (usado pelo caminho MOCK/manual E pelo webhook — item 3/4)
// ---------------------------------------------------------------------------

function buildFinalDocumentManifest(original: string, parties: { displayName: string; role: string; authMethod: string | null; signedAt: Date | null }[]) {
  const lines = parties.map((party) => `- ${party.displayName} (${party.role}) — assinado em ${party.signedAt?.toISOString() ?? "?"} — método: ${party.authMethod ?? "não informado"}`);
  return `${original}\n\n--- MANIFESTO DE ASSINATURA ---\n${lines.join("\n")}\n`;
}

async function finalizeIfComplete(tx: Prisma.TransactionClient, context: Pick<AuthContext, "organizationId" | "userId">, requestId: string) {
  const request = await tx.signatureRequest.findUniqueOrThrow({ where: { id: requestId }, include: { parties: true, document: true, contract: true } });
  const next = nextSignatureRequestStatus(request.parties);
  if (next === "ASSINADO" && request.status !== "ASSINADO") {
    // Provider real somente conclui após o evento de envelope fechado e a obtenção das evidências.
    if (request.provider === "CLICKSIGN") {
      await tx.salesContract.update({ where: { id: request.contractId }, data: { signatureStatus: "PENDING" } });
      return { completed: false, saleId: null };
    }
    const original = new TextDecoder().decode(await contractFileStorage.read(request.document.storageKey));
    const manifest = buildFinalDocumentManifest(original, request.parties);
    const bytes = new TextEncoder().encode(manifest);
    const stored = await contractFileStorage.put({ organizationId: context.organizationId, packageId: request.contractId, fileName: `${request.document.fileName}.assinado.txt`, bytes });
    const lastFinal = await tx.contractDocument.findFirst({ where: { contractId: request.contractId, kind: "SIGNED_FINAL" }, orderBy: { version: "desc" } });
    const finalDocument = await tx.contractDocument.create({ data: {
      organizationId: context.organizationId, contractId: request.contractId, kind: "SIGNED_FINAL", status: "FINAL", version: (lastFinal?.version ?? 0) + 1,
      title: `${request.document.title ?? request.document.fileName} — assinado`, fileName: `${request.document.fileName}.assinado.txt`, mimeType: "text/plain",
      storageProvider: stored.provider, storageKey: stored.key, fileSize: stored.size, checksum: stored.checksum, createdById: context.userId,
    } });
    await tx.signatureRequest.update({ where: { id: request.id }, data: { status: "ASSINADO", completedAt: new Date(), finalDocumentId: finalDocument.id } });
    await tx.signatureEvent.create({ data: { organizationId: context.organizationId, requestId: request.id, eventType: "COMPLETED", occurredAt: new Date(), payload: json({ finalDocumentId: finalDocument.id }) } });
    await tx.salesContract.update({ where: { id: request.contractId }, data: { signatureStatus: "SIGNED" } });
    return { completed: true, saleId: request.contract.saleId };
  }
  const mapped = mapToContractSignatureStatus(request.parties);
  await tx.salesContract.update({ where: { id: request.contractId }, data: { signatureStatus: mapped } });
  return { completed: false, saleId: null };
}

/** Registra assinatura de UM signatário — idempotente (chamar de novo para quem já assinou é no-op). `sourceInboxEventId` só é preenchido quando a origem é um webhook real já deduplicado pela 9H. */
export async function recordPartySigned(context: AuthContext, input: { requestId: string; partyId: string; authMethod?: string }, sourceInboxEventId: string | null = null) {
  assertMutable(context);
  const request = await requestForTenant(context.organizationId, input.requestId);
  const party = request.parties.find((item) => item.id === input.partyId);
  if (!party) throw new Error("Signatário não encontrado nesta solicitação.");
  if (party.status !== "PENDING") return request; // idempotente: já assinou/recusou, no-op
  if (!["ENVIADO", "AGUARDANDO_ASSINATURAS"].includes(request.status)) throw new Error(`Solicitação em status ${request.status} não aceita novas assinaturas.`);

  const result = await prisma.$transaction(async (tx) => {
    const update = await tx.signatureParty.updateMany({ where: { id: party.id, status: "PENDING" }, data: { status: "SIGNED", signedAt: new Date(), authMethod: input.authMethod ?? null } });
    if (update.count === 0) return null; // corrida: outra chamada já processou este signatário
    await tx.signatureEvent.create({ data: { organizationId: context.organizationId, requestId: request.id, sourceInboxEventId, eventType: "PARTY_SIGNED", occurredAt: new Date(), payload: json({ partyId: party.id }) } });
    const outcome = await finalizeIfComplete(tx, context, request.id);
    await tx.auditLog.create({ data: audit(context, request.projectId, "SIGNATURE_PARTY_SIGNED", "SignatureParty", party.id, { requestId: request.id, completed: outcome.completed }) });
    return outcome;
  });

  if (result?.completed && result.saleId) {
    // Melhor esforço: reconfirma recebíveis oficiais no momento em que a assinatura se torna real —
    // `generateSaleReceivables` é replay-safe (mesma idempotência já provada em `sales-service.ts`),
    // então isso nunca duplica o que `approveSale` já gerou; falha aqui não desfaz a assinatura.
    try { await generateSaleReceivables(context, result.saleId); } catch (error) {
      await prisma.auditLog.create({ data: audit(context, request.projectId, "SIGNATURE_RECEIVABLES_RESYNC_FAILED", "Sale", result.saleId, { message: error instanceof Error ? error.message : String(error) }) });
    }
  }
  return requestForTenant(context.organizationId, request.id);
}

export async function recordPartyDeclined(context: AuthContext, input: { requestId: string; partyId: string; reason: string }, sourceInboxEventId: string | null = null) {
  assertMutable(context);
  const request = await requestForTenant(context.organizationId, input.requestId);
  const party = request.parties.find((item) => item.id === input.partyId);
  if (!party) throw new Error("Signatário não encontrado nesta solicitação.");
  if (party.status !== "PENDING") return request; // idempotente
  if (!["ENVIADO", "AGUARDANDO_ASSINATURAS"].includes(request.status)) throw new Error(`Solicitação em status ${request.status} não aceita recusa.`);

  await prisma.$transaction(async (tx) => {
    const update = await tx.signatureParty.updateMany({ where: { id: party.id, status: "PENDING" }, data: { status: "DECLINED", declinedAt: new Date(), declinedReason: input.reason } });
    if (update.count === 0) return; // corrida: outra chamada já processou este signatário
    await tx.signatureEvent.create({ data: { organizationId: context.organizationId, requestId: request.id, sourceInboxEventId, eventType: "PARTY_DECLINED", occurredAt: new Date(), payload: json({ partyId: party.id, reason: input.reason }) } });
    await tx.signatureRequest.updateMany({ where: { id: request.id, status: { in: ["ENVIADO", "AGUARDANDO_ASSINATURAS"] } }, data: { status: "RECUSADO" } });
    await tx.auditLog.create({ data: audit(context, request.projectId, "SIGNATURE_PARTY_DECLINED", "SignatureParty", party.id, { requestId: request.id, reason: input.reason }) });
  });
  return requestForTenant(context.organizationId, request.id);
}

export async function cancelSignatureRequest(context: AuthContext, input: { requestId: string; reason: string }) {
  assertMutable(context);
  const request = await requestForTenant(context.organizationId, input.requestId);
  if (!["PREPARADO", "ENVIADO", "AGUARDANDO_ASSINATURAS"].includes(request.status)) return request;
  if (request.provider === "CLICKSIGN" && request.externalId) {
    const { provider } = await providerFor(request.provider, context.organizationId);
    if (!provider.cancel) throw new Error("Provider não permite cancelamento.");
    await provider.cancel({ externalId: request.externalId, reason: input.reason });
  }
  const result = await prisma.signatureRequest.updateMany({ where: { id: request.id, status: { in: ["PREPARADO", "ENVIADO", "AGUARDANDO_ASSINATURAS"] } }, data: { status: "CANCELADO", cancelledAt: new Date(), cancelledReason: input.reason } });
  if (result.count === 0) return request; // idempotente: já num estado terminal
  await prisma.signatureEvent.create({ data: { organizationId: context.organizationId, requestId: request.id, eventType: "CANCELLED", occurredAt: new Date(), payload: json({ reason: input.reason }) } });
  await prisma.auditLog.create({ data: audit(context, request.projectId, "SIGNATURE_REQUEST_CANCELLED", "SignatureRequest", request.id, { reason: input.reason }) });
  return requestForTenant(context.organizationId, request.id);
}

/** Aplica cancelamento confirmado pelo provider sem iniciar uma nova chamada externa. */
export async function cancelSignatureRequestFromProvider(context: AuthContext, requestId: string, sourceInboxEventId: string) {
  const request = await requestForTenant(context.organizationId, requestId);
  const changed = await prisma.signatureRequest.updateMany({ where: { id: request.id, status: { in: ["ENVIADO", "AGUARDANDO_ASSINATURAS"] } }, data: { status: "CANCELADO", cancelledAt: new Date(), cancelledReason: "Cancelado no provider." } });
  if (!changed.count) return request;
  await prisma.signatureEvent.create({ data: { organizationId: context.organizationId, requestId, sourceInboxEventId, eventType: "CANCELLED", occurredAt: new Date(), payload: json({ source: "provider" }) } });
  await prisma.auditLog.create({ data: audit(context, request.projectId, "SIGNATURE_REQUEST_CANCELLED_BY_PROVIDER", "SignatureRequest", request.id) });
  return requestForTenant(context.organizationId, requestId);
}

/** Conclusão REAL: exige todas as partes, versão local intacta, envelope fechado e PDF final.
 * Artefato auxiliar é provider-neutral e opcional. URLs temporárias nunca são persistidas. */
const reconciliationFailure = (errorClass: "CONFLICT" | "VALIDATION" | "PROVIDER", reasonCode: ConstructorParameters<typeof SignatureReconciliationError>[2]) =>
  new SignatureReconciliationError(errorClass, randomUUID(), reasonCode);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

async function validateReconciliationInbox(tx: Prisma.TransactionClient, organizationId: string, installationId: string, request: { id: string; externalId: string | null }, sourceInboxEventId: string | null) {
  if (sourceInboxEventId === null) return;
  if (typeof sourceInboxEventId !== "string" || !sourceInboxEventId) throw reconciliationFailure("VALIDATION", "SOURCE_INBOX_INVALID");
  const inbox = await tx.integrationInboxEvent.findFirst({
    where: {
      id: sourceInboxEventId, organizationId, installationId, provider: "CLICKSIGN", signatureValid: true,
      status: { in: ["RECEIVED", "VALIDATED", "PROCESSING", "PROCESSED"] },
      installation: { organizationId, connectorDefinition: { provider: "CLICKSIGN" } },
    }, include: { signatureEvent: true },
  });
  const payload = inbox?.payload;
  if (!inbox || !payload || typeof payload !== "object" || Array.isArray(payload) ||
      payload.envelopeId !== request.externalId || payload.eventType !== "ENVELOPE_CLOSED" || payload.eventId !== inbox.eventId ||
      (inbox.signatureEvent && (inbox.signatureEvent.requestId !== request.id || inbox.signatureEvent.eventType !== "COMPLETED"))) {
    throw reconciliationFailure("VALIDATION", "SOURCE_INBOX_INVALID");
  }
}

// Module-private: only the authenticated resolver's validated result can create this evidence.
async function persistReconciledParties(context: AuthContext, requestId: string, installationId: string, sourceInboxEventId: string | null, result: SignatureReconciliationResult, expected: Awaited<ReturnType<typeof requestForTenant>>) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM signature_requests WHERE id = ${requestId} AND organization_id = ${context.organizationId} FOR UPDATE`;
    const request = await tx.signatureRequest.findFirstOrThrow({ where: { id: requestId, organizationId: context.organizationId }, include: { parties: true, document: true } });
    if (!["ENVIADO", "AGUARDANDO_ASSINATURAS"].includes(request.status)) {
      if (request.status === "ASSINADO") return;
      throw reconciliationFailure("CONFLICT", "LOCAL_STATE_INELIGIBLE");
    }
    if (!request.externalId || request.externalId !== expected.externalId || request.documentId !== expected.documentId || request.documentChecksum !== expected.documentChecksum || request.provider !== "CLICKSIGN" || request.document.checksum !== request.documentChecksum ||
        !await tx.externalEntityReference.findFirst({ where: { organizationId: context.organizationId, installationId, entityType: "SignatureRequest", entityId: requestId, externalType: "CLICKSIGN_ENVELOPE", externalId: request.externalId, externalVersion: request.documentChecksum } })) {
      throw reconciliationFailure("VALIDATION", "SIGNATURE_EVIDENCE_INVALID");
    }
    if (sourceInboxEventId !== null) await tx.$queryRaw`SELECT id FROM integration_inbox_events WHERE id = ${sourceInboxEventId} FOR SHARE`;
    await validateReconciliationInbox(tx, context.organizationId, installationId, request, sourceInboxEventId);
    for (const evidence of result.signedParties) {
      const party = request.parties.find((candidate) => candidate.externalPartyId === evidence.externalPartyId);
      if (!party || party.id !== expected.parties.find((candidate) => candidate.externalPartyId === evidence.externalPartyId)?.id) throw reconciliationFailure("VALIDATION", "SIGNER_MISMATCH");
      const existing = await tx.signatureReconciliationEvidence.findUnique({ where: { partyId: party.id } });
      if (existing) {
        if (existing.evidenceRef !== evidence.evidenceRef || existing.documentRef !== result.documentRef || existing.installationId !== installationId || existing.documentChecksum !== request.documentChecksum) {
          throw reconciliationFailure("VALIDATION", "SIGNATURE_EVIDENCE_AMBIGUOUS");
        }
        continue;
      }
      if (!["PENDING", "SIGNED"].includes(party.status)) throw reconciliationFailure("CONFLICT", "LOCAL_STATE_INELIGIBLE");
      const snapshot = { source: "PROVIDER_RECONCILIATION", kind: "SIGN_EVENT", evidenceRef: evidence.evidenceRef, documentRef: result.documentRef, sourceInboxEventId };
      let event = await tx.signatureEvent.findFirst({ where: { requestId, eventType: "PARTY_SIGNED", payload: { path: ["partyId"], equals: party.id } }, orderBy: { recordedAt: "asc" } });
      if (party.status === "SIGNED" && !event) throw reconciliationFailure("VALIDATION", "SIGNATURE_EVIDENCE_INVALID");
      await tx.signatureParty.update({ where: { id: party.id }, data: { status: "SIGNED", signedAt: party.signedAt ?? new Date(), authMethod: "clicksign", evidence: json(snapshot) } });
      if (!event) event = await tx.signatureEvent.create({ data: { organizationId: context.organizationId, requestId, eventType: "PARTY_SIGNED", occurredAt: new Date(), payload: json({ partyId: party.id, ...snapshot }) } });
      await tx.signatureReconciliationEvidence.create({ data: {
        organizationId: context.organizationId, installationId, requestId, partyId: party.id, signatureEventId: event.id, sourceInboxEventId,
        provider: "CLICKSIGN", evidenceRef: evidence.evidenceRef, documentRef: result.documentRef,
        envelopeRef: digest(request.externalId), signerRef: digest(evidence.externalPartyId), documentChecksum: request.documentChecksum,
      } });
      await tx.auditLog.create({ data: audit(context, request.projectId, "SIGNATURE_PARTY_RECONCILED", "SignatureParty", party.id, snapshot) });
    }
    await finalizeIfComplete(tx, context, requestId);
  });
}

export async function completeRealSignatureRequest(
  context: AuthContext,
  requestId: string,
  installationId: string,
  sourceInboxEventId: string | null,
) {
  assertMutable(context);
  const request = await requestForTenant(context.organizationId, requestId, true);
  if (request.status === "ASSINADO") return request;
  if (!["ENVIADO", "AGUARDANDO_ASSINATURAS"].includes(request.status)) throw reconciliationFailure("CONFLICT", "LOCAL_STATE_INELIGIBLE");
  if (!request.externalId || request.document.checksum !== request.documentChecksum) throw reconciliationFailure("VALIDATION", "SIGNATURE_EVIDENCE_INVALID");
  const reference = await prisma.externalEntityReference.findFirst({ where: { organizationId: context.organizationId, installationId, entityType: "SignatureRequest", entityId: request.id, externalType: "CLICKSIGN_ENVELOPE", externalId: request.externalId } });
  if (!reference || reference.externalVersion !== request.documentChecksum) throw reconciliationFailure("VALIDATION", "SIGNATURE_EVIDENCE_INVALID");
  if (request.provider !== "CLICKSIGN") throw reconciliationFailure("VALIDATION", "SIGNATURE_EVIDENCE_INVALID");
  await validateReconciliationInbox(prisma, context.organizationId, installationId, request, sourceInboxEventId);
  const { provider, installationId: resolvedInstallationId } = await providerFor("CLICKSIGN", context.organizationId);
  if (resolvedInstallationId !== installationId || !provider.reconcileSignatures || !provider.status || !provider.finalEvidence) {
    throw reconciliationFailure("VALIDATION", "PROVIDER_RECONCILIATION_UNAVAILABLE");
  }
  const externalPartyIds = request.parties.map((party) => party.externalPartyId);
  if (!externalPartyIds.length || externalPartyIds.some((id) => typeof id !== "string" || !id) || new Set(externalPartyIds).size !== request.parties.length) {
    throw reconciliationFailure("VALIDATION", "LOCAL_PARTY_ID_INVALID");
  }
  const expectedExternalPartyIds = externalPartyIds as string[];
  const reconciliation = await provider.reconcileSignatures({ externalId: request.externalId, expectedExternalPartyIds });
  if (!Array.isArray(reconciliation.signedParties)) throw reconciliationFailure("VALIDATION", "SIGNATURE_EVIDENCE_INVALID");
  const reconciledIds = reconciliation.signedParties.map((party) => party.externalPartyId);
  const evidenceRefs = reconciliation.signedParties.map((party) => party.evidenceRef);
  if (reconciliation.documentStatus !== "CLOSED" || !/^[a-f0-9]{64}$/.test(reconciliation.documentRef) || reconciledIds.length !== expectedExternalPartyIds.length ||
      new Set(reconciledIds).size !== reconciledIds.length || reconciledIds.some((id) => !expectedExternalPartyIds.includes(id)) ||
      evidenceRefs.some((ref) => typeof ref !== "string" || !/^[a-f0-9]{64}$/.test(ref)) || new Set(evidenceRefs).size !== evidenceRefs.length) {
    throw reconciliationFailure("VALIDATION", "SIGNATURE_EVIDENCE_AMBIGUOUS");
  }
  await persistReconciledParties(context, request.id, installationId, sourceInboxEventId, reconciliation, request);
  const reconciledRequest = await requestForTenant(context.organizationId, request.id);
  if (["CANCELADO", "RECUSADO"].includes(reconciledRequest.status)) throw reconciliationFailure("CONFLICT", "LOCAL_STATE_INELIGIBLE");
  if (reconciledRequest.parties.some((party) => party.status !== "SIGNED")) throw reconciliationFailure("CONFLICT", "LOCAL_STATE_INELIGIBLE");
  if (await provider.status(request.externalId) !== "CLOSED") throw reconciliationFailure("CONFLICT", "DOCUMENT_NOT_CLOSED");
  const evidence = await provider.finalEvidence(request.externalId);
  const storedFinal = await contractFileStorage.put({ organizationId: context.organizationId, packageId: request.contractId, fileName: evidence.document.fileName, bytes: evidence.document.bytes });
  const storedAuxiliary = evidence.auxiliary
    ? await contractFileStorage.put({ organizationId: context.organizationId, packageId: request.contractId, fileName: evidence.auxiliary.fileName, bytes: evidence.auxiliary.bytes })
    : null;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM signature_requests WHERE id = ${request.id} AND organization_id = ${context.organizationId} FOR UPDATE`;
    const fresh = await tx.signatureRequest.findFirstOrThrow({ where: { id: request.id, organizationId: context.organizationId }, include: { parties: true } });
    if (fresh.status === "ASSINADO") return;
    if (["CANCELADO", "RECUSADO"].includes(fresh.status) || fresh.parties.some((party) => party.status !== "SIGNED")) {
      throw reconciliationFailure("CONFLICT", "LOCAL_STATE_INELIGIBLE");
    }
    const lastFinal = await tx.contractDocument.findFirst({ where: { contractId: request.contractId, kind: "SIGNED_FINAL" }, orderBy: { version: "desc" } });
    const lastAttachment = storedAuxiliary ? await tx.contractDocument.findFirst({ where: { contractId: request.contractId, kind: "ATTACHMENT" }, orderBy: { version: "desc" } }) : null;
    const finalDocument = await tx.contractDocument.create({ data: { organizationId: context.organizationId, contractId: request.contractId, kind: "SIGNED_FINAL", status: "FINAL", version: (lastFinal?.version ?? 0) + 1, title: "Documento assinado — Clicksign", fileName: evidence.document.fileName, mimeType: evidence.document.mimeType, storageProvider: storedFinal.provider, storageKey: storedFinal.key, fileSize: storedFinal.size, checksum: storedFinal.checksum, createdById: context.userId } });
    if (evidence.auxiliary && storedAuxiliary) await tx.contractDocument.create({ data: { organizationId: context.organizationId, contractId: request.contractId, kind: "ATTACHMENT", status: "FINAL", version: (lastAttachment?.version ?? 0) + 1, title: `Evidência auxiliar — ${evidence.auxiliary.kind}`, fileName: evidence.auxiliary.fileName, mimeType: evidence.auxiliary.mimeType, storageProvider: storedAuxiliary.provider, storageKey: storedAuxiliary.key, fileSize: storedAuxiliary.size, checksum: storedAuxiliary.checksum, createdById: context.userId } });
    await tx.signatureRequest.update({ where: { id: request.id }, data: { status: "ASSINADO", completedAt: new Date(), finalDocumentId: finalDocument.id } });
    await tx.signatureEvent.create({ data: { organizationId: context.organizationId, requestId: request.id, sourceInboxEventId, eventType: "COMPLETED", occurredAt: new Date(), payload: json({ finalDocumentId: finalDocument.id, auxiliaryEvidenceKind: evidence.auxiliary?.kind ?? null }) } });
    await tx.salesContract.update({ where: { id: request.contractId }, data: { signatureStatus: "SIGNED" } });
    await tx.auditLog.create({ data: audit(context, request.projectId, "SIGNATURE_REQUEST_COMPLETED_BY_PROVIDER", "SignatureRequest", request.id, { finalDocumentId: finalDocument.id }) });
  });
  return requestForTenant(context.organizationId, request.id);
}

export async function markSignatureError(context: Pick<AuthContext, "organizationId" | "userId">, input: { requestId: string; message: string }, sourceInboxEventId: string | null = null) {
  const result = await prisma.signatureRequest.updateMany({ where: { id: input.requestId, organizationId: context.organizationId, status: { notIn: ["ASSINADO", "CANCELADO", "ERRO"] } }, data: { status: "ERRO", errorMessage: input.message } });
  if (result.count === 0) return; // idempotente
  await prisma.signatureEvent.create({ data: { organizationId: context.organizationId, requestId: input.requestId, sourceInboxEventId, eventType: "ERROR", occurredAt: new Date(), payload: json({ message: input.message }) } });
  await prisma.auditLog.create({ data: audit(context, null, "SIGNATURE_REQUEST_ERROR", "SignatureRequest", input.requestId, { message: input.message }) });
}

// ---------------------------------------------------------------------------
// Webhook externo futuro (item 3/4): IntegrationInboxEvent (9H) → processamento → SignatureEvent
// ---------------------------------------------------------------------------

export interface SignatureWebhookPayload {
  signatureRequestId: string;
  domainEventType: "PARTY_SIGNED" | "PARTY_DECLINED" | "ERROR";
  partyId?: string;
  reason?: string;
  authMethod?: string;
  evidence?: Record<string, unknown>;
}

/**
 * Único ponto de entrada para eventos de provider real (item 3): recebe/deduplica via
 * `receiveWebhookEvent` (9H, `IntegrationInboxEvent`) e só então aplica o MESMO efeito de domínio
 * de `recordPartySigned`/`recordPartyDeclined`/`markSignatureError` — nenhuma lógica de estado
 * duplicada. Idempotente em duas camadas: (1) `IntegrationInboxEvent.@@unique` nunca grava o
 * mesmo `eventId` duas vezes; (2) `SignatureEvent.sourceInboxEventId @unique` garante no máximo
 * uma projeção de domínio por evento cru já recebido.
 */
export async function processSignatureWebhookEvent(context: AuthContext, input: { installationId: string; provider: string; eventId: string; signatureValid: boolean; payload: SignatureWebhookPayload }) {
  const inboxEvent = await receiveWebhookEvent(context, input.installationId, { provider: input.provider, eventId: input.eventId, signatureValid: input.signatureValid, payload: input.payload as unknown as Record<string, unknown> });
  if (inboxEvent.status === "REJECTED") return { inboxEvent, signatureEvent: null };

  const existingProjection = await prisma.signatureEvent.findUnique({ where: { sourceInboxEventId: inboxEvent.id } });
  if (existingProjection) return { inboxEvent, signatureEvent: existingProjection }; // replay do mesmo webhook: no-op

  const payload = input.payload;
  if (payload.domainEventType === "PARTY_SIGNED") {
    if (!payload.partyId) throw new Error("Evento de assinatura sem partyId.");
    await recordPartySigned(context, { requestId: payload.signatureRequestId, partyId: payload.partyId, authMethod: payload.authMethod }, inboxEvent.id);
  } else if (payload.domainEventType === "PARTY_DECLINED") {
    if (!payload.partyId) throw new Error("Evento de recusa sem partyId.");
    await recordPartyDeclined(context, { requestId: payload.signatureRequestId, partyId: payload.partyId, reason: payload.reason ?? "Recusado pelo signatário." }, inboxEvent.id);
  } else {
    await markSignatureError(context, { requestId: payload.signatureRequestId, message: payload.reason ?? "Erro reportado pelo provider." }, inboxEvent.id);
  }

  await prisma.integrationInboxEvent.update({ where: { id: inboxEvent.id }, data: { status: "PROCESSED", processedAt: new Date() } });
  const signatureEvent = await prisma.signatureEvent.findUnique({ where: { sourceInboxEventId: inboxEvent.id } });
  return { inboxEvent, signatureEvent };
}
