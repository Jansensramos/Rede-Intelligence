"use server";

/**
 * Alteração explícita de contexto operacional (Fase 9K.1, ordem de serviço §7 "Seletor de
 * Contexto"). Nunca troca de projeto silenciosamente: o cookie só é gravado depois de o
 * `projectId` ser revalidado contra `organizationId` do usuário autenticado (mesma checagem de
 * tenant que `resolveOperationalContext` já aplica) — um id inválido ou de outra organização
 * nunca chega a alterar a seleção ativa.
 */

import { cookies } from "next/headers";
import { requireAuthContext } from "@/application/auth/session";
import { ACTIVE_PROJECT_COOKIE } from "@/application/workspace/current-context";
import { prisma } from "@/infrastructure/database/prisma";

export async function setActiveProjectAction(projectId: string) {
  const context = await requireAuthContext();
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: context.organizationId }, select: { id: true } });
  if (!project) return { ok: false as const, error: "Empreendimento não encontrado nesta organização." };

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_PROJECT_COOKIE, project.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return { ok: true as const };
}

/**
 * Recuperação de contexto (achado da revisão pós-fechamento da 9K.1): `resolveOperationalContext`
 * nunca cai para o fallback determinístico quando a seleção explícita do cookie não resolve mais
 * (projeto apagado, reseed, cookie de outra organização) — decisão correta (evita trocar de projeto
 * às escondidas), mas antes disso deixava o usuário sem NENHUMA ação possível na tela (nenhuma
 * sidebar, nenhum seletor). Esta ação limpa a seleção presa; a próxima resolução volta a cair no
 * fallback determinístico (projeto mais antigo da organização) só se nenhuma seleção nova for feita.
 */
export async function clearActiveProjectAction() {
  await requireAuthContext();
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_PROJECT_COOKIE);
  return { ok: true as const };
}
