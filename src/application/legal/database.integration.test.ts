import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MembershipRole } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { createDueDiligenceCase, getLegalWorkspace, sendLegalObligationToFinance } from "./legal-service";

describe.sequential("Fase 9D no PostgreSQL real", () => {
  let owner: AuthContext;
  let viewer: AuthContext;
  let foreign: AuthContext;
  let projectId: string;
  let obligationId: string;

  beforeAll(async () => {
    const membership = await prisma.organizationMembership.findFirstOrThrow({ where: { organization: { slug: "rede-nucleo-de-negocios" }, user: { email: "admin@rede.local" } }, include: { organization: true, user: true } });
    const atlasMembership = await prisma.organizationMembership.findFirstOrThrow({ where: { organization: { slug: "grupo-atlas" } }, include: { organization: true, user: true } });
    const project = await prisma.project.findFirstOrThrow({ where: { organizationId: membership.organizationId, name: "START BUTANTÃ" } });
    const obligation = await prisma.legalObligation.findFirstOrThrow({ where: { organizationId: membership.organizationId, projectId: project.id, code: "LEG-EMOL-001" } });
    const base = { sessionId: "test", userId: membership.userId, userName: membership.user.name, userEmail: membership.user.email, organizationId: membership.organizationId, organizationName: membership.organization.name, organizationSlug: membership.organization.slug };
    owner = { ...base, role: "OWNER" as MembershipRole };
    viewer = { ...base, role: "VIEWER" as MembershipRole };
    foreign = { sessionId: "test-atlas", userId: atlasMembership.userId, userName: atlasMembership.user.name, userEmail: atlasMembership.user.email, organizationId: atlasMembership.organizationId, organizationName: atlasMembership.organization.name, organizationSlug: atlasMembership.organization.slug, role: atlasMembership.role };
    projectId = project.id;
    obligationId = obligation.id;
  });

  afterAll(async () => prisma.$disconnect());

  it("carrega a central jurídica do START BUTANTÃ com evidências e prontidão", async () => {
    const workspace = await getLegalWorkspace(owner, projectId, new Date("2026-08-21"));
    expect(workspace.cases).toHaveLength(1);
    expect(workspace.registrations).toHaveLength(1);
    expect(workspace.summary.criticalFindings).toBe(1);
    expect(workspace.summary.readiness.ready).toBe(false);
  });

  it("impede leitura e criação cruzadas entre organizações", async () => {
    await expect(getLegalWorkspace(foreign, projectId)).rejects.toThrow(/Empreendimento não encontrado/i);
    await expect(createDueDiligenceCase(foreign, { projectId, code: "CROSS-TENANT", title: "Inválido", scope: "Não deve ser criado" })).rejects.toThrow(/Empreendimento não encontrado/i);
  });

  it("aplica RBAC antes de enviar obrigação ao Financeiro", async () => {
    await expect(sendLegalObligationToFinance(viewer, obligationId)).rejects.toThrow(/Administrador ou Owner/i);
  });

  it("reprocessa por idempotência sem criar segunda obrigação ou conta", async () => {
    const before = await prisma.legalFinancialEvent.count({ where: { legalObligationId: obligationId, status: "PROCESSED" } });
    const first = await sendLegalObligationToFinance(owner, obligationId);
    const second = await sendLegalObligationToFinance(owner, obligationId);
    const after = await prisma.legalFinancialEvent.count({ where: { legalObligationId: obligationId, status: "PROCESSED" } });
    expect(second.id).toBe(first.id);
    expect(before).toBe(1);
    expect(after).toBe(1);
  });
});
