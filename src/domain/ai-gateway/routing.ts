import type { AiModelCapability, AiModelProfile, AiRequest, AiRoutingPolicy } from "./types";

/**
 * Roteamento provider-neutral (docs Fase 10A §4). So decide por capability/task/
 * criticidade/politica do tenant - nunca por escolha do cliente. Sem provider/modelo
 * autorizado, retorna null: o AiGateway converte isso em erro seguro e permanente
 * (PROVIDER_UNAVAILABLE ou CONFIGURATION), nunca em fallback fabricado.
 */

export interface RoutingCandidate {
  providerRef: string;
  profile: AiModelProfile;
}

export interface RoutingDecision {
  candidate: RoutingCandidate;
  fallbackCount: number;
}

function hasAllCapabilities(profile: AiModelProfile, required: AiModelCapability[]): boolean {
  return required.every((capability) => profile.capabilities.includes(capability));
}

function isAllowedForRequest(policy: AiRoutingPolicy, request: AiRequest, providerRef: string): boolean {
  if (!policy.allowedProviders.includes(providerRef)) return false;
  return request.requiredCapabilities.every((capability) => (policy.allowedModelsByCapability[capability] ?? []).includes(providerRef));
}

/**
 * `requiresHumanApprovalAbove` bloqueia roteamento automatico para criticidade acima do
 * limiar - nunca aprova sozinho (decisao "nenhuma decisao autonoma").
 */
export function requiresHumanApproval(policy: AiRoutingPolicy, request: AiRequest): boolean {
  return policy.requiresHumanApprovalAbove === "HIGH" && request.criticality === "HIGH";
}

/**
 * Tenta o provider primario e depois a cadeia de fallback declarada na politica, sempre
 * validando capacidades e allowlist do tenant. Retorna null quando nenhum candidato
 * elegivel existe (por exemplo: catalogo vazio porque so o provider "disabled" esta
 * ativo, ou nenhum modelo da cadeia possui as capabilities exigidas).
 */
export function selectRoute(
  policy: AiRoutingPolicy,
  request: AiRequest,
  catalog: ReadonlyMap<string, AiModelProfile>,
): RoutingDecision | null {
  const chain = [policy.allowedProviders[0], ...policy.fallbackChain].filter((value, index, all) => value && all.indexOf(value) === index) as string[];
  let fallbackCount = 0;
  for (const providerRef of chain) {
    if (fallbackCount > policy.maxFallbackAttempts) break;
    const profile = catalog.get(providerRef);
    if (profile && isAllowedForRequest(policy, request, providerRef) && hasAllCapabilities(profile, request.requiredCapabilities)) {
      return { candidate: { providerRef, profile }, fallbackCount };
    }
    fallbackCount += 1;
  }
  return null;
}
