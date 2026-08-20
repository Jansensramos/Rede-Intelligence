import { requireAuthContext } from "@/application/auth/session";
import { getLatestStudyForOrganization } from "@/application/studies/study-service";
import { getLatestLandStudyForOrganization } from "@/application/land/land-service";
import { ensureInvestmentCase } from "@/application/investment/investment-service";
import { getAIBootstrap } from "@/application/ai/ai-service";
import { ensureDesignWorkspace } from "@/application/design/design-service";
import { IntelligenceWorkspace } from "@/components/intelligence-workspace";
import { DEMO_PROJECT } from "@/domain/financial/demo";
import { calculateAllScenarios } from "@/domain/financial/engine";
import { calculateRedeScore } from "@/domain/score";
import { calculateSensitivity } from "@/domain/sensitivity";
import { createDemoLandSnapshot } from "@/domain/land";

export default async function Home() {
  // Temporariamente desabilitado para desenvolvimento
  // const context = await requireAuthContext();
  const context = {
    userName: "Admin",
    organizationName: "Demo Organization",
    organizationId: "demo-org",
    userId: "demo-user",
  };
  // Desabilitado para desenvolvimento - usar dados demo/mock
  // const persisted = await getLatestStudyForOrganization(context.organizationId);
  // const persistedLand = await getLatestLandStudyForOrganization(context.organizationId);
  // const initialInvestment = await ensureInvestmentCase(context);
  // const initialAI = await getAIBootstrap(context);
  // const initialDesign = await ensureDesignWorkspace(context, persisted?.projectId);

  // ✅ DADOS DO PROJETO START BUTANTÃ - MCMV
  // VGV: R$ 83 milhões | Obra reduzida 20% para MCMV
  const BUTANTA_PROJECT = {
    projectName: "START BUTANTÃ",
    city: "São Paulo",
    state: "SP",
    landAreaM2: "14500",
    landPrice: "8000000",
    units: 200,
    privateAreaPerUnitM2: "45",
    efficiencyRate: "82",
    unitPrice: "415000", // 83M / 200 = 415k por unidade
    constructionCostPerM2: "2240", // 2800 - 20% = 2240 (redução MCMV)
    indirectCostsRate: "8",
    contingencyRate: "5",
    commissionRate: "2.5",
    marketingRate: "1.5",
    approvalMonths: "6",
    constructionMonths: "24",
    salesVelocityUnitsMonth: "8",
    downPaymentRate: "10",
    onDeliveryRate: "90",
    financingLimit: "45000000",
    annualFinancingRate: "8.5",
    policy: {
      minimumMarginRate: "15",
      minimumRoiRate: "12",
      minimumIrrRate: "15",
      maximumExposure: "20000000",
    },
    annualDiscountRate: "12",
  };

  const persisted = null;
  const persistedLand = null;
  const initialInvestment = null ?? { id: "butanta-case", versionId: "v1", findings: [], documents: [], dataRoomCompleteness: 0, equityRequired: "26400000", financingLimit: "39600000", costOfCapital: "8.5" };
  const initialAI = null ?? { activeConversation: null, conversations: [] };
  const initialDesign = null ?? { package: null, revision: null, files: [], findings: [], metrics: [], insights: [], opportunities: [], summary: { openFindings: 0, criticalFindings: 0 }, revisions: [], revisionDiff: [], alternatives: [], supportedFormats: [] };
  const initialStudy = persisted ?? (() => {
    const sensitivity = calculateSensitivity(BUTANTA_PROJECT);
    const results = calculateAllScenarios(BUTANTA_PROJECT, sensitivity.calculatedAt);
    return {
      projectId: "butanta-001",
      studyId: "study-butanta-001",
      studyVersionId: "v1-20260820",
      versionNumber: 1,
      assumptions: BUTANTA_PROJECT,
      analytics: {
        sensitivity,
        scores: {
          conservative: calculateRedeScore({ result: results.conservative, resilience: sensitivity.resilience }),
          base: sensitivity.baseScore,
          aggressive: calculateRedeScore({ result: results.aggressive, resilience: sensitivity.resilience }),
        },
      },
      redTeam: {
        status: "COMPLETED",
        findings: [
          { id: "1", severity: "HIGH", title: "Risco de velocidade de vendas", description: "Meta de 8 un/mês pode ser ambiciosa para MCMV", status: "OPEN" },
          { id: "2", severity: "MEDIUM", title: "Dependência de financiamento", description: "Projeto requer 60% de funding externo", status: "OPEN" },
        ],
      },
    };
  })();
  const initialLand = persistedLand ?? {
    landStudyId: "",
    versionId: "",
    versionNumber: 1,
    snapshot: createDemoLandSnapshot(context.organizationId),
  };
  return (
    <IntelligenceWorkspace
      initialStudy={initialStudy}
      initialLand={initialLand}
      initialInvestment={initialInvestment}
      initialAI={initialAI}
      initialDesign={initialDesign}
      identity={{ userName: context.userName, organizationName: context.organizationName }}
    />
  );
}
