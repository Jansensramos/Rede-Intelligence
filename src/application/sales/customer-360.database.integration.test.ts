import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { createCustomer, registerReceivablePayment } from "@/application/financial-ops/financial-service";
import { activateSalesPriceTable, approveSale, createSale, createSalesPriceTable, createSalesProposal, createSalesReservation, createSalesUnit } from "@/application/sales/sales-service";
import { approveContractTemplateVersion, createContractTemplate, createContractTemplateVersion, generateContractDocument } from "@/application/sales/contract-service";
import { prepareSignatureRequest, sendSignatureRequest } from "@/application/sales/signature-service";
import { getCustomer360 } from "@/application/sales/customer-360-service";

const token = randomUUID().slice(0, 8);
const createdUnitIds: string[] = [];
const createdSaleIds: string[] = [];
const createdPriceTableIds: string[] = [];
const createdTemplateIds: string[] = [];
const createdCustomerIds: string[] = [];

describe.skipIf(!process.env.DATABASE_URL).sequential("Cliente 360 (Fase 9K.4B) contra PostgreSQL real", () => {
  let ownerContext: AuthContext;
  let viewerContext: AuthContext;
  let projectId: string;
  let companyId: string;
  let customerId: string;
  let saleId: string;
  let draftSaleId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: "rede-nucleo-de-negocios" } });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "admin@rede.local" } });
    const project = await prisma.project.findUniqueOrThrow({ where: { organizationId_name: { organizationId: organization.id, name: "START BUTANTÃ" } } });
    ownerContext = { sessionId: "test", userId: user.id, userName: user.name, userEmail: user.email, organizationId: organization.id, organizationName: organization.name, organizationSlug: organization.slug, role: "OWNER" };
    viewerContext = { ...ownerContext, role: "VIEWER" };
    projectId = project.id;
    companyId = project.companyId!;

    const customer = await createCustomer(ownerContext, { name: `Cliente 9K4B ${token}`, taxId: `52998224725${token.slice(0, 3)}`, email: `cliente-${token}@example.com`, phone: "11999990000" });
    customerId = customer.id;
    createdCustomerIds.push(customerId);

    // Venda 1: aprovada, com contrato, assinatura pendente e duas parcelas (uma vencida em aberto, outra parcialmente paga).
    const unit1 = await createSalesUnit(ownerContext, { projectId, companyId, code: `C360-A-${token}`, typology: "3 dormitórios", privateAreaM2: "80" });
    createdUnitIds.push(unit1.id);
    const table1 = await createSalesPriceTable(ownerContext, { projectId, companyId, validFrom: new Date("2026-01-01T00:00:00Z"), responsibleId: ownerContext.userId, lines: [{ salesUnitId: unit1.id, listPrice: "300000", minimumAuthorizedPrice: "0" }] });
    createdPriceTableIds.push(table1.id);
    const activated1 = await activateSalesPriceTable(ownerContext, table1.id);
    const sale1 = await createSale(ownerContext, { salesUnitId: unit1.id, priceTableId: activated1.id, soldPrice: "300000", parties: [{ customerId, role: "BUYER" }] });
    createdSaleIds.push(sale1.id);
    const { sale: approvedSale1, contract } = await approveSale(ownerContext, {
      saleId: sale1.id,
      contract: { number: `CV-C360-${token}`, title: `Contrato Cliente 360 ${token}` },
      installments: [
        { number: 1, nature: "DOWN_PAYMENT", dueDate: new Date("2026-01-05T00:00:00Z"), amount: "100000" },
        { number: 2, nature: "MONTHLY", dueDate: new Date("2026-12-05T00:00:00Z"), amount: "200000" },
      ],
    });
    saleId = approvedSale1.id;

    // Cada `SalesPaymentPlanInstallment` gera seu PRÓPRIO `ReceivableAccount` de uma única parcela
    // (sempre `number: 1` dentro dela) — o vínculo com "qual parcela do plano" é `receivableInstallmentId`, nunca o `number` do recebível.
    const planInstallment2 = await prisma.salesPaymentPlanInstallment.findFirstOrThrow({ where: { plan: { saleId: sale1.id }, number: 2 } });
    const bankAccount = await prisma.bankAccount.findFirstOrThrow({ where: { organizationId: ownerContext.organizationId, companyId } });
    await registerReceivablePayment(ownerContext, { installmentId: planInstallment2.receivableInstallmentId!, bankAccountId: bankAccount.id, amount: "50000", method: "PIX", receivedAt: new Date("2026-11-01T00:00:00Z") });

    const template = await createContractTemplate(ownerContext, { projectId, name: `Modelo Cliente 360 ${token}` });
    createdTemplateIds.push(template.id);
    const version = await createContractTemplateVersion(ownerContext, { templateId: template.id, content: "Contrato {{contractNumber}}" });
    await approveContractTemplateVersion(ownerContext, version.id);
    const document = await generateContractDocument(ownerContext, { contractId: contract.id, templateVersionId: version.id });
    let request = await prepareSignatureRequest(ownerContext, { contractId: contract.id, documentId: document.id, parties: [{ customerId, displayName: "Comprador 1", role: "BUYER" }] });
    request = await sendSignatureRequest(ownerContext, request.id);
    expect(request.status).toBe("AGUARDANDO_ASSINATURAS");

    // Proposta e reserva soltas (nunca viraram venda) — item 11 "múltiplas unidades".
    const unit2 = await createSalesUnit(ownerContext, { projectId, companyId, code: `C360-B-${token}`, typology: "2 dormitórios", privateAreaM2: "60" });
    createdUnitIds.push(unit2.id);
    const table2 = await createSalesPriceTable(ownerContext, { projectId, companyId, validFrom: new Date("2026-01-01T00:00:00Z"), responsibleId: ownerContext.userId, lines: [{ salesUnitId: unit2.id, listPrice: "200000" }] });
    createdPriceTableIds.push(table2.id);
    const activated2 = await activateSalesPriceTable(ownerContext, table2.id);
    await createSalesProposal(ownerContext, { salesUnitId: unit2.id, customerId, priceTableId: activated2.id, proposedPrice: "195000", validUntil: new Date(Date.now() + 7 * 86_400_000) });
    await createSalesReservation(ownerContext, { salesUnitId: unit2.id, customerId, expiresAt: new Date(Date.now() + 3 * 86_400_000), responsibleId: ownerContext.userId });

    // Venda 2: em rascunho, nunca aprovada — alimenta "sale_awaiting_approval" na Central de Ações.
    const unit3 = await createSalesUnit(ownerContext, { projectId, companyId, code: `C360-C-${token}`, typology: "1 dormitório", privateAreaM2: "40" });
    createdUnitIds.push(unit3.id);
    const table3 = await createSalesPriceTable(ownerContext, { projectId, companyId, validFrom: new Date("2026-01-01T00:00:00Z"), responsibleId: ownerContext.userId, lines: [{ salesUnitId: unit3.id, listPrice: "150000" }] });
    createdPriceTableIds.push(table3.id);
    const activated3 = await activateSalesPriceTable(ownerContext, table3.id);
    const draftSale = await createSale(ownerContext, { salesUnitId: unit3.id, priceTableId: activated3.id, soldPrice: "150000", parties: [{ customerId, role: "BUYER" }] });
    createdSaleIds.push(draftSale.id);
    draftSaleId = draftSale.id;

    // Consulta de crédito com resultado REQUER_ANALISE — inserida direto para não depender do hash do provider MOCK.
    await prisma.creditBureauConsultation.create({ data: {
      organizationId: ownerContext.organizationId, projectId, customerId, provider: "MOCK", purpose: "SALE_PROPOSAL_ANALYSIS", status: "COMPLETED",
      cpfMasked: "529***********", result: "REQUER_ANALISE", score: 450, requestedById: ownerContext.userId, requestedAt: new Date(), completedAt: new Date(),
    } });
  });

  afterAll(async () => {
    try {
      await prisma.creditBureauConsultation.deleteMany({ where: { customerId } });
      const requests = await prisma.signatureRequest.findMany({ where: { contract: { saleId: { in: createdSaleIds } } } });
      const requestIds = requests.map((r) => r.id);
      await prisma.signatureEvent.deleteMany({ where: { requestId: { in: requestIds } } });
      await prisma.signatureParty.deleteMany({ where: { requestId: { in: requestIds } } });
      await prisma.signatureRequest.deleteMany({ where: { id: { in: requestIds } } });
      await prisma.contractDocument.deleteMany({ where: { contract: { saleId: { in: createdSaleIds } } } });
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
      await prisma.salesReservation.deleteMany({ where: { customerId } });
      await prisma.salesProposal.deleteMany({ where: { customerId } });
      await prisma.saleParty.deleteMany({ where: { saleId: { in: createdSaleIds } } });
      await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
      await prisma.salesPriceTableLine.deleteMany({ where: { priceTableId: { in: createdPriceTableIds } } });
      await prisma.salesPriceTable.deleteMany({ where: { id: { in: createdPriceTableIds } } });
      await prisma.salesUnit.deleteMany({ where: { id: { in: createdUnitIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    } catch (error) {
      console.warn("Limpeza pós-teste Cliente 360 não concluída — dados de teste podem persistir:", error);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("agregação: cadastro mascarado, unidades, propostas, reservas, vendas, contrato, assinatura e posição financeira vêm do domínio existente (itens 1/2/3)", async () => {
    const view = await getCustomer360(ownerContext, customerId);
    expect(view).not.toBeNull();
    const rawCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(view!.customer.taxIdMasked).not.toBeNull();
    expect(view!.customer.taxIdMasked).not.toBe(rawCustomer.taxId); // nunca o CPF em claro
    expect(view!.customer.email).toContain(token);

    // Múltiplas unidades (item 11): 3 unidades diferentes relacionadas a este cliente.
    expect(view!.units.items.length).toBeGreaterThanOrEqual(3);
    expect(view!.proposals.items.length).toBeGreaterThanOrEqual(1);
    expect(view!.reservations.items.length).toBeGreaterThanOrEqual(1);
    expect(view!.sales.items.length).toBe(2); // venda aprovada + venda em rascunho

    const approvedSaleView = view!.sales.items.find((item) => item.id === saleId)!;
    expect(approvedSaleView.contract?.number).toContain(token);
    expect(approvedSaleView.signatureRequest?.status).toBe("AGUARDANDO_ASSINATURAS");

    // Financeiro (item 2): contratado = soldPrice da venda aprovada + rascunho (contracted=0 p/ rascunho não afeta pois soldPrice só conta em APPROVED — ver serviço).
    const financialForSale = view!.financial.bySale.find((item) => item.saleId === saleId)!;
    expect(financialForSale.position.contracted).toBe(300000);
    expect(financialForSale.position.paid).toBe(50000);
    expect(financialForSale.position.open).toBe(250000);
    expect(financialForSale.position.overdue).toBe(100000);
    expect(financialForSale.position.overdueCount).toBe(1);
    expect(view!.financial.totals!.overdue).toBe(100000);
  });

  it("central de ações do cliente: reaproveita os builders da 9K.3/9K.4 (item 6) — venda em rascunho, crédito e recebível vencido aparecem, nenhuma tarefa nova é inventada", async () => {
    const view = await getCustomer360(ownerContext, customerId);
    const types = view!.actions.items.map((item) => item.type);
    expect(types).toContain("sale_awaiting_approval");
    expect(types).toContain("credit_review_required");
    expect(types).toContain("receivable_overdue");
    // Todo item aponta de volta para o registro de origem já existente — nunca uma segunda central.
    expect(view!.actions.items.every((item) => item.href === "/comercial")).toBe(true);
    expect(view!.actions.items.every((item) => item.domain === "sales")).toBe(true);
    const draftAction = view!.actions.items.find((item) => item.type === "sale_awaiting_approval")!;
    expect(draftAction.evidence).toContain(draftSaleId);
  });

  it("RBAC: VIEWER não vê comercial nem financeiro — payload vem vazio do backend, não só escondido na UI (item 8)", async () => {
    const view = await getCustomer360(viewerContext, customerId);
    expect(view).not.toBeNull();
    expect(view!.capabilities.commercialView).toBe(false);
    expect(view!.capabilities.financialView).toBe(false);
    expect(view!.units.items).toHaveLength(0);
    expect(view!.proposals.items).toHaveLength(0);
    expect(view!.sales.items).toHaveLength(0);
    expect(view!.commissions.items).toHaveLength(0);
    expect(view!.credit.items).toHaveLength(0);
    expect(view!.actions.items).toHaveLength(0);
    expect(view!.financial.totals).toBeNull();
    expect(view!.financial.bySale).toHaveLength(0);
    // Cadastro básico continua visível — só o comercial/financeiro é restrito.
    expect(view!.customer.name).toContain(token);
  });

  it("tenant: cliente de outra organização nunca é encontrado (isolamento multi-tenant)", async () => {
    const atlas = await prisma.organization.findUniqueOrThrow({ where: { slug: "grupo-atlas" } });
    const atlasUser = await prisma.user.findUniqueOrThrow({ where: { email: "analista@atlas.local" } });
    const crossTenantContext: AuthContext = { ...ownerContext, organizationId: atlas.id, userId: atlasUser.id, role: "ANALYST" };
    const view = await getCustomer360(crossTenantContext, customerId);
    expect(view).toBeNull();
  });

  it("cliente inexistente retorna null (nunca lança, nunca fabrica um Cliente 360 vazio)", async () => {
    const view = await getCustomer360(ownerContext, "cli_inexistente_9k4b");
    expect(view).toBeNull();
  });

  it("ausência de dados: cliente novo, sem nenhuma atividade comercial, mostra listas vazias autorizadas — nunca 'sem permissão'", async () => {
    const emptyCustomer = await createCustomer(ownerContext, { name: `Cliente Vazio 9K4B ${token}` });
    createdCustomerIds.push(emptyCustomer.id);
    const view = await getCustomer360(ownerContext, emptyCustomer.id);
    expect(view).not.toBeNull();
    expect(view!.capabilities.commercialView).toBe(true);
    expect(view!.units.items).toHaveLength(0);
    expect(view!.sales.items).toHaveLength(0);
    expect(view!.credit.items).toHaveLength(0);
    expect(view!.financial.totals).toEqual({ contracted: 0, paid: 0, open: 0, overdue: 0, overdueCount: 0, nextDueDate: null, nextDueAmount: null });
    expect(view!.customer.taxIdMasked).toBeNull(); // sem CPF cadastrado — nunca inventado
  });

  it("leitura pura: nenhuma mutação — nenhum AuditLog novo, nenhuma linha criada ao consultar o Cliente 360", async () => {
    const auditBefore = await prisma.auditLog.count({ where: { organizationId: ownerContext.organizationId } });
    const saleBefore = await prisma.sale.count({ where: { organizationId: ownerContext.organizationId } });
    await getCustomer360(ownerContext, customerId);
    await getCustomer360(ownerContext, customerId);
    const auditAfter = await prisma.auditLog.count({ where: { organizationId: ownerContext.organizationId } });
    const saleAfter = await prisma.sale.count({ where: { organizationId: ownerContext.organizationId } });
    expect(auditAfter).toBe(auditBefore);
    expect(saleAfter).toBe(saleBefore);
  });
});
