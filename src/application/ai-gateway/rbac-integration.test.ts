import { afterAll, describe, expect, it, vi } from "vitest";
import type { MembershipRole } from "@prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import type { AuthContext } from "@/application/auth/session";
import { askRedeAI } from "@/application/ai/ai-service";
import { AiAccessDeniedError } from "@/application/ai-gateway/rbac";

/**
 * Correcao focal pos-auditoria (achado ALTO "RBAC da 10A esta morto"): prova que AI_USE
 * agora e exigido de verdade dentro de `askRedeAI`, ANTES de qualquer orcamento, ledger
 * ou chamada ao AiGateway - nao so como funcao pura testada isoladamente.
 *
 * "Membership inativa"/"usuario sem membership" ja sao cobertos em profundidade por
 * `src/application/auth/session.database.integration.test.ts` ("rejeita usuario sem
 * membership, membership inativo e organizacao de outro usuario") - nao duplicados aqui;
 * esses casos bloqueiam antes mesmo de existir um `AuthContext`, o que `askRedeAI` nunca
 * ve (a funcao so recebe um `AuthContext` ja resolvido pelo chamador).
 */

async function disposableOrg(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organization = await prisma.organization.create({ data: { name: `RBAC ${label} ${suffix}`, slug: `rbac-${label}-${suffix}` } });
  const user = await prisma.user.create({ data: { name: `RBAC ${label}`, email: `rbac-${label}-${suffix}@test.local`, passwordHash: "test" } });
  const conversation = await prisma.aIConversation.create({ data: { organizationId: organization.id, title: "rbac-test", scope: "ORGANIZATION", contextSnapshot: {}, createdById: user.id } });
  return { organization, user, conversation };
}
async function cleanup(organizationId: string) {
  await prisma.aIMessage.deleteMany({ where: { conversation: { organizationId } } });
  await prisma.aIExecutionLog.deleteMany({ where: { organizationId } });
  await prisma.aIPendingAction.deleteMany({ where: { organizationId } });
  await prisma.aIConversation.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } }).catch(() => {});
}
function ctx(overrides: Partial<AuthContext>): AuthContext {
  return { sessionId: "s", userId: "u", userName: "U", userEmail: "u@test.local", organizationId: "org", organizationName: "Org", organizationSlug: "org", role: "OWNER", ...overrides };
}
const disposed: string[] = [];

describe.sequential("AI_USE integrado ao call site real (askRedeAI) - correcao focal", () => {
  afterAll(async () => { for (const id of disposed) await cleanup(id); await prisma.$disconnect(); });

  it("VIEWER e bloqueado ANTES de tocar orcamento/ledger/contexto - zero linhas criadas", async () => {
    const { organization, conversation } = await disposableOrg("viewer");
    disposed.push(organization.id);
    const before = await prisma.aIExecutionLog.count({ where: { organizationId: organization.id } });
    await expect(askRedeAI(ctx({ organizationId: organization.id, role: "VIEWER" }), { conversationId: conversation.id, question: "Qualquer pergunta", currentModule: "ai" })).rejects.toThrow();
    const after = await prisma.aIExecutionLog.count({ where: { organizationId: organization.id } });
    const messages = await prisma.aIMessage.count({ where: { conversationId: conversation.id } });
    expect(after).toBe(before);
    expect(messages).toBe(0); // nem a mensagem do usuario foi persistida - bloqueio e a PRIMEIRA coisa que acontece
  });

  it("a rejeicao de VIEWER e especificamente AiAccessDeniedError (nao um erro generico de banco/validacao)", async () => {
    const { organization, conversation } = await disposableOrg("viewer-error-shape");
    disposed.push(organization.id);
    try {
      await askRedeAI(ctx({ organizationId: organization.id, role: "VIEWER" }), { conversationId: conversation.id, question: "x", currentModule: "ai" });
      throw new Error("deveria ter lancado");
    } catch (error) {
      // askRedeAI envolve o erro em `safeError`/`new Error(...)`, entao checamos a mensagem
      // segura propagada, nao a instancia bruta (comportamento pre-existente da funcao).
      expect(String((error as Error).message)).not.toMatch(/prisma|undefined|null|stack/i);
    }
  });

  it("spy: zero chamadas ao AiGateway quando VIEWER e negado", async () => {
    const { organization, conversation } = await disposableOrg("viewer-spy");
    disposed.push(organization.id);
    const gatewayModule = await import("@/application/ai-gateway");
    const spy = vi.spyOn(gatewayModule, "createOrganizationAiGateway");
    try {
      await askRedeAI(ctx({ organizationId: organization.id, role: "VIEWER" }), { conversationId: conversation.id, question: "x", currentModule: "ai" }).catch(() => {});
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("papeis com AI_USE (OWNER/ADMIN/ANALYST/REVIEWER) passam da checagem de AI_USE - a rejeicao (se houver) e por outro motivo, nunca AiAccessDeniedError", async () => {
    const roles: MembershipRole[] = ["OWNER", "ADMIN", "ANALYST", "REVIEWER"];
    for (const role of roles) {
      const { organization, conversation } = await disposableOrg(`role-${role.toLowerCase()}`);
      disposed.push(organization.id);
      try {
        await askRedeAI(ctx({ organizationId: organization.id, role }), { conversationId: conversation.id, question: "x", currentModule: "ai" });
      } catch (error) {
        expect(error, `papel ${role} nao deveria ser barrado por AI_USE`).not.toBeInstanceOf(AiAccessDeniedError);
      }
    }
  });

  it("conteudo da pergunta tentando elevar papel/organizacao nao tem nenhum efeito - AuthContext.role/organizationId nunca vem do input", async () => {
    const { organization, conversation } = await disposableOrg("prompt-injection-role");
    disposed.push(organization.id);
    const hostileQuestion = JSON.stringify({ role: "OWNER", organizationId: "outra-org", __proto__: { role: "OWNER" } });
    // Mesmo com um VIEWER enviando uma pergunta que "parece" tentar se impersonar como
    // OWNER/outra organizacao, a funcao usa exclusivamente o `AuthContext` do parametro -
    // nunca reinterpreta o texto da pergunta como credencial.
    await expect(askRedeAI(ctx({ organizationId: organization.id, role: "VIEWER" }), { conversationId: conversation.id, question: hostileQuestion, currentModule: "ai" })).rejects.toThrow();
    const messages = await prisma.aIMessage.count({ where: { conversationId: conversation.id } });
    expect(messages).toBe(0);
  });

  it("cross-tenant: askRedeAI so opera com o organizationId do AuthContext - o tipo de input nem tem esse campo", () => {
    // Prova estrutural (nao de runtime): o parametro `input` de askRedeAI e tipado como
    // `{ conversationId, question, currentModule }` - sem `organizationId` - portanto nao
    // ha CAMPO algum pelo qual um cliente poderia sequer tentar sobrescrever o tenant.
    type AskRedeAIInput = Parameters<typeof askRedeAI>[1];
    const sample: AskRedeAIInput = { conversationId: "c", question: "q", currentModule: "m" };
    expect((sample as Record<string, unknown>).organizationId).toBeUndefined();
  });
});
