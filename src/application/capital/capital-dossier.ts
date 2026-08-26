/**
 * Fase 9N §13 — read model para um futuro dossiê de funding. Só referências (ids/labels/status)
 * de fatos JÁ oficiais em outros módulos — nunca duplica documento nem arquivo. Quando a geração
 * real do PDF/pacote existir, ela consome esta função; hoje ninguém mais a chama (seam, como o
 * `FundingProviderAdapter` em `domain/capital/funding-provider.ts`).
 */
import { prisma } from "@/infrastructure/database/prisma";
import { getBaseProjectEconomicsForProject, getCapitalNeedForProject, getFundingProposalsForProject } from "./capital-queries";

export async function assembleFundingDossier(context: Pick<{ organizationId: string }, "organizationId">, projectId: string) {
  const [project, capitalNeed, economics, proposals, budget, schedule, salesAggregate, licenses] = await Promise.all([
    prisma.project.findFirstOrThrow({ where: { id: projectId, organizationId: context.organizationId }, select: { id: true, name: true, city: true, state: true, companyId: true } }),
    getCapitalNeedForProject(context, projectId),
    getBaseProjectEconomicsForProject(context, projectId),
    getFundingProposalsForProject(context, projectId),
    prisma.budget.findFirst({ where: { organizationId: context.organizationId, projectId, status: { in: ["OFFICIAL", "APPROVED"] } }, orderBy: { version: "desc" }, select: { id: true, name: true, version: true, totalBudget: true, status: true } }),
    prisma.operationalSchedule.findFirst({ where: { organizationId: context.organizationId, projectId, status: "APPROVED" }, orderBy: { version: "desc" }, select: { id: true, version: true, status: true } }),
    prisma.sale.aggregate({ where: { organizationId: context.organizationId, projectId, status: "APPROVED" }, _sum: { soldPrice: true }, _count: true }),
    prisma.legalLicense.findMany({ where: { organizationId: context.organizationId, projectId }, select: { id: true, code: true, title: true, status: true, expiresAt: true }, take: 50 }),
  ]);

  const approvedProposal = proposals.find((p) => p.status === "APPROVED") ?? null;

  return {
    project: { id: project.id, name: project.name, city: project.city, state: project.state },
    viabilidade: economics ? { vgv: economics.vgv, profit: economics.profit, totalCost: economics.totalCost } : null,
    necessidadeDeCapital: { totalCapitalNeed: capitalNeed.totalCapitalNeed, peakExposureMonth: capitalNeed.peakExposureMonth, fundingStillNeeded: capitalNeed.fundingStillNeeded },
    orcamento: budget ? { id: budget.id, name: budget.name, version: budget.version, totalBudget: budget.totalBudget.toString(), status: budget.status } : null,
    cronogramaObra: schedule ? { id: schedule.id, version: schedule.version, status: schedule.status } : null,
    vendas: { vgvVendido: Number(salesAggregate._sum.soldPrice ?? 0), unidadesVendidas: salesAggregate._count },
    licencas: licenses.map((l) => ({ id: l.id, code: l.code, title: l.title, status: l.status, expiresAt: l.expiresAt?.toISOString() ?? null })),
    fundingAprovado: approvedProposal ? { id: approvedProposal.id, code: approvedProposal.code, providerName: approvedProposal.providerName, amount: approvedProposal.amount.toString(), decisionSnapshot: approvedProposal.decisionSnapshot } : null,
    propostasRegistradas: proposals.map((p) => ({ id: p.id, code: p.code, status: p.status, providerName: p.providerName, amount: p.amount.toString() })),
  };
}

export type FundingDossier = Awaited<ReturnType<typeof assembleFundingDossier>>;
