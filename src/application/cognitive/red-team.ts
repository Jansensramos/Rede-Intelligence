import type { AgentRun, RedTeamChallenge } from "./types";

function challengeId(agentId: string, findingId: string, reason: RedTeamChallenge["reason"]): string {
  return `red-team:${agentId}:${findingId}:${reason}`;
}

export function runRedTeam2(agentRuns: readonly AgentRun[]): RedTeamChallenge[] {
  const challenges: RedTeamChallenge[] = [];

  for (const run of agentRuns) {
    const knownEvidence = new Set(run.evidence.map((item) => item.id));

    for (const finding of run.findings) {
      const validRefs = finding.evidenceRefs.filter((ref) => knownEvidence.has(ref));

      if (validRefs.length === 0) {
        challenges.push({
          id: challengeId(run.agentId, finding.id, "NO_EVIDENCE"),
          targetAgentId: run.agentId,
          findingId: finding.id,
          severity: "CRITICAL",
          reason: "NO_EVIDENCE",
          message: "A conclusão não possui evidência válida no pacote do agente.",
        });
      } else if (validRefs.length === 1 && finding.severity !== "INFO") {
        challenges.push({
          id: challengeId(run.agentId, finding.id, "SINGLE_SOURCE"),
          targetAgentId: run.agentId,
          findingId: finding.id,
          severity: "WARNING",
          reason: "SINGLE_SOURCE",
          message: "Conclusão material apoiada por uma única fonte; requer corroboracão.",
        });
      }

      if (finding.confidence === "LOW") {
        challenges.push({
          id: challengeId(run.agentId, finding.id, "LOW_CONFIDENCE"),
          targetAgentId: run.agentId,
          findingId: finding.id,
          severity: "WARNING",
          reason: "LOW_CONFIDENCE",
          message: "A confiança declarada é baixa para suportar decisão material.",
        });
      }

      if (finding.proposedAction && validRefs.length === 0) {
        challenges.push({
          id: challengeId(run.agentId, finding.id, "UNSUPPORTED_ACTION"),
          targetAgentId: run.agentId,
          findingId: finding.id,
          severity: "CRITICAL",
          reason: "UNSUPPORTED_ACTION",
          message: "Ação proposta sem cadeia de evidência válida.",
        });
      }
    }
  }

  const statements = new Map<string, { agentId: AgentRun["agentId"]; findingId: string; statement: string }>();
  for (const run of agentRuns) {
    for (const finding of run.findings) {
      const normalized = finding.statement.trim().toLowerCase();
      const negated = normalized.startsWith("não ") ? normalized.slice(4) : `não ${normalized}`;
      const opposite = statements.get(negated);
      if (opposite) {
        challenges.push({
          id: challengeId(run.agentId, finding.id, "CONTRADICTORY_FINDINGS"),
          targetAgentId: run.agentId,
          findingId: finding.id,
          severity: "CRITICAL",
          reason: "CONTRADICTORY_FINDINGS",
          message: `Conclusão contraditória com ${opposite.agentId}/${opposite.findingId}.`,
        });
      }
      statements.set(normalized, { agentId: run.agentId, findingId: finding.id, statement: finding.statement });
    }
  }

  return challenges;
}
