import type { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { getInvestmentCaseForOrganization, getLatestInvestmentCaseForOrganization } from "@/application/investment/investment-service";
import type { AIContextSelection, AIResponseMode, RelevantContextPackage } from "@/domain/ai";
import type { InvestmentSnapshotBundle } from "@/domain/investment";
import { prisma } from "@/infrastructure/database/prisma";
import { getLatestDesignWorkspace } from "@/application/design/design-service";

export function contextSelectionFromWorkspace(workspace: Awaited<ReturnType<typeof getLatestInvestmentCaseForOrganization>> & {}) : AIContextSelection {
  if (!workspace) throw new Error("Investment Case não encontrado.");
  const urban = workspace.bundle.land?.scenarios.find((item) => item.id === workspace.bundle.land?.selectedScenarioId) ?? null;
  return {
    projectId: workspace.bundle.projectId,
    studyId: workspace.bundle.studyId,
    studyVersionId: workspace.bundle.studyVersionId,
    studyVersionNumber: workspace.bundle.studyVersionNumber,
    investmentCaseId: workspace.id,
    snapshotBundleId: workspace.bundleId,
    financialScenario: workspace.bundle.scenario,
    urbanScenarioId: urban?.id ?? null,
    urbanScenarioType: urban?.type ?? null,
    currentModule: "ai",
  };
}

export async function buildAIContext(
  context: AuthContext,
  conversationId: string,
  question: string,
  currentModule: string,
): Promise<RelevantContextPackage> {
  const conversation = await prisma.aIConversation.findFirst({ where: { id: conversationId, organizationId: context.organizationId, createdById: context.userId } });
  if (!conversation) throw new Error("Recurso da REDE AI não encontrado.");
  const latest = conversation.investmentCaseId
    ? await getInvestmentCaseForOrganization(context.organizationId, conversation.investmentCaseId)
    : await getLatestInvestmentCaseForOrganization(context.organizationId);
  if (!latest) throw new Error("Investment Case não encontrado nesta organização.");
  const stored = conversation.contextSnapshot as unknown as AIContextSelection;
  let workspace = latest;
  if (stored.snapshotBundleId && stored.snapshotBundleId !== latest.bundleId) {
    const historical = await prisma.investmentSnapshotBundle.findFirst({ where: { id: stored.snapshotBundleId, investmentCaseId: latest.id, investmentCase: { organizationId: context.organizationId } } });
    if (historical) {
      const bundle = historical.content as unknown as InvestmentSnapshotBundle;
      workspace = { ...latest, bundleId: historical.id, bundleChecksum: historical.checksum, bundle, artifacts: latest.artifacts.map((item) => ({ ...item, sourceOutdated: item.snapshotBundleId !== historical.id })) };
    }
  }
  const selection: AIContextSelection = { ...contextSelectionFromWorkspace(workspace), ...stored, currentModule: currentModule || stored.currentModule || "ai" };
  const canMutate = context.role === "OWNER" || context.role === "ADMIN";
  const canSimulate = canMutate || context.role === "ANALYST" || context.role === "REVIEWER";
  const canViewConfidential = context.role !== "VIEWER" && !["MUNICIPALITY", "LANDOWNER"].includes(conversation.audience);
  const design = await getLatestDesignWorkspace(context.organizationId, workspace.bundle.projectId);
  return {
    conversationId,
    organizationId: context.organizationId,
    userId: context.userId,
    role: context.role,
    audience: conversation.audience,
    responseMode: conversation.responseMode as AIResponseMode,
    question,
    selection,
    workspace,
    design,
    staleConversation: conversation.sourceStudyVersionNumber !== null && conversation.sourceStudyVersionNumber !== latest.bundle.studyVersionNumber,
    permissions: { canRead: true, canSimulate, canMutate, canViewConfidential },
  };
}

export async function persistContextSelection(organizationId: string, userId: string, conversationId: string, selection: AIContextSelection) {
  const result = await prisma.aIConversation.updateMany({ where: { id: conversationId, organizationId, createdById: userId }, data: { studyVersionId: selection.studyVersionId, investmentCaseId: selection.investmentCaseId, activeScenario: selection.financialScenario, activeUrbanScenario: selection.urbanScenarioId, contextSnapshot: JSON.parse(JSON.stringify(selection)) as Prisma.InputJsonValue } });
  if (!result.count) throw new Error("Recurso da REDE AI não encontrado.");
}
