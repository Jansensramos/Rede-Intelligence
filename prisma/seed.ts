import { createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { AITaskType, MembershipRole } from "@prisma/client";
import { createStudy, createStudyVersion, getLatestStudyForOrganization, getStudyForOrganization } from "../src/application/studies/study-service";
import { ensureDemoLandStudy } from "../src/application/land/land-service";
import { ensureInvestmentCase } from "../src/application/investment/investment-service";
import { generateMasterReport } from "../src/application/investment/studio-service";
import { createMasterReportConfig } from "../src/domain/investment";
import { DEMO_PROJECT, START_BUTANTA_PROJECT } from "../src/domain/financial/demo";
import { prisma } from "../src/infrastructure/database/prisma";
import { AI_PROMPT_VERSION, REDE_AI_SYSTEM_PROMPT } from "../src/domain/ai";
import { ensureDesignWorkspace } from "../src/application/design/design-service";
import { approveBudget, createBudget } from "../src/application/budget/budget-service";
import { START_BUTANTA_BUDGET } from "../src/domain/budget/budget-engine";
import { approveOperationalBaseline, approveSchedule, createOfficialBudgetFromBaseline, createScheduleFromBudget, prepareOperationalBaseline, requestBaselineApproval } from "../src/application/operations/operations-service";
import {
  approveIntercompanyTransaction,
  confirmReconciliation,
  createBankAccount,
  createCustomer,
  createFinancialTransfer,
  createIntercompanyTransaction,
  createPayableAccount,
  createReceivableAccount,
  createSupplier,
  importBankTransactions,
  registerReceivablePayment,
  suggestReconciliationsForTransaction,
  transitionPayableInstallment,
  transitionReceivableInstallment,
} from "../src/application/financial-ops/financial-service";
import {
  approveContractAmendment,
  approveMeasurementAndGenerateObligation,
  approvePurchaseOrder,
  createContractAmendment,
  createMeasurement,
  createOperationalContract,
  createProcurementNeed,
  createPurchaseOrder,
  createPurchaseRequisition,
  createQuotationProcess,
  decideQuotation,
  qualifySupplier,
  submitSupplierProposal,
  transitionMeasurement,
  transitionOperationalContract,
  transitionPurchaseRequisition,
  validateProcurementNeed,
} from "../src/application/procurement/procurement-service";
import { refreshLegalDeadlines, sendLegalObligationToFinance } from "../src/application/legal/legal-service";
import { DEFAULT_LEGAL_MILESTONES } from "../src/domain/legal/engine";
import {
  activateSalesPriceTable, addPostSaleUpdate, approveSale, approveSalesCommission, blockSalesUnit, confirmSalesReservation,
  convertSalesLead, createPostSaleRequest, createSale, createSalesCommission, createSalesCommissionPolicy, createSalesLead,
  createSalesPriceTable, createSalesProposal, createSalesReservation, createSalesUnit, markUnitDelivered, recordInspectionOutcome,
  scheduleInspection, upsertBrokerProfile,
} from "../src/application/sales/sales-service";
import { allocateAdministrativeCost, calculateEfficiencyVariance, simulateIncentivePool } from "../src/domain/people-performance";
import { seedAccountingDemo } from "./seed-accounting";
import { seedIntegrationsDemo } from "./seed-integrations";

async function main() {
  const passwordHash = await hash("Rede@2026", 12);
  const organization = await prisma.organization.upsert({
    where: { slug: "rede-nucleo-de-negocios" },
    update: { name: "REDE — Núcleo de Negócios" },
    create: {
      name: "REDE — Núcleo de Negócios",
      slug: "rede-nucleo-de-negocios",
      legalName: "REDE Núcleo de Negócios",
    },
  });
  const user = await prisma.user.upsert({
    where: { email: "admin@rede.local" },
    update: { name: "Rafael Lima", passwordHash, isActive: true },
    create: { email: "admin@rede.local", name: "Rafael Lima", passwordHash },
  });
  await prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
    update: { role: MembershipRole.OWNER },
    create: { organizationId: organization.id, userId: user.id, role: MembershipRole.OWNER },
  });
  const context = {
    sessionId: "seed",
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    organizationId: organization.id,
    organizationName: organization.name,
    organizationSlug: organization.slug,
    role: MembershipRole.OWNER,
  };

  const aiTasks = Object.values(AITaskType);
  for (const task of aiTasks) {
    await prisma.aITaskPolicy.upsert({
      where: { organizationId_task: { organizationId: organization.id, task } },
      update: { provider: "rede-deterministic", model: "rede-grounded-v1", enabled: true },
      create: { organizationId: organization.id, task, provider: "rede-deterministic", model: "rede-grounded-v1", maxTokens: task === "REPORT_NARRATIVE" ? 2400 : 1800, temperature: task === "EXTRACTION" || task === "COMPARE" ? 0 : 0.1, enabled: true, createdById: user.id },
    });
  }
  await prisma.aIUsageBudget.upsert({
    where: { organizationId: organization.id },
    update: { monthlyLimit: 0, perUserMonthlyLimit: 0, warningThreshold: 80, maxRequestsPerMinute: 20, maxToolSteps: 8 },
    create: { organizationId: organization.id, monthlyLimit: 0, perUserMonthlyLimit: 0, warningThreshold: 80, currency: "USD", maxRequestsPerMinute: 20, maxToolSteps: 8, createdById: user.id },
  });
  await prisma.aISystemPromptVersion.upsert({
    where: { version: AI_PROMPT_VERSION },
    update: { contentHash: createHash("sha256").update(REDE_AI_SYSTEM_PROMPT).digest("hex"), content: REDE_AI_SYSTEM_PROMPT, active: true },
    create: { version: AI_PROMPT_VERSION, contentHash: createHash("sha256").update(REDE_AI_SYSTEM_PROMPT).digest("hex"), content: REDE_AI_SYSTEM_PROMPT, active: true, createdById: user.id },
  });
  for (const [key, enabled] of [["rede_ai", true], ["external_provider", false], ["document_intelligence", true], ["ai_mutations", true], ["design_intelligence", true]] as const) {
    await prisma.aIFeatureFlag.upsert({
      where: { organizationId_key: { organizationId: organization.id, key } },
      update: { enabled, updatedById: user.id },
      create: { organizationId: organization.id, key, enabled, config: { phase: key === "design_intelligence" ? 8 : 7 }, updatedById: user.id },
    });
  }
  await prisma.aIOrganizationPrompt.deleteMany({ where: { organizationId: organization.id, createdById: user.id } });
  await prisma.aIOrganizationPrompt.createMany({ data: [
    { organizationId: organization.id, category: "COMMITTEE", title: "Briefing para Comitê", prompt: "Prepare o Comitê: sintetize tese, riscos, blockers, condições e decisão pendente.", createdById: user.id },
    { organizationId: organization.id, category: "FINANCE", title: "Stress combinado", prompt: "Simule custo de obra +10%, preço de venda -5% e aprovação +6 meses.", createdById: user.id },
    { organizationId: organization.id, category: "DOCUMENTS", title: "Evidências pendentes", prompt: "Quais documentos faltam e quais conclusões ainda têm baixa confiança?", createdById: user.id },
  ] });

  let study = await getLatestStudyForOrganization(organization.id);
  if (!study) study = await createStudy({ userId: user.id, organizationId: organization.id }, DEMO_PROJECT);
  const latestVersion = await prisma.studyVersion.findUnique({
    where: { id: study.studyVersionId },
    include: {
      policy: true,
      assumptions: { include: { entries: true } },
      scores: true,
      sensitivity: { where: { status: "COMPLETED" } },
      redTeamRuns: { where: { status: "COMPLETED" } },
    },
  });
  if (!latestVersion?.policy || !latestVersion.assumptions?.entries.length || latestVersion.scores.length !== 3 || !latestVersion.sensitivity.length || !latestVersion.redTeamRuns.length) {
    study = await createStudyVersion({ userId: user.id, organizationId: organization.id }, study.projectId, study.studyId, study.assumptions);
  }

  const existingButantaProject = await prisma.project.findUnique({
    where: { organizationId_name: { organizationId: organization.id, name: START_BUTANTA_PROJECT.projectName } },
    include: { studies: { where: { status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, take: 1 } },
  });
  let butantaStudy = existingButantaProject?.studies[0]
    ? await getStudyForOrganization(organization.id, existingButantaProject.studies[0].id)
    : null;
  if (!butantaStudy) butantaStudy = await createStudy(context, START_BUTANTA_PROJECT);
  const butantaBudget = await prisma.budget.findFirst({
    where: { organizationId: organization.id, projectId: butantaStudy.projectId, name: "Orçamento-base START BUTANTÃ" },
  }) ?? await createBudget(context, {
    projectId: butantaStudy.projectId,
    studyVersionId: butantaStudy.studyVersionId,
    name: "Orçamento-base START BUTANTÃ",
    description: "Base demonstrativa compatível com as premissas MCMV do START BUTANTÃ.",
    baseDate: new Date("2026-08-01T00:00:00.000Z"),
    lineItems: START_BUTANTA_BUDGET,
  });

  const economicGroup = await prisma.economicGroup.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: "Grupo REDE — Demonstração" } },
    update: {},
    create: { organizationId: organization.id, name: "Grupo REDE — Demonstração", legalName: "Estrutura econômica demonstrativa", createdById: user.id },
  });
  const company = await prisma.company.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: "START BUTANTÃ SPE — Demonstração" } },
    update: { economicGroupId: economicGroup.id },
    create: { organizationId: organization.id, economicGroupId: economicGroup.id, legalName: "START BUTANTÃ SPE — Demonstração", name: "START BUTANTÃ SPE — Demonstração", type: "SPE", createdById: user.id },
  });
  await prisma.project.update({ where: { id: butantaStudy.projectId }, data: { companyId: company.id } });
  for (const [code, name, managerialAccount] of [
    ["01", "Terreno", "1.01"], ["02", "Projetos", "2.01"], ["03", "Aprovações e regularizações", "3.01"],
    ["04", "Obras", "4.01"], ["05", "Marketing e comercial", "5.01"], ["06", "Administrativo", "6.01"],
    ["07", "Financeiro", "7.01"], ["08", "Jurídico", "8.01"], ["09", "Pós-venda", "9.01"],
  ] as const) {
    const current = await prisma.costCenter.findFirst({ where: { organizationId: organization.id, projectId: butantaStudy.projectId, code } });
    if (!current) await prisma.costCenter.create({ data: { organizationId: organization.id, projectId: butantaStudy.projectId, code, name, managerialAccount, createdById: user.id } });
  }
  for (const unit of [
    { code: "EMP", name: "Empreendimento completo", type: "PHASE" as const, sortOrder: 0 },
    { code: "TOR-A", name: "Torre A", type: "TOWER" as const, sortOrder: 1 },
    { code: "AC", name: "Áreas comuns", type: "COMMON_AREA" as const, sortOrder: 2 },
    { code: "INF", name: "Infraestrutura", type: "INFRASTRUCTURE" as const, sortOrder: 3 },
  ]) await prisma.projectOperatingUnit.upsert({ where: { projectId_code: { projectId: butantaStudy.projectId, code: unit.code } }, update: { name: unit.name, type: unit.type, sortOrder: unit.sortOrder }, create: { projectId: butantaStudy.projectId, createdById: user.id, ...unit } });
  await prisma.materialityPolicy.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: "Política operacional padrão" } },
    update: { isActive: true },
    create: { organizationId: organization.id, name: "Política operacional padrão", informationRate: "0.02", attentionRate: "0.05", relevantRate: "0.10", isActive: true, createdById: user.id },
  });

  let operationalBaseline = await prisma.operationalBaseline.findFirst({ where: { organizationId: organization.id, projectId: butantaStudy.projectId }, orderBy: { version: "desc" } });
  if (!operationalBaseline) operationalBaseline = await prepareOperationalBaseline(context, { projectId: butantaStudy.projectId, studyVersionId: butantaStudy.studyVersionId, name: "Base Aprovada START BUTANTÃ — Demonstração", confirmed: true });
  if (operationalBaseline.status === "PREPARING") operationalBaseline = await requestBaselineApproval(context, operationalBaseline.id);
  if (operationalBaseline.status === "UNDER_APPROVAL") operationalBaseline = await approveOperationalBaseline(context, operationalBaseline.id);
  let officialBudget = await prisma.budget.findFirst({ where: { organizationId: organization.id, operationalBaselineId: operationalBaseline.id }, include: { lineItems: true } });
  if (!officialBudget) officialBudget = await createOfficialBudgetFromBaseline(context, operationalBaseline.id);
  if (officialBudget.status === "DRAFT" || officialBudget.status === "UNDER_REVIEW") officialBudget = await approveBudget(context, officialBudget.id);
  let operationalSchedule = await prisma.operationalSchedule.findFirst({ where: { organizationId: organization.id, projectId: butantaStudy.projectId }, orderBy: { version: "desc" } });
  if (!operationalSchedule) operationalSchedule = await createScheduleFromBudget(context, { budgetId: officialBudget.id, startDate: new Date("2026-09-01T00:00:00.000Z"), endDate: new Date("2029-08-01T00:00:00.000Z"), method: "S_CURVE" });
  if (operationalSchedule.status === "DRAFT" || operationalSchedule.status === "UNDER_REVIEW") operationalSchedule = await approveSchedule(context, operationalSchedule.id);

  // --- Fase 9B: fundação financeira demonstrativa (aditiva e idempotente) ---
  const holdingCompany = await prisma.company.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: "REDE Holding — Demonstração" } },
    update: { economicGroupId: economicGroup.id },
    create: { organizationId: organization.id, economicGroupId: economicGroup.id, legalName: "REDE Holding Participações — Demonstração", name: "REDE Holding — Demonstração", type: "HOLDING", createdById: user.id },
  });

  let operationalBankAccount = await prisma.bankAccount.findFirst({ where: { companyId: company.id, agency: "1234", accountNumber: "56789-0" } });
  if (!operationalBankAccount) operationalBankAccount = await createBankAccount(context, { companyId: company.id, projectId: butantaStudy.projectId, institutionName: "Itaú Unibanco", agency: "1234", accountNumber: "56789-0", holderName: company.name, type: "OPERATIONAL", restriction: "FREE", openingBalance: "500000" });
  let fundingBankAccount = await prisma.bankAccount.findFirst({ where: { companyId: company.id, agency: "4321", accountNumber: "98765-0" } });
  if (!fundingBankAccount) fundingBankAccount = await createBankAccount(context, { companyId: company.id, projectId: butantaStudy.projectId, institutionName: "Bradesco", agency: "4321", accountNumber: "98765-0", holderName: company.name, type: "FUNDING", restriction: "RESTRICTED", openingBalance: "0" });

  let supplier = await prisma.supplier.findFirst({ where: { organizationId: organization.id, taxId: "12.345.678/0001-90" } });
  if (!supplier) supplier = await createSupplier(context, { name: "Construtora Horizonte LTDA", legalName: "Construtora Horizonte LTDA", taxId: "12.345.678/0001-90", email: "financeiro@horizonteconstrutora.com.br" });
  let customer = await prisma.customer.findFirst({ where: { organizationId: organization.id, taxId: "123.456.789-00" } });
  if (!customer) customer = await createCustomer(context, { name: "Maria Aparecida da Silva", taxId: "123.456.789-00", email: "maria.aparecida@example.com" });

  const constructionCostCenter = await prisma.costCenter.findFirst({ where: { organizationId: organization.id, projectId: butantaStudy.projectId, code: "04" } });
  const commercialCostCenter = await prisma.costCenter.findFirst({ where: { organizationId: organization.id, projectId: butantaStudy.projectId, code: "05" } });
  const firstScheduleActivity = await prisma.scheduleActivity.findFirst({ where: { schedule: { projectId: butantaStudy.projectId, status: "APPROVED" } }, orderBy: { sortOrder: "asc" } });

  let payableAccount = await prisma.payableAccount.findFirst({ where: { organizationId: organization.id, projectId: butantaStudy.projectId, supplierId: supplier.id }, include: { installments: true } });
  if (!payableAccount) payableAccount = await createPayableAccount(context, {
    projectId: butantaStudy.projectId, companyId: company.id, costCenterId: constructionCostCenter?.id ?? null, scheduleActivityId: firstScheduleActivity?.id ?? null,
    supplierId: supplier.id, documentNumber: "NF 4821", description: "Medição de obra — fundação e estrutura", origin: "MEASUREMENT",
    competenceMonth: new Date("2026-09-01T00:00:00.000Z"),
    installments: [
      { number: 1, dueDate: new Date("2026-09-15T00:00:00.000Z"), amount: "180000" },
      { number: 2, dueDate: new Date("2026-10-15T00:00:00.000Z"), amount: "180000" },
    ],
  });
  const [firstPayableInstallment, secondPayableInstallment] = payableAccount.installments.length
    ? payableAccount.installments
    : (await prisma.payableAccount.findUniqueOrThrow({ where: { id: payableAccount.id }, include: { installments: { orderBy: { number: "asc" } } } })).installments;
  if (firstPayableInstallment.status === "PREVISTA") {
    await transitionPayableInstallment(context, firstPayableInstallment.id, "PROGRAMADA");
    await transitionPayableInstallment(context, firstPayableInstallment.id, "APROVADA");
  }
  if (secondPayableInstallment.status === "PREVISTA") await transitionPayableInstallment(context, secondPayableInstallment.id, "PROGRAMADA");

  const existingImportedTransaction = await prisma.bankTransaction.findFirst({ where: { bankAccountId: operationalBankAccount.id, description: { contains: "NF 4821" } } });
  if (!existingImportedTransaction) {
    const imported = await importBankTransactions(context, { bankAccountId: operationalBankAccount.id, origin: "MANUAL", transactions: [
      { occurredAt: new Date("2026-09-15T00:00:00.000Z"), amount: "180000", direction: "DEBIT", description: "PAG NF 4821 CONSTRUTORA HORIZONTE", counterparty: "Construtora Horizonte LTDA", documentRef: "NF 4821" },
    ] });
    const [transaction] = imported.transactions;
    const suggestions = await suggestReconciliationsForTransaction(context, transaction.id);
    if (suggestions[0]) await confirmReconciliation(context, suggestions[0].id);
  }

  let receivableAccount = await prisma.receivableAccount.findFirst({ where: { organizationId: organization.id, projectId: butantaStudy.projectId, customerId: customer.id }, include: { installments: true } });
  if (!receivableAccount) receivableAccount = await createReceivableAccount(context, {
    projectId: butantaStudy.projectId, companyId: company.id, costCenterId: commercialCostCenter?.id ?? null, customerId: customer.id,
    unitReference: "Torre A — Unidade 1204", contractReference: "CV-2026-0912", description: "Venda de unidade — Torre A 1204", origin: "SALE",
    competenceMonth: new Date("2026-09-01T00:00:00.000Z"),
    installments: [
      { number: 1, dueDate: new Date("2026-09-10T00:00:00.000Z"), amount: "45000" },
      { number: 2, dueDate: new Date("2027-01-10T00:00:00.000Z"), amount: "45000" },
    ],
  });
  const receivableInstallments = receivableAccount.installments.length
    ? receivableAccount.installments
    : (await prisma.receivableAccount.findUniqueOrThrow({ where: { id: receivableAccount.id }, include: { installments: { orderBy: { number: "asc" } } } })).installments;
  const [firstReceivableInstallment] = receivableInstallments;
  if (firstReceivableInstallment.status === "EMITIDA") {
    await registerReceivablePayment(context, { installmentId: firstReceivableInstallment.id, bankAccountId: operationalBankAccount.id, amount: "45000", method: "PIX", receivedAt: new Date("2026-09-10T00:00:00.000Z") });
  }
  if (receivableInstallments[1]?.status === "PREVISTA") await transitionReceivableInstallment(context, receivableInstallments[1].id, "EMITIDA");

  const existingTransfer = await prisma.financialTransfer.findFirst({ where: { organizationId: organization.id, fromBankAccountId: operationalBankAccount.id, toBankAccountId: fundingBankAccount.id } });
  if (!existingTransfer) await createFinancialTransfer(context, { fromBankAccountId: operationalBankAccount.id, toBankAccountId: fundingBankAccount.id, amount: "50000", transferredAt: new Date("2026-09-05T00:00:00.000Z"), description: "Reserva de funding — demonstração" });

  let intercompanyTransaction = await prisma.intercompanyTransaction.findFirst({ where: { organizationId: organization.id, fromCompanyId: holdingCompany.id, toCompanyId: company.id } });
  if (!intercompanyTransaction) {
    intercompanyTransaction = await createIntercompanyTransaction(context, { fromCompanyId: holdingCompany.id, toCompanyId: company.id, toProjectId: butantaStudy.projectId, amount: "2000000", occurredAt: new Date("2026-09-01T00:00:00.000Z"), nature: "APORTE", description: "Aporte de capital — demonstração START BUTANTÃ" });
  }
  if (intercompanyTransaction.status === "PENDING") await approveIntercompanyTransaction(context, intercompanyTransaction.id);

  // --- Fase 9C: suprimentos, contratos, aditivos e medições (aditivo e idempotente) ---
  await qualifySupplier(context, { supplierId: supplier.id, category: "Estrutura e fundações", status: "QUALIFIED", validUntil: new Date("2027-12-31T00:00:00.000Z"), evidence: { source: "seed", certificates: ["CREA", "Seguro RC", "Regularidade fiscal"] } });
  let materialsSupplier = await prisma.supplier.findFirst({ where: { organizationId: organization.id, taxId: "45.678.901/0001-22" } });
  if (!materialsSupplier) materialsSupplier = await createSupplier(context, { name: "Materiais Urbanos Brasil", legalName: "Materiais Urbanos Brasil S.A.", taxId: "45.678.901/0001-22", email: "propostas@materiaisurbanos.com.br" });
  await qualifySupplier(context, { supplierId: materialsSupplier.id, category: "Materiais de construção", status: "QUALIFIED_WITH_RESTRICTIONS", validUntil: new Date("2027-06-30T00:00:00.000Z"), evidence: { source: "seed", restriction: "Renovar seguro antes da mobilização" } });

  const officialLine = await prisma.budgetLineItem.findFirst({ where: { budgetId: officialBudget.id, totalCost: { gt: 0 } }, orderBy: { totalCost: "desc" } });
  if (!officialLine) throw new Error("Orçamento Oficial precisa de ao menos uma verba para o seed da Fase 9C.");
  let procurementNeed = await prisma.procurementNeed.findUnique({ where: { projectId_code: { projectId: butantaStudy.projectId, code: "SUP-001" } } });
  if (!procurementNeed) procurementNeed = await createProcurementNeed(context, { projectId: butantaStudy.projectId, companyId: company.id, costCenterId: officialLine.costCenterId, economicItemId: officialLine.economicItemId, budgetLineItemId: officialLine.id, scheduleActivityId: firstScheduleActivity?.id ?? null, code: "SUP-001", description: "Execução de fundações e estrutura", specification: "Fornecimento de mão de obra, equipamentos, formas e execução integral das fundações e estrutura conforme revisão aprovada.", quantity: "1", unit: "lote", requiredAt: new Date("2026-09-01T00:00:00.000Z"), expectedLeadDays: 75, bufferDays: 15, priority: "CRITICAL", origin: "SCHEDULE", originReference: firstScheduleActivity?.id ?? null });
  if (procurementNeed.status === "IDENTIFIED") procurementNeed = await validateProcurementNeed(context, procurementNeed.id);

  let requisition = await prisma.purchaseRequisition.findUnique({ where: { projectId_number: { projectId: butantaStudy.projectId, number: "RC-2026-001" } }, include: { items: true } });
  if (!requisition) requisition = await createPurchaseRequisition(context, { projectId: butantaStudy.projectId, companyId: company.id, number: "RC-2026-001", title: "Contratação de fundações e estrutura", justification: "Pacote crítico do caminho de obra do START BUTANTÃ.", buyerId: user.id, technicalOwnerId: user.id, needIds: [procurementNeed.id] });
  for (const next of ["REQUESTED", "IN_APPROVAL", "APPROVED_FOR_QUOTATION"] as const) if (requisition.status !== "APPROVED_FOR_QUOTATION" && requisition.status !== "IN_QUOTATION" && requisition.status !== "FULFILLED") requisition = { ...requisition, ...(await transitionPurchaseRequisition(context, requisition.id, next)) };

  let quotation = await prisma.quotationProcess.findUnique({ where: { projectId_number: { projectId: butantaStudy.projectId, number: "CQ-2026-001" } }, include: { requisition: { include: { items: true } }, proposals: true } });
  if (!quotation) {
    await createQuotationProcess(context, { requisitionId: requisition.id, number: "CQ-2026-001", title: "Cotação — fundações e estrutura", scope: "Execução integral, incluindo instalação, mobilização, segurança, formas e desmobilização.", requirements: { designRevision: "R02", includesInstallation: true, technicalCapacity: "obras residenciais verticais" }, deliveryLocation: "START BUTANTÃ — São Paulo/SP", deliveryTerm: "Mobilização em até 30 dias", responseDeadline: new Date("2026-08-25T00:00:00.000Z"), supplierIds: [supplier.id, materialsSupplier.id] });
    quotation = await prisma.quotationProcess.findUniqueOrThrow({ where: { projectId_number: { projectId: butantaStudy.projectId, number: "CQ-2026-001" } }, include: { requisition: { include: { items: true } }, proposals: true } });
  }
  const requisitionItem = await prisma.purchaseRequisitionItem.findFirstOrThrow({ where: { requisitionId: requisition.id } });
  let selectedProposal = await prisma.supplierProposal.findUnique({ where: { quotationProcessId_supplierId_version: { quotationProcessId: quotation.id, supplierId: supplier.id, version: 1 } } });
  if (!selectedProposal) selectedProposal = await submitSupplierProposal(context, { quotationProcessId: quotation.id, supplierId: supplier.id, version: 1, taxAmount: "0", freightAmount: "0", discountAmount: "20000", validityUntil: new Date("2026-09-30T00:00:00.000Z"), deliveryTermDays: 30, paymentTerms: "10% mobilização, 80% por medição, 10% entrega", warrantyTerms: "5 anos", inclusions: ["Instalação", "Equipamentos", "Segurança"], exclusions: [], notes: "Proposta comercial demonstrativa estruturada.", items: [{ requisitionItemId: requisitionItem.id, description: "Fundações e estrutura completas", quantity: "1", unit: "lote", unitPrice: "950000", taxAmount: "0", freightAmount: "0", discountAmount: "0", comparability: "COMPARABLE", inclusions: ["Instalação"], exclusions: [] }] });
  let procurementDecision = await prisma.procurementDecision.findUnique({ where: { quotationProcessId: quotation.id } });
  if (!procurementDecision) procurementDecision = await decideQuotation(context, { quotationProcessId: quotation.id, selectedProposalId: selectedProposal.id, technicalOpinion: "Escopo tecnicamente equivalente à referência, incluindo instalação e equipamentos.", commercialRationale: "Melhor combinação entre preço, prazo, capacidade e escopo; não selecionado apenas pelo menor preço.", referenceAmount: "1000000", scopeComparable: true });

  let purchaseOrder = await prisma.purchaseOrder.findUnique({ where: { projectId_number: { projectId: butantaStudy.projectId, number: "PC-2026-001" } } });
  if (!purchaseOrder) purchaseOrder = await createPurchaseOrder(context, { projectId: butantaStudy.projectId, companyId: company.id, supplierId: materialsSupplier.id, number: "PC-2026-001", title: "Aço para mobilização inicial", scope: "Lote inicial de aço conforme especificação estrutural R02.", deliveryAt: new Date("2026-09-10T00:00:00.000Z"), paymentTerms: "30 dias", items: [{ economicItemId: officialLine.economicItemId, budgetLineItemId: officialLine.id, costCenterId: officialLine.costCenterId, scheduleActivityId: firstScheduleActivity?.id ?? null, description: "Aço CA-50/CA-60", quantity: "25", unit: "t", unitPrice: "3000" }] });
  if (["DRAFT", "IN_APPROVAL"].includes(purchaseOrder.status)) purchaseOrder = await approvePurchaseOrder(context, purchaseOrder.id);

  let operationalContract = await prisma.operationalContract.findUnique({ where: { projectId_number: { projectId: butantaStudy.projectId, number: "CT-2026-001" } }, include: { items: true } });
  if (!operationalContract) operationalContract = await createOperationalContract(context, { projectId: butantaStudy.projectId, companyId: company.id, supplierId: supplier.id, quotationProcessId: quotation.id, selectedProposalId: selectedProposal.id, number: "CT-2026-001", title: "Contrato de fundações e estrutura", type: "CONSTRUCTION", billingModel: "MEASUREMENT", scope: "Execução integral das fundações e estrutura do START BUTANTÃ.", startsAt: new Date("2026-09-01T00:00:00.000Z"), endsAt: new Date("2027-08-31T00:00:00.000Z"), responsibleId: user.id, paymentTerms: "Medição mensal, vencimento em 15 dias", retentionRate: "0.05", warrantyTerms: "5 anos", items: [{ code: "01", economicItemId: officialLine.economicItemId, budgetLineItemId: officialLine.id, costCenterId: officialLine.costCenterId, scheduleActivityId: firstScheduleActivity?.id ?? null, description: "Fundações e estrutura completas", quantity: "930", unit: "unidade de serviço", unitPrice: "1000" }] });
  for (const next of ["UNDER_REVIEW", "IN_APPROVAL", "APPROVED", "ACTIVE"] as const) if (!["ACTIVE", "SUSPENDED", "CLOSED"].includes(operationalContract.status)) operationalContract = { ...operationalContract, ...(await transitionOperationalContract(context, operationalContract.id, next)) };
  let amendment = await prisma.contractAmendment.findUnique({ where: { contractId_number: { contractId: operationalContract.id, number: 1 } } });
  if (!amendment) amendment = await createContractAmendment(context, { contractId: operationalContract.id, number: 1, type: "INCREASE", reason: "Reforço localizado decorrente de condição geotécnica imprevista.", deviationCause: "UNFORESEEN_CONDITION", scopeDescription: "Reforço de estacas em setor identificado no relatório geotécnico complementar.", value: "50000", termDays: 10, effectiveAt: new Date("2026-10-01T00:00:00.000Z") });
  if (amendment.status !== "APPROVED") amendment = await approveContractAmendment(context, amendment.id);
  const contractItem = await prisma.operationalContractItem.findFirstOrThrow({ where: { contractId: operationalContract.id } });
  let measurement = await prisma.measurementCertificate.findUnique({ where: { contractId_number_version: { contractId: operationalContract.id, number: 1, version: 1 } } });
  if (!measurement) measurement = await createMeasurement(context, { contractId: operationalContract.id, number: 1, version: 1, competenceDate: new Date("2026-10-01T00:00:00.000Z"), periodStart: new Date("2026-09-01T00:00:00.000Z"), periodEnd: new Date("2026-09-30T00:00:00.000Z"), issuedAt: new Date("2026-10-01T00:00:00.000Z"), dueDate: new Date("2026-10-15T00:00:00.000Z"), physicalProgress: "0.215054", retentionAmount: "10000", discountAmount: "0", advanceAmortizationAmount: "0", lines: [{ contractItemId: contractItem.id, periodQuantity: "200" }] });
  for (const next of ["SUBMITTED", "IN_TECHNICAL_REVIEW", "TECHNICALLY_APPROVED", "IN_APPROVAL"] as const) if (!["SENT_TO_FINANCE", "APPROVED"].includes(measurement.status)) measurement = { ...measurement, ...(await transitionMeasurement(context, measurement.id, next)) };
  if (measurement.status === "IN_APPROVAL") await approveMeasurementAndGenerateObligation(context, measurement.id);

  // --- Fase 9D: Jurídico, diligência, obrigações e licenças (aditivo e idempotente) ---
  const legalLandWorkspace = await ensureDemoLandStudy({ userId: user.id, organizationId: organization.id });
  const legalLandStudy = await prisma.landStudy.findUniqueOrThrow({ where: { id: legalLandWorkspace.landStudyId }, include: { landAsset: true } });
  if (legalLandStudy.landAsset.projectId !== butantaStudy.projectId) await prisma.landAsset.update({ where: { id: legalLandStudy.landAssetId }, data: { projectId: butantaStudy.projectId } });
  await prisma.legalDeadlinePolicy.upsert({ where: { organizationId_name_version: { organizationId: organization.id, name: "Política padrão de prazos jurídicos", version: 1 } }, update: { isActive: true, milestones: DEFAULT_LEGAL_MILESTONES }, create: { organizationId: organization.id, name: "Política padrão de prazos jurídicos", version: 1, milestones: DEFAULT_LEGAL_MILESTONES, isActive: true, createdById: user.id } });
  const diligence = await prisma.legalDueDiligenceCase.upsert({ where: { organizationId_code: { organizationId: organization.id, code: "DD-START-001" } }, update: { projectId: butantaStudy.projectId, landAssetId: legalLandStudy.landAssetId, updatedById: user.id }, create: { organizationId: organization.id, projectId: butantaStudy.projectId, landAssetId: legalLandStudy.landAssetId, code: "DD-START-001", title: "Diligência imobiliária START BUTANTÃ", scope: "Titularidade, cadeia dominial, ônus, tributos municipais, licenças, contratos e condições precedentes.", status: "UNDER_REVIEW", currentVersion: 1, startedAt: new Date("2026-08-01"), targetCompletionAt: new Date("2026-09-15"), responsibleId: user.id, createdById: user.id, updatedById: user.id } });
  for (const item of [
    { code: "MAT-001", category: "REGISTRAL", title: "Matrícula atualizada e certidão de ônus", criticality: "CRITICAL" as const, status: "COMPLIANT" as const, dueAt: new Date("2026-08-20") },
    { code: "IPTU-001", category: "TRIBUTÁRIO", title: "Espelho de IPTU e certidão negativa municipal", criticality: "HIGH" as const, status: "UNDER_REVIEW" as const, dueAt: new Date("2026-09-05") },
    { code: "AMB-001", category: "AMBIENTAL", title: "Consulta de passivo e restrições ambientais", criticality: "CRITICAL" as const, status: "NON_COMPLIANT" as const, dueAt: new Date("2026-09-10") },
    { code: "CON-001", category: "CONTRATUAL", title: "Condições precedentes da aquisição", criticality: "HIGH" as const, status: "UNDER_REVIEW" as const, dueAt: new Date("2026-09-15") },
  ]) await prisma.legalChecklistItem.upsert({ where: { diligenceCaseId_code: { diligenceCaseId: diligence.id, code: item.code } }, update: { status: item.status, dueAt: item.dueAt, updatedById: user.id }, create: { diligenceCaseId: diligence.id, templateKey: "DILIGENCIA_IMOBILIARIA", templateVersion: 1, code: item.code, category: item.category, title: item.title, criticality: item.criticality, status: item.status, responsibleId: user.id, dueAt: item.dueAt, createdById: user.id, updatedById: user.id } });
  const registrationDocument = await prisma.procurementDocumentLink.upsert({ where: { organizationId_entityType_entityId_documentType_version: { organizationId: organization.id, entityType: "LegalDueDiligenceCase", entityId: diligence.id, documentType: "MATRICULA", version: 1 } }, update: {}, create: { organizationId: organization.id, entityType: "LegalDueDiligenceCase", entityId: diligence.id, documentType: "MATRICULA", fileName: "matricula-start-butanta-demonstracao.pdf", mimeType: "application/pdf", storageKey: `legal/${diligence.id}/matricula-v1.pdf`, checksum: createHash("sha256").update("matricula-start-butanta-v1").digest("hex"), version: 1, isPrivate: true, metadata: { demo: true, room: "Sala de Documentos" }, createdById: user.id } });
  await prisma.legalAssetRegistration.upsert({ where: { landAssetId_registrationNumber_version: { landAssetId: legalLandStudy.landAssetId, registrationNumber: "123.456", version: 1 } }, update: { sourceDocumentLinkId: registrationDocument.id }, create: { organizationId: organization.id, landAssetId: legalLandStudy.landAssetId, registryOffice: "10º Oficial de Registro de Imóveis de São Paulo", registrationNumber: "123.456", book: "2", version: 1, status: "COMPLIANT", provenance: "OFFICIAL_DOCUMENT", sourceDocumentLinkId: registrationDocument.id, registeredOwner: "Butantã Desenvolvimento Imobiliário Ltda.", area: "4875.50", entries: [{ type: "REGISTRO", number: "R.4", description: "Aquisição demonstrativa" }, { type: "AVERBACAO", number: "AV.7", description: "Retificação de área — sujeita à confirmação documental" }], effectiveAt: new Date("2026-07-15"), verifiedAt: new Date("2026-08-18"), responsibleId: user.id, createdById: user.id } });
  await prisma.municipalPropertyRecord.upsert({ where: { landAssetId_fiscalYear_version: { landAssetId: legalLandStudy.landAssetId, fiscalYear: 2026, version: 1 } }, update: {}, create: { organizationId: organization.id, landAssetId: legalLandStudy.landAssetId, municipalityCode: "3550308", municipalRegistration: legalLandStudy.landAsset.municipalRegistration ?? "123.456.7890-1", fiscalYear: 2026, version: 1, assessedValue: "9200000", propertyTaxAmount: "138000", debtStatus: "NOT_VERIFIED", debtAmount: "0", provenance: "MANUAL", sourceRef: "IPTU-DEMO-2026", sourceSnapshot: { disclaimer: "Dado demonstrativo; exige certidão oficial." }, createdById: user.id } });
  const seller = await prisma.supplier.findFirst({ where: { organizationId: organization.id, taxId: "98.765.432/0001-10" } }) ?? await createSupplier(context, { name: "Butantã Desenvolvimento Imobiliário", legalName: "Butantã Desenvolvimento Imobiliário Ltda.", taxId: "98.765.432/0001-10", email: "juridico@butantadesenvolvimento.demo" });
  await prisma.legalPartyLink.upsert({ where: { diligenceCaseId_partyType_partyId_role: { diligenceCaseId: diligence.id, partyType: "SUPPLIER", partyId: seller.id, role: "PROPRIETÁRIO_VENDEDOR" } }, update: { nameSnapshot: seller.name, taxIdSnapshot: seller.taxId }, create: { diligenceCaseId: diligence.id, partyType: "SUPPLIER", partyId: seller.id, role: "PROPRIETÁRIO_VENDEDOR", nameSnapshot: seller.name, taxIdSnapshot: seller.taxId, provenance: "OFFICIAL_DOCUMENT", createdById: user.id } });
  for (const item of [
    { code: "DOC-MAT", documentType: "MATRICULA", title: "Matrícula atualizada e certidão de ônus", status: "COMPLIANT" as const, link: registrationDocument.id, dueAt: new Date("2026-08-20") },
    { code: "DOC-CND", documentType: "CERTIDAO_MUNICIPAL", title: "Certidão negativa de débitos municipais", status: "REQUESTED" as const, link: null, dueAt: new Date("2026-09-05") },
  ]) await prisma.legalDocumentRequest.upsert({ where: { diligenceCaseId_code_version: { diligenceCaseId: diligence.id, code: item.code, version: 1 } }, update: { status: item.status, documentLinkId: item.link, updatedById: user.id }, create: { diligenceCaseId: diligence.id, code: item.code, documentType: item.documentType, title: item.title, status: item.status, requestedAt: new Date("2026-08-01"), dueAt: item.dueAt, receivedAt: item.link ? new Date("2026-08-18") : null, documentLinkId: item.link, version: 1, responsibleId: user.id, createdById: user.id, updatedById: user.id } });
  const legalFinding = await prisma.legalFinding.upsert({ where: { diligenceCaseId_code: { diligenceCaseId: diligence.id, code: "FIND-AMB-001" } }, update: {}, create: { diligenceCaseId: diligence.id, code: "FIND-AMB-001", category: "AMBIENTAL", severity: "CRITICAL", title: "Evidência ambiental ainda insuficiente", description: "A documentação atual não permite concluir pela inexistência de passivo ambiental.", evidence: [{ type: "MISSING_DOCUMENT", ref: "DOC-AMB" }], recommendation: "Condicionar a aquisição à emissão de relatório ambiental conclusivo e aceite jurídico.", status: "UNDER_REVIEW", ownerId: user.id, targetDate: new Date("2026-09-10"), createdById: user.id, updatedById: user.id } });
  await prisma.legalDecision.upsert({ where: { diligenceCaseId_version: { diligenceCaseId: diligence.id, version: 1 } }, update: {}, create: { diligenceCaseId: diligence.id, version: 1, decision: "PROCEED_WITH_CONDITIONS", executiveConclusion: "Prosseguir condicionado à regularização das evidências ambientais e à certidão municipal atualizada.", conditions: [{ code: "CP-AMB", findingId: legalFinding.id }], blockers: [], findingSnapshot: [{ id: legalFinding.id, severity: legalFinding.severity, status: legalFinding.status }], decidedById: user.id, decidedAt: new Date("2026-08-20") } });
  let landContract = await prisma.operationalContract.findUnique({ where: { projectId_number: { projectId: butantaStudy.projectId, number: "CT-TERR-2026-001" } } });
  if (!landContract) landContract = await prisma.operationalContract.create({ data: { organizationId: organization.id, companyId: company.id, projectId: butantaStudy.projectId, supplierId: seller.id, number: "CT-TERR-2026-001", title: "Instrumento de aquisição do terreno START BUTANTÃ", type: "ACQUISITION", billingModel: "MILESTONE", scope: "Aquisição demonstrativa condicionada à conclusão da diligência e ao cumprimento das condições precedentes.", originalAmount: "12000000", startsAt: new Date("2026-08-01"), endsAt: new Date("2026-12-15"), responsibleId: user.id, paymentTerms: "Sinal e saldo no fechamento após condições precedentes", status: "ACTIVE", approvedById: user.id, approvedAt: new Date("2026-08-01"), activatedAt: new Date("2026-08-01"), createdById: user.id, updatedById: user.id } });
  await prisma.legalContractCondition.upsert({ where: { contractId_code: { contractId: landContract.id, code: "CP-AMB" } }, update: {}, create: { contractId: landContract.id, code: "CP-AMB", description: "Conclusão satisfatória da diligência ambiental.", status: "UNDER_REVIEW", dueAt: new Date("2026-09-10"), responsibleId: user.id, createdById: user.id, updatedById: user.id } });
  await prisma.legalGuarantee.upsert({ where: { contractId_code: { contractId: landContract.id, code: "GAR-SINAL" } }, update: {}, create: { contractId: landContract.id, code: "GAR-SINAL", type: "CONTA_VINCULADA", issuer: company.name, beneficiary: seller.name, amount: "1200000", startsAt: new Date("2026-08-01"), expiresAt: new Date("2026-12-15"), status: "COMPLIANT", createdById: user.id, updatedById: user.id } });
  const legalCostCenter = await prisma.costCenter.findFirst({ where: { organizationId: organization.id, projectId: butantaStudy.projectId, code: "08" } });
  const legalObligation = await prisma.legalObligation.upsert({ where: { organizationId_code: { organizationId: organization.id, code: "LEG-EMOL-001" } }, update: {}, create: { organizationId: organization.id, projectId: butantaStudy.projectId, operationalContractId: landContract.id, code: "LEG-EMOL-001", type: "EMOLUMENTOS_REGISTRAIS", title: "Emolumentos de registro da aquisição", description: "Custas demonstrativas previstas para o registro do instrumento de aquisição.", authority: "Registro de Imóveis", criticality: "HIGH", status: "ACTIVE", dueAt: new Date("2026-10-15"), amount: "48500", supplierId: seller.id, companyId: company.id, costCenterId: legalCostCenter?.id ?? null, provenance: "CONTRACT", sourceRef: landContract.id, responsibleId: user.id, createdById: user.id, updatedById: user.id } });
  await sendLegalObligationToFinance(context, legalObligation.id);
  await prisma.legalLicense.upsert({ where: { projectId_code_version: { projectId: butantaStudy.projectId, code: "LIC-DEM", version: 1 } }, update: {}, create: { organizationId: organization.id, projectId: butantaStudy.projectId, code: "LIC-DEM", type: "DEMOLICAO", title: "Alvará de demolição", authority: "Prefeitura de São Paulo", processNumber: "SEI-DEMO-2026-001", status: "APPROVED_WITH_CONDITIONS", version: 1, issuedAt: new Date("2026-08-10"), validFrom: new Date("2026-08-10"), expiresAt: new Date("2026-11-30"), renewalLeadDays: 60, provenance: "OFFICIAL_DOCUMENT", responsibleId: user.id, createdById: user.id, updatedById: user.id, conditions: { create: [{ code: "LIC-COND-01", description: "Apresentar plano de gerenciamento de resíduos antes do início dos serviços.", status: "UNDER_REVIEW", dueAt: new Date("2026-09-01"), responsibleId: user.id, createdById: user.id, updatedById: user.id }] } } });
  await prisma.legalAuthorityProcess.upsert({ where: { organizationId_authority_processNumber: { organizationId: organization.id, authority: "Prefeitura de São Paulo", processNumber: "SEI-DEMO-2026-002" } }, update: {}, create: { organizationId: organization.id, projectId: butantaStudy.projectId, code: "PROC-ALV-001", authority: "Prefeitura de São Paulo", processNumber: "SEI-DEMO-2026-002", subject: "Alvará de aprovação e execução", status: "UNDER_REVIEW", submittedAt: new Date("2026-08-12"), expectedDecisionAt: new Date("2026-12-15"), lastMovementAt: new Date("2026-08-19"), movements: [{ date: "2026-08-19", description: "Distribuição para análise técnica" }], provenance: "USER_CONFIRMED", responsibleId: user.id, createdById: user.id, updatedById: user.id } });
  await prisma.legalTimelineEvent.upsert({ where: { organizationId_sourceType_sourceId_code: { organizationId: organization.id, sourceType: "LEGAL_CONDITION", sourceId: legalFinding.id, code: "MARCO-AMB" } }, update: {}, create: { organizationId: organization.id, projectId: butantaStudy.projectId, scheduleActivityId: firstScheduleActivity?.id ?? null, sourceType: "LEGAL_CONDITION", sourceId: legalFinding.id, code: "MARCO-AMB", title: "Conclusão da diligência ambiental", plannedAt: new Date("2026-09-10"), status: "UNDER_REVIEW", blocksSchedule: true, impactDays: 30, criticality: "CRITICAL", responsibleId: user.id, createdById: user.id, updatedById: user.id } });
  await refreshLegalDeadlines(context, butantaStudy.projectId, new Date("2026-08-21"));

  await prisma.approvalPolicy.upsert({ where: { organizationId_name_version: { organizationId: organization.id, name: "Alçada padrão de suprimentos", version: 1 } }, update: { isActive: true }, create: { organizationId: organization.id, name: "Alçada padrão de suprimentos", version: 1, actType: "CONTRACT", companyId: company.id, projectId: butantaStudy.projectId, minimumAmount: "0", requiredRole: "ADMIN", requiredApprovals: 1, segregationRequired: true, createdById: user.id } });

  // --- Fase 9E: vendas, clientes, unidades, contratos de venda, recebíveis e pós-venda (aditivo e idempotente) ---
  const towerAOperatingUnit = await prisma.projectOperatingUnit.findFirst({ where: { projectId: butantaStudy.projectId, code: "TOR-A" } });
  let salesUnitSold = await prisma.salesUnit.findUnique({ where: { projectId_code: { projectId: butantaStudy.projectId, code: "TOR-A-1301" } } });
  if (!salesUnitSold) salesUnitSold = await createSalesUnit(context, { projectId: butantaStudy.projectId, companyId: company.id, operatingUnitId: towerAOperatingUnit?.id ?? null, code: "TOR-A-1301", floor: "13", typology: "2 dormitórios", privateAreaM2: "55.4", parkingSpaces: 1, storageUnits: 1, position: "Leste" });
  let salesUnitBlocked = await prisma.salesUnit.findUnique({ where: { projectId_code: { projectId: butantaStudy.projectId, code: "TOR-A-1302" } } });
  if (!salesUnitBlocked) salesUnitBlocked = await createSalesUnit(context, { projectId: butantaStudy.projectId, companyId: company.id, operatingUnitId: towerAOperatingUnit?.id ?? null, code: "TOR-A-1302", floor: "13", typology: "3 dormitórios", privateAreaM2: "72.1", parkingSpaces: 2, storageUnits: 1, position: "Oeste — vista parque" });
  let salesUnitAvailable = await prisma.salesUnit.findUnique({ where: { projectId_code: { projectId: butantaStudy.projectId, code: "TOR-A-1303" } } });
  if (!salesUnitAvailable) salesUnitAvailable = await createSalesUnit(context, { projectId: butantaStudy.projectId, companyId: company.id, operatingUnitId: towerAOperatingUnit?.id ?? null, code: "TOR-A-1303", floor: "13", typology: "2 dormitórios", privateAreaM2: "55.4", parkingSpaces: 1, storageUnits: 1, position: "Leste" });

  const salesPriceLine = await prisma.salesPriceTableLine.findFirst({ where: { salesUnitId: salesUnitSold.id } });
  let salesPriceTable = salesPriceLine ? await prisma.salesPriceTable.findUnique({ where: { id: salesPriceLine.priceTableId } }) : null;
  if (!salesPriceTable) {
    salesPriceTable = await createSalesPriceTable(context, { projectId: butantaStudy.projectId, companyId: company.id, validFrom: new Date("2026-08-01T00:00:00.000Z"), responsibleId: user.id, notes: "Tabela demonstrativa START BUTANTÃ — v1", lines: [
      { salesUnitId: salesUnitSold.id, listPrice: "620000", minimumAuthorizedPrice: "590000" },
      { salesUnitId: salesUnitBlocked.id, listPrice: "780000", minimumAuthorizedPrice: "750000" },
      { salesUnitId: salesUnitAvailable.id, listPrice: "615000", minimumAuthorizedPrice: "590000" },
    ] });
  }
  if (salesPriceTable.status === "DRAFT") salesPriceTable = await activateSalesPriceTable(context, salesPriceTable.id);

  let broker = await prisma.supplier.findFirst({ where: { organizationId: organization.id, taxId: "111.222.333-44" } });
  if (!broker) broker = await createSupplier(context, { name: "Patrícia Nogueira — Corretora", legalName: "Patrícia Nogueira", taxId: "111.222.333-44", personType: "INDIVIDUAL", email: "patricia.nogueira@corretora.demo" });
  await upsertBrokerProfile(context, { supplierId: broker.id, creci: "SP-123456-F", channel: "Plantão de vendas" });

  let buyerCustomer = await prisma.customer.findFirst({ where: { organizationId: organization.id, taxId: "234.567.890-11" } });
  if (!buyerCustomer) buyerCustomer = await createCustomer(context, { name: "João Ricardo Ferreira", taxId: "234.567.890-11", email: "joao.ferreira@example.com" });

  let salesLead = await prisma.salesLead.findFirst({ where: { organizationId: organization.id, name: "João Ricardo Ferreira" } });
  if (!salesLead) salesLead = await createSalesLead(context, { projectId: butantaStudy.projectId, name: "João Ricardo Ferreira", contact: "(11) 98888-7777", source: "Portal imobiliário", channel: "Digital", brokerId: broker.id });
  if (salesLead.stage !== "CONVERTIDO") salesLead = await convertSalesLead(context, { leadId: salesLead.id, customerId: buyerCustomer.id });

  let salesProposal = await prisma.salesProposal.findFirst({ where: { salesUnitId: salesUnitSold.id, customerId: buyerCustomer.id } });
  if (!salesProposal) salesProposal = await createSalesProposal(context, { salesUnitId: salesUnitSold.id, customerId: buyerCustomer.id, brokerId: broker.id, priceTableId: salesPriceTable.id, proposedPrice: "610000", discountAmount: "10000", validUntil: new Date("2026-09-15T00:00:00.000Z"), paymentConditionSummary: { entrada: "10%", saldo: "financiamento + mensais" } });

  let salesReservation = await prisma.salesReservation.findFirst({ where: { salesUnitId: salesUnitSold.id, customerId: buyerCustomer.id } });
  if (!salesReservation) salesReservation = await createSalesReservation(context, { salesUnitId: salesUnitSold.id, customerId: buyerCustomer.id, proposalId: salesProposal.id, expiresAt: new Date("2026-09-05T00:00:00.000Z"), responsibleId: user.id, condition: { sinal: "R$ 5.000" } });
  if (salesReservation.status === "ACTIVE") salesReservation = await confirmSalesReservation(context, salesReservation.id);

  let sale = await prisma.sale.findFirst({ where: { salesUnitId: salesUnitSold.id, status: { not: "CANCELLED" } } });
  if (!sale) sale = await createSale(context, { salesUnitId: salesUnitSold.id, priceTableId: salesPriceTable.id, proposalId: salesProposal.id, reservationId: salesReservation.id, brokerId: broker.id, soldPrice: "610000", commercialConditionSnapshot: { formaPagamento: "Entrada + mensal + saldo" }, parties: [{ customerId: buyerCustomer.id, role: "BUYER", ownershipPercentage: "100" }] });
  if (sale.status === "DRAFT") {
    const approved = await approveSale(context, { saleId: sale.id, contract: { number: "CV-2026-1301", title: "Contrato de Compra e Venda — Torre A, Unidade 1301", effectiveFrom: new Date("2026-09-10T00:00:00.000Z") }, installments: [
      { number: 1, nature: "DOWN_PAYMENT", dueDate: new Date("2026-09-10T00:00:00.000Z"), amount: "61000" },
      { number: 2, nature: "MONTHLY", dueDate: new Date("2026-10-10T00:00:00.000Z"), amount: "274500" },
      { number: 3, nature: "BALANCE", dueDate: new Date("2027-03-10T00:00:00.000Z"), amount: "274500" },
    ] });
    sale = approved.sale;
  }

  const salePlan = await prisma.salesPaymentPlan.findFirstOrThrow({ where: { saleId: sale.id, status: "ACTIVE" }, include: { installments: { orderBy: { number: "asc" } } } });
  const [downPaymentInstallment] = salePlan.installments;
  if (downPaymentInstallment?.receivableInstallmentId) {
    const downPaymentReceivable = await prisma.receivableInstallment.findUnique({ where: { id: downPaymentInstallment.receivableInstallmentId } });
    if (downPaymentReceivable?.status === "EMITIDA") await registerReceivablePayment(context, { installmentId: downPaymentReceivable.id, bankAccountId: operationalBankAccount.id, amount: "61000", method: "PIX", receivedAt: new Date("2026-09-10T00:00:00.000Z") });
  }

  let salesCommissionPolicy = await prisma.salesCommissionPolicy.findFirst({ where: { organizationId: organization.id, projectId: butantaStudy.projectId } });
  if (!salesCommissionPolicy) salesCommissionPolicy = await createSalesCommissionPolicy(context, { projectId: butantaStudy.projectId, triggerEvent: "SIGNATURE", percentage: "0.04", basis: "SOLD_PRICE" });
  let salesCommission = await prisma.salesCommission.findFirst({ where: { saleId: sale.id } });
  if (!salesCommission) salesCommission = await createSalesCommission(context, { saleId: sale.id, brokerId: broker.id, policyId: salesCommissionPolicy.id, basis: "SOLD_PRICE", percentage: "0.04", triggerEvent: "SIGNATURE" });
  if (salesCommission.status === "PENDING") salesCommission = await approveSalesCommission(context, salesCommission.id);

  let salesInspection = await prisma.salesUnitInspection.findFirst({ where: { salesUnitId: salesUnitSold.id, saleId: sale.id } });
  if (!salesInspection) salesInspection = await scheduleInspection(context, { salesUnitId: salesUnitSold.id, saleId: sale.id, scheduledAt: new Date("2026-09-20T00:00:00.000Z"), responsibleId: user.id, checklist: { pintura: "ok", hidraulica: "ok", eletrica: "ok" } });
  if (!salesInspection.outcome) salesInspection = await recordInspectionOutcome(context, { inspectionId: salesInspection.id, outcome: "ACCEPTED", pendingIssues: [] });

  let deliveredUnit = await prisma.salesUnit.findUniqueOrThrow({ where: { id: salesUnitSold.id } });
  if (deliveredUnit.status === "VENDIDA") deliveredUnit = await markUnitDelivered(context, salesUnitSold.id);

  let postSaleRequest = await prisma.postSaleRequest.findFirst({ where: { saleId: sale.id } });
  if (!postSaleRequest) postSaleRequest = await createPostSaleRequest(context, { salesUnitId: salesUnitSold.id, saleId: sale.id, customerId: buyerCustomer.id, category: "ASSISTENCIA", description: "Ajuste de esquadria da sala — porta não fecha corretamente.", responsibleId: user.id, slaDueAt: new Date("2026-10-15T00:00:00.000Z") });
  if (postSaleRequest.status === "OPEN") await addPostSaleUpdate(context, { requestId: postSaleRequest.id, note: "Visita técnica agendada para a próxima semana." });

  const salesUnitBlockedCurrent = await prisma.salesUnit.findUniqueOrThrow({ where: { id: salesUnitBlocked.id } });
  if (salesUnitBlockedCurrent.status === "DISPONIVEL") await blockSalesUnit(context, { salesUnitId: salesUnitBlocked.id, origin: "COMERCIAL", responsibleId: user.id, reason: "Reservada para lançamento institucional — bloqueio demonstrativo." });

  // --- Fase 9F: pessoas, custos administrativos, eficiência, causa-raiz e ações (aditivo e idempotente) ---
  const departmentEngineering = await prisma.department.upsert({ where: { organizationId_code: { organizationId: organization.id, code: "ENG" } }, update: { companyId: company.id, name: "Engenharia e Operações", isActive: true, updatedById: user.id }, create: { organizationId: organization.id, companyId: company.id, code: "ENG", name: "Engenharia e Operações", description: "Planejamento, execução, qualidade e controle do empreendimento.", createdById: user.id, updatedById: user.id } });
  const departmentAdministration = await prisma.department.upsert({ where: { organizationId_code: { organizationId: organization.id, code: "ADM" } }, update: { companyId: holdingCompany.id, name: "Administração e Controladoria", isActive: true, updatedById: user.id }, create: { organizationId: organization.id, companyId: holdingCompany.id, code: "ADM", name: "Administração e Controladoria", description: "Estrutura corporativa compartilhada e rateável.", createdById: user.id, updatedById: user.id } });
  const positionCoordinator = await prisma.position.upsert({ where: { organizationId_code: { organizationId: organization.id, code: "COORD-OBRA" } }, update: { departmentId: departmentEngineering.id, title: "Coordenação de Obra", isActive: true, updatedById: user.id }, create: { organizationId: organization.id, departmentId: departmentEngineering.id, code: "COORD-OBRA", title: "Coordenação de Obra", level: "Coordenação", createdById: user.id, updatedById: user.id } });
  const positionEngineer = await prisma.position.upsert({ where: { organizationId_code: { organizationId: organization.id, code: "ENG-PL" } }, update: { departmentId: departmentEngineering.id, title: "Engenharia de Planejamento", isActive: true, updatedById: user.id }, create: { organizationId: organization.id, departmentId: departmentEngineering.id, code: "ENG-PL", title: "Engenharia de Planejamento", level: "Especialista", createdById: user.id, updatedById: user.id } });
  const positionController = await prisma.position.upsert({ where: { organizationId_code: { organizationId: organization.id, code: "CTRL-SR" } }, update: { departmentId: departmentAdministration.id, title: "Controladoria de Projetos", isActive: true, updatedById: user.id }, create: { organizationId: organization.id, departmentId: departmentAdministration.id, code: "CTRL-SR", title: "Controladoria de Projetos", level: "Sênior", createdById: user.id, updatedById: user.id } });

  const peopleSeed = [
    { professionalId: "PROF-001", fullName: "Mariana Alves de Souza", preferredName: "Mariana Alves", email: "mariana.alves@rede.demo", positionId: positionCoordinator.id, departmentId: departmentEngineering.id, companyId: company.id, type: "EMPLOYEE" as const, weeklyHours: "44", baseCost: "14500", burdenCost: "10150", benefitsCost: "1800" },
    { professionalId: "PROF-002", fullName: "Eduardo Ribeiro Martins", preferredName: "Eduardo Ribeiro", email: "eduardo.ribeiro@rede.demo", positionId: positionEngineer.id, departmentId: departmentEngineering.id, companyId: company.id, type: "CONTRACTOR" as const, weeklyHours: "40", baseCost: "18000", burdenCost: "0", benefitsCost: "0" },
    { professionalId: "PROF-003", fullName: "Camila Ferreira Lopes", preferredName: "Camila Ferreira", email: "camila.ferreira@rede.demo", positionId: positionController.id, departmentId: departmentAdministration.id, companyId: holdingCompany.id, type: "EMPLOYEE" as const, weeklyHours: "40", baseCost: "12500", burdenCost: "8750", benefitsCost: "1600" },
  ];
  const relationships = [];
  for (const personSeed of peopleSeed) {
    const person = await prisma.personProfile.upsert({ where: { organizationId_professionalId: { organizationId: organization.id, professionalId: personSeed.professionalId } }, update: { fullName: personSeed.fullName, preferredName: personSeed.preferredName, email: personSeed.email, status: "ACTIVE", updatedById: user.id }, create: { organizationId: organization.id, professionalId: personSeed.professionalId, fullName: personSeed.fullName, preferredName: personSeed.preferredName, email: personSeed.email, createdById: user.id, updatedById: user.id } });
    let relationship = await prisma.employmentRelationship.findFirst({ where: { organizationId: organization.id, personId: person.id, startDate: new Date("2026-01-01") } });
    if (!relationship) relationship = await prisma.employmentRelationship.create({ data: { organizationId: organization.id, companyId: personSeed.companyId, personId: person.id, positionId: personSeed.positionId, departmentId: personSeed.departmentId, type: personSeed.type, status: "ACTIVE", startDate: new Date("2026-01-01"), weeklyHours: personSeed.weeklyHours, createdById: user.id, updatedById: user.id } });
    const totalCost = Number(personSeed.baseCost) + Number(personSeed.burdenCost) + Number(personSeed.benefitsCost);
    await prisma.relationshipCostSnapshot.upsert({ where: { relationshipId_referenceMonth: { relationshipId: relationship.id, referenceMonth: new Date("2026-08-01") } }, update: { baseCost: personSeed.baseCost, burdenCost: personSeed.burdenCost, benefitsCost: personSeed.benefitsCost, otherCost: "0", totalCost: String(totalCost), source: "SEED_DEMONSTRATIVO", createdById: user.id }, create: { relationshipId: relationship.id, referenceMonth: new Date("2026-08-01"), baseCost: personSeed.baseCost, burdenCost: personSeed.burdenCost, benefitsCost: personSeed.benefitsCost, otherCost: "0", totalCost: String(totalCost), source: "SEED_DEMONSTRATIVO", notes: "Dado gerencial demonstrativo com acesso restrito.", createdById: user.id } });
    relationships.push(relationship);
  }
  await prisma.employmentRelationship.update({ where: { id: relationships[1].id }, data: { managerId: relationships[0].id, updatedById: user.id } });

  const projectTeam = await prisma.team.upsert({ where: { organizationId_code: { organizationId: organization.id, code: "START-EXEC" } }, update: { projectId: butantaStudy.projectId, companyId: company.id, departmentId: departmentEngineering.id, name: "Equipe de Execução START BUTANTÃ", isActive: true, updatedById: user.id }, create: { organizationId: organization.id, projectId: butantaStudy.projectId, companyId: company.id, departmentId: departmentEngineering.id, code: "START-EXEC", name: "Equipe de Execução START BUTANTÃ", type: "PROJECT", startDate: new Date("2026-08-01"), createdById: user.id, updatedById: user.id } });
  for (const [index, relationship] of relationships.entries()) await prisma.teamMembership.upsert({ where: { teamId_relationshipId_startDate: { teamId: projectTeam.id, relationshipId: relationship.id, startDate: new Date("2026-08-01") } }, update: { role: index === 0 ? "Responsável" : "Integrante", allocationRate: index === 2 ? "0.25" : index === 1 ? "0.80" : "0.60", endDate: null }, create: { teamId: projectTeam.id, relationshipId: relationship.id, role: index === 0 ? "Responsável" : "Integrante", allocationRate: index === 2 ? "0.25" : index === 1 ? "0.80" : "0.60", startDate: new Date("2026-08-01"), createdById: user.id } });
  for (const [index, relationship] of relationships.entries()) {
    const existingAllocation = await prisma.workAllocation.findFirst({ where: { organizationId: organization.id, projectId: butantaStudy.projectId, relationshipId: relationship.id, startDate: new Date("2026-08-01") } });
    if (!existingAllocation) await prisma.workAllocation.create({ data: { organizationId: organization.id, projectId: butantaStudy.projectId, relationshipId: relationship.id, teamId: projectTeam.id, costCenterId: officialLine.costCenterId, economicItemId: officialLine.economicItemId, scheduleActivityId: firstScheduleActivity?.id ?? null, criterion: "PERCENTAGE", allocationRate: index === 2 ? "0.25" : index === 1 ? "0.80" : "0.60", startDate: new Date("2026-08-01"), createdById: user.id, updatedById: user.id } });
  }

  const adminPlan = await prisma.administrativeCostPlan.upsert({ where: { organizationId_name_version: { organizationId: organization.id, name: "Plano Administrativo Compartilhado 2026", version: 1 } }, update: { companyId: holdingCompany.id, status: "ACTIVE", updatedById: user.id }, create: { organizationId: organization.id, companyId: holdingCompany.id, name: "Plano Administrativo Compartilhado 2026", version: 1, status: "ACTIVE", referenceFrom: new Date("2026-01-01"), referenceTo: new Date("2026-12-31"), createdById: user.id, updatedById: user.id } });
  const adminLine = await prisma.administrativeCostPlanLine.upsert({ where: { planId_code: { planId: adminPlan.id, code: "ADM-PMO" } }, update: { plannedAmount: "90000", actualAmount: "30000", committedAmount: "45000" }, create: { planId: adminPlan.id, costCenterId: officialLine.costCenterId, economicItemId: officialLine.economicItemId, code: "ADM-PMO", description: "PMO, controladoria e apoio administrativo compartilhado", plannedAmount: "90000", actualAmount: "30000", committedAmount: "45000", createdById: user.id } });
  const adminRule = await prisma.administrativeCostAllocationRule.upsert({ where: { planId_name: { planId: adminPlan.id, name: "Rateio por custo direto" } }, update: { driver: "DIRECT_COST", driverSnapshot: { startButanta: 70, corporativo: 30 }, isActive: true }, create: { planId: adminPlan.id, name: "Rateio por custo direto", driver: "DIRECT_COST", driverSnapshot: { startButanta: 70, corporativo: 30 }, createdById: user.id } });
  const adminAllocation = allocateAdministrativeCost("30000", [{ targetId: butantaStudy.projectId, value: 1 }]);
  await prisma.administrativeCostAllocationSnapshot.upsert({ where: { planId_ruleId_referenceMonth: { planId: adminPlan.id, ruleId: adminRule.id, referenceMonth: new Date("2026-08-01") } }, update: { sourceAmount: adminAllocation.sourceAmount, allocatedAmount: adminAllocation.allocatedAmount, residualAmount: adminAllocation.residualAmount, proofZero: adminAllocation.proofZero, checksum: createHash("sha256").update("9F-admin-2026-08").digest("hex") }, create: { planId: adminPlan.id, ruleId: adminRule.id, referenceMonth: new Date("2026-08-01"), sourceAmount: adminAllocation.sourceAmount, allocatedAmount: adminAllocation.allocatedAmount, residualAmount: adminAllocation.residualAmount, proofZero: adminAllocation.proofZero, checksum: createHash("sha256").update("9F-admin-2026-08").digest("hex"), createdById: user.id, lines: { create: [{ planLineId: adminLine.id, targetProjectId: butantaStudy.projectId, driverValue: "1", allocationRate: "1", allocatedAmount: adminAllocation.allocatedAmount }] } } });

  const performanceInput = { plannedAmount: 350000, committedAmount: 0, measuredAmount: 200000, actualAmount: 200000, forecastAmount: 350000, plannedProgress: 1, actualProgress: 0.5 };
  const performance = calculateEfficiencyVariance(performanceInput);
  const performanceChecksum = createHash("sha256").update("9F-START-BUTANTA-2026-08").digest("hex");
  let analysisRun = await prisma.efficiencyAnalysisRun.findFirst({ where: { organizationId: organization.id, projectId: butantaStudy.projectId, checksum: performanceChecksum } });
  if (!analysisRun) analysisRun = await prisma.efficiencyAnalysisRun.create({ data: { organizationId: organization.id, projectId: butantaStudy.projectId, referenceFrom: new Date("2026-08-01"), referenceTo: new Date("2026-08-31"), status: "COMPLETED", methodologyVersion: "9F.1", inputSnapshot: performanceInput, checksum: performanceChecksum, createdById: user.id, completedAt: new Date("2026-08-22") } });
  const performanceMetric = await prisma.efficiencyMetricResult.upsert({ where: { runId_metricKey_subjectType_subjectId: { runId: analysisRun.id, metricKey: "COST_PROGRESS_VARIANCE", subjectType: "PROJECT", subjectId: butantaStudy.projectId } }, update: { plannedValue: performance.plannedAmount, committedValue: performance.committedAmount, measuredValue: performance.measuredAmount, actualValue: performance.actualAmount, forecastValue: performance.forecastAmount, resultValue: performance.productivityVariance, confidence: "HIGH", evidenceRefs: ["Orçamento Oficial v1", "Cronograma Oficial v1", "Medição BM-2026-001", "Financeiro 9B"] }, create: { runId: analysisRun.id, metricKey: "COST_PROGRESS_VARIANCE", subjectType: "PROJECT", subjectId: butantaStudy.projectId, plannedValue: performance.plannedAmount, committedValue: performance.committedAmount, measuredValue: performance.measuredAmount, actualValue: performance.actualAmount, forecastValue: performance.forecastAmount, resultValue: performance.productivityVariance, unit: "BRL", confidence: "HIGH", evidenceRefs: ["Orçamento Oficial v1", "Cronograma Oficial v1", "Medição BM-2026-001", "Financeiro 9B"] } });
  const varianceCase = await prisma.performanceVarianceCase.upsert({ where: { projectId_code: { projectId: butantaStudy.projectId, code: "DESV-9F-001" } }, update: { analysisRunId: analysisRun.id, metricResultId: performanceMetric.id, plannedAmount: performance.plannedAmount, committedAmount: performance.committedAmount, measuredAmount: performance.measuredAmount, actualAmount: performance.actualAmount, forecastAmount: performance.forecastAmount, plannedProgress: performance.plannedProgress, actualProgress: performance.actualProgress, cashVariance: performance.cashVariance, commitmentVariance: performance.commitmentVariance, physicalVariance: performance.physicalVariance, expectedCostAtProgress: performance.expectedCostAtProgress, savingEligible: false, status: "UNDER_ANALYSIS", updatedById: user.id }, create: { organizationId: organization.id, projectId: butantaStudy.projectId, analysisRunId: analysisRun.id, metricResultId: performanceMetric.id, costCenterId: officialLine.costCenterId, economicItemId: officialLine.economicItemId, scheduleActivityId: firstScheduleActivity?.id ?? null, code: "DESV-9F-001", title: "Desembolso abaixo do plano com avanço físico atrasado", type: "PRODUCTIVITY", status: "UNDER_ANALYSIS", plannedAmount: performance.plannedAmount, committedAmount: performance.committedAmount, measuredAmount: performance.measuredAmount, actualAmount: performance.actualAmount, forecastAmount: performance.forecastAmount, plannedProgress: performance.plannedProgress, actualProgress: performance.actualProgress, cashVariance: performance.cashVariance, commitmentVariance: performance.commitmentVariance, physicalVariance: performance.physicalVariance, expectedCostAtProgress: performance.expectedCostAtProgress, savingEligible: false, ownerId: user.id, dueDate: new Date("2026-09-15"), createdById: user.id, updatedById: user.id } });
  const investigation = await prisma.rootCauseInvestigation.upsert({ where: { varianceCaseId: varianceCase.id }, update: { problemStatement: "O realizado de R$ 200 mil está abaixo dos R$ 350 mil planejados, porém o avanço físico alcançou apenas 50%; a diferença de caixa não constitui economia.", responsibleId: user.id, updatedById: user.id }, create: { varianceCaseId: varianceCase.id, problemStatement: "O realizado de R$ 200 mil está abaixo dos R$ 350 mil planejados, porém o avanço físico alcançou apenas 50%; a diferença de caixa não constitui economia.", scope: "Mobilização, fundações, suprimentos críticos e liberações técnicas.", responsibleId: user.id, createdById: user.id, updatedById: user.id } });
  const hypothesisSeeds = [
    { category: "PLANNING" as const, description: "Mobilização iniciou depois da data prevista.", contribution: "0.45", evidenceTitle: "Cronograma oficial versus medição", sourceRef: firstScheduleActivity?.id ?? operationalSchedule.id },
    { category: "SUPPLIER" as const, description: "Entrega do lote inicial de aço sofreu reprogramação.", contribution: "0.35", evidenceTitle: "Pedido de compra e prazo de entrega", sourceRef: purchaseOrder.id },
    { category: "EXTERNAL" as const, description: "Liberação documental condicionou parte da frente de serviço.", contribution: "0.20", evidenceTitle: "Marco jurídico ambiental", sourceRef: legalFinding.id },
  ];
  for (const item of hypothesisSeeds) {
    let hypothesis = await prisma.causalHypothesis.findFirst({ where: { investigationId: investigation.id, category: item.category, description: item.description } });
    if (!hypothesis) hypothesis = await prisma.causalHypothesis.create({ data: { investigationId: investigation.id, category: item.category, description: item.description, status: "ACCEPTED", confidence: "HIGH", createdById: user.id, updatedById: user.id } });
    if (!(await prisma.causalEvidence.findFirst({ where: { hypothesisId: hypothesis.id, sourceRef: item.sourceRef } }))) await prisma.causalEvidence.create({ data: { hypothesisId: hypothesis.id, evidenceType: "SYSTEM_RECORD", title: item.evidenceTitle, sourceRef: item.sourceRef, sourceVersion: "v1", observedAt: new Date("2026-08-21"), supports: true, createdById: user.id } });
    await prisma.rootCauseAllocation.upsert({ where: { investigationId_hypothesisId: { investigationId: investigation.id, hypothesisId: hypothesis.id } }, update: { contributionRate: item.contribution, rationale: "Contribuição parcial sustentada pelas evidências vinculadas.", validatedById: user.id, validatedAt: new Date("2026-08-22") }, create: { investigationId: investigation.id, hypothesisId: hypothesis.id, contributionRate: item.contribution, rationale: "Contribuição parcial sustentada pelas evidências vinculadas.", validatedById: user.id, validatedAt: new Date("2026-08-22"), createdById: user.id } });
  }
  if (!(await prisma.externalDependency.findFirst({ where: { investigationId: investigation.id, name: "Regularização da evidência ambiental" } }))) await prisma.externalDependency.create({ data: { investigationId: investigation.id, name: "Regularização da evidência ambiental", description: "Conclusão documental necessária para liberar integralmente a frente de serviço.", owner: "Jurídico", dueDate: new Date("2026-09-10"), status: "MONITORED", evidenceRef: legalFinding.id, createdById: user.id, updatedById: user.id } });
  let correctiveAction = await prisma.correctiveAction.findFirst({ where: { investigationId: investigation.id, title: "Replanejar mobilização e proteger o caminho crítico" } });
  if (!correctiveAction) correctiveAction = await prisma.correctiveAction.create({ data: { investigationId: investigation.id, title: "Replanejar mobilização e proteger o caminho crítico", description: "Atualizar a sequência executiva, confirmar aço e liberar documentação antes da nova data-base.", priority: "HIGH", status: "ACTIVE", responsibleId: user.id, dueDate: new Date("2026-09-05"), expectedImpact: "150000", implementationCost: "12000", approvedById: user.id, approvedAt: new Date("2026-08-22"), createdById: user.id, updatedById: user.id } });
  if (!(await prisma.correctiveActionEvidence.findFirst({ where: { actionId: correctiveAction.id, sourceRef: operationalSchedule.id } }))) await prisma.correctiveActionEvidence.create({ data: { actionId: correctiveAction.id, title: "Cronograma oficial a revisar", sourceRef: operationalSchedule.id, notes: "Evidência inicial; a ação ainda não está concluída.", createdById: user.id } });

  const incentivePolicy = await prisma.incentivePolicy.upsert({ where: { organizationId_name_version: { organizationId: organization.id, name: "Política demonstrativa de reconhecimento por resultado", version: 1 } }, update: { status: "ACTIVE", poolRate: "0.10", reserveRate: "0.20" }, create: { organizationId: organization.id, name: "Política demonstrativa de reconhecimento por resultado", version: 1, status: "ACTIVE", poolRate: "0.10", reserveRate: "0.20", minimumPool: "0", maximumPool: "50000", rules: { simulationOnly: true, requiresValidatedSaving: true, paymentCreated: false }, effectiveFrom: new Date("2026-01-01"), createdById: user.id, approvedById: user.id, approvedAt: new Date("2026-08-22") } });
  const validatedSaving = await prisma.validatedSaving.findFirst({ where: { decisionId: procurementDecision.id, validatedAt: { not: null }, scopeComparable: true } });
  const incentiveResult = simulateIncentivePool({ validatedSavingAmount: validatedSaving?.nominalAmount ?? 0, validatedSavingConfirmed: Boolean(validatedSaving), implementationCost: 12000, reversalAmount: 0, poolRate: incentivePolicy.poolRate, reserveRate: incentivePolicy.reserveRate, minimumPool: incentivePolicy.minimumPool, maximumPool: incentivePolicy.maximumPool });
  const existingSimulation = await prisma.incentiveSimulation.findFirst({ where: { organizationId: organization.id, projectId: butantaStudy.projectId, name: "Simulação 9F — economia validada de fundações" } });
  if (!existingSimulation) await prisma.incentiveSimulation.create({ data: { organizationId: organization.id, projectId: butantaStudy.projectId, policyId: incentivePolicy.id, validatedSavingId: validatedSaving?.id ?? null, name: "Simulação 9F — economia validada de fundações", status: "CALCULATED", validatedSavingAmount: incentiveResult.validatedSavingAmount, implementationCost: "12000", reversalAmount: "0", eligibleBase: incentiveResult.eligibleBase, simulatedPool: incentiveResult.simulatedPool, inputSnapshot: { policyVersion: incentivePolicy.version, validatedSavingId: validatedSaving?.id ?? null, paymentCreated: false }, checksum: createHash("sha256").update(`9F-incentive-${validatedSaving?.id ?? "none"}`).digest("hex"), createdById: user.id } });

  const salesContract = await prisma.salesContract.findUniqueOrThrow({ where: { saleId: sale.id } });
  const accountingDemo = await seedAccountingDemo(prisma, {
    organizationId: organization.id,
    userId: user.id,
    economicGroupId: economicGroup.id,
    holdingCompanyId: holdingCompany.id,
    companyId: company.id,
    projectId: butantaStudy.projectId,
    costCenterId: officialLine.costCenterId,
    economicItemId: officialLine.economicItemId,
    budgetTotal: officialBudget.totalBudget.toString(),
    contractId: operationalContract.id,
    contractAmount: operationalContract.originalAmount.toString(),
    measurementId: measurement.id,
    measurementAmount: measurement.grossAmount.toString(),
    payableId: payableAccount.id,
    intercompanyId: intercompanyTransaction.id,
    intercompanyAmount: intercompanyTransaction.amount.toString(),
    saleId: sale.id,
    salesContractId: salesContract.id,
    soldPrice: sale.soldPrice.toString(),
    salesUnits: [salesUnitSold, salesUnitBlocked, salesUnitAvailable].map((unit) => ({ id: unit.id, code: unit.code, privateAreaM2: unit.privateAreaM2.toString() })),
  });

  const integrationsDemo = await seedIntegrationsDemo(prisma, {
    organizationId: organization.id,
    userId: user.id,
    projectId: butantaStudy.projectId,
    companyId: company.id,
    supplierId: supplier.id,
    supplierTaxId: supplier.taxId!,
  });

  await prisma.viabilityStudy.update({ where: { id: study.studyId }, data: { updatedById: user.id } });
  const landStudy = legalLandWorkspace;
  const investmentCase = await ensureInvestmentCase({ userId: user.id, organizationId: organization.id });
  const designWorkspace = await ensureDesignWorkspace({ userId: user.id, organizationId: organization.id }, butantaStudy.projectId);
  const existingMasterReport = await prisma.studioArtifact.findFirst({ where: { investmentCaseId: investmentCase.id, type: "MASTER_REPORT" }, orderBy: { version: "desc" } });
  const demoMasterReport = existingMasterReport
    ? { pageCount: existingMasterReport.pageCount ?? 0, reportId: existingMasterReport.reportId ?? "n/a" }
    : await generateMasterReport({ userId: user.id, organizationId: organization.id }, investmentCase.id, createMasterReportConfig(investmentCase, "FULL_DOSSIER", "INTERNAL"), true);

  const isolatedOrganization = await prisma.organization.upsert({
    where: { slug: "grupo-atlas" },
    update: { name: "Grupo Atlas" },
    create: { name: "Grupo Atlas", slug: "grupo-atlas", legalName: "Grupo Atlas Desenvolvimento Imobiliário" },
  });
  const isolatedUser = await prisma.user.upsert({
    where: { email: "analista@atlas.local" },
    update: { name: "Ana Martins", passwordHash, isActive: true },
    create: { email: "analista@atlas.local", name: "Ana Martins", passwordHash },
  });
  await prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: isolatedOrganization.id, userId: isolatedUser.id } },
    update: { role: MembershipRole.ANALYST },
    create: { organizationId: isolatedOrganization.id, userId: isolatedUser.id, role: MembershipRole.ANALYST },
  });

  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  console.info(`Seed concluído: ${organization.name} · ${user.email} · viabilidade v${study.versionNumber} · START BUTANTÃ v${butantaStudy.versionNumber} · Orçamento ${butantaBudget.id} · Base Aprovada v${operationalBaseline.version} · Orçamento Oficial v${officialBudget.version} (${officialBudget.totalBudget}) · Cronograma v${operationalSchedule.version} · Financeiro: ${operationalBankAccount.id === fundingBankAccount.id ? 1 : 2} contas bancárias, Conta a Pagar ${payableAccount.id}, Conta a Receber ${receivableAccount.id}, Intercompany ${intercompanyTransaction.id} · Suprimentos: ${requisition.number}, ${quotation.number}, ${purchaseOrder.number}, ${operationalContract.number}, BM ${measurement.number} · Jurídico: ${diligence.code}, ${landContract.number}, ${legalObligation.code} · Vendas: ${salesUnitSold.code} (${deliveredUnit.status}), ${salesUnitBlocked.code} (bloqueada), ${salesUnitAvailable.code} (disponível), venda ${sale.id} (${sale.status}), comissão ${salesCommission.status}, pós-venda ${postSaleRequest.id} · Pessoas 9F: ${relationships.length} profissionais, ${projectTeam.name}, desvio ${varianceCase.code} (economia=${varianceCase.savingEligible}), ação ${correctiveAction.status}, incentivo somente simulado · Contabilidade 9G: plano ${accountingDemo.chartVersion.version}, período ${accountingDemo.october.status}, estoque ${accountingDemo.pool.totalAmount}, receita ${accountingDemo.revenueRun.recognizedRevenue}, tributo configurado ${accountingDemo.taxAssessment.assessedAmount}, consolidado ${accountingDemo.consolidation.consolidatedAmount} · Integrações 9H: ${integrationsDemo.driveInstallation.name} (sync ${integrationsDemo.driveSyncRun.status}, ${integrationsDemo.driveSyncRun.itemsApplied} aplicados), webhook deduplicado=${integrationsDemo.inboxDedupCount === 1}, fornecedor único por CNPJ=${integrationsDemo.supplierCountForTaxId === 1}, conflito ${integrationsDemo.conflict.status}, quarentena ${integrationsDemo.quarantineItem.status}, dead-letter ${integrationsDemo.deadLetter.errorClass}, preço observado R$${integrationsDemo.priceObservation.price} · Land v${landStudy.versionNumber} · Investment Case ${investmentCase.id} · Design ${designWorkspace.revision.label} (${designWorkspace.findings.length} findings derivados) · Dossiê ${demoMasterReport.reportId} (${demoMasterReport.pageCount} páginas) · REDE AI ${AI_PROMPT_VERSION} (${aiTasks.length} políticas)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
