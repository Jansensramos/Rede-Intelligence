"use server";

import type { Prisma } from "@prisma/client";
import { assertAiUse, isAiAccessDeniedError } from "@/application/ai-gateway/rbac";
import { requireDomainActionContext } from "./authorization";
import {
  buildLearningReport,
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
import { aiGatewayProviderStatus } from "@/infrastructure/ai-gateway/config";

const genericError = "Não foi possível concluir a análise cognitiva.";

type CognitiveHumanDecision = "ACCEPTED" | "HOLD" | "REWORK_REQUESTED";

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}


function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function jsonString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function jsonArray(value: unknown) {
  return Array.isArray(value) ? value : [];
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


export async function listCognitiveReviewHistoryAction(input: {
  projectId: string;
}) {
  const context = await requireDomainActionContext("AI_READ");
  try {
    assertAiUse(context);

    const project = await prisma.project.findFirst({
      where: { id: input.projectId, organizationId: context.organizationId },
      select: { id: true },
    });
    if (!project) {
      return { ok: false as const, error: "Empreendimento não encontrado." };
    }

    const reviews = await prisma.auditLog.findMany({
      where: {
        organizationId: context.organizationId,
        projectId: input.projectId,
        action: "COGNITIVE_COMMITTEE_RUN",
        entityType: "AI_COGNITIVE_REVIEW",
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        user: { select: { name: true } },
      },
    });

    const reviewIds = reviews.map((review) => review.id);
    const decisions = reviewIds.length
      ? await prisma.auditLog.findMany({
          where: {
            organizationId: context.organizationId,
            projectId: input.projectId,
            action: "COGNITIVE_COMMITTEE_DECISION",
            entityType: "AI_COGNITIVE_DECISION",
            entityId: { in: reviewIds },
          },
          orderBy: { createdAt: "desc" },
          include: {
            user: { select: { name: true } },
          },
        })
      : [];

    const decisionByReview = new Map(decisions.map((decision) => [decision.entityId, decision]));

    return {
      ok: true as const,
      data: reviews.map((review) => {
        const stored = jsonObject(review.after);
        const report = jsonObject(stored.report as Prisma.JsonValue | null);
        const proposal = jsonObject(report.proposal as Prisma.JsonValue | null);
        const challenges = jsonArray(report.challenges);
        const decision = decisionByReview.get(review.id);
        const decisionAfter = jsonObject(decision?.after ?? null);

        return {
          reviewId: review.id,
          conversationId: review.entityId,
          objective: jsonString(stored.objective) ?? "Análise cognitiva",
          disposition: jsonString(proposal.disposition) ?? "UNKNOWN",
          challengeCount: challenges.length,
          criticalCount: challenges.filter((item) => {
            const challenge = item && typeof item === "object" && !Array.isArray(item)
              ? item as Record<string, unknown>
              : {};
            return challenge.severity === "CRITICAL";
          }).length,
          createdAt: review.createdAt.toISOString(),
          createdBy: review.user.name,
          decision: jsonString(decisionAfter.status) ?? null,
          decisionNote: jsonString(decisionAfter.note) ?? null,
          decidedAt: decision?.createdAt.toISOString() ?? null,
          decidedBy: decision?.user.name ?? null,
        };
      }),
    };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function getCognitiveReviewAction(input: {
  reviewId: string;
  projectId: string;
}) {
  const context = await requireDomainActionContext("AI_READ");
  try {
    assertAiUse(context);

    const review = await prisma.auditLog.findFirst({
      where: {
        id: input.reviewId,
        organizationId: context.organizationId,
        projectId: input.projectId,
        action: "COGNITIVE_COMMITTEE_RUN",
        entityType: "AI_COGNITIVE_REVIEW",
      },
      include: {
        user: { select: { name: true } },
      },
    });

    if (!review) {
      return { ok: false as const, error: "Rodada cognitiva não encontrada." };
    }

    const decision = await prisma.auditLog.findFirst({
      where: {
        organizationId: context.organizationId,
        projectId: input.projectId,
        action: "COGNITIVE_COMMITTEE_DECISION",
        entityType: "AI_COGNITIVE_DECISION",
        entityId: review.id,
      },
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { name: true } },
      },
    });

    const stored = jsonObject(review.after);
    const decisionAfter = jsonObject(decision?.after ?? null);

    return {
      ok: true as const,
      data: {
        reviewId: review.id,
        conversationId: review.entityId,
        createdAt: review.createdAt.toISOString(),
        createdBy: review.user.name,
        objective: jsonString(stored.objective) ?? "Análise cognitiva",
        report: stored.report,
        recommendations: jsonArray(stored.recommendations),
        humanDecision: jsonString(decisionAfter.status) ?? null,
        decisionNote: jsonString(decisionAfter.note) ?? "",
        decidedAt: decision?.createdAt.toISOString() ?? null,
        decidedBy: decision?.user.name ?? null,
      },
    };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}


export async function getCognitiveLearningReportAction(input: {
  projectId: string;
}) {
  const context = await requireDomainActionContext("AI_READ");
  try {
    assertAiUse(context);

    const project = await prisma.project.findFirst({
      where: { id: input.projectId, organizationId: context.organizationId },
      select: { id: true },
    });
    if (!project) {
      return { ok: false as const, error: "Empreendimento não encontrado." };
    }

    const evaluations = await prisma.forecastEvaluation.findMany({
      where: {
        organizationId: context.organizationId,
        projectId: input.projectId,
        evaluated: true,
        actualValue: { not: null },
      },
      orderBy: { calculatedAt: "desc" },
      take: 500,
      include: {
        metricDefinition: {
          select: { key: true, name: true },
        },
      },
    });

    const report = buildLearningReport(
      evaluations.flatMap((evaluation) => {
        if (evaluation.actualValue === null) return [];
        return [{
          id: evaluation.id,
          decisionId: evaluation.forecastSourceId,
          predicted: {
            metric: evaluation.metricDefinition.name || evaluation.metricDefinition.key,
            value: Number(evaluation.predictedValue),
          },
          actual: {
            value: Number(evaluation.actualValue),
          },
          recordedAt: evaluation.calculatedAt.toISOString(),
        }];
      }),
    );

    return {
      ok: true as const,
      data: {
        report,
        observations: evaluations.length,
        lastCalculatedAt: evaluations[0]?.calculatedAt.toISOString() ?? null,
      },
    };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function getCognitiveProductionReadinessAction(input: {
  projectId: string;
}) {
  const context = await requireDomainActionContext("AI_READ");
  try {
    assertAiUse(context);

    const project = await prisma.project.findFirst({
      where: { id: input.projectId, organizationId: context.organizationId },
      select: { id: true },
    });
    if (!project) {
      return { ok: false as const, error: "Empreendimento não encontrado." };
    }

    const [
      cognitiveRuns,
      humanDecisions,
      evaluatedForecasts,
      activeConnectors,
      closure,
    ] = await Promise.all([
      prisma.auditLog.count({
        where: {
          organizationId: context.organizationId,
          projectId: input.projectId,
          action: "COGNITIVE_COMMITTEE_RUN",
          entityType: "AI_COGNITIVE_REVIEW",
        },
      }),
      prisma.auditLog.count({
        where: {
          organizationId: context.organizationId,
          projectId: input.projectId,
          action: "COGNITIVE_COMMITTEE_DECISION",
          entityType: "AI_COGNITIVE_DECISION",
        },
      }),
      prisma.forecastEvaluation.count({
        where: {
          organizationId: context.organizationId,
          projectId: input.projectId,
          evaluated: true,
          actualValue: { not: null },
        },
      }),
      prisma.connectorInstallation.count({
        where: {
          organizationId: context.organizationId,
          isActive: true,
        },
      }),
      prisma.projectClosureResult.findFirst({
        where: {
          organizationId: context.organizationId,
          projectId: input.projectId,
        },
        orderBy: { version: "desc" },
        select: { status: true, version: true },
      }),
    ]);

    const provider = aiGatewayProviderStatus();

    return {
      ok: true as const,
      data: {
        provider,
        cognitiveRuns,
        humanDecisions,
        evaluatedForecasts,
        activeConnectors,
        closure: closure
          ? { status: closure.status, version: closure.version }
          : null,
        checks: [
          {
            key: "COGNITIVE_GOVERNANCE",
            label: "Governança cognitiva",
            status: cognitiveRuns > 0 ? "READY" : "WAITING_DATA",
            detail: cognitiveRuns > 0
              ? `${cognitiveRuns} rodada(s) auditada(s)`
              : "Aguardando a primeira rodada real do Comitê Cognitivo.",
          },
          {
            key: "HUMAN_DECISIONS",
            label: "Decisão humana",
            status: humanDecisions > 0 ? "READY" : "WAITING_DATA",
            detail: humanDecisions > 0
              ? `${humanDecisions} decisão(ões) registrada(s)`
              : "Nenhuma decisão humana real registrada ainda.",
          },
          {
            key: "LEARNING_LOOP",
            label: "Learning Loop",
            status: evaluatedForecasts > 0 ? "READY" : "WAITING_DATA",
            detail: evaluatedForecasts > 0
              ? `${evaluatedForecasts} observação(ões) previsto × realizado`
              : "Aguardando dados reais previsto × realizado.",
          },
          {
            key: "AI_PROVIDER",
            label: "Provider de IA",
            status: provider === "AVAILABLE" ? "READY" : "EXTERNAL_DEPENDENCY",
            detail: provider === "AVAILABLE"
              ? "Provider comercial disponível."
              : "Depende de configuração e credencial do ambiente.",
          },
          {
            key: "CONNECTORS",
            label: "Integrações externas",
            status: activeConnectors > 0 ? "READY" : "EXTERNAL_DEPENDENCY",
            detail: activeConnectors > 0
              ? `${activeConnectors} conector(es) ativo(s)`
              : "Depende da instalação/configuração de conectores reais.",
          },
          {
            key: "PROJECT_CLOSURE",
            label: "Encerramento",
            status: closure?.status === "FINAL" ? "READY" : "WAITING_DATA",
            detail: closure
              ? `Versão ${closure.version} · ${closure.status}`
              : "Nenhum resultado de encerramento preparado.",
          },
        ],
      },
    };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}
