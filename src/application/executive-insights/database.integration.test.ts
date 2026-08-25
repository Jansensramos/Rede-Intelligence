import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { getDecisionInsights, listSimulableSalesUnits, simulateDiscountForUnit, simulateHiringForProject } from "./executive-insights-service";

/**
 * Fase 9K.4A — testes de integração no PostgreSQL real (ordem de serviço §12: runway, stress de
 * vendas, contratação, desconto, caixa livre, ausência de evidência, RBAC, tenant, determinismo,
 * nenhuma mutação de domínio). Fixture isolada, própria organização — nunca escreve na organização
 * semeada (mesma convenção de `src/application/executive/database.integration.test.ts`, 9K.2).
 *
 * Deliberadamente NÃO cria `ViabilityStudy`/`StudyVersion` (modelo `SNAPSHOT`) nesta suíte — ponto
 * de equilíbrio já tem cobertura completa nos testes puros de `src/domain/executive-insights/
 * engine.test.ts`, e o modelo de versão de estudo tem gatilhos de imutabilidade que dificultam a
 * limpeza de fixtures de teste (dívida técnica pré-existente, fora do escopo desta fase).
 */
describe.skipIf(!process.env.DATABASE_URL).sequential("Perguntas executivas e simulações (9K.4A) no PostgreSQL real", () => {
  const referenceDate = new Date("2026-08-25T12:00:00.000Z");
  let organizationId: string;
  let foreignOrganizationId: string;
  let userId: string;
  let companyId: string;
  let projectId: string;
  let bankAccountId: string;
  let salesUnitId: string;

  const ownerAuth = () => ({ organizationId, role: "OWNER" as const });
  const viewerAuth = () => ({ organizationId, role: "VIEWER" as const });

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const organization = await prisma.organization.create({ data: { name: `9K.4A insights ${suffix}`, slug: `9k4a-insights-${suffix}` } });
    organizationId = organization.id;
    const user = await prisma.user.create({ data: { name: "9K.4A fixture", email: `9k4a-insights-${suffix}@test.local`, passwordHash: "integration-test" } });
    userId = user.id;

    const company = await prisma.company.create({ data: { organizationId, name: `Insights SPE ${suffix}`, legalName: `Insights SPE ${suffix} Ltda`, type: "SPE", createdById: userId } });
    companyId = company.id;
    const project = await prisma.project.create({ data: { organizationId, companyId, name: `Projeto Insights ${suffix}`, city: "São Paulo", state: "SP", createdById: userId, updatedById: userId } });
    projectId = project.id;

    const bankAccount = await prisma.bankAccount.create({ data: { organizationId, companyId, agency: "0001", accountNumber: `${suffix}-1`, holderName: company.name, openingBalance: "200000.00", restriction: "FREE", createdById: userId } });
    bankAccountId = bankAccount.id;

    const recentDate = new Date(referenceDate.getTime() - 20 * 86_400_000);

    // Venda aprovada real (pergunta 1 — quanto sobra das vendas) + unidade/tabela de preço (pergunta 5 — simulação de desconto).
    const salesUnit = await prisma.salesUnit.create({ data: { organizationId, projectId, companyId, code: `U-${suffix}`, typology: "2 dorms", privateAreaM2: "60.00", status: "VENDIDA", createdById: userId } });
    salesUnitId = salesUnit.id;
    const priceTable = await prisma.salesPriceTable.create({ data: { organizationId, projectId, companyId, version: 1, validFrom: new Date(referenceDate.getTime() - 90 * 86_400_000), responsibleId: userId, status: "ACTIVE", createdById: userId } });
    await prisma.salesPriceTableLine.create({ data: { priceTableId: priceTable.id, salesUnitId, listPrice: "520000.00", minimumAuthorizedPrice: "480000.00" } });
    const sale = await prisma.sale.create({
      data: { organizationId, projectId, companyId, salesUnitId, priceTableId: priceTable.id, soldPrice: "500000.00", discountAmount: "20000.00", incentiveAmount: "0", commercialConditionSnapshot: {}, status: "APPROVED", approvedAt: recentDate, createdById: userId },
    });

    // Recebível ligado à venda, com pagamento realizado na janela histórica (entrada média mensal ligada a venda — pergunta 2).
    const receivableAccount = await prisma.receivableAccount.create({ data: { organizationId, projectId, companyId, saleId: sale.id, description: "Parcela de venda — fixture 9K.4A", competenceMonth: recentDate, originalAmount: "50000.00", createdById: userId } });
    const receivableInstallment = await prisma.receivableInstallment.create({ data: { receivableAccountId: receivableAccount.id, number: 1, dueDate: recentDate, originalAmount: "50000.00", currentAmount: "50000.00", status: "RECEBIDA" } });
    await prisma.receivablePayment.create({ data: { installmentId: receivableInstallment.id, bankAccountId, amount: "50000.00", method: "PIX", receivedAt: recentDate, status: "CLEARED", createdById: userId } });

    // Custo realmente pago (pergunta 1 — custos desembolsados; pergunta 2 — saída média mensal real).
    // Duas contas pagas na janela (30k + 90k = 120k) superam a entrada de vendas (50k) de propósito
    // — o caixa desta fixture está de fato sendo consumido, para exercitar o cenário "OK" da
    // pergunta 2 (runway com número de meses), não só o caso "não está queimando".
    const payableAccount = await prisma.payableAccount.create({ data: { organizationId, projectId, companyId, description: "Fornecedor de obra — fixture 9K.4A", competenceMonth: recentDate, originalAmount: "30000.00", createdById: userId } });
    const payableInstallment = await prisma.payableInstallment.create({ data: { payableAccountId: payableAccount.id, number: 1, dueDate: recentDate, originalAmount: "30000.00", currentAmount: "30000.00", status: "PAGA" } });
    await prisma.payablePayment.create({ data: { installmentId: payableInstallment.id, bankAccountId, amount: "30000.00", method: "TRANSFER", paidAt: recentDate, status: "CLEARED", createdById: userId } });
    const payableAccount2 = await prisma.payableAccount.create({ data: { organizationId, projectId, companyId, description: "Empreiteira — fixture 9K.4A", competenceMonth: recentDate, originalAmount: "90000.00", createdById: userId } });
    const payableInstallment2 = await prisma.payableInstallment.create({ data: { payableAccountId: payableAccount2.id, number: 1, dueDate: recentDate, originalAmount: "90000.00", currentAmount: "90000.00", status: "PAGA" } });
    await prisma.payablePayment.create({ data: { installmentId: payableInstallment2.id, bankAccountId, amount: "90000.00", method: "TRANSFER", paidAt: recentDate, status: "CLEARED", createdById: userId } });

    // Compromisso em aberto vencendo em 10 dias (reserva mínima — perguntas 4 e 6).
    const upcomingPayableAccount = await prisma.payableAccount.create({ data: { organizationId, projectId, companyId, description: "Conta a pagar futura — fixture 9K.4A", competenceMonth: referenceDate, originalAmount: "15000.00", createdById: userId } });
    await prisma.payableInstallment.create({ data: { payableAccountId: upcomingPayableAccount.id, number: 1, dueDate: new Date(referenceDate.getTime() + 10 * 86_400_000), originalAmount: "15000.00", currentAmount: "15000.00", status: "APROVADA" } });

    // Organização estranha — nunca deve aparecer nos agregados desta organização.
    const foreignOrganization = await prisma.organization.create({ data: { name: `9K.4A insights outra org ${suffix}`, slug: `9k4a-insights-outra-${suffix}` } });
    foreignOrganizationId = foreignOrganization.id;
    const foreignCompany = await prisma.company.create({ data: { organizationId: foreignOrganizationId, name: `Outra SPE ${suffix}`, legalName: `Outra SPE ${suffix} Ltda`, type: "SPE", createdById: userId } });
    const foreignProject = await prisma.project.create({ data: { organizationId: foreignOrganizationId, companyId: foreignCompany.id, name: `Projeto outra org ${suffix}`, city: "Curitiba", state: "PR", createdById: userId, updatedById: userId } });
    const foreignUnit = await prisma.salesUnit.create({ data: { organizationId: foreignOrganizationId, projectId: foreignProject.id, companyId: foreignCompany.id, code: `FOREIGN-${suffix}`, typology: "3 dorms", privateAreaM2: "90.00", status: "VENDIDA", createdById: userId } });
    const foreignPriceTable = await prisma.salesPriceTable.create({ data: { organizationId: foreignOrganizationId, projectId: foreignProject.id, companyId: foreignCompany.id, version: 1, validFrom: new Date(referenceDate.getTime() - 90 * 86_400_000), responsibleId: userId, status: "ACTIVE", createdById: userId } });
    await prisma.sale.create({ data: { organizationId: foreignOrganizationId, projectId: foreignProject.id, companyId: foreignCompany.id, salesUnitId: foreignUnit.id, priceTableId: foreignPriceTable.id, soldPrice: "9999999.00", commercialConditionSnapshot: {}, status: "APPROVED", approvedAt: recentDate, createdById: userId } });
  });

  /**
   * `Project.organizationId` (e vários outros FKs) usam `onDelete: Restrict` — um
   * `prisma.organization.delete()` direto SEMPRE falha quando a organização tem projeto/conta/venda
   * vinculados, mesmo sem nenhum `ViabilityStudy`/`SNAPSHOT` envolvido (achado desta sprint: o
   * `.catch(() => {})` do padrão usado em outras suítes de integração do projeto mascara essa falha
   * silenciosamente, deixando as organizações de fixture órfãs no Postgres compartilhado). Esta
   * suíte apaga explicitamente, na ordem de dependência, antes de apagar a organização.
   */
  async function cleanupOrganization(id: string) {
    await prisma.receivablePayment.deleteMany({ where: { installment: { receivableAccount: { organizationId: id } } } });
    await prisma.receivableInstallment.deleteMany({ where: { receivableAccount: { organizationId: id } } });
    await prisma.receivableAccount.deleteMany({ where: { organizationId: id } });
    await prisma.payablePayment.deleteMany({ where: { installment: { payableAccount: { organizationId: id } } } });
    await prisma.payableInstallment.deleteMany({ where: { payableAccount: { organizationId: id } } });
    await prisma.payableAccount.deleteMany({ where: { organizationId: id } });
    await prisma.salesCommission.deleteMany({ where: { sale: { organizationId: id } } });
    await prisma.sale.deleteMany({ where: { organizationId: id } });
    await prisma.salesPriceTableLine.deleteMany({ where: { priceTable: { organizationId: id } } });
    await prisma.salesPriceTable.deleteMany({ where: { organizationId: id } });
    await prisma.salesUnit.deleteMany({ where: { organizationId: id } });
    await prisma.bankTransaction.deleteMany({ where: { organizationId: id } });
    await prisma.bankAccount.deleteMany({ where: { organizationId: id } });
    await prisma.project.deleteMany({ where: { organizationId: id } });
    await prisma.company.deleteMany({ where: { organizationId: id } });
    await prisma.organization.delete({ where: { id } }).catch(() => {});
  }

  afterAll(async () => {
    await cleanupOrganization(organizationId);
    await cleanupOrganization(foreignOrganizationId);
    await prisma.$disconnect();
  });

  it("pergunta 1 (contribuição real das vendas): usa dados reais da venda, nunca soma a de outra organização", async () => {
    const insights = await getDecisionInsights(ownerAuth(), { id: projectId, companyId }, [{ id: projectId }], referenceDate);
    expect(insights.salesContribution?.status).toBe("OK");
    expect(insights.salesContribution?.data?.grossVgv).toBe(500_000);
    expect(insights.salesContribution?.data?.discountsGranted).toBe(20_000);
    expect(insights.salesContribution?.data?.costsIncurredToDate).toBe(120_000);
  });

  it("pergunta 2 (runway): calcula os 4 cenários com histórico real de caixa; runway cai monotonicamente com o stress de vendas", async () => {
    const insights = await getDecisionInsights(ownerAuth(), { id: projectId, companyId }, [{ id: projectId }], referenceDate);
    // Saída realizada (120k) supera a entrada realizada (50k) no trimestre — o caixa está de fato
    // sendo consumido, então a resposta é OK com um número de meses real, não NAO_APLICAVEL.
    expect(insights.runway?.status).toBe("OK");
    const scenarios = insights.runway!.data!;
    expect(scenarios.map((s) => s.scenario)).toEqual(["ATUAL", "QUEDA_20", "QUEDA_40", "SEM_NOVAS_VENDAS"]);
    const [atual, queda20, queda40, semVendas] = scenarios;
    expect(atual.monthlyOutflow).toBeGreaterThan(atual.monthlyInflow);
    expect(atual.monthsOfRunway).not.toBeNull();
    const monthsOrHorizon = (s: (typeof scenarios)[number]) => s.monthsOfRunway ?? Number.POSITIVE_INFINITY;
    expect(monthsOrHorizon(atual)).toBeGreaterThanOrEqual(monthsOrHorizon(queda20));
    expect(monthsOrHorizon(queda20)).toBeGreaterThanOrEqual(monthsOrHorizon(queda40));
    expect(monthsOrHorizon(queda40)).toBeGreaterThanOrEqual(monthsOrHorizon(semVendas));
  });

  it("pergunta 6 (caixa livre para investir): nunca usa só o saldo bancário — desconta reserva mínima", async () => {
    const insights = await getDecisionInsights(ownerAuth(), { id: projectId, companyId }, [{ id: projectId }], referenceDate);
    expect(insights.freeCashToInvest?.status).toBe("OK");
    expect(insights.freeCashToInvest!.data!.reserveMinimum).toBeGreaterThanOrEqual(15_000);
    expect(insights.freeCashToInvest!.data!.freeToInvest).toBeLessThan(insights.freeCashToInvest!.data!.cashPosition);
  });

  it("pergunta 3 (equilíbrio do empreendimento): SEM_EVIDENCIA quando não há estudo de viabilidade ativo — nunca um número inventado", async () => {
    const insights = await getDecisionInsights(ownerAuth(), { id: projectId, companyId }, [{ id: projectId }], referenceDate);
    expect(insights.breakEvenProject?.status).toBe("SEM_EVIDENCIA");
    expect(insights.breakEvenProject?.data).toBeNull();
  });

  it("pergunta 4 (simulação de contratação): nunca cria pessoa/folha, e runway piora com o custo simulado", async () => {
    const before = await prisma.employmentRelationship.count({ where: { organizationId } });
    const answer = await simulateHiringForProject(ownerAuth(), projectId, 25_000, referenceDate);
    const after = await prisma.employmentRelationship.count({ where: { organizationId } });
    expect(before).toBe(after);
    expect(answer.status).toBe("OK");
    const beforeMonths = answer.data!.before.monthsOfRunway ?? Number.POSITIVE_INFINITY;
    const afterMonths = answer.data!.after.monthsOfRunway ?? Number.POSITIVE_INFINITY;
    expect(afterMonths).toBeLessThanOrEqual(beforeMonths);
  });

  it("pergunta 5 (simulação de desconto): nunca altera a venda/proposta real", async () => {
    const units = await listSimulableSalesUnits(ownerAuth(), projectId);
    const saleCountBefore = await prisma.sale.count({ where: { organizationId } });
    const answer = await simulateDiscountForUnit(ownerAuth(), projectId, salesUnitId, 470_000, referenceDate);
    const saleCountAfter = await prisma.sale.count({ where: { organizationId } });
    expect(saleCountBefore).toBe(saleCountAfter);
    expect(units.some((unit) => unit.id === salesUnitId)).toBe(false); // a unidade já está VENDIDA — não entra na lista de unidades simuláveis (DISPONIVEL/RESERVADA/EM_PROPOSTA)
    expect(answer.status).toBe("OK");
    expect(answer.data!.discountAmount).toBeCloseTo(50_000, 2);
  });

  it("RBAC (ordem de serviço §10): VIEWER (sem Financeiro/Comercial) não recebe runway, caixa, contribuição de vendas nem simulações", async () => {
    const insights = await getDecisionInsights(viewerAuth(), { id: projectId, companyId }, [{ id: projectId }], referenceDate);
    expect(insights.salesContribution).toBeUndefined();
    expect(insights.runway).toBeUndefined();
    expect(insights.breakEvenProject).toBeUndefined();
    expect(insights.freeCashToInvest).toBeUndefined();
    expect(insights.hiringSimulationAvailable).toBe(false);
    expect(insights.discountSimulationAvailable).toBe(false);

    await expect(simulateHiringForProject(viewerAuth(), projectId, 10_000, referenceDate)).rejects.toThrow();
    await expect(simulateDiscountForUnit(viewerAuth(), projectId, salesUnitId, 470_000, referenceDate)).rejects.toThrow();
    expect(await listSimulableSalesUnits(viewerAuth(), projectId)).toEqual([]);
  });

  it("RBAC: OWNER (autorizado) continua recebendo todas as respostas", async () => {
    const insights = await getDecisionInsights(ownerAuth(), { id: projectId, companyId }, [{ id: projectId }], referenceDate);
    expect(insights.salesContribution).toBeDefined();
    expect(insights.runway).toBeDefined();
    expect(insights.freeCashToInvest).toBeDefined();
    expect(insights.hiringSimulationAvailable).toBe(true);
    expect(insights.discountSimulationAvailable).toBe(true);
  });

  it("isolamento multi-tenant: leitura de outra organização é rejeitada", async () => {
    await expect(getDecisionInsights({ organizationId: foreignOrganizationId, role: "OWNER" }, { id: projectId, companyId }, [{ id: projectId }], referenceDate)).rejects.toThrow();
  });

  it("determinismo: duas leituras com a mesma data de referência produzem exatamente o mesmo resultado", async () => {
    const first = await getDecisionInsights(ownerAuth(), { id: projectId, companyId }, [{ id: projectId }], referenceDate);
    const second = await getDecisionInsights(ownerAuth(), { id: projectId, companyId }, [{ id: projectId }], referenceDate);
    expect(first).toEqual(second);
  });

  it("nenhuma mutação de domínio: ler os insights e simular não alteram nenhuma conta bancária, venda ou parcela existente", async () => {
    const [salesBefore, payablesBefore, receivablesBefore, transactionsBefore] = await Promise.all([
      prisma.sale.count({ where: { organizationId } }),
      prisma.payableInstallment.count({ where: { payableAccount: { organizationId } } }),
      prisma.receivableInstallment.count({ where: { receivableAccount: { organizationId } } }),
      prisma.bankTransaction.count({ where: { organizationId } }),
    ]);

    await getDecisionInsights(ownerAuth(), { id: projectId, companyId }, [{ id: projectId }], referenceDate);
    await simulateHiringForProject(ownerAuth(), projectId, 12_000, referenceDate);
    await simulateDiscountForUnit(ownerAuth(), projectId, salesUnitId, 480_000, referenceDate);

    const [salesAfter, payablesAfter, receivablesAfter, transactionsAfter] = await Promise.all([
      prisma.sale.count({ where: { organizationId } }),
      prisma.payableInstallment.count({ where: { payableAccount: { organizationId } } }),
      prisma.receivableInstallment.count({ where: { receivableAccount: { organizationId } } }),
      prisma.bankTransaction.count({ where: { organizationId } }),
    ]);

    expect(salesAfter).toBe(salesBefore);
    expect(payablesAfter).toBe(payablesBefore);
    expect(receivablesAfter).toBe(receivablesBefore);
    expect(transactionsAfter).toBe(transactionsBefore);
  });
});
