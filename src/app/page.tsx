import { requireAuthContext } from "@/application/auth/session";
import { getStudyForOrganization } from "@/application/studies/study-service";
import { getLatestLandStudyForOrganization } from "@/application/land/land-service";
import { ensureInvestmentCase } from "@/application/investment/investment-service";
import { getAIBootstrap } from "@/application/ai/ai-service";
import { ensureDesignWorkspace } from "@/application/design/design-service";
import { getLatestProjectBudget } from "@/application/budget/budget-service";
import { getOperationsWorkspace } from "@/application/operations/operations-service";
import { getFinancialWorkspace } from "@/application/financial-ops/financial-service";
import { getProcurementWorkspace } from "@/application/procurement/procurement-service";
import { getLegalWorkspace } from "@/application/legal/legal-service";
import { getSalesWorkspace } from "@/application/sales/sales-service";
import { getPeoplePerformanceWorkspace } from "@/application/people-performance/people-performance-service";
import { getAccountingWorkspace } from "@/application/accounting/accounting-service";
import { getIntegrationsWorkspace } from "@/application/integrations/integrations-service";
import { getDataIntelligenceWorkspace } from "@/application/data-intelligence/data-intelligence-service";
import { IntelligenceWorkspace } from "@/components/intelligence-workspace";
import { START_BUTANTA_PROJECT } from "@/domain/financial/demo";
import { calculateAllScenarios } from "@/domain/financial/engine";
import { prisma } from "@/infrastructure/database/prisma";

export default async function Home() {
  const context = await requireAuthContext();
  const project = await prisma.project.findUnique({
    where: {
      organizationId_name: {
        organizationId: context.organizationId,
        name: START_BUTANTA_PROJECT.projectName,
      },
    },
    include: {
      studies: {
        where: { status: "ACTIVE" },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
  });
  const studyId = project?.studies[0]?.id;
  const initialStudy = studyId ? await getStudyForOrganization(context.organizationId, studyId) : null;
  if (!initialStudy) throw new Error("Execute o seed para carregar o projeto demonstrativo START BUTANTÃ.");
  const baseVgv = calculateAllScenarios(initialStudy.assumptions).base.metrics.vgv;

  const initialInvestment = await ensureInvestmentCase(context);
  const [initialLand, initialDesign, initialAI, initialBudget, initialOperations, initialFinancial, initialProcurement, initialLegal, initialSales, initialPeoplePerformance, initialAccounting, initialIntegrations, initialDataIntelligence] = await Promise.all([
    getLatestLandStudyForOrganization(context.organizationId),
    ensureDesignWorkspace(context, initialStudy.projectId),
    getAIBootstrap(context),
    getLatestProjectBudget(context, initialStudy.projectId, baseVgv),
    getOperationsWorkspace(context, initialStudy.projectId),
    getFinancialWorkspace(context, initialStudy.projectId),
    getProcurementWorkspace(context, initialStudy.projectId),
    getLegalWorkspace(context, initialStudy.projectId),
    getSalesWorkspace(context, initialStudy.projectId),
    getPeoplePerformanceWorkspace(context, initialStudy.projectId),
    getAccountingWorkspace(context, initialStudy.projectId),
    getIntegrationsWorkspace(context, initialStudy.projectId),
    getDataIntelligenceWorkspace(context, initialStudy.projectId),
  ]);
  if (!initialLand) throw new Error("Execute o seed para carregar o estudo territorial demonstrativo.");

  return (
    <IntelligenceWorkspace
      initialStudy={initialStudy}
      initialLand={initialLand}
      initialInvestment={initialInvestment}
      initialAI={initialAI}
      initialDesign={initialDesign}
      initialBudget={initialBudget}
      initialOperations={initialOperations}
      initialFinancial={initialFinancial}
      initialProcurement={initialProcurement}
      initialLegal={initialLegal}
      initialSales={initialSales}
      initialPeoplePerformance={initialPeoplePerformance}
      initialAccounting={initialAccounting}
      initialIntegrations={initialIntegrations}
      initialDataIntelligence={initialDataIntelligence}
      identity={{ userName: context.userName, organizationName: context.organizationName }}
    />
  );
}
