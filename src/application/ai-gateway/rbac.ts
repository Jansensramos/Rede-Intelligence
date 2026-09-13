import type { MembershipRole } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { assertProtectedReadCapability, type ProtectedReadCapability } from "@/domain/auth/read-capabilities";

/**
 * RBAC do AI Gateway (docs Fase 10A / decisao 11). VIEWER nunca tem nenhuma capacidade
 * de IA. AI_USE sempre acumula (nunca substitui) a capacidade de leitura do dominio
 * acessado (decisao 12) - usar IA dentro de /financeiro exige AI_USE E FINANCIAL_READ.
 */
export type AiCapability = "AI_USE" | "AI_ADMIN" | "AI_BUDGET_READ" | "AI_BUDGET_MANAGE" | "AI_AUDIT_READ";

const AI_CAPABILITY_MATRIX: Record<AiCapability, ReadonlySet<MembershipRole>> = {
  AI_USE: new Set(["OWNER", "ADMIN", "ANALYST", "REVIEWER"]),
  AI_ADMIN: new Set(["OWNER"]),
  AI_BUDGET_READ: new Set(["OWNER", "ADMIN"]),
  AI_BUDGET_MANAGE: new Set(["OWNER"]),
  AI_AUDIT_READ: new Set(["OWNER", "ADMIN", "REVIEWER"]),
};

export class AiAccessDeniedError extends Error {
  readonly name = "AiAccessDeniedError";
  constructor(message = "Seu perfil nao possui esta capacidade de IA.") { super(message); }
}

export function hasAiCapability(role: MembershipRole, capability: AiCapability): boolean {
  return AI_CAPABILITY_MATRIX[capability].has(role);
}

export function assertAiCapability(role: MembershipRole, capability: AiCapability) {
  if (!hasAiCapability(role, capability)) throw new AiAccessDeniedError();
}

/**
 * CHOKE POINT UNICO e obrigatorio de qualquer superficie que aciona o AiGateway ou executa
 * uma ferramenta de IA (correcao critica pos-reauditoria, achado MEDIO "choke point de
 * RBAC" - anteriormente esta funcao existia, era testada, mas nunca era chamada por
 * nenhuma das 4 superficies reais, que duplicavam manualmente `assertAiCapability` +
 * `assertProtectedReadCapability` cada uma a seu proprio jeito, criando risco real de uma
 * superficie ser corrigida e outra esquecida).
 *
 * Exige, sempre, nesta ordem: AI_READ (leitura basica da area de IA) E AI_USE (capacidade
 * de IA propriamente dita) - nenhuma substitui a outra silenciosamente - e, quando
 * `domainCapability` e informado, tambem a capacidade de leitura do dominio de origem
 * (decisao 12: usar IA dentro de `/financeiro` exige AI_USE E FINANCIAL_READ,
 * cumulativamente). Sempre a partir do `AuthContext` ja resolvido e autenticado pela
 * sessao (nunca de um campo do payload - nenhum papel se autoeleva); a validacao de
 * membership/organizacao ja aconteceu na resolucao do `AuthContext` (`requireAuthContext`/
 * `getAuthContext`), antes deste ponto.
 *
 * `askRedeAI`, `tool-registry.execute`, a Server Action (`authorizedAIContext`) e a rota
 * `/api/ai/chat` chamam EXCLUSIVAMENTE esta funcao - nenhuma delas monta a combinacao
 * manualmente. Um teste arquitetural dedicado (`rbac-choke-point.test.ts`) falha se uma
 * nova superficie de IA (Server Action, rota, execucao de ferramenta ou call site do
 * Gateway) for adicionada sem passar por aqui.
 *
 * Nota de honestidade documentada (Fase 10A, hoje): `AI_USE` e `AI_READ` alcancam
 * exatamente o mesmo conjunto de papeis (`OWNER`/`ADMIN`/`ANALYST`/`REVIEWER`) - este
 * choke point fecha o risco estrutural de duplicacao/deriva futura, mas nao reduz a
 * superficie de acesso hoje (nenhum papel atual passa em um e falha no outro). O ganho
 * atual e preventivo, nao uma correcao de um bypass ja explorado.
 */
export function assertAiUse(context: Pick<AuthContext, "role">, domainCapability?: ProtectedReadCapability) {
  assertProtectedReadCapability(context.role, "AI_READ");
  assertAiCapability(context.role, "AI_USE");
  if (domainCapability) assertProtectedReadCapability(context.role, domainCapability);
}

export function isAiAccessDeniedError(error: unknown): error is AiAccessDeniedError {
  return error instanceof AiAccessDeniedError;
}
