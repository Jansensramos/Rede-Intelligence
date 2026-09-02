import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Prisma, type MembershipRole } from "@prisma/client";
import { prisma } from "@/infrastructure/database/prisma";

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60_000;
const cookieName = process.env.SESSION_COOKIE_NAME ?? "rede_session";
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function sessionCookieOptions(expiresAt: Date, environment = process.env.NODE_ENV) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: environment === "production",
    path: "/",
    expires: expiresAt,
    maxAge: Math.floor(SESSION_DURATION_MS / 1000),
  };
}

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

export class AuthenticationContextError extends Error {
  readonly name = "AuthenticationContextError";
  constructor() { super("Não foi possível estabelecer o contexto de acesso."); }
}

export async function listActiveUserOrganizations(userId: string) {
  return prisma.organizationMembership.findMany({
    where: { userId, isActive: true, user: { isActive: true } },
    orderBy: [{ organization: { name: "asc" } }, { organizationId: "asc" }],
    select: { organizationId: true, role: true, organization: { select: { name: true, slug: true } } },
  });
}

export async function createSessionRecord(userId: string, organizationId: string, previousToken?: string, now = new Date()) {
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId, organizationId, isActive: true, user: { isActive: true } },
    select: { id: true },
  });
  if (!membership) throw new AuthenticationContextError();

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
  const previousTokenHash = previousToken && SESSION_TOKEN_PATTERN.test(previousToken) ? hashToken(previousToken) : undefined;

  await prisma.$transaction(async (tx) => {
    if (previousTokenHash) await tx.session.deleteMany({ where: { tokenHash: previousTokenHash, userId } });
    await tx.session.create({ data: { tokenHash: hashToken(token), userId, organizationId, expiresAt, lastSeenAt: now } });
  });
  return { token, expiresAt };
}

const SESSION_ROTATION_RETRIES = 3;

export async function rotateSessionRecord(userId: string, organizationId: string, previousSessionId: string, now = new Date()) {
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId, organizationId, isActive: true, user: { isActive: true } },
    select: { id: true },
  });
  if (!membership) throw new AuthenticationContextError();

  for (let attempt = 1; attempt <= SESSION_ROTATION_RETRIES; attempt += 1) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
    try {
      await prisma.$transaction(async (tx) => {
        const removed = await tx.session.deleteMany({ where: { id: previousSessionId, userId } });
        if (removed.count !== 1) throw new AuthenticationContextError();
        await tx.session.create({ data: { tokenHash: hashToken(token), userId, organizationId, expiresAt, lastSeenAt: now } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { token, expiresAt };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < SESSION_ROTATION_RETRIES) continue;
      throw error;
    }
  }
  throw new AuthenticationContextError();
}

export async function createUserSession(userId: string, organizationId: string, previousSessionId?: string) {
  const cookieStore = await cookies();
  const previousToken = cookieStore.get(cookieName)?.value;
  const { token, expiresAt } = previousSessionId
    ? await rotateSessionRecord(userId, organizationId, previousSessionId)
    : await createSessionRecord(userId, organizationId, previousToken);

  cookieStore.set(cookieName, token, sessionCookieOptions(expiresAt));
}

export async function getAuthContextForToken(token: string, now = new Date()): Promise<AuthContext | null> {
  if (!SESSION_TOKEN_PATTERN.test(token)) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true, organization: true },
  });
  if (!session || !session.user.isActive || session.expiresAt <= now) {
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
  if (!membership?.isActive) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  if (now.getTime() - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
    await prisma.session.updateMany({ where: { id: session.id }, data: { lastSeenAt: now } });
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

export async function getAuthContext(): Promise<AuthContext | null> {
  const token = (await cookies()).get(cookieName)?.value;
  return token ? getAuthContextForToken(token) : null;
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
