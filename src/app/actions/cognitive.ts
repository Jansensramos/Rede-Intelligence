"use server";

import type { Prisma } from "@prisma/client";
import { assertAiUse, isAiAccessDeniedError } from "@/application/ai-gateway/rbac";
import { requireDomainActionContext } from "./authorization";
import {
  createExistingToolLayerPort,
  planAutopilot,
  runInvestmentCommittee,
} from "@/application/cognitive";
import { isReadAccessDeniedError } from "@/domain/auth/read-capabilities";
import {
  assertProtectedWriteCapability,
  WriteAccessDeniedError,
} from "@/domain/auth/write-capabilities";
import { prisma } from "@/infrastructure/database/prisma";

const genericError = "Não foi possível concluir a análise cognitiva.";

type CognitiveHumanDecision = "ACCEPTED" | "HOLD" | "REWORK_REQUESTED";

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function errorMessage(error: unknown) {
  if (isReadAccessDeniedError(error) || isAiAccessDeniedError(error)) {
    return "Seu perfil não possui acesso aos recursos cognitivos da REDE.";
  }
  if (error instanceof WriteAccessDeniedError) {
    return "Seu perfil pode consultar a análise, mas não possui permissão para registrar uma decisão.";
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
  const context = await requireDomainActionContext("AI_READ");
  try {
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

    const review = await prisma.auditLog.create({
      data: {
        organizationId: context.organizationId,
        userId: context.userId,
        projectId: conversation.projectId,
        action: "COGNITIVE_COMMITTEE_RUN",
        entityType: "AI_COGNITIVE_REVIEW",
        entityId: conversation.id,
        after: asJson({ objective, report, recommendations }),
        metadata: asJson({
          conversationId: conversation.id,
          status: "PENDING_HUMAN_DECISION",
          cognitiveStackVersion: report.stackVersion,
        }),
      },
      select: { id: true, createdAt: true },
    });

    return {
      ok: true as const,
      data: {
        reviewId: review.id,
        createdAt: review.createdAt.toISOString(),
        report,
        recommendations,
      },
    };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function recordCognitiveDecisionAction(input: {
  reviewId: string;
  conversationId: string;
  projectId: string;
  decision: CognitiveHumanDecision;
  note?: string;
}) {
  const context = await requireDomainActionContext("AI_READ");
  try {
    assertAiUse(context);
    assertProtectedWriteCapability(context.role, "OPERATIONS_WRITE");

    if (!["ACCEPTED", "HOLD", "REWORK_REQUESTED"].includes(input.decision)) {
      return { ok: false as const, error: "Decisão humana inválida." };
    }

    const note = input.note?.trim() ?? "";
    if (note.length > 800) {
      return { ok: false as const, error: "A observação deve ter no máximo 800 caracteres." };
    }

    const review = await prisma.auditLog.findFirst({
      where: {
        id: input.reviewId,
        organizationId: context.organizationId,
        userId: context.userId,
        projectId: input.projectId,
        action: "COGNITIVE_COMMITTEE_RUN",
        entityType: "AI_COGNITIVE_REVIEW",
      },
      select: { id: true, entityId: true },
    });

    if (!review || review.entityId !== input.conversationId) {
      return { ok: false as const, error: "Rodada cognitiva não encontrada." };
    }

    const priorDecision = await prisma.auditLog.findFirst({
      where: {
        organizationId: context.organizationId,
        projectId: input.projectId,
        action: "COGNITIVE_COMMITTEE_DECISION",
        entityType: "AI_COGNITIVE_DECISION",
        entityId: review.id,
      },
      select: { id: true },
    });

    if (priorDecision) {
      return { ok: false as const, error: "Esta rodada já possui uma decisão humana registrada." };
    }

    const decision = await prisma.auditLog.create({
      data: {
        organizationId: context.organizationId,
        userId: context.userId,
        projectId: input.projectId,
        action: "COGNITIVE_COMMITTEE_DECISION",
        entityType: "AI_COGNITIVE_DECISION",
        entityId: review.id,
        before: asJson({ status: "PENDING_HUMAN_DECISION" }),
        after: asJson({ status: input.decision, note: note || null }),
        metadata: asJson({
          conversationId: input.conversationId,
          reviewId: review.id,
          humanDecision: true,
          doesNotMutateBusinessDomain: true,
        }),
      },
      select: { id: true, createdAt: true },
    });

    return {
      ok: true as const,
      data: {
        decisionId: decision.id,
        decision: input.decision,
        decidedAt: decision.createdAt.toISOString(),
      },
    };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}
