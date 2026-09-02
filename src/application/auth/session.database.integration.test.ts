import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createSessionRecord, getAuthContextForToken, listActiveUserOrganizations, rotateSessionRecord } from "./session";
import { prisma } from "@/infrastructure/database/prisma";

const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];

async function fixture(options: { membership?: boolean; active?: boolean } = {}) {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: { email: `session-${suffix}@example.invalid`, name: "Sessão 9Q", passwordHash: "hash-sintetico" },
  });
  const organization = await prisma.organization.create({ data: { name: `Sessão 9Q ${suffix}`, slug: `session-9q-${suffix}` } });
  createdUserIds.push(user.id);
  createdOrganizationIds.push(organization.id);
  if (options.membership !== false) {
    await prisma.organizationMembership.create({
      data: { userId: user.id, organizationId: organization.id, role: "ANALYST", isActive: options.active ?? true },
    });
  }
  return { user, organization };
}

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("sessão multi-organização no PostgreSQL real", () => {
  it("cria e revalida sessão somente com membership ativo", async () => {
    const { user, organization } = await fixture();
    const { token } = await createSessionRecord(user.id, organization.id);
    await expect(getAuthContextForToken(token)).resolves.toMatchObject({ userId: user.id, organizationId: organization.id, role: "ANALYST" });
    expect(await prisma.session.findFirst({ where: { userId: user.id } })).toMatchObject({ tokenHash: createHash("sha256").update(token).digest("hex") });
  });

  it("rejeita usuário sem membership, membership inativo e organização de outro usuário", async () => {
    const withoutMembership = await fixture({ membership: false });
    await expect(createSessionRecord(withoutMembership.user.id, withoutMembership.organization.id)).rejects.toThrow("Não foi possível estabelecer o contexto de acesso.");

    const inactive = await fixture({ active: false });
    await expect(createSessionRecord(inactive.user.id, inactive.organization.id)).rejects.toThrow("Não foi possível estabelecer o contexto de acesso.");

    const owner = await fixture();
    const other = await fixture();
    await expect(createSessionRecord(owner.user.id, other.organization.id)).rejects.toThrow("Não foi possível estabelecer o contexto de acesso.");
  });

  it("invalida sessão expirada e revogada", async () => {
    const { user, organization } = await fixture();
    const expiredToken = "e".repeat(43);
    await prisma.session.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        tokenHash: createHash("sha256").update(expiredToken).digest("hex"),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    expect(await getAuthContextForToken(expiredToken)).toBeNull();

    const { token } = await createSessionRecord(user.id, organization.id);
    await prisma.session.deleteMany({ where: { userId: user.id } });
    expect(await getAuthContextForToken(token)).toBeNull();
  });

  it("remove sessão órfã quando membership é desativado", async () => {
    const { user, organization } = await fixture();
    const { token } = await createSessionRecord(user.id, organization.id);
    await prisma.organizationMembership.update({
      where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
      data: { isActive: false },
    });
    expect(await getAuthContextForToken(token)).toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("remove sessão órfã quando o membership é excluído", async () => {
    const { user, organization } = await fixture();
    const { token } = await createSessionRecord(user.id, organization.id);
    await prisma.organizationMembership.delete({
      where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
    });
    expect(await getAuthContextForToken(token)).toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("rotaciona o token e substitui o contexto anterior", async () => {
    const first = await fixture();
    const secondOrganization = await prisma.organization.create({ data: { name: `Sessão 9Q B ${randomUUID()}`, slug: `session-9q-b-${randomUUID()}` } });
    createdOrganizationIds.push(secondOrganization.id);
    await prisma.organizationMembership.create({ data: { userId: first.user.id, organizationId: secondOrganization.id, role: "REVIEWER" } });
    const firstSession = await createSessionRecord(first.user.id, first.organization.id);
    const secondSession = await createSessionRecord(first.user.id, secondOrganization.id, firstSession.token);
    expect(await getAuthContextForToken(firstSession.token)).toBeNull();
    await expect(getAuthContextForToken(secondSession.token)).resolves.toMatchObject({ organizationId: secondOrganization.id, role: "REVIEWER" });
    expect(await prisma.session.count({ where: { userId: first.user.id } })).toBe(1);
  });

  it("não revoga token anterior pertencente a outro usuário", async () => {
    const userA = await fixture();
    const userB = await fixture();
    const sessionB = await createSessionRecord(userB.user.id, userB.organization.id);
    const sessionA = await createSessionRecord(userA.user.id, userA.organization.id, sessionB.token);
    await expect(getAuthContextForToken(sessionA.token)).resolves.toMatchObject({ userId: userA.user.id });
    await expect(getAuthContextForToken(sessionB.token)).resolves.toMatchObject({ userId: userB.user.id });
  });

  it("serializa duas trocas concorrentes sem criar sessões sucessoras órfãs", async () => {
    const first = await fixture();
    const targetA = await prisma.organization.create({ data: { name: `Destino A ${randomUUID()}`, slug: `destino-a-${randomUUID()}` } });
    const targetB = await prisma.organization.create({ data: { name: `Destino B ${randomUUID()}`, slug: `destino-b-${randomUUID()}` } });
    createdOrganizationIds.push(targetA.id, targetB.id);
    await prisma.organizationMembership.createMany({ data: [
      { userId: first.user.id, organizationId: targetA.id, role: "ANALYST" },
      { userId: first.user.id, organizationId: targetB.id, role: "ANALYST" },
    ] });
    const original = await createSessionRecord(first.user.id, first.organization.id);
    const originalRow = await prisma.session.findUniqueOrThrow({ where: { tokenHash: createHash("sha256").update(original.token).digest("hex") } });
    const results = await Promise.allSettled([
      rotateSessionRecord(first.user.id, targetA.id, originalRow.id),
      rotateSessionRecord(first.user.id, targetB.id, originalRow.id),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await prisma.session.count({ where: { userId: first.user.id } })).toBe(1);
  });

  it("lista somente memberships ativos do usuário autenticado", async () => {
    const active = await fixture();
    const inactiveOrganization = await prisma.organization.create({ data: { name: `Inativa ${randomUUID()}`, slug: `inactive-${randomUUID()}` } });
    createdOrganizationIds.push(inactiveOrganization.id);
    await prisma.organizationMembership.create({ data: { userId: active.user.id, organizationId: inactiveOrganization.id, role: "VIEWER", isActive: false } });
    expect(await listActiveUserOrganizations(active.user.id)).toHaveLength(1);
  });
});
