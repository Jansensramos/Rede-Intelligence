import type { AuthContext } from "@/application/auth/session";
import { executeAiTool } from "@/application/ai-tools";
import type { AiToolName } from "@/domain/ai-tools";
import type {
  CognitiveAgentId,
  CognitiveToolName,
  CognitiveToolPort,
  CognitiveToolResult,
} from "./types";

export function createExistingToolLayerPort(
  context: AuthContext,
  conversationId: string,
): CognitiveToolPort {
  return {
    async execute(
      _agentId: CognitiveAgentId,
      tool: CognitiveToolName,
    ): Promise<CognitiveToolResult> {
      const result = await executeAiTool(
        context,
        conversationId,
        tool as AiToolName,
        {},
      );

      if (result.status === "COMPLETED") {
        return {
          tool,
          status: "COMPLETED",
          evidence: result.evidence,
        };
      }

      return {
        tool,
        status: result.status,
        errorCode: result.error.code,
      };
    },
  };
}
