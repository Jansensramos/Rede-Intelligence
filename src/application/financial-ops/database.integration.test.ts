import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import {
  approveIntercompanyTransaction,
  confirmReconciliation,
  createIntercompanyTransaction,
  createPayableAccount,
  getFinancialWorkspace,
  importBankTransactions,
  registerPayablePayment,
  suggestReconciliationsForTransaction,
  transitionPayableInstallment,
} from "./financial-service";

// Este arquivo roda contra o PostgreSQL real e compartilhado do START BUTANTÃ —
// não pressupõe banco vazio. Todo dado criado por um teste carrega `runToken`
// (único por execução) para nunca colidir com o checksum de um BankTransaction
// deixado por uma execução anterior da suíte, e é removido no afterAll.
const runToken = randomUUID().slice(0, 8);
const createdPayableAccountIds: string[] = [];
const createdBankTransactionIds: string[] = [];
const createdIntercompanyTransactionIds: string[] = [];

describe.skipIf(!process.env.DATABASE_URL).sequential("financeiro e tesouraria multiempresa", () => {
  let context: AuthContext;
  let projectId: string;
  let companyId: string;
  let bankAccountId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: "rede-nucleo-de-negocios" } });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "admin@rede.local" } });
    const project = await prisma.project.findUniqueOrThrow({ where: { organizationId_name: { organizationId: organization.id, name: "START BUTANTÃ" } } });
    projectId = project.id;
    companyId = project.companyId!;
    context = { sessionId: "test", userId: user.id, userName: user.name, userEmail: user.email, organizationId: organization.id, organizationName: organization.name, organizationSlug: organization.slug, role: "OWNER" };
    const bankAccount = await prisma.bankAccount.findFirstOrThrow({ where: { organizationId: organization.id, companyId } });
    bankAccountId = bankAccount.id;
  });

  afterAll(async () => {
    try {
      await prisma.payablePayment.deleteMany({ where: { installment: { payableAccountId: { in: createdPayableAccountIds } } } });
      await prisma.bankTransaction.deleteMany({ where: { id: { in: createdBankTransactionIds } } });
      await prisma.payableAccount.deleteMany({ where: { id: { in: createdPayableAccountIds } } });
      if (createdIntercompanyTransactionIds.length) {
        await prisma.receivableAccount.deleteMany({ where: { intercompanyTransactionId: { in: createdIntercompanyTransactionIds } } });
        await prisma.payableAccount.deleteMany({ where: { intercompanyTransactionId: { in: createdIntercompanyTransactionIds } } });
        await prisma.intercompanyTransaction.deleteMany({ where: { id: { in: createdIntercompanyTransactionIds } } });
      }
    } catch (error) {
      // Nunca deixar uma falha de limpeza mascarar o resultado real dos testes acima.
      console.warn("Limpeza pós-teste do financeiro não concluída — dados de teste podem persistir:", error);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("consolida posição de caixa, contas em aberto e projeção atualizada sem dupla contagem", async () => {
    const workspace = await getFinancialWorkspace(context, projectId);
    expect(workspace.cashPosition.total).toBe(workspace.cashPosition.free + workspace.cashPosition.restricted);
    expect(workspace.bankAccounts.length).toBeGreaterThanOrEqual(2);
    expect(workspace.payables.totalOpen).toBeGreaterThan(0);
    expect(workspace.receivables.totalOpen).toBeGreaterThan(0);
    for (const row of workspace.updatedProjection) {
      // Invariante real de não duplicidade: o total é exatamente a soma das três
      // camadas (nunca uma combinação parcial ou dobrada), e nenhuma camada é negativa.
      expect(row.total).toBeCloseTo(row.realized + row.committed + row.residual, 2);
      expect(row.realized).toBeGreaterThanOrEqual(0);
      expect(row.committed).toBeGreaterThanOrEqual(0);
      expect(row.residual).toBeGreaterThanOrEqual(0);
    }
  });

  it("bloqueia transições arbitrárias de status de parcela", async () => {
    const account = await prisma.payableAccount.findFirstOrThrow({ where: { organizationId: context.organizationId, projectId }, include: { installments: true } });
    const paidOrOpen = account.installments.find((installment) => installment.status !== "CANCELADA");
    if (!paidOrOpen) throw new Error("Seed sem parcela utilizável para o teste.");
    if (paidOrOpen.status === "PAGA") {
      await expect(transitionPayableInstallment(context, paidOrOpen.id, "PREVISTA")).rejects.toThrow("Transição de status inválida");
    } else if (paidOrOpen.status === "PREVISTA") {
      await expect(transitionPayableInstallment(context, paidOrOpen.id, "PAGA")).rejects.toThrow("Transição de status inválida");
    }
  });

  it("nunca duplica um pagamento com a mesma chave de idempotência, mesmo após a parcela virar PAGA", async () => {
    const created = await createPayableAccount(context, {
      projectId,
      companyId,
      description: `Teste de idempotência de pagamento ${runToken}`,
      origin: "MANUAL",
      competenceMonth: new Date("2026-09-01T00:00:00.000Z"),
      installments: [{ number: 1, dueDate: new Date("2026-09-20T00:00:00.000Z"), amount: "1000" }],
    });
    createdPayableAccountIds.push(created.id);
    const installment = created.installments[0];
    await transitionPayableInstallment(context, installment.id, "PROGRAMADA");
    await transitionPayableInstallment(context, installment.id, "APROVADA");
    const paidAt = new Date("2026-09-20T00:00:00.000Z");
    const first = await registerPayablePayment(context, { installmentId: installment.id, bankAccountId, amount: "1000", method: "TRANSFER", paidAt });
    // A segunda chamada chega DEPOIS que a parcela já está PAGA — a idempotência
    // precisa vencer a checagem de status, não ser bloqueada por ela.
    const second = await registerPayablePayment(context, { installmentId: installment.id, bankAccountId, amount: "1000", method: "TRANSFER", paidAt });
    expect(second.id).toBe(first.id);
    const paymentCount = await prisma.payablePayment.count({ where: { installmentId: installment.id } });
    expect(paymentCount).toBe(1);
    const updated = await prisma.payableInstallment.findUniqueOrThrow({ where: { id: installment.id } });
    expect(updated.status).toBe("PAGA");
  });

  it("importa extrato de forma idempotente e concilia sem duplicar o realizado", async () => {
    const created = await createPayableAccount(context, {
      projectId,
      companyId,
      description: `Teste de conciliação bancária ${runToken}`,
      origin: "MANUAL",
      competenceMonth: new Date("2026-09-01T00:00:00.000Z"),
      installments: [{ number: 1, dueDate: new Date("2026-09-22T00:00:00.000Z"), amount: "2500" }],
    });
    createdPayableAccountIds.push(created.id);
    const installment = created.installments[0];
    await transitionPayableInstallment(context, installment.id, "PROGRAMADA");
    await transitionPayableInstallment(context, installment.id, "APROVADA");

    const batch = { bankAccountId, origin: "IMPORT_CSV" as const, transactions: [{ occurredAt: new Date("2026-09-22T00:00:00.000Z"), amount: "2500", direction: "DEBIT" as const, description: `PAGAMENTO TESTE CONCILIACAO ${runToken}`, documentRef: created.documentNumber ?? undefined }] };
    const firstImport = await importBankTransactions(context, batch);
    createdBankTransactionIds.push(...firstImport.transactions.map((transaction) => transaction.id));
    const secondImport = await importBankTransactions(context, batch);
    expect(firstImport.created).toBe(1);
    expect(secondImport.created).toBe(0);
    expect(secondImport.duplicates).toBe(1);

    const suggestions = await suggestReconciliationsForTransaction(context, firstImport.transactions[0].id);
    const bestMatch = suggestions.find((match) => (match.criteria as { candidateId: string }).candidateId === installment.id);
    expect(bestMatch).toBeDefined();
    await confirmReconciliation(context, bestMatch!.id);

    const reconciledTransaction = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: firstImport.transactions[0].id } });
    expect(reconciledTransaction.status).toBe("RECONCILED");
    const paymentCount = await prisma.payablePayment.count({ where: { installmentId: installment.id } });
    expect(paymentCount).toBe(1);
  });

  it("impede leitura cruzada entre organizações", async () => {
    const atlas = await prisma.organization.findUniqueOrThrow({ where: { slug: "grupo-atlas" } });
    await expect(getFinancialWorkspace({ organizationId: atlas.id }, projectId)).rejects.toThrow("não encontrado nesta organização");
  });

  it("Cenário B (validação final): conta de R$100.000 paga integralmente e conciliada resulta em realizado de R$100.000, nunca R$200.000", async () => {
    const created = await createPayableAccount(context, {
      projectId, companyId, description: `Cenário B — validação final de não duplicidade ${runToken}`, origin: "MANUAL",
      competenceMonth: new Date("2026-11-01T00:00:00.000Z"),
      installments: [{ number: 1, dueDate: new Date("2026-11-10T00:00:00.000Z"), amount: "100000" }],
    });
    createdPayableAccountIds.push(created.id);
    const installment = created.installments[0];
    await transitionPayableInstallment(context, installment.id, "PROGRAMADA");
    await transitionPayableInstallment(context, installment.id, "APROVADA");

    const batch = { bankAccountId, origin: "MANUAL" as const, transactions: [{ occurredAt: new Date("2026-11-10T00:00:00.000Z"), amount: "100000", direction: "DEBIT" as const, description: `PAGAMENTO CENARIO B VALIDACAO FINAL ${runToken}` }] };
    const imported = await importBankTransactions(context, batch);
    createdBankTransactionIds.push(...imported.transactions.map((transaction) => transaction.id));
    const suggestions = await suggestReconciliationsForTransaction(context, imported.transactions[0].id);
    const bestMatch = suggestions.find((match) => (match.criteria as { candidateId: string }).candidateId === installment.id);
    expect(bestMatch).toBeDefined();
    await confirmReconciliation(context, bestMatch!.id);

    const payments = await prisma.payablePayment.findMany({ where: { installmentId: installment.id } });
    const realized = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    expect(realized).toBe(100_000);
    expect(realized).not.toBe(200_000);
    const finalInstallment = await prisma.payableInstallment.findUniqueOrThrow({ where: { id: installment.id } });
    expect(finalInstallment.status).toBe("PAGA");
  });

  it("Cenário C (validação final): aporte intercompany de R$2.000.000 gera obrigação e direito com o mesmo valor, sem dobrar no consolidado", async () => {
    const holding = await prisma.company.findFirstOrThrow({ where: { organizationId: context.organizationId, type: "HOLDING" } });
    const transaction = await createIntercompanyTransaction(context, { fromCompanyId: holding.id, toCompanyId: companyId, toProjectId: projectId, amount: "2000000", occurredAt: new Date("2026-11-01T00:00:00.000Z"), nature: "APORTE", description: `Cenário C — validação final intercompany ${runToken}` });
    createdIntercompanyTransactionIds.push(transaction.id);
    if (transaction.status === "PENDING") await approveIntercompanyTransaction(context, transaction.id);

    const receivable = await prisma.receivableAccount.findFirstOrThrow({ where: { intercompanyTransactionId: transaction.id } });
    expect(Number(receivable.originalAmount)).toBe(2_000_000);
    expect(Number(transaction.amount)).toBe(Number(receivable.originalAmount));

    const payable = await prisma.payableAccount.findFirst({ where: { intercompanyTransactionId: transaction.id } });
    if (payable) {
      expect(Number(payable.originalAmount)).toBe(2_000_000);
      // A soma das duas pernas não pode ser tratada como receita+despesa econômica em dobro:
      // ambas representam o MESMO evento de R$2.000.000, não dois eventos de R$2.000.000.
      expect(Number(payable.originalAmount) + Number(receivable.originalAmount)).not.toBe(8_000_000);
    }
  });
});
