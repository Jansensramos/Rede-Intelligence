import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import {
  createSalesUnit, createSalesPriceTable, activateSalesPriceTable, createSale, approveSale,
  scheduleInspection, recordInspectionOutcome, markUnitDelivered, getUnitDeliveryReadiness,
  createPostSaleRequest, assignPostSaleSupplier, setPostSaleCost, markPostSaleRecurrence, addPostSaleEvidence,
  evaluatePostSaleSlaBreaches,
} from "@/application/sales/sales-service";
import { transitionReceivableInstallment } from "@/application/financial-ops/financial-service";
import {
  createBankFinancingDisbursement, requestBankFinancingDisbursement, recordBankFinancingDisbursementReceived,
  reconcileBankFinancingDisbursement, cancelBankFinancingDisbursement, isIdempotencyKeyConflict,
} from "@/application/handover/repasse-service";
import { createCondominiumSetup, transitionCondominiumSetup, getCondominiumSetupForProject } from "@/application/handover/condominium-service";
import { evaluateUnitDeliveryReadiness } from "@/application/handover/delivery-gate-service";
import { resetOperationalAlertStateForTests, setOperationalAlertReporterForTests } from "@/application/observability/operational-alerts";
import type { ErrorReporterProvider } from "@/infrastructure/observability/providers";

/**
 * Fase 9R — Repasse bancário, Chaves (gates de entrega + condomínio) e Assistência
 * técnica, contra PostgreSQL real. Fixture isolada, própria organização (mesmo padrão
 * de `src/application/executive-insights/database.integration.test.ts`, 9K.4A) — nunca
 * escreve na organização semeada compartilhada.
 */
describe.skipIf(!process.env.DATABASE_URL).sequential("Fase 9R — Repasse, Chaves e Assistência técnica contra PostgreSQL real", () => {
  let organizationId: string;
  let foreignOrganizationId: string;
  let userId: string;
  let companyId: string;
  let projectId: string;
  let customerId: string;
  let financialInstitutionId: string;
  let bankAccountId: string;
  let supplierId: string;
  let counter = 0;

  const owner = (): AuthContext => ({ sessionId: "test", userId, userName: "Fixture 9R", userEmail: "fixture-9r@test.local", organizationId, organizationName: "9R Fixture", organizationSlug: "9r-fixture", role: "OWNER" });
  const viewer = (): AuthContext => ({ ...owner(), role: "VIEWER" });
  const foreignOwner = (): AuthContext => ({ ...owner(), organizationId: foreignOrganizationId });

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const organization = await prisma.organization.create({ data: { name: `9R fixture ${suffix}`, slug: `9r-fixture-${suffix}` } });
    organizationId = organization.id;
    const user = await prisma.user.create({ data: { name: "9R fixture", email: `9r-fixture-${suffix}@test.local`, passwordHash: "integration-test" } });
    userId = user.id;
    const company = await prisma.company.create({ data: { organizationId, name: `9R SPE ${suffix}`, legalName: `9R SPE ${suffix} Ltda`, type: "SPE", createdById: userId } });
    companyId = company.id;
    const project = await prisma.project.create({ data: { organizationId, companyId, name: `Projeto 9R ${suffix}`, city: "São Paulo", state: "SP", createdById: userId, updatedById: userId } });
    projectId = project.id;
    const customer = await prisma.customer.create({ data: { organizationId, name: `Cliente 9R ${suffix}`, personType: "INDIVIDUAL", taxId: `${suffix}`.replace(/\D/g, "").padStart(11, "1").slice(0, 11), createdById: userId } });
    customerId = customer.id;
    const financialInstitution = await prisma.financialInstitution.create({ data: { organizationId, name: `Banco 9R ${suffix}`, createdById: userId } });
    financialInstitutionId = financialInstitution.id;
    const bankAccount = await prisma.bankAccount.create({ data: { organizationId, companyId, agency: "0001", accountNumber: `${suffix}-9r`, holderName: company.name, openingBalance: "0", restriction: "FREE", createdById: userId } });
    bankAccountId = bankAccount.id;
    const supplier = await prisma.supplier.create({ data: { organizationId, name: `Fornecedor Assistência 9R ${suffix}`, personType: "LEGAL_ENTITY", createdById: userId } });
    supplierId = supplier.id;

    const foreignOrganization = await prisma.organization.create({ data: { name: `9R fixture outra org ${suffix}`, slug: `9r-fixture-outra-${suffix}` } });
    foreignOrganizationId = foreignOrganization.id;
  });

  async function cleanupOrganization(id: string) {
    await prisma.postSaleUpdate.deleteMany({ where: { request: { organizationId: id } } });
    await prisma.postSaleRequest.deleteMany({ where: { organizationId: id } });
    await prisma.salesUnitInspection.deleteMany({ where: { salesUnit: { organizationId: id } } });
    // RECONCILED/IMPLEMENTED/CANCELLED são protegidos por trigger de imutabilidade
    // estrutural (20260910151500) — mesmo padrão de `contract-closing.database.integration.test.ts`:
    // pula a exclusão desses registros terminais em vez de forçar (nunca desabilita o trigger).
    await prisma.bankFinancingDisbursement.deleteMany({ where: { organizationId: id, status: { not: "RECONCILED" } } });
    await prisma.condominiumSetup.deleteMany({ where: { organizationId: id, status: { notIn: ["IMPLEMENTED", "CANCELLED"] } } });
    await prisma.legalLicense.deleteMany({ where: { organizationId: id } });
    await prisma.receivablePayment.deleteMany({ where: { installment: { receivableAccount: { organizationId: id } } } });
    await prisma.receivableInstallment.deleteMany({ where: { receivableAccount: { organizationId: id } } });
    await prisma.financialIntegrationEvent.deleteMany({ where: { organizationId: id } });
    await prisma.receivableAccount.deleteMany({ where: { organizationId: id } });
    await prisma.financialObligation.deleteMany({ where: { organizationId: id } });
    await prisma.salesPaymentPlanInstallment.deleteMany({ where: { plan: { sale: { organizationId: id } } } });
    await prisma.salesPaymentPlan.deleteMany({ where: { sale: { organizationId: id } } });
    await prisma.salesContract.deleteMany({ where: { organizationId: id } });
    // Vendas ainda referenciadas por um repasse RECONCILED (preservado acima) não podem
    // ser excluídas (FK Restrict) — ficam órfãs no banco de teste descartável, mesmo padrão.
    await prisma.sale.deleteMany({ where: { organizationId: id, financingDisbursements: { none: {} } } });
    await prisma.salesPriceTableLine.deleteMany({ where: { priceTable: { organizationId: id } } });
    // Mesma proteção — tabela de preço ainda referenciada por uma venda órfã.
    await prisma.salesPriceTable.deleteMany({ where: { organizationId: id, sales: { none: {} } } });
    // Unidades ainda referenciadas por uma venda órfã (preservada acima por causa de um
    // repasse RECONCILED) não podem ser excluídas (FK Restrict) — mesmo padrão.
    await prisma.salesUnit.deleteMany({ where: { organizationId: id, sales: { none: {} } } });
    // Mesma proteção — cliente ainda referenciado como parte de uma venda órfã.
    await prisma.customer.deleteMany({ where: { organizationId: id, saleParties: { none: {} } } });
    // Mesma proteção — o SetNull automático do Postgres ao excluir o fornecedor também é um
    // UPDATE na implantação de condomínio; se ela for terminal (IMPLEMENTED/CANCELLED), o
    // trigger de imutabilidade estrutural bloqueia esse UPDATE implícito também.
    await prisma.supplier.deleteMany({ where: { organizationId: id, condominiumSetups: { none: {} } } });
    await prisma.bankAccount.deleteMany({ where: { organizationId: id } });
    // Mesma proteção — instituição ainda referenciada por um repasse RECONCILED preservado.
    await prisma.financialInstitution.deleteMany({ where: { organizationId: id, financingDisbursements: { none: {} } } });
    // Projetos ainda referenciados por uma implantação de condomínio terminal (preservada
    // acima) não podem ser excluídos (FK Restrict) — ficam órfãos no banco de teste, mesmo padrão.
    await prisma.project.deleteMany({ where: { organizationId: id, condominiumSetup: null } });
    // Mesma proteção — empresa ainda referenciada por uma venda ou unidade órfã (por causa
    // de um repasse RECONCILED preservado) não pode ser excluída (FK Restrict).
    await prisma.company.deleteMany({ where: { organizationId: id, sales: { none: {} }, salesUnits: { none: {} } } });
    await prisma.organization.delete({ where: { id } }).catch(() => {});
  }

  afterAll(async () => {
    await cleanupOrganization(organizationId);
    await cleanupOrganization(foreignOrganizationId);
    await prisma.$disconnect();
  });

  /** Venda aprovada isolada (uma unidade nova por chamada) — mesmo padrão de `makeApprovedSale` em `contract-closing.database.integration.test.ts`. */
  async function makeApprovedSale(price = "300000.00", dueDate = new Date("2026-06-01T00:00:00.000Z")) {
    counter += 1;
    const code = `U9R-${counter}-${Date.now()}`;
    const unit = await createSalesUnit(owner(), { projectId, companyId, code, typology: "2 dorms", privateAreaM2: "60" });
    const table = await createSalesPriceTable(owner(), { projectId, companyId, validFrom: new Date("2026-01-01T00:00:00.000Z"), responsibleId: userId, lines: [{ salesUnitId: unit.id, listPrice: price, minimumAuthorizedPrice: "0" }] });
    const activated = await activateSalesPriceTable(owner(), table.id);
    const sale = await createSale(owner(), { salesUnitId: unit.id, priceTableId: activated.id, soldPrice: price, parties: [{ customerId, role: "BUYER" }] });
    const { sale: approved } = await approveSale(owner(), { saleId: sale.id, contract: { number: `CV-9R-${code}`, title: `Contrato 9R ${code}` }, installments: [{ number: 1, nature: "FINANCING", dueDate, amount: price }] });
    const account = await prisma.receivableAccount.findFirstOrThrow({ where: { saleId: approved.id } });
    const installment = await prisma.receivableInstallment.findFirstOrThrow({ where: { receivableAccountId: account.id } });
    return { unit, sale: approved, installment };
  }

  function fakeReporter() {
    const capture = vi.fn(async () => undefined);
    return { provider: { capture } as unknown as ErrorReporterProvider, capture };
  }

  // -------------------------------------------------------------------------
  // Repasse bancário
  // -------------------------------------------------------------------------

  describe("Repasse bancário", () => {
    it("cria, solicita, registra liberação e concilia com sucesso — gera ReceivablePayment oficial via 9B/9E", async () => {
      const { sale, installment } = await makeApprovedSale("300000.00");
      const created = await createBankFinancingDisbursement(owner(), { saleId: sale.id, financialInstitutionId, disbursementType: "FINANCING", expectedAmount: "300000.00" });
      expect(created.status).toBe("PENDING");
      const requested = await requestBankFinancingDisbursement(owner(), { disbursementId: created.id, requestedAt: new Date("2026-05-01T00:00:00.000Z") });
      expect(requested.status).toBe("REQUESTED");
      const received = await recordBankFinancingDisbursementReceived(owner(), { disbursementId: created.id, disbursedAmount: "300000.00", disbursedAt: new Date("2026-05-15T00:00:00.000Z") });
      expect(received.status).toBe("DISBURSED");

      await transitionReceivableInstallment(owner(), installment.id, "EMITIDA");
      const reconciled = await reconcileBankFinancingDisbursement(owner(), { disbursementId: created.id, installmentId: installment.id, bankAccountId });
      expect(reconciled.status).toBe("RECONCILED");
      expect(reconciled.reconciledInstallmentId).toBe(installment.id);
      expect(reconciled.reconciledPaymentId).not.toBeNull();

      const payment = await prisma.receivablePayment.findUniqueOrThrow({ where: { id: reconciled.reconciledPaymentId! } });
      expect(payment.amount.toString()).toBe("300000");
      expect(payment.method).toBe("TRANSFER");
      const updatedInstallment = await prisma.receivableInstallment.findUniqueOrThrow({ where: { id: installment.id } });
      expect(updatedInstallment.status).toBe("RECEBIDA");
    });

    it("divergência de valor marca DIVERGENT e emite alerta REPASSE_DIVERGENTE — nunca ajusta o recebível silenciosamente", async () => {
      const { sale, installment } = await makeApprovedSale("300000.00");
      const created = await createBankFinancingDisbursement(owner(), { saleId: sale.id, financialInstitutionId, disbursementType: "FINANCING", expectedAmount: "300000.00" });
      await recordBankFinancingDisbursementReceived(owner(), { disbursementId: created.id, disbursedAmount: "250000.00", disbursedAt: new Date("2026-05-15T00:00:00.000Z") });
      await transitionReceivableInstallment(owner(), installment.id, "EMITIDA");

      const { provider, capture } = fakeReporter();
      setOperationalAlertReporterForTests(provider);
      resetOperationalAlertStateForTests();
      setOperationalAlertReporterForTests(provider);
      const result = await reconcileBankFinancingDisbursement(owner(), { disbursementId: created.id, installmentId: installment.id, bankAccountId });
      expect(result.status).toBe("DIVERGENT");
      expect(capture.mock.calls.length).toBe(1);
      setOperationalAlertReporterForTests(undefined);
      resetOperationalAlertStateForTests();

      const unchangedInstallment = await prisma.receivableInstallment.findUniqueOrThrow({ where: { id: installment.id } });
      expect(unchangedInstallment.status).toBe("EMITIDA");
      expect(await prisma.receivablePayment.count({ where: { installmentId: installment.id } })).toBe(0);
    });

    it("reconciliação é idempotente sob concorrência (Promise.all) — nunca duplica o ReceivablePayment", async () => {
      const { sale, installment } = await makeApprovedSale("150000.00");
      const created = await createBankFinancingDisbursement(owner(), { saleId: sale.id, financialInstitutionId, disbursementType: "FGTS", expectedAmount: "150000.00" });
      await recordBankFinancingDisbursementReceived(owner(), { disbursementId: created.id, disbursedAmount: "150000.00", disbursedAt: new Date("2026-05-15T00:00:00.000Z") });
      await transitionReceivableInstallment(owner(), installment.id, "EMITIDA");

      const results = await Promise.allSettled(Array.from({ length: 4 }, () =>
        reconcileBankFinancingDisbursement(owner(), { disbursementId: created.id, installmentId: installment.id, bankAccountId })));
      expect(results.every((result) => result.status === "fulfilled")).toBe(true);
      expect(await prisma.receivablePayment.count({ where: { installmentId: installment.id } })).toBe(1);
      const disbursement = await prisma.bankFinancingDisbursement.findUniqueOrThrow({ where: { id: created.id } });
      expect(disbursement.status).toBe("RECONCILED");
    });

    it("cancela repasse não conciliado, mas recusa cancelar um já conciliado", async () => {
      const { sale, installment } = await makeApprovedSale("100000.00");
      const disbursement = await createBankFinancingDisbursement(owner(), { saleId: sale.id, financialInstitutionId, disbursementType: "SUBSIDY", expectedAmount: "100000.00" });
      const cancelled = await cancelBankFinancingDisbursement(owner(), { disbursementId: disbursement.id, reason: "Cliente desistiu do subsídio." });
      expect(cancelled.status).toBe("CANCELLED");

      const another = await createBankFinancingDisbursement(owner(), { saleId: sale.id, financialInstitutionId, disbursementType: "FINANCING", expectedAmount: "100000.00" });
      await recordBankFinancingDisbursementReceived(owner(), { disbursementId: another.id, disbursedAmount: "100000.00", disbursedAt: new Date("2026-05-15T00:00:00.000Z") });
      await transitionReceivableInstallment(owner(), installment.id, "EMITIDA");
      await reconcileBankFinancingDisbursement(owner(), { disbursementId: another.id, installmentId: installment.id, bankAccountId });
      await expect(cancelBankFinancingDisbursement(owner(), { disbursementId: another.id, reason: "tentativa" })).rejects.toThrow(/já conciliado/);
    });
  });

  // -------------------------------------------------------------------------
  // RBAC e isolamento (IDOR)
  // -------------------------------------------------------------------------

  describe("RBAC e isolamento entre organizações", () => {
    it("VIEWER não pode criar repasse nem implantar condomínio", async () => {
      const { sale } = await makeApprovedSale("50000.00");
      await expect(createBankFinancingDisbursement(viewer(), { saleId: sale.id, financialInstitutionId, disbursementType: "FINANCING", expectedAmount: "50000.00" })).rejects.toThrow(/não pode alterar/);
      await expect(createCondominiumSetup(viewer(), { projectId, responsibleId: userId })).rejects.toThrow(/não pode alterar/);
    });

    it("venda de outra organização é recusada com a MESMA mensagem de venda inexistente — nunca revela qual dos dois motivos", async () => {
      const { sale } = await makeApprovedSale("50000.00");
      const realError = await createBankFinancingDisbursement(foreignOwner(), { saleId: sale.id, financialInstitutionId, disbursementType: "FINANCING", expectedAmount: "50000.00" }).catch((error: Error) => error);
      const fakeError = await createBankFinancingDisbursement(owner(), { saleId: "id-inexistente", financialInstitutionId, disbursementType: "FINANCING", expectedAmount: "50000.00" }).catch((error: Error) => error);
      expect(realError).toBeInstanceOf(Error);
      expect((realError as Error).message).toBe((fakeError as Error).message);
    });

    it("instituição financeira de outra organização é recusada", async () => {
      const { sale } = await makeApprovedSale("50000.00");
      const foreignInstitution = await prisma.financialInstitution.create({ data: { organizationId: foreignOrganizationId, name: "Banco estranho", createdById: userId } });
      await expect(createBankFinancingDisbursement(owner(), { saleId: sale.id, financialInstitutionId: foreignInstitution.id, disbursementType: "FINANCING", expectedAmount: "50000.00" })).rejects.toThrow(/Instituição financeira não encontrada/);
    });

    it("repasse de outra organização não é encontrado (findFirst com organizationId, nunca findUnique só por id)", async () => {
      const { sale } = await makeApprovedSale("50000.00");
      const disbursement = await createBankFinancingDisbursement(owner(), { saleId: sale.id, financialInstitutionId, disbursementType: "FINANCING", expectedAmount: "50000.00" });
      await expect(requestBankFinancingDisbursement(foreignOwner(), { disbursementId: disbursement.id, requestedAt: new Date() })).rejects.toThrow(/não encontrado/);
    });

    it("implantação de condomínio de outra organização não é encontrada", async () => {
      const setup = await createCondominiumSetup(owner(), { projectId, responsibleId: userId });
      await expect(transitionCondominiumSetup(foreignOwner(), { condominiumSetupId: setup.id, status: "IN_PROGRESS" })).rejects.toThrow(/não encontrada/);
      await transitionCondominiumSetup(owner(), { condominiumSetupId: setup.id, status: "CANCELLED" }); // limpa para os próximos testes de condomínio
    });
  });

  // -------------------------------------------------------------------------
  // Chaves — gates de entrega
  // -------------------------------------------------------------------------

  describe("Chaves — gates de entrega (técnico + jurídico + financeiro)", () => {
    it("SEM_EVIDENCIA no gate jurídico quando não há nenhuma LegalLicense para o projeto", async () => {
      const { unit, sale } = await makeApprovedSale("10000.00");
      const readiness = await evaluateUnitDeliveryReadiness(prisma, organizationId, projectId, unit.id, sale.id);
      expect(readiness.legal.status).toBe("SEM_EVIDENCIA");
      expect(readiness.overall).toBe("BLOQUEADO");
    });

    it("bloqueia markUnitDelivered sem vistoria aceita, mesmo com os outros gates OK", async () => {
      const { unit } = await makeApprovedSale("10000.00");
      await expect(markUnitDelivered(owner(), unit.id)).rejects.toThrow(/Entrega bloqueada/);
    });

    it("gate jurídico consome LegalLicense (9D) só por referência e resultado agregado — nunca duplica o checklist", async () => {
      const { unit, sale } = await makeApprovedSale("10000.00");
      await scheduleInspection(owner(), { salesUnitId: unit.id, saleId: sale.id, scheduledAt: new Date(), responsibleId: userId });
      const inspection = await prisma.salesUnitInspection.findFirstOrThrow({ where: { saleId: sale.id } });
      await recordInspectionOutcome(owner(), { inspectionId: inspection.id, outcome: "ACCEPTED", pendingIssues: [] });

      const license = await prisma.legalLicense.create({ data: { organizationId, projectId, code: `HABITE-SE-${sale.id}`, type: "HABITE_SE", title: "Habite-se", authority: "Prefeitura", status: "UNDER_REVIEW", provenance: "OFFICIAL_DOCUMENT", responsibleId: userId, createdById: userId, updatedById: userId } });
      let readiness = await getUnitDeliveryReadiness(owner(), unit.id);
      expect(readiness!.legal.status).toBe("PENDENTE");
      expect(readiness!.legal.snapshot.blockingLicenseIds).toEqual([license.id]);
      await expect(markUnitDelivered(owner(), unit.id)).rejects.toThrow(/jurídico: PENDENTE/);

      await prisma.legalLicense.update({ where: { id: license.id }, data: { status: "APPROVED" } });
      readiness = await getUnitDeliveryReadiness(owner(), unit.id);
      expect(readiness!.legal.status).toBe("APTO");
    });

    it("bloqueia entrega com repasse bancário pendente de conciliação, libera depois de conciliado — e grava o snapshot (termo de entrega) no AuditLog", async () => {
      const { unit, sale, installment } = await makeApprovedSale("80000.00");
      await scheduleInspection(owner(), { salesUnitId: unit.id, saleId: sale.id, scheduledAt: new Date(), responsibleId: userId });
      const inspection = await prisma.salesUnitInspection.findFirstOrThrow({ where: { saleId: sale.id } });
      await recordInspectionOutcome(owner(), { inspectionId: inspection.id, outcome: "ACCEPTED", pendingIssues: [] });
      await prisma.legalLicense.create({ data: { organizationId, projectId, code: `HABITE-SE-${sale.id}`, type: "HABITE_SE", title: "Habite-se", authority: "Prefeitura", status: "APPROVED", provenance: "OFFICIAL_DOCUMENT", responsibleId: userId, createdById: userId, updatedById: userId } });

      const disbursement = await createBankFinancingDisbursement(owner(), { saleId: sale.id, financialInstitutionId, disbursementType: "FINANCING", expectedAmount: "80000.00" });
      await expect(markUnitDelivered(owner(), unit.id)).rejects.toThrow(/financeiro: PENDENTE/);

      await recordBankFinancingDisbursementReceived(owner(), { disbursementId: disbursement.id, disbursedAmount: "80000.00", disbursedAt: new Date("2026-05-15T00:00:00.000Z") });
      await transitionReceivableInstallment(owner(), installment.id, "EMITIDA");
      await reconcileBankFinancingDisbursement(owner(), { disbursementId: disbursement.id, installmentId: installment.id, bankAccountId });

      const delivered = await markUnitDelivered(owner(), unit.id);
      expect(delivered.status).toBe("ENTREGUE");
      const log = await prisma.auditLog.findFirstOrThrow({ where: { organizationId, entityType: "SalesUnit", entityId: unit.id, action: "SALES_UNIT_DELIVERED" } });
      const snapshot = log.after as { deliveryGateSnapshot?: { overall: string } };
      expect(snapshot.deliveryGateSnapshot?.overall).toBe("APTO");
    });
  });

  // -------------------------------------------------------------------------
  // Condomínio
  // -------------------------------------------------------------------------

  describe("Chaves — implantação do condomínio", () => {
    it("cria, transiciona até IMPLEMENTED com data de transferência e não permite mais mudar de estado", async () => {
      const project2 = await prisma.project.create({ data: { organizationId, companyId, name: `Projeto Condo ${Date.now()}`, city: "São Paulo", state: "SP", createdById: userId, updatedById: userId } });
      const created = await createCondominiumSetup(owner(), { projectId: project2.id, responsibleId: userId, administratorSupplierId: supplierId });
      expect(created.status).toBe("PLANNED");

      await expect(transitionCondominiumSetup(owner(), { condominiumSetupId: created.id, status: "IMPLEMENTED" })).rejects.toThrow(/data de transferência/);

      const implemented = await transitionCondominiumSetup(owner(), { condominiumSetupId: created.id, status: "IMPLEMENTED", transferredAt: new Date("2026-08-01T00:00:00.000Z") });
      expect(implemented.status).toBe("IMPLEMENTED");
      await expect(transitionCondominiumSetup(owner(), { condominiumSetupId: created.id, status: "IN_PROGRESS" })).rejects.toThrow(/estado terminal/);

      const read = await getCondominiumSetupForProject(owner(), project2.id);
      expect(read?.status).toBe("IMPLEMENTED");
    });

    it("não permite duas implantações no mesmo empreendimento", async () => {
      const project3 = await prisma.project.create({ data: { organizationId, companyId, name: `Projeto Condo Dup ${Date.now()}`, city: "São Paulo", state: "SP", createdById: userId, updatedById: userId } });
      await createCondominiumSetup(owner(), { projectId: project3.id, responsibleId: userId });
      await expect(createCondominiumSetup(owner(), { projectId: project3.id, responsibleId: userId })).rejects.toThrow(/já tem uma implantação/);
    });
  });

  // -------------------------------------------------------------------------
  // Assistência técnica
  // -------------------------------------------------------------------------

  describe("Assistência técnica — fornecedor, custo, reincidência, evidência e SLA", () => {
    it("atribui fornecedor responsável e custo estimado/real", async () => {
      const { unit, sale } = await makeApprovedSale("10000.00");
      const request = await createPostSaleRequest(owner(), { salesUnitId: unit.id, saleId: sale.id, customerId, category: "GARANTIA", description: "Infiltração no teto." });
      const withSupplier = await assignPostSaleSupplier(owner(), { requestId: request.id, supplierId });
      expect(withSupplier.supplierId).toBe(supplierId);
      const withCost = await setPostSaleCost(owner(), { requestId: request.id, estimatedCost: "500.00", actualCost: "480.00" });
      expect(withCost.estimatedCost?.toString()).toBe("500");
      expect(withCost.actualCost?.toString()).toBe("480");
    });

    it("reincidência exige a mesma unidade e recusa autorreferência", async () => {
      const { unit, sale } = await makeApprovedSale("10000.00");
      const first = await createPostSaleRequest(owner(), { salesUnitId: unit.id, saleId: sale.id, customerId, category: "ASSISTENCIA", description: "Vazamento." });
      const second = await createPostSaleRequest(owner(), { salesUnitId: unit.id, saleId: sale.id, customerId, category: "ASSISTENCIA", description: "Vazamento voltou." });
      const marked = await markPostSaleRecurrence(owner(), { requestId: second.id, recurrenceOfId: first.id });
      expect(marked.recurrenceOfId).toBe(first.id);
      await expect(markPostSaleRecurrence(owner(), { requestId: second.id, recurrenceOfId: second.id })).rejects.toThrow(/não pode ser reincidência de si mesmo/);

      const { unit: otherUnit, sale: otherSale } = await makeApprovedSale("10000.00");
      const thirdOnOtherUnit = await createPostSaleRequest(owner(), { salesUnitId: otherUnit.id, saleId: otherSale.id, customerId, category: "ASSISTENCIA", description: "Outro problema." });
      await expect(markPostSaleRecurrence(owner(), { requestId: thirdOnOtherUnit.id, recurrenceOfId: first.id })).rejects.toThrow(/mesma unidade/);
    });

    it("SLA vencido emite alerta operacional SLA_ASSISTENCIA_VENCIDO exatamente uma vez por chamado dentro da janela de dedup", async () => {
      const { unit, sale } = await makeApprovedSale("10000.00");
      const overdue = await createPostSaleRequest(owner(), { salesUnitId: unit.id, saleId: sale.id, customerId, category: "ASSISTENCIA", description: "Chamado com SLA vencido.", slaDueAt: new Date("2020-01-01T00:00:00.000Z") });
      const notOverdue = await createPostSaleRequest(owner(), { salesUnitId: unit.id, saleId: sale.id, customerId, category: "ASSISTENCIA", description: "Chamado dentro do prazo.", slaDueAt: new Date("2099-01-01T00:00:00.000Z") });

      const { provider, capture } = fakeReporter();
      resetOperationalAlertStateForTests();
      setOperationalAlertReporterForTests(provider);
      const breached = await evaluatePostSaleSlaBreaches({ organizationId });
      expect(breached).toContain(overdue.id);
      expect(breached).not.toContain(notOverdue.id);
      expect(capture.mock.calls.length).toBeGreaterThanOrEqual(1);
      setOperationalAlertReporterForTests(undefined);
      resetOperationalAlertStateForTests();
    });

    it("evidência antes/depois é armazenada com checksum SHA-256, sem o binário no Postgres", async () => {
      const { unit, sale } = await makeApprovedSale("10000.00");
      const request = await createPostSaleRequest(owner(), { salesUnitId: unit.id, saleId: sale.id, customerId, category: "ASSISTENCIA", description: "Pintura descascando." });
      const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
      const update = await addPostSaleEvidence(owner(), { requestId: request.id, evidenceKind: "BEFORE", fileName: "antes.png", mimeType: "image/png", bytes: png });
      expect(update.evidenceKind).toBe("BEFORE");
      expect(update.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(update.storageKey).toBeTruthy();
      const row = await prisma.postSaleUpdate.findUniqueOrThrow({ where: { id: update.id } });
      expect(JSON.stringify(row)).not.toContain("\\x89PNG"); // não é o binário — só metadado
    });

    it("recusa evidência com assinatura binária incompatível com a extensão (reaproveita validateDocumentUpload)", async () => {
      const { unit, sale } = await makeApprovedSale("10000.00");
      const request = await createPostSaleRequest(owner(), { salesUnitId: unit.id, saleId: sale.id, customerId, category: "ASSISTENCIA", description: "Teste de upload hostil." });
      const fakeExe = Uint8Array.from([0x4d, 0x5a, 1, 2, 3, 4]);
      await expect(addPostSaleEvidence(owner(), { requestId: request.id, evidenceKind: "AFTER", fileName: "foto.png", mimeType: "image/png", bytes: fakeExe })).rejects.toThrow(/[Cc]onteúdo/);
    });
  });

  // -------------------------------------------------------------------------
  // Correção focal pós-reauditoria — achado Alto: gate técnico deve olhar sempre para a
  // vistoria MAIS RECENTE (scheduledAt desc, createdAt desc, id desc), nunca "qualquer
  // aprovação alguma vez". Testes contra PostgreSQL real.
  // -------------------------------------------------------------------------

  describe("Gate técnico — vistoria mais recente decide (achado Alto da reauditoria)", () => {
    it("rejeição mais recente bloqueia mesmo havendo uma aprovação mais antiga", async () => {
      const { unit, sale } = await makeApprovedSale("10000.00");
      const older = await scheduleInspection(owner(), { salesUnitId: unit.id, saleId: sale.id, scheduledAt: new Date("2026-01-01T00:00:00.000Z"), responsibleId: userId });
      await recordInspectionOutcome(owner(), { inspectionId: older.id, outcome: "ACCEPTED", pendingIssues: [] });
      const recent = await scheduleInspection(owner(), { salesUnitId: unit.id, saleId: sale.id, scheduledAt: new Date("2026-01-15T00:00:00.000Z"), responsibleId: userId });
      await recordInspectionOutcome(owner(), { inspectionId: recent.id, outcome: "REJECTED", pendingIssues: [{ item: "Rachadura" }] });

      const readiness = await evaluateUnitDeliveryReadiness(prisma, organizationId, projectId, unit.id, sale.id);
      expect(readiness.technical.status).toBe("PENDENTE");
      expect(readiness.technical.snapshot.inspectionId).toBe(recent.id);
    });

    it("aprovação mais recente libera mesmo havendo uma rejeição mais antiga", async () => {
      const { unit, sale } = await makeApprovedSale("10000.00");
      const older = await scheduleInspection(owner(), { salesUnitId: unit.id, saleId: sale.id, scheduledAt: new Date("2026-01-01T00:00:00.000Z"), responsibleId: userId });
      await recordInspectionOutcome(owner(), { inspectionId: older.id, outcome: "REJECTED", pendingIssues: [{ item: "Piso solto" }] });
      const recent = await scheduleInspection(owner(), { salesUnitId: unit.id, saleId: sale.id, scheduledAt: new Date("2026-01-20T00:00:00.000Z"), responsibleId: userId });
      await recordInspectionOutcome(owner(), { inspectionId: recent.id, outcome: "ACCEPTED", pendingIssues: [] });

      const readiness = await evaluateUnitDeliveryReadiness(prisma, organizationId, projectId, unit.id, sale.id);
      expect(readiness.technical.status).toBe("APTO");
      expect(readiness.technical.snapshot.inspectionId).toBe(recent.id);
    });

    it("três vistorias sequenciais — só a mais recente decide o gate", async () => {
      const { unit, sale } = await makeApprovedSale("10000.00");
      const i1 = await scheduleInspection(owner(), { salesUnitId: unit.id, saleId: sale.id, scheduledAt: new Date("2026-01-01T00:00:00.000Z"), responsibleId: userId });
      await recordInspectionOutcome(owner(), { inspectionId: i1.id, outcome: "ACCEPTED", pendingIssues: [] });
      const i2 = await scheduleInspection(owner(), { salesUnitId: unit.id, saleId: sale.id, scheduledAt: new Date("2026-01-10T00:00:00.000Z"), responsibleId: userId });
      await recordInspectionOutcome(owner(), { inspectionId: i2.id, outcome: "REJECTED", pendingIssues: [{ item: "Elétrica" }] });
      const i3 = await scheduleInspection(owner(), { salesUnitId: unit.id, saleId: sale.id, scheduledAt: new Date("2026-01-20T00:00:00.000Z"), responsibleId: userId });
      await recordInspectionOutcome(owner(), { inspectionId: i3.id, outcome: "ACCEPTED_WITH_PENDING", pendingIssues: [{ item: "Detalhe de pintura" }] });

      const readiness = await evaluateUnitDeliveryReadiness(prisma, organizationId, projectId, unit.id, sale.id);
      expect(readiness.technical.status).toBe("APTO");
      expect(readiness.technical.snapshot.inspectionId).toBe(i3.id);
    });

    it("empate no scheduledAt é desempatado deterministicamente — a vistoria registrada por último decide", async () => {
      const { unit, sale } = await makeApprovedSale("10000.00");
      const tie = new Date("2026-02-01T09:00:00.000Z");
      const first = await scheduleInspection(owner(), { salesUnitId: unit.id, saleId: sale.id, scheduledAt: tie, responsibleId: userId });
      await recordInspectionOutcome(owner(), { inspectionId: first.id, outcome: "ACCEPTED", pendingIssues: [] });
      const second = await scheduleInspection(owner(), { salesUnitId: unit.id, saleId: sale.id, scheduledAt: tie, responsibleId: userId });
      await recordInspectionOutcome(owner(), { inspectionId: second.id, outcome: "REJECTED", pendingIssues: [{ item: "Vazamento" }] });

      const readiness = await evaluateUnitDeliveryReadiness(prisma, organizationId, projectId, unit.id, sale.id);
      expect(readiness.technical.status).toBe("PENDENTE");
      expect(readiness.technical.snapshot.inspectionId).toBe(second.id);
    });

    it("vistoria de outra unidade nunca decide o gate desta unidade", async () => {
      const { unit, sale } = await makeApprovedSale("10000.00");
      const { unit: otherUnit, sale: otherSale } = await makeApprovedSale("10000.00");
      const otherInspection = await scheduleInspection(owner(), { salesUnitId: otherUnit.id, saleId: otherSale.id, scheduledAt: new Date(), responsibleId: userId });
      await recordInspectionOutcome(owner(), { inspectionId: otherInspection.id, outcome: "ACCEPTED", pendingIssues: [] });

      const readiness = await evaluateUnitDeliveryReadiness(prisma, organizationId, projectId, unit.id, sale.id);
      expect(readiness.technical.status).toBe("SEM_EVIDENCIA");
      expect(readiness.technical.snapshot.inspectionId).toBeNull();
    });

    it("passar o organizationId de outro tenant nunca enxerga a vistoria real (defesa em profundidade além do tenant já garantido a montante)", async () => {
      const { unit, sale } = await makeApprovedSale("10000.00");
      const inspection = await scheduleInspection(owner(), { salesUnitId: unit.id, saleId: sale.id, scheduledAt: new Date(), responsibleId: userId });
      await recordInspectionOutcome(owner(), { inspectionId: inspection.id, outcome: "ACCEPTED", pendingIssues: [] });

      const crossTenant = await evaluateUnitDeliveryReadiness(prisma, foreignOrganizationId, projectId, unit.id, sale.id);
      expect(crossTenant.technical.status).toBe("SEM_EVIDENCIA");
      expect(crossTenant.technical.snapshot.inspectionId).toBeNull();
    });

    it("vistoria com scheduledAt no futuro nunca libera o gate, mesmo já tendo outcome registrado", async () => {
      const { unit, sale } = await makeApprovedSale("10000.00");
      const future = await scheduleInspection(owner(), { salesUnitId: unit.id, saleId: sale.id, scheduledAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), responsibleId: userId });
      await recordInspectionOutcome(owner(), { inspectionId: future.id, outcome: "ACCEPTED", pendingIssues: [] });

      const readiness = await evaluateUnitDeliveryReadiness(prisma, organizationId, projectId, unit.id, sale.id);
      expect(readiness.technical.status).toBe("SEM_EVIDENCIA");
      expect(readiness.technical.snapshot.inspectionId).toBeNull();
    });

    it("pendência bloqueante (ACCEPTED_WITH_PENDING com reinspeção em aberto) mantém PENDENTE até a reinspeção acontecer", async () => {
      const { unit, sale } = await makeApprovedSale("10000.00");
      const past = new Date(Date.now() - 60_000);
      const followUp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const first = await scheduleInspection(owner(), { salesUnitId: unit.id, saleId: sale.id, scheduledAt: past, responsibleId: userId });
      await recordInspectionOutcome(owner(), { inspectionId: first.id, outcome: "ACCEPTED_WITH_PENDING", pendingIssues: [{ item: "Ajuste de esquadria" }], nextInspectionAt: followUp });

      let readiness = await evaluateUnitDeliveryReadiness(prisma, organizationId, projectId, unit.id, sale.id);
      expect(readiness.technical.status).toBe("PENDENTE");
      expect(readiness.technical.snapshot.inspectionId).toBe(first.id);

      const second = await scheduleInspection(owner(), { salesUnitId: unit.id, saleId: sale.id, scheduledAt: new Date(Date.now() - 1_000), responsibleId: userId });
      await recordInspectionOutcome(owner(), { inspectionId: second.id, outcome: "ACCEPTED", pendingIssues: [] });
      readiness = await evaluateUnitDeliveryReadiness(prisma, organizationId, projectId, unit.id, sale.id);
      expect(readiness.technical.status).toBe("APTO");
      expect(readiness.technical.snapshot.inspectionId).toBe(second.id);
    });

    it("chamadas repetidas/concorrentes de evaluateUnitDeliveryReadiness são estáveis — leitura pura, sem efeito colateral", async () => {
      const { unit, sale } = await makeApprovedSale("10000.00");
      const inspection = await scheduleInspection(owner(), { salesUnitId: unit.id, saleId: sale.id, scheduledAt: new Date(), responsibleId: userId });
      await recordInspectionOutcome(owner(), { inspectionId: inspection.id, outcome: "ACCEPTED", pendingIssues: [] });

      const results = await Promise.all(Array.from({ length: 5 }, () => evaluateUnitDeliveryReadiness(prisma, organizationId, projectId, unit.id, sale.id)));
      for (const readiness of results) {
        expect(readiness.technical.status).toBe("APTO");
        expect(readiness.technical.snapshot.inspectionId).toBe(inspection.id);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Correção focal pós-reauditoria — achado Médio: TOCTOU entre a leitura dos gates e o
  // commit da entrega. Testes de concorrência real contra PostgreSQL (Promise.all),
  // verificando o INVARIANTE que precisa valer independentemente da ordem de execução:
  // a unidade só fica ENTREGUE se o snapshot gravado no termo mostrar os três gates APTO.
  // -------------------------------------------------------------------------

  describe("markUnitDelivered — concorrência e TOCTOU (achado Médio da reauditoria)", () => {
    /** Venda com os três gates verdes: vistoria aceita, licença aprovada, parcela paga (fora do fluxo de repasse — não é o alvo destes testes). */
    async function makeReadyForDelivery(price = "10000.00") {
      const { unit, sale, installment } = await makeApprovedSale(price);
      const inspection = await scheduleInspection(owner(), { salesUnitId: unit.id, saleId: sale.id, scheduledAt: new Date(Date.now() - 60_000), responsibleId: userId });
      await recordInspectionOutcome(owner(), { inspectionId: inspection.id, outcome: "ACCEPTED", pendingIssues: [] });
      const license = await prisma.legalLicense.create({ data: { organizationId, projectId, code: `HABITE-SE-TOCTOU-${sale.id}`, type: "HABITE_SE", title: "Habite-se", authority: "Prefeitura", status: "APPROVED", provenance: "OFFICIAL_DOCUMENT", responsibleId: userId, createdById: userId, updatedById: userId } });
      await prisma.receivableInstallment.update({ where: { id: installment.id }, data: { status: "RECEBIDA" } });
      const readiness = await evaluateUnitDeliveryReadiness(prisma, organizationId, projectId, unit.id, sale.id);
      expect(readiness.overall).toBe("APTO");
      return { unit, sale, installment, license };
    }

    async function deliveredLogsFor(salesUnitId: string) {
      return prisma.auditLog.findMany({ where: { organizationId, entityType: "SalesUnit", entityId: salesUnitId, action: "SALES_UNIT_DELIVERED" } });
    }

    it("duas entregas simultâneas — exatamente uma efetiva a mudança, a outra retorna o mesmo estado final de forma idempotente", async () => {
      const { unit } = await makeReadyForDelivery();
      const results = await Promise.allSettled([markUnitDelivered(owner(), unit.id), markUnitDelivered(owner(), unit.id)]);
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      const final = await prisma.salesUnit.findUniqueOrThrow({ where: { id: unit.id } });
      expect(final.status).toBe("ENTREGUE");
      expect(await deliveredLogsFor(unit.id)).toHaveLength(1);
    });

    it("revogação da licença jurídica concorrente durante a operação nunca resulta em entrega com snapshot inconsistente", async () => {
      const { unit, license } = await makeReadyForDelivery();
      const [deliveryResult] = await Promise.allSettled([
        markUnitDelivered(owner(), unit.id),
        prisma.legalLicense.update({ where: { id: license.id }, data: { status: "SUSPENDED" } }),
      ]);
      const final = await prisma.salesUnit.findUniqueOrThrow({ where: { id: unit.id } });
      if (final.status === "ENTREGUE") {
        expect(deliveryResult.status).toBe("fulfilled");
        const log = await prisma.auditLog.findFirstOrThrow({ where: { organizationId, entityType: "SalesUnit", entityId: unit.id, action: "SALES_UNIT_DELIVERED" } });
        const snapshot = log.after as { deliveryGateSnapshot?: { legal: { status: string } } };
        expect(snapshot.deliveryGateSnapshot?.legal.status).toBe("APTO");
      } else {
        expect(deliveryResult.status).toBe("rejected");
      }
      // devolve a licença ao estado aprovado — o gate jurídico é por PROJETO (compartilhado
      // entre testes desta suíte), então uma licença deixada SUSPENDED contaminaria outros
      // testes que reaproveitam o mesmo `projectId`.
      await prisma.legalLicense.updateMany({ where: { id: license.id, status: { not: "APPROVED" } }, data: { status: "APPROVED" } });
    });

    it("vistoria rejeitada concorrente durante a operação nunca resulta em entrega com snapshot inconsistente", async () => {
      const { unit, sale } = await makeReadyForDelivery();
      const [deliveryResult] = await Promise.allSettled([
        markUnitDelivered(owner(), unit.id),
        prisma.salesUnitInspection.create({ data: { salesUnitId: unit.id, saleId: sale.id, scheduledAt: new Date(Date.now() - 1_000), responsibleId: userId, outcome: "REJECTED", pendingIssues: [{ item: "Infiltração nova" }], createdById: userId } }),
      ]);
      const final = await prisma.salesUnit.findUniqueOrThrow({ where: { id: unit.id } });
      if (final.status === "ENTREGUE") {
        expect(deliveryResult.status).toBe("fulfilled");
        const log = await prisma.auditLog.findFirstOrThrow({ where: { organizationId, entityType: "SalesUnit", entityId: unit.id, action: "SALES_UNIT_DELIVERED" } });
        const snapshot = log.after as { deliveryGateSnapshot?: { technical: { status: string } } };
        expect(snapshot.deliveryGateSnapshot?.technical.status).toBe("APTO");
      } else {
        expect(deliveryResult.status).toBe("rejected");
      }
    });

    it("reversão de pagamento (parcela volta a vencida) concorrente durante a operação nunca resulta em entrega com snapshot inconsistente", async () => {
      const { unit, installment } = await makeReadyForDelivery();
      const [deliveryResult] = await Promise.allSettled([
        markUnitDelivered(owner(), unit.id),
        prisma.receivableInstallment.update({ where: { id: installment.id }, data: { status: "PREVISTA" } }), // dueDate original (2026-06-01) já está no passado — volta a contar como vencida
      ]);
      const final = await prisma.salesUnit.findUniqueOrThrow({ where: { id: unit.id } });
      if (final.status === "ENTREGUE") {
        expect(deliveryResult.status).toBe("fulfilled");
        const log = await prisma.auditLog.findFirstOrThrow({ where: { organizationId, entityType: "SalesUnit", entityId: unit.id, action: "SALES_UNIT_DELIVERED" } });
        const snapshot = log.after as { deliveryGateSnapshot?: { financial: { status: string } } };
        expect(snapshot.deliveryGateSnapshot?.financial.status).toBe("APTO");
      } else {
        expect(deliveryResult.status).toBe("rejected");
      }
      // devolve ao estado pago, para não contaminar outros testes que reaproveitam esta organização
      await prisma.receivableInstallment.updateMany({ where: { id: installment.id, status: { not: "RECEBIDA" } }, data: { status: "RECEBIDA" } });
    });

    it("gate bloqueado não deixa termo parcial — nenhum log de entrega e a unidade permanece VENDIDA", async () => {
      const { unit } = await makeApprovedSale("10000.00"); // sem vistoria/licença — bloqueado
      await expect(markUnitDelivered(owner(), unit.id)).rejects.toThrow(/Entrega bloqueada/);
      const final = await prisma.salesUnit.findUniqueOrThrow({ where: { id: unit.id } });
      expect(final.status).toBe("VENDIDA");
      expect(await deliveredLogsFor(unit.id)).toHaveLength(0);
    });

    it("repetição após sucesso é idempotente — não duplica o termo de entrega", async () => {
      const { unit } = await makeReadyForDelivery();
      const first = await markUnitDelivered(owner(), unit.id);
      expect(first.status).toBe("ENTREGUE");
      const second = await markUnitDelivered(owner(), unit.id);
      expect(second.status).toBe("ENTREGUE");
      expect(await deliveredLogsFor(unit.id)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Correção focal pós-reauditoria — achado Médio: P2002 só é tratado como a colisão de
  // idempotência esperada quando a constraint/modelo correspondem exatamente; qualquer
  // outro P2002 (ou outro código) deve propagar sem tratamento especial.
  // -------------------------------------------------------------------------

  describe("Reconciliação — P2002 restrito à constraint exata (achado Médio da reauditoria)", () => {
    function fakeP2002(meta: Record<string, unknown>) {
      return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test", meta });
    }

    it("reconhece exatamente a constraint de idempotência esperada — ReceivablePayment.idempotency_key (formato real confirmado por introspecção do Postgres)", () => {
      expect(isIdempotencyKeyConflict(fakeP2002({ modelName: "ReceivablePayment", target: ["idempotency_key"] }))).toBe(true);
      expect(isIdempotencyKeyConflict(fakeP2002({ modelName: "ReceivablePayment", target: "idempotency_key" }))).toBe(true);
    });

    it("nunca reconhece um P2002 de outra constraint, outro modelo, ou outro código de erro — propaga sem mascarar", () => {
      expect(isIdempotencyKeyConflict(fakeP2002({ modelName: "BankFinancingDisbursement", target: ["id"] }))).toBe(false);
      expect(isIdempotencyKeyConflict(fakeP2002({ modelName: "ReceivablePayment", target: ["organization_id", "bank_account_id", "reference_number"] }))).toBe(false);
      expect(isIdempotencyKeyConflict(fakeP2002({}))).toBe(false);
      const fkViolation = new Prisma.PrismaClientKnownRequestError("Foreign key violation", { code: "P2003", clientVersion: "test", meta: { modelName: "ReceivablePayment" } });
      expect(isIdempotencyKeyConflict(fkViolation)).toBe(false);
      expect(isIdempotencyKeyConflict(new Error("erro genérico não relacionado"))).toBe(false);
    });

    it("reconciliação concorrente real (4x Promise.allSettled) continua gerando exatamente um ReceivablePayment — exercita a colisão real da constraint esperada", async () => {
      const { sale, installment } = await makeApprovedSale("90000.00");
      const created = await createBankFinancingDisbursement(owner(), { saleId: sale.id, financialInstitutionId, disbursementType: "FINANCING", expectedAmount: "90000.00" });
      await recordBankFinancingDisbursementReceived(owner(), { disbursementId: created.id, disbursedAmount: "90000.00", disbursedAt: new Date("2026-05-15T00:00:00.000Z") });
      await transitionReceivableInstallment(owner(), installment.id, "EMITIDA");
      const results = await Promise.allSettled(Array.from({ length: 4 }, () =>
        reconcileBankFinancingDisbursement(owner(), { disbursementId: created.id, installmentId: installment.id, bankAccountId })));
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      expect(await prisma.receivablePayment.count({ where: { installmentId: installment.id } })).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Correção focal pós-reauditoria — achado Médio: imutabilidade só em aplicação, sem
  // espelho no banco. Migration additiva 20260910151500 adiciona triggers condicionais
  // (bloqueiam só a partir do estado terminal) + TRUNCATE incondicional, mesmo padrão de
  // 20260905220000_phase_9p3a_immutable_signature_evidence. Testes contra PostgreSQL real,
  // inclusive SQL bruto (a proteção precisa valer também fora do Prisma).
  // -------------------------------------------------------------------------

  describe("Imutabilidade estrutural — RECONCILED e IMPLEMENTED/CANCELLED protegidos por trigger (achado Médio da reauditoria)", () => {
    it("permite transições legítimas antes do estado terminal, mas bloqueia UPDATE/DELETE (Prisma e SQL bruto) depois de RECONCILED", async () => {
      const { sale, installment } = await makeApprovedSale("60000.00");
      const created = await createBankFinancingDisbursement(owner(), { saleId: sale.id, financialInstitutionId, disbursementType: "FINANCING", expectedAmount: "60000.00" });
      await requestBankFinancingDisbursement(owner(), { disbursementId: created.id, requestedAt: new Date("2026-05-01T00:00:00.000Z") });
      await recordBankFinancingDisbursementReceived(owner(), { disbursementId: created.id, disbursedAmount: "60000.00", disbursedAt: new Date("2026-05-15T00:00:00.000Z") });
      await transitionReceivableInstallment(owner(), installment.id, "EMITIDA");
      const reconciled = await reconcileBankFinancingDisbursement(owner(), { disbursementId: created.id, installmentId: installment.id, bankAccountId });
      expect(reconciled.status).toBe("RECONCILED");

      await expect(prisma.bankFinancingDisbursement.update({ where: { id: reconciled.id }, data: { notes: "tamper" } })).rejects.toThrow(/BANK_FINANCING_DISBURSEMENT_IMMUTABLE/);
      await expect(prisma.bankFinancingDisbursement.delete({ where: { id: reconciled.id } })).rejects.toThrow(/BANK_FINANCING_DISBURSEMENT_IMMUTABLE/);
      await expect(prisma.$executeRaw`UPDATE bank_financing_disbursements SET notes = 'raw-tamper' WHERE id = ${reconciled.id}`).rejects.toThrow(/BANK_FINANCING_DISBURSEMENT_IMMUTABLE/);
      // guarda de aplicação (pré-existente) continua correta e redundante à proteção de banco
      await expect(cancelBankFinancingDisbursement(owner(), { disbursementId: reconciled.id, reason: "tentativa" })).rejects.toThrow(/já conciliado/);
    });

    it("bloqueia TRUNCATE em bank_financing_disbursements incondicionalmente", async () => {
      await expect(prisma.$executeRaw`TRUNCATE bank_financing_disbursements`).rejects.toThrow("BANK_FINANCING_DISBURSEMENT_IMMUTABLE");
    });

    it("permite transições legítimas antes do estado terminal, mas bloqueia UPDATE/DELETE (Prisma e SQL bruto) depois de IMPLEMENTED", async () => {
      const project4 = await prisma.project.create({ data: { organizationId, companyId, name: `Projeto Imutabilidade ${Date.now()}`, city: "São Paulo", state: "SP", createdById: userId, updatedById: userId } });
      const created = await createCondominiumSetup(owner(), { projectId: project4.id, responsibleId: userId });
      await transitionCondominiumSetup(owner(), { condominiumSetupId: created.id, status: "IN_PROGRESS" });
      const implemented = await transitionCondominiumSetup(owner(), { condominiumSetupId: created.id, status: "IMPLEMENTED", transferredAt: new Date("2026-08-01T00:00:00.000Z") });
      expect(implemented.status).toBe("IMPLEMENTED");

      await expect(prisma.condominiumSetup.update({ where: { id: implemented.id }, data: { notes: "tamper" } })).rejects.toThrow(/CONDOMINIUM_SETUP_IMMUTABLE/);
      await expect(prisma.condominiumSetup.delete({ where: { id: implemented.id } })).rejects.toThrow(/CONDOMINIUM_SETUP_IMMUTABLE/);
      await expect(prisma.$executeRaw`UPDATE condominium_setups SET notes = 'raw-tamper' WHERE id = ${implemented.id}`).rejects.toThrow(/CONDOMINIUM_SETUP_IMMUTABLE/);
    });

    it("também protege o estado terminal CANCELLED, não só IMPLEMENTED", async () => {
      const project5 = await prisma.project.create({ data: { organizationId, companyId, name: `Projeto Imutabilidade Cancel ${Date.now()}`, city: "São Paulo", state: "SP", createdById: userId, updatedById: userId } });
      const created = await createCondominiumSetup(owner(), { projectId: project5.id, responsibleId: userId });
      const cancelled = await transitionCondominiumSetup(owner(), { condominiumSetupId: created.id, status: "CANCELLED" });
      expect(cancelled.status).toBe("CANCELLED");
      await expect(prisma.condominiumSetup.delete({ where: { id: cancelled.id } })).rejects.toThrow(/CONDOMINIUM_SETUP_IMMUTABLE/);
    });

    it("bloqueia TRUNCATE em condominium_setups incondicionalmente", async () => {
      await expect(prisma.$executeRaw`TRUNCATE condominium_setups`).rejects.toThrow("CONDOMINIUM_SETUP_IMMUTABLE");
    });
  });

  // -------------------------------------------------------------------------
  // Teste arquitetural — nenhum domínio paralelo
  // -------------------------------------------------------------------------

  describe("Teste arquitetural — sem domínio paralelo de vistoria/entrega/assistência/financeiro", () => {
    it("os únicos modelos Prisma novos da 9R são BankFinancingDisbursement e CondominiumSetup", () => {
      const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
      const modelNames = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1]);
      // Nenhum outro nome de modelo sugerindo um domínio paralelo (vistoria/entrega/assistência
      // já são SalesUnitInspection/PostSaleRequest estendidos; repasse/condomínio são os 2 aprovados).
      const forbiddenPatterns = [/^Delivery/, /^Handover(?!.*Disbursement)/, /^Inspection/, /^Assistance/, /^TechnicalSupport/, /^WarrantyRequest/, /^KeyDelivery/];
      const offenders = modelNames.filter((name) => forbiddenPatterns.some((pattern) => pattern.test(name)));
      expect(offenders).toEqual([]);
      expect(modelNames).toContain("BankFinancingDisbursement");
      expect(modelNames).toContain("CondominiumSetup");
      expect(modelNames).toContain("SalesUnitInspection");
      expect(modelNames).toContain("PostSaleRequest");
    });

    it("nenhum serviço novo da 9R duplica escrita direta em SalesUnitInspection/PostSaleRequest fora de application/sales", () => {
      const handoverDir = join(process.cwd(), "src", "application", "handover");
      const files = readdirSync(handoverDir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
      for (const file of files) {
        const content = readFileSync(join(handoverDir, file), "utf8");
        expect(content).not.toMatch(/prisma\.salesUnitInspection\.(create|update|delete)/);
        expect(content).not.toMatch(/prisma\.postSaleRequest\.(create|update|delete)/);
      }
    });
  });
});
