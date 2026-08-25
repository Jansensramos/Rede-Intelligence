import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { createCustomer } from "@/application/financial-ops/financial-service";
import { activateSalesPriceTable, approveSale, createSale, createSalesPriceTable, createSalesUnit } from "@/application/sales/sales-service";
import { addContractAttachment, approveContractTemplateVersion, createContractTemplate, createContractTemplateVersion, generateContractDocument, readContractDocumentBytes, updateContractTemplateVersionDraft } from "@/application/sales/contract-service";
import { cancelSignatureRequest, prepareSignatureRequest, processSignatureWebhookEvent, recordPartySigned, sendSignatureRequest } from "@/application/sales/signature-service";
import { requestCreditConsultation } from "@/application/sales/credit-service";
import { maskTaxId } from "@/domain/sales/contract-closing";

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

  beforeAll(async () => {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: "rede-nucleo-de-negocios" } });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "admin@rede.local" } });
    const project = await prisma.project.findUniqueOrThrow({ where: { organizationId_name: { organizationId: organization.id, name: "START BUTANTÃ" } } });
    context = { sessionId: "test", userId: user.id, userName: user.name, userEmail: user.email, organizationId: organization.id, organizationName: organization.name, organizationSlug: organization.slug, role: "OWNER" };
    viewerContext = { ...context, role: "VIEWER" };
    projectId = project.id; companyId = project.companyId!;
    const customer = await createCustomer(context, { name: `Cliente 9K4 ${token}`, taxId: `52998224725${token.slice(0, 3)}` });
    customerId = customer.id;

    const definition = await prisma.connectorDefinition.create({ data: { code: `signature-mock-test-${token}`, name: "Assinatura (teste)", provider: "MOCK", category: "OTHER", authMethod: "NONE", capabilities: {}, adapterVersion: "1", contractVersion: "1" } });
    connectorDefinitionId = definition.id;
    const installation = await prisma.connectorInstallation.create({ data: { organizationId: context.organizationId, connectorDefinitionId: definition.id, projectId, name: "Assinatura (teste)", direction: "INBOUND", status: "ACTIVE", createdById: context.userId } });
    connectorInstallationId = installation.id;
  });

  afterAll(async () => {
    try {
      const requests = await prisma.signatureRequest.findMany({ where: { contract: { saleId: { in: createdSaleIds } } } });
      const requestIds = requests.map((r) => r.id);
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
    await expect(sendSignatureRequest(context, clicksignRequest.id)).rejects.toThrow(/não tem adapter real habilitado/);

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
