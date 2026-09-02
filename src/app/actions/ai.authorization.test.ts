import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  confirmAIAction: vi.fn(), createAIConversation: vi.fn(), exportAIConversationPdf: vi.fn(), getAIBootstrap: vi.fn(),
  requestMessagePromotion: vi.fn(), saveAIFeedback: vi.fn(), saveAIInsight: vi.fn(), updateAIConversationResponseMode: vi.fn(),
}));

vi.mock("@/application/auth/session", () => ({ requireAuthContext: vi.fn(async () => ({ role: "VIEWER" })) }));
vi.mock("@/application/ai/ai-service", () => services);

import { confirmAIActionAction, createAIConversationAction, exportAIConversationAction, refreshAIBootstrapAction, requestMessagePromotionAction, saveAIFeedbackAction, saveAIInsightAction, updateAIResponseModeAction } from "./ai";

describe("autorização direta das Server Actions da REDE AI", () => {
  beforeEach(() => vi.clearAllMocks());

  it("nega todas as actions públicas ao VIEWER antes de chamar o serviço", async () => {
    const results = await Promise.all([
      createAIConversationAction("project"),
      updateAIResponseModeAction("conversation", "DETAILED"),
      confirmAIActionAction("action", "CONFIRM"),
      saveAIInsightAction("message", "Título"),
      saveAIFeedbackAction("message", "POSITIVE"),
      requestMessagePromotionAction("message", "ACTION"),
      exportAIConversationAction("conversation"),
      refreshAIBootstrapAction("project"),
    ]);
    expect(results.every((result) => !result.ok && result.error === "Seu perfil não possui acesso aos recursos da REDE AI.")).toBe(true);
    expect(Object.values(services).every((service) => service.mock.calls.length === 0)).toBe(true);
  });
});
