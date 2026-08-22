-- CreateEnum
CREATE TYPE "SalesUnitStatus" AS ENUM ('DISPONIVEL', 'EM_RESERVA', 'RESERVADA', 'EM_PROPOSTA', 'VENDIDA', 'BLOQUEADA', 'PERMUTA', 'DISTRATADA', 'ENTREGUE');

-- CreateEnum
CREATE TYPE "SalesBlockOrigin" AS ENUM ('PERMUTA', 'JURIDICO', 'DIRETORIA', 'INCORPORACAO', 'COMERCIAL', 'TECNICA', 'OUTRO');

-- CreateEnum
CREATE TYPE "SalesPriceTableStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SalesLeadStage" AS ENUM ('NOVO', 'EM_ATENDIMENTO', 'PROPOSTA', 'PERDIDO', 'CONVERTIDO');

-- CreateEnum
CREATE TYPE "SalesProposalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "SalesReservationStatus" AS ENUM ('ACTIVE', 'CONFIRMED', 'EXPIRED', 'CANCELLED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('DRAFT', 'UNDER_APPROVAL', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalePartyRole" AS ENUM ('BUYER', 'CO_BUYER', 'REPRESENTATIVE', 'GUARANTOR');

-- CreateEnum
CREATE TYPE "SalesContractSignatureStatus" AS ENUM ('PENDING', 'PARTIALLY_SIGNED', 'SIGNED');

-- CreateEnum
CREATE TYPE "SalesContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'AMENDED', 'RESCINDED');

-- CreateEnum
CREATE TYPE "SalesPaymentPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalesInstallmentNature" AS ENUM ('DOWN_PAYMENT', 'MONTHLY', 'INTERMEDIATE', 'ANNUAL', 'KEYS', 'FINANCING', 'BALANCE', 'REINFORCEMENT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SalesCommissionBasis" AS ENUM ('SOLD_PRICE', 'RECEIVED_AMOUNT');

-- CreateEnum
CREATE TYPE "SalesCommissionTrigger" AS ENUM ('SIGNATURE', 'DOWN_PAYMENT_PAID', 'RECEIPT', 'MILESTONE', 'OTHER');

-- CreateEnum
CREATE TYPE "SalesCommissionStatus" AS ENUM ('PENDING', 'APPROVED', 'PAYABLE_GENERATED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalesInspectionOutcome" AS ENUM ('ACCEPTED', 'ACCEPTED_WITH_PENDING', 'REJECTED');

-- CreateEnum
CREATE TYPE "PostSaleCategory" AS ENUM ('GARANTIA', 'ASSISTENCIA', 'OCORRENCIA', 'OUTRO');

-- CreateEnum
CREATE TYPE "PostSaleStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ApprovalActType" ADD VALUE 'SALE';
ALTER TYPE "ApprovalActType" ADD VALUE 'SALE_DISCOUNT';
ALTER TYPE "ApprovalActType" ADD VALUE 'SALE_RESCISSION';
ALTER TYPE "ApprovalActType" ADD VALUE 'COMMISSION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FinancialIntegrationEventType" ADD VALUE 'SALE_CONTRACT_SIGNED';
ALTER TYPE "FinancialIntegrationEventType" ADD VALUE 'SALE_PLAN_REVISED';
ALTER TYPE "FinancialIntegrationEventType" ADD VALUE 'SALE_RESCINDED';
ALTER TYPE "FinancialIntegrationEventType" ADD VALUE 'COMMISSION_APPROVED';

-- AlterTable
ALTER TABLE "receivable_accounts" ADD COLUMN     "sale_id" TEXT;

-- AlterTable
ALTER TABLE "financial_integration_events" ADD COLUMN     "receivable_account_id" TEXT;

-- CreateTable
CREATE TABLE "sales_units" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "operating_unit_id" TEXT,
    "detected_unit_id" TEXT,
    "code" TEXT NOT NULL,
    "floor" TEXT,
    "typology" TEXT NOT NULL,
    "private_area_m2" DECIMAL(12,4) NOT NULL,
    "total_area_m2" DECIMAL(12,4),
    "parking_spaces" INTEGER NOT NULL DEFAULT 0,
    "storage_units" INTEGER NOT NULL DEFAULT 0,
    "position" TEXT,
    "characteristics" JSONB,
    "status" "SalesUnitStatus" NOT NULL DEFAULT 'DISPONIVEL',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_unit_blocks" (
    "id" TEXT NOT NULL,
    "sales_unit_id" TEXT NOT NULL,
    "origin" "SalesBlockOrigin" NOT NULL,
    "responsible_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_unit_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_price_tables" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "responsible_id" TEXT NOT NULL,
    "status" "SalesPriceTableStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_price_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_price_table_lines" (
    "id" TEXT NOT NULL,
    "price_table_id" TEXT NOT NULL,
    "sales_unit_id" TEXT NOT NULL,
    "list_price" DECIMAL(20,2) NOT NULL,
    "minimum_authorized_price" DECIMAL(20,2),

    CONSTRAINT "sales_price_table_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_leads" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "channel" TEXT,
    "broker_id" TEXT,
    "stage" "SalesLeadStage" NOT NULL DEFAULT 'NOVO',
    "lost_reason" TEXT,
    "customer_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broker_profiles" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "creci" TEXT,
    "parent_agency_id" TEXT,
    "default_commission_rate" DECIMAL(9,6),
    "channel" TEXT,
    "status" "PartyStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broker_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_proposals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "sales_unit_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "broker_id" TEXT,
    "price_table_id" TEXT NOT NULL,
    "proposed_price" DECIMAL(20,2) NOT NULL,
    "discount_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "payment_condition_summary" JSONB NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "status" "SalesProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "approval_request_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_reservations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "sales_unit_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "proposal_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "responsible_id" TEXT NOT NULL,
    "condition" JSONB,
    "status" "SalesReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelled_at" TIMESTAMP(3),
    "cancelled_reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "sales_unit_id" TEXT NOT NULL,
    "price_table_id" TEXT NOT NULL,
    "proposal_id" TEXT,
    "reservation_id" TEXT,
    "broker_id" TEXT,
    "sold_price" DECIMAL(20,2) NOT NULL,
    "discount_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "incentive_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "trade_in_value" DECIMAL(20,2),
    "commercial_condition_snapshot" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "SaleStatus" NOT NULL DEFAULT 'DRAFT',
    "approval_request_id" TEXT,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancelled_reason" TEXT,
    "external_id" TEXT,
    "external_source" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_parties" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "role" "SalePartyRole" NOT NULL,
    "ownership_percentage" DECIMAL(7,4),

    CONSTRAINT "sale_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_contracts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sold_price" DECIMAL(20,2) NOT NULL,
    "commercial_condition" JSONB NOT NULL,
    "signature_status" "SalesContractSignatureStatus" NOT NULL DEFAULT 'PENDING',
    "effective_from" TIMESTAMP(3),
    "status" "SalesContractStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_payment_plans" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "SalesPaymentPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "previous_plan_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMP(3),
    "superseded_at" TIMESTAMP(3),

    CONSTRAINT "sales_payment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_payment_plan_installments" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "nature" "SalesInstallmentNature" NOT NULL,
    "due_date" DATE NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "correction_rule_id" TEXT,
    "receivable_installment_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_payment_plan_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_commission_policies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "trigger_event" "SalesCommissionTrigger" NOT NULL DEFAULT 'SIGNATURE',
    "percentage" DECIMAL(9,6) NOT NULL,
    "basis" "SalesCommissionBasis" NOT NULL DEFAULT 'SOLD_PRICE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_commission_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_commissions" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "broker_id" TEXT NOT NULL,
    "policy_id" TEXT,
    "basis" "SalesCommissionBasis" NOT NULL,
    "percentage" DECIMAL(9,6) NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "trigger_event" "SalesCommissionTrigger" NOT NULL,
    "status" "SalesCommissionStatus" NOT NULL DEFAULT 'PENDING',
    "approval_request_id" TEXT,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_unit_inspections" (
    "id" TEXT NOT NULL,
    "sales_unit_id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "responsible_id" TEXT NOT NULL,
    "checklist" JSONB,
    "pending_issues" JSONB,
    "outcome" "SalesInspectionOutcome",
    "next_inspection_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_unit_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_sale_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sales_unit_id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "category" "PostSaleCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "responsible_id" TEXT,
    "sla_due_at" TIMESTAMP(3),
    "status" "PostSaleStatus" NOT NULL DEFAULT 'OPEN',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_sale_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_sale_updates" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_sale_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_units_organization_id_status_idx" ON "sales_units"("organization_id", "status");

-- CreateIndex
CREATE INDEX "sales_units_operating_unit_id_idx" ON "sales_units"("operating_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_units_project_id_code_key" ON "sales_units"("project_id", "code");

-- CreateIndex
CREATE INDEX "sales_unit_blocks_sales_unit_id_ended_at_idx" ON "sales_unit_blocks"("sales_unit_id", "ended_at");

-- CreateIndex
CREATE INDEX "sales_price_tables_project_id_status_idx" ON "sales_price_tables"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_price_tables_project_id_version_key" ON "sales_price_tables"("project_id", "version");

-- CreateIndex
CREATE INDEX "sales_price_table_lines_sales_unit_id_idx" ON "sales_price_table_lines"("sales_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_price_table_lines_price_table_id_sales_unit_id_key" ON "sales_price_table_lines"("price_table_id", "sales_unit_id");

-- CreateIndex
CREATE INDEX "sales_leads_organization_id_stage_idx" ON "sales_leads"("organization_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "broker_profiles_supplier_id_key" ON "broker_profiles"("supplier_id");

-- CreateIndex
CREATE INDEX "broker_profiles_organization_id_status_idx" ON "broker_profiles"("organization_id", "status");

-- CreateIndex
CREATE INDEX "sales_proposals_organization_id_status_idx" ON "sales_proposals"("organization_id", "status");

-- CreateIndex
CREATE INDEX "sales_proposals_sales_unit_id_idx" ON "sales_proposals"("sales_unit_id");

-- CreateIndex
CREATE INDEX "sales_reservations_organization_id_status_idx" ON "sales_reservations"("organization_id", "status");

-- CreateIndex
CREATE INDEX "sales_reservations_sales_unit_id_status_idx" ON "sales_reservations"("sales_unit_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_proposal_id_key" ON "sales"("proposal_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_reservation_id_key" ON "sales"("reservation_id");

-- CreateIndex
CREATE INDEX "sales_organization_id_status_idx" ON "sales"("organization_id", "status");

-- CreateIndex
CREATE INDEX "sales_sales_unit_id_status_idx" ON "sales"("sales_unit_id", "status");

-- CreateIndex
CREATE INDEX "sale_parties_customer_id_idx" ON "sale_parties"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_parties_sale_id_customer_id_role_key" ON "sale_parties"("sale_id", "customer_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "sales_contracts_sale_id_key" ON "sales_contracts"("sale_id");

-- CreateIndex
CREATE INDEX "sales_contracts_organization_id_status_idx" ON "sales_contracts"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_contracts_project_id_number_key" ON "sales_contracts"("project_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_payment_plans_previous_plan_id_key" ON "sales_payment_plans"("previous_plan_id");

-- CreateIndex
CREATE INDEX "sales_payment_plans_sale_id_status_idx" ON "sales_payment_plans"("sale_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_payment_plans_sale_id_version_key" ON "sales_payment_plans"("sale_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "sales_payment_plan_installments_receivable_installment_id_key" ON "sales_payment_plan_installments"("receivable_installment_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_payment_plan_installments_plan_id_number_key" ON "sales_payment_plan_installments"("plan_id", "number");

-- CreateIndex
CREATE INDEX "sales_commission_policies_organization_id_project_id_is_act_idx" ON "sales_commission_policies"("organization_id", "project_id", "is_active");

-- CreateIndex
CREATE INDEX "sales_commissions_sale_id_idx" ON "sales_commissions"("sale_id");

-- CreateIndex
CREATE INDEX "sales_commissions_broker_id_status_idx" ON "sales_commissions"("broker_id", "status");

-- CreateIndex
CREATE INDEX "sales_unit_inspections_sales_unit_id_scheduled_at_idx" ON "sales_unit_inspections"("sales_unit_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "post_sale_requests_organization_id_status_idx" ON "post_sale_requests"("organization_id", "status");

-- CreateIndex
CREATE INDEX "post_sale_updates_request_id_created_at_idx" ON "post_sale_updates"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "receivable_accounts_sale_id_idx" ON "receivable_accounts"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_integration_events_receivable_account_id_key" ON "financial_integration_events"("receivable_account_id");

-- AddForeignKey
ALTER TABLE "receivable_accounts" ADD CONSTRAINT "receivable_accounts_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_integration_events" ADD CONSTRAINT "financial_integration_events_receivable_account_id_fkey" FOREIGN KEY ("receivable_account_id") REFERENCES "receivable_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_units" ADD CONSTRAINT "sales_units_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_units" ADD CONSTRAINT "sales_units_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_units" ADD CONSTRAINT "sales_units_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_units" ADD CONSTRAINT "sales_units_operating_unit_id_fkey" FOREIGN KEY ("operating_unit_id") REFERENCES "project_operating_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_unit_blocks" ADD CONSTRAINT "sales_unit_blocks_sales_unit_id_fkey" FOREIGN KEY ("sales_unit_id") REFERENCES "sales_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_price_tables" ADD CONSTRAINT "sales_price_tables_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_price_tables" ADD CONSTRAINT "sales_price_tables_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_price_tables" ADD CONSTRAINT "sales_price_tables_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_price_table_lines" ADD CONSTRAINT "sales_price_table_lines_price_table_id_fkey" FOREIGN KEY ("price_table_id") REFERENCES "sales_price_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_price_table_lines" ADD CONSTRAINT "sales_price_table_lines_sales_unit_id_fkey" FOREIGN KEY ("sales_unit_id") REFERENCES "sales_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_broker_id_fkey" FOREIGN KEY ("broker_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_profiles" ADD CONSTRAINT "broker_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_profiles" ADD CONSTRAINT "broker_profiles_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_profiles" ADD CONSTRAINT "broker_profiles_parent_agency_id_fkey" FOREIGN KEY ("parent_agency_id") REFERENCES "broker_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_proposals" ADD CONSTRAINT "sales_proposals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_proposals" ADD CONSTRAINT "sales_proposals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_proposals" ADD CONSTRAINT "sales_proposals_sales_unit_id_fkey" FOREIGN KEY ("sales_unit_id") REFERENCES "sales_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_proposals" ADD CONSTRAINT "sales_proposals_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_proposals" ADD CONSTRAINT "sales_proposals_broker_id_fkey" FOREIGN KEY ("broker_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_proposals" ADD CONSTRAINT "sales_proposals_price_table_id_fkey" FOREIGN KEY ("price_table_id") REFERENCES "sales_price_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_reservations" ADD CONSTRAINT "sales_reservations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_reservations" ADD CONSTRAINT "sales_reservations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_reservations" ADD CONSTRAINT "sales_reservations_sales_unit_id_fkey" FOREIGN KEY ("sales_unit_id") REFERENCES "sales_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_reservations" ADD CONSTRAINT "sales_reservations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_reservations" ADD CONSTRAINT "sales_reservations_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "sales_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_sales_unit_id_fkey" FOREIGN KEY ("sales_unit_id") REFERENCES "sales_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_price_table_id_fkey" FOREIGN KEY ("price_table_id") REFERENCES "sales_price_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "sales_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "sales_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_broker_id_fkey" FOREIGN KEY ("broker_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_parties" ADD CONSTRAINT "sale_parties_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_parties" ADD CONSTRAINT "sale_parties_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_payment_plans" ADD CONSTRAINT "sales_payment_plans_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_payment_plans" ADD CONSTRAINT "sales_payment_plans_previous_plan_id_fkey" FOREIGN KEY ("previous_plan_id") REFERENCES "sales_payment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_payment_plan_installments" ADD CONSTRAINT "sales_payment_plan_installments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "sales_payment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_payment_plan_installments" ADD CONSTRAINT "sales_payment_plan_installments_correction_rule_id_fkey" FOREIGN KEY ("correction_rule_id") REFERENCES "correction_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_payment_plan_installments" ADD CONSTRAINT "sales_payment_plan_installments_receivable_installment_id_fkey" FOREIGN KEY ("receivable_installment_id") REFERENCES "receivable_installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_commission_policies" ADD CONSTRAINT "sales_commission_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_broker_id_fkey" FOREIGN KEY ("broker_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "sales_commission_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_unit_inspections" ADD CONSTRAINT "sales_unit_inspections_sales_unit_id_fkey" FOREIGN KEY ("sales_unit_id") REFERENCES "sales_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_unit_inspections" ADD CONSTRAINT "sales_unit_inspections_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_sale_requests" ADD CONSTRAINT "post_sale_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_sale_requests" ADD CONSTRAINT "post_sale_requests_sales_unit_id_fkey" FOREIGN KEY ("sales_unit_id") REFERENCES "sales_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_sale_requests" ADD CONSTRAINT "post_sale_requests_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_sale_requests" ADD CONSTRAINT "post_sale_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_sale_updates" ADD CONSTRAINT "post_sale_updates_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "post_sale_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

