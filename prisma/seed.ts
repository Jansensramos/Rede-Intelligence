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

  await prisma.approvalPolicy.upsert({ where: { organizationId_name_version: { organizationId: organization.id, name: "Alçada padrão de suprimentos", version: 1 } }, update: { isActive: true }, create: { organizationId: organization.id, name: "Alçada padrão de suprimentos", version: 1, actType: "CONTRACT", companyId: company.id, projectId: butantaStudy.projectId, minimumAmount: "0", requiredRole: "ADMIN", requiredApprovals: 1, segregationRequired: true, createdById: user.id } });

  await prisma.viabilityStudy.update({ where: { id: study.studyId }, data: { updatedById: user.id } });
  const landStudy = await ensureDemoLandStudy({ userId: user.id, organizationId: organization.id });
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
  console.info(`Seed concluído: ${organization.name} · ${user.email} · viabilidade v${study.versionNumber} · START BUTANTÃ v${butantaStudy.versionNumber} · Orçamento ${butantaBudget.id} · Base Aprovada v${operationalBaseline.version} · Orçamento Oficial v${officialBudget.version} (${officialBudget.totalBudget}) · Cronograma v${operationalSchedule.version} · Financeiro: ${operationalBankAccount.id === fundingBankAccount.id ? 1 : 2} contas bancárias, Conta a Pagar ${payableAccount.id}, Conta a Receber ${receivableAccount.id}, Intercompany ${intercompanyTransaction.id} · Suprimentos: ${requisition.number}, ${quotation.number}, ${purchaseOrder.number}, ${operationalContract.number}, BM ${measurement.number} · Land v${landStudy.versionNumber} · Investment Case ${investmentCase.id} · Design ${designWorkspace.revision.label} (${designWorkspace.findings.length} findings derivados) · Dossiê ${demoMasterReport.reportId} (${demoMasterReport.pageCount} páginas) · REDE AI ${AI_PROMPT_VERSION} (${aiTasks.length} políticas)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
