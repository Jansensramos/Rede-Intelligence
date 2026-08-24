import type { MembershipRole } from "@prisma/client";
import {
  createAutoBudgetProposal,
  decideAutoBudgetProposal,
  decideOutlier,
  moveAutoBudgetProposalToReview,
  refreshDataIntelligence,
} from "../src/application/data-intelligence/data-intelligence-service";
import { prisma } from "../src/infrastructure/database/prisma";

type SeedDataIntelligenceContext = { organizationId: string; userId: string; role: MembershipRole };

const AUTO_BUDGET_PROPOSAL_NAME = "Revisão de referência — Fundações e estrutura (demonstração)";

// Aditivo e idempotente: reexecuta a fundação (contratos, métricas, política, fatos, benchmark,
// previsto x realizado, qualidade e portfólio) via refreshDataIntelligence — que já é upsert por
// natureza — e só cria a proposta de Orçamento Inteligente de demonstração se ela ainda não
// existir, avançando o mesmo registro pelos estados de revisão em vez de duplicar a cada rodada.
export async function seedDataIntelligenceDemo(context: SeedDataIntelligenceContext, projectId: string) {
  const officialLine = await prisma.budgetLineItem.findFirst({
    where: { budget: { projectId, organizationId: context.organizationId, status: { in: ["OFFICIAL", "APPROVED"] } }, totalCost: { gt: 0 } },
    orderBy: { totalCost: "desc" },
  });
  if (!officialLine?.economicItemId) throw new Error("Seed 9I requer uma linha orçamentária oficial com EconomicItem para o START BUTANTÃ.");

  // Mapeamento de Price Intelligence (plano 9I, seção 13): a observação externa de preço do aço
  // (semeada pela 9H, sem vínculo a EconomicItem) passa a apontar para o mesmo item do pedido de
  // compra de aço, permitindo comparar preço observado externo x preço realmente pago no benchmark.
  await prisma.externalPriceObservation.updateMany({
    where: { organizationId: context.organizationId, itemCode: "ACO-CA50-10MM", mappedEconomicItemId: null },
    data: { mappedEconomicItemId: officialLine.economicItemId },
  });

  const result = await refreshDataIntelligence(context, projectId);

  const openOutlier = result.benchmarks[0]?.outliers?.find((o) => o.decision === "PENDING");
  if (openOutlier) {
    await decideOutlier(
      context,
      openOutlier.id,
      "DIFFERENT_SCOPE",
      "Observação externa reflete preço de commodity (aço bruto, sem logística/fabricação/instalação); pedido de compra é fornecimento mobilizado com escopo mais amplo. Mantido como referência, não excluído da amostra.",
    );
  }

  // A proposta de demonstração precisa mirar uma quantidade/unidade compatível com a unidade de
  // referência que o comparativo escolher deterministicamente (a que maximiza a amostra elegível
  // — neste tenant, a dimensão de massa: pedido de compra de aço em "t" e observação externa em
  // "kg" são as únicas duas unidades mutuamente compatíveis). Reaproveita a quantidade real
  // comprada (25 t de aço) em vez de inventar um número desconectado dos fatos do seed.
  const referencePurchaseOrderItem = await prisma.purchaseOrderItem.findFirst({
    where: { economicItemId: officialLine.economicItemId, purchaseOrder: { projectId, organizationId: context.organizationId } },
    orderBy: { quantity: "desc" },
  });
  if (!referencePurchaseOrderItem) throw new Error("Seed 9I requer um item de pedido de compra real para orientar a unidade da proposta de Orçamento Inteligente.");

  let proposal = await prisma.autoBudgetProposal.findFirst({ where: { organizationId: context.organizationId, projectId, name: AUTO_BUDGET_PROPOSAL_NAME }, include: { lines: true } });
  if (!proposal) {
    const created = await createAutoBudgetProposal(context, {
      projectId,
      economicItemId: officialLine.economicItemId,
      quantity: Number(referencePurchaseOrderItem.quantity),
      unit: referencePurchaseOrderItem.unit,
      name: AUTO_BUDGET_PROPOSAL_NAME,
    });
    proposal = await prisma.autoBudgetProposal.findUniqueOrThrow({ where: { id: created.id }, include: { lines: true } });
  }
  if (proposal.status === "DRAFT") {
    await moveAutoBudgetProposalToReview(context, proposal.id);
    proposal = await prisma.autoBudgetProposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { lines: true } });
  }
  if (proposal.status === "REVIEW") {
    const line = proposal.lines[0];
    await decideAutoBudgetProposal(context, proposal.id, "APPROVED", {
      lineReviews: line
        ? [{ lineId: line.id, reviewedUnitCost: Number(line.suggestedUnitCost), reviewNote: "Especialista confirmou a sugestão sem alteração após revisar a amostra e as exceções — aprovação humana obrigatória preservada." }]
        : [],
    });
    proposal = await prisma.autoBudgetProposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { lines: true } });
  }

  return {
    factsCreated: result.refresh.factsCreated,
    factsUpdated: result.refresh.factsUpdated,
    benchmarkCount: result.benchmarks.length,
    forecastEvaluationCount: result.forecastEvaluations.length,
    qualityRunCount: result.qualityRuns.length,
    autoBudgetProposalStatus: proposal.status,
    autoBudgetProposalId: proposal.id,
  };
}
