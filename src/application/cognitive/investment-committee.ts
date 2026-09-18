import { runCognitiveAgent } from "./agents";
import { buildDecisionProposal } from "./decision-engine";
import { runRedTeam2 } from "./red-team";
import {
  COGNITIVE_STACK_VERSION,
  type CognitiveAgentId,
  type CognitiveContext,
  type CognitiveReasoner,
  type CognitiveToolPort,
  type InvestmentCommitteeReport,
} from "./types";

const DEFAULT_COMMITTEE: readonly CognitiveAgentId[] = [
  "CFO",
  "ENGINEERING",
  "COMMERCIAL",
  "LEGAL",
  "MARKET",
  "INVESTOR",
  "INCORPORATOR",
];

export async function runInvestmentCommittee(input: {
  context: CognitiveContext;
  toolPort: CognitiveToolPort;
  reasoner?: CognitiveReasoner;
  agents?: readonly CognitiveAgentId[];
}): Promise<InvestmentCommitteeReport> {
  const agents = input.agents ?? DEFAULT_COMMITTEE;

  const runs = await Promise.all(
    agents.map((agentId) => runCognitiveAgent(input.context, agentId, input.toolPort, input.reasoner)),
  );
  const challenges = runRedTeam2(runs);
  const proposal = buildDecisionProposal(input.context.objective, runs, challenges);

  return {
    objective: input.context.objective,
    agents: runs,
    challenges,
    proposal,
    status: "PENDING_HUMAN_DECISION",
    stackVersion: COGNITIVE_STACK_VERSION,
  };
}
