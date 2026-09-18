import type {
  AgentRun,
  DecisionAlternative,
  DecisionProposal,
  RedTeamChallenge,
} from "./types";

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function buildDecisionProposal(
  objective: string,
  agentRuns: readonly AgentRun[],
  challenges: readonly RedTeamChallenge[],
): DecisionProposal {
  const critical = challenges.filter((item) => item.severity === "CRITICAL");
  const evidenceRefs = unique(
    agentRuns.flatMap((run) => run.findings.flatMap((finding) => finding.evidenceRefs)),
  );

  const hasEvidence = evidenceRefs.length > 0;
  const disposition = critical.length > 0
    ? "REWORK_ANALYSIS"
    : hasEvidence
      ? "PROCEED_WITH_CONTROLS"
      : "HOLD_FOR_EVIDENCE";

  const alternatives: DecisionAlternative[] = [
    {
      id: "proceed",
      label: "Prosseguir com controles",
      rationale: "Avançar somente com as premissas comprovadas e controles explicitamente registrados.",
      requiredControls: [
        "aprovação humana",
        "rastreabilidade de evidências",
        "responsável e prazo para pendências",
      ],
    },
    {
      id: "hold",
      label: "Aguardar evidências",
      rationale: "Não avançar até que as lacunas materiais de evidência estejam resolvidas.",
      requiredControls: ["plano de diligência", "responsável por cada evidência ausente"],
    },
    {
      id: "rework",
      label: "Refazer a análise",
      rationale: "Reexecutar a análise após corrigir inconsistências ou contradições críticas.",
      requiredControls: ["nova rodada dos agentes", "nova rodada do Red Team"],
    },
  ];

  return {
    disposition,
    executiveSummary: `Objetivo: ${objective}. Foram consultados ${agentRuns.length} agentes, com ${evidenceRefs.length} referências de evidência e ${challenges.length} questionamentos do Red Team.`,
    alternatives,
    evidenceRefs,
    unresolvedChallenges: [...challenges],
    requiresHumanDecision: true,
  };
}
