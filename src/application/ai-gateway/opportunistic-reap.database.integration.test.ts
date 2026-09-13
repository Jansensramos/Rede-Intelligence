import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { reserveGatewayExecution, type GatewayLedgerContext } from "./ledger-service";
import * as reaperModule from "./reaper";
import type { AiRequest } from "@/domain/ai-gateway";

/**
 * Correção crítica pós-reauditoria (achado MÉDIO "reaper sem call site produtivo"):
 * `reapExpiredGatewayReservations` existia e era exaustivamente testada isoladamente, mas
 * nenhum caminho de produção a invocava - reservas QUEUED órfãs nunca expiravam sozinhas.
 * Estratégia mínima implementada: `reserveGatewayExecution` executa uma recuperação
 * oportunística (tenant-scoped, relógio server-side, lote limitado) antes de calcular o
 * orçamento de cada nova reserva. Nenhum job periódico foi adicionado - registrar isto
 * honestamente em vez de alegar um cron/worker que não existe.
 */

async function isolatedOrg(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organization = await prisma.organization.create({ data: { name: `OR ${label} ${suffix}`, slug: `or-${label}-${suffix}` } });
  const user = await prisma.user.create({ data: { name: `OR ${label}`, email: `or-${label}-${suffix}@test.local`, passwordHash: "test" } });
  const conversation = await prisma.aIConversation.create({ data: { organizationId: organization.id, title: "opportunistic-reap-test", scope: "ORGANIZATION", contextSnapshot: {}, createdById: user.id } });
  await prisma.aIUsageBudget.create({ data: { organizationId: organization.id, monthlyLimit: 1000, createdById: user.id } });
  return { organization, user, conversation, ledger: { organizationId: organization.id, userId: user.id, conversationId: conversation.id } as GatewayLedgerContext };
}
function req(overrides: Partial<AiRequest> = {}): AiRequest {
  return { correlationId: `c-${Math.random()}`, organizationId: "x", actorRef: "u", task: "CHAT", requiredCapabilities: ["TEXT_GENERATION"], dataClassification: "INTERNAL", criticality: "STANDARD", content: { systemInstructions: "s", trustedContext: "t" }, ...overrides };
}
async function backdateStartedAt(executionLogId: string, when: Date) {
  await prisma.aIExecutionLog.update({ where: { id: executionLogId }, data: { startedAt: when } });
}
const disposed: string[] = [];
async function cleanup(organizationId: string) {
  await prisma.aIPendingAction.deleteMany({ where: { organizationId } });
  await prisma.aIExecutionLog.deleteMany({ where: { organizationId } });
  await prisma.aIUsageBudget.deleteMany({ where: { organizationId } });
  await prisma.aIConversation.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } }).catch(() => {});
}

describe.skipIf(!process.env.DATABASE_URL).sequential("reaper oportunístico integrado a reserveGatewayExecution (correção crítica pós-reauditoria, achado MÉDIO)", () => {
  afterAll(async () => { for (const id of disposed) await cleanup(id); await prisma.$disconnect(); });

  it("reserveGatewayExecution chama a recuperação oportunística (spy) antes de calcular o orçamento", async () => {
    const { organization, ledger } = await isolatedOrg("calls-reaper");
    disposed.push(organization.id);
    const spy = vi.spyOn(reaperModule, "reapExpiredGatewayReservations");
    try {
      await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 1_000_000, "v1", "disabled", "m");
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ organizationId: organization.id }));
    } finally {
      spy.mockRestore();
    }
  });

  it("uma reserva QUEUED vencida deixa de consumir orçamento assim que a PRÓXIMA reserva desta organização roda (nunca fica órfã para sempre)", async () => {
    const { organization, ledger } = await isolatedOrg("stale-cleared-opportunistically");
    disposed.push(organization.id);
    const orphan = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k-orphan" }), 500_000_000, "v1", "disabled", "m");
    if (orphan.kind !== "RESERVED") throw new Error("unreachable");
    await backdateStartedAt(orphan.executionLogId, new Date(Date.now() - 10 * 60_000)); // simula processo morto antes de markGatewayExecutionTransportStarted
    const spendBefore = await prisma.aIExecutionLog.aggregate({ where: { organizationId: organization.id, status: { notIn: ["FAILED", "CANCELLED"] } }, _sum: { estimatedCost: true } });
    expect(Number(spendBefore._sum.estimatedCost ?? 0)).toBeCloseTo(500, 5); // ainda conta - ninguém rodou o reaper ainda

    await reserveGatewayExecution(ledger, req({ idempotencyKey: "k-next" }), 1_000_000, "v1", "disabled", "m");

    const orphanLog = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: orphan.executionLogId } });
    expect(orphanLog.status).toBe("FAILED"); // liberada oportunisticamente pela reserva seguinte
    expect(Number(orphanLog.estimatedCost)).toBe(0);
  });

  it("uma reserva RUNNING vencida continua consumindo orçamento mesmo depois de outras reservas rodarem (reaper nunca a toca)", async () => {
    const { organization, ledger } = await isolatedOrg("running-keeps-consuming");
    disposed.push(organization.id);
    const first = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 10_000_000, "v1", "disabled", "m");
    if (first.kind !== "RESERVED") throw new Error("unreachable");
    const { markGatewayExecutionTransportStarted } = await import("./ledger-service");
    await markGatewayExecutionTransportStarted(first.executionLogId, first.pendingActionId);
    await backdateStartedAt(first.executionLogId, new Date(Date.now() - 10 * 60_000));

    await reserveGatewayExecution(ledger, req({ idempotencyKey: "k2" }), 1_000_000, "v1", "disabled", "m");

    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: first.executionLogId } });
    expect(log.status).toBe("RUNNING");
    expect(Number(log.estimatedCost)).toBeCloseTo(10, 5);
  });

  it("falha do reaper oportunístico impede a nova reserva (nunca calcula orçamento sobre estado incerto)", async () => {
    const { organization, ledger } = await isolatedOrg("reaper-failure-blocks-reserve");
    disposed.push(organization.id);
    const spy = vi.spyOn(reaperModule, "reapExpiredGatewayReservations").mockRejectedValueOnce(new Error("falha simulada de banco"));
    try {
      await expect(reserveGatewayExecution(ledger, req({ idempotencyKey: "k1" }), 1_000_000, "v1", "disabled", "m")).rejects.toThrow("falha simulada de banco");
      const count = await prisma.aIExecutionLog.count({ where: { organizationId: organization.id } });
      expect(count).toBe(0); // nenhuma reserva foi criada sobre um estado que o reaper não conseguiu confirmar
    } finally {
      spy.mockRestore();
    }
  });

  it("dois requests simultâneos (Promise.all real) com a mesma reserva órfã vencida não a liberam duas vezes nem corrompem o custo", async () => {
    const { organization, ledger } = await isolatedOrg("concurrent-opportunistic");
    disposed.push(organization.id);
    const orphan = await reserveGatewayExecution(ledger, req({ idempotencyKey: "k-orphan" }), 10_000_000, "v1", "disabled", "m");
    if (orphan.kind !== "RESERVED") throw new Error("unreachable");
    await backdateStartedAt(orphan.executionLogId, new Date(Date.now() - 10 * 60_000));

    await Promise.all([
      reserveGatewayExecution(ledger, req({ idempotencyKey: "k-a" }), 1_000_000, "v1", "disabled", "m"),
      reserveGatewayExecution(ledger, req({ idempotencyKey: "k-b" }), 1_000_000, "v1", "disabled", "m"),
    ]);

    const log = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: orphan.executionLogId } });
    expect(log.status).toBe("FAILED");
    expect(Number(log.estimatedCost)).toBe(0); // liberado exatamente uma vez, nunca "duplamente zerado" de forma inconsistente
  });

  it("tenant A não limpa reservas órfãs de tenant B ao reservar", async () => {
    const a = await isolatedOrg("tenant-a-opportunistic"); disposed.push(a.organization.id);
    const b = await isolatedOrg("tenant-b-opportunistic"); disposed.push(b.organization.id);
    const orphanB = await reserveGatewayExecution(b.ledger, req({ idempotencyKey: "k-orphan-b" }), 10_000_000, "v1", "disabled", "m");
    if (orphanB.kind !== "RESERVED") throw new Error("unreachable");
    await backdateStartedAt(orphanB.executionLogId, new Date(Date.now() - 10 * 60_000));

    await reserveGatewayExecution(a.ledger, req({ idempotencyKey: "k-a" }), 1_000_000, "v1", "disabled", "m");

    const logB = await prisma.aIExecutionLog.findUniqueOrThrow({ where: { id: orphanB.executionLogId } });
    expect(logB.status).toBe("QUEUED"); // não tocado pela reserva de outro tenant
  });

  it("nenhum código de adapter é importado pelo módulo do reaper (recuperação oportunística nunca chama transporte)", () => {
    const content = readFileSync(join(process.cwd(), "src", "application", "ai-gateway", "reaper.ts"), "utf8");
    const importLines = content.split("\n").filter((line) => /^\s*import\b/.test(line));
    expect(importLines.join("\n")).not.toMatch(/adapter/i);
    // Nenhuma chamada a metodo `.execute(` (assinatura de AiProviderAdapter#execute) em
    // codigo real (fora de comentarios de documentacao).
    const codeOnly = content.split("\n").filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//")).join("\n");
    expect(codeOnly).not.toMatch(/\.execute\(/);
  });
});
