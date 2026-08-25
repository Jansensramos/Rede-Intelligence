import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { computeWorkspaceCapabilities } from "@/domain/workspace/capabilities";
import type { OperationalContext } from "@/application/workspace/operational-context";
import { getExecutiveProjectOverview, getExecutivePortfolioOverview, type ExecutiveProjectRef } from "./executive-service";

/**
 * Fase 9K.2, ordem de serviço §22 (testes de isolamento multi-tenant, contexto de projeto, carteira
 * corporativa, severidade/materialidade, drill-down, freshness, idempotência e ausência de dados).
 * Fixture isolada, própria organização — nunca escreve na organização semeada
 * `rede-nucleo-de-negocios` (mesma convenção de `src/application/workspace/context-options.database.
 * integration.test.ts`, 9K.1).
 */
describe.skipIf(!process.env.DATABASE_URL).sequential("Gestão Executiva (9K.2) no PostgreSQL real", () => {
  const referenceDate = new Date("2026-08-25T12:00:00.000Z");
  let organizationId: string;
  let foreignOrganizationId: string;
  let userId: string;
  let groupId: string;
  let companyAId: string;
  let companyBId: string;
  let project1: ExecutiveProjectRef;
  let project2: ExecutiveProjectRef;
  let foreignProjectId: string;
  let obligationCode: string;
  let context: OperationalContext;
  let oldObligationUpdatedAt: Date;
  const ownerAuth = () => ({ organizationId, role: "OWNER" as const });
  const viewerAuth = () => ({ organizationId, role: "VIEWER" as const });

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    obligationCode = `EXEC-OBL-${suffix}`;

    const organization = await prisma.organization.create({ data: { name: `9K.2 executivo ${suffix}`, slug: `9k2-exec-${suffix}` } });
    organizationId = organization.id;
    const user = await prisma.user.create({ data: { name: "9K.2 fixture", email: `9k2-exec-${suffix}@test.local`, passwordHash: "integration-test" } });
    userId = user.id;

    const group = await prisma.economicGroup.create({ data: { organizationId, name: "Grupo Executivo Teste", createdById: userId } });
    groupId = group.id;
    const companyA = await prisma.company.create({ data: { organizationId, economicGroupId: groupId, name: `Exec SPE A ${suffix}`, legalName: `Exec SPE A ${suffix} Ltda`, type: "SPE", createdById: userId } });
    const companyB = await prisma.company.create({ data: { organizationId, economicGroupId: groupId, name: `Exec SPE B ${suffix}`, legalName: `Exec SPE B ${suffix} Ltda`, type: "SPE", createdById: userId } });
    companyAId = companyA.id;
    companyBId = companyB.id;

    const p1 = await prisma.project.create({ data: { organizationId, companyId: companyAId, name: `Projeto Exec 1 ${suffix}`, city: "São Paulo", state: "SP", createdById: userId, updatedById: userId } });
    const p2 = await prisma.project.create({ data: { organizationId, companyId: companyBId, name: `Projeto Exec 2 ${suffix}`, city: "Curitiba", state: "PR", createdById: userId, updatedById: userId } });
    project1 = { id: p1.id, name: p1.name, city: p1.city, state: p1.state, companyId: companyAId, companyName: companyA.name, economicGroupId: groupId, economicGroupName: group.name };
    project2 = { id: p2.id, name: p2.name, city: p2.city, state: p2.state, companyId: companyBId, companyName: companyB.name, economicGroupId: groupId, economicGroupName: group.name };

    // Uma única obrigação jurídica vencida, só no Projeto 1 — a base de todos os testes de
    // isolamento e de "sem duplicação" abaixo.
    const obligation = await prisma.legalObligation.create({
      data: {
        organizationId,
        projectId: project1.id,
        code: obligationCode,
        type: "TAXA",
        title: "Taxa de habite-se",
        description: "Fixture de teste 9K.2",
        criticality: "HIGH",
        status: "ACTIVE",
        dueAt: new Date(referenceDate.getTime() - 10 * 86_400_000),
        amount: "42000.00",
        provenance: "MANUAL",
        sourceRef: "fixture-9k2",
        responsibleId: userId,
        createdById: userId,
        updatedById: userId,
      },
    });

    // Gate 3 do fechamento da 9K.2 ("freshness real"): backdatar `updated_at` explicitamente para
    // um valor bem no passado, bem distante de `referenceDate` — prova que a freshness do domínio
    // Jurídico usa o timestamp real da fonte, nunca o instante da leitura (`@updatedAt` do Prisma
    // não aceita valor arbitrário via `.update()`, por isso o SQL bruto só nesta linha de fixture).
    await prisma.$executeRaw`UPDATE legal_obligations SET updated_at = ${new Date("2026-01-05T09:00:00.000Z")} WHERE id = ${obligation.id}`;
    // Lê de volta o valor real persistido (em vez de assumir que o driver gravou exatamente o que
    // foi passado) — o `$executeRaw` acima pode sofrer conversão de fuso horário na sessão do
    // Postgres; o teste de freshness compara contra o que está de fato no banco.
    oldObligationUpdatedAt = (await prisma.legalObligation.findUniqueOrThrow({ where: { id: obligation.id }, select: { updatedAt: true } })).updatedAt;

    // Venda + recebível vencido ligado à venda (Projeto 1) — prova que Comercial/Financeiro não
    // duplicam o mesmo recebível como duas exceções (ordem de serviço §4/§23).
    const salesUnit = await prisma.salesUnit.create({ data: { organizationId, projectId: project1.id, companyId: companyAId, code: `U-${suffix}`, typology: "2 dorms", privateAreaM2: "65.00", status: "VENDIDA", createdById: userId } });
    const priceTable = await prisma.salesPriceTable.create({ data: { organizationId, projectId: project1.id, companyId: companyAId, version: 1, validFrom: new Date(referenceDate.getTime() - 60 * 86_400_000), responsibleId: userId, status: "ACTIVE", createdById: userId } });
    const sale = await prisma.sale.create({ data: { organizationId, projectId: project1.id, companyId: companyAId, salesUnitId: salesUnit.id, priceTableId: priceTable.id, soldPrice: "500000.00", commercialConditionSnapshot: {}, status: "APPROVED", approvedAt: referenceDate, createdById: userId } });
    const receivableAccount = await prisma.receivableAccount.create({ data: { organizationId, projectId: project1.id, companyId: companyAId, saleId: sale.id, description: "Parcela de venda — fixture 9K.2", competenceMonth: new Date(referenceDate.getTime() - 40 * 86_400_000), originalAmount: "20000.00", createdById: userId } });
    await prisma.receivableInstallment.create({ data: { receivableAccountId: receivableAccount.id, number: 1, dueDate: new Date(referenceDate.getTime() - 15 * 86_400_000), originalAmount: "20000.00", currentAmount: "20000.00", status: "EMITIDA" } });

    const foreignOrganization = await prisma.organization.create({ data: { name: `9K.2 executivo outra org ${suffix}`, slug: `9k2-exec-outra-${suffix}` } });
    foreignOrganizationId = foreignOrganization.id;
    const foreignProject = await prisma.project.create({ data: { organizationId: foreignOrganizationId, name: `Projeto de outra organização ${suffix}`, city: "Belo Horizonte", state: "MG", createdById: userId, updatedById: userId } });
    foreignProjectId = foreignProject.id;
    await prisma.legalObligation.create({
      data: {
        organizationId: foreignOrganizationId,
        projectId: foreignProjectId,
        code: `${obligationCode}-FOREIGN`,
        type: "TAXA",
        title: "Obrigação de outra organização — nunca deve aparecer",
        description: "Fixture de teste 9K.2",
        criticality: "CRITICAL",
        status: "ACTIVE",
        dueAt: new Date(referenceDate.getTime() - 1 * 86_400_000),
        provenance: "MANUAL",
        sourceRef: "fixture-9k2-foreign",
        responsibleId: userId,
        createdById: userId,
        updatedById: userId,
      },
    });

    context = {
      organization: { id: organizationId, name: organization.name, slug: organization.slug },
      economicGroup: { id: groupId, name: group.name },
      company: { id: companyAId, name: companyA.name, type: "SPE" },
      project: { id: project1.id, name: project1.name, city: project1.city, state: project1.state },
      user: { id: userId, name: "9K.2 fixture", role: "OWNER" },
      capabilities: computeWorkspaceCapabilities("OWNER"),
    };
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => {});
    await prisma.organization.delete({ where: { id: foreignOrganizationId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("gera a exceção jurídica esperada, com drill-down, fonte e materialidade corretos", async () => {
    const overview = await getExecutiveProjectOverview(ownerAuth(), project1, referenceDate);
    const obligationException = overview.exceptions.find((item) => item.type === "obligation_due" && item.summary.includes(obligationCode));
    expect(obligationException).toBeDefined();
    expect(obligationException!.severity).toBe("CRITICO");
    expect(obligationException!.href).toBe("/juridico");
    expect(obligationException!.projectId).toBe(project1.id);
    expect(obligationException!.materialityValue).toBe(42000);
    expect(obligationException!.source).toBe("REDE");
  });

  it("nunca agrega dado de outro projeto (Projeto 2 não vê a obrigação do Projeto 1)", async () => {
    const overview = await getExecutiveProjectOverview(ownerAuth(), project2, referenceDate);
    expect(overview.exceptions.some((item) => item.summary.includes(obligationCode))).toBe(false);
    expect(overview.attentionSummary.CRITICO).toBe(0);
  });

  it("isolamento multi-tenant: exceção de outra organização nunca aparece, e todas as exceções carregam o organizationId correto", async () => {
    const overview = await getExecutiveProjectOverview(ownerAuth(), project1, referenceDate);
    expect(overview.exceptions.every((item) => item.organizationId === organizationId)).toBe(true);
    expect(overview.exceptions.some((item) => item.title.includes("outra organização"))).toBe(false);

    await expect(getExecutiveProjectOverview({ organizationId: foreignOrganizationId, role: "OWNER" }, project1, referenceDate)).rejects.toThrow();
  });

  it("recebível de venda vencido vira exceção Comercial, nunca também Financeiro (sem dupla contagem)", async () => {
    const overview = await getExecutiveProjectOverview(ownerAuth(), project1, referenceDate);
    const salesExceptions = overview.exceptions.filter((item) => item.domain === "sales" && item.type === "receivable_overdue");
    const financialReceivableExceptions = overview.exceptions.filter((item) => item.domain === "financial" && item.type === "receivable_due");
    expect(salesExceptions).toHaveLength(1);
    expect(financialReceivableExceptions).toHaveLength(0);
  });

  it("ausência de estudo/período contábil não vira zero — kpis.viability e kpis.accounting ficam null", async () => {
    const overview = await getExecutiveProjectOverview(ownerAuth(), project1, referenceDate);
    expect(overview.kpis.viability).toBeNull();
    expect(overview.kpis.accounting).toBeNull();
  });

  it("id de exceção é determinístico (idempotência): duas leituras produzem o mesmo id", async () => {
    const first = await getExecutiveProjectOverview(ownerAuth(), project1, referenceDate);
    const second = await getExecutiveProjectOverview(ownerAuth(), project1, referenceDate);
    const idsFirst = first.exceptions.map((item) => item.id).sort();
    const idsSecond = second.exceptions.map((item) => item.id).sort();
    expect(idsFirst).toEqual(idsSecond);
    expect(new Set(idsFirst).size).toBe(idsFirst.length);
  });

  it("freshness sempre presente, não vazia, e nunca 'Invalid Date'", async () => {
    const overview = await getExecutiveProjectOverview(ownerAuth(), project1, referenceDate);
    expect(overview.freshness.length).toBeGreaterThan(0);
    for (const entry of overview.freshness) {
      expect(entry.source).toBeTruthy();
      expect(["source_updated", "queried_now", "unavailable"]).toContain(entry.kind);
      const timestamp = entry.updatedAt ?? entry.queriedAt;
      if (timestamp) expect(new Date(timestamp).toString()).not.toBe("Invalid Date");
    }
  });

  it("gate 3 (freshness real): a exceção jurídica usa o updatedAt real e ANTIGO da obrigação, nunca o instante da leitura", async () => {
    // Confere que o backdate da fixture (beforeAll) realmente colocou o registro bem no passado
    // frente a `referenceDate` — se isto falhasse, o teste abaixo passaria por acidente.
    expect(referenceDate.getTime() - oldObligationUpdatedAt.getTime()).toBeGreaterThan(200 * 24 * 60 * 60 * 1000);

    const overview = await getExecutiveProjectOverview(ownerAuth(), project1, referenceDate);
    const legalFreshness = overview.freshness.find((entry) => entry.domain === "legal");
    expect(legalFreshness).toBeDefined();
    expect(legalFreshness!.kind).toBe("source_updated");
    expect(legalFreshness!.updatedAt).toBe(oldObligationUpdatedAt.toISOString());
    expect(legalFreshness!.updatedAt).not.toBe(referenceDate.toISOString());
  });

  it("gate 3: Viabilidade sem estudo ativo fica 'unavailable', nunca 'consultado agora' fingindo um cálculo que não existe", async () => {
    const overview = await getExecutiveProjectOverview(ownerAuth(), project1, referenceDate);
    const viabilityFreshness = overview.freshness.find((entry) => entry.domain === "viability");
    expect(viabilityFreshness!.kind).toBe("unavailable");
    expect(viabilityFreshness!.updatedAt).toBeUndefined();
    expect(viabilityFreshness!.queriedAt).toBeUndefined();
  });

  it("gate 2 (RBAC/capabilities): VIEWER não recebe Financeiro/Jurídico/Comercial/Suprimentos nem no payload do read model", async () => {
    const overview = await getExecutiveProjectOverview(viewerAuth(), project1, referenceDate);
    expect(overview.authorizedDomains).not.toContain("financial");
    expect(overview.authorizedDomains).not.toContain("legal");
    expect(overview.authorizedDomains).not.toContain("sales");
    expect(overview.authorizedDomains).not.toContain("procurement");

    expect(overview.kpis.financial).toBeUndefined();
    expect(overview.kpis.legal).toBeUndefined();
    expect(overview.kpis.commercial).toBeUndefined();
    expect(overview.kpis.procurement).toBeUndefined();
    expect("financial" in overview.kpis).toBe(false);
    expect("legal" in overview.kpis).toBe(false);
    expect("commercial" in overview.kpis).toBe(false);
    expect("procurement" in overview.kpis).toBe(false);

    // a obrigação jurídica de R$ 42.000 existe de fato (o OWNER a vê no teste acima) — o VIEWER
    // não pode vê-la em nenhuma exceção nem no "o que mudou".
    expect(overview.exceptions.some((item) => item.domain === "legal" || item.domain === "financial" || item.domain === "sales" || item.domain === "procurement")).toBe(false);
    expect(overview.whatChanged.some((item) => item.domain === "legal" || item.domain === "financial" || item.domain === "sales")).toBe(false);
    expect(overview.freshness.some((entry) => entry.domain === "legal" || entry.domain === "financial" || entry.domain === "sales" || entry.domain === "procurement")).toBe(false);
  });

  it("gate 2: OWNER (autorizado) continua recebendo todos os domínios — visão completa preservada", async () => {
    const overview = await getExecutiveProjectOverview(ownerAuth(), project1, referenceDate);
    expect(overview.authorizedDomains).toEqual(expect.arrayContaining(["financial", "legal", "sales", "procurement", "accounting", "integrations", "viability", "operations"]));
    expect(overview.kpis.financial).toBeDefined();
    expect(overview.kpis.legal).toBeDefined();
    expect(overview.kpis.commercial).toBeDefined();
    expect(overview.kpis.procurement).toBeDefined();
  });

  it("gate 2: isolamento tenant continua funcionando junto com o gate de capabilities (VIEWER de outra organização não vê nada desta)", async () => {
    await expect(getExecutiveProjectOverview({ organizationId: foreignOrganizationId, role: "VIEWER" }, project1, referenceDate)).rejects.toThrow();
  });

  it("carteira corporativa agrega os dois projetos do grupo, ordenados por severidade (o mais crítico primeiro), e nunca inclui projeto de outra organização", async () => {
    const portfolio = await getExecutivePortfolioOverview(ownerAuth(), context, referenceDate);
    expect(portfolio).not.toBeNull();
    expect(portfolio!.entries.map((entry) => entry.project.id).sort()).toEqual([project1.id, project2.id].sort());
    expect(portfolio!.entries.some((entry) => entry.project.id === foreignProjectId)).toBe(false);
    expect(portfolio!.entries[0].project.id).toBe(project1.id);
    expect(portfolio!.entries[0].topSeverity).toBe("CRITICO");
    expect(portfolio!.entries.find((entry) => entry.project.id === project2.id)!.topSeverity).toBe("NORMAL");
  });

  it("gate 2: carteira também respeita capabilities — VIEWER não recebe headline financeiro/comercial de nenhum projeto da carteira", async () => {
    const viewerContext: OperationalContext = { ...context, user: { ...context.user, role: "VIEWER" }, capabilities: computeWorkspaceCapabilities("VIEWER") };
    const portfolio = await getExecutivePortfolioOverview(viewerAuth(), viewerContext, referenceDate);
    expect(portfolio).not.toBeNull();
    expect(portfolio!.authorizedDomains).not.toContain("financial");
    expect(portfolio!.authorizedDomains).not.toContain("sales");
    for (const entry of portfolio!.entries) {
      expect(entry.headline.vgvVendido).toBeNull();
      expect(entry.headline.overdueFinancialAmount).toBeNull();
      expect(entry.headline.cashPosition).toBeNull();
    }
    // isolamento multi-tenant continua de pé mesmo com o gate de capabilities ativo.
    expect(portfolio!.entries.some((entry) => entry.project.id === foreignProjectId)).toBe(false);
  });
});
