import { describe, expect, it, vi } from "vitest";
import {
  buildDecisionProposal,
  buildLearningReport,
  CognitiveStack,
  planAutopilot,
  RedeOperator,
  runCognitiveAgent,
  runInvestmentCommittee,
  runRedTeam2,
  type CognitiveReasoner,
  type CognitiveToolPort,
  type OperatorPort,
} from "@/application/cognitive";

const context = {
  organizationId: "org-1",
  userId: "user-1",
  role: "OWNER" as const,
  conversationId: "conv-1",
  projectId: "project-1",
  objective: "Decidir se o empreendimento pode avançar para a próxima etapa.",
};

const toolPort: CognitiveToolPort = {
  async execute(_agentId, tool) {
    return {
      tool,
      status: "COMPLETED",
      evidence: JSON.stringify({ tool, verified: true }),
    };
  },
};

describe("Fases 10D-10J - Cognitive Stack", () => {
  it("10D executa agente somente com as ferramentas permitidas", async () => {
    const run = await runCognitiveAgent(context, "LEGAL", toolPort);
    expect(run.agentId).toBe("LEGAL");
    expect(run.evidence.map((item) => item.tool)).toEqual([
      "getVerifiedLegalEvidence",
      "getActiveRisks",
    ]);
  });

  it("10D bloqueia perfil abaixo da alçada mínima", async () => {
    await expect(
      runCognitiveAgent({ ...context, role: "VIEWER" }, "CFO", toolPort),
    ).rejects.toThrow("COGNITIVE_AGENT_ACCESS_DENIED");
  });

  it("10E marca conclusão sem evidência como crítica", async () => {
    const reasoner: CognitiveReasoner = {
      async analyze() {
        return [{
          id: "unsupported",
          agentId: "CFO",
          statement: "Conclusão sem fonte.",
          evidenceRefs: [],
          confidence: "LOW",
          severity: "CRITICAL",
        }];
      },
    };
    const run = await runCognitiveAgent(context, "CFO", toolPort, reasoner);
    const challenges = runRedTeam2([run]);
    expect(challenges.some((item) => item.reason === "NO_EVIDENCE")).toBe(true);
    expect(challenges.some((item) => item.reason === "LOW_CONFIDENCE")).toBe(true);
  });

  it("10F sempre devolve proposta para decisão humana", () => {
    const proposal = buildDecisionProposal("objetivo", [], []);
    expect(proposal.requiresHumanDecision).toBe(true);
    expect(proposal.disposition).toBe("HOLD_FOR_EVIDENCE");
  });

  it("10G executa comitê multidisciplinar e mantém status pendente", async () => {
    const report = await runInvestmentCommittee({
      context,
      toolPort,
      agents: ["CFO", "ENGINEERING", "LEGAL"],
    });
    expect(report.agents).toHaveLength(3);
    expect(report.status).toBe("PENDING_HUMAN_DECISION");
    expect(report.proposal.requiresHumanDecision).toBe(true);
  });

  it("10H impede mutação sem aprovação humana", async () => {
    const execute = vi.fn(async (action) => ({ actionId: action.id, status: "COMPLETED" as const }));
    const operator = new RedeOperator(
      { execute } satisfies OperatorPort,
      { allowedCapabilities: ["financial.approve"], allowReadOnlyWithoutApproval: true },
    );
    const result = await operator.execute({
      id: "action-1",
      capability: "financial.approve",
      mode: "MUTATION",
      payload: {},
      reason: "teste",
    });
    expect(result.status).toBe("REFUSED");
    expect(result.reason).toBe("HUMAN_APPROVAL_REQUIRED");
    expect(execute).not.toHaveBeenCalled();
  });

  it("10I prepara ação, mas não inventa aprovação humana", () => {
    const recommendations = planAutopilot(
      [{
        id: "signal-1",
        category: "FINANCIAL",
        severity: "CRITICAL",
        title: "Desvio de caixa",
        evidenceRefs: ["ev-1"],
        suggestedCapability: "financial.approve",
      }],
      { mode: "ASSISTED", mutationCapabilities: ["financial.approve"] },
    );
    expect(recommendations[0]?.proposedAction?.mode).toBe("MUTATION");
    expect(recommendations[0]?.proposedAction?.humanApprovalId).toBeUndefined();
    expect(recommendations[0]?.requiresHumanApproval).toBe(true);
  });

  it("10J mede previsto x realizado sem autoalterar política", () => {
    const report = buildLearningReport([
      {
        id: "obs-1",
        decisionId: "d1",
        predicted: { metric: "margem", value: 20 },
        actual: { value: 18 },
        recordedAt: "2026-09-01T00:00:00.000Z",
      },
      {
        id: "obs-2",
        decisionId: "d2",
        predicted: { metric: "margem", value: 20 },
        actual: { value: 16 },
        recordedAt: "2026-09-02T00:00:00.000Z",
      },
    ]);
    expect(report.metrics[0]).toMatchObject({
      metric: "margem",
      sampleSize: 2,
      meanAbsoluteError: 3,
      meanBias: -3,
    });
    expect(report.policyMutationAllowed).toBe(false);
  });

  it("integra 10D-10J em um único stack", async () => {
    const operatorPort: OperatorPort = {
      async execute(action) {
        return { actionId: action.id, status: "COMPLETED", output: { ok: true } };
      },
    };
    const stack = new CognitiveStack({
      toolPort,
      operatorPort,
      operatorPolicy: {
        allowedCapabilities: ["project.read"],
        allowReadOnlyWithoutApproval: true,
      },
      autopilotPolicy: {
        mode: "ADVISORY",
        mutationCapabilities: [],
      },
    });

    const committee = await stack.committee(context, ["CFO", "LEGAL"]);
    expect(committee.agents).toHaveLength(2);

    const recommendations = stack.autopilot([{
      id: "risk-1",
      category: "RISK",
      severity: "WARNING",
      title: "Risco ativo",
      evidenceRefs: ["ev-1"],
    }]);
    expect(recommendations).toHaveLength(1);

    const operation = await stack.operate({
      id: "read-1",
      capability: "project.read",
      mode: "READ_ONLY",
      payload: {},
      reason: "consulta",
    });
    expect(operation.status).toBe("COMPLETED");
  });
});
