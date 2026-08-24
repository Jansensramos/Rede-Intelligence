import { cache } from "react";
import { cookies } from "next/headers";
import { requireAuthContext } from "@/application/auth/session";
import { resolveOperationalContext, type OperationalContext } from "./operational-context";

/**
 * Seleção de contexto operacional (Fase 9K.1, ordem de serviço §7 "Seletor de Contexto").
 *
 * O plano (§AP/§AV.2) proíbe criar campo de preferência persistida no schema nesta sprint. Sem
 * mecanismo seguro de persistência (nenhuma coluna em `User`/`OrganizationMembership`/`Session` —
 * ver comentário em `operational-context.ts`, prioridade B), a seleção explícita do usuário fica
 * em um cookie de sessão (não em tabela de negócio, não em localStorage): sobrevive a navegação,
 * refresh e troca de aba, mas não é uma segunda fonte de verdade e nunca atravessa dispositivos.
 * Documentado aqui como a decisão da 9K.1 — revisar quando existir preferência persistida segura.
 */
export const ACTIVE_PROJECT_COOKIE = "rede_active_project_id";

/**
 * Resolve o contexto operacional canônico da requisição atual (organização, grupo, empresa/SPE,
 * empreendimento, usuário e capacidades), lendo a seleção explícita do cookie quando presente.
 *
 * `cache()` deduplica dentro do MESMO request React Server Component: o layout do shell e a página
 * de área de nível 1 podem ambos chamar esta função sem disparar duas consultas ao banco. Nunca
 * troca de projeto silenciosamente — `resolveOperationalContext` já revalida o `projectId` do
 * cookie contra `organizationId` e devolve `project: null` se ele não existir ou pertencer a outro
 * tenant (nunca cai para o fallback determinístico nesse caso).
 */
export const getCurrentOperationalContext = cache(async (): Promise<OperationalContext> => {
  const authContext = await requireAuthContext();
  const cookieStore = await cookies();
  const projectId = cookieStore.get(ACTIVE_PROJECT_COOKIE)?.value;
  return resolveOperationalContext(authContext, projectId ? { projectId } : undefined);
});
