import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import {
  appendSmartBudgetLineReview,
  approveSmartBudgetProposal,
  createEngineeringOpinion,
  createEngineeringOpinionVersion,
  createSmartBudgetProposal,
  decideEngineeringOpinion,
  decideEngineeringOpinionItem,
  getEngineeringExecutiveSignals,
  getEngineeringWorkspace,
  rejectSmartBudgetProposal,
  submitEngineeringOpinion,
  submitSmartBudgetProposal,
  updateEngineeringOpinionDraft,
} from "./engineering-service";
import { buildEngineeringExceptions } from "@/domain/workspace/exception-builders";

describe("Engenharia, Parecer Técnico e Orçamento Inteligente 9M contra PostgreSQL real", () => {
  let context: { organizationId: string; userId: string; role: "OWNER" };
  let projectId: string;
  let baselineProjectId: string;
  let economicItemId: string;
  let priceObservationId: string;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  beforeAll(async () => {
    const membership = await prisma.organizationMembership.findFirstOrThrow({ where: { organization: { slug: "rede-nucleo-de-negocios" }, user: { email: "admin@rede.local" } } });
    const baselineProject = await prisma.project.findUniqueOrThrow({ where: { organizationId_name: { organizationId: membership.organizationId, name: "START BUTANTÃ" } } });
    context = { organizationId: membership.organizationId, userId: membership.userId, role: "OWNER" };
    baselineProjectId = baselineProject.id;
    const project = await prisma.project.create({ data: { organizationId: context.organizationId, name: `TESTE ENGENHARIA 9M ${suffix}`, city: "São Paulo", state: "SP", createdById: context.userId, updatedById: context.userId } });
    const item = await prisma.economicItem.create({ data: { organizationId: context.organizationId, projectId: project.id, code: `9M-${suffix}`, description: "Item econômico isolado 9M", category: "Engenharia", unit: "m2", createdById: context.userId } });
    projectId = project.id;
    economicItemId = item.id;
    const price = await prisma.externalPriceObservation.create({ data: { organizationId: context.organizationId, itemCode: item.code, itemDescription: `Preço dirigido 9M ${suffix}`, observedAt: new Date("2026-08-27"), unit: item.unit, price: 321.4567, currency: "BRL", region: "São Paulo/SP", supplierName: "Fornecedor de teste", sourceProvider: "Evidência dirigida 9M", evidenceChecksum: `evidence-${suffix}`, confidence: .95, mappedEconomicItemId: item.id, createdById: context.userId } });
    priceObservationId = price.id;
  });

  afterAll(async () => {
    if (projectId) {
      await prisma.project.update({
        where: { id: projectId },
        data: { status: "ARCHIVED", updatedById: context.userId },
      });
    }
  });

  it("cria Parecer Técnico idempotente, preserva severidade explícita e bloqueia VIEWER", async () => {
    const input = { projectId, code: `PT-${suffix}`, title: "Parecer dirigido de fundações", items: [{ topic: "FOUNDATIONS" as const, observedCondition: "Condição geotécnica a confirmar", risk: "Possível impacto de fundação", severity: "CRITICAL" as const, impact: { cost: "Potencial aumento", schedule: "Potencial impacto", method: "Fundação profunda", risk: "Alto", viability: "Reavaliar após sondagem" }, recommendation: "Validar sondagem e solução estrutural", sourceType: "USER_PROVIDED" as const, confidence: "MEDIUM" as const, referenceDate: new Date("2026-08-27"), evidence: [{ reference: `evidence-${suffix}`, label: "Relatório geotécnico", sourceType: "CONFIRMED" as const, confidence: "HIGH" as const }] }] };
    const first = await createEngineeringOpinion(context, input);
    const replay = await createEngineeringOpinion(context, input);
    expect(replay.id).toBe(first.id);
    expect(first.items[0]?.severity).toBe("CRITICAL");
    await expect(createEngineeringOpinion({ ...context, role: "VIEWER" }, input)).rejects.toThrow("não pode alterar");
  });

  it("valida itens e parecer, mantém VALIDATED imutável e cria nova versão sem sobrescrever", async () => {
    const opinion = await prisma.engineeringTechnicalOpinion.findFirstOrThrow({ where: { organizationId: context.organizationId, projectId, code: `PT-${suffix}` }, include: { items: true } });
    await submitEngineeringOpinion(context, opinion.id);
    await decideEngineeringOpinionItem(context, opinion.items[0]!.id, "VALIDATED");
    const validated = await decideEngineeringOpinion(context, opinion.id, "VALIDATED");
    expect(validated.status).toBe("VALIDATED");
    await expect(updateEngineeringOpinionDraft(context, opinion.id, { title: "Não pode" })).rejects.toThrow("rascunho");
    const next = await createEngineeringOpinionVersion(context, opinion.id);
    const replay = await createEngineeringOpinionVersion(context, opinion.id);
    expect(next.version).toBe(2);
    expect(replay.id).toBe(next.id);
    expect((await prisma.engineeringTechnicalOpinion.findUniqueOrThrow({ where: { id: opinion.id } })).status).toBe("SUPERSEDED");
  });

  it("calcula proposta com snapshot, registra revisão append-only e aprova exatamente um novo Budget 9A", async () => {
    const baselineBefore = await prisma.operationalBaseline.findFirst({ where: { organizationId: context.organizationId, projectId: baselineProjectId, status: "APPROVED" }, select: { id: true, checksum: true, updatedAt: true } });
    const budgetsBefore = await prisma.budget.count({ where: { organizationId: context.organizationId, projectId } });
    const input = { projectId, name: `Orçamento 9M ${suffix}`, rationale: "Teste dirigido determinístico", lines: [{ economicItemId, quantity: 12.5, quantityOrigin: "MANUAL" as const, priceObservationId, evidenceRequired: true }] };
    const proposal = await createSmartBudgetProposal(context, input);
    const replay = await createSmartBudgetProposal(context, input);
    expect(replay.id).toBe(proposal.id);
    expect(proposal.lines[0]?.sourceSnapshot).toBeTruthy();
    expect(proposal.lines[0]?.evidenceStatus).toBe("VALIDATED_PRICE");
    expect(Number(proposal.lines[0]?.suggestedTotalCost)).toBe(4018.21);
    await submitSmartBudgetProposal(context, proposal.id);
    const review = await appendSmartBudgetLineReview(context, { lineId: proposal.lines[0]!.id, decision: "ADJUSTED", revisedUnitCost: 320, justification: "Preço ajustado com conferência humana." });
    const reviewReplay = await appendSmartBudgetLineReview(context, { lineId: proposal.lines[0]!.id, decision: "ADJUSTED", revisedUnitCost: 320, justification: "Preço ajustado com conferência humana." });
    expect(reviewReplay.id).toBe(review.id);
    const mirroredLine = await prisma.autoBudgetProposalLine.findUniqueOrThrow({ where: { id: proposal.lines[0]!.id }, include: { reviews: true } });
    expect(Number(mirroredLine.reviewedUnitCost)).toBe(320);
    expect(mirroredLine.reviewNote).toBe(review.justification);
    expect(mirroredLine.reviews).toHaveLength(1);
    const budget = await approveSmartBudgetProposal(context, proposal.id);
    const budgetReplay = await approveSmartBudgetProposal(context, proposal.id);
    expect(budgetReplay.id).toBe(budget.id);
    expect(Number(budget.totalBudget)).toBe(4000);
    expect(await prisma.budget.count({ where: { organizationId: context.organizationId, projectId } })).toBe(budgetsBefore + 1);
    expect(await prisma.operationalBaseline.findFirst({ where: { id: baselineBefore?.id, projectId: baselineProjectId }, select: { id: true, checksum: true, updatedAt: true } })).toEqual(baselineBefore);
  });

  it("bloqueia aprovação sem evidência e não vaza tenant nem permite aprovação por VIEWER", async () => {
    const proposal = await createSmartBudgetProposal(context, { projectId, name: `Sem evidência ${suffix}`, rationale: "Gate negativo", lines: [{ economicItemId, quantity: 1, quantityOrigin: "ASSUMPTION", evidenceRequired: true }] });
    await submitSmartBudgetProposal(context, proposal.id);
    await appendSmartBudgetLineReview(context, { lineId: proposal.lines[0]!.id, decision: "ACCEPTED", justification: "Quantidade aceita; preço ainda sem evidência." });
    await expect(approveSmartBudgetProposal(context, proposal.id)).rejects.toThrow("sem evidência");
    await expect(approveSmartBudgetProposal({ ...context, role: "VIEWER" }, proposal.id)).rejects.toThrow("não possui a capacidade");
    const other = await prisma.organization.findUniqueOrThrow({ where: { slug: "grupo-atlas" } });
    await expect(getEngineeringWorkspace({ organizationId: other.id, userId: context.userId, role: "VIEWER" }, projectId)).rejects.toThrow("não encontrado");
    await expect(createSmartBudgetProposal(context, { projectId, name: `Referência cruzada ${suffix}`, rationale: "Deve falhar", lines: [{ economicItemId, quantity: 1, priceObservationId: (await prisma.externalPriceObservation.findFirst({ where: { organizationId: other.id } }))?.id ?? "foreign-id" }] })).rejects.toThrow("não pertencem");
  });

  it("converte preço unitário entre kg e t (fallback de catálogo e conversão persistida)", async () => {
    // O banco de teste é persistente entre execuções. Remove somente conversões criadas por este
    // teste dirigido para que o primeiro caso continue exercitando de fato o catálogo puro.
    await prisma.analyticsUnitConversion.deleteMany({ where: { organizationId: context.organizationId, source: { startsWith: "Teste dirigido 9M" } } });
    const itemKgToT = await prisma.economicItem.create({ data: { organizationId: context.organizationId, projectId, code: `9M-KGT-${suffix}`, description: "Item medido em t, preço observado em kg", category: "Engenharia", unit: "t", createdById: context.userId } });
    const priceKg = await prisma.externalPriceObservation.create({ data: { organizationId: context.organizationId, itemCode: itemKgToT.code, itemDescription: `Preço em kg 9M ${suffix}`, observedAt: new Date("2026-08-27"), unit: "kg", price: 10, currency: "BRL", region: "São Paulo/SP", supplierName: "Fornecedor de teste", sourceProvider: "Evidência dirigida 9M", evidenceChecksum: `evidence-kgt-${suffix}`, confidence: .95, mappedEconomicItemId: itemKgToT.id, createdById: context.userId } });

    // R$ 10/kg -> R$ 10.000/t via fallback de catálogo (sem AnalyticsUnitConversion persistida).
    const catalogProposal = await createSmartBudgetProposal(context, { projectId, name: `Conversão catálogo kg->t ${suffix}`, rationale: "Teste dirigido de conversão de unidade", lines: [{ economicItemId: itemKgToT.id, quantity: 1, priceObservationId: priceKg.id, evidenceRequired: true }] });
    expect(Number(catalogProposal.lines[0]?.suggestedUnitCost)).toBe(10_000);

    const itemTToKg = await prisma.economicItem.create({ data: { organizationId: context.organizationId, projectId, code: `9M-TKG-${suffix}`, description: "Item medido em kg, preço observado em t", category: "Engenharia", unit: "kg", createdById: context.userId } });
    const priceT = await prisma.externalPriceObservation.create({ data: { organizationId: context.organizationId, itemCode: itemTToKg.code, itemDescription: `Preço em t 9M ${suffix}`, observedAt: new Date("2026-08-27"), unit: "t", price: 10_000, currency: "BRL", region: "São Paulo/SP", supplierName: "Fornecedor de teste", sourceProvider: "Evidência dirigida 9M", evidenceChecksum: `evidence-tkg-${suffix}`, confidence: .95, mappedEconomicItemId: itemTToKg.id, createdById: context.userId } });

    // R$ 10.000/t -> R$ 10/kg, mesmo caminho de catálogo na direção oposta.
    const reverseProposal = await createSmartBudgetProposal(context, { projectId, name: `Conversão catálogo t->kg ${suffix}`, rationale: "Teste dirigido de conversão de unidade", lines: [{ economicItemId: itemTToKg.id, quantity: 1, priceObservationId: priceT.id, evidenceRequired: true }] });
    expect(Number(reverseProposal.lines[0]?.suggestedUnitCost)).toBe(10);

    // Conversão versionada persistida (AnalyticsUnitConversion), semântica física igual a convertUnit:
    // fromUnit=kg, toUnit=t, factor=0.001 (1kg = 0,001t) — o preço usa o inverso desse fator.
    const latestPersistedConversion = await prisma.analyticsUnitConversion.aggregate({ where: { organizationId: context.organizationId, fromUnit: "kg", toUnit: "t" }, _max: { version: true } });
    await prisma.analyticsUnitConversion.create({ data: { organizationId: context.organizationId, dimensionType: "MASS", fromUnit: "kg", toUnit: "t", factor: 0.001, version: (latestPersistedConversion._max.version ?? 0) + 1, source: "Teste dirigido 9M", createdById: context.userId } });
    const persistedProposal = await createSmartBudgetProposal(context, { projectId, name: `Conversão persistida kg->t ${suffix}`, rationale: "Teste dirigido de conversão versionada", lines: [{ economicItemId: itemKgToT.id, quantity: 1, priceObservationId: priceKg.id, evidenceRequired: true }] });
    expect(Number(persistedProposal.lines[0]?.suggestedUnitCost)).toBe(10_000);

    // Unidade incompatível: sem conversão persistida nem catálogo compatível, falha fechada (sem default silencioso).
    const itemArea = await prisma.economicItem.create({ data: { organizationId: context.organizationId, projectId, code: `9M-AREA-${suffix}`, description: "Item medido em m2", category: "Engenharia", unit: "m2", createdById: context.userId } });
    await expect(createSmartBudgetProposal(context, { projectId, name: `Unidade incompatível ${suffix}`, rationale: "Deve falhar fechado", lines: [{ economicItemId: itemArea.id, quantity: 1, priceObservationId: priceKg.id, evidenceRequired: true }] })).rejects.toThrow("Não há normalização");

    // Conversão persistida com versão mais alta sobrepõe tanto a versão anterior quanto o catálogo
    // físico puro (0,001) — prova que o caminho persistido realmente é usado, não um fallback disfarçado.
    await prisma.analyticsUnitConversion.create({ data: { organizationId: context.organizationId, dimensionType: "MASS", fromUnit: "kg", toUnit: "t", factor: 0.002, version: (latestPersistedConversion._max.version ?? 0) + 2, source: "Teste dirigido 9M — override comercial", createdById: context.userId } });
    const overriddenProposal = await createSmartBudgetProposal(context, { projectId, name: `Conversão persistida sobreposta kg->t ${suffix}`, rationale: "Teste dirigido de precedência de versão", lines: [{ economicItemId: itemKgToT.id, quantity: 1, priceObservationId: priceKg.id, evidenceRequired: true }] });
    expect(Number(overriddenProposal.lines[0]?.suggestedUnitCost)).toBe(5_000);
  });

  it("rejeita fator de conversão persistido inválido (zero ou negativo) em vez de gerar custo silencioso", async () => {
    const itemGram = await prisma.economicItem.create({ data: { organizationId: context.organizationId, projectId, code: `9M-GRAM-${suffix}`, description: "Item medido em g, preço observado em kg", category: "Engenharia", unit: "g", createdById: context.userId } });
    const priceKgForGram = await prisma.externalPriceObservation.create({ data: { organizationId: context.organizationId, itemCode: itemGram.code, itemDescription: `Preço em kg para item em g 9M ${suffix}`, observedAt: new Date("2026-08-27"), unit: "kg", price: 10, currency: "BRL", region: "São Paulo/SP", supplierName: "Fornecedor de teste", sourceProvider: "Evidência dirigida 9M", evidenceChecksum: `evidence-gram-${suffix}`, confidence: .95, mappedEconomicItemId: itemGram.id, createdById: context.userId } });
    const latestZeroConversion = await prisma.analyticsUnitConversion.aggregate({ where: { organizationId: context.organizationId, fromUnit: "kg", toUnit: "g" }, _max: { version: true } });
    await prisma.analyticsUnitConversion.create({ data: { organizationId: context.organizationId, dimensionType: "MASS", fromUnit: "kg", toUnit: "g", factor: 0, version: (latestZeroConversion._max.version ?? 0) + 1, source: "Teste dirigido 9M — fator zero inválido", createdById: context.userId } });
    await expect(createSmartBudgetProposal(context, { projectId, name: `Fator zero ${suffix}`, rationale: "Deve falhar fechado", lines: [{ economicItemId: itemGram.id, quantity: 1, priceObservationId: priceKgForGram.id, evidenceRequired: true }] })).rejects.toThrow("Normalização inválida");

    const itemKgFromGram = await prisma.economicItem.create({ data: { organizationId: context.organizationId, projectId, code: `9M-KGFG-${suffix}`, description: "Item medido em kg, preço observado em g", category: "Engenharia", unit: "kg", createdById: context.userId } });
    const priceGram = await prisma.externalPriceObservation.create({ data: { organizationId: context.organizationId, itemCode: itemKgFromGram.code, itemDescription: `Preço em g 9M ${suffix}`, observedAt: new Date("2026-08-27"), unit: "g", price: 10, currency: "BRL", region: "São Paulo/SP", supplierName: "Fornecedor de teste", sourceProvider: "Evidência dirigida 9M", evidenceChecksum: `evidence-kgfg-${suffix}`, confidence: .95, mappedEconomicItemId: itemKgFromGram.id, createdById: context.userId } });
    const latestNegativeConversion = await prisma.analyticsUnitConversion.aggregate({ where: { organizationId: context.organizationId, fromUnit: "g", toUnit: "kg" }, _max: { version: true } });
    await prisma.analyticsUnitConversion.create({ data: { organizationId: context.organizationId, dimensionType: "MASS", fromUnit: "g", toUnit: "kg", factor: -0.001, version: (latestNegativeConversion._max.version ?? 0) + 1, source: "Teste dirigido 9M — fator negativo inválido", createdById: context.userId } });
    await expect(createSmartBudgetProposal(context, { projectId, name: `Fator negativo ${suffix}`, rationale: "Deve falhar fechado", lines: [{ economicItemId: itemKgFromGram.id, quantity: 1, priceObservationId: priceGram.id, evidenceRequired: true }] })).rejects.toThrow("Normalização inválida");
  });

  it("read model não soma estágios e as ações executivas são determinísticas", async () => {
    const workspace = await getEngineeringWorkspace(context, projectId);
    expect(workspace.summary.budgeted).toBeGreaterThan(0);
    const signals = await getEngineeringExecutiveSignals(context.organizationId, projectId);
    const tenant = { organizationId: context.organizationId, projectId, projectName: "Projeto isolado 9M" };
    const first = buildEngineeringExceptions(tenant, signals, new Date("2026-08-28T12:00:00Z"));
    const replay = buildEngineeringExceptions(tenant, signals, new Date("2026-08-28T12:00:00Z"));
    expect(replay.map((item) => item.id)).toEqual(first.map((item) => item.id));
    expect(new Set(first.map((item) => item.id)).size).toBe(first.length);
    expect(workspace.cycle.every((row) => row.finalProjected == null || row.finalProjected !== row.budgeted + row.contracted + row.measured + row.realized)).toBe(true);
  });

  it("fechamento adversarial 9M: 'itens sem evidência pendentes' é um único indicador — proposta rejeitada não contamina, e Engenharia/Executivo concordam exatamente", async () => {
    const before = { workspace: (await getEngineeringWorkspace(context, projectId)).summary.noEvidence, signals: (await getEngineeringExecutiveSignals(context.organizationId, projectId)).noEvidence.length };

    // Proposta A: sem evidência, mas REJEITADA — já não bloqueia nem exige mais nenhuma decisão.
    const rejected = await createSmartBudgetProposal(context, { projectId, name: `Sem evidência rejeitada ${suffix}`, rationale: "Contaminação histórica", lines: [{ economicItemId, quantity: 1, quantityOrigin: "ASSUMPTION", evidenceRequired: true }] });
    await submitSmartBudgetProposal(context, rejected.id);
    await rejectSmartBudgetProposal(context, rejected.id, "Motivo de teste — não deve contar no indicador.");

    // Proposta B: sem evidência, ainda em revisão — esta sim deve contar.
    const pending = await createSmartBudgetProposal(context, { projectId, name: `Sem evidência pendente ${suffix}`, rationale: "Contagem real", lines: [{ economicItemId, quantity: 1, quantityOrigin: "ASSUMPTION", evidenceRequired: true }] });
    await submitSmartBudgetProposal(context, pending.id);

    const workspace = await getEngineeringWorkspace(context, projectId);
    const signals = await getEngineeringExecutiveSignals(context.organizationId, projectId);

    expect(workspace.summary.noEvidence - before.workspace).toBe(1);
    expect(signals.noEvidence.length - before.signals).toBe(1);
    expect(workspace.summary.noEvidence).toBe(signals.noEvidence.length);
  });
});
