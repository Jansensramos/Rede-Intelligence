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
import { INTERNAL_CLIENT_ADDRESS_HEADER, UNKNOWN_CLIENT_ADDRESS } from "@/infrastructure/http/trusted-proxy";
import { decideLoginOrganization } from "@/domain/auth/organization-selection";

export interface LoginState {
  error: string | null;
  email?: string;
  requiresOrganization?: boolean;
  organizations?: Array<{ id: string; name: string }>;
}

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const requestedOrganizationId = String(formData.get("organizationId") ?? "").trim();
  if (!email || !password) return { error: "Informe e-mail e senha." };

  const requestHeaders = await headers();
  const correlationId = requestHeaders.get("x-correlation-id") ?? undefined;
  const clientAddress = requestHeaders.get(INTERNAL_CLIENT_ADDRESS_HEADER) ?? UNKNOWN_CLIENT_ADDRESS;

  const user = await prisma.user.findUnique({ where: { email } });
  const memberships = user
    ? await prisma.organizationMembership.findMany({
        where: { userId: user.id, isActive: true },
        orderBy: [{ organization: { name: "asc" } }, { organizationId: "asc" }],
        include: { organization: true },
      })
    : [];
  const membership = memberships[0];
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
  if (!user || !validPassword || memberships.length === 0) {
    logger.warn("Tentativa de login recusada.", { component: "auth", event: "login_rejected", correlationId, organizationId: rateLimitOrganization });
    return { error: INVALID_LOGIN_MESSAGE };
  }

  const organizationDecision = decideLoginOrganization(memberships, requestedOrganizationId);
  if (organizationDecision.kind === "SELECTION_REQUIRED") {
    return {
      error: null,
      email,
      requiresOrganization: true,
      organizations: organizationDecision.organizations,
    };
  }
  if (organizationDecision.kind !== "SELECTED") {
    logger.warn("Contexto organizacional de login recusado.", { component: "auth", event: "organization_rejected", correlationId });
    return { error: INVALID_LOGIN_MESSAGE };
  }

  await createUserSession(user.id, organizationDecision.membership.organizationId);
  redirect("/");
}

export async function logoutAction() {
  await destroyUserSession();
  redirect("/login");
}
