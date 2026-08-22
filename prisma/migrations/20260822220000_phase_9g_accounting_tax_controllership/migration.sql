-- CreateEnum
CREATE TYPE "AccountingPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "LedgerAccountCategory" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COST', 'EXPENSE', 'FINANCIAL_RESULT', 'CONTROL');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "AccountingPolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AccountingMappingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AccountingEventStatus" AS ENUM ('RECEIVED', 'VALIDATED', 'CLASSIFIED', 'POSTED', 'PENDING_MAPPING', 'REJECTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "AccountingEntryStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "AccountingEntrySide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'CLOSED', 'REOPENED', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "AccountingProvisionStatus" AS ENUM ('ACTIVE', 'REVERSED', 'SETTLED');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('INPUT', 'TRANSFER', 'WRITE_OFF', 'REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "AccountingRunStatus" AS ENUM ('DRAFT', 'CALCULATED', 'REVIEWED', 'APPROVED', 'POSTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AccountingReconciliationStatus" AS ENUM ('OPEN', 'MATCHED', 'DIVERGENT', 'RESOLVED');

-- CreateEnum
CREATE TYPE "AccountingBookType" AS ENUM ('STATUTORY', 'MANAGERIAL');

-- CreateEnum
CREATE TYPE "TaxRegimeType" AS ENUM ('RET', 'PRESUMED_PROFIT', 'ACTUAL_PROFIT', 'OTHER');

-- CreateTable
CREATE TABLE "charts_of_accounts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "economic_group_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "functional_currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "charts_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_of_accounts_versions" (
    "id" TEXT NOT NULL,
    "chart_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AccountingPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "checksum" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chart_of_accounts_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "LedgerAccountCategory" NOT NULL,
    "normal_balance" "NormalBalance" NOT NULL,
    "is_posting" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "managerial_group" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_chart_assignments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "overrides" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_chart_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_policies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT,
    "project_id" TEXT,
    "policy_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AccountingPolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "parameters" JSONB NOT NULL,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_mapping_rules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT,
    "project_id" TEXT,
    "policy_id" TEXT NOT NULL,
    "source_module" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "AccountingMappingStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "criteria" JSONB NOT NULL,
    "debit_account_id" TEXT NOT NULL,
    "credit_account_id" TEXT NOT NULL,
    "history_template" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_mapping_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_periods" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "reference_month" DATE NOT NULL,
    "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "financial_closure_id" TEXT,
    "materiality_policy_id" TEXT,
    "reviewed_by_id" TEXT,
    "closed_by_id" TEXT,
    "closed_at" TIMESTAMP(3),
    "reopened_by_id" TEXT,
    "reopened_at" TIMESTAMP(3),
    "reopening_reason" TEXT,
    "checklist_snapshot" JSONB,
    "close_checksum" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT,
    "cost_center_id" TEXT,
    "economic_item_id" TEXT,
    "period_id" TEXT,
    "policy_id" TEXT,
    "mapping_rule_id" TEXT,
    "source_module" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_version" TEXT NOT NULL,
    "economic_identity_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_version" INTEGER NOT NULL DEFAULT 1,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "idempotency_key" TEXT NOT NULL,
    "payload_checksum" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "competence_date" DATE NOT NULL,
    "document_issued_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "proposed_accounting_date" DATE,
    "settled_at" TIMESTAMP(3),
    "reconciled_at" TIMESTAMP(3),
    "gross_amount" DECIMAL(20,2) NOT NULL,
    "withholding_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(20,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "status" "AccountingEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "provenance" JSONB NOT NULL,
    "normalized_payload" JSONB NOT NULL,
    "classification_error" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_entries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT,
    "period_id" TEXT NOT NULL,
    "event_id" TEXT,
    "policy_id" TEXT,
    "book_type" "AccountingBookType" NOT NULL DEFAULT 'STATUTORY',
    "entry_number" TEXT NOT NULL,
    "accounting_date" DATE NOT NULL,
    "competence_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "status" "AccountingEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "total_debit" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "total_credit" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "checksum" TEXT NOT NULL,
    "posted_by_id" TEXT,
    "posted_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_entry_lines" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "side" "AccountingEntrySide" NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "history" TEXT NOT NULL,
    "project_id" TEXT,
    "cost_center_id" TEXT,
    "economic_item_id" TEXT,
    "contract_id" TEXT,
    "supplier_id" TEXT,
    "document_ref" TEXT,

    CONSTRAINT "accounting_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_reversals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "original_entry_id" TEXT NOT NULL,
    "reversal_entry_id" TEXT NOT NULL,
    "replacement_entry_id" TEXT,
    "reason" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_snapshots" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "snapshot_type" TEXT NOT NULL,
    "balances" JSONB NOT NULL,
    "total_debit" DECIMAL(20,2) NOT NULL,
    "total_credit" DECIMAL(20,2) NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_provisions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT,
    "event_id" TEXT,
    "economic_identity_key" TEXT NOT NULL,
    "provision_type" TEXT NOT NULL,
    "competence_date" DATE NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "method" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "policy_version" TEXT NOT NULL,
    "status" "AccountingProvisionStatus" NOT NULL DEFAULT 'ACTIVE',
    "reversal_date" DATE,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_provisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_cost_pools" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "accounting_period_id" TEXT,
    "total_amount" DECIMAL(20,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "policy_version" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_cost_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_cost_movements" (
    "id" TEXT NOT NULL,
    "pool_id" TEXT NOT NULL,
    "event_id" TEXT,
    "entry_id" TEXT,
    "movement_type" "InventoryMovementType" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "competence_date" DATE NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "memo" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_cost_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_cost_allocation_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "pool_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "criterion" TEXT NOT NULL,
    "driver_snapshot" JSONB NOT NULL,
    "source_amount" DECIMAL(20,2) NOT NULL,
    "allocated_amount" DECIMAL(20,2) NOT NULL,
    "residual_amount" DECIMAL(20,2) NOT NULL,
    "proof_zero" BOOLEAN NOT NULL,
    "status" "AccountingRunStatus" NOT NULL DEFAULT 'CALCULATED',
    "checksum" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_cost_allocation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_cost_allocation_lines" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "sales_unit_id" TEXT NOT NULL,
    "unit_code" TEXT NOT NULL,
    "driver_value" DECIMAL(20,6) NOT NULL,
    "allocation_rate" DECIMAL(12,9) NOT NULL,
    "allocated_amount" DECIMAL(20,2) NOT NULL,
    "memory" JSONB NOT NULL,

    CONSTRAINT "unit_cost_allocation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_recognition_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "cutoff_date" DATE NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AccountingRunStatus" NOT NULL DEFAULT 'CALCULATED',
    "total_vgv" DECIMAL(20,2) NOT NULL,
    "total_receivable" DECIMAL(20,2) NOT NULL,
    "total_cash" DECIMAL(20,2) NOT NULL,
    "recognized_revenue" DECIMAL(20,2) NOT NULL,
    "recognized_cost" DECIMAL(20,2) NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_recognition_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_recognition_lines" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "sales_contract_id" TEXT NOT NULL,
    "sales_unit_id" TEXT NOT NULL,
    "vgv" DECIMAL(20,2) NOT NULL,
    "receivable" DECIMAL(20,2) NOT NULL,
    "cash_received" DECIMAL(20,2) NOT NULL,
    "revenue_recognized" DECIMAL(20,2) NOT NULL,
    "cost_recognized" DECIMAL(20,2) NOT NULL,
    "margin" DECIMAL(20,2) NOT NULL,
    "recognition_basis" JSONB NOT NULL,

    CONSTRAINT "revenue_recognition_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_regime_assignments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT,
    "regime" "TaxRegimeType" NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "parameters" JSONB NOT NULL,
    "evidence" JSONB,
    "approved_by_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_regime_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_policies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "tax_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "parameters" JSONB NOT NULL,
    "normative_source" TEXT,
    "approved_by_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_document_references" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT,
    "document_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_key" TEXT,
    "issuer" TEXT,
    "recipient" TEXT,
    "issued_at" TIMESTAMP(3),
    "amount" DECIMAL(20,2),
    "checksum" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_document_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_assessments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT,
    "policy_id" TEXT NOT NULL,
    "reference_month" DATE NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AccountingRunStatus" NOT NULL DEFAULT 'DRAFT',
    "tax_code" TEXT NOT NULL,
    "taxable_base" DECIMAL(20,2) NOT NULL,
    "assessed_amount" DECIMAL(20,2) NOT NULL,
    "due_at" DATE,
    "checksum" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_assessment_lines" (
    "id" TEXT NOT NULL,
    "assessment_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "taxable_base" DECIMAL(20,2) NOT NULL,
    "rate" DECIMAL(12,9) NOT NULL,
    "adjustment" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "assessed_amount" DECIMAL(20,2) NOT NULL,
    "memory" JSONB NOT NULL,

    CONSTRAINT "tax_assessment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_obligation_links" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "assessment_id" TEXT NOT NULL,
    "financial_obligation_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "linked_by_id" TEXT NOT NULL,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_obligation_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_allocation_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "reference_month" DATE NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "driver" TEXT NOT NULL,
    "driver_snapshot" JSONB NOT NULL,
    "source_amount" DECIMAL(20,2) NOT NULL,
    "allocated_amount" DECIMAL(20,2) NOT NULL,
    "residual_amount" DECIMAL(20,2) NOT NULL,
    "proof_zero" BOOLEAN NOT NULL,
    "status" "AccountingRunStatus" NOT NULL DEFAULT 'CALCULATED',
    "checksum" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_allocation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_allocation_lines" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "target_company_id" TEXT NOT NULL,
    "target_project_id" TEXT,
    "driver_value" DECIMAL(20,6) NOT NULL,
    "allocation_rate" DECIMAL(12,9) NOT NULL,
    "allocated_amount" DECIMAL(20,2) NOT NULL,

    CONSTRAINT "accounting_allocation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_reconciliations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT,
    "period_id" TEXT NOT NULL,
    "reconciliation_type" TEXT NOT NULL,
    "status" "AccountingReconciliationStatus" NOT NULL DEFAULT 'OPEN',
    "source_amount" DECIMAL(20,2) NOT NULL,
    "ledger_amount" DECIMAL(20,2) NOT NULL,
    "difference_amount" DECIMAL(20,2) NOT NULL,
    "material" BOOLEAN NOT NULL,
    "evidence" JSONB NOT NULL,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_reconciliation_items" (
    "id" TEXT NOT NULL,
    "reconciliation_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "ledger_entry_id" TEXT,
    "source_amount" DECIMAL(20,2) NOT NULL,
    "ledger_amount" DECIMAL(20,2) NOT NULL,
    "difference_amount" DECIMAL(20,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "accounting_reconciliation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consolidation_scopes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "economic_group_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "companies" JSONB NOT NULL,
    "method" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consolidation_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consolidation_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "economic_group_id" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "reference_month" DATE NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AccountingRunStatus" NOT NULL DEFAULT 'DRAFT',
    "individual_amount" DECIMAL(20,2) NOT NULL,
    "adjustment_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "elimination_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "consolidated_amount" DECIMAL(20,2) NOT NULL,
    "proof_zero" BOOLEAN NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consolidation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consolidation_packages" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "closing_snapshot_id" TEXT,
    "debit_total" DECIMAL(20,2) NOT NULL,
    "credit_total" DECIMAL(20,2) NOT NULL,
    "net_amount" DECIMAL(20,2) NOT NULL,
    "balances" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,

    CONSTRAINT "consolidation_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consolidation_eliminations" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "from_company_id" TEXT NOT NULL,
    "to_company_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "debit_account_id" TEXT,
    "credit_account_id" TEXT,
    "amount" DECIMAL(20,2) NOT NULL,
    "justification" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "approved_by_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consolidation_eliminations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consolidated_balance_snapshots" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "balances" JSONB NOT NULL,
    "statements" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consolidated_balance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "charts_of_accounts_organization_id_economic_group_id_idx" ON "charts_of_accounts"("organization_id", "economic_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "charts_of_accounts_organization_id_code_key" ON "charts_of_accounts"("organization_id", "code");

-- CreateIndex
CREATE INDEX "chart_of_accounts_versions_chart_id_status_effective_from_idx" ON "chart_of_accounts_versions"("chart_id", "status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_versions_chart_id_version_key" ON "chart_of_accounts_versions"("chart_id", "version");

-- CreateIndex
CREATE INDEX "ledger_accounts_version_id_parent_id_is_active_idx" ON "ledger_accounts"("version_id", "parent_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_version_id_code_key" ON "ledger_accounts"("version_id", "code");

-- CreateIndex
CREATE INDEX "company_chart_assignments_organization_id_company_id_effect_idx" ON "company_chart_assignments"("organization_id", "company_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "company_chart_assignments_company_id_effective_from_key" ON "company_chart_assignments"("company_id", "effective_from");

-- CreateIndex
CREATE INDEX "accounting_policies_organization_id_company_id_project_id_s_idx" ON "accounting_policies"("organization_id", "company_id", "project_id", "status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_policies_organization_id_company_id_project_id_p_key" ON "accounting_policies"("organization_id", "company_id", "project_id", "policy_type", "name", "version");

-- CreateIndex
CREATE INDEX "accounting_mapping_rules_organization_id_company_id_project_idx" ON "accounting_mapping_rules"("organization_id", "company_id", "project_id", "status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_mapping_rules_organization_id_source_module_sour_key" ON "accounting_mapping_rules"("organization_id", "source_module", "source_type", "event_type", "version", "priority");

-- CreateIndex
CREATE INDEX "accounting_periods_organization_id_company_id_status_refere_idx" ON "accounting_periods"("organization_id", "company_id", "status", "reference_month");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_periods_organization_id_company_id_reference_mon_key" ON "accounting_periods"("organization_id", "company_id", "reference_month");

-- CreateIndex
CREATE INDEX "accounting_events_organization_id_company_id_project_id_com_idx" ON "accounting_events"("organization_id", "company_id", "project_id", "competence_date", "status");

-- CreateIndex
CREATE INDEX "accounting_events_organization_id_economic_identity_key_eve_idx" ON "accounting_events"("organization_id", "economic_identity_key", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_events_organization_id_idempotency_key_key" ON "accounting_events"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_events_organization_id_source_module_source_type_key" ON "accounting_events"("organization_id", "source_module", "source_type", "source_id", "source_version", "event_type");

-- CreateIndex
CREATE INDEX "accounting_entries_organization_id_company_id_accounting_da_idx" ON "accounting_entries"("organization_id", "company_id", "accounting_date", "status");

-- CreateIndex
CREATE INDEX "accounting_entries_organization_id_project_id_competence_da_idx" ON "accounting_entries"("organization_id", "project_id", "competence_date");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_entries_organization_id_company_id_entry_number_key" ON "accounting_entries"("organization_id", "company_id", "entry_number");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_entries_event_id_book_type_key" ON "accounting_entries"("event_id", "book_type");

-- CreateIndex
CREATE INDEX "accounting_entry_lines_account_id_entry_id_idx" ON "accounting_entry_lines"("account_id", "entry_id");

-- CreateIndex
CREATE INDEX "accounting_entry_lines_project_id_cost_center_id_economic_i_idx" ON "accounting_entry_lines"("project_id", "cost_center_id", "economic_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_entry_lines_entry_id_sequence_key" ON "accounting_entry_lines"("entry_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_reversals_reversal_entry_id_key" ON "accounting_reversals"("reversal_entry_id");

-- CreateIndex
CREATE INDEX "accounting_reversals_organization_id_original_entry_id_idx" ON "accounting_reversals"("organization_id", "original_entry_id");

-- CreateIndex
CREATE INDEX "ledger_snapshots_organization_id_company_id_created_at_idx" ON "ledger_snapshots"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_snapshots_period_id_snapshot_type_key" ON "ledger_snapshots"("period_id", "snapshot_type");

-- CreateIndex
CREATE INDEX "accounting_provisions_organization_id_company_id_project_id_idx" ON "accounting_provisions"("organization_id", "company_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_provisions_organization_id_economic_identity_key_key" ON "accounting_provisions"("organization_id", "economic_identity_key", "competence_date");

-- CreateIndex
CREATE INDEX "inventory_cost_pools_organization_id_company_id_project_id_idx" ON "inventory_cost_pools"("organization_id", "company_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_cost_pools_organization_id_project_id_code_key" ON "inventory_cost_pools"("organization_id", "project_id", "code");

-- CreateIndex
CREATE INDEX "inventory_cost_movements_pool_id_competence_date_idx" ON "inventory_cost_movements"("pool_id", "competence_date");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_cost_movements_pool_id_source_type_source_id_move_key" ON "inventory_cost_movements"("pool_id", "source_type", "source_id", "movement_type");

-- CreateIndex
CREATE INDEX "unit_cost_allocation_runs_organization_id_company_id_projec_idx" ON "unit_cost_allocation_runs"("organization_id", "company_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "unit_cost_allocation_runs_pool_id_version_key" ON "unit_cost_allocation_runs"("pool_id", "version");

-- CreateIndex
CREATE INDEX "unit_cost_allocation_lines_sales_unit_id_idx" ON "unit_cost_allocation_lines"("sales_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "unit_cost_allocation_lines_run_id_sales_unit_id_key" ON "unit_cost_allocation_lines"("run_id", "sales_unit_id");

-- CreateIndex
CREATE INDEX "revenue_recognition_runs_organization_id_company_id_project_idx" ON "revenue_recognition_runs"("organization_id", "company_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_recognition_runs_organization_id_project_id_cutoff__key" ON "revenue_recognition_runs"("organization_id", "project_id", "cutoff_date", "version");

-- CreateIndex
CREATE INDEX "revenue_recognition_lines_sales_unit_id_idx" ON "revenue_recognition_lines"("sales_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_recognition_lines_run_id_sales_contract_id_key" ON "revenue_recognition_lines"("run_id", "sales_contract_id");

-- CreateIndex
CREATE INDEX "tax_regime_assignments_organization_id_company_id_regime_ef_idx" ON "tax_regime_assignments"("organization_id", "company_id", "regime", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "tax_regime_assignments_company_id_project_id_effective_from_key" ON "tax_regime_assignments"("company_id", "project_id", "effective_from");

-- CreateIndex
CREATE INDEX "tax_policies_organization_id_tax_code_effective_from_idx" ON "tax_policies"("organization_id", "tax_code", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "tax_policies_assignment_id_tax_code_version_key" ON "tax_policies"("assignment_id", "tax_code", "version");

-- CreateIndex
CREATE INDEX "fiscal_document_references_organization_id_company_id_issue_idx" ON "fiscal_document_references"("organization_id", "company_id", "issued_at");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_document_references_organization_id_document_id_key" ON "fiscal_document_references"("organization_id", "document_id");

-- CreateIndex
CREATE INDEX "tax_assessments_organization_id_company_id_status_due_at_idx" ON "tax_assessments"("organization_id", "company_id", "status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "tax_assessments_organization_id_company_id_reference_month__key" ON "tax_assessments"("organization_id", "company_id", "reference_month", "tax_code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "tax_assessment_lines_assessment_id_source_type_source_id_key" ON "tax_assessment_lines"("assessment_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_obligation_links_assessment_id_key" ON "tax_obligation_links"("assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_obligation_links_financial_obligation_id_key" ON "tax_obligation_links"("financial_obligation_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_obligation_links_idempotency_key_key" ON "tax_obligation_links"("idempotency_key");

-- CreateIndex
CREATE INDEX "tax_obligation_links_organization_id_linked_at_idx" ON "tax_obligation_links"("organization_id", "linked_at");

-- CreateIndex
CREATE INDEX "accounting_allocation_runs_organization_id_company_id_refer_idx" ON "accounting_allocation_runs"("organization_id", "company_id", "reference_month", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_allocation_runs_organization_id_source_type_sour_key" ON "accounting_allocation_runs"("organization_id", "source_type", "source_id", "reference_month");

-- CreateIndex
CREATE INDEX "accounting_allocation_lines_target_company_id_target_projec_idx" ON "accounting_allocation_lines"("target_company_id", "target_project_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_allocation_lines_run_id_target_company_id_target_key" ON "accounting_allocation_lines"("run_id", "target_company_id", "target_project_id");

-- CreateIndex
CREATE INDEX "accounting_reconciliations_organization_id_company_id_statu_idx" ON "accounting_reconciliations"("organization_id", "company_id", "status", "material");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_reconciliations_period_id_reconciliation_type_pr_key" ON "accounting_reconciliations"("period_id", "reconciliation_type", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_reconciliation_items_reconciliation_id_source_ty_key" ON "accounting_reconciliation_items"("reconciliation_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "consolidation_scopes_organization_id_economic_group_id_effe_idx" ON "consolidation_scopes"("organization_id", "economic_group_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "consolidation_scopes_organization_id_economic_group_id_name_key" ON "consolidation_scopes"("organization_id", "economic_group_id", "name", "version");

-- CreateIndex
CREATE INDEX "consolidation_runs_organization_id_economic_group_id_refere_idx" ON "consolidation_runs"("organization_id", "economic_group_id", "reference_month", "status");

-- CreateIndex
CREATE UNIQUE INDEX "consolidation_runs_scope_id_reference_month_version_key" ON "consolidation_runs"("scope_id", "reference_month", "version");

-- CreateIndex
CREATE INDEX "consolidation_packages_company_id_period_id_idx" ON "consolidation_packages"("company_id", "period_id");

-- CreateIndex
CREATE UNIQUE INDEX "consolidation_packages_run_id_company_id_key" ON "consolidation_packages"("run_id", "company_id");

-- CreateIndex
CREATE INDEX "consolidation_eliminations_from_company_id_to_company_id_idx" ON "consolidation_eliminations"("from_company_id", "to_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "consolidation_eliminations_run_id_source_type_source_id_key" ON "consolidation_eliminations"("run_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "consolidated_balance_snapshots_run_id_key" ON "consolidated_balance_snapshots"("run_id");

-- AddForeignKey
ALTER TABLE "chart_of_accounts_versions" ADD CONSTRAINT "chart_of_accounts_versions_chart_id_fkey" FOREIGN KEY ("chart_id") REFERENCES "charts_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "chart_of_accounts_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_chart_assignments" ADD CONSTRAINT "company_chart_assignments_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "chart_of_accounts_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_mapping_rules" ADD CONSTRAINT "accounting_mapping_rules_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "accounting_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_mapping_rules" ADD CONSTRAINT "accounting_mapping_rules_debit_account_id_fkey" FOREIGN KEY ("debit_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_mapping_rules" ADD CONSTRAINT "accounting_mapping_rules_credit_account_id_fkey" FOREIGN KEY ("credit_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "accounting_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_mapping_rule_id_fkey" FOREIGN KEY ("mapping_rule_id") REFERENCES "accounting_mapping_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "accounting_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "accounting_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_entry_lines" ADD CONSTRAINT "accounting_entry_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "accounting_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_entry_lines" ADD CONSTRAINT "accounting_entry_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_reversals" ADD CONSTRAINT "accounting_reversals_original_entry_id_fkey" FOREIGN KEY ("original_entry_id") REFERENCES "accounting_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_reversals" ADD CONSTRAINT "accounting_reversals_reversal_entry_id_fkey" FOREIGN KEY ("reversal_entry_id") REFERENCES "accounting_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_snapshots" ADD CONSTRAINT "ledger_snapshots_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_provisions" ADD CONSTRAINT "accounting_provisions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "accounting_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_movements" ADD CONSTRAINT "inventory_cost_movements_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "inventory_cost_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_movements" ADD CONSTRAINT "inventory_cost_movements_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "accounting_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_cost_allocation_runs" ADD CONSTRAINT "unit_cost_allocation_runs_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "inventory_cost_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_cost_allocation_lines" ADD CONSTRAINT "unit_cost_allocation_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "unit_cost_allocation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_recognition_lines" ADD CONSTRAINT "revenue_recognition_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "revenue_recognition_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_policies" ADD CONSTRAINT "tax_policies_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "tax_regime_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_assessments" ADD CONSTRAINT "tax_assessments_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "tax_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_assessment_lines" ADD CONSTRAINT "tax_assessment_lines_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "tax_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_obligation_links" ADD CONSTRAINT "tax_obligation_links_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "tax_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_allocation_lines" ADD CONSTRAINT "accounting_allocation_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "accounting_allocation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_reconciliations" ADD CONSTRAINT "accounting_reconciliations_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_reconciliation_items" ADD CONSTRAINT "accounting_reconciliation_items_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "accounting_reconciliations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_runs" ADD CONSTRAINT "consolidation_runs_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "consolidation_scopes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_packages" ADD CONSTRAINT "consolidation_packages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "consolidation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_eliminations" ADD CONSTRAINT "consolidation_eliminations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "consolidation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidated_balance_snapshots" ADD CONSTRAINT "consolidated_balance_snapshots_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "consolidation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
