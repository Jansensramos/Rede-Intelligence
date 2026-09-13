import { buildAiProviderAdapter } from "@/infrastructure/ai-gateway/config";
import type { AiGateway, AiModelCapability, AiRoutingPolicy, AiTaskCategory } from "@/domain/ai-gateway";
import { createAiGateway } from "./gateway";
import type { GatewayLedgerContext } from "./ledger-service";

const ALL_CAPABILITIES: AiModelCapability[] = ["TEXT_GENERATION", "STRUCTURED_OUTPUT", "EMBEDDINGS", "VISION", "TOOL_USE", "STREAMING"];

/**
 * Composicao real usada pelos chamadores (docs Fase 10A: "unico ponto permitido para
 * novas execucoes de IA"). Politica de roteamento com um unico provider ativo por
 * ambiente - decisao 1 ("nenhum provedor comercial autorizado nesta rodada") faz com que
 * hoje isto seja sempre o adapter "disabled", em qualquer ambiente de producao.
 */
export function createOrganizationAiGateway(organizationId: string, task: AiTaskCategory, ledger: GatewayLedgerContext): AiGateway {
  const adapter = buildAiProviderAdapter();
  const allowedModelsByCapability = Object.fromEntries(
    ALL_CAPABILITIES.map((capability) => [capability, adapter.profile.capabilities.includes(capability) ? [adapter.ref] : []]),
  ) as Record<AiModelCapability, string[]>;
  const routingPolicy: AiRoutingPolicy = {
    organizationId,
    task,
    allowedProviders: [adapter.ref],
    allowedModelsByCapability,
    fallbackChain: [],
    maxFallbackAttempts: 0,
  };
  return createAiGateway({ adapter, routingPolicy, ledger });
}
