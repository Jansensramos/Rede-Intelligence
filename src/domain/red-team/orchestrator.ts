import { redTeamFindingSchema, specialistStructuredOutputSchema, chairStructuredOutputSchema } from "./schemas";
import { buildChairPrompt, buildSpecialistPrompt } from "./prompts";
import { createDisabledProvider, type LLMProvider, type StructuredGenerationRequest } from "./provider";
import { RED_TEAM_AGENTS, executeDeterministicSpecialists } from "./specialists";
import { buildEvidenceRequests, classifyAssumptions, crossReview, detectDisagreements, synthesizeConclusion } from "./synthesis";
import { validateEvidenceReferences } from "./evidence";
import {
  RED_TEAM_PROMPT_VERSION,
  RED_TEAM_VERSION,
  type RedTeamAgentKey,
  type RedTeamEvidencePack,
  type RedTeamFinding,
  type RedTeamObservability,
  type RedTeamReport,
} from "./types";

async function generateValidated<T>(
  provider: LLMProvider,
  request: StructuredGenerationRequest<T>,
  observability: RedTeamObservability,
): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      observability.calls += 1;
      if (attempt) observability.retries += 1;
      const response = await provider.generateStructured({ ...request, repair: attempt > 0 });
      if (response.usage?.inputTokens !== undefined) observability.inputTokens = (observability.inputTokens ?? 0) + response.usage.inputTokens;
      if (response.usage?.outputTokens !== undefined) observability.outputTokens = (observability.outputTokens ?? 0) + response.usage.outputTokens;
      return request.schema.parse(response.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida do provider";
      observability.errors.push(`${request.schemaName}: ${message}`);
    }
  }
  return null;
}

export async function runRedTeam(
  evidencePack: RedTeamEvidencePack,
  provider: LLMProvider = createDisabledProvider(),
  startedAt = evidencePack.generatedAt,
): Promise<RedTeamReport> {
  const wallStart = Date.now();
  const observability: RedTeamObservability = { calls: 0, durationMs: 0, inputTokens: null, outputTokens: null, retries: 0, errors: [] };
  const deterministic = executeDeterministicSpecialists(evidencePack);
  const agents = deterministic.agents;
  const findings = [...deterministic.findings];
  let nextFinding = findings.length;

  if (provider.configured) {
    for (const agent of agents) {
      const prompt = buildSpecialistPrompt(evidencePack, agent.agent);
      const generated = await generateValidated(provider, {
        ...prompt,
        schemaName: `red_team_${agent.agent.toLowerCase()}`,
        schema: specialistStructuredOutputSchema,
      }, observability);
      if (!generated) {
        agent.status = "PARTIAL";
        continue;
      }
      agent.providerUsed = true;
      agent.opinion = generated.opinion;
      agent.questions = Array.from(new Set([...agent.questions, ...generated.questions]));
      for (const generatedFinding of generated.findings) {
        try {
          validateEvidenceReferences(evidencePack, generatedFinding.evidenceRefs);
          const candidate: RedTeamFinding = {
            ...generatedFinding,
            id: `RTF-${String(++nextFinding).padStart(3, "0")}`,
            agent: agent.agent,
            status: "OPEN",
          };
          redTeamFindingSchema.parse(candidate);
          findings.push(candidate);
          agent.findingIds.push(candidate.id);
        } catch (error) {
          observability.errors.push(`finding_${agent.agent}: ${error instanceof Error ? error.message : "finding inválido"}`);
        }
      }
    }
  }

  for (const finding of findings) {
    redTeamFindingSchema.parse(finding);
    validateEvidenceReferences(evidencePack, finding.evidenceRefs);
  }
  const assumptionChallenges = classifyAssumptions(evidencePack);
  for (const challenge of assumptionChallenges) validateEvidenceReferences(evidencePack, challenge.evidenceRefs);
  const evidenceRequests = buildEvidenceRequests(evidencePack, findings);
  const crossReviews = crossReview(findings);
  const disagreements = detectDisagreements(findings, crossReviews);
  const conclusion = synthesizeConclusion(evidencePack, findings, evidenceRequests, disagreements);

  if (provider.configured) {
    const chairPrompt = buildChairPrompt(evidencePack, findings);
    const chair = await generateValidated(provider, { ...chairPrompt, schemaName: "red_team_chair", schema: chairStructuredOutputSchema }, observability);
    if (chair) conclusion.executiveSummary = chair.executiveSummary;
  }

  observability.durationMs = Date.now() - wallStart;
  return {
    redTeamVersion: RED_TEAM_VERSION,
    promptVersion: RED_TEAM_PROMPT_VERSION,
    startedAt,
    finishedAt: new Date(new Date(startedAt).getTime() + observability.durationMs).toISOString(),
    scenario: evidencePack.scenario,
    provider: { configured: provider.configured, name: provider.name, model: provider.model },
    evidencePack,
    agents,
    findings,
    assumptionChallenges,
    evidenceRequests,
    crossReviews,
    disagreements,
    conclusion,
    observability,
  };
}

export function specialistLabels() {
  return RED_TEAM_AGENTS as Record<RedTeamAgentKey, string>;
}
