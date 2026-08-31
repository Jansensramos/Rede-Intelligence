import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { MembershipRole } from "@prisma/client";
import { prisma } from "@/infrastructure/database/prisma";

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const cookieName = process.env.SESSION_COOKIE_NAME ?? "rede_session";

export interface AuthContext {
  sessionId: string;
  userId: string;
  userName: string;
  userEmail: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: MembershipRole;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createUserSession(userId: string, organizationId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId, organizationId, expiresAt },
  });

  const cookieStore = await cookies();
  cookieStore.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
    maxAge: Math.floor(SESSION_DURATION_MS / 1000),
  });
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true, organization: true },
  });
  if (!session || !session.user.isActive || session.expiresAt <= new Date()) {
    if (session) await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  const membership = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: session.organizationId,
        userId: session.userId,
      },
    },
  });
  if (!membership) return null;

  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }

  return {
    sessionId: session.id,
    userId: session.userId,
    userName: session.user.name,
    userEmail: session.user.email,
    organizationId: session.organizationId,
    organizationName: session.organization.name,
    organizationSlug: session.organization.slug,
    role: membership.role,
  };
}

export async function requireAuthContext() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  return context;
}

export async function destroyUserSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  cookieStore.delete(cookieName);
}
