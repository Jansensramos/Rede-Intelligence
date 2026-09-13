import type { AiProviderAdapter, AiRequest, AiResponse } from "@/domain/ai-gateway";
import { AiGatewayError } from "@/domain/ai-gateway";
import { DISABLED_PROVIDER_REF, SYNTHETIC_MODEL_CATALOG } from "./model-catalog";

/**
 * Adapter padrao seguro (docs Fase 10A §14 / decisao 2). Nunca toca rede, nunca consome
 * orcamento (o AiGateway nao reserva orcamento para uma chamada que sabe que vai falhar),
 * e retorna sempre o mesmo erro permanente e sem fallback fabricado.
 */
export class DisabledAiProviderAdapter implements AiProviderAdapter {
  readonly ref = DISABLED_PROVIDER_REF;
  readonly profile = SYNTHETIC_MODEL_CATALOG.get(DISABLED_PROVIDER_REF)!;

  async execute(request: AiRequest, signal: AbortSignal): Promise<AiResponse> {
    // `signal` faz parte do contrato `AiProviderAdapter#execute` (todo adapter real precisa
    // dele para abortar transporte em voo) mas este adapter nunca chega a iniciar
    // transporte algum - referenciado explicitamente (sem efeito) para deixar isso
    // documentado no proprio tipo, em vez de renomear o parametro com prefixo `_` (o que
    // exigiria contornar `@typescript-eslint/no-unused-vars` sem desativar a regra).
    void signal;
    throw new AiGatewayError(
      "Nenhum provider de IA esta habilitado nesta organizacao/ambiente.",
      "PROVIDER_UNAVAILABLE",
      false,
      request.correlationId,
    );
  }
}
