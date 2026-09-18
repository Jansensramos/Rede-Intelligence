import type { OperatorAction, OperatorActionResult, OperatorPort } from "./types";

export interface OperatorPolicy {
  allowedCapabilities: readonly string[];
  allowReadOnlyWithoutApproval: boolean;
}

export class RedeOperator {
  constructor(
    private readonly port: OperatorPort,
    private readonly policy: OperatorPolicy,
  ) {}

  async execute(action: OperatorAction): Promise<OperatorActionResult> {
    if (!this.policy.allowedCapabilities.includes(action.capability)) {
      return {
        actionId: action.id,
        status: "REFUSED",
        reason: "CAPABILITY_NOT_ALLOWED",
      };
    }

    if (action.mode === "MUTATION" && !action.humanApprovalId) {
      return {
        actionId: action.id,
        status: "REFUSED",
        reason: "HUMAN_APPROVAL_REQUIRED",
      };
    }

    if (
      action.mode === "READ_ONLY"
      && !this.policy.allowReadOnlyWithoutApproval
      && !action.humanApprovalId
    ) {
      return {
        actionId: action.id,
        status: "REFUSED",
        reason: "HUMAN_APPROVAL_REQUIRED",
      };
    }

    return this.port.execute(action);
  }
}
