import type { MembershipRole } from "@prisma/client";
import type {
  AgentFinding,
  AgentRun,
  CognitiveAgentId,
  CognitiveContext,
  CognitiveEvidence,
  CognitiveReasoner,
  CognitiveToolName,
  CognitiveToolPort,
} from "./types";

export interface CognitiveAgentSpec {
  id: CognitiveAgentId;
  label: string;
  focus: string;
  minimumRole: MembershipRole;
  allowedTools: readonly CognitiveToolName[];
}

const ROLE_RANK: Record<MembershipRole, number> = {
  VIEWER: 0,
  REVIEWER: 1,
  ANALYST: 2,
  ADMIN: 3,
  OWNER: 4,
};

const SPECS: readonly CognitiveAgentSpec[] = [
  {
    id: "CFO",
    label: "CFO",
    focus: "viabilidade, caixa, retorno, exposição financeira e riscos",
    minimumRole: "REVIEWER",
    allowedTools: ["getApprovedViabilitySummary", "getActiveRisks"],
  },
  {
    id: "ENGINEERING",
    label: "Engenharia",
    focus: "avanço físico, execução, restrições técnicas e riscos de obra",
    minimumRole: "REVIEWER",
    allowedTools: ["getEngineeringProgress", "getActiveRisks"],
  },
  {
    id: "COMMERCIAL",
    label: "Comercial",
    focus: "produto, vendas, premissas comerciais e impacto econômico",
    minimumRole: "REVIEWER",
    allowedTools: ["getApprovedViabilitySummary", "getActiveRisks"],
  },
  {
    id: "LEGAL",
    label: "Jurídico",
    focus: "evidências jurídicas, obrigações, contingências e riscos",
    minimumRole: "REVIEWER",
    allowedTools: ["getVerifiedLegalEvidence", "getActiveRisks"],
  },
  {
    id: "MARKET",
    label: "Mercado",
    focus: "aderência de produto, premissas de mercado e exposição de cenário",
    minimumRole: "REVIEWER",
    allowedTools: ["getApprovedViabilitySummary", "getActiveRisks"],
  },
  {
    id: "INVESTOR",
    label: "Investidor",
    focus: "retorno, risco, proteção de capital e qualidade das evidências",
    minimumRole: "REVIEWER",
    allowedTools: ["getApprovedViabilitySummary", "getActiveRisks", "getVerifiedLegalEvidence"],
  },
  {
    id: "INCORPORATOR",
    label: "Incorporador",
    focus: "síntese multidisciplinar do empreendimento e capacidade de execução",
    minimumRole: "REVIEWER",
    allowedTools: [
      "getApprovedViabilitySummary",
      "getActiveRisks",
      "getEngineeringProgress",
      "getVerifiedLegalEvidence",
    ],
  },
];

const SPEC_BY_ID = new Map<CognitiveAgentId, CognitiveAgentSpec>(SPECS.map((spec) => [spec.id, spec]));

export function listCognitiveAgents(): readonly CognitiveAgentSpec[] {
  return SPECS;
}

export function getCognitiveAgentSpec(id: CognitiveAgentId): CognitiveAgentSpec {
  const spec = SPEC_BY_ID.get(id);
  if (!spec) throw new Error(`Agente não registrado: ${id}`);
  return spec;
}

export const deterministicEvidenceReasoner: CognitiveReasoner = {
  async analyze(input): Promise<AgentFinding[]> {
    return input.evidence.map((evidence, index) => ({
      id: `${input.agentId.toLowerCase()}-finding-${index + 1}`,
      agentId: input.agentId,
      statement: `${input.focus}: evidência ${evidence.tool} disponível para a decisão.`,
      evidenceRefs: [evidence.id],
      confidence: evidence.confidence,
      severity: "INFO",
    }));
  },
};

function assertRole(role: MembershipRole, minimumRole: MembershipRole): void {
  if (ROLE_RANK[role] < ROLE_RANK[minimumRole]) {
    throw new Error("COGNITIVE_AGENT_ACCESS_DENIED");
  }
}

function toEvidence(
  agentId: CognitiveAgentId,
  tool: CognitiveToolName,
  rawEvidence: string,
  index: number,
): CognitiveEvidence {
  return {
    id: `${agentId.toLowerCase()}-${tool}-${index + 1}`,
    tool,
    summary: `Evidência validada pela Tool Layer: ${tool}`,
    rawEvidence,
    confidence: "HIGH",
  };
}

export async function runCognitiveAgent(
  context: CognitiveContext,
  agentId: CognitiveAgentId,
  toolPort: CognitiveToolPort,
  reasoner: CognitiveReasoner = deterministicEvidenceReasoner,
): Promise<AgentRun> {
  const spec = getCognitiveAgentSpec(agentId);
  assertRole(context.role, spec.minimumRole);

  const results = await Promise.all(
    spec.allowedTools.map((tool) => toolPort.execute(agentId, tool)),
  );

  const evidence: CognitiveEvidence[] = [];
  const refusedTools: CognitiveToolName[] = [];

  results.forEach((result, index) => {
    if (result.status === "COMPLETED" && result.evidence) {
      evidence.push(toEvidence(agentId, result.tool, result.evidence, index));
      return;
    }
    refusedTools.push(result.tool);
  });

  const findings = await reasoner.analyze({
    agentId,
    focus: spec.focus,
    objective: context.objective,
    evidence,
  });

  return {
    agentId,
    focus: spec.focus,
    evidence,
    findings,
    refusedTools,
  };
}
