"use server";

import { assertAiUse, isAiAccessDeniedError } from "@/application/ai-gateway/rbac";
import { requireDomainActionContext } from "./authorization";
import {
  createExistingToolLayerPort,
  planAutopilot,
  runInvestmentCommittee,
} from "@/application/cognitive";
import { isReadAccessDeniedError } from "@/domain/auth/read-capabilities";
import { prisma } from "@/infrastructure/database/prisma";

const genericError = "Não foi possível concluir a análise cognitiva.";

function errorMessage(error: unknown) {
  if (isReadAccessDeniedError(error) || isAiAccessDeniedError(error)) {
    return "Seu perfil não possui acesso aos recursos cognitivos da REDE.";
  }
  return error instanceof Error && /acesso|permiss|evidência|contexto|indisponível/i.test(error.message)
    ? error.message
    : genericError;
}

export async function runCognitiveReviewAction(input: {
  conversationId: string;
  projectId: string;
  objective: string;
}) {
  try {
    const context = await requireDomainActionContext("AI_READ");
    assertAiUse(context);

    const objective = input.objective.trim();
    if (!objective || objective.length > 600) {
      return { ok: false as const, error: "Defina um objetivo válido para o comitê." };
    }

    const conversation = await prisma.aIConversation.findFirst({
      where: {
        id: input.conversationId,
        organizationId: context.organizationId,
        createdById: context.userId,
        projectId: input.projectId,
      },
      select: { id: true, projectId: true },
    });

    if (!conversation?.projectId) {
      return { ok: false as const, error: "Conversa ou empreendimento não encontrado." };
    }

    const toolPort = createExistingToolLayerPort(context, conversation.id);
    const report = await runInvestmentCommittee({
      context: {
        organizationId: context.organizationId,
        userId: context.userId,
        role: context.role,
        conversationId: conversation.id,
        projectId: conversation.projectId,
        objective,
      },
      toolPort,
    });

    const recommendations = planAutopilot(
      report.challenges.map((challenge) => ({
        id: challenge.id,
        category: "RISK" as const,
        severity: challenge.severity,
        title: challenge.message,
        evidenceRefs: [challenge.findingId],
      })),
      { mode: "ADVISORY", mutationCapabilities: [] },
    );

    return {
      ok: true as const,
      data: {
        report,
        recommendations,
      },
    };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}
