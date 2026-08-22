import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { createCustomer, createSupplier } from "@/application/financial-ops/financial-service";
import {
  activateSalesPriceTable, approveSale, blockSalesUnit, createSale, createSalesCommission, createSalesPriceTable,
  createSalesProposal, createSalesReservation, createSalesUnit, generateSaleReceivables, getSalesWorkspace,
  rescindSale, unblockSalesUnit, approveSalesCommission,
} from "./sales-service";

const token = randomUUID().slice(0, 8);
const createdUnitIds: string[] = [];
const createdSaleIds: string[] = [];
const createdPriceTableIds: string[] = [];

async function makeUnit(context: AuthContext, projectId: string, companyId: string, code: string, listPrice: string) {
  const unit = await createSalesUnit(context, { projectId, companyId, code, typology: "2 dormitórios", privateAreaM2: "55" });
  createdUnitIds.push(unit.id);
  const table = await createSalesPriceTable(context, { projectId, companyId, validFrom: new Date("2026-08-01T00:00:00Z"), responsibleId: context.userId, lines: [{ salesUnitId: unit.id, listPrice, minimumAuthorizedPrice: "0" }] });
  createdPriceTableIds.push(table.id);
  const activated = await activateSalesPriceTable(context, table.id);
  return { unit, table: activated };
}

describe.skipIf(!process.env.DATABASE_URL).sequential("Fase 9E — vendas, recebíveis e comissões contra PostgreSQL real", () => {
  let context: AuthContext;
  let projectId: string;
  let companyId: string;
  let customerId: string;
  let brokerId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: "rede-nucleo-de-negocios" } });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "admin@rede.local" } });
    const project = await prisma.project.findUniqueOrThrow({ where: { organizationId_name: { organizationId: organization.id, name: "START BUTANTÃ" } } });
    context = { sessionId: "test", userId: user.id, userName: user.name, userEmail: user.email, organizationId: organization.id, organizationName: organization.name, organizationSlug: organization.slug, role: "OWNER" };
    projectId = project.id; companyId = project.companyId!;
    const customer = await createCustomer(context, { name: `Cliente Teste ${token}`, taxId: `CUST-${token}` });
    customerId = customer.id;
    const broker = await createSupplier(context, { name: `Corretor Teste ${token}`, taxId: `BROKER-${token}` });
    brokerId = broker.id;
  });

  afterAll(async () => {
    try {
      const receivableAccounts = await prisma.receivableAccount.findMany({ where: { saleId: { in: createdSaleIds } } });
      const testCommissions = await prisma.salesCommission.findMany({ where: { saleId: { in: createdSaleIds } } });
      const testCommissionIds = testCommissions.map((commission) => commission.id);
      const payableNoteFilters = [...testCommissionIds.map((id) => ({ notes: { contains: `SALE_COMMISSION:${id}` } })), ...createdSaleIds.map((id) => ({ notes: { contains: `SALE_RESCISSION:${id}` } }))];
      const payables = payableNoteFilters.length ? await prisma.payableAccount.findMany({ where: { OR: payableNoteFilters } }) : [];
      await prisma.financialIntegrationEvent.deleteMany({ where: { OR: [{ receivableAccountId: { in: receivableAccounts.map((account) => account.id) } }, { payableAccountId: { in: payables.map((account) => account.id) } }, { sourceType: "SALE_COMMISSION", sourceId: { in: testCommissionIds } }, { sourceType: "SALE_RESCISSION", sourceId: { in: createdSaleIds } }] } });
      await prisma.receivablePayment.deleteMany({ where: { installment: { receivableAccountId: { in: receivableAccounts.map((a) => a.id) } } } });
      await prisma.installmentAdjustment.deleteMany({ where: { receivableInstallment: { receivableAccountId: { in: receivableAccounts.map((a) => a.id) } } } });
      await prisma.receivableInstallment.deleteMany({ where: { receivableAccountId: { in: receivableAccounts.map((a) => a.id) } } });
      const obligationIds = receivableAccounts.flatMap((a) => a.obligationId ? [a.obligationId] : []);
      await prisma.receivableAccount.deleteMany({ where: { id: { in: receivableAccounts.map((a) => a.id) } } });
      await prisma.payableInstallment.deleteMany({ where: { payableAccountId: { in: payables.map((p) => p.id) } } });
      const payableObligationIds = payables.flatMap((p) => p.obligationId ? [p.obligationId] : []);
      await prisma.payableAccount.deleteMany({ where: { id: { in: payables.map((p) => p.id) } } });
      await prisma.financialObligation.deleteMany({ where: { id: { in: [...obligationIds, ...payableObligationIds] } } });
      await prisma.salesCommission.deleteMany({ where: { saleId: { in: createdSaleIds } } });
      await prisma.salesUnitBlock.deleteMany({ where: { salesUnitId: { in: createdUnitIds } } });
      await prisma.postSaleRequest.deleteMany({ where: { saleId: { in: createdSaleIds } } });
      await prisma.salesUnitInspection.deleteMany({ where: { saleId: { in: createdSaleIds } } });
      await prisma.salesPaymentPlanInstallment.deleteMany({ where: { plan: { saleId: { in: createdSaleIds } } } });
      await prisma.salesPaymentPlan.deleteMany({ where: { saleId: { in: createdSaleIds } } });
      await prisma.salesContract.deleteMany({ where: { saleId: { in: createdSaleIds } } });
      await prisma.saleParty.deleteMany({ where: { saleId: { in: createdSaleIds } } });
      await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
      await prisma.salesReservation.deleteMany({ where: { salesUnitId: { in: createdUnitIds } } });
      await prisma.salesProposal.deleteMany({ where: { salesUnitId: { in: createdUnitIds } } });
      await prisma.salesPriceTableLine.deleteMany({ where: { priceTableId: { in: createdPriceTableIds } } });
      await prisma.salesPriceTable.deleteMany({ where: { id: { in: createdPriceTableIds } } });
      await prisma.salesUnit.deleteMany({ where: { id: { in: createdUnitIds } } });
      await prisma.supplier.deleteMany({ where: { id: brokerId } });
      await prisma.customer.deleteMany({ where: { id: customerId } });
    } catch (error) {
      console.warn("Limpeza pós-teste comercial não concluída — dados de teste podem persistir:", error);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("impede leitura cruzada entre organizações", async () => {
    const atlas = await prisma.organization.findUniqueOrThrow({ where: { slug: "grupo-atlas" } });
    const atlasUser = await prisma.user.findUniqueOrThrow({ where: { email: "analista@atlas.local" } });
    await expect(getSalesWorkspace({ ...context, organizationId: atlas.id, userId: atlasUser.id, role: "ANALYST" }, projectId)).rejects.toThrow("não encontrado nesta organização");
  });

  it("Cenário A: venda com 10 parcelas gera exatamente 10 recebíveis, e replay do plano continua em 10, nenhum duplicado", async () => {
    const { unit, table } = await makeUnit(context, projectId, companyId, `UN-A-${token}`, "500000");
    const sale = await createSale(context, { salesUnitId: unit.id, priceTableId: table.id, soldPrice: "500000", parties: [{ customerId, role: "BUYER" }] });
    createdSaleIds.push(sale.id);
    const installments = Array.from({ length: 10 }, (_, index) => ({ number: index + 1, nature: "MONTHLY" as const, dueDate: new Date(Date.UTC(2026, 9 + index, 10)), amount: "50000" }));
    const { plan } = await approveSale(context, { saleId: sale.id, contract: { number: `CV-A-${token}`, title: "Contrato de venda — Cenário A" }, installments });
    expect(plan.installments.length).toBe(10);

    const receivableCount = await prisma.receivableAccount.count({ where: { saleId: sale.id } });
    expect(receivableCount).toBe(10);

    // Replay do mesmo comando (mesmas parcelas comerciais) — deve continuar em 10, nenhuma duplicada.
    await generateSaleReceivables(context, sale.id);
    await generateSaleReceivables(context, sale.id);
    const receivableCountAfterReplay = await prisma.receivableAccount.count({ where: { saleId: sale.id } });
    expect(receivableCountAfterReplay).toBe(10);
    const eventCount = await prisma.financialIntegrationEvent.count({ where: { sourceType: "SALE_PAYMENT_PLAN_INSTALLMENT", payload: { path: ["saleId"], equals: sale.id } } });
    expect(eventCount).toBe(10);
  });

  it("Cenário B: recebimento no Financeiro não duplica receita comercial (venda soma o que a 9B registrou, uma vez)", async () => {
    const { unit, table } = await makeUnit(context, projectId, companyId, `UN-B-${token}`, "300000");
    const sale = await createSale(context, { salesUnitId: unit.id, priceTableId: table.id, soldPrice: "300000", parties: [{ customerId, role: "BUYER" }] });
    createdSaleIds.push(sale.id);
    await approveSale(context, { saleId: sale.id, contract: { number: `CV-B-${token}`, title: "Contrato — Cenário B" }, installments: [{ number: 1, nature: "DOWN_PAYMENT", dueDate: new Date("2026-10-10T00:00:00Z"), amount: "300000" }] });

    const account = await prisma.receivableAccount.findFirstOrThrow({ where: { saleId: sale.id }, include: { installments: true } });
    const bankAccount = await prisma.bankAccount.findFirstOrThrow({ where: { organizationId: context.organizationId, companyId } });
    const { registerReceivablePayment } = await import("@/application/financial-ops/financial-service");
    await registerReceivablePayment(context, { installmentId: account.installments[0].id, bankAccountId: bankAccount.id, amount: "300000", method: "PIX", receivedAt: new Date("2026-10-10T00:00:00Z") });
    await registerReceivablePayment(context, { installmentId: account.installments[0].id, bankAccountId: bankAccount.id, amount: "300000", method: "PIX", receivedAt: new Date("2026-10-10T00:00:00Z") });

    const workspace = await getSalesWorkspace(context, projectId);
    const saleView = workspace.sales.find((item) => item.id === sale.id)!;
    expect(saleView.received).toBe(300000);
    expect(saleView.received).not.toBe(600000);
  });

  it("Cenário C: renegociação preserva o plano anterior, cancela parcelas não pagas e gera o novo plano corretamente", async () => {
    const { unit, table } = await makeUnit(context, projectId, companyId, `UN-C-${token}`, "400000");
    const sale = await createSale(context, { salesUnitId: unit.id, priceTableId: table.id, soldPrice: "400000", parties: [{ customerId, role: "BUYER" }] });
    createdSaleIds.push(sale.id);
    await approveSale(context, { saleId: sale.id, contract: { number: `CV-C-${token}`, title: "Contrato — Cenário C" }, installments: [{ number: 1, nature: "MONTHLY", dueDate: new Date("2026-10-05T00:00:00Z"), amount: "200000" }, { number: 2, nature: "MONTHLY", dueDate: new Date("2026-11-05T00:00:00Z"), amount: "200000" }] });

    const { renegotiateSalesPaymentPlan } = await import("./sales-service");
    const newPlan = await renegotiateSalesPaymentPlan(context, { saleId: sale.id, reason: "Cliente solicitou novo prazo", installments: [{ number: 1, nature: "MONTHLY", dueDate: new Date("2026-12-05T00:00:00Z"), amount: "150000" }, { number: 2, nature: "MONTHLY", dueDate: new Date("2027-01-05T00:00:00Z"), amount: "250000" }] });
    expect(newPlan.version).toBe(2);

    const oldPlan = await prisma.salesPaymentPlan.findFirstOrThrow({ where: { saleId: sale.id, version: 1 } });
    expect(oldPlan.status).toBe("SUPERSEDED");
    const oldInstallments = await prisma.salesPaymentPlanInstallment.findMany({ where: { planId: oldPlan.id } });
    expect(oldInstallments.every((item) => item.cancelledAt !== null)).toBe(true);

    const newReceivableCount = await prisma.receivableAccount.count({ where: { saleId: sale.id } });
    expect(newReceivableCount).toBe(4); // 2 originais (canceladas, não apagadas) + 2 novas
    const activeReceivables = await prisma.receivableInstallment.count({ where: { receivableAccount: { saleId: sale.id }, status: { notIn: ["CANCELADA"] } } });
    expect(activeReceivables).toBe(2);
  });

  it("Cenário D: distrato preserva a venda como histórica, libera a unidade e trata efeitos financeiros de forma controlada", async () => {
    const { unit, table } = await makeUnit(context, projectId, companyId, `UN-D-${token}`, "200000");
    const sale = await createSale(context, { salesUnitId: unit.id, priceTableId: table.id, soldPrice: "200000", parties: [{ customerId, role: "BUYER" }] });
    createdSaleIds.push(sale.id);
    await approveSale(context, { saleId: sale.id, contract: { number: `CV-D-${token}`, title: "Contrato — Cenário D" }, installments: [{ number: 1, nature: "DOWN_PAYMENT", dueDate: new Date("2026-10-01T00:00:00Z"), amount: "50000" }, { number: 2, nature: "BALANCE", dueDate: new Date("2026-12-01T00:00:00Z"), amount: "150000" }] });

    const account1 = await prisma.receivableAccount.findFirstOrThrow({ where: { saleId: sale.id, description: { contains: "1 (DOWN_PAYMENT)" } }, include: { installments: true } });
    const bankAccount = await prisma.bankAccount.findFirstOrThrow({ where: { organizationId: context.organizationId, companyId } });
    const { registerReceivablePayment } = await import("@/application/financial-ops/financial-service");
    await registerReceivablePayment(context, { installmentId: account1.installments[0].id, bankAccountId: bankAccount.id, amount: "50000", method: "PIX", receivedAt: new Date("2026-10-01T00:00:00Z") });

    const rescinded = await rescindSale(context, { saleId: sale.id, reason: "Distrato solicitado pelo comprador", retentionRate: "0.2" });
    expect(rescinded.status).toBe("CANCELLED");
    const unitAfter = await prisma.salesUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(unitAfter.status).toBe("DISTRATADA");

    // Venda original preservada como histórica, nunca apagada.
    const stillExists = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(stillExists.status).toBe("CANCELLED");

    const refundPayable = await prisma.payableAccount.findFirstOrThrow({ where: { notes: { contains: `SALE_RESCISSION:${sale.id}` } } });
    expect(Number(refundPayable.originalAmount)).toBe(40000); // R$50.000 pago - 20% retido

    const unpaidInstallment = await prisma.receivableInstallment.findFirstOrThrow({ where: { receivableAccount: { saleId: sale.id }, dueDate: new Date("2026-12-01T00:00:00Z") } });
    expect(unpaidInstallment.status).toBe("CANCELADA");
  });

  it("Cenário E: comissão gera obrigação a pagar exatamente uma vez, mesmo se aprovada novamente por engano", async () => {
    const { unit, table } = await makeUnit(context, projectId, companyId, `UN-E-${token}`, "600000");
    const sale = await createSale(context, { salesUnitId: unit.id, priceTableId: table.id, soldPrice: "600000", brokerId, parties: [{ customerId, role: "BUYER" }] });
    createdSaleIds.push(sale.id);
    await approveSale(context, { saleId: sale.id, contract: { number: `CV-E-${token}`, title: "Contrato — Cenário E" }, installments: [{ number: 1, nature: "DOWN_PAYMENT", dueDate: new Date("2026-10-01T00:00:00Z"), amount: "600000" }] });

    const commission = await createSalesCommission(context, { saleId: sale.id, brokerId, basis: "SOLD_PRICE", percentage: "0.05", triggerEvent: "SIGNATURE" });
    expect(Number(commission.amount)).toBe(30000);
    const approved = await approveSalesCommission(context, commission.id);
    expect(approved.status).toBe("PAYABLE_GENERATED");
    await expect(approveSalesCommission(context, commission.id)).rejects.toThrow("não encontrada");

    const payableCount = await prisma.payableAccount.count({ where: { notes: { contains: `SALE_COMMISSION:${commission.id}` } } });
    expect(payableCount).toBe(1);
  });

  it("Concorrência: duas tentativas simultâneas de vender a mesma unidade — apenas uma prevalece", async () => {
    const { unit, table } = await makeUnit(context, projectId, companyId, `UN-CONC-${token}`, "350000");
    const [saleOne, saleTwo] = await Promise.all([
      createSale(context, { salesUnitId: unit.id, priceTableId: table.id, soldPrice: "350000", parties: [{ customerId, role: "BUYER" }] }),
      createSale(context, { salesUnitId: unit.id, priceTableId: table.id, soldPrice: "350000", parties: [{ customerId, role: "BUYER" }] }),
    ]);
    createdSaleIds.push(saleOne.id, saleTwo.id);
    const installments = [{ number: 1, nature: "DOWN_PAYMENT" as const, dueDate: new Date("2026-10-01T00:00:00Z"), amount: "350000" }];
    const results = await Promise.allSettled([
      approveSale(context, { saleId: saleOne.id, contract: { number: `CV-CONC-1-${token}`, title: "Concorrência A" }, installments }),
      approveSale(context, { saleId: saleTwo.id, contract: { number: `CV-CONC-2-${token}`, title: "Concorrência B" }, installments }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const unitAfter = await prisma.salesUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(unitAfter.status).toBe("VENDIDA");
  });

  it("Prova zero: unidade nunca fica simultaneamente DISPONÍVEL e VENDIDA; bloqueio/desbloqueio preserva histórico", async () => {
    const { unit } = await makeUnit(context, projectId, companyId, `UN-PZ-${token}`, "250000");
    const block = await blockSalesUnit(context, { salesUnitId: unit.id, origin: "COMERCIAL", responsibleId: context.userId, reason: "Teste de bloqueio" });
    const blocked = await prisma.salesUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(blocked.status).toBe("BLOQUEADA");
    await unblockSalesUnit(context, block.id);
    const unblocked = await prisma.salesUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(unblocked.status).toBe("DISPONIVEL");
    const blockRecord = await prisma.salesUnitBlock.findUniqueOrThrow({ where: { id: block.id } });
    expect(blockRecord.endedAt).not.toBeNull();
  });

  it("Proposta e reserva nunca vendem a unidade sozinhas", async () => {
    const { unit, table } = await makeUnit(context, projectId, companyId, `UN-PR-${token}`, "280000");
    await createSalesProposal(context, { salesUnitId: unit.id, customerId, priceTableId: table.id, proposedPrice: "270000", validUntil: new Date(Date.now() + 7 * 86_400_000) });
    const afterProposal = await prisma.salesUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(afterProposal.status).toBe("EM_PROPOSTA");
    expect(afterProposal.status).not.toBe("VENDIDA");
    const reservation = await createSalesReservation(context, { salesUnitId: unit.id, customerId, expiresAt: new Date(Date.now() + 86_400_000), responsibleId: context.userId });
    const afterReservation = await prisma.salesUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(afterReservation.status).toBe("EM_RESERVA");
    expect(reservation.status).toBe("ACTIVE");
  });
});
