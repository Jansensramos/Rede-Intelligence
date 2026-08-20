-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('HOLDING', 'INCORPORATOR', 'SPE', 'SERVICE_PROVIDER', 'ADMINISTRATOR', 'OTHER');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OperatingUnitType" AS ENUM ('PHASE', 'TOWER', 'BLOCK', 'STAGE', 'INFRASTRUCTURE', 'COMMON_AREA', 'COMMERCIAL', 'ADMINISTRATIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "OperationalBaselineStatus" AS ENUM ('PREPARING', 'UNDER_APPROVAL', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "BudgetKind" AS ENUM ('PRELIMINARY', 'OFFICIAL', 'REVISED');

-- CreateEnum
CREATE TYPE "CostOrigin" AS ENUM ('APPROVED_BASE', 'ESTIMATE', 'REDE_HISTORY', 'RECEIVED_QUOTE', 'CONTRACTED', 'MANUAL', 'INTEGRATION', 'OTHER');

-- CreateEnum
CREATE TYPE "BudgetLineStatus" AS ENUM ('PLANNED', 'UNDER_REVIEW', 'APPROVED', 'SUPERSEDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'SUPERSEDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ScheduleGranularity" AS ENUM ('MONTH', 'WEEK');

-- CreateEnum
CREATE TYPE "DistributionMethod" AS ENUM ('LINEAR', 'S_CURVE', 'MANUAL', 'MILESTONE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ScheduleDependencyType" AS ENUM ('FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH');

-- CreateEnum
CREATE TYPE "OperationalForecastStatus" AS ENUM ('STRUCTURED', 'ACTIVE', 'SUPERSEDED', 'CLOSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BudgetStatus" ADD VALUE 'OFFICIAL';
ALTER TYPE "BudgetStatus" ADD VALUE 'SUPERSEDED';
ALTER TYPE "BudgetStatus" ADD VALUE 'CLOSED';

-- AlterTable
ALTER TABLE "budget_line_items" ADD COLUMN     "cost_center_id" TEXT,
ADD COLUMN     "cost_origin" "CostOrigin" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "economic_item_id" TEXT,
ADD COLUMN     "end_date" DATE,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "operating_unit_id" TEXT,
ADD COLUMN     "responsible_id" TEXT,
ADD COLUMN     "start_date" DATE,
ADD COLUMN     "status" "BudgetLineStatus" NOT NULL DEFAULT 'PLANNED',
ADD COLUMN     "subcategory" TEXT;

-- AlterTable
ALTER TABLE "budgets" ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "company_id" TEXT,
ADD COLUMN     "kind" "BudgetKind" NOT NULL DEFAULT 'PRELIMINARY',
ADD COLUMN     "operational_baseline_id" TEXT,
ADD COLUMN     "previous_budget_id" TEXT,
ADD COLUMN     "revision_reason" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "company_id" TEXT;

-- CreateTable
CREATE TABLE "economic_groups" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "settings" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "economic_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "economic_group_id" TEXT,
    "legal_name" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "type" "CompanyType" NOT NULL,
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "settings" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_operating_units" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OperatingUnitType" NOT NULL,
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_operating_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "parent_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "responsible_id" TEXT,
    "managerial_account" TEXT,
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "economic_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "cost_center_id" TEXT,
    "operating_unit_id" TEXT,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "unit" TEXT NOT NULL,
    "responsible_id" TEXT,
    "metadata" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "economic_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_baselines" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT,
    "project_id" TEXT NOT NULL,
    "study_version_id" TEXT NOT NULL,
    "snapshot_bundle_id" TEXT,
    "previous_baseline_id" TEXT,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "OperationalBaselineStatus" NOT NULL DEFAULT 'PREPARING',
    "reason" TEXT,
    "content" JSONB NOT NULL,
    "totals" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "requested_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operational_baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_baseline_lines" (
    "id" TEXT NOT NULL,
    "baseline_id" TEXT NOT NULL,
    "economic_item_id" TEXT,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "value" DECIMAL(20,2) NOT NULL,
    "origin" "CostOrigin" NOT NULL,
    "evidence" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operational_baseline_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materiality_policies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "information_rate" DECIMAL(9,6) NOT NULL DEFAULT 0.02,
    "attention_rate" DECIMAL(9,6) NOT NULL DEFAULT 0.05,
    "relevant_rate" DECIMAL(9,6) NOT NULL DEFAULT 0.10,
    "absolute_threshold" DECIMAL(20,2),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materiality_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_variance_justifications" (
    "id" TEXT NOT NULL,
    "budget_id" TEXT NOT NULL,
    "baseline_line_id" TEXT,
    "economic_item_id" TEXT,
    "category" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "baseline_value" DECIMAL(20,2) NOT NULL,
    "budget_value" DECIMAL(20,2) NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_variance_justifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_labor_compositions" (
    "id" TEXT NOT NULL,
    "budget_line_item_id" TEXT NOT NULL,
    "role_name" TEXT NOT NULL,
    "headcount" DECIMAL(12,4) NOT NULL,
    "monthly_cost" DECIMAL(20,2) NOT NULL,
    "burden_rate" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "monthly_benefits" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "months" DECIMAL(12,4) NOT NULL,
    "total_cost" DECIMAL(20,2) NOT NULL,

    CONSTRAINT "budget_labor_compositions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_schedules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT,
    "project_id" TEXT NOT NULL,
    "budget_id" TEXT NOT NULL,
    "previous_schedule_id" TEXT,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "granularity" "ScheduleGranularity" NOT NULL DEFAULT 'MONTH',
    "base_date" DATE NOT NULL,
    "reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operational_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_activities" (
    "id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "economic_item_id" TEXT,
    "budget_line_item_id" TEXT,
    "operating_unit_id" TEXT,
    "parent_id" TEXT,
    "responsible_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "planned_physical" DECIMAL(9,6) NOT NULL DEFAULT 1,
    "planned_cost" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "distribution_method" "DistributionMethod" NOT NULL DEFAULT 'LINEAR',
    "is_milestone" BOOLEAN NOT NULL DEFAULT false,
    "milestone_type" TEXT,
    "is_critical" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_dependencies" (
    "id" TEXT NOT NULL,
    "predecessor_id" TEXT NOT NULL,
    "successor_id" TEXT NOT NULL,
    "type" "ScheduleDependencyType" NOT NULL DEFAULT 'FINISH_TO_START',
    "lag_days" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "schedule_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_allocations" (
    "id" TEXT NOT NULL,
    "activity_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "physical_percent" DECIMAL(9,6) NOT NULL,
    "financial_percent" DECIMAL(9,6) NOT NULL,
    "planned_disbursement" DECIMAL(20,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "schedule_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_forecasts" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "baseline_id" TEXT NOT NULL,
    "schedule_id" TEXT,
    "version" INTEGER NOT NULL,
    "status" "OperationalForecastStatus" NOT NULL DEFAULT 'STRUCTURED',
    "assumptions" JSONB NOT NULL,
    "projected_result" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operational_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "economic_groups_organization_id_status_idx" ON "economic_groups"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "economic_groups_organization_id_name_key" ON "economic_groups"("organization_id", "name");

-- CreateIndex
CREATE INDEX "companies_economic_group_id_status_idx" ON "companies"("economic_group_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "companies_organization_id_name_key" ON "companies"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "companies_organization_id_tax_id_key" ON "companies"("organization_id", "tax_id");

-- CreateIndex
CREATE INDEX "project_operating_units_parent_id_sort_order_idx" ON "project_operating_units"("parent_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "project_operating_units_project_id_code_key" ON "project_operating_units"("project_id", "code");

-- CreateIndex
CREATE INDEX "cost_centers_organization_id_status_idx" ON "cost_centers"("organization_id", "status");

-- CreateIndex
CREATE INDEX "cost_centers_parent_id_idx" ON "cost_centers"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_organization_id_project_id_code_key" ON "cost_centers"("organization_id", "project_id", "code");

-- CreateIndex
CREATE INDEX "economic_items_organization_id_category_idx" ON "economic_items"("organization_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "economic_items_project_id_code_key" ON "economic_items"("project_id", "code");

-- CreateIndex
CREATE INDEX "operational_baselines_organization_id_status_idx" ON "operational_baselines"("organization_id", "status");

-- CreateIndex
CREATE INDEX "operational_baselines_study_version_id_idx" ON "operational_baselines"("study_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "operational_baselines_project_id_version_key" ON "operational_baselines"("project_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "operational_baselines_project_id_checksum_key" ON "operational_baselines"("project_id", "checksum");

-- CreateIndex
CREATE INDEX "operational_baseline_lines_baseline_id_category_idx" ON "operational_baseline_lines"("baseline_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "operational_baseline_lines_baseline_id_code_key" ON "operational_baseline_lines"("baseline_id", "code");

-- CreateIndex
CREATE INDEX "materiality_policies_organization_id_is_active_idx" ON "materiality_policies"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "materiality_policies_organization_id_name_key" ON "materiality_policies"("organization_id", "name");

-- CreateIndex
CREATE INDEX "budget_variance_justifications_budget_id_category_idx" ON "budget_variance_justifications"("budget_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "budget_labor_compositions_budget_line_item_id_key" ON "budget_labor_compositions"("budget_line_item_id");

-- CreateIndex
CREATE INDEX "operational_schedules_organization_id_status_idx" ON "operational_schedules"("organization_id", "status");

-- CreateIndex
CREATE INDEX "operational_schedules_budget_id_idx" ON "operational_schedules"("budget_id");

-- CreateIndex
CREATE UNIQUE INDEX "operational_schedules_project_id_name_version_key" ON "operational_schedules"("project_id", "name", "version");

-- CreateIndex
CREATE INDEX "schedule_activities_schedule_id_start_date_end_date_idx" ON "schedule_activities"("schedule_id", "start_date", "end_date");

-- CreateIndex
CREATE INDEX "schedule_activities_economic_item_id_idx" ON "schedule_activities"("economic_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_activities_schedule_id_code_key" ON "schedule_activities"("schedule_id", "code");

-- CreateIndex
CREATE INDEX "schedule_dependencies_successor_id_idx" ON "schedule_dependencies"("successor_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_dependencies_predecessor_id_successor_id_key" ON "schedule_dependencies"("predecessor_id", "successor_id");

-- CreateIndex
CREATE INDEX "schedule_allocations_period_start_idx" ON "schedule_allocations"("period_start");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_allocations_activity_id_period_start_key" ON "schedule_allocations"("activity_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "operational_forecasts_project_id_version_key" ON "operational_forecasts"("project_id", "version");

-- CreateIndex
CREATE INDEX "budget_line_items_economic_item_id_idx" ON "budget_line_items"("economic_item_id");

-- CreateIndex
CREATE INDEX "budget_line_items_cost_center_id_idx" ON "budget_line_items"("cost_center_id");

-- CreateIndex
CREATE INDEX "budget_line_items_operating_unit_id_idx" ON "budget_line_items"("operating_unit_id");

-- CreateIndex
CREATE INDEX "budgets_operational_baseline_id_idx" ON "budgets"("operational_baseline_id");

-- CreateIndex
CREATE INDEX "budgets_company_id_idx" ON "budgets"("company_id");

-- CreateIndex
CREATE INDEX "budgets_previous_budget_id_idx" ON "budgets"("previous_budget_id");

-- CreateIndex
CREATE INDEX "projects_company_id_idx" ON "projects"("company_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_operational_baseline_id_fkey" FOREIGN KEY ("operational_baseline_id") REFERENCES "operational_baselines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_previous_budget_id_fkey" FOREIGN KEY ("previous_budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_line_items" ADD CONSTRAINT "budget_line_items_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_line_items" ADD CONSTRAINT "budget_line_items_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_line_items" ADD CONSTRAINT "budget_line_items_operating_unit_id_fkey" FOREIGN KEY ("operating_unit_id") REFERENCES "project_operating_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economic_groups" ADD CONSTRAINT "economic_groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_economic_group_id_fkey" FOREIGN KEY ("economic_group_id") REFERENCES "economic_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_operating_units" ADD CONSTRAINT "project_operating_units_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_operating_units" ADD CONSTRAINT "project_operating_units_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "project_operating_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economic_items" ADD CONSTRAINT "economic_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economic_items" ADD CONSTRAINT "economic_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economic_items" ADD CONSTRAINT "economic_items_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economic_items" ADD CONSTRAINT "economic_items_operating_unit_id_fkey" FOREIGN KEY ("operating_unit_id") REFERENCES "project_operating_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_baselines" ADD CONSTRAINT "operational_baselines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_baselines" ADD CONSTRAINT "operational_baselines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_baselines" ADD CONSTRAINT "operational_baselines_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_baselines" ADD CONSTRAINT "operational_baselines_study_version_id_fkey" FOREIGN KEY ("study_version_id") REFERENCES "study_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_baselines" ADD CONSTRAINT "operational_baselines_snapshot_bundle_id_fkey" FOREIGN KEY ("snapshot_bundle_id") REFERENCES "investment_snapshot_bundles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_baselines" ADD CONSTRAINT "operational_baselines_previous_baseline_id_fkey" FOREIGN KEY ("previous_baseline_id") REFERENCES "operational_baselines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_baseline_lines" ADD CONSTRAINT "operational_baseline_lines_baseline_id_fkey" FOREIGN KEY ("baseline_id") REFERENCES "operational_baselines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_baseline_lines" ADD CONSTRAINT "operational_baseline_lines_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materiality_policies" ADD CONSTRAINT "materiality_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_variance_justifications" ADD CONSTRAINT "budget_variance_justifications_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_labor_compositions" ADD CONSTRAINT "budget_labor_compositions_budget_line_item_id_fkey" FOREIGN KEY ("budget_line_item_id") REFERENCES "budget_line_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_schedules" ADD CONSTRAINT "operational_schedules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_schedules" ADD CONSTRAINT "operational_schedules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_schedules" ADD CONSTRAINT "operational_schedules_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_schedules" ADD CONSTRAINT "operational_schedules_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_schedules" ADD CONSTRAINT "operational_schedules_previous_schedule_id_fkey" FOREIGN KEY ("previous_schedule_id") REFERENCES "operational_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_activities" ADD CONSTRAINT "schedule_activities_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "operational_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_activities" ADD CONSTRAINT "schedule_activities_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_activities" ADD CONSTRAINT "schedule_activities_budget_line_item_id_fkey" FOREIGN KEY ("budget_line_item_id") REFERENCES "budget_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_activities" ADD CONSTRAINT "schedule_activities_operating_unit_id_fkey" FOREIGN KEY ("operating_unit_id") REFERENCES "project_operating_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_activities" ADD CONSTRAINT "schedule_activities_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "schedule_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_dependencies" ADD CONSTRAINT "schedule_dependencies_predecessor_id_fkey" FOREIGN KEY ("predecessor_id") REFERENCES "schedule_activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_dependencies" ADD CONSTRAINT "schedule_dependencies_successor_id_fkey" FOREIGN KEY ("successor_id") REFERENCES "schedule_activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_allocations" ADD CONSTRAINT "schedule_allocations_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "schedule_activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_forecasts" ADD CONSTRAINT "operational_forecasts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_forecasts" ADD CONSTRAINT "operational_forecasts_baseline_id_fkey" FOREIGN KEY ("baseline_id") REFERENCES "operational_baselines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_forecasts" ADD CONSTRAINT "operational_forecasts_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "operational_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
