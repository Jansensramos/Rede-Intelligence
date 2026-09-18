import type {
  AutopilotRecommendation,
  AutopilotSignal,
  OperatorAction,
} from "./types";

export type AutopilotMode = "OFF" | "ADVISORY" | "ASSISTED";

export interface AutopilotPolicy {
  mode: AutopilotMode;
  mutationCapabilities: readonly string[];
}

function recommendationId(signalId: string): string {
  return `autopilot:${signalId}`;
}

export function planAutopilot(
  signals: readonly AutopilotSignal[],
  policy: AutopilotPolicy,
): AutopilotRecommendation[] {
  if (policy.mode === "OFF") return [];

  return signals.map((signal) => {
    const canDraftAction = policy.mode === "ASSISTED" && Boolean(signal.suggestedCapability);
    const isMutation = signal.suggestedCapability
      ? policy.mutationCapabilities.includes(signal.suggestedCapability)
      : false;

    const proposedAction: OperatorAction | undefined = canDraftAction && signal.suggestedCapability
      ? {
          id: `operator:${signal.id}`,
          capability: signal.suggestedCapability,
          mode: isMutation ? "MUTATION" : "READ_ONLY",
          payload: { signalId: signal.id },
          reason: `Preparado pelo Autopilot a partir do sinal: ${signal.title}`,
        }
      : undefined;

    return {
      id: recommendationId(signal.id),
      signalId: signal.id,
      title: signal.title,
      rationale: `Sinal ${signal.category} com severidade ${signal.severity}; revisar evidências antes de qualquer ação.`,
      evidenceRefs: [...signal.evidenceRefs],
      proposedAction,
      requiresHumanApproval: Boolean(proposedAction),
    };
  });
}
