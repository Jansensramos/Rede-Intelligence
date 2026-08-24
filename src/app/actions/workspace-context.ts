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
