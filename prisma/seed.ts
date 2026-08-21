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
  console.info(`Seed concluído: ${organization.name} · ${user.email} · viabilidade v${study.versionNumber} · START BUTANTÃ v${butantaStudy.versionNumber} · Orçamento ${butantaBudget.id} · Base Aprovada v${operationalBaseline.version} · Orçamento Oficial v${officialBudget.version} (${officialBudget.totalBudget}) · Cronograma v${operationalSchedule.version} · Financeiro: ${operationalBankAccount.id === fundingBankAccount.id ? 1 : 2} contas bancárias, Conta a Pagar ${payableAccount.id}, Conta a Receber ${receivableAccount.id}, Intercompany ${intercompanyTransaction.id} · Suprimentos: ${requisition.number}, ${quotation.number}, ${purchaseOrder.number}, ${operationalContract.number}, BM ${measurement.number} · Jurídico: ${diligence.code}, ${landContract.number}, ${legalObligation.code} · Land v${landStudy.versionNumber} · Investment Case ${investmentCase.id} · Design ${designWorkspace.revision.label} (${designWorkspace.findings.length} findings derivados) · Dossiê ${demoMasterReport.reportId} (${demoMasterReport.pageCount} páginas) · REDE AI ${AI_PROMPT_VERSION} (${aiTasks.length} políticas)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
