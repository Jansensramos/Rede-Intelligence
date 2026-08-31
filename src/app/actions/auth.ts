"use server";

import { compare } from "bcryptjs";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { createUserSession, destroyUserSession } from "@/application/auth/session";
import { checkAndConsumeRateLimit } from "@/application/integrations/resilience-service";
import { prisma } from "@/infrastructure/database/prisma";
import { logger } from "@/infrastructure/observability/logger";
import { INVALID_LOGIN_MESSAGE, LOGIN_RATE_LIMIT_POLICY, passwordHashForVerification } from "@/domain/auth/login-security";

export interface LoginState {
  error: string | null;
}

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Informe e-mail e senha." };

  const requestHeaders = await headers();
  const correlationId = requestHeaders.get("x-correlation-id") ?? undefined;
  const clientAddress = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? requestHeaders.get("x-real-ip") ?? "unknown";

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      memberships: { orderBy: { createdAt: "asc" }, take: 1, include: { organization: true } },
    },
  });
  const membership = user?.memberships[0];
  const rateLimitOrganization = membership?.organizationId ?? (await prisma.organization.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } }))?.id;
  if (rateLimitOrganization) {
    const identityHash = createHash("sha256").update(`${email}:${clientAddress}`).digest("hex");
    const decision = await checkAndConsumeRateLimit(rateLimitOrganization, `login:${identityHash}`, LOGIN_RATE_LIMIT_POLICY);
    if (!decision.allowed) {
      logger.warn("Tentativa de login limitada.", { component: "auth", event: "login_rate_limited", correlationId, organizationId: rateLimitOrganization });
      return { error: INVALID_LOGIN_MESSAGE };
    }
  }
  const validPassword = await compare(password, passwordHashForVerification(user));
  if (!user || !validPassword || !membership) {
    logger.warn("Tentativa de login recusada.", { component: "auth", event: "login_rejected", correlationId, organizationId: rateLimitOrganization });
    return { error: INVALID_LOGIN_MESSAGE };
  }

  await createUserSession(user.id, membership.organizationId);
  redirect("/");
}

export async function logoutAction() {
  await destroyUserSession();
  redirect("/login");
}
