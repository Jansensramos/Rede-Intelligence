-- CreateEnum
CREATE TYPE "PartyStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('INDIVIDUAL', 'LEGAL_ENTITY');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('OPERATIONAL', 'COLLECTIONS', 'PAYMENTS', 'FUNDING', 'LINKED', 'ESCROW', 'RESERVE', 'INVESTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "BankAccountRestriction" AS ENUM ('FREE', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "BankAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "ObligationNature" AS ENUM ('PAYABLE', 'RECEIVABLE');

-- CreateEnum
CREATE TYPE "ObligationOrigin" AS ENUM ('MANUAL', 'BUDGET', 'CONTRACT', 'MEASUREMENT', 'PURCHASE', 'SALE', 'TAX', 'FUNDING', 'LEGAL', 'INTERCOMPANY', 'INTEGRATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ObligationStatus" AS ENUM ('PENDING', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayableInstallmentStatus" AS ENUM ('PREVISTA', 'PROGRAMADA', 'AGUARDANDO_APROVACAO', 'APROVADA', 'PARCIALMENTE_PAGA', 'PAGA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "ReceivableInstallmentStatus" AS ENUM ('PREVISTA', 'EMITIDA', 'PARCIALMENTE_RECEBIDA', 'RECEBIDA', 'RENEGOCIADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('TRANSFER', 'BOLETO', 'CHEQUE', 'CASH', 'CARD', 'PIX', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'CLEARED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "BankTransactionDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "BankTransactionOrigin" AS ENUM ('MANUAL', 'IMPORT_OFX', 'IMPORT_CSV', 'API');

-- CreateEnum
CREATE TYPE "BankTransactionStatus" AS ENUM ('RECEIVED', 'CANDIDATE', 'RECONCILED', 'MANUAL_REVIEW', 'UNRECONCILED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "ReconciliationMatchType" AS ENUM ('PAYABLE_PAYMENT', 'RECEIVABLE_PAYMENT', 'INTERCOMPANY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ReconciliationConfidence" AS ENUM ('ALTA', 'MEDIA', 'BAIXA');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IntercompanyNature" AS ENUM ('APORTE', 'MUTUO', 'ADIANTAMENTO', 'RATEIO', 'REEMBOLSO', 'TRANSFERENCIA', 'OUTRA');

-- CreateEnum
CREATE TYPE "IntercompanyStatus" AS ENUM ('PENDING', 'APPROVED', 'RECORDED', 'CONSOLIDATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FinancialIndexName" AS ENUM ('IPCA', 'INCC', 'IGP_M', 'CUSTOM');

-- CreateEnum
CREATE TYPE "FinancialIndexSource" AS ENUM ('IBGE', 'FIPE', 'MANUAL', 'EXTERNAL_API');

-- CreateEnum
CREATE TYPE "FinancialIndexReliability" AS ENUM ('CONFIRMED', 'PROJECTED', 'ESTIMATED');

-- CreateEnum
CREATE TYPE "ClosurePeriodStatus" AS ENUM ('OPEN', 'RECONCILING', 'CLOSED', 'REOPENED');

-- CreateTable
CREATE TABLE "financial_institutions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "tax_id" TEXT,
    "person_type" "PartyType" NOT NULL DEFAULT 'LEGAL_ENTITY',
    "email" TEXT,
    "phone" TEXT,
    "bank_data" JSONB,
    "status" "PartyStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "person_type" "PartyType" NOT NULL DEFAULT 'INDIVIDUAL',
    "tax_id" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "status" "PartyStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT,
    "institution_id" TEXT,
    "agency" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "holder_name" TEXT NOT NULL,
    "type" "BankAccountType" NOT NULL DEFAULT 'OPERATIONAL',
    "restriction" "BankAccountRestriction" NOT NULL DEFAULT 'FREE',
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "opening_balance" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "external_id" TEXT,
    "status" "BankAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_obligations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT,
    "project_id" TEXT NOT NULL,
    "cost_center_id" TEXT,
    "economic_item_id" TEXT,
    "budget_line_item_id" TEXT,
    "schedule_activity_id" TEXT,
    "nature" "ObligationNature" NOT NULL,
    "origin" "ObligationOrigin" NOT NULL DEFAULT 'MANUAL',
    "document_ref" TEXT,
    "description" TEXT NOT NULL,
    "competence_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "responsible_id" TEXT,
    "status" "ObligationStatus" NOT NULL DEFAULT 'PENDING',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_reason" TEXT,

    CONSTRAINT "financial_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payable_accounts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT,
    "project_id" TEXT NOT NULL,
    "cost_center_id" TEXT,
    "economic_item_id" TEXT,
    "budget_line_item_id" TEXT,
    "schedule_activity_id" TEXT,
    "obligation_id" TEXT,
    "supplier_id" TEXT,
    "correction_rule_id" TEXT,
    "intercompany_transaction_id" TEXT,
    "document_number" TEXT,
    "description" TEXT NOT NULL,
    "origin" "ObligationOrigin" NOT NULL DEFAULT 'MANUAL',
    "competence_month" DATE NOT NULL,
    "original_amount" DECIMAL(20,2) NOT NULL,
    "responsible_id" TEXT,
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_reason" TEXT,

    CONSTRAINT "payable_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payable_installments" (
    "id" TEXT NOT NULL,
    "payable_account_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "original_amount" DECIMAL(20,2) NOT NULL,
    "current_amount" DECIMAL(20,2) NOT NULL,
    "discount_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "interest_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "fine_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "withholding_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "status" "PayableInstallmentStatus" NOT NULL DEFAULT 'PREVISTA',
    "scheduled_date" DATE,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancelled_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payable_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payable_payments" (
    "id" TEXT NOT NULL,
    "installment_id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'TRANSFER',
    "reference_number" TEXT,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "status" "PaymentEventStatus" NOT NULL DEFAULT 'PENDING',
    "external_id" TEXT,
    "idempotency_key" TEXT,
    "approved_by_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "reversed_at" TIMESTAMP(3),
    "reversal_reason" TEXT,

    CONSTRAINT "payable_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivable_accounts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT,
    "project_id" TEXT NOT NULL,
    "cost_center_id" TEXT,
    "economic_item_id" TEXT,
    "obligation_id" TEXT,
    "customer_id" TEXT,
    "correction_rule_id" TEXT,
    "intercompany_transaction_id" TEXT,
    "unit_reference" TEXT,
    "contract_reference" TEXT,
    "document_number" TEXT,
    "description" TEXT NOT NULL,
    "origin" "ObligationOrigin" NOT NULL DEFAULT 'MANUAL',
    "competence_month" DATE NOT NULL,
    "original_amount" DECIMAL(20,2) NOT NULL,
    "responsible_id" TEXT,
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_reason" TEXT,

    CONSTRAINT "receivable_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivable_installments" (
    "id" TEXT NOT NULL,
    "receivable_account_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "original_amount" DECIMAL(20,2) NOT NULL,
    "current_amount" DECIMAL(20,2) NOT NULL,
    "discount_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "interest_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "fine_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "status" "ReceivableInstallmentStatus" NOT NULL DEFAULT 'PREVISTA',
    "issued_at" TIMESTAMP(3),
    "renegotiated_from_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receivable_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivable_payments" (
    "id" TEXT NOT NULL,
    "installment_id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'PIX',
    "reference_number" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "status" "PaymentEventStatus" NOT NULL DEFAULT 'PENDING',
    "external_id" TEXT,
    "idempotency_key" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "reversed_at" TIMESTAMP(3),
    "reversal_reason" TEXT,

    CONSTRAINT "receivable_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "occurred_at" DATE NOT NULL,
    "competence_date" DATE,
    "amount" DECIMAL(20,2) NOT NULL,
    "direction" "BankTransactionDirection" NOT NULL,
    "description" TEXT NOT NULL,
    "counterparty" TEXT,
    "document_ref" TEXT,
    "origin" "BankTransactionOrigin" NOT NULL DEFAULT 'MANUAL',
    "external_id" TEXT,
    "import_batch_id" TEXT,
    "checksum" TEXT NOT NULL,
    "status" "BankTransactionStatus" NOT NULL DEFAULT 'RECEIVED',
    "reconciled_at" TIMESTAMP(3),
    "reconciled_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_matches" (
    "id" TEXT NOT NULL,
    "bank_transaction_id" TEXT NOT NULL,
    "match_type" "ReconciliationMatchType" NOT NULL,
    "payable_payment_id" TEXT,
    "receivable_payment_id" TEXT,
    "intercompany_transaction_id" TEXT,
    "confidence" "ReconciliationConfidence" NOT NULL,
    "score" INTEGER NOT NULL,
    "criteria" JSONB NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'SUGGESTED',
    "matched_by_id" TEXT,
    "matched_at" TIMESTAMP(3),
    "rejected_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_transfers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "from_bank_account_id" TEXT NOT NULL,
    "to_bank_account_id" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "transferred_at" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "from_transaction_id" TEXT,
    "to_transaction_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intercompany_transactions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "economic_group_id" TEXT,
    "from_company_id" TEXT NOT NULL,
    "to_company_id" TEXT NOT NULL,
    "from_project_id" TEXT,
    "to_project_id" TEXT,
    "amount" DECIMAL(20,2) NOT NULL,
    "occurred_at" DATE NOT NULL,
    "nature" "IntercompanyNature" NOT NULL DEFAULT 'APORTE',
    "reference_number" TEXT,
    "description" TEXT,
    "status" "IntercompanyStatus" NOT NULL DEFAULT 'PENDING',
    "created_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intercompany_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_indexes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" "FinancialIndexName" NOT NULL,
    "reference_date" DATE NOT NULL,
    "value" DECIMAL(14,8) NOT NULL,
    "source" "FinancialIndexSource" NOT NULL DEFAULT 'MANUAL',
    "reliability" "FinancialIndexReliability" NOT NULL DEFAULT 'ESTIMATED',
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_indexes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correction_rules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "index_name" "FinancialIndexName" NOT NULL,
    "periodicity" TEXT NOT NULL DEFAULT 'MONTHLY',
    "lag_months" INTEGER NOT NULL DEFAULT 0,
    "interest_rate" DECIMAL(9,6),
    "fine_rate" DECIMAL(9,6),
    "discount_rule" JSONB,
    "formula" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "correction_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installment_adjustments" (
    "id" TEXT NOT NULL,
    "payable_installment_id" TEXT,
    "receivable_installment_id" TEXT,
    "previous_amount" DECIMAL(20,2) NOT NULL,
    "resulting_amount" DECIMAL(20,2) NOT NULL,
    "index_name" "FinancialIndexName",
    "index_percentage_applied" DECIMAL(9,6),
    "interest_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "fine_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "reference_period" TEXT NOT NULL,
    "applied_by_id" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installment_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_period_closures" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "reference_month" DATE NOT NULL,
    "status" "ClosurePeriodStatus" NOT NULL DEFAULT 'OPEN',
    "pending_issues" JSONB,
    "closed_by_id" TEXT,
    "closed_at" TIMESTAMP(3),
    "reopened_by_id" TEXT,
    "reopened_at" TIMESTAMP(3),
    "reopen_reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_period_closures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "financial_institutions_organization_id_name_key" ON "financial_institutions"("organization_id", "name");

-- CreateIndex
CREATE INDEX "suppliers_organization_id_status_idx" ON "suppliers"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_organization_id_tax_id_key" ON "suppliers"("organization_id", "tax_id");

-- CreateIndex
CREATE INDEX "customers_organization_id_status_idx" ON "customers"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_tax_id_key" ON "customers"("organization_id", "tax_id");

-- CreateIndex
CREATE INDEX "bank_accounts_organization_id_status_idx" ON "bank_accounts"("organization_id", "status");

-- CreateIndex
CREATE INDEX "bank_accounts_project_id_idx" ON "bank_accounts"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_company_id_agency_account_number_key" ON "bank_accounts"("company_id", "agency", "account_number");

-- CreateIndex
CREATE INDEX "financial_obligations_organization_id_status_idx" ON "financial_obligations"("organization_id", "status");

-- CreateIndex
CREATE INDEX "financial_obligations_project_id_nature_idx" ON "financial_obligations"("project_id", "nature");

-- CreateIndex
CREATE INDEX "financial_obligations_due_date_idx" ON "financial_obligations"("due_date");

-- CreateIndex
CREATE UNIQUE INDEX "payable_accounts_obligation_id_key" ON "payable_accounts"("obligation_id");

-- CreateIndex
CREATE UNIQUE INDEX "payable_accounts_intercompany_transaction_id_key" ON "payable_accounts"("intercompany_transaction_id");

-- CreateIndex
CREATE INDEX "payable_accounts_organization_id_project_id_idx" ON "payable_accounts"("organization_id", "project_id");

-- CreateIndex
CREATE INDEX "payable_accounts_supplier_id_idx" ON "payable_accounts"("supplier_id");

-- CreateIndex
CREATE INDEX "payable_accounts_cost_center_id_idx" ON "payable_accounts"("cost_center_id");

-- CreateIndex
CREATE INDEX "payable_installments_due_date_status_idx" ON "payable_installments"("due_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payable_installments_payable_account_id_number_key" ON "payable_installments"("payable_account_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "payable_payments_idempotency_key_key" ON "payable_payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payable_payments_installment_id_idx" ON "payable_payments"("installment_id");

-- CreateIndex
CREATE INDEX "payable_payments_bank_account_id_paid_at_idx" ON "payable_payments"("bank_account_id", "paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "receivable_accounts_obligation_id_key" ON "receivable_accounts"("obligation_id");

-- CreateIndex
CREATE UNIQUE INDEX "receivable_accounts_intercompany_transaction_id_key" ON "receivable_accounts"("intercompany_transaction_id");

-- CreateIndex
CREATE INDEX "receivable_accounts_organization_id_project_id_idx" ON "receivable_accounts"("organization_id", "project_id");

-- CreateIndex
CREATE INDEX "receivable_accounts_customer_id_idx" ON "receivable_accounts"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "receivable_installments_renegotiated_from_id_key" ON "receivable_installments"("renegotiated_from_id");

-- CreateIndex
CREATE INDEX "receivable_installments_due_date_status_idx" ON "receivable_installments"("due_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "receivable_installments_receivable_account_id_number_key" ON "receivable_installments"("receivable_account_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "receivable_payments_idempotency_key_key" ON "receivable_payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "receivable_payments_installment_id_idx" ON "receivable_payments"("installment_id");

-- CreateIndex
CREATE INDEX "receivable_payments_bank_account_id_received_at_idx" ON "receivable_payments"("bank_account_id", "received_at");

-- CreateIndex
CREATE INDEX "bank_transactions_organization_id_status_idx" ON "bank_transactions"("organization_id", "status");

-- CreateIndex
CREATE INDEX "bank_transactions_bank_account_id_occurred_at_idx" ON "bank_transactions"("bank_account_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_bank_account_id_checksum_key" ON "bank_transactions"("bank_account_id", "checksum");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_matches_payable_payment_id_key" ON "reconciliation_matches"("payable_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_matches_receivable_payment_id_key" ON "reconciliation_matches"("receivable_payment_id");

-- CreateIndex
CREATE INDEX "reconciliation_matches_bank_transaction_id_status_idx" ON "reconciliation_matches"("bank_transaction_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transfers_from_transaction_id_key" ON "financial_transfers"("from_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transfers_to_transaction_id_key" ON "financial_transfers"("to_transaction_id");

-- CreateIndex
CREATE INDEX "financial_transfers_organization_id_status_idx" ON "financial_transfers"("organization_id", "status");

-- CreateIndex
CREATE INDEX "intercompany_transactions_organization_id_status_idx" ON "intercompany_transactions"("organization_id", "status");

-- CreateIndex
CREATE INDEX "financial_indexes_organization_id_name_idx" ON "financial_indexes"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "financial_indexes_organization_id_name_reference_date_key" ON "financial_indexes"("organization_id", "name", "reference_date");

-- CreateIndex
CREATE INDEX "correction_rules_organization_id_is_active_idx" ON "correction_rules"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "correction_rules_organization_id_name_key" ON "correction_rules"("organization_id", "name");

-- CreateIndex
CREATE INDEX "installment_adjustments_payable_installment_id_idx" ON "installment_adjustments"("payable_installment_id");

-- CreateIndex
CREATE INDEX "installment_adjustments_receivable_installment_id_idx" ON "installment_adjustments"("receivable_installment_id");

-- CreateIndex
CREATE INDEX "financial_period_closures_organization_id_status_idx" ON "financial_period_closures"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "financial_period_closures_organization_id_company_id_refere_key" ON "financial_period_closures"("organization_id", "company_id", "reference_month");

-- AddForeignKey
ALTER TABLE "financial_institutions" ADD CONSTRAINT "financial_institutions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "financial_institutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_obligations" ADD CONSTRAINT "financial_obligations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_obligations" ADD CONSTRAINT "financial_obligations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_obligations" ADD CONSTRAINT "financial_obligations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_obligations" ADD CONSTRAINT "financial_obligations_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_obligations" ADD CONSTRAINT "financial_obligations_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_obligations" ADD CONSTRAINT "financial_obligations_budget_line_item_id_fkey" FOREIGN KEY ("budget_line_item_id") REFERENCES "budget_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_obligations" ADD CONSTRAINT "financial_obligations_schedule_activity_id_fkey" FOREIGN KEY ("schedule_activity_id") REFERENCES "schedule_activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_accounts" ADD CONSTRAINT "payable_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_accounts" ADD CONSTRAINT "payable_accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_accounts" ADD CONSTRAINT "payable_accounts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_accounts" ADD CONSTRAINT "payable_accounts_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_accounts" ADD CONSTRAINT "payable_accounts_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_accounts" ADD CONSTRAINT "payable_accounts_budget_line_item_id_fkey" FOREIGN KEY ("budget_line_item_id") REFERENCES "budget_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_accounts" ADD CONSTRAINT "payable_accounts_schedule_activity_id_fkey" FOREIGN KEY ("schedule_activity_id") REFERENCES "schedule_activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_accounts" ADD CONSTRAINT "payable_accounts_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "financial_obligations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_accounts" ADD CONSTRAINT "payable_accounts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_accounts" ADD CONSTRAINT "payable_accounts_correction_rule_id_fkey" FOREIGN KEY ("correction_rule_id") REFERENCES "correction_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_accounts" ADD CONSTRAINT "payable_accounts_intercompany_transaction_id_fkey" FOREIGN KEY ("intercompany_transaction_id") REFERENCES "intercompany_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_installments" ADD CONSTRAINT "payable_installments_payable_account_id_fkey" FOREIGN KEY ("payable_account_id") REFERENCES "payable_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_payments" ADD CONSTRAINT "payable_payments_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "payable_installments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_payments" ADD CONSTRAINT "payable_payments_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_accounts" ADD CONSTRAINT "receivable_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_accounts" ADD CONSTRAINT "receivable_accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_accounts" ADD CONSTRAINT "receivable_accounts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_accounts" ADD CONSTRAINT "receivable_accounts_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_accounts" ADD CONSTRAINT "receivable_accounts_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_accounts" ADD CONSTRAINT "receivable_accounts_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "financial_obligations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_accounts" ADD CONSTRAINT "receivable_accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_accounts" ADD CONSTRAINT "receivable_accounts_correction_rule_id_fkey" FOREIGN KEY ("correction_rule_id") REFERENCES "correction_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_accounts" ADD CONSTRAINT "receivable_accounts_intercompany_transaction_id_fkey" FOREIGN KEY ("intercompany_transaction_id") REFERENCES "intercompany_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_installments" ADD CONSTRAINT "receivable_installments_receivable_account_id_fkey" FOREIGN KEY ("receivable_account_id") REFERENCES "receivable_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_installments" ADD CONSTRAINT "receivable_installments_renegotiated_from_id_fkey" FOREIGN KEY ("renegotiated_from_id") REFERENCES "receivable_installments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "receivable_installments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_bank_transaction_id_fkey" FOREIGN KEY ("bank_transaction_id") REFERENCES "bank_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_payable_payment_id_fkey" FOREIGN KEY ("payable_payment_id") REFERENCES "payable_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_receivable_payment_id_fkey" FOREIGN KEY ("receivable_payment_id") REFERENCES "receivable_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_intercompany_transaction_id_fkey" FOREIGN KEY ("intercompany_transaction_id") REFERENCES "intercompany_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transfers" ADD CONSTRAINT "financial_transfers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transfers" ADD CONSTRAINT "financial_transfers_from_bank_account_id_fkey" FOREIGN KEY ("from_bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transfers" ADD CONSTRAINT "financial_transfers_to_bank_account_id_fkey" FOREIGN KEY ("to_bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transfers" ADD CONSTRAINT "financial_transfers_from_transaction_id_fkey" FOREIGN KEY ("from_transaction_id") REFERENCES "bank_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transfers" ADD CONSTRAINT "financial_transfers_to_transaction_id_fkey" FOREIGN KEY ("to_transaction_id") REFERENCES "bank_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_economic_group_id_fkey" FOREIGN KEY ("economic_group_id") REFERENCES "economic_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_from_company_id_fkey" FOREIGN KEY ("from_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_to_company_id_fkey" FOREIGN KEY ("to_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_from_project_id_fkey" FOREIGN KEY ("from_project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_to_project_id_fkey" FOREIGN KEY ("to_project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_indexes" ADD CONSTRAINT "financial_indexes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_rules" ADD CONSTRAINT "correction_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_adjustments" ADD CONSTRAINT "installment_adjustments_payable_installment_id_fkey" FOREIGN KEY ("payable_installment_id") REFERENCES "payable_installments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_adjustments" ADD CONSTRAINT "installment_adjustments_receivable_installment_id_fkey" FOREIGN KEY ("receivable_installment_id") REFERENCES "receivable_installments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_period_closures" ADD CONSTRAINT "financial_period_closures_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_period_closures" ADD CONSTRAINT "financial_period_closures_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

