import type { RuntimeConfig } from "@/infrastructure/config/runtime-config";
import { runtimeConfig } from "@/infrastructure/config/runtime-config";
import { isSafeCanonicalRef, type AiProviderAdapter } from "@/domain/ai-gateway";
import { DisabledAiProviderAdapter } from "./disabled-provider-adapter";
import { CompatibleHttpAiProviderAdapter } from "./compatible-http-adapter";
import { assertSafeAiProviderEndpoint } from "./safe-transport";
import { SYNTHETIC_MODEL_CATALOG } from "./model-catalog";

/**
 * Composicao a partir de `RuntimeConfig` (docs Fase 10A §3: "mover toda config de IA
 * para parseRuntimeConfig"). Producao sempre recusa qualquer modo != "disabled" dentro
 * do proprio `parseRuntimeConfig` (fail-closed antes mesmo de chegar aqui) - decisao 4.
 */
export function buildAiProviderAdapter(config: RuntimeConfig = runtimeConfig()): AiProviderAdapter {
  if (config.AI_GATEWAY_PROVIDER_MODE === "disabled") return new DisabledAiProviderAdapter();
  const allowedHostsRaw = config.AI_PROVIDER_ALLOWED_HOSTS;
  const baseUrlRaw = config.AI_PROVIDER_BASE_URL;
  const apiKey = config.AI_PROVIDER_API_KEY;
  const model = config.AI_DEFAULT_MODEL;
  const providerRef = config.AI_PROVIDER_NAME ?? "compatible-http";
  if (!allowedHostsRaw || !baseUrlRaw || !apiKey || !model) {
    // Configuracao incompleta para o modo "compatible_http": nunca cai para um provider
    // real parcialmente configurado - volta ao seguro por padrao (decisao 2).
    return new DisabledAiProviderAdapter();
  }
  // Correcao focal pos-auditoria (achado ALTO "provider/model nao confiaveis no ledger"):
  // providerRef/modelRef sao referencias canonicas que o Gateway vai persistir no ledger
  // depois - mesmo vindo de configuracao do administrador (nunca do cliente/resposta),
  // exigimos o formato fechado (sem URL/espaco/controle/token) antes de aceitar o valor.
  // Configuracao fora do formato nunca cai para um provider real mal-configurado.
  if (!isSafeCanonicalRef(providerRef) || !isSafeCanonicalRef(model)) return new DisabledAiProviderAdapter();
  const allowedHosts = new Set(allowedHostsRaw.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
  const baseUrl = assertSafeAiProviderEndpoint(baseUrlRaw, allowedHosts);
  const baseProfile = SYNTHETIC_MODEL_CATALOG.get("synthetic-compatible-http-test") ?? SYNTHETIC_MODEL_CATALOG.get("disabled")!;
  const profile = { ...baseProfile, provider: providerRef, modelRef: model };
  return new CompatibleHttpAiProviderAdapter({ providerRef, baseUrl, apiKey, model }, profile);
}

/**
 * Indicador leve de disponibilidade para exibicao (docs: "domínio não pode conhecer
 * provider") - nunca instancia um provider real, so le a configuracao. Espelha a
 * semantica antiga de `AIProviderStatus` (nunca "UNAVAILABLE": sem provider real, a
 * resposta grounded determinística ainda responde, por isso "LIMITED").
 */
export function aiGatewayProviderStatus(config: RuntimeConfig = runtimeConfig()): "AVAILABLE" | "LIMITED" {
  if (config.AI_GATEWAY_PROVIDER_MODE !== "compatible_http") return "LIMITED";
  const ready = Boolean(config.AI_PROVIDER_ALLOWED_HOSTS && config.AI_PROVIDER_BASE_URL && config.AI_PROVIDER_API_KEY && config.AI_DEFAULT_MODEL);
  return ready ? "AVAILABLE" : "LIMITED";
}
