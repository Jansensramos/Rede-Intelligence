import type { AIModelPolicy, AIProvider, AITask } from "./types";

const FALLBACK_POLICY: Record<AITask, Omit<AIModelPolicy, "task">> = {
  CHAT: { provider: "rede-deterministic", model: "rede-grounded-v1", maxTokens: 1200, temperature: 0.1, enabled: true },
  ANALYSIS: { provider: "rede-deterministic", model: "rede-grounded-v1", maxTokens: 1800, temperature: 0.1, enabled: true },
  SYNTHESIS: { provider: "rede-deterministic", model: "rede-grounded-v1", maxTokens: 1800, temperature: 0.1, enabled: true },
  DOCUMENT_SUMMARY: { provider: "rede-deterministic", model: "rede-grounded-v1", maxTokens: 1600, temperature: 0, enabled: true },
  COMPARE: { provider: "rede-deterministic", model: "rede-grounded-v1", maxTokens: 1800, temperature: 0, enabled: true },
  TOOL_ORCHESTRATION: { provider: "rede-deterministic", model: "rede-grounded-v1", maxTokens: 900, temperature: 0, enabled: true },
  EXTRACTION: { provider: "rede-deterministic", model: "rede-grounded-v1", maxTokens: 700, temperature: 0, enabled: true },
  RED_TEAM_ASSIST: { provider: "rede-deterministic", model: "rede-grounded-v1", maxTokens: 1800, temperature: 0.1, enabled: true },
  REPORT_NARRATIVE: { provider: "rede-deterministic", model: "rede-grounded-v1", maxTokens: 2400, temperature: 0.1, enabled: true },
};

export class AIModelRouter {
  constructor(private readonly provider: AIProvider, private readonly policies: AIModelPolicy[]) {}
  route(task: AITask): { provider: AIProvider; policy: AIModelPolicy } {
    const configured = this.policies.find((item) => item.task === task && item.enabled && item.provider === this.provider.name);
    return { provider: this.provider, policy: configured ?? { task, ...FALLBACK_POLICY[task], provider: this.provider.name, model: this.provider.defaultModel } };
  }
}
