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

  // Mock data para desenvolvimento
  const persisted = null;
  const persistedLand = null;
  const initialInvestment = null;
  const initialAI = null;
  const initialDesign = null;
  const initialStudy = persisted ?? (() => {
    const sensitivity = calculateSensitivity(DEMO_PROJECT);
    const results = calculateAllScenarios(DEMO_PROJECT, sensitivity.calculatedAt);
    return {
      projectId: "",
      studyId: "",
      studyVersionId: "",
      versionNumber: 0,
      assumptions: DEMO_PROJECT,
      analytics: {
        sensitivity,
        scores: {
          conservative: calculateRedeScore({ result: results.conservative, resilience: sensitivity.resilience }),
          base: sensitivity.baseScore,
          aggressive: calculateRedeScore({ result: results.aggressive, resilience: sensitivity.resilience }),
        },
      },
      redTeam: null,
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
