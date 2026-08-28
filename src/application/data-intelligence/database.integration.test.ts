import { beforeAll, describe, expect, it } from "vitest";
import {
  decideAutoBudgetProposal,
  evaluateForecasts,
  getDataIntelligenceWorkspace,
  refreshAnalyticsFacts,
  refreshDataIntelligence,
  runCostBenchmark,
} from "./data-intelligence-service";
import { prisma } from "@/infrastructure/database/prisma";

describe("Inteligência de Dados 9I contra PostgreSQL real", () => {
  let context: { organizationId: string; userId: string; role: "OWNER" };
  let projectId: string;
  let economicItemId: string;

  beforeAll(async () => {
    const membership = await prisma.organizationMembership.findFirstOrThrow({ where: { organization: { slug: "rede-nucleo-de-negocios" }, user: { email: "admin@rede.local" } } });
    const project = await prisma.project.findUniqueOrThrow({ where: { organizationId_name: { organizationId: membership.organizationId, name: "START BUTANTÃ" } } });
    context = { organizationId: membership.organizationId, userId: membership.userId, role: "OWNER" };
    projectId = project.id;
    const officialLine = await prisma.budgetLineItem.findFirstOrThrow({ where: { budget: { projectId, organizationId: membership.organizationId, status: { in: ["OFFICIAL", "APPROVED"] } }, totalCost: { gt: 0 } }, orderBy: { totalCost: "desc" } });
    economicItemId = officialLine.economicItemId!;
    await refreshDataIntelligence(context, projectId);
  });

  it("constrói fatos analíticos a partir do orçamento, compras, contrato e medição reais, sem duplicar em replay", async () => {
    const before = await prisma.analyticsFact.count({ where: { organizationId: context.organizationId, projectId } });
    await refreshAnalyticsFacts(context, projectId);
    const after = await prisma.analyticsFact.count({ where: { organizationId: context.organizationId, projectId } });
    expect(after).toBe(before);
    expect(after).toBeGreaterThanOrEqual(4);
  });

  it("preço observado externo e preço realmente pago coexistem, sem um sobrescrever o outro", async () => {
    const facts = await prisma.analyticsFact.findMany({ where: { organizationId: context.organizationId, economicItemId, factType: { in: ["PROCUREMENT_PRICE", "PRICE_OBSERVATION"] } } });
    const observed = facts.find((f) => f.factType === "PRICE_OBSERVATION");
    const purchased = facts.find((f) => f.factType === "PROCUREMENT_PRICE");
    expect(observed).toBeDefined();
    expect(purchased).toBeDefined();
    expect(Number(observed!.amount)).not.toBe(Number(purchased!.amount));
  });

  it("benchmark com amostra pequena nunca produz confiança alta, mesmo com dispersão grande", async () => {
    const benchmark = await runCostBenchmark(context, { economicItemId, metricKey: "custo_unitario_item", projectId });
    expect(benchmark.sampleSize).toBeLessThanOrEqual(3);
    expect(benchmark.confidenceLevel).not.toBe("HIGH");
    expect(benchmark.members.length).toBeGreaterThan(0);
    expect(benchmark.members.some((m) => m.exclusionReason)).toBe(true); // linha do orçamento (m²) não é compatível com a linha de aço (t)
  });

  it("previsto x realizado do contrato reflete o aditivo aprovado sem reescrever o valor original", async () => {
    const evaluations = await evaluateForecasts(context, projectId);
    const withAmendment = evaluations.find((e) => Number(e.actualValue) !== Number(e.predictedValue));
    expect(withAmendment).toBeDefined();
    expect(Number(withAmendment!.absoluteError)).toBeGreaterThan(0);
    expect(withAmendment!.bias).toBe("PESSIMISTIC");
    expect(Number(withAmendment!.predictedValue)).toBeGreaterThan(0); // previsão original preservada, não zerada
  });

  it("aprovação de Orçamento Inteligente preserva a sugestão original ao lado da revisão humana", async () => {
    const workspace = await getDataIntelligenceWorkspace(context, projectId);
    const proposal = workspace.autoBudgetProposals.find((candidate) => candidate.status === "APPROVED" && candidate.lines.some((line) => line.reviewedUnitCost !== null));
    expect(proposal).toBeDefined();
    expect(proposal!.status).toBe("APPROVED");
    const line = proposal!.lines[0];
    expect(line.suggestedUnitCost).toBeGreaterThan(0);
    expect(line.reviewedUnitCost).not.toBeNull();
  });

  it("rejeita aprovação de proposta que não está em revisão", async () => {
    const proposal = await prisma.autoBudgetProposal.findFirstOrThrow({ where: { organizationId: context.organizationId, status: "APPROVED" } });
    await expect(decideAutoBudgetProposal(context, proposal.id, "APPROVED", {})).rejects.toThrow("não pode ser decidida");
  });

  it("isola organização e bloqueia quem não tem a capacidade", async () => {
    const isolated = await prisma.organization.findUniqueOrThrow({ where: { slug: "grupo-atlas" } });
    await expect(getDataIntelligenceWorkspace({ organizationId: isolated.id, userId: context.userId, role: "VIEWER" }, projectId)).rejects.toThrow("não encontrado");
    await expect(refreshAnalyticsFacts({ organizationId: context.organizationId, userId: context.userId, role: "VIEWER" }, projectId)).rejects.toThrow("não possui a capacidade");
  });

  it("workspace de leitura nunca mistura dados de outro tenant", async () => {
    const isolatedOrg = await prisma.organization.findUniqueOrThrow({ where: { slug: "grupo-atlas" } });
    const isolatedFacts = await prisma.analyticsFact.count({ where: { organizationId: isolatedOrg.id } });
    expect(isolatedFacts).toBe(0);
  });
});
