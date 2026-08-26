import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MembershipRole } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { registerPayablePayment } from "@/application/financial-ops/financial-service";
import {
  approveFundingDisbursementRelease,
  approveFundingProposal,
  confirmFundingDisbursement,
  createFundingProposal,
  evaluateFundingCovenant,
  moveFundingProposalToReview,
  rejectFundingProposal,
  requestFundingDisbursement,
  rescheduleFundingDebtService,
  reviseFundingProposal,
  submitFundingProposal,
  updateFundingConditionStatus,
} from "./capital-service";
import { getCapitalNeedForProject, getFundingProposalDetail } from "./capital-queries";
import type { RegisterFundingProposalInput } from "@/domain/capital/schemas";

function baseProposalInput(projectId: string, code: string): RegisterFundingProposalInput {
  return {
    projectId,
    code,
    providerName: "Banco Teste 9N",
    kind: "BANCO",
    amount: "500000",
    currency: "BRL",
    indexer: "PRE_FIXADO",
    spreadRate: "12",
    termMonths: 4,
    graceMonths: 1,
    amortizationSystem: "SAC",
    paymentFrequency: "MONTHLY",
    upfrontFeeRate: "1",
    recurringFeeRateAnnual: "0",
    guarantees: [{ type: "CESSAO_FIDUCIARIA", description: "Cessão fiduciária de recebíveis do empreendimento.", evidenceDocumentIds: [] }],
    covenants: [{ code: "DSCR", description: "Cobertura mínima do serviço da dívida.", metric: "DSCR", thresholdOperator: ">=", thresholdValue: "1.2", periodicity: "TRIMESTRAL" }],
    conditions: [{ code: "CP-01", category: "GARANTIA", description: "Registrar cessão fiduciária em cartório." }],
  };
}

describe.sequential("Fase 9N no PostgreSQL real", () => {
  let owner: AuthContext;
  let viewer: AuthContext;
  let analyst: AuthContext;
  let foreign: AuthContext;
  let projectId: string;
  let bankAccountId: string;

  beforeAll(async () => {
    const membership = await prisma.organizationMembership.findFirstOrThrow({ where: { organization: { slug: "rede-nucleo-de-negocios" }, user: { email: "admin@rede.local" } }, include: { organization: true, user: true } });
    const atlasMembership = await prisma.organizationMembership.findFirstOrThrow({ where: { organization: { slug: "grupo-atlas" } }, include: { organization: true, user: true } });
    const project = await prisma.project.findFirstOrThrow({ where: { organizationId: membership.organizationId, name: "START BUTANTÃ" } });
    const bankAccount = await prisma.bankAccount.findFirstOrThrow({ where: { companyId: project.companyId! } });
    const base = { sessionId: "test", userId: membership.userId, userName: membership.user.name, userEmail: membership.user.email, organizationId: membership.organizationId, organizationName: membership.organization.name, organizationSlug: membership.organization.slug };
    owner = { ...base, role: "OWNER" as MembershipRole };
    viewer = { ...base, role: "VIEWER" as MembershipRole };
    analyst = { ...base, role: "ANALYST" as MembershipRole };
    foreign = { sessionId: "test-atlas", userId: atlasMembership.userId, userName: atlasMembership.user.name, userEmail: atlasMembership.user.email, organizationId: atlasMembership.organizationId, organizationName: atlasMembership.organization.name, organizationSlug: atlasMembership.organization.slug, role: atlasMembership.role };
    projectId = project.id;
    bankAccountId = bankAccount.id;
  });

  afterAll(async () => prisma.$disconnect());

  it("lê a necessidade de capital a partir da Base Aprovada oficial (REDE Engine), sem recalcular", async () => {
    const need = await getCapitalNeedForProject(owner, projectId);
    expect(need.hasOfficialCalculation).toBe(true);
    expect(Number(need.totalCapitalNeed)).toBeGreaterThan(0);
  });

  it("RBAC: VIEWER não pode cadastrar proposta; tenant estrangeiro nem enxerga o projeto", async () => {
    const code = `RBAC-${randomUUID().slice(0, 8)}`;
    await expect(createFundingProposal(viewer, baseProposalInput(projectId, code))).rejects.toThrow(/capacidade/i);
    await expect(createFundingProposal(foreign, baseProposalInput(projectId, code))).rejects.toThrow(/não encontrado/i);
  });

  it("cadastra em DRAFT, edita em linha, submete, e bloqueia edição fora de DRAFT/SUBMITTED/UNDER_REVIEW", async () => {
    const code = `LIFECYCLE-${randomUUID().slice(0, 8)}`;
    const created = await createFundingProposal(analyst, baseProposalInput(projectId, code));
    expect(created.status).toBe("DRAFT");
    expect(created.version).toBe(1);
    expect(created.previousVersionId).toBeNull();

    const revised = await reviseFundingProposal(analyst, created.id, { ...baseProposalInput(projectId, code), providerName: "Banco Teste 9N (renegociado)" });
    expect(revised.id).toBe(created.id); // ainda DRAFT — atualizou em linha, não versionou
    expect(revised.providerName).toBe("Banco Teste 9N (renegociado)");

    await submitFundingProposal(analyst, created.id);
    await moveFundingProposalToReview(analyst, created.id);
    const rejected = await rejectFundingProposal(owner, created.id, "Custo acima da política.");
    expect(rejected.status).toBe("REJECTED");
    await expect(reviseFundingProposal(analyst, created.id, baseProposalInput(projectId, code))).resolves.toMatchObject({ previousVersionId: created.id, version: 2 });
  });

  it("aprovação materializa o serviço da dívida no 9B (FinancialObligation origin=FUNDING) e nunca duplica ao tentar aprovar de novo", async () => {
    const code = `APPROVE-${randomUUID().slice(0, 8)}`;
    const created = await createFundingProposal(analyst, baseProposalInput(projectId, code));
    await submitFundingProposal(analyst, created.id);

    const approved = await approveFundingProposal(owner, created.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.decisionSnapshot).not.toBeNull();

    const detail = await getFundingProposalDetail(owner, created.id);
    expect(detail.disbursements).toHaveLength(1);
    expect(detail.disbursements[0].status).toBe("PLANNED");
    const processedEvents = detail.financialEvents.filter((e) => e.status === "PROCESSED");
    expect(processedEvents.length).toBeGreaterThan(0);
    expect(new Set(processedEvents.map((e) => e.installmentNumber)).size).toBe(processedEvents.length); // sem colisão

    const obligationCountBefore = await prisma.financialObligation.count({ where: { origin: "FUNDING", documentRef: { startsWith: `FUNDING_PROPOSAL:${created.id}` } } });
    expect(obligationCountBefore).toBe(processedEvents.length);

    // Zero dupla contagem: proposta já aprovada não pode ser aprovada de novo (nem re-materializar).
    await expect(approveFundingProposal(owner, created.id)).rejects.toThrow(/não pode ser alterada/i);
    const obligationCountAfter = await prisma.financialObligation.count({ where: { origin: "FUNDING", documentRef: { startsWith: `FUNDING_PROPOSAL:${created.id}` } } });
    expect(obligationCountAfter).toBe(obligationCountBefore);
  });

  it("desembolso só conta como realizado com BankTransaction CREDIT + RECONCILED vinculada", async () => {
    const code = `DISBURSE-${randomUUID().slice(0, 8)}`;
    const created = await createFundingProposal(analyst, baseProposalInput(projectId, code));
    await submitFundingProposal(analyst, created.id);
    const approved = await approveFundingProposal(owner, created.id);
    const detail = await getFundingProposalDetail(owner, approved.id);
    const disbursementId = detail.disbursements[0].id;

    await requestFundingDisbursement(analyst, disbursementId);
    await approveFundingDisbursementRelease(owner, disbursementId);

    const debitTxn = await prisma.bankTransaction.create({ data: { organizationId: owner.organizationId, bankAccountId, occurredAt: new Date(), amount: 500000, direction: "DEBIT", description: "Não é crédito", status: "RECONCILED", checksum: `9n-test-debit-${randomUUID()}` } });
    await expect(confirmFundingDisbursement(owner, { disbursementId, bankTransactionId: debitTxn.id })).rejects.toThrow(/CRÉDITO/i);

    const unreconciledTxn = await prisma.bankTransaction.create({ data: { organizationId: owner.organizationId, bankAccountId, occurredAt: new Date(), amount: 500000, direction: "CREDIT", description: "Ainda não conciliado", status: "RECEIVED", checksum: `9n-test-unreconciled-${randomUUID()}` } });
    await expect(confirmFundingDisbursement(owner, { disbursementId, bankTransactionId: unreconciledTxn.id })).rejects.toThrow(/CONCILIADA/i);

    const need1 = await getCapitalNeedForProject(owner, projectId);
    const disbursedBefore = Number(need1.fundingDisbursed);

    const reconciledTxn = await prisma.bankTransaction.create({ data: { organizationId: owner.organizationId, bankAccountId, occurredAt: new Date(), amount: 500000, direction: "CREDIT", description: "Desembolso confirmado", status: "RECONCILED", checksum: `9n-test-ok-${randomUUID()}` } });
    const confirmed = await confirmFundingDisbursement(owner, { disbursementId, bankTransactionId: reconciledTxn.id });
    expect(confirmed.status).toBe("DISBURSED");
    expect(Number(confirmed.actualAmount)).toBe(500000);

    const need2 = await getCapitalNeedForProject(owner, projectId);
    expect(Number(need2.fundingDisbursed)).toBeCloseTo(disbursedBefore + 500000, 2);
  });

  it("reschedule: preserva parcela já paga, reverte só as em aberto, e nunca colide entre versões", async () => {
    const code = `RESCHEDULE-${randomUUID().slice(0, 8)}`;
    const created = await createFundingProposal(analyst, baseProposalInput(projectId, code));
    await submitFundingProposal(analyst, created.id);
    const approved = await approveFundingProposal(owner, created.id);

    const beforeDetail = await getFundingProposalDetail(owner, approved.id);
    const firstEvent = beforeDetail.financialEvents.filter((e) => e.status === "PROCESSED").sort((a, b) => a.installmentNumber - b.installmentNumber)[0];
    const installment = await prisma.payableInstallment.findFirstOrThrow({ where: { payableAccountId: firstEvent.payableAccountId! } });
    await registerPayablePayment(owner, { installmentId: installment.id, bankAccountId, amount: Number(installment.currentAmount), method: "TRANSFER", paidAt: new Date() });

    const result = await rescheduleFundingDebtService(owner, approved.id);
    expect(result.keptAsPaid).toContain(firstEvent.installmentNumber);
    expect(result.reversedInstallments).not.toContain(firstEvent.installmentNumber);
    expect(new Set(result.reversedInstallments).size).toBe(result.reversedInstallments.length);

    const afterDetail = await getFundingProposalDetail(owner, approved.id);
    const paidEventStillProcessed = afterDetail.financialEvents.find((e) => e.installmentNumber === firstEvent.installmentNumber && e.scheduleVersion === firstEvent.scheduleVersion);
    expect(paidEventStillProcessed?.status).toBe("PROCESSED");

    const reversedOldEvents = afterDetail.financialEvents.filter((e) => e.scheduleVersion === firstEvent.scheduleVersion && result.reversedInstallments.includes(e.installmentNumber));
    expect(reversedOldEvents.every((e) => e.status === "REVERSED")).toBe(true);

    const newVersionEvents = afterDetail.financialEvents.filter((e) => e.scheduleVersion === result.scheduleVersion);
    const newVersionNumbers = newVersionEvents.map((e) => e.installmentNumber);
    expect(new Set(newVersionNumbers).size).toBe(newVersionNumbers.length); // zero colisão
    expect(newVersionNumbers).not.toContain(firstEvent.installmentNumber); // parcela paga não foi recriada na nova versão

    // Idempotência do reschedule em si: reagendar de novo não duplica o mesmo installmentNumber na mesma versão.
    const eventCountBefore = await prisma.fundingFinancialEvent.count({ where: { proposalId: approved.id } });
    await expect(rescheduleFundingDebtService(owner, approved.id)).resolves.toBeDefined();
    const eventCountAfter = await prisma.fundingFinancialEvent.count({ where: { proposalId: approved.id } });
    expect(eventCountAfter).toBeGreaterThanOrEqual(eventCountBefore);
    const allInstallmentKeys = await prisma.fundingFinancialEvent.findMany({ where: { proposalId: approved.id }, select: { scheduleVersion: true, installmentNumber: true, eventType: true } });
    const keys = allInstallmentKeys.map((e) => `${e.eventType}:${e.scheduleVersion}:${e.installmentNumber}`);
    expect(new Set(keys).size).toBe(keys.length); // nunca duas linhas para a mesma (proposta, tipo, versão, parcela)
  });

  it("covenant: avaliação é append-only e nunca sobrescreve o histórico", async () => {
    const code = `COVENANT-${randomUUID().slice(0, 8)}`;
    const created = await createFundingProposal(analyst, baseProposalInput(projectId, code));
    const detail = await getFundingProposalDetail(owner, created.id);
    const covenantId = detail.covenants[0].id;

    await evaluateFundingCovenant(owner, { covenantId, testedAt: new Date("2026-01-01"), observedValue: "1.35", result: "OK" });
    await evaluateFundingCovenant(owner, { covenantId, testedAt: new Date("2026-04-01"), observedValue: "1.05", result: "WARNING" });
    await evaluateFundingCovenant(owner, { covenantId, testedAt: new Date("2026-07-01"), observedValue: "0.85", result: "BREACHED" });

    const history = await prisma.fundingCovenantEvaluation.findMany({ where: { covenantId }, orderBy: { testedAt: "asc" } });
    expect(history).toHaveLength(3);
    expect(history.map((h) => h.result)).toEqual(["OK", "WARNING", "BREACHED"]);

    const covenant = await prisma.fundingCovenant.findUniqueOrThrow({ where: { id: covenantId } });
    expect(covenant.status).toBe("BREACHED"); // cache reflete só o teste mais recente
    expect(covenant.lastValue).toBe("0.85");

    await expect(evaluateFundingCovenant(viewer, { covenantId, testedAt: new Date(), observedValue: "1.0", result: "OK" })).rejects.toThrow(/capacidade/i);
  });

  it("condição precedente: transição de status é auditável e RBAC-gated", async () => {
    const code = `CONDITION-${randomUUID().slice(0, 8)}`;
    const created = await createFundingProposal(analyst, baseProposalInput(projectId, code));
    const detail = await getFundingProposalDetail(owner, created.id);
    const conditionId = detail.conditions[0].id;

    await expect(updateFundingConditionStatus(viewer, { conditionId, status: "SATISFIED" })).rejects.toThrow(/capacidade/i);
    const updated = await updateFundingConditionStatus(analyst, { conditionId, status: "SATISFIED" });
    expect(updated.status).toBe("SATISFIED");
    expect(updated.satisfiedAt).not.toBeNull();
  });
});
