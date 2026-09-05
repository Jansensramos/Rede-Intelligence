import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { createCustomer } from "@/application/financial-ops/financial-service";
import { activateSalesPriceTable, approveSale, createSale, createSalesPriceTable, createSalesUnit } from "@/application/sales/sales-service";
import { addContractAttachment, approveContractTemplateVersion, createContractTemplate, createContractTemplateVersion, generateContractDocument, readContractDocumentBytes, updateContractTemplateVersionDraft } from "@/application/sales/contract-service";
import { cancelSignatureRequest, completeRealSignatureRequest, prepareSignatureRequest, processSignatureWebhookEvent, recordPartySigned, sendSignatureRequest } from "@/application/sales/signature-service";
import { requestCreditConsultation } from "@/application/sales/credit-service";
import { maskTaxId } from "@/domain/sales/contract-closing";
import { SignatureReconciliationError, type SignatureProvider } from "@/domain/sales/signature-provider";
import { ClicksignProviderError } from "@/infrastructure/adapters/signature/clicksign-signature-provider";
import * as clicksignService from "@/application/sales/clicksign-service";
import { contractFileStorage } from "@/infrastructure/storage/contract-file-storage";

const token = randomUUID().slice(0, 8);
const createdUnitIds: string[] = [];
const createdSaleIds: string[] = [];
const createdPriceTableIds: string[] = [];
const createdTemplateIds: string[] = [];
let connectorDefinitionId: string;
let connectorInstallationId: string;

async function makeApprovedSale(context: AuthContext, projectId: string, companyId: string, customerId: string, code: string, price: string) {
  const unit = await createSalesUnit(context, { projectId, companyId, code, typology: "3 dormitórios", privateAreaM2: "80" });
  createdUnitIds.push(unit.id);
  const table = await createSalesPriceTable(context, { projectId, companyId, validFrom: new Date("2026-08-01T00:00:00Z"), responsibleId: context.userId, lines: [{ salesUnitId: unit.id, listPrice: price, minimumAuthorizedPrice: "0" }] });
  createdPriceTableIds.push(table.id);
  const activated = await activateSalesPriceTable(context, table.id);
  const sale = await createSale(context, { salesUnitId: unit.id, priceTableId: activated.id, soldPrice: price, parties: [{ customerId, role: "BUYER" }] });
  createdSaleIds.push(sale.id);
  const { sale: approved, contract } = await approveSale(context, { saleId: sale.id, contract: { number: `CV-9K4-${code}`, title: `Contrato — ${code}` }, installments: [{ number: 1, nature: "DOWN_PAYMENT", dueDate: new Date("2026-10-10T00:00:00Z"), amount: price }] });
  return { unit, sale: approved, contract };
}

describe.skipIf(!process.env.DATABASE_URL).sequential("Fase 9K.4 — Fechamento Comercial 360 (contrato/assinatura/crédito) contra PostgreSQL real", () => {
  let context: AuthContext;
  let viewerContext: AuthContext;
  let projectId: string;
  let companyId: string;
  let customerId: string;

  afterEach(() => vi.restoreAllMocks());

  beforeAll(async () => {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: "rede-nucleo-de-negocios" } });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "admin@rede.local" } });
    const project = await prisma.project.findUniqueOrThrow({ where: { organizationId_name: { organizationId: organization.id, name: "START BUTANTÃ" } } });
    context = { sessionId: "test", userId: user.id, userName: user.name, userEmail: user.email, organizationId: organization.id, organizationName: organization.name, organizationSlug: organization.slug, role: "OWNER" };
    viewerContext = { ...context, role: "VIEWER" };
    projectId = project.id; companyId = project.companyId!;
    const customer = await createCustomer(context, { name: `Cliente 9K4 ${token}`, taxId: `52998224725${token.slice(0, 3)}` });
    customerId = customer.id;

    const definition = await prisma.connectorDefinition.create({ data: { code: `signature-mock-test-${token}`, name: "Assinatura (teste)", provider: "CLICKSIGN", category: "OTHER", authMethod: "NONE", capabilities: {}, adapterVersion: "1", contractVersion: "1" } });
    connectorDefinitionId = definition.id;
    const installation = await prisma.connectorInstallation.create({ data: { organizationId: context.organizationId, connectorDefinitionId: definition.id, projectId, name: "Assinatura (teste)", direction: "INBOUND", status: "ACTIVE", createdById: context.userId } });
    connectorInstallationId = installation.id;
  });

  afterAll(async () => {
    try {
      const requests = await prisma.signatureRequest.findMany({ where: { contract: { saleId: { in: createdSaleIds } } } });
      const requestIds = requests.map((r) => r.id);
      // Append-only evidence and its FK context must survive fixture cleanup too.
      // Retain this suite's connected fixtures in the isolated test database.
      if (await prisma.signatureReconciliationEvidence.count({ where: { requestId: { in: requestIds } } })) {
        await prisma.connectorInstallation.update({ where: { id: connectorInstallationId }, data: { status: "PAUSED" } });
        return;
      }
      await prisma.externalEntityReference.deleteMany({ where: { entityType: "SignatureRequest", entityId: { in: requestIds } } });
      await prisma.signatureEvent.deleteMany({ where: { requestId: { in: requestIds } } });
      await prisma.signatureParty.deleteMany({ where: { requestId: { in: requestIds } } });
      await prisma.signatureRequest.deleteMany({ where: { id: { in: requestIds } } });
      await prisma.contractDocument.deleteMany({ where: { contract: { saleId: { in: createdSaleIds } } } });
      await prisma.creditBureauConsultation.deleteMany({ where: { customerId } });
      await prisma.integrationInboxEvent.deleteMany({ where: { installationId: connectorInstallationId } });
      await prisma.connectorInstallation.deleteMany({ where: { id: connectorInstallationId } });
      await prisma.connectorDefinition.deleteMany({ where: { id: connectorDefinitionId } });
      await prisma.salesContract.updateMany({ where: { saleId: { in: createdSaleIds } }, data: { templateVersionId: null } });
      await prisma.contractTemplateVersion.deleteMany({ where: { templateId: { in: createdTemplateIds } } });
      await prisma.contractTemplate.deleteMany({ where: { id: { in: createdTemplateIds } } });

      const receivableAccounts = await prisma.receivableAccount.findMany({ where: { saleId: { in: createdSaleIds } } });
      await prisma.financialIntegrationEvent.deleteMany({ where: { receivableAccountId: { in: receivableAccounts.map((a) => a.id) } } });
      await prisma.receivablePayment.deleteMany({ where: { installment: { receivableAccountId: { in: receivableAccounts.map((a) => a.id) } } } });
      await prisma.receivableInstallment.deleteMany({ where: { receivableAccountId: { in: receivableAccounts.map((a) => a.id) } } });
      const obligationIds = receivableAccounts.flatMap((a) => (a.obligationId ? [a.obligationId] : []));
      await prisma.receivableAccount.deleteMany({ where: { id: { in: receivableAccounts.map((a) => a.id) } } });
      await prisma.financialObligation.deleteMany({ where: { id: { in: obligationIds } } });
      await prisma.salesPaymentPlanInstallment.deleteMany({ where: { plan: { saleId: { in: createdSaleIds } } } });
      await prisma.salesPaymentPlan.deleteMany({ where: { saleId: { in: createdSaleIds } } });
      await prisma.salesContract.deleteMany({ where: { saleId: { in: createdSaleIds } } });
      await prisma.saleParty.deleteMany({ where: { saleId: { in: createdSaleIds } } });
      await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
      await prisma.salesPriceTableLine.deleteMany({ where: { priceTableId: { in: createdPriceTableIds } } });
      await prisma.salesPriceTable.deleteMany({ where: { id: { in: createdPriceTableIds } } });
      await prisma.salesUnit.deleteMany({ where: { id: { in: createdUnitIds } } });
      await prisma.customer.deleteMany({ where: { id: customerId } });
    } catch (error) {
      console.warn("Limpeza pós-teste 9K.4 não concluída — dados de teste podem persistir:", error);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("modelo/versão: rascunho editável, aprovado imutável, nova versão nunca sobrescreve (itens 1/6)", async () => {
    const template = await createContractTemplate(context, { projectId, name: `Modelo Padrão ${token}` });
    createdTemplateIds.push(template.id);
    const v1 = await createContractTemplateVersion(context, { templateId: template.id, content: "Contrato {{contractNumber}} — {{buyerNames}} — R$ {{soldPrice}}" });
    expect(v1.version).toBe(1);
    expect(v1.status).toBe("DRAFT");

    await updateContractTemplateVersionDraft(context, { versionId: v1.id, content: "Contrato {{contractNumber}} — comprador(es) {{buyerNames}} — R$ {{soldPrice}}" });
    const approved = await approveContractTemplateVersion(context, v1.id);
    expect(approved.status).toBe("APPROVED");

    await expect(updateContractTemplateVersionDraft(context, { versionId: v1.id, content: "tentativa de reescrever versão aprovada" })).rejects.toThrow(/imutável/);

    const v2 = await createContractTemplateVersion(context, { templateId: template.id, content: "v2" });
    expect(v2.version).toBe(2);
    const reloadedV1 = await prisma.contractTemplateVersion.findUniqueOrThrow({ where: { id: v1.id } });
    expect(reloadedV1.content).toContain("comprador(es)"); // conteúdo da v1 nunca foi alterado pela criação da v2
  });

  it("documento contratual: gerado a partir de versão aprovada, storage por referência (nunca Bytes no Postgres), anexo separado (itens 1/3/9)", async () => {
    const { contract } = await makeApprovedSale(context, projectId, companyId, customerId, `DOC-${token}`, "400000");
    const template = await createContractTemplate(context, { projectId, name: `Modelo Documento ${token}` });
    createdTemplateIds.push(template.id);
    const version = await createContractTemplateVersion(context, { templateId: template.id, content: "Contrato {{contractNumber}} no valor de R$ {{soldPrice}}." });

    await expect(generateContractDocument(context, { contractId: contract.id, templateVersionId: version.id })).rejects.toThrow(/aprovada/);
    await approveContractTemplateVersion(context, version.id);

    const document = await generateContractDocument(context, { contractId: contract.id, templateVersionId: version.id });
    expect(document.kind).toBe("MODEL_RENDER");
    expect(document.storageProvider).toBeTruthy();
    expect(document.storageKey).toBeTruthy();
    expect((document as unknown as { content?: unknown }).content).toBeUndefined(); // nenhum campo `content`/Bytes no model — só metadado + referência

    const { bytes } = await readContractDocumentBytes(context, document.id);
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe(`Contrato ${contract.number} no valor de R$ 400000.`);

    const attachment = await addContractAttachment(context, { contractId: contract.id, fileName: "planta.pdf", mimeType: "application/pdf", bytes: new TextEncoder().encode("PDF-FALSO") });
    expect(attachment.kind).toBe("ATTACHMENT");
    const { bytes: attachmentBytes } = await readContractDocumentBytes(context, attachment.id);
    expect(new TextDecoder().decode(attachmentBytes)).toBe("PDF-FALSO");
  });

  it("assinatura MOCK: ciclo completo idempotente, parcial→completo, contrato reflete signatureStatus, recebíveis não duplicam (itens 4/D)", async () => {
    const { contract, sale } = await makeApprovedSale(context, projectId, companyId, customerId, `SIG-${token}`, "350000");
    const receivablesBefore = await prisma.receivableAccount.count({ where: { saleId: sale.id } });

    const template = await createContractTemplate(context, { projectId, name: `Modelo Assinatura ${token}` });
    createdTemplateIds.push(template.id);
    const version = await createContractTemplateVersion(context, { templateId: template.id, content: "Contrato {{contractNumber}}" });
    await approveContractTemplateVersion(context, version.id);
    const document = await generateContractDocument(context, { contractId: contract.id, templateVersionId: version.id });

    let request = await prepareSignatureRequest(context, { contractId: contract.id, documentId: document.id, parties: [{ customerId, displayName: "Comprador 1", role: "BUYER" }, { displayName: "Vendedor", role: "SELLER" }] });
    expect(request.status).toBe("PREPARADO");

    request = await sendSignatureRequest(context, request.id);
    expect(request.status).toBe("AGUARDANDO_ASSINATURAS");
    expect(request.externalId).toBeTruthy();

    const [party1, party2] = request.parties;
    await recordPartySigned(context, { requestId: request.id, partyId: party1.id, authMethod: "email" });
    const contractAfterFirst = await prisma.salesContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(contractAfterFirst.signatureStatus).toBe("PARTIALLY_SIGNED");

    // Idempotência: assinar de novo o MESMO signatário é no-op — não duplica SignatureEvent.
    await recordPartySigned(context, { requestId: request.id, partyId: party1.id, authMethod: "email" });
    const partySignedEvents = await prisma.signatureEvent.count({ where: { requestId: request.id, eventType: "PARTY_SIGNED" } });
    expect(partySignedEvents).toBe(1);

    await recordPartySigned(context, { requestId: request.id, partyId: party2.id, authMethod: "email" });
    const finalRequest = await prisma.signatureRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(finalRequest.status).toBe("ASSINADO");
    expect(finalRequest.finalDocumentId).toBeTruthy();
    const finalDocument = await prisma.contractDocument.findUniqueOrThrow({ where: { id: finalRequest.finalDocumentId! } });
    expect(finalDocument.kind).toBe("SIGNED_FINAL");
    const contractAfterComplete = await prisma.salesContract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(contractAfterComplete.signatureStatus).toBe("SIGNED");

    // Zero dupla contagem: assinatura completa reconfirma recebíveis (idempotente) — mesma contagem de antes.
    const receivablesAfter = await prisma.receivableAccount.count({ where: { saleId: sale.id } });
    expect(receivablesAfter).toBe(receivablesBefore);
  });

  async function makeClicksignRequest(code: string, partyCount = 1) {
    const { contract } = await makeApprovedSale(context, projectId, companyId, customerId, `REC-${code}-${token}`, "310000");
    const template = await createContractTemplate(context, { projectId, name: `Modelo Reconciliação ${code} ${token}` });
    createdTemplateIds.push(template.id);
    const version = await createContractTemplateVersion(context, { templateId: template.id, content: "Contrato de reconciliação {{contractNumber}}" });
    await approveContractTemplateVersion(context, version.id);
    const document = await generateContractDocument(context, { contractId: contract.id, templateVersionId: version.id });
    const request = await prepareSignatureRequest(context, {
      contractId: contract.id, documentId: document.id, provider: "CLICKSIGN",
      parties: Array.from({ length: partyCount }, (_, index) => ({ displayName: `Parte ${index + 1}`, role: index === 0 ? "BUYER" : "SELLER" })),
    });
    const externalId = `env-reconciliation-${code}-${token}`;
    await prisma.signatureRequest.update({ where: { id: request.id }, data: { status: "AGUARDANDO_ASSINATURAS", externalId, sentAt: new Date() } });
    for (const party of request.parties) await prisma.signatureParty.update({ where: { id: party.id }, data: { externalPartyId: `signer-${code}-${party.order}` } });
    await prisma.externalEntityReference.create({ data: {
      organizationId: context.organizationId, installationId: connectorInstallationId, entityType: "SignatureRequest", entityId: request.id,
      externalType: "CLICKSIGN_ENVELOPE", externalId, externalVersion: request.documentChecksum,
    } });
    return prisma.signatureRequest.findUniqueOrThrow({ where: { id: request.id }, include: { parties: true } });
  }

  function reconciledProvider(request: Awaited<ReturnType<typeof makeClicksignRequest>>, options: { finalFailure?: boolean; partial?: boolean } = {}) {
    const expected = request.parties.map((party) => party.externalPartyId!);
    const provider: SignatureProvider = {
      code: "CLICKSIGN",
      send: vi.fn(async () => { throw new Error("send não permitido na reconciliação"); }),
      reconcileSignatures: vi.fn(async () => {
        if (options.partial) throw new SignatureReconciliationError("PROVIDER", "corr-pending", "SIGNATURE_EVIDENCE_PENDING", 2_000);
        return { documentStatus: "CLOSED" as const, documentRef: "d".repeat(64), signedParties: expected.map((externalPartyId, index) => ({ externalPartyId, evidenceRef: `${index + 1}`.padStart(64, "a") })) };
      }),
      status: vi.fn(async () => "CLOSED" as const),
      finalEvidence: vi.fn(async () => {
        if (options.finalFailure) throw new ClicksignProviderError("VALIDATION", "corr-pdf", null, "PDF_INVALID");
        return { document: { fileName: "documento-assinado.pdf", mimeType: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.7\nfinal") } };
      }),
    };
    vi.spyOn(clicksignService, "clicksignProviderForOrganization").mockResolvedValue({ provider, installationId: connectorInstallationId });
    return provider;
  }

  it("reconciliação provider-neutral promove PENDING → SIGNED e conclui com SIGNED_FINAL", async () => {
    const request = await makeClicksignRequest("complete");
    reconciledProvider(request);
    const completed = await completeRealSignatureRequest(context, request.id, connectorInstallationId, null);
    expect(completed.status).toBe("ASSINADO");
    expect(completed.parties[0]?.status).toBe("SIGNED");
    const finalDocument = await prisma.contractDocument.findUniqueOrThrow({ where: { id: completed.finalDocumentId! } });
    expect(finalDocument.kind).toBe("SIGNED_FINAL");
    const signedEvent = await prisma.signatureEvent.findFirstOrThrow({ where: { requestId: request.id, eventType: "PARTY_SIGNED" } });
    expect(signedEvent.sourceInboxEventId).toBeNull();
    expect(completed.parties[0].evidence).toMatchObject({ source: "PROVIDER_RECONCILIATION", kind: "SIGN_EVENT", sourceInboxEventId: null, evidenceRef: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(await prisma.signatureReconciliationEvidence.findUniqueOrThrow({ where: { partyId: completed.parties[0].id } })).toMatchObject({ sourceInboxEventId: null, source: "PROVIDER_RECONCILIATION", documentRef: "d".repeat(64) });
    expect(JSON.stringify(signedEvent.payload)).not.toMatch(/signer-|env-reconciliation|Parte/);
  });

  async function closedInbox(request: Awaited<ReturnType<typeof makeClicksignRequest>>) {
    const eventId = `synthetic-closed-${randomUUID()}`;
    return prisma.integrationInboxEvent.create({ data: {
      organizationId: context.organizationId, installationId: connectorInstallationId, provider: "CLICKSIGN",
      signatureValid: true, eventId, payloadChecksum: "synthetic-checksum",
      payload: { eventId, eventType: "ENVELOPE_CLOSED", envelopeId: request.externalId, signerId: null, occurredAt: null },
    } });
  }

  it("inbox autenticado preserva a FK em COMPLETED e a origem nas evidências de duas partes, sem duplicar no replay", async () => {
    const request = await makeClicksignRequest("inbox-complete", 2);
    const inbox = await closedInbox(request);
    const provider = reconciledProvider(request);
    const completed = await completeRealSignatureRequest(context, request.id, connectorInstallationId, inbox.id);
    expect(completed.status).toBe("ASSINADO");
    for (const party of completed.parties) expect(party.evidence).toMatchObject({
      source: "PROVIDER_RECONCILIATION", kind: "SIGN_EVENT", sourceInboxEventId: inbox.id,
      evidenceRef: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const events = await prisma.signatureEvent.findMany({ where: { requestId: request.id, eventType: { in: ["PARTY_SIGNED", "COMPLETED"] } } });
    expect(events.filter((event) => event.eventType === "PARTY_SIGNED")).toHaveLength(2);
    expect(events.filter((event) => event.sourceInboxEventId === inbox.id)).toMatchObject([{ eventType: "COMPLETED" }]);
    await completeRealSignatureRequest(context, request.id, connectorInstallationId, inbox.id);
    expect(provider.reconcileSignatures).toHaveBeenCalledTimes(1);
    expect(await prisma.signatureEvent.count({ where: { requestId: request.id, eventType: { in: ["PARTY_SIGNED", "COMPLETED"] } } })).toBe(3);
  });

  it.each(["missing", "empty", "tenant", "installation", "provider", "envelope", "event-type", "event-id", "signature", "quarantined", "consumed"])("recusa inbox incompatível (%s) antes do provider ou de promover partes", async (invalid) => {
    const request = await makeClicksignRequest(`inbox-${invalid}`, 2);
    const inbox = await closedInbox(request);
    const provider = reconciledProvider(request);
    let inboxId = inbox.id;
    if (invalid === "missing") inboxId = "missing-inbox";
    if (invalid === "empty") inboxId = "";
    if (invalid === "tenant") {
      const other = await prisma.organization.findFirstOrThrow({ where: { id: { not: context.organizationId } } });
      await prisma.integrationInboxEvent.update({ where: { id: inbox.id }, data: { organizationId: other.id } });
    }
    if (invalid === "installation") {
      const other = await prisma.connectorInstallation.findFirstOrThrow({ where: { id: { not: connectorInstallationId } } });
      await prisma.integrationInboxEvent.update({ where: { id: inbox.id }, data: { installationId: other.id } });
    }
    if (invalid === "provider") await prisma.integrationInboxEvent.update({ where: { id: inbox.id }, data: { provider: "OTHER" } });
    if (invalid === "signature") await prisma.integrationInboxEvent.update({ where: { id: inbox.id }, data: { signatureValid: false } });
    if (invalid === "quarantined") await prisma.integrationInboxEvent.update({ where: { id: inbox.id }, data: { status: "QUARANTINED" } });
    if (["envelope", "event-type", "event-id"].includes(invalid)) await prisma.integrationInboxEvent.update({ where: { id: inbox.id }, data: { payload: {
      eventId: invalid === "event-id" ? "other-event" : inbox.eventId,
      eventType: invalid === "event-type" ? "PARTY_SIGNED" : "ENVELOPE_CLOSED",
      envelopeId: invalid === "envelope" ? "other-envelope" : request.externalId,
    } } });
    if (invalid === "consumed") await prisma.signatureEvent.create({ data: { organizationId: context.organizationId, requestId: request.id, sourceInboxEventId: inbox.id, eventType: "ERROR", occurredAt: new Date() } });
    const error = await completeRealSignatureRequest(context, request.id, connectorInstallationId, inboxId).catch((error: unknown) => error);
    expect(error).toMatchObject({ errorClass: "VALIDATION", reasonCode: "SOURCE_INBOX_INVALID", correlationId: expect.any(String) });
    expect(String(error)).not.toContain(inbox.eventId);
    expect(String(error)).not.toContain(request.externalId);
    expect(provider.reconcileSignatures).not.toHaveBeenCalled();
    expect(provider.finalEvidence).not.toHaveBeenCalled();
    expect(await prisma.signatureParty.count({ where: { requestId: request.id, status: "SIGNED" } })).toBe(0);
    expect(await prisma.signatureEvent.count({ where: { requestId: request.id, eventType: "PARTY_SIGNED" } })).toBe(0);
    await prisma.integrationInboxEvent.delete({ where: { id: inbox.id } });
  });

  it("origem de inbox sobrevive a falha no PDF e retries concorrentes sem duplicar assinatura", async () => {
    const request = await makeClicksignRequest("inbox-retry");
    const inbox = await closedInbox(request);
    reconciledProvider(request, { finalFailure: true });
    await Promise.allSettled(Array.from({ length: 3 }, () => completeRealSignatureRequest(context, request.id, connectorInstallationId, inbox.id)));
    const party = await prisma.signatureParty.findUniqueOrThrow({ where: { id: request.parties[0].id } });
    expect(party.status).toBe("SIGNED");
    expect(party.evidence).toMatchObject({ sourceInboxEventId: inbox.id });
    expect(await prisma.signatureEvent.count({ where: { requestId: request.id, eventType: "PARTY_SIGNED" } })).toBe(1);
    expect(await prisma.signatureEvent.count({ where: { sourceInboxEventId: inbox.id } })).toBe(0);
    const proof = await prisma.signatureReconciliationEvidence.findUniqueOrThrow({ where: { partyId: party.id }, include: { signatureEvent: true, sourceInboxEvent: true } });
    expect(proof).toMatchObject({ sourceInboxEventId: inbox.id, requestId: request.id, organizationId: context.organizationId, installationId: connectorInstallationId, signatureEvent: { eventType: "PARTY_SIGNED" }, sourceInboxEvent: { id: inbox.id } });
    expect(proof.evidenceRef).toMatch(/^[a-f0-9]{64}$/);
    expect(await prisma.signatureEvent.count({ where: { requestId: request.id, eventType: "COMPLETED" } })).toBe(0);
    await expect(prisma.signatureReconciliationEvidence.update({ where: { id: proof.id }, data: { evidenceRef: "b".repeat(64) } })).rejects.toThrow("SIGNATURE_EVIDENCE_IMMUTABLE");
    await expect(prisma.signatureReconciliationEvidence.delete({ where: { id: proof.id } })).rejects.toThrow("SIGNATURE_EVIDENCE_IMMUTABLE");
    await expect(prisma.$executeRaw`TRUNCATE TABLE signature_reconciliation_evidence`).rejects.toThrow("SIGNATURE_EVIDENCE_IMMUTABLE");
    await expect(prisma.signatureParty.update({ where: { id: party.id }, data: { evidence: { forged: true } } })).rejects.toThrow("SIGNATURE_EVIDENCE_CONTEXT_IMMUTABLE");
    await expect(prisma.signatureEvent.update({ where: { id: proof.signatureEventId }, data: { payload: {} } })).rejects.toThrow("SIGNATURE_EVIDENCE_CONTEXT_IMMUTABLE");
    await expect(prisma.integrationInboxEvent.update({ where: { id: inbox.id }, data: { payload: {} } })).rejects.toThrow("SIGNATURE_EVIDENCE_CONTEXT_IMMUTABLE");
    await expect(prisma.integrationInboxEvent.delete({ where: { id: inbox.id } })).rejects.toThrow();
    await expect(prisma.signatureRequest.delete({ where: { id: request.id } })).rejects.toThrow();
    await expect(prisma.signatureRequest.update({ where: { id: request.id }, data: { documentChecksum: "forged" } })).rejects.toThrow("SIGNATURE_EVIDENCE_CONTEXT_IMMUTABLE");
    await prisma.integrationInboxEvent.update({ where: { id: inbox.id }, data: { status: "PROCESSING" } });
    expect(await prisma.signatureReconciliationEvidence.count({ where: { partyId: party.id } })).toBe(1);
    reconciledProvider(request);
    await completeRealSignatureRequest(context, request.id, connectorInstallationId, inbox.id);
    expect(await prisma.signatureEvent.count({ where: { sourceInboxEventId: inbox.id, eventType: "COMPLETED" } })).toBe(1);
  });

  it("handler produtivo reconcilia partes PENDING, preserva prova após falha do PDF e conclui no retry", async () => {
    const request = await makeClicksignRequest("handler-pending", 2);
    const inbox = await closedInbox(request);
    const definition = await prisma.connectorDefinition.findUniqueOrThrow({ where: { code: "CLICKSIGN_API_V3" } });
    await prisma.connectorInstallation.update({ where: { id: connectorInstallationId }, data: { connectorDefinitionId: definition.id } });
    const job = await prisma.integrationJob.create({ data: { organizationId: context.organizationId, installationId: connectorInstallationId, jobType: "PROCESS_SIGNATURE_WEBHOOK", payload: { inboxEventId: inbox.id }, correlationId: randomUUID() } });
    const provider = reconciledProvider(request, { finalFailure: true });
    await expect(clicksignService.processClicksignWebhookJob(job)).rejects.toMatchObject({ reasonCode: "PDF_INVALID" });
    expect(provider.reconcileSignatures).toHaveBeenCalledTimes(1);
    expect(await prisma.signatureReconciliationEvidence.count({ where: { requestId: request.id, sourceInboxEventId: inbox.id } })).toBe(2);
    expect(await prisma.signatureRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ status: "AGUARDANDO_ASSINATURAS", finalDocumentId: null });
    expect(await prisma.integrationInboxEvent.findUniqueOrThrow({ where: { id: inbox.id } })).toMatchObject({ status: "RECEIVED" });
    expect(await prisma.integrationQuarantineItem.count({ where: { installationId: connectorInstallationId, externalId: inbox.eventId } })).toBe(0);
    reconciledProvider(request);
    await clicksignService.processClicksignWebhookJob(job);
    await clicksignService.processClicksignWebhookJob(job);
    expect(await prisma.signatureRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ status: "ASSINADO" });
    expect(await prisma.signatureEvent.count({ where: { requestId: request.id, eventType: "COMPLETED" } })).toBe(1);
    expect(await prisma.integrationInboxEvent.findUniqueOrThrow({ where: { id: inbox.id } })).toMatchObject({ status: "PROCESSED" });
    expect(await prisma.signatureReconciliationEvidence.count({ where: { requestId: request.id } })).toBe(2);
  });

  it("evidência rejeita vínculo relacional cruzado sem alterar dados históricos", async () => {
    const request = await makeClicksignRequest("cross-proof");
    const other = await makeClicksignRequest("cross-proof-other");
    const inbox = await closedInbox(request);
    reconciledProvider(request, { finalFailure: true });
    await expect(completeRealSignatureRequest(context, request.id, connectorInstallationId, inbox.id)).rejects.toMatchObject({ reasonCode: "PDF_INVALID" });
    const proof = await prisma.signatureReconciliationEvidence.findUniqueOrThrow({ where: { partyId: request.parties[0].id } });
    const { id: _id, recordedAt: _recordedAt, ...data } = proof;
    void _id; void _recordedAt;
    await expect(prisma.signatureReconciliationEvidence.create({ data: { ...data, partyId: other.parties[0].id, requestId: other.id } })).rejects.toThrow("SIGNATURE_EVIDENCE_CONTEXT_INVALID");
    expect(await prisma.signatureReconciliationEvidence.count({ where: { requestId: other.id } })).toBe(0);
  });

  it("falha do PDF após reconciliação preserva SIGNED sem concluir nem persistir SIGNED_FINAL", async () => {
    const request = await makeClicksignRequest("pdf-failure");
    reconciledProvider(request, { finalFailure: true });
    const putSpy = vi.spyOn(contractFileStorage, "put");
    await expect(completeRealSignatureRequest(context, request.id, connectorInstallationId, null)).rejects.toMatchObject({ reasonCode: "PDF_INVALID" });
    const reloaded = await prisma.signatureRequest.findUniqueOrThrow({ where: { id: request.id }, include: { parties: true } });
    expect(reloaded.status).toBe("AGUARDANDO_ASSINATURAS");
    expect(reloaded.parties[0]?.status).toBe("SIGNED");
    expect(reloaded.finalDocumentId).toBeNull();
    expect(await prisma.contractDocument.count({ where: { contractId: reloaded.contractId, kind: "SIGNED_FINAL" } })).toBe(0);
    expect(putSpy).not.toHaveBeenCalled();
    putSpy.mockRestore();
  });

  it("reconciliações repetidas e concorrentes são idempotentes", async () => {
    const request = await makeClicksignRequest("concurrent");
    reconciledProvider(request, { finalFailure: true });
    await Promise.allSettled(Array.from({ length: 4 }, () => completeRealSignatureRequest(context, request.id, connectorInstallationId, null)));
    expect(await prisma.signatureEvent.count({ where: { requestId: request.id, eventType: "PARTY_SIGNED" } })).toBe(1);
    const reloaded = await prisma.signatureRequest.findUniqueOrThrow({ where: { id: request.id }, include: { parties: true } });
    expect(reloaded.parties[0]?.status).toBe("SIGNED");
    expect(reloaded.status).toBe("AGUARDANDO_ASSINATURAS");
  });

  it("evidência parcial, tenant alheio e instalação alheia falham fechado", async () => {
    const request = await makeClicksignRequest("guards", 2);
    reconciledProvider(request, { partial: true });
    await expect(completeRealSignatureRequest(context, request.id, connectorInstallationId, null)).rejects.toMatchObject({ reasonCode: "SIGNATURE_EVIDENCE_PENDING" });
    expect(await prisma.signatureParty.count({ where: { requestId: request.id, status: "SIGNED" } })).toBe(0);

    const otherOrganization = await prisma.organization.findFirstOrThrow({ where: { id: { not: context.organizationId } } });
    await expect(completeRealSignatureRequest({ ...context, organizationId: otherOrganization.id }, request.id, connectorInstallationId, null)).rejects.toMatchObject({ reasonCode: "SIGNATURE_EVIDENCE_INVALID", correlationId: expect.any(String) });
    await expect(completeRealSignatureRequest(context, request.id, "other-installation", null)).rejects.toMatchObject({ reasonCode: "SIGNATURE_EVIDENCE_INVALID" });
  });

  it.each(["CANCELADO", "RECUSADO"] as const)("reconciliação não altera solicitação %s", async (terminalStatus) => {
    const request = await makeClicksignRequest(`terminal-${terminalStatus.toLowerCase()}`);
    await prisma.signatureRequest.update({ where: { id: request.id }, data: { status: terminalStatus } });
    const provider = reconciledProvider(request);
    await expect(completeRealSignatureRequest(context, request.id, connectorInstallationId, null)).rejects.toMatchObject({ reasonCode: "LOCAL_STATE_INELIGIBLE" });
    expect(provider.reconcileSignatures).not.toHaveBeenCalled();
    const reloaded = await prisma.signatureRequest.findUniqueOrThrow({ where: { id: request.id }, include: { parties: true } });
    expect(reloaded.status).toBe(terminalStatus);
    expect(reloaded.parties[0]?.status).toBe("PENDING");
  });

  it("webhook (9H IntegrationInboxEvent → SignatureEvent): idempotente em replay, nenhuma segunda infra de webhook (item 3)", async () => {
    const { contract } = await makeApprovedSale(context, projectId, companyId, customerId, `WHK-${token}`, "280000");
    const template = await createContractTemplate(context, { projectId, name: `Modelo Webhook ${token}` });
    createdTemplateIds.push(template.id);
    const version = await createContractTemplateVersion(context, { templateId: template.id, content: "Contrato {{contractNumber}}" });
    await approveContractTemplateVersion(context, version.id);
    const document = await generateContractDocument(context, { contractId: contract.id, templateVersionId: version.id });
    let request = await prepareSignatureRequest(context, { contractId: contract.id, documentId: document.id, parties: [{ displayName: "Fiador", role: "GUARANTOR" }] });
    request = await sendSignatureRequest(context, request.id);
    const [party] = request.parties;

    const eventId = `evt-${token}`;
    const payload = { signatureRequestId: request.id, domainEventType: "PARTY_DECLINED" as const, partyId: party.id, reason: "Documento com erro." };
    const first = await processSignatureWebhookEvent(context, { installationId: connectorInstallationId, provider: "CLICKSIGN", eventId, signatureValid: true, payload });
    const second = await processSignatureWebhookEvent(context, { installationId: connectorInstallationId, provider: "CLICKSIGN", eventId, signatureValid: true, payload });

    expect(first.signatureEvent?.id).toBe(second.signatureEvent!.id); // mesmo evento cru → mesma projeção, nunca duplicada
    const inboxCount = await prisma.integrationInboxEvent.count({ where: { installationId: connectorInstallationId, eventId } });
    expect(inboxCount).toBe(1);
    const domainEventCount = await prisma.signatureEvent.count({ where: { requestId: request.id, eventType: "PARTY_DECLINED" } });
    expect(domainEventCount).toBe(1);
    const finalRequest = await prisma.signatureRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(finalRequest.status).toBe("RECUSADO");
  });

  it("cancelamento é idempotente e provider não-MOCK nunca chama nada real (item 4/8)", async () => {
    const { contract } = await makeApprovedSale(context, projectId, companyId, customerId, `CNL-${token}`, "150000");
    const template = await createContractTemplate(context, { projectId, name: `Modelo Cancelamento ${token}` });
    createdTemplateIds.push(template.id);
    const version = await createContractTemplateVersion(context, { templateId: template.id, content: "x" });
    await approveContractTemplateVersion(context, version.id);
    const document = await generateContractDocument(context, { contractId: contract.id, templateVersionId: version.id });

    const clicksignRequest = await prepareSignatureRequest(context, { contractId: contract.id, documentId: document.id, provider: "CLICKSIGN", parties: [{ displayName: "X", role: "BUYER" }] });
    await expect(sendSignatureRequest(context, clicksignRequest.id)).rejects.toThrow(/Clicksign|Integração/);

    const mockRequest = await prepareSignatureRequest(context, { contractId: contract.id, documentId: document.id, parties: [{ displayName: "Y", role: "BUYER" }] });
    const cancelled = await cancelSignatureRequest(context, { requestId: mockRequest.id, reason: "Teste" });
    expect(cancelled.status).toBe("CANCELADO");
    const cancelledAgain = await cancelSignatureRequest(context, { requestId: mockRequest.id, reason: "Teste 2" });
    expect(cancelledAgain.status).toBe("CANCELADO"); // idempotente — não vira erro nem sobrescreve o motivo
    const cancelEvents = await prisma.signatureEvent.count({ where: { requestId: mockRequest.id, eventType: "CANCELLED" } });
    expect(cancelEvents).toBe(1);
  });

  it("crédito MOCK: CPF mascarado, nunca duplica Customer.taxId, resultado nunca decide a venda sozinho, retenção prevista (itens 5/7/8)", async () => {
    const consultation = await requestCreditConsultation(context, { customerId, purpose: "SALE_PROPOSAL_ANALYSIS" });
    expect(consultation.status).toBe("COMPLETED");
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(consultation.cpfMasked).toBe(maskTaxId(customer.taxId!));
    expect(consultation.cpfMasked).not.toBe(customer.taxId);
    expect(["SEM_RESTRICAO", "COM_RESTRICAO", "REQUER_ANALISE"]).toContain(consultation.result);
    expect(consultation.retentionUntil).not.toBeNull();
    // Não existe nenhuma coluna de payload bruto no schema (ver migration) — só findingsSummary resumido.
    expect(Object.keys(consultation)).not.toContain("rawResponse");
  });

  it("RBAC: VIEWER não pode preparar assinatura nem consultar crédito; tenant errado não enxerga o template (itens 8)", async () => {
    const { contract } = await makeApprovedSale(context, projectId, companyId, customerId, `RBAC-${token}`, "100000");
    const template = await createContractTemplate(context, { projectId, name: `Modelo RBAC ${token}` });
    createdTemplateIds.push(template.id);
    const version = await createContractTemplateVersion(context, { templateId: template.id, content: "x" });
    await approveContractTemplateVersion(context, version.id);
    const document = await generateContractDocument(context, { contractId: contract.id, templateVersionId: version.id });

    await expect(prepareSignatureRequest(viewerContext, { contractId: contract.id, documentId: document.id, parties: [{ displayName: "Z", role: "BUYER" }] })).rejects.toThrow(/não pode alterar/);
    await expect(requestCreditConsultation(viewerContext, { customerId })).rejects.toThrow(/não pode alterar/);

    const atlas = await prisma.organization.findUniqueOrThrow({ where: { slug: "grupo-atlas" } });
    const atlasUser = await prisma.user.findUniqueOrThrow({ where: { email: "analista@atlas.local" } });
    const crossTenantContext: AuthContext = { ...context, organizationId: atlas.id, userId: atlasUser.id, role: "ANALYST" };
    await expect(createContractTemplateVersion(crossTenantContext, { templateId: template.id, content: "invasão" })).rejects.toThrow("não encontrado nesta organização");
  });
});
