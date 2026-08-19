"use server";

import { compare } from "bcryptjs";
import { redirect } from "next/navigation";
import { createUserSession, destroyUserSession } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";

export interface LoginState {
  error: string | null;
}

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Informe e-mail e senha." };

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      memberships: { orderBy: { createdAt: "asc" }, take: 1, include: { organization: true } },
    },
  });
  const validPassword = user?.isActive ? await compare(password, user.passwordHash) : false;
  const membership = user?.memberships[0];
  if (!user || !validPassword || !membership) return { error: "Credenciais inválidas." };

  await createUserSession(user.id, membership.organizationId);
  redirect("/");
}

export async function logoutAction() {
  await destroyUserSession();
  redirect("/login");
}
