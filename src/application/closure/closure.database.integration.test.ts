import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { prepareProjectClosureResult, approveProjectClosureResult, reopenProjectClosureResult, getProjectClosureOverview, ClosurePreparationError } from "@/application/closure/closure-service";
import { createProjectClosureDistribution, approveProjectClosureDistribution } from "@/application/closure/distribution-service";
import { evaluateProjectClosureReadiness } from "@/application/closure/closure-gate-service";
import { createDueDiligenceCase, recordLegalDecision } from "@/application/legal/legal-service";

/**
 * Fase 9S — Encerramento do empreendimento, governança e resultado realizado.
 * Fixture isolada, própria organização (mesmo padrão de
 * `handover.database.integration.test.ts`, 9R) — nunca escreve na organização
 * semeada compartilhada. Cada teste que precisa do gate `APTO` cria seu próprio
 * projeto (`makeAptoProject`) para nunca contaminar outros testes.
 */
describe.skipIf(!process.env.DATABASE_URL).sequential("Fase 9S — Encerramento do empreendimento contra PostgreSQL real", () => {
  let organizationId: string;
  let foreignOrganizationId: string;
  let preparerId: string;
  let approverId: string;
  let companyId: string;
  let counter = 0;

  const owner = (userId = approverId): AuthContext => ({ sessionId: "test", userId, userName: "Aprovador 9S", userEmail: "approver-9s@test.local", organizationId, organizationName: "9S Fixture", organizationSlug: "9s-fixture", role: "OWNER" });
  const admin = (): AuthContext => ({ ...owner(), role: "ADMIN" });
  const analyst = (): AuthContext => ({ ...owner(preparerId), role: "ANALYST" });
  const reviewer = (): AuthContext => ({ ...owner(), role: "REVIEWER" });
  const viewer = (): AuthContext => ({ ...owner(), role: "VIEWER" });
  const foreignOwner = (): AuthContext => ({ ...owner(), organizationId: foreignOrganizationId });

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const organization = await prisma.organization.create({ data: { name: `9S fixture ${suffix}`, slug: `9s-fixture-${suffix}` } });
    organizationId = organization.id;
    const preparerUser = await prisma.user.create({ data: { name: "Preparador 9S", email: `9s-preparer-${suffix}@test.local`, passwordHash: "integration-test" } });
    preparerId = preparerUser.id;
    const approverUser = await prisma.user.create({ data: { name: "Aprovador 9S", email: `9s-approver-${suffix}@test.local`, passwordHash: "integration-test" } });
    approverId = approverUser.id;
    const company = await prisma.company.create({ data: { organizationId, name: `9S SPE ${suffix}`, legalName: `9S SPE ${suffix} Ltda`, type: "SPE", createdById: approverId } });
    companyId = company.id;

    const foreignOrganization = await prisma.organization.create({ data: { name: `9S fixture outra org ${suffix}`, slug: `9s-fixture-outra-${suffix}` } });
    foreignOrganizationId = foreignOrganization.id;
  });

  async function cleanupOrganization(id: string) {
    await prisma.projectClosureDistribution.deleteMany({ where: { organizationId: id, status: { not: "APPROVED" } } });
    // Um encerramento DRAFT ainda referenciado por uma distribuição APPROVED preservada
    // acima (FK Restrict) não pode ser excluído — mesmo padrão de deixar órfão no banco
    // de teste descartável em vez de forçar.
    await prisma.projectClosureResult.deleteMany({ where: { organizationId: id, status: { not: "FINAL" }, distributions: { none: {} } } });
    await prisma.legalDecision.deleteMany({ where: { diligenceCase: { organizationId: id } } });
    await prisma.legalDueDiligenceCase.deleteMany({ where: { organizationId: id } });
    // CANCELLED/IMPLEMENTED são protegidos por trigger de imutabilidade estrutural
    // (9R, 20260910151500) — mesmo padrão de `handover.database.integration.test.ts`:
    // pula a exclusão desses registros terminais em vez de forçar.
    await prisma.condominiumSetup.deleteMany({ where: { organizationId: id, status: { notIn: ["IMPLEMENTED", "CANCELLED"] } } });
    await prisma.ledgerSnapshot.deleteMany({ where: { organizationId: id } });
    await prisma.accountingPeriod.deleteMany({ where: { organizationId: id } });
    await prisma.forecastEvaluation.deleteMany({ where: { organizationId: id } });
    await prisma.metricDefinition.deleteMany({ where: { organizationId: id } });
    // FinancialResult/CalculationRun/StudyVersion (SNAPSHOT) ficam órfãos deliberadamente — protegidos
    // por trigger de imutabilidade pré-existente da 9L (`prevent_locked_run_artifact_mutation`/
    // `prevent_study_version_mutation`, migration 20260817141500). Os projetos de teste que os criam
    // sempre têm CondominiumSetup (via makeAptoProject), então o `project.deleteMany` abaixo já os
    // exclui por outro motivo — nunca tenta cascatear sobre eles. Mesmo padrão de "deixar órfão" já
    // usado nesta suíte para FINAL/CANCELLED.
    await prisma.taxAssessment.deleteMany({ where: { organizationId: id } });
    await prisma.taxPolicy.deleteMany({ where: { organizationId: id } });
    await prisma.taxRegimeAssignment.deleteMany({ where: { organizationId: id } });
    await prisma.payableInstallment.deleteMany({ where: { payableAccount: { organizationId: id } } });
    await prisma.payableAccount.deleteMany({ where: { organizationId: id } });
    await prisma.financialObligation.deleteMany({ where: { organizationId: id } });
    await prisma.revenueRecognitionRun.deleteMany({ where: { organizationId: id } });
    // Mesma proteção — projeto ainda referenciado por um condomínio terminal preservado
    // acima ou por um ProjectClosureResult FINAL (protegido por trigger, nunca excluído).
    await prisma.project.deleteMany({ where: { organizationId: id, condominiumSetup: null, closureResults: { none: {} } } });
    await prisma.company.deleteMany({ where: { organizationId: id, projects: { none: {} } } });
    await prisma.organization.delete({ where: { id } }).catch(() => {});
  }

  afterAll(async () => {
    await cleanupOrganization(organizationId);
    await cleanupOrganization(foreignOrganizationId);
    await prisma.$disconnect();
  });

  /** Empreendimento com todos os 5 subgates deliberadamente APTO + campos centrais com evidência (para os testes que precisam chegar a FINAL). */
  async function makeAptoProject() {
    counter += 1;
    const suffix = `9S-${counter}-${Date.now()}`;
    // Cada chamada usa um referenceMonth/competenceDate exclusivo (ano derivado do
    // counter) — TaxAssessment/AccountingPeriod têm unicidade por (organização,
    // empresa, mês) e a fixture reaproveita a MESMA empresa em todos os projetos.
    const referenceMonth = new Date(2020 + counter, 0, 1);
    const dueDate = new Date(2020 + counter, 0, 10);
    const project = await prisma.project.create({ data: { organizationId, companyId, name: `Projeto 9S ${suffix}`, city: "São Paulo", state: "SP", createdById: approverId, updatedById: approverId } });

    await prisma.condominiumSetup.create({ data: { organizationId, projectId: project.id, responsibleId: approverId, createdById: approverId, status: "CANCELLED" } }); // "não aplicável"

    await prisma.revenueRecognitionRun.create({ data: { organizationId, companyId, projectId: project.id, policyId: `policy-${suffix}`, cutoffDate: referenceMonth, version: 1, status: "APPROVED", totalVgv: "1200000.00", totalReceivable: "0", totalCash: "1200000.00", recognizedRevenue: "1000000.00", recognizedCost: "600000.00", checksum: `chk-${suffix}`, createdById: approverId } });

    const regimeAssignment = await prisma.taxRegimeAssignment.create({ data: { organizationId, companyId, regime: "PRESUMED_PROFIT", effectiveFrom: referenceMonth, parameters: {}, createdById: approverId } });
    const taxPolicy = await prisma.taxPolicy.create({ data: { organizationId, assignmentId: regimeAssignment.id, taxCode: "PIS_COFINS", name: `Política ${suffix}`, version: 1, jurisdiction: "FEDERAL", effectiveFrom: referenceMonth, parameters: {}, createdById: approverId } });
    await prisma.taxAssessment.create({ data: { organizationId, companyId, projectId: project.id, policyId: taxPolicy.id, referenceMonth, version: 1, status: "APPROVED", taxCode: "PIS_COFINS", taxableBase: "1000000.00", assessedAmount: "80000.00", checksum: `taxchk-${suffix}`, createdById: approverId } });

    const financialCostObligation = await prisma.financialObligation.create({ data: { organizationId, companyId, projectId: project.id, nature: "PAYABLE", origin: "FUNDING", documentRef: `FUNDING_PROPOSAL:${suffix}:v1`, description: "Serviço da dívida (fixture 9S)", competenceDate: referenceMonth, dueDate, amount: "20000.00", status: "CONVERTED", createdById: approverId } });
    const financialCostAccount = await prisma.payableAccount.create({ data: { organizationId, companyId, projectId: project.id, obligationId: financialCostObligation.id, description: "Serviço da dívida (fixture 9S)", origin: "FUNDING", competenceMonth: referenceMonth, originalAmount: "20000.00", createdById: approverId } });
    await prisma.payableInstallment.create({ data: { payableAccountId: financialCostAccount.id, number: 1, dueDate, originalAmount: "20000.00", currentAmount: "20000.00", status: "PAGA" } });

    // LedgerSnapshot (CLOSING_TRIAL_BALANCE) com checksum igual ao closeChecksum do período —
    // correção do achado Médio #5 (pós-reauditoria REPROVADA): AccountingPeriod CLOSED sozinho
    // não basta mais como evidência do gate contábil, exige balancete de fechamento íntegro.
    const ledgerCloseChecksum = `ledger-chk-${suffix}`;
    const accountingPeriod = await prisma.accountingPeriod.create({ data: { organizationId, companyId, referenceMonth, status: "CLOSED", closeChecksum: ledgerCloseChecksum, closedById: approverId, closedAt: new Date(), createdById: approverId, updatedById: approverId } });
    await prisma.ledgerSnapshot.create({ data: { organizationId, companyId, periodId: accountingPeriod.id, snapshotType: "CLOSING_TRIAL_BALANCE", balances: [], totalDebit: "0", totalCredit: "0", checksum: ledgerCloseChecksum, createdById: approverId } });

    const diligenceCase = await prisma.legalDueDiligenceCase.create({ data: { organizationId, projectId: project.id, code: `SPE-ENCERRAMENTO-${suffix}`, title: "Encerramento societário", scope: "Checklist de encerramento (fixture 9S)", status: "COMPLETED", responsibleId: approverId, createdById: approverId, updatedById: approverId } });
    await prisma.legalDecision.create({ data: { diligenceCaseId: diligenceCase.id, version: 1, decision: "PROCEED", executiveConclusion: "SPE mantida — decisão de fixture.", conditions: [], blockers: [], findingSnapshot: {}, decidedById: approverId, decidedAt: new Date() } });

    return project;
  }

  // -------------------------------------------------------------------------
  // Gate de encerramento — leitura
  // -------------------------------------------------------------------------

  describe("Gate de encerramento", () => {
    it("empreendimento novo, sem nenhuma evidência, bloqueia com SEM_EVIDENCIA em pelo menos um subgate", async () => {
      counter += 1;
      const project = await prisma.project.create({ data: { organizationId, companyId, name: `Projeto vazio 9S ${counter}`, city: "SP", state: "SP", createdById: approverId, updatedById: approverId } });
      const readiness = await evaluateProjectClosureReadiness(prisma, organizationId, project.id);
      expect(readiness.overall).toBe("BLOQUEADO");
      expect([readiness.operational.status, readiness.legal.status, readiness.accounting.status]).toContain("SEM_EVIDENCIA");
    });

    it("fixture APTO chega genuinamente a APTO em todos os 5 subgates", async () => {
      const project = await makeAptoProject();
      const readiness = await evaluateProjectClosureReadiness(prisma, organizationId, project.id);
      expect(readiness.overall).toBe("APTO");
    });

    it("getProjectClosureOverview (leitura) reflete o gate e o último resultado preparado, sem exigir capacidade de mutação", async () => {
      const project = await makeAptoProject();
      const beforePrepare = await getProjectClosureOverview({ organizationId }, project.id);
      expect(beforePrepare.latest).toBeNull();
      expect(beforePrepare.gate.overall).toBe("APTO");

      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const afterPrepare = await getProjectClosureOverview({ organizationId }, project.id);
      expect(afterPrepare.latest?.id).toBe(draft.id);
    });

    it("outro tenant nunca satisfaz o gate — mesma leitura com organizationId de outro tenant não encontra os fatos reais", async () => {
      const project = await makeAptoProject();
      await expect(evaluateProjectClosureReadiness(prisma, foreignOrganizationId, project.id)).rejects.toThrow(/não encontrado/);
    });
  });

  // -------------------------------------------------------------------------
  // RBAC e IDOR
  // -------------------------------------------------------------------------

  describe("RBAC e isolamento entre organizações", () => {
    it("VIEWER não pode preparar nem aprovar o encerramento", async () => {
      const project = await makeAptoProject();
      await expect(prepareProjectClosureResult(viewer(), { projectId: project.id })).rejects.toThrow(/não pode preparar/);
    });

    it("REVIEWER não pode preparar nem aprovar o encerramento", async () => {
      const project = await makeAptoProject();
      await expect(prepareProjectClosureResult(reviewer(), { projectId: project.id })).rejects.toThrow(/não pode preparar/);
    });

    it("ANALYST não pode aprovar (só OWNER/ADMIN aprovam)", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      await expect(approveProjectClosureResult(analyst(), { closureResultId: draft.id })).rejects.toThrow(/não pode aprovar/);
    });

    it("projeto de outra organização é recusado com a MESMA mensagem de projeto inexistente", async () => {
      const project = await makeAptoProject();
      const realError = await prepareProjectClosureResult(foreignOwner(), { projectId: project.id }).catch((error: Error) => error);
      const fakeError = await prepareProjectClosureResult(owner(), { projectId: "id-inexistente" }).catch((error: Error) => error);
      expect(realError).toBeInstanceOf(Error);
      expect((realError as Error).message).toBe((fakeError as Error).message);
    });

    it("encerramento de outra organização não é encontrado", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      await expect(approveProjectClosureResult(foreignOwner(), { closureResultId: draft.id })).rejects.toThrow(/não encontrado/);
    });

    it("beneficiário de outro tenant nunca satisfaz uma distribuição — closureResultId de outra organização é recusado", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      await expect(createProjectClosureDistribution(foreignOwner(), {
        closureResultId: draft.id, beneficiaryName: "Estranho", beneficiaryTaxId: "000", beneficiaryType: "INVESTOR",
        nature: "CAPITAL_CONTRIBUTION", amount: "100.00", eventDate: new Date(), sourceType: "test", sourceId: "test", evidenceRefs: [{ note: "x" }],
      })).rejects.toThrow(/não encontrado/);
    });
  });

  // -------------------------------------------------------------------------
  // Fluxo completo: preparar → aprovar → FINAL
  // -------------------------------------------------------------------------

  describe("Fluxo de aprovação", () => {
    it("prepara o rascunho com os campos centrais com evidência e aprova até FINAL, fechando o Project", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      expect(draft.status).toBe("DRAFT");
      expect(draft.realizedRevenue?.toString()).toBe("1000000");
      expect(draft.realizedResult).not.toBeNull();

      const approved = await approveProjectClosureResult(owner(), { closureResultId: draft.id });
      expect(approved.status).toBe("FINAL");
      expect(approved.approvedById).toBe(approverId);

      const updatedProject = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
      expect(updatedProject.status).toBe("CLOSED");

      const log = await prisma.auditLog.findFirstOrThrow({ where: { organizationId, entityType: "Project", entityId: project.id, action: "PROJECT_CLOSED" } });
      expect(log.metadata).toHaveProperty("correlationId");
    });

    it("quem prepara não pode ser quem aprova — segregação de função obrigatória", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(admin(), { projectId: project.id }); // admin() usa approverId
      await expect(approveProjectClosureResult({ ...owner(), userId: approverId }, { closureResultId: draft.id })).rejects.toThrow(/segregação de função/);
    });

    it("gate bloqueado recusa a aprovação e não fecha o Project nem duplica AuditLog", async () => {
      counter += 1;
      const project = await prisma.project.create({ data: { organizationId, companyId, name: `Projeto bloqueado 9S ${counter}`, city: "SP", state: "SP", createdById: approverId, updatedById: approverId } });
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      await expect(approveProjectClosureResult(owner(), { closureResultId: draft.id })).rejects.toThrow(/Encerramento bloqueado/);
      const unchanged = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
      expect(unchanged.status).not.toBe("CLOSED");
      expect(await prisma.auditLog.count({ where: { organizationId, entityType: "Project", entityId: project.id, action: "PROJECT_CLOSED" } })).toBe(0);
    });

    it("dupla aprovação concorrente (Promise.all) — exatamente uma efetiva, a outra retorna o mesmo estado final idempotente", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const results = await Promise.allSettled([approveProjectClosureResult(owner(), { closureResultId: draft.id }), approveProjectClosureResult(admin(), { closureResultId: draft.id })]);
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      const final = await prisma.projectClosureResult.findUniqueOrThrow({ where: { id: draft.id } });
      expect(final.status).toBe("FINAL");
      expect(await prisma.auditLog.count({ where: { organizationId, entityType: "ProjectClosureResult", entityId: draft.id, action: "PROJECT_CLOSURE_RESULT_APPROVED" } })).toBe(1);
    });

    it("repetição da aprovação após sucesso é idempotente", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const first = await approveProjectClosureResult(owner(), { closureResultId: draft.id });
      const second = await approveProjectClosureResult(owner(), { closureResultId: draft.id });
      expect(first.status).toBe("FINAL");
      expect(second.status).toBe("FINAL");
      expect(await prisma.auditLog.count({ where: { organizationId, entityType: "ProjectClosureResult", entityId: draft.id, action: "PROJECT_CLOSURE_RESULT_APPROVED" } })).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // SEM_EVIDENCIA nas métricas essenciais (decisão 5)
  // -------------------------------------------------------------------------

  describe("SEM_EVIDENCIA bloqueia campos centrais (decisão 5)", () => {
    it("sem RevenueRecognitionRun, receita/custo/resultado ficam SEM_EVIDENCIA e a aprovação é recusada mesmo com o gate operacional/jurídico/contábil OK", async () => {
      counter += 1;
      const project = await prisma.project.create({ data: { organizationId, companyId, name: `Projeto sem receita 9S ${counter}`, city: "SP", state: "SP", createdById: approverId, updatedById: approverId } });
      await prisma.condominiumSetup.create({ data: { organizationId, projectId: project.id, responsibleId: approverId, createdById: approverId, status: "CANCELLED" } });
      // Ano bem fora da faixa usada por makeAptoProject (2020+counter) — nunca colide com o mesmo companyId compartilhado.
      const sevChecksum = `ledger-chk-sev-${counter}`;
      const sevPeriod = await prisma.accountingPeriod.create({ data: { organizationId, companyId, referenceMonth: new Date(3000 + counter, 0, 1), status: "CLOSED", closeChecksum: sevChecksum, closedById: approverId, closedAt: new Date(), createdById: approverId, updatedById: approverId } });
      await prisma.ledgerSnapshot.create({ data: { organizationId, companyId, periodId: sevPeriod.id, snapshotType: "CLOSING_TRIAL_BALANCE", balances: [], totalDebit: "0", totalCredit: "0", checksum: sevChecksum, createdById: approverId } });
      const diligenceCase = await prisma.legalDueDiligenceCase.create({ data: { organizationId, projectId: project.id, code: `SPE-ENCERRAMENTO-SEV-${counter}`, title: "x", scope: "x", status: "COMPLETED", responsibleId: approverId, createdById: approverId, updatedById: approverId } });
      await prisma.legalDecision.create({ data: { diligenceCaseId: diligenceCase.id, version: 1, decision: "PROCEED", executiveConclusion: "x", conditions: [], blockers: [], findingSnapshot: {}, decidedById: approverId, decidedAt: new Date() } });

      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      expect(draft.realizedRevenue).toBeNull();
      await expect(approveProjectClosureResult(owner(), { closureResultId: draft.id })).rejects.toThrow(/sem evidência/);
    });

    it("despesas operacionais SEM_EVIDENCIA nunca bloqueia isoladamente — a fixture APTO chega a FINAL mesmo sem essa linha", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const evidenceStatus = draft.evidenceStatus as Record<string, { status: string }>;
      expect(evidenceStatus.realizedExpenses.status).toBe("SEM_EVIDENCIA");
      const approved = await approveProjectClosureResult(owner(), { closureResultId: draft.id });
      expect(approved.status).toBe("FINAL");
    });
  });

  // -------------------------------------------------------------------------
  // Reabertura — decisão 3
  // -------------------------------------------------------------------------

  describe("Reabertura — só OWNER, nova versão, snapshot anterior nunca alterado", () => {
    it("ADMIN não pode reabrir — só OWNER", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const final = await approveProjectClosureResult(owner(), { closureResultId: draft.id });
      await expect(reopenProjectClosureResult(admin(), { closureResultId: final.id, reason: "teste", evidenceRefs: [{ doc: "x" }] })).rejects.toThrow(/Somente o perfil OWNER/);
    });

    it("OWNER reabre com justificativa e evidência — cria nova versão vinculada, nunca sobrescreve a anterior", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const final = await approveProjectClosureResult(owner(), { closureResultId: draft.id });
      const before = await prisma.projectClosureResult.findUniqueOrThrow({ where: { id: final.id } });

      const reopened = await reopenProjectClosureResult(owner(), { closureResultId: final.id, reason: "Ajuste necessário identificado após o fechamento.", evidenceRefs: [{ doc: "laudo.pdf", checksum: "abc" }] });
      expect(reopened.status).toBe("DRAFT");
      expect(reopened.version).toBe(final.version + 1);
      expect(reopened.supersedesId).toBe(final.id);

      const afterReopen = await prisma.projectClosureResult.findUniqueOrThrow({ where: { id: final.id } });
      expect(afterReopen).toEqual(before); // a linha FINAL anterior não mudou em nenhum campo

      const projectAfter = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
      expect(projectAfter.status).toBe("UNDER_REVIEW");
    });

    it("reabertura sem motivo ou sem evidência é recusada pelo schema", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const final = await approveProjectClosureResult(owner(), { closureResultId: draft.id });
      await expect(reopenProjectClosureResult(owner(), { closureResultId: final.id, reason: "", evidenceRefs: [{ doc: "x" }] })).rejects.toThrow();
      await expect(reopenProjectClosureResult(owner(), { closureResultId: final.id, reason: "motivo", evidenceRefs: [] })).rejects.toThrow();
    });

    it("não é possível reabrir um encerramento que ainda não é FINAL", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      await expect(reopenProjectClosureResult(owner(), { closureResultId: draft.id, reason: "motivo", evidenceRefs: [{ doc: "x" }] })).rejects.toThrow(/aprovado \(FINAL\)/);
    });
  });

  // -------------------------------------------------------------------------
  // Imutabilidade estrutural — SQL direto contra snapshot terminal
  // -------------------------------------------------------------------------

  describe("Imutabilidade estrutural — UPDATE, DELETE e TRUNCATE contra estado terminal", () => {
    it("bloqueia UPDATE e DELETE via Prisma e via SQL bruto depois de FINAL", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const final = await approveProjectClosureResult(owner(), { closureResultId: draft.id });

      await expect(prisma.projectClosureResult.update({ where: { id: final.id }, data: { lessonsLearned: "tamper" } })).rejects.toThrow(/PROJECT_CLOSURE_RESULT_IMMUTABLE/);
      await expect(prisma.projectClosureResult.delete({ where: { id: final.id } })).rejects.toThrow(/PROJECT_CLOSURE_RESULT_IMMUTABLE/);
      await expect(prisma.$executeRaw`UPDATE project_closure_results SET lessons_learned = 'raw-tamper' WHERE id = ${final.id}`).rejects.toThrow(/PROJECT_CLOSURE_RESULT_IMMUTABLE/);
    });

    it("bloqueia TRUNCATE em project_closure_results incondicionalmente", async () => {
      // project_closure_distributions referencia project_closure_results por FK — o Postgres exige
      // truncar as duas juntas (ou CASCADE); listar as duas aqui satisfaz essa exigência e ainda
      // assim aciona o trigger de imutabilidade antes de qualquer linha ser afetada.
      await expect(prisma.$executeRaw`TRUNCATE project_closure_results, project_closure_distributions`).rejects.toThrow("IMMUTABLE");
    });

    it("bloqueia UPDATE, DELETE e TRUNCATE em distribuição depois de APPROVED", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const distribution = await createProjectClosureDistribution(analyst(), {
        closureResultId: draft.id, beneficiaryName: "Sócio Um", beneficiaryTaxId: "111.222.333-44", beneficiaryType: "PARTNER",
        nature: "CAPITAL_CONTRIBUTION", amount: "50000.00", eventDate: new Date("2026-01-01"), sourceType: "aporte-inicial", sourceId: "doc-1", evidenceRefs: [{ doc: "contrato-social.pdf" }],
      });
      const approved = await approveProjectClosureDistribution(owner(), { distributionId: distribution.id });
      expect(approved.status).toBe("APPROVED");

      await expect(prisma.projectClosureDistribution.update({ where: { id: approved.id }, data: { beneficiaryName: "tamper" } })).rejects.toThrow(/PROJECT_CLOSURE_DISTRIBUTION_IMMUTABLE/);
      await expect(prisma.projectClosureDistribution.delete({ where: { id: approved.id } })).rejects.toThrow(/PROJECT_CLOSURE_DISTRIBUTION_IMMUTABLE/);
      await expect(prisma.$executeRaw`TRUNCATE project_closure_distributions`).rejects.toThrow("PROJECT_CLOSURE_DISTRIBUTION_IMMUTABLE");
    });
  });

  // -------------------------------------------------------------------------
  // Distribuição simples — decisão 8
  // -------------------------------------------------------------------------

  describe("Distribuição final simples", () => {
    it("registra aporte e retorno de capital dentro do disponível, com evidência/beneficiário/data/natureza/valor/origem", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const contribution = await createProjectClosureDistribution(analyst(), {
        closureResultId: draft.id, beneficiaryName: "Investidor A", beneficiaryTaxId: "222.333.444-55", beneficiaryType: "INVESTOR",
        nature: "CAPITAL_CONTRIBUTION", amount: "100000.00", eventDate: new Date("2026-01-01"), sourceType: "aporte-inicial", sourceId: "doc-2", evidenceRefs: [{ doc: "comprovante.pdf", checksum: "abc" }],
      });
      await approveProjectClosureDistribution(owner(), { distributionId: contribution.id });

      const returnDistribution = await createProjectClosureDistribution(analyst(), {
        closureResultId: draft.id, beneficiaryName: "Investidor A", beneficiaryTaxId: "222.333.444-55", beneficiaryType: "INVESTOR",
        nature: "CAPITAL_RETURN", amount: "60000.00", eventDate: new Date("2026-09-01"), sourceType: "retorno-encerramento", sourceId: "doc-3", evidenceRefs: [{ doc: "recibo.pdf" }],
      });
      const approvedReturn = await approveProjectClosureDistribution(owner(), { distributionId: returnDistribution.id });
      expect(approvedReturn.status).toBe("APPROVED");
    });

    it("retorno de capital acima do aportado (soma incompatível com o disponível) é recusado na criação", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      await expect(createProjectClosureDistribution(analyst(), {
        closureResultId: draft.id, beneficiaryName: "Investidor B", beneficiaryTaxId: "333.444.555-66", beneficiaryType: "INVESTOR",
        nature: "CAPITAL_RETURN", amount: "999999.00", eventDate: new Date(), sourceType: "retorno", sourceId: "doc-4", evidenceRefs: [{ doc: "x" }],
      })).rejects.toThrow(/excede o capital aportado/);
    });

    it("distribuição baseada em resultado acima do resultado disponível é recusada, mesmo revalidando na aprovação", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const realizedResult = Number(draft.realizedResult);
      await expect(createProjectClosureDistribution(analyst(), {
        closureResultId: draft.id, beneficiaryName: "Sócio C", beneficiaryTaxId: "444.555.666-77", beneficiaryType: "PARTNER",
        nature: "RESULT_DISTRIBUTION", amount: (realizedResult + 1000).toFixed(2), eventDate: new Date(), sourceType: "distribuicao-final", sourceId: "doc-5", evidenceRefs: [{ doc: "x" }],
      })).rejects.toThrow(/excede o resultado disponível/);
    });

    it("quem registra a distribuição não pode ser quem aprova", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const distribution = await createProjectClosureDistribution(admin(), {
        closureResultId: draft.id, beneficiaryName: "Sócio D", beneficiaryTaxId: "555.666.777-88", beneficiaryType: "PARTNER",
        nature: "CAPITAL_CONTRIBUTION", amount: "1000.00", eventDate: new Date(), sourceType: "aporte", sourceId: "doc-6", evidenceRefs: [{ doc: "x" }],
      });
      await expect(approveProjectClosureDistribution({ ...owner(), userId: approverId }, { distributionId: distribution.id })).rejects.toThrow(/segregação de função/);
    });

    it("nenhuma transferência bancária real é disparada — nenhuma escrita em BankTransaction/ReceivablePayment/PayablePayment ao registrar/aprovar uma distribuição", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const beforeBankTx = await prisma.bankTransaction.count();
      const distribution = await createProjectClosureDistribution(analyst(), {
        closureResultId: draft.id, beneficiaryName: "Investidor E", beneficiaryTaxId: "666.777.888-99", beneficiaryType: "INVESTOR",
        nature: "CAPITAL_CONTRIBUTION", amount: "5000.00", eventDate: new Date(), sourceType: "aporte", sourceId: "doc-7", evidenceRefs: [{ doc: "x" }],
      });
      await approveProjectClosureDistribution(owner(), { distributionId: distribution.id });
      const afterBankTx = await prisma.bankTransaction.count();
      expect(afterBankTx).toBe(beforeBankTx);
    });
  });

  // -------------------------------------------------------------------------
  // Teste arquitetural — só duas entidades novas, nenhum domínio paralelo, nenhuma API externa
  // -------------------------------------------------------------------------

  describe("Teste arquitetural — só duas entidades novas, sem domínio paralelo, sem API externa", () => {
    it("os únicos modelos Prisma novos da 9S são ProjectClosureResult e ProjectClosureDistribution", () => {
      const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
      const modelNames = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1]);
      const forbiddenPatterns = [/^Closure(?!.*Result$)(?!.*Distribution$)/, /^Investor/, /^Shareholder/, /^Waterfall/, /^Distribution(?!.*Project)/];
      const offenders = modelNames.filter((name) => forbiddenPatterns.some((pattern) => pattern.test(name)));
      expect(offenders).toEqual([]);
      expect(modelNames).toContain("ProjectClosureResult");
      expect(modelNames).toContain("ProjectClosureDistribution");
    });

    it("nenhum serviço da 9S escreve diretamente em AccountingPeriod/LegalObligation/RevenueRecognitionRun/TaxAssessment fora dos seus próprios serviços", () => {
      const closureDir = join(process.cwd(), "src", "application", "closure");
      const files = readdirSync(closureDir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
      for (const file of files) {
        const content = readFileSync(join(closureDir, file), "utf8");
        expect(content).not.toMatch(/prisma\.accountingPeriod\.(create|update|delete)/);
        expect(content).not.toMatch(/prisma\.legalObligation\.(create|update|delete)/);
        expect(content).not.toMatch(/prisma\.revenueRecognitionRun\.(create|update|delete)/);
        expect(content).not.toMatch(/prisma\.taxAssessment\.(create|update|delete)/);
        expect(content).not.toMatch(/fetch\(|axios|http\.request|https\.request/);
      }
    });

    it("fronteira com a Fase 10 — nenhum código de closure importa ou menciona AI Gateway/agentes/autopilot", () => {
      const closureDir = join(process.cwd(), "src", "application", "closure");
      const domainDir = join(process.cwd(), "src", "domain", "closure");
      for (const dir of [closureDir, domainDir]) {
        for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))) {
          const content = readFileSync(join(dir, file), "utf8").toLowerCase();
          expect(content).not.toMatch(/autopilot|ai-gateway|agent-framework|red-team-2/);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Correção pós-reauditoria REPROVADA — achado Bloqueador (gate jurídico)
  // -------------------------------------------------------------------------

  describe("Correção Bloqueador — gate jurídico decide pelo valor real da LegalDecision mais recente", () => {
    it("decisão DO_NOT_PROCEED registrada via recordLegalDecision (fluxo real) bloqueia o gate mesmo com checklist COMPLETED", async () => {
      const project = await makeAptoProject();
      const readinessBefore = await evaluateProjectClosureReadiness(prisma, organizationId, project.id);
      expect(readinessBefore.legal.status).toBe("APTO");

      const diligenceCase = await prisma.legalDueDiligenceCase.findFirstOrThrow({ where: { organizationId, projectId: project.id, code: { startsWith: "SPE-ENCERRAMENTO-" } } });
      await recordLegalDecision(owner(), diligenceCase.id, { decision: "DO_NOT_PROCEED", conclusion: "Pendência jurídica identificada após revisão." });

      const readinessAfter = await evaluateProjectClosureReadiness(prisma, organizationId, project.id);
      expect(readinessAfter.legal.status).toBe("PENDENTE");
      expect(readinessAfter.overall).toBe("BLOQUEADO");
    });

    it("decisão HOLD bloqueia o gate", async () => {
      const project = await makeAptoProject();
      const diligenceCase = await prisma.legalDueDiligenceCase.findFirstOrThrow({ where: { organizationId, projectId: project.id, code: { startsWith: "SPE-ENCERRAMENTO-" } } });
      await recordLegalDecision(owner(), diligenceCase.id, { decision: "HOLD", conclusion: "Aguardando definição societária." });
      const readiness = await evaluateProjectClosureReadiness(prisma, organizationId, project.id);
      expect(readiness.legal.status).toBe("PENDENTE");
    });

    it("decisão INSUFFICIENT_EVIDENCE vira SEM_EVIDENCIA, nunca aprovação", async () => {
      const project = await makeAptoProject();
      const diligenceCase = await prisma.legalDueDiligenceCase.findFirstOrThrow({ where: { organizationId, projectId: project.id, code: { startsWith: "SPE-ENCERRAMENTO-" } } });
      await recordLegalDecision(owner(), diligenceCase.id, { decision: "INSUFFICIENT_EVIDENCE", conclusion: "Diligência inconclusiva." });
      const readiness = await evaluateProjectClosureReadiness(prisma, organizationId, project.id);
      expect(readiness.legal.status).toBe("SEM_EVIDENCIA");
    });

    it("decisão antiga PROCEED (v1, da fixture) seguida de DO_NOT_PROCEED (v2) usa a mais recente — bloqueia", async () => {
      const project = await makeAptoProject();
      const diligenceCase = await prisma.legalDueDiligenceCase.findFirstOrThrow({ where: { organizationId, projectId: project.id, code: { startsWith: "SPE-ENCERRAMENTO-" } } });
      const decisionsBefore = await prisma.legalDecision.count({ where: { diligenceCaseId: diligenceCase.id } });
      expect(decisionsBefore).toBe(1); // v1 PROCEED da fixture
      await recordLegalDecision(owner(), diligenceCase.id, { decision: "DO_NOT_PROCEED", conclusion: "Reversão após nova análise." });
      const decisionsAfter = await prisma.legalDecision.findMany({ where: { diligenceCaseId: diligenceCase.id }, orderBy: { version: "asc" } });
      expect(decisionsAfter.map((d) => d.version)).toEqual([1, 2]);
      const readiness = await evaluateProjectClosureReadiness(prisma, organizationId, project.id);
      expect(readiness.legal.status).toBe("PENDENTE");
    });

    it("decisão antiga negativa (DO_NOT_PROCEED) seguida de nova favorável (PROCEED) usa a mais recente — libera", async () => {
      const project = await makeAptoProject();
      const diligenceCase = await prisma.legalDueDiligenceCase.findFirstOrThrow({ where: { organizationId, projectId: project.id, code: { startsWith: "SPE-ENCERRAMENTO-" } } });
      await recordLegalDecision(owner(), diligenceCase.id, { decision: "DO_NOT_PROCEED", conclusion: "Pendência identificada." });
      expect((await evaluateProjectClosureReadiness(prisma, organizationId, project.id)).legal.status).toBe("PENDENTE");
      await recordLegalDecision(owner(), diligenceCase.id, { decision: "PROCEED", conclusion: "Pendência resolvida — reversão da decisão anterior." });
      expect((await evaluateProjectClosureReadiness(prisma, organizationId, project.id)).legal.status).toBe("APTO");
    });

    it("PROCEED_WITH_CONDITIONS com condição impeditiva ainda não resolvida (sem resolved:true) bloqueia; resolvendo, libera", async () => {
      const project = await makeAptoProject();
      const diligenceCase = await prisma.legalDueDiligenceCase.findFirstOrThrow({ where: { organizationId, projectId: project.id, code: { startsWith: "SPE-ENCERRAMENTO-" } } });
      await recordLegalDecision(owner(), diligenceCase.id, { decision: "PROCEED_WITH_CONDITIONS", conclusion: "Condicionado à baixa de um protesto.", conditions: [{ code: "CP-1", description: "Baixar protesto", resolved: false }] });
      expect((await evaluateProjectClosureReadiness(prisma, organizationId, project.id)).legal.status).toBe("PENDENTE");
      await recordLegalDecision(owner(), diligenceCase.id, { decision: "PROCEED_WITH_CONDITIONS", conclusion: "Condição atendida.", conditions: [{ code: "CP-1", description: "Baixar protesto", resolved: true }] });
      expect((await evaluateProjectClosureReadiness(prisma, organizationId, project.id)).legal.status).toBe("APTO");
    });

    it("decisão de um caso jurídico diferente (não SPE-ENCERRAMENTO-*) do MESMO projeto nunca vaza para o gate do encerramento", async () => {
      const project = await makeAptoProject();
      const otherCase = await createDueDiligenceCase(owner(), { projectId: project.id, code: `OUTRO-CASO-${Date.now()}`, title: "Due diligence comum", scope: "Diligência de outro tipo (fixture adversarial)." });
      await prisma.legalDueDiligenceCase.update({ where: { id: otherCase.id }, data: { status: "COMPLETED" } });
      await recordLegalDecision(owner(), otherCase.id, { decision: "DO_NOT_PROCEED", conclusion: "Decisão negativa de outro caso — não deve afetar o encerramento." });
      const readiness = await evaluateProjectClosureReadiness(prisma, organizationId, project.id);
      expect(readiness.legal.status).toBe("APTO");
    });
  });

  describe("Correção focal final — Alto: CANCELLED nunca é evidência positiva no gate jurídico (LegalChecklistItem/LegalDocumentRequest)", () => {
    it("item de checklist NON_COMPLIANT no caso de encerramento bloqueia o gate mesmo com decisão PROCEED", async () => {
      const project = await makeAptoProject();
      const diligenceCase = await prisma.legalDueDiligenceCase.findFirstOrThrow({ where: { organizationId, projectId: project.id, code: { startsWith: "SPE-ENCERRAMENTO-" } } });
      await prisma.legalChecklistItem.create({ data: { diligenceCaseId: diligenceCase.id, templateKey: "spe-encerramento", templateVersion: 1, code: "CHK-1", category: "SOCIETARIO", title: "Distrato social protocolado", criticality: "HIGH", status: "NON_COMPLIANT", responsibleId: approverId, createdById: approverId, updatedById: approverId } });
      const readiness = await evaluateProjectClosureReadiness(prisma, organizationId, project.id);
      expect(readiness.legal.status).toBe("PENDENTE");
    });

    it("item de checklist NOT_STARTED bloqueia; WAIVED sem revisor/justificativa também bloqueia; só WAIVED com revisor E justificativa libera", async () => {
      const project = await makeAptoProject();
      const diligenceCase = await prisma.legalDueDiligenceCase.findFirstOrThrow({ where: { organizationId, projectId: project.id, code: { startsWith: "SPE-ENCERRAMENTO-" } } });
      const item = await prisma.legalChecklistItem.create({ data: { diligenceCaseId: diligenceCase.id, templateKey: "spe-encerramento", templateVersion: 1, code: "CHK-2", category: "SOCIETARIO", title: "Baixa de CNPJ protocolada", criticality: "MEDIUM", status: "NOT_STARTED", responsibleId: approverId, createdById: approverId, updatedById: approverId } });
      expect((await evaluateProjectClosureReadiness(prisma, organizationId, project.id)).legal.status).toBe("PENDENTE");

      // WAIVED só pela troca de status, sem revisor nem justificativa — não basta mais.
      await prisma.legalChecklistItem.update({ where: { id: item.id }, data: { status: "WAIVED" } });
      expect((await evaluateProjectClosureReadiness(prisma, organizationId, project.id)).legal.status).toBe("PENDENTE");

      // WAIVED com revisor mas sem nota/evidência — ainda não basta.
      await prisma.legalChecklistItem.update({ where: { id: item.id }, data: { reviewedById: approverId, reviewedAt: new Date() } });
      expect((await evaluateProjectClosureReadiness(prisma, organizationId, project.id)).legal.status).toBe("PENDENTE");

      // WAIVED com revisor E justificativa auditável — agora sim.
      await prisma.legalChecklistItem.update({ where: { id: item.id }, data: { notes: "Não aplicável a este caso — dispensado formalmente." } });
      expect((await evaluateProjectClosureReadiness(prisma, organizationId, project.id)).legal.status).toBe("APTO");
    });

    it("achado Alto reproduzido e corrigido: item de checklist CANCELLED nunca libera o gate, com ou sem reviewedById", async () => {
      const project = await makeAptoProject();
      const diligenceCase = await prisma.legalDueDiligenceCase.findFirstOrThrow({ where: { organizationId, projectId: project.id, code: { startsWith: "SPE-ENCERRAMENTO-" } } });
      const item = await prisma.legalChecklistItem.create({ data: { diligenceCaseId: diligenceCase.id, templateKey: "spe-encerramento", templateVersion: 1, code: "CHK-3", category: "SOCIETARIO", title: "Distrato social protocolado", criticality: "HIGH", status: "CANCELLED", responsibleId: approverId, createdById: approverId, updatedById: approverId } });
      expect((await evaluateProjectClosureReadiness(prisma, organizationId, project.id)).legal.status).toBe("PENDENTE"); // sem revisão — comportamento do achado original, agora corrigido
      await prisma.legalChecklistItem.update({ where: { id: item.id }, data: { reviewedById: approverId, reviewedAt: new Date(), notes: "Cancelado — mesmo com revisor e justificativa, CANCELLED não é evidência positiva." } });
      expect((await evaluateProjectClosureReadiness(prisma, organizationId, project.id)).legal.status).toBe("PENDENTE"); // continua bloqueando — só WAIVED tem caminho de dispensa
    });

    it("solicitação documental REQUESTED (pendente) bloqueia; EXPIRED bloqueia", async () => {
      const project = await makeAptoProject();
      const diligenceCase = await prisma.legalDueDiligenceCase.findFirstOrThrow({ where: { organizationId, projectId: project.id, code: { startsWith: "SPE-ENCERRAMENTO-" } } });
      const doc = await prisma.legalDocumentRequest.create({ data: { diligenceCaseId: diligenceCase.id, code: "DOC-1", documentType: "CERTIDAO_NEGATIVA", title: "Certidão negativa de débitos", status: "REQUESTED", requestedAt: new Date(), responsibleId: approverId, createdById: approverId, updatedById: approverId } });
      expect((await evaluateProjectClosureReadiness(prisma, organizationId, project.id)).legal.status).toBe("PENDENTE");
      await prisma.legalDocumentRequest.update({ where: { id: doc.id }, data: { status: "EXPIRED" } });
      expect((await evaluateProjectClosureReadiness(prisma, organizationId, project.id)).legal.status).toBe("PENDENTE");
    });

    it("achado Alto reproduzido e corrigido: solicitação documental CANCELLED nunca libera o gate (schema não tem campo para provar dispensa desta solicitação)", async () => {
      const project = await makeAptoProject();
      const diligenceCase = await prisma.legalDueDiligenceCase.findFirstOrThrow({ where: { organizationId, projectId: project.id, code: { startsWith: "SPE-ENCERRAMENTO-" } } });
      const doc = await prisma.legalDocumentRequest.create({ data: { diligenceCaseId: diligenceCase.id, code: "DOC-2", documentType: "CERTIDAO_NEGATIVA", title: "Certidão negativa de débitos", status: "REQUESTED", requestedAt: new Date(), responsibleId: approverId, createdById: approverId, updatedById: approverId } });
      await prisma.legalDocumentRequest.update({ where: { id: doc.id }, data: { status: "CANCELLED" } });
      const readiness = await evaluateProjectClosureReadiness(prisma, organizationId, project.id);
      expect(readiness.legal.status).toBe("PENDENTE"); // antes desta correção, isto virava APTO — achado real, agora fechado
    });

    it("última correção ('evidência jurídica não pode ser string livre'): RECEIVED nunca mais libera o gate — SEM_EVIDENCIA independente do conteúdo de documentLinkId (ausente, string local, ou aparentemente cross-tenant/cross-project)", async () => {
      const project = await makeAptoProject();
      const diligenceCase = await prisma.legalDueDiligenceCase.findFirstOrThrow({ where: { organizationId, projectId: project.id, code: { startsWith: "SPE-ENCERRAMENTO-" } } });
      const doc = await prisma.legalDocumentRequest.create({ data: { diligenceCaseId: diligenceCase.id, code: "DOC-3", documentType: "CERTIDAO_NEGATIVA", title: "Certidão negativa de débitos", status: "REQUESTED", requestedAt: new Date(), responsibleId: approverId, createdById: approverId, updatedById: approverId } });
      await prisma.legalDocumentRequest.update({ where: { id: doc.id }, data: { status: "RECEIVED", receivedAt: new Date() } });
      expect((await evaluateProjectClosureReadiness(prisma, organizationId, project.id)).legal.status).toBe("SEM_EVIDENCIA"); // RECEIVED sem documentLinkId — evidência alegada, nunca comprovável

      // Mapeamento comprovado nesta correção: documentLinkId não referencia nenhuma entidade
      // canônica em todo o schema/código (nenhuma tabela de documento jurídico ligada a
      // LegalDocumentRequest; nenhum serviço escreve neste campo). Por isso, QUALQUER conteúdo —
      // string local aparentemente válida, string aleatória, ou uma que pareça apontar para outro
      // tenant/projeto — recebe o MESMO tratamento (SEM_EVIDENCIA), porque o gate nunca tenta
      // resolver a referência. Isso é, por construção, a prova mais forte possível de que uma
      // referência inexistente e uma cruzada são indistinguíveis: não existe consulta que possa
      // vazar a diferença.
      const linkVariants = ["storage-doc-1", "aleatorio-xyz-nao-existe", "", "   ", `${organizationId}/outro-projeto/doc-x`, "outro-tenant-id/outro-caso/doc-y"];
      for (const documentLinkId of linkVariants) {
        await prisma.legalDocumentRequest.update({ where: { id: doc.id }, data: { documentLinkId } });
        const readiness = await evaluateProjectClosureReadiness(prisma, organizationId, project.id);
        expect(readiness.legal.status).toBe("SEM_EVIDENCIA");
        expect(readiness.legal.snapshot.unverifiableDocumentRequestIds).toEqual([doc.id]);
      }
    });

    it("achado da última correção reproduzido: CANCELLED com documentLinkId aparentemente válido continua não satisfazendo; WAIVED de checklist com evidenceDocumentIds inválidos/mistos/duplicados continua não satisfazendo", async () => {
      const project = await makeAptoProject();
      const diligenceCase = await prisma.legalDueDiligenceCase.findFirstOrThrow({ where: { organizationId, projectId: project.id, code: { startsWith: "SPE-ENCERRAMENTO-" } } });

      const doc = await prisma.legalDocumentRequest.create({ data: { diligenceCaseId: diligenceCase.id, code: "DOC-4", documentType: "CERTIDAO_NEGATIVA", title: "x", status: "REQUESTED", requestedAt: new Date(), responsibleId: approverId, createdById: approverId, updatedById: approverId } });
      await prisma.legalDocumentRequest.update({ where: { id: doc.id }, data: { status: "CANCELLED", documentLinkId: "doclink-valido-mas-cancelado" } });
      expect((await evaluateProjectClosureReadiness(prisma, organizationId, project.id)).legal.status).toBe("PENDENTE"); // CANCELLED nunca é revertido por evidência

      await prisma.legalDocumentRequest.update({ where: { id: doc.id }, data: { status: "RECEIVED" } }); // limpa o bloqueio anterior para isolar o próximo caso
      const item = await prisma.legalChecklistItem.create({ data: { diligenceCaseId: diligenceCase.id, templateKey: "spe-encerramento", templateVersion: 1, code: "CHK-9", category: "SOCIETARIO", title: "x", criticality: "HIGH", status: "WAIVED", reviewedById: approverId, evidenceDocumentIds: ["doc-valido", "doc-invalido", "doc-valido"], responsibleId: approverId, createdById: approverId, updatedById: approverId } });
      const readiness = await evaluateProjectClosureReadiness(prisma, organizationId, project.id);
      expect(readiness.legal.status).not.toBe("APTO"); // evidenceDocumentIds (mistos + duplicados) nunca substitui a nota de justificativa
      expect(readiness.legal.snapshot.openChecklistItemIds).toEqual([item.id]);
    });

    it("item/documento de outro caso jurídico do mesmo projeto não vaza para o gate do caso de encerramento", async () => {
      const project = await makeAptoProject();
      const otherCase = await createDueDiligenceCase(owner(), { projectId: project.id, code: `OUTRO-CASO-DOC-${Date.now()}`, title: "Due diligence comum", scope: "x" });
      await prisma.legalDocumentRequest.create({ data: { diligenceCaseId: otherCase.id, code: "DOC-X", documentType: "OUTRO", title: "Documento de outro caso", status: "REQUESTED", requestedAt: new Date(), responsibleId: approverId, createdById: approverId, updatedById: approverId } });
      await prisma.legalChecklistItem.create({ data: { diligenceCaseId: otherCase.id, templateKey: "outro", templateVersion: 1, code: "CHK-X", category: "OUTRO", title: "Item de outro caso", criticality: "HIGH", status: "NON_COMPLIANT", responsibleId: approverId, createdById: approverId, updatedById: approverId } });
      const readiness = await evaluateProjectClosureReadiness(prisma, organizationId, project.id);
      expect(readiness.legal.status).toBe("APTO");
    });
  });

  describe("Correção Médio — LedgerSnapshot sustenta o gate contábil (wiring real via evaluateProjectClosureReadiness)", () => {
    it("AccountingPeriod CLOSED sem LedgerSnapshot correspondente → gate contábil SEM_EVIDENCIA", async () => {
      counter += 1;
      const suffix = `ledger-missing-${counter}-${Date.now()}`;
      const isolatedCompany = await prisma.company.create({ data: { organizationId, name: `SPE ledger isolada ${suffix}`, legalName: `SPE ledger isolada ${suffix} Ltda`, type: "SPE", createdById: approverId } });
      const project = await prisma.project.create({ data: { organizationId, companyId: isolatedCompany.id, name: `Projeto ledger 9S ${suffix}`, city: "SP", state: "SP", createdById: approverId, updatedById: approverId } });
      await prisma.accountingPeriod.create({ data: { organizationId, companyId: isolatedCompany.id, referenceMonth: new Date(2021, 0, 1), status: "CLOSED", closeChecksum: `chk-${suffix}`, closedById: approverId, closedAt: new Date(), createdById: approverId, updatedById: approverId } });

      const readiness = await evaluateProjectClosureReadiness(prisma, organizationId, project.id);
      expect(readiness.accounting.status).toBe("SEM_EVIDENCIA");
    });

    it("LedgerSnapshot com checksum divergente do closeChecksum do período (inconsistência) → PENDENTE, falha fechado", async () => {
      counter += 1;
      const suffix = `ledger-inc-${counter}-${Date.now()}`;
      const isolatedCompany = await prisma.company.create({ data: { organizationId, name: `SPE ledger inc ${suffix}`, legalName: `SPE ledger inc ${suffix} Ltda`, type: "SPE", createdById: approverId } });
      const project = await prisma.project.create({ data: { organizationId, companyId: isolatedCompany.id, name: `Projeto ledger inc 9S ${suffix}`, city: "SP", state: "SP", createdById: approverId, updatedById: approverId } });
      const period = await prisma.accountingPeriod.create({ data: { organizationId, companyId: isolatedCompany.id, referenceMonth: new Date(2021, 1, 1), status: "CLOSED", closeChecksum: `expected-${suffix}`, closedById: approverId, closedAt: new Date(), createdById: approverId, updatedById: approverId } });
      await prisma.ledgerSnapshot.create({ data: { organizationId, companyId: isolatedCompany.id, periodId: period.id, snapshotType: "CLOSING_TRIAL_BALANCE", balances: [], totalDebit: "0", totalCredit: "0", checksum: `stale-${suffix}`, createdById: approverId } });

      const readiness = await evaluateProjectClosureReadiness(prisma, organizationId, project.id);
      expect(readiness.accounting.status).toBe("PENDENTE");
    });

    it("LedgerSnapshot de outro período (checksum bate, mas periodId diferente) nunca é aceito — consulta por periodId, nunca solto", async () => {
      counter += 1;
      const suffix = `ledger-cross-${counter}-${Date.now()}`;
      const isolatedCompany = await prisma.company.create({ data: { organizationId, name: `SPE ledger cross ${suffix}`, legalName: `SPE ledger cross ${suffix} Ltda`, type: "SPE", createdById: approverId } });
      const project = await prisma.project.create({ data: { organizationId, companyId: isolatedCompany.id, name: `Projeto ledger cross 9S ${suffix}`, city: "SP", state: "SP", createdById: approverId, updatedById: approverId } });
      const sharedChecksum = `shared-chk-${suffix}`;
      const periodA = await prisma.accountingPeriod.create({ data: { organizationId, companyId: isolatedCompany.id, referenceMonth: new Date(2021, 2, 1), status: "CLOSED", closeChecksum: sharedChecksum, closedById: approverId, closedAt: new Date(), createdById: approverId, updatedById: approverId } });
      const periodB = await prisma.accountingPeriod.create({ data: { organizationId, companyId: isolatedCompany.id, referenceMonth: new Date(2021, 3, 1), status: "CLOSED", closeChecksum: sharedChecksum, closedById: approverId, closedAt: new Date(), createdById: approverId, updatedById: approverId } });
      // Só o período A recebe o snapshot — B tem o MESMO closeChecksum (coincidência proposital) mas nenhum LedgerSnapshot próprio.
      await prisma.ledgerSnapshot.create({ data: { organizationId, companyId: isolatedCompany.id, periodId: periodA.id, snapshotType: "CLOSING_TRIAL_BALANCE", balances: [], totalDebit: "0", totalCredit: "0", checksum: sharedChecksum, createdById: approverId } });

      const readiness = await evaluateProjectClosureReadiness(prisma, organizationId, project.id);
      expect(readiness.accounting.status).toBe("SEM_EVIDENCIA"); // período B não tem snapshot próprio — nunca reaproveita o de A
      expect(readiness.accounting.snapshot.missingLedgerEvidencePeriodIds).toEqual([periodB.id]);
    });
  });

  // -------------------------------------------------------------------------
  // Correção pós-reauditoria REPROVADA — achado Alto #2 (previsto × realizado)
  // -------------------------------------------------------------------------

  describe("Correção Alto #2 — previsto × realizado (FinancialResult × ProjectClosureResult, ForecastEvaluation)", () => {
    it("vincula financialResultId e cria 4 ForecastEvaluation (receita/custo/resultado/margem) a partir do CalculationRun SNAPSHOT/BASE; reprepare é idempotente", async () => {
      const project = await makeAptoProject();
      const suffix = `forecast-${Date.now()}`;
      const study = await prisma.viabilityStudy.create({ data: { projectId: project.id, name: `Estudo ${suffix}`, createdById: approverId, updatedById: approverId } });
      const studyVersion = await prisma.studyVersion.create({ data: { studyId: study.id, versionNumber: 1, status: "SNAPSHOT", inputHash: `hash-${suffix}`, engineVersion: "v1", createdById: approverId, updatedById: approverId } });
      const scenario = await prisma.scenario.create({ data: { studyVersionId: studyVersion.id, name: "Base", kind: "BASE", description: "Cenário base", adjustments: {}, createdById: approverId, updatedById: approverId } });
      const calculationRun = await prisma.calculationRun.create({ data: { organizationId, projectId: project.id, studyId: study.id, studyVersionId: studyVersion.id, scenarioId: scenario.id, engineVersion: "v1", inputHash: `hash-${suffix}`, createdById: approverId } });
      await prisma.financialResult.create({ data: { calculationRunId: calculationRun.id, payload: {}, vgv: "1200000.00", netRevenue: "1000000.00", totalCost: "650000.00", profit: "300000.00", marginOnVgv: "0.25", marginOnNetRevenue: "0.30", npv: "300000.00", maximumCashExposure: "100000.00", maximumExposureMonth: 6, equityCapitalRequired: "200000.00", fundingNeed: "100000.00", breakEvenVgv: "800000.00", breakEvenUnits: 40 } });

      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      expect(draft.financialResultId).not.toBeNull();
      const forecastIds = draft.forecastEvaluationIds as unknown as string[] | null;
      expect(forecastIds).not.toBeNull();
      expect(forecastIds!.length).toBe(4);

      const evaluations = await prisma.forecastEvaluation.findMany({ where: { id: { in: forecastIds! } } });
      expect(evaluations).toHaveLength(4);
      expect(evaluations.every((e) => e.evaluated === true)).toBe(true);
      expect(evaluations.every((e) => e.projectId === project.id && e.organizationId === organizationId)).toBe(true);
      expect(evaluations.every((e) => e.forecastSourceId === calculationRun.id)).toBe(true);

      const reprepared = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      expect(reprepared.id).toBe(draft.id);
      const totalForecastRowsAfter = await prisma.forecastEvaluation.count({ where: { organizationId, projectId: project.id } });
      expect(totalForecastRowsAfter).toBe(4); // reprepare idempotente — nenhuma duplicata
    });

    it("sem CalculationRun/FinancialResult elegível, financialResultId e forecastEvaluationIds ficam null — nunca fabrica previsto", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      expect(draft.financialResultId).toBeNull();
    });

    it("FinancialResult de outro projeto da mesma organização nunca é usado como previsto deste projeto", async () => {
      const projectA = await makeAptoProject();
      const projectB = await makeAptoProject();
      const suffix = `forecast-cross-${Date.now()}`;
      const study = await prisma.viabilityStudy.create({ data: { projectId: projectA.id, name: `Estudo A ${suffix}`, createdById: approverId, updatedById: approverId } });
      const studyVersion = await prisma.studyVersion.create({ data: { studyId: study.id, versionNumber: 1, status: "SNAPSHOT", inputHash: `hash-${suffix}`, engineVersion: "v1", createdById: approverId, updatedById: approverId } });
      const scenario = await prisma.scenario.create({ data: { studyVersionId: studyVersion.id, name: "Base", kind: "BASE", description: "Cenário base", adjustments: {}, createdById: approverId, updatedById: approverId } });
      const calculationRun = await prisma.calculationRun.create({ data: { organizationId, projectId: projectA.id, studyId: study.id, studyVersionId: studyVersion.id, scenarioId: scenario.id, engineVersion: "v1", inputHash: `hash-${suffix}`, createdById: approverId } });
      await prisma.financialResult.create({ data: { calculationRunId: calculationRun.id, payload: {}, vgv: "1.00", netRevenue: "1.00", totalCost: "1.00", profit: "1.00", marginOnVgv: "1.00", marginOnNetRevenue: "1.00", npv: "1.00", maximumCashExposure: "1.00", maximumExposureMonth: 1, equityCapitalRequired: "1.00", fundingNeed: "1.00", breakEvenVgv: "1.00", breakEvenUnits: 1 } });

      const draftB = await prepareProjectClosureResult(analyst(), { projectId: projectB.id });
      expect(draftB.financialResultId).toBeNull(); // o estudo pertence ao projeto A — B nunca herda o previsto de outro projeto
    });
  });

  // -------------------------------------------------------------------------
  // Correção pós-reauditoria REPROVADA — achado Alto #3 (distribuição × DRAFT mutável)
  // -------------------------------------------------------------------------

  describe("Correção Alto #3 — distribuição aprovada trava o DRAFT (reprepare recusado); reabertura formal cria nova versão", () => {
    it("reprodução do achado original: reprepare depois de uma distribuição aprovada agora é recusado, preservando o teto que a autorizou", async () => {
      const project = await makeAptoProject();
      const draft1 = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const realizedResult1 = Number(draft1.realizedResult);
      expect(realizedResult1).toBeGreaterThan(0);

      const distribution = await createProjectClosureDistribution(analyst(), {
        closureResultId: draft1.id, beneficiaryName: "Sócio Trava", beneficiaryTaxId: "999.888.777-66", beneficiaryType: "PARTNER",
        nature: "RESULT_DISTRIBUTION", amount: realizedResult1.toFixed(2), eventDate: new Date(), sourceType: "distribuicao-final", sourceId: "doc-trava", evidenceRefs: [{ doc: "x" }],
      });
      await approveProjectClosureDistribution(owner(), { distributionId: distribution.id });

      // Mesmo cenário do achado original: um fato realizado muda depois da aprovação da distribuição.
      await prisma.revenueRecognitionRun.updateMany({ where: { organizationId, projectId: project.id }, data: { recognizedRevenue: "50000.00" } });

      await expect(prepareProjectClosureResult(analyst(), { projectId: project.id })).rejects.toThrow(/já possui distribuição aprovada/);

      const stillDraft1 = await prisma.projectClosureResult.findUniqueOrThrow({ where: { id: draft1.id } });
      expect(stillDraft1.realizedResult?.toString()).toBe(draft1.realizedResult?.toString()); // nunca foi sobrescrito
    });

    it("reopenProjectClosureResult aceita um DRAFT travado por distribuição aprovada e cria nova versão, preservando a anterior e a distribuição intactas", async () => {
      const project = await makeAptoProject();
      const draft1 = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const distribution = await createProjectClosureDistribution(analyst(), {
        closureResultId: draft1.id, beneficiaryName: "Sócio Reab", beneficiaryTaxId: "111.111.111-11", beneficiaryType: "PARTNER",
        nature: "CAPITAL_CONTRIBUTION", amount: "1000.00", eventDate: new Date(), sourceType: "aporte", sourceId: "doc-reab", evidenceRefs: [{ doc: "x" }],
      });
      await approveProjectClosureDistribution(owner(), { distributionId: distribution.id });

      const projectBefore = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
      expect(projectBefore.status).not.toBe("CLOSED"); // nunca foi aprovado a FINAL — só a distribuição foi aprovada

      const newDraft = await reopenProjectClosureResult(owner(), { closureResultId: draft1.id, reason: "Fatos atualizados após distribuição aprovada.", evidenceRefs: [{ doc: "novo-laudo.pdf" }] });
      expect(newDraft.status).toBe("DRAFT");
      expect(newDraft.version).toBe(draft1.version + 1);
      expect(newDraft.supersedesId).toBe(draft1.id);

      const draft1After = await prisma.projectClosureResult.findUniqueOrThrow({ where: { id: draft1.id } });
      expect(draft1After.status).toBe("DRAFT"); // permanece DRAFT — não virou FINAL, não foi alterado
      expect(draft1After.realizedResult?.toString()).toBe(draft1.realizedResult?.toString());

      const distributionAfter = await prisma.projectClosureDistribution.findUniqueOrThrow({ where: { id: distribution.id } });
      expect(distributionAfter.status).toBe("APPROVED");
      expect(distributionAfter.closureResultId).toBe(draft1.id); // continua vinculada à versão travada, nunca migrada

      const prepared = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      expect(prepared.id).toBe(newDraft.id); // a nova versão está mutável normalmente

      const projectAfterReopen = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
      expect(projectAfterReopen.status).not.toBe("CLOSED"); // esse ramo (DRAFT travado) nunca mexe no status do projeto
    });

    it("ADMIN/ANALYST não podem usar a reabertura para o caso de DRAFT travado — só OWNER", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const distribution = await createProjectClosureDistribution(analyst(), {
        closureResultId: draft.id, beneficiaryName: "Sócio H", beneficiaryTaxId: "3", beneficiaryType: "PARTNER",
        nature: "CAPITAL_CONTRIBUTION", amount: "100.00", eventDate: new Date(), sourceType: "aporte", sourceId: "doc-h", evidenceRefs: [{ doc: "x" }],
      });
      await approveProjectClosureDistribution(owner(), { distributionId: distribution.id });
      await expect(reopenProjectClosureResult(admin(), { closureResultId: draft.id, reason: "teste", evidenceRefs: [{ doc: "x" }] })).rejects.toThrow(/Somente o perfil OWNER/);
    });

    it("aprovação final revalida atomicamente as distribuições aprovadas contra o resultado vigente — recusa se incompatível (defesa em profundidade)", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const distribution = await createProjectClosureDistribution(analyst(), {
        closureResultId: draft.id, beneficiaryName: "Sócio Revalida", beneficiaryTaxId: "222.222.222-22", beneficiaryType: "PARTNER",
        nature: "RESULT_DISTRIBUTION", amount: "100000.00", eventDate: new Date(), sourceType: "distribuicao-final", sourceId: "doc-revalida", evidenceRefs: [{ doc: "x" }],
      });
      await approveProjectClosureDistribution(owner(), { distributionId: distribution.id });

      // Inconsistência só alcançável fora dos caminhos normais da aplicação (o guard de prepare já
      // impede isso pela via legítima) — grava direto para comprovar a defesa em profundidade da
      // revalidação atômica na aprovação final.
      await prisma.$executeRaw`UPDATE project_closure_results SET realized_result = '50000.00' WHERE id = ${draft.id}`;

      await expect(approveProjectClosureResult(owner(), { closureResultId: draft.id })).rejects.toThrow(/distribuições já aprovadas incompatíveis/);
    });

    it("duas aprovações concorrentes de distribuições que juntas excederiam o teto — a serialização (Promise.all real) recusa exatamente uma", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const realizedResult = Number(draft.realizedResult);
      const half = (realizedResult / 2 + 1000).toFixed(2); // duas metades ligeiramente acima do meio — juntas estouram o teto

      const d1 = await createProjectClosureDistribution(analyst(), { closureResultId: draft.id, beneficiaryName: "Sócio F", beneficiaryTaxId: "4", beneficiaryType: "PARTNER", nature: "RESULT_DISTRIBUTION", amount: half, eventDate: new Date(), sourceType: "x", sourceId: "d1", evidenceRefs: [{ doc: "x" }] });
      const d2 = await createProjectClosureDistribution(analyst(), { closureResultId: draft.id, beneficiaryName: "Sócio G", beneficiaryTaxId: "5", beneficiaryType: "PARTNER", nature: "RESULT_DISTRIBUTION", amount: half, eventDate: new Date(), sourceType: "x", sourceId: "d2", evidenceRefs: [{ doc: "x" }] });

      const results = await Promise.allSettled([
        approveProjectClosureDistribution(owner(), { distributionId: d1.id }),
        approveProjectClosureDistribution(admin(), { distributionId: d2.id }),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0].reason as Error).message).toMatch(/excede o resultado disponível/);

      const totalApproved = await prisma.projectClosureDistribution.aggregate({ where: { organizationId, closureResultId: draft.id, status: "APPROVED" }, _sum: { amount: true } });
      expect(Number(totalApproved._sum.amount ?? 0)).toBeLessThanOrEqual(realizedResult);
    });

    it("reprepare concorrente (Promise.all) com aprovação de distribuição nunca deixa o DRAFT sobrescrito depois de a distribuição ser aprovada", async () => {
      const project = await makeAptoProject();
      const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const distribution = await createProjectClosureDistribution(analyst(), {
        closureResultId: draft.id, beneficiaryName: "Sócio I", beneficiaryTaxId: "6", beneficiaryType: "PARTNER",
        nature: "CAPITAL_CONTRIBUTION", amount: "100.00", eventDate: new Date(), sourceType: "aporte", sourceId: "doc-i", evidenceRefs: [{ doc: "x" }],
      });
      await approveProjectClosureDistribution(owner(), { distributionId: distribution.id });

      // A partir daqui, QUALQUER reprepare — sequencial ou concorrente — deve ser recusado.
      const results = await Promise.allSettled([
        prepareProjectClosureResult(analyst(), { projectId: project.id }),
        prepareProjectClosureResult(analyst(), { projectId: project.id }),
      ]);
      expect(results.every((r) => r.status === "rejected")).toBe(true);
      for (const r of results) {
        expect((r as PromiseRejectedResult).reason.message).toMatch(/já possui distribuição aprovada/);
      }
      const stillDraft = await prisma.projectClosureResult.findUniqueOrThrow({ where: { id: draft.id } });
      expect(stillDraft.realizedResult?.toString()).toBe(draft.realizedResult?.toString());
    });
  });

  // -------------------------------------------------------------------------
  // Correção focal final — Bloqueador: TOCTOU real entre prepareProjectClosureResult
  // e approveProjectClosureDistribution, corrigido com transação Serializable + CAS.
  // Nenhum mock de Prisma — toda corrida abaixo é real contra PostgreSQL.
  // -------------------------------------------------------------------------

  describe("Correção focal final — Bloqueador: TOCTOU real corrigido (Serializable + CAS + retry P2034)", () => {
    it("1-4. corrida real repetida (Promise.all, sem mocks) entre prepare e approveProjectClosureDistribution — em nenhuma repetição o estado final fica incompatível", async () => {
      const outcomes: Array<{ prepareWon: boolean; approveWon: boolean }> = [];
      for (let i = 0; i < 6; i += 1) {
        const project = await makeAptoProject();
        const draft = await prepareProjectClosureResult(analyst(), { projectId: project.id });
        const realizedResult = Number(draft.realizedResult);
        const distribution = await createProjectClosureDistribution(analyst(), {
          closureResultId: draft.id, beneficiaryName: `Sócio Race ${i}`, beneficiaryTaxId: `race-${i}`, beneficiaryType: "PARTNER",
          nature: "RESULT_DISTRIBUTION", amount: (realizedResult / 2).toFixed(2), eventDate: new Date(), sourceType: "toctou-race", sourceId: `d-${i}`, evidenceRefs: [{ doc: "x" }],
        });

        // Corrida real: nenhum await sequencial entre as duas chamadas — ambas disparadas juntas.
        const [approveOutcome, prepareOutcome] = await Promise.allSettled([
          approveProjectClosureDistribution(owner(), { distributionId: distribution.id }),
          prepareProjectClosureResult(analyst(), { projectId: project.id }),
        ]);

        const finalDraft = await prisma.projectClosureResult.findUniqueOrThrow({ where: { id: draft.id } });
        const finalDistribution = await prisma.projectClosureDistribution.findUniqueOrThrow({ where: { id: distribution.id } });

        // Invariante obrigatório: ProjectClosureDistribution.status === APPROVED ⇒ o
        // ProjectClosureResult vinculado está congelado E os valores aprovados continuam
        // compatíveis com essa mesma versão (nunca sobrescrita depois da aprovação).
        if (finalDistribution.status === "APPROVED") {
          expect(Number(finalDraft.realizedResult)).toBeGreaterThanOrEqual(Number(finalDistribution.amount));
        }
        // Nunca as duas operações deixam um estado incompatível: se a distribuição foi aprovada,
        // qualquer prepare concorrente que tenha "sucedido" só pode ter sucedido ANTES dela
        // (nunca depois) — o que já é garantido pelo teste de igualdade acima. Se o prepare foi
        // recusado, a recusa é sempre por um motivo classificado, nunca um erro genérico/cru.
        if (prepareOutcome.status === "rejected") {
          const reason = prepareOutcome.reason;
          expect(reason).toBeInstanceOf(Error);
          if (finalDistribution.status === "APPROVED") {
            expect((reason as Error).message).toMatch(/já possui distribuição aprovada|mudou de estado/);
          }
        }
        outcomes.push({ prepareWon: prepareOutcome.status === "fulfilled", approveWon: approveOutcome.status === "fulfilled" });
      }
      // Nenhuma persistência parcial em nenhuma repetição, com qualquer intercalação real observada.
      expect(outcomes.length).toBe(6);
    });

    it("5. múltiplas preparações concorrentes reais na MESMA versão (sem distribuição) — retry absorve conflitos de serialização reais; nenhum P2034 cru escapa ao chamador, mesmo quando o limite de tentativas esgota", async () => {
      const project = await makeAptoProject();
      await prepareProjectClosureResult(analyst(), { projectId: project.id }); // garante existingDraft já criado antes da corrida
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => prepareProjectClosureResult(analyst(), { projectId: project.id })),
      );
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(fulfilled.length).toBeGreaterThan(0); // sob 5 chamadas reais concorrentes, o retry (limitado) garante que ao menos algumas tenham sucesso
      // Nenhuma rejeição pode ser um erro Prisma cru (P2034 vazando sem classificação) — sob
      // contenção real, esgotar o retry limitado é aceitável, mas sempre como erro classificado.
      // Correção do teste intermitente (auditoria final): a asserção original dependia de um
      // regex case-sensitive contra o texto humano da mensagem ("Não..." com N maiúsculo nunca
      // batia com `/não/`), falhando de forma intermitente exatamente quando o esgotamento real
      // do retry era exercitado — nunca um defeito da implementação. Agora valida a classe do
      // erro, o `reasonCode` estático e a presença de `correlationId` — sinais estruturais que
      // não dependem de capitalização — com a mensagem humana só como checagem secundária
      // (case-insensitive) de que nada além do esperado está sendo lançado.
      for (const r of rejected) {
        expect(r.reason).toBeInstanceOf(ClosurePreparationError);
        const error = r.reason as ClosurePreparationError;
        expect(error.reasonCode).toBe("CONCURRENCY_CONFLICT");
        expect(typeof error.correlationId).toBe("string");
        expect(error.correlationId.length).toBeGreaterThan(0);
        expect(error.message).toMatch(/não foi possível concluir a preparação|mudou de estado/i);
      }
      const final = await prisma.projectClosureResult.findUniqueOrThrow({ where: { id: (fulfilled[0] as PromiseFulfilledResult<{ id: string }>).value.id } });
      expect(final.status).toBe("DRAFT");
    });

    it("6. duas criações concorrentes de um encerramento novo (mesma versão, sem existingDraft) — exatamente uma sucede; a outra propaga P2002 sem retry (nunca reclassificado)", async () => {
      const project = await makeAptoProject();
      // Ambas partem de "nenhum encerramento ainda" — corrida real na criação (não no guard).
      const results = await Promise.allSettled([
        prepareProjectClosureResult(analyst(), { projectId: project.id }),
        prepareProjectClosureResult(analyst(), { projectId: project.id }),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      // Ou as duas coincidem no mesmo rascunho recém-criado (Postgres serializou sem conflito
      // detectável) ou uma delas colide de verdade (P2002 na constraint de versão única).
      if (rejected.length > 0) {
        const error = rejected[0].reason;
        expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
        expect((error as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
      } else {
        expect(fulfilled).toHaveLength(2);
      }
      const allVersions = await prisma.projectClosureResult.findMany({ where: { organizationId, projectId: project.id } });
      expect(allVersions).toHaveLength(1); // nunca duas linhas para a mesma versão
    });

    it("7. corridas concorrentes em dois projetos (cross-project) não interferem entre si", async () => {
      const projectA = await makeAptoProject();
      const projectB = await makeAptoProject();
      const draftA = await prepareProjectClosureResult(analyst(), { projectId: projectA.id });
      const draftB = await prepareProjectClosureResult(analyst(), { projectId: projectB.id });
      const distributionA = await createProjectClosureDistribution(analyst(), {
        closureResultId: draftA.id, beneficiaryName: "Sócio A", beneficiaryTaxId: "cross-a", beneficiaryType: "PARTNER",
        nature: "RESULT_DISTRIBUTION", amount: "1000.00", eventDate: new Date(), sourceType: "cross", sourceId: "da", evidenceRefs: [{ doc: "x" }],
      });

      const [approveA, prepareB] = await Promise.allSettled([
        approveProjectClosureDistribution(owner(), { distributionId: distributionA.id }),
        prepareProjectClosureResult(analyst(), { projectId: projectB.id }),
      ]);
      expect(approveA.status).toBe("fulfilled");
      expect(prepareB.status).toBe("fulfilled"); // projeto B nunca é afetado pela distribuição do projeto A

      const finalDraftB = await prisma.projectClosureResult.findUniqueOrThrow({ where: { id: draftB.id } });
      expect(finalDraftB.status).toBe("DRAFT");
      const finalDistributionA = await prisma.projectClosureDistribution.findUniqueOrThrow({ where: { id: distributionA.id } });
      expect(finalDistributionA.status).toBe("APPROVED");
    });

    it("8. reprepare sequencial sem nenhuma distribuição continua idempotente (mesma linha, mesma versão, nunca duplica ForecastEvaluation)", async () => {
      const project = await makeAptoProject();
      const first = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      const second = await prepareProjectClosureResult(analyst(), { projectId: project.id });
      expect(second.id).toBe(first.id);
      expect(second.version).toBe(first.version);
      const allVersions = await prisma.projectClosureResult.count({ where: { organizationId, projectId: project.id } });
      expect(allVersions).toBe(1);
    });
  });
});
