import { planAutopilot, type AutopilotPolicy } from "./autopilot";
import { runInvestmentCommittee } from "./investment-committee";
import { buildLearningReport } from "./learning-loop";
import { RedeOperator, type OperatorPolicy } from "./operator";
import type {
  AutopilotSignal,
  CognitiveAgentId,
  CognitiveContext,
  CognitiveReasoner,
  CognitiveToolPort,
  InvestmentCommitteeReport,
  LearningObservation,
  LearningReport,
  OperatorAction,
  OperatorActionResult,
  OperatorPort,
} from "./types";

export interface CognitiveStackDependencies {
  toolPort: CognitiveToolPort;
  reasoner?: CognitiveReasoner;
  operatorPort: OperatorPort;
  operatorPolicy: OperatorPolicy;
  autopilotPolicy: AutopilotPolicy;
}

export class CognitiveStack {
  private readonly operator: RedeOperator;

  constructor(private readonly dependencies: CognitiveStackDependencies) {
    this.operator = new RedeOperator(
      dependencies.operatorPort,
      dependencies.operatorPolicy,
    );
  }

  committee(
    context: CognitiveContext,
    agents?: readonly CognitiveAgentId[],
  ): Promise<InvestmentCommitteeReport> {
    return runInvestmentCommittee({
      context,
      toolPort: this.dependencies.toolPort,
      reasoner: this.dependencies.reasoner,
      agents,
    });
  }

  autopilot(signals: readonly AutopilotSignal[]) {
    return planAutopilot(signals, this.dependencies.autopilotPolicy);
  }

  operate(action: OperatorAction): Promise<OperatorActionResult> {
    return this.operator.execute(action);
  }

  learn(observations: readonly LearningObservation[]): LearningReport {
    return buildLearningReport(observations);
  }
}
