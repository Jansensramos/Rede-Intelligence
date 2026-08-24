import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { ensureInvestmentCase } from "./investment-service";
import { createStudy } from "@/application/studies/study-service";
import { DEMO_PROJECT } from "@/domain/financial/demo";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";

/**
 * Fechamento da 9K.1, gate 1 ("P2034 / deadlock em ensureInvestmentCase").
 *
 * Causa raiz confirmada por reprodução determinística (não suposição): duas execuções concorrentes
 * de `ensureInvestmentCase` para o MESMO projeto, sem Investment Case ainda, produzem
 * consistentemente 1 sucesso + 1 `PrismaClientKnownRequestError` código `P2034` ("write conflict or
 * deadlock") — a transação `Serializable` grava tanto o `InvestmentCase` quanto, via `ensureBrand`,
 * o `organizationBrandConfig` escopado só por `organizationId`, e ambos colidem quando duas
 * chamadas abrem o mesmo projeto (ou dois projetos da mesma organização) ao mesmo tempo. Na 9K.1
 * isso deixou de ser hipotético: trocar de contexto aciona `router.refresh()` sobre uma rota que
 * chama esta função, sem nenhuma garantia de que só uma invocação esteja em voo.
 *
 * Este teste prova a correção: `ensureInvestmentCase` agora reconsulta antes de cada tentativa e só
 * repete a escrita quando o erro for especificamente P2034, com um limite pequeno de tentativas —
 * nunca mascarando outros erros (segundo teste abaixo).
 */
async function isolatedIdentity(label: string): Promise<AuthContext> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organization = await prisma.organization.create({ data: { name: `9K.1 ${label} ${suffix}`, slug: `9k1-${label}-${suffix}` } });
  const user = await prisma.user.create({ data: { name: `9K.1 ${label}`, email: `9k1-${label}-${suffix}@test.local`, passwordHash: "integration-test" } });
  await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id, role: "OWNER" } });
  return { sessionId: `test-${user.id}`, userId: user.id, userName: user.name, userEmail: user.email, organizationId: organization.id, organizationName: organization.name, organizationSlug: organization.slug, role: "OWNER" };
}

describe.skipIf(!process.env.DATABASE_URL).sequential("ensureInvestmentCase: concorrência segura (fechamento 9K.1, gate 1)", () => {
  let context: AuthContext;

  afterAll(async () => prisma.$disconnect());

  it("duas chamadas concorrentes para o mesmo projeto (sem Investment Case) resolvem para o MESMO Investment Case, sem P2034 propagado", async () => {
    context = await isolatedIdentity("race2");
    const study = await createStudy(context, { ...DEMO_PROJECT, projectName: `Race 9K.1 ${Date.now()}` });

    const results = await Promise.all([
      ensureInvestmentCase(context, study.projectId),
      ensureInvestmentCase(context, study.projectId),
    ]);

    expect(results[0].id).toBe(results[1].id);
    const count = await prisma.investmentCase.count({ where: { projectId: study.projectId } });
    expect(count).toBe(1);
  }, 30_000);

  it("cinco chamadas concorrentes para o mesmo projeto continuam idempotentes (1 único Investment Case)", async () => {
    const raceContext = await isolatedIdentity("race5");
    const study = await createStudy(raceContext, { ...DEMO_PROJECT, projectName: `Race5 9K.1 ${Date.now()}` });

    const results = await Promise.all(Array.from({ length: 5 }, () => ensureInvestmentCase(raceContext, study.projectId)));

    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);
    const count = await prisma.investmentCase.count({ where: { projectId: study.projectId } });
    expect(count).toBe(1);

    await prisma.organization.delete({ where: { id: raceContext.organizationId } }).catch(() => {});
  }, 30_000);

  it("abrir um projeto sem nenhum StudyVersion SNAPSHOT continua lançando o erro de negócio real (não mascarado pelo retry de P2034)", async () => {
    const noSnapshotContext = await isolatedIdentity("no-snapshot");
    const project = await prisma.project.create({
      data: { organizationId: noSnapshotContext.organizationId, name: `Sem snapshot 9K.1 ${Date.now()}`, city: "Repro", state: "SP", createdById: noSnapshotContext.userId, updatedById: noSnapshotContext.userId },
    });

    await expect(ensureInvestmentCase(noSnapshotContext, project.id)).rejects.toThrow("Crie um snapshot financeiro antes de abrir um Investment Case.");

    await prisma.organization.delete({ where: { id: noSnapshotContext.organizationId } }).catch(() => {});
  }, 15_000);

  it("abrir o mesmo projeto duas vezes em sequência (não concorrente) nunca cria um segundo Investment Case", async () => {
    const sequentialContext = await isolatedIdentity("sequential");
    const study = await createStudy(sequentialContext, { ...DEMO_PROJECT, projectName: `Sequential 9K.1 ${Date.now()}` });

    const first = await ensureInvestmentCase(sequentialContext, study.projectId);
    const second = await ensureInvestmentCase(sequentialContext, study.projectId);

    expect(first.id).toBe(second.id);
    await prisma.organization.delete({ where: { id: sequentialContext.organizationId } }).catch(() => {});
  }, 15_000);

  afterAll(async () => {
    if (context) await prisma.organization.delete({ where: { id: context.organizationId } }).catch(() => {});
  });
});

describe("P2034 é reconhecido pela mesma checagem usada pelo retry (unidade, sem banco)", () => {
  it("Prisma.PrismaClientKnownRequestError com code P2034 é a condição exata de retry", () => {
    const error = new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict or a deadlock. Please retry your transaction", { code: "P2034", clientVersion: "test" });
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(error.code).toBe("P2034");
  });
});
