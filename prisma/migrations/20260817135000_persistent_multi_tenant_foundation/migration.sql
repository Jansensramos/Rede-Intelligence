-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'ANALYST', 'REVIEWER', 'VIEWER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StudyStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StudyVersionStatus" AS ENUM ('LOCKED');

-- CreateEnum
CREATE TYPE "ScenarioKind" AS ENUM ('CONSERVATIVE', 'BASE', 'AGGRESSIVE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('INFO', 'POSITIVE', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FindingCategory" AS ENUM ('PRODUCT', 'MARKET', 'ENGINEERING', 'FINANCIAL', 'FUNDING', 'LEGAL', 'EXECUTION', 'GOVERNANCE');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('DO_NOT_PROCEED', 'PROCEED_WITH_ADJUSTMENTS', 'PROCEED_TO_DILIGENCE');

-- CreateEnum
CREATE TYPE "AnalysisRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "legal_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "invited_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "address" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "viability_studies" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "StudyStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_version_number" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "viability_studies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_versions" (
    "id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "StudyVersionStatus" NOT NULL DEFAULT 'LOCKED',
    "label" TEXT,
    "input_hash" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assumption_snapshots" (
    "id" TEXT NOT NULL,
    "study_version_id" TEXT NOT NULL,
    "project_name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "land_area_m2" DECIMAL(18,4) NOT NULL,
    "units" INTEGER NOT NULL,
    "private_area_per_unit_m2" DECIMAL(18,4) NOT NULL,
    "gross_built_area_m2" DECIMAL(18,4),
    "efficiency_rate" DECIMAL(9,6) NOT NULL,
    "unit_price" DECIMAL(20,2) NOT NULL,
    "land_price" DECIMAL(20,2) NOT NULL,
    "construction_cost_per_m2" DECIMAL(20,2) NOT NULL,
    "indirect_costs_rate" DECIMAL(9,6) NOT NULL,
    "contingency_rate" DECIMAL(9,6) NOT NULL,
    "tax_rate" DECIMAL(9,6) NOT NULL,
    "commission_rate" DECIMAL(9,6) NOT NULL,
    "marketing_rate" DECIMAL(9,6) NOT NULL,
    "approval_months" INTEGER NOT NULL,
    "construction_months" INTEGER NOT NULL,
    "sales_velocity_units_month" DECIMAL(12,4) NOT NULL,
    "down_payment_rate" DECIMAL(9,6) NOT NULL,
    "during_construction_rate" DECIMAL(9,6) NOT NULL,
    "on_delivery_rate" DECIMAL(9,6) NOT NULL,
    "financing_limit" DECIMAL(20,2) NOT NULL,
    "annual_financing_rate" DECIMAL(9,6) NOT NULL,
    "annual_discount_rate" DECIMAL(9,6) NOT NULL,
    "minimum_margin_rate" DECIMAL(9,6) NOT NULL,
    "minimum_roi_rate" DECIMAL(9,6) NOT NULL,
    "minimum_irr_rate" DECIMAL(9,6) NOT NULL,
    "maximum_exposure" DECIMAL(20,2) NOT NULL,
    "minimum_contingency_rate" DECIMAL(9,6) NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assumption_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenarios" (
    "id" TEXT NOT NULL,
    "study_version_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ScenarioKind" NOT NULL,
    "description" TEXT NOT NULL,
    "adjustments" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calculation_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "study_version_id" TEXT NOT NULL,
    "scenario_id" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calculation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_flow_entries" (
    "id" TEXT NOT NULL,
    "calculation_run_id" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "units_sold" DECIMAL(12,4) NOT NULL,
    "sales_value" DECIMAL(20,8) NOT NULL,
    "receipts" DECIMAL(20,8) NOT NULL,
    "land_cost" DECIMAL(20,8) NOT NULL,
    "construction_cost" DECIMAL(20,8) NOT NULL,
    "indirect_costs" DECIMAL(20,8) NOT NULL,
    "contingency" DECIMAL(20,8) NOT NULL,
    "marketing" DECIMAL(20,8) NOT NULL,
    "commission" DECIMAL(20,8) NOT NULL,
    "taxes" DECIMAL(20,8) NOT NULL,
    "operating_net" DECIMAL(20,8) NOT NULL,
    "interest" DECIMAL(20,8) NOT NULL,
    "financing_draw" DECIMAL(20,8) NOT NULL,
    "financing_repayment" DECIMAL(20,8) NOT NULL,
    "equity_flow" DECIMAL(20,8) NOT NULL,
    "cumulative_project_cash" DECIMAL(20,8) NOT NULL,
    "cumulative_equity_cash" DECIMAL(20,8) NOT NULL,
    "outstanding_debt" DECIMAL(20,8) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_flow_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_results" (
    "id" TEXT NOT NULL,
    "calculation_run_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "vgv" DECIMAL(20,2) NOT NULL,
    "net_revenue" DECIMAL(20,2) NOT NULL,
    "total_cost" DECIMAL(20,2) NOT NULL,
    "profit" DECIMAL(20,2) NOT NULL,
    "margin_on_vgv" DECIMAL(12,8) NOT NULL,
    "margin_on_net_revenue" DECIMAL(12,8) NOT NULL,
    "roi" DECIMAL(12,8),
    "annual_irr" DECIMAL(12,8),
    "npv" DECIMAL(20,2) NOT NULL,
    "payback_month" INTEGER,
    "maximum_cash_exposure" DECIMAL(20,2) NOT NULL,
    "maximum_exposure_month" INTEGER NOT NULL,
    "equity_capital_required" DECIMAL(20,2) NOT NULL,
    "break_even_vgv" DECIMAL(20,2) NOT NULL,
    "break_even_units" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calculation_traces" (
    "id" TEXT NOT NULL,
    "calculation_run_id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "result" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calculation_traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_findings" (
    "id" TEXT NOT NULL,
    "calculation_run_id" TEXT NOT NULL,
    "severity" "FindingSeverity" NOT NULL,
    "category" "FindingCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendations" (
    "id" TEXT NOT NULL,
    "calculation_run_id" TEXT NOT NULL,
    "status" "RecommendationStatus" NOT NULL,
    "label" TEXT NOT NULL,
    "dominant_reason" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensitivity_analyses" (
    "id" TEXT NOT NULL,
    "study_version_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "status" "AnalysisRunStatus" NOT NULL DEFAULT 'PENDING',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sensitivity_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "red_team_runs" (
    "id" TEXT NOT NULL,
    "study_version_id" TEXT NOT NULL,
    "agent_type" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "prompt_version" TEXT,
    "status" "AnalysisRunStatus" NOT NULL DEFAULT 'PENDING',
    "output" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "red_team_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scores" (
    "id" TEXT NOT NULL,
    "study_version_id" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "global_score" DECIMAL(5,2) NOT NULL,
    "explanation" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_dimensions" (
    "id" TEXT NOT NULL,
    "score_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "weight" DECIMAL(9,6) NOT NULL,
    "explanation" JSONB NOT NULL,

    CONSTRAINT "score_dimensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actual_entries" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "period" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "source" TEXT,
    "evidence_key" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "actual_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_analysis_runs" (
    "id" TEXT NOT NULL,
    "study_version_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "status" "AnalysisRunStatus" NOT NULL DEFAULT 'PENDING',
    "structured_input" JSONB NOT NULL,
    "structured_output" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT,
    "study_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "organization_memberships_user_id_idx" ON "organization_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_organization_id_user_id_key" ON "organization_memberships"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "sessions_organization_id_expires_at_idx" ON "sessions"("organization_id", "expires_at");

-- CreateIndex
CREATE INDEX "projects_organization_id_status_idx" ON "projects"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "projects_organization_id_name_key" ON "projects"("organization_id", "name");

-- CreateIndex
CREATE INDEX "viability_studies_project_id_status_idx" ON "viability_studies"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "viability_studies_project_id_name_key" ON "viability_studies"("project_id", "name");

-- CreateIndex
CREATE INDEX "study_versions_study_id_created_at_idx" ON "study_versions"("study_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "study_versions_study_id_version_number_key" ON "study_versions"("study_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "assumption_snapshots_study_version_id_key" ON "assumption_snapshots"("study_version_id");

-- CreateIndex
CREATE INDEX "scenarios_study_version_id_kind_idx" ON "scenarios"("study_version_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "scenarios_study_version_id_name_key" ON "scenarios"("study_version_id", "name");

-- CreateIndex
CREATE INDEX "calculation_runs_organization_id_calculated_at_idx" ON "calculation_runs"("organization_id", "calculated_at");

-- CreateIndex
CREATE INDEX "calculation_runs_project_id_study_id_idx" ON "calculation_runs"("project_id", "study_id");

-- CreateIndex
CREATE UNIQUE INDEX "calculation_runs_study_version_id_scenario_id_engine_versio_key" ON "calculation_runs"("study_version_id", "scenario_id", "engine_version");

-- CreateIndex
CREATE UNIQUE INDEX "cash_flow_entries_calculation_run_id_month_key" ON "cash_flow_entries"("calculation_run_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "financial_results_calculation_run_id_key" ON "financial_results"("calculation_run_id");

-- CreateIndex
CREATE INDEX "calculation_traces_calculation_run_id_metric_idx" ON "calculation_traces"("calculation_run_id", "metric");

-- CreateIndex
CREATE INDEX "risk_findings_calculation_run_id_severity_idx" ON "risk_findings"("calculation_run_id", "severity");

-- CreateIndex
CREATE INDEX "recommendations_calculation_run_id_idx" ON "recommendations"("calculation_run_id");

-- CreateIndex
CREATE INDEX "sensitivity_analyses_study_version_id_created_at_idx" ON "sensitivity_analyses"("study_version_id", "created_at");

-- CreateIndex
CREATE INDEX "red_team_runs_study_version_id_created_at_idx" ON "red_team_runs"("study_version_id", "created_at");

-- CreateIndex
CREATE INDEX "scores_study_version_id_created_at_idx" ON "scores"("study_version_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "score_dimensions_score_id_name_key" ON "score_dimensions"("score_id", "name");

-- CreateIndex
CREATE INDEX "actual_entries_project_id_metric_period_idx" ON "actual_entries"("project_id", "metric", "period");

-- CreateIndex
CREATE INDEX "ai_analysis_runs_study_version_id_purpose_created_at_idx" ON "ai_analysis_runs"("study_version_id", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viability_studies" ADD CONSTRAINT "viability_studies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viability_studies" ADD CONSTRAINT "viability_studies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viability_studies" ADD CONSTRAINT "viability_studies_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_versions" ADD CONSTRAINT "study_versions_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "viability_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_versions" ADD CONSTRAINT "study_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_versions" ADD CONSTRAINT "study_versions_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assumption_snapshots" ADD CONSTRAINT "assumption_snapshots_study_version_id_fkey" FOREIGN KEY ("study_version_id") REFERENCES "study_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assumption_snapshots" ADD CONSTRAINT "assumption_snapshots_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assumption_snapshots" ADD CONSTRAINT "assumption_snapshots_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_study_version_id_fkey" FOREIGN KEY ("study_version_id") REFERENCES "study_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_runs" ADD CONSTRAINT "calculation_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_runs" ADD CONSTRAINT "calculation_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_runs" ADD CONSTRAINT "calculation_runs_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "viability_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_runs" ADD CONSTRAINT "calculation_runs_study_version_id_fkey" FOREIGN KEY ("study_version_id") REFERENCES "study_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_runs" ADD CONSTRAINT "calculation_runs_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "scenarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_runs" ADD CONSTRAINT "calculation_runs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_flow_entries" ADD CONSTRAINT "cash_flow_entries_calculation_run_id_fkey" FOREIGN KEY ("calculation_run_id") REFERENCES "calculation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_results" ADD CONSTRAINT "financial_results_calculation_run_id_fkey" FOREIGN KEY ("calculation_run_id") REFERENCES "calculation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_traces" ADD CONSTRAINT "calculation_traces_calculation_run_id_fkey" FOREIGN KEY ("calculation_run_id") REFERENCES "calculation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_findings" ADD CONSTRAINT "risk_findings_calculation_run_id_fkey" FOREIGN KEY ("calculation_run_id") REFERENCES "calculation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_findings" ADD CONSTRAINT "risk_findings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_calculation_run_id_fkey" FOREIGN KEY ("calculation_run_id") REFERENCES "calculation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensitivity_analyses" ADD CONSTRAINT "sensitivity_analyses_study_version_id_fkey" FOREIGN KEY ("study_version_id") REFERENCES "study_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensitivity_analyses" ADD CONSTRAINT "sensitivity_analyses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_team_runs" ADD CONSTRAINT "red_team_runs_study_version_id_fkey" FOREIGN KEY ("study_version_id") REFERENCES "study_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_team_runs" ADD CONSTRAINT "red_team_runs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_study_version_id_fkey" FOREIGN KEY ("study_version_id") REFERENCES "study_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_dimensions" ADD CONSTRAINT "score_dimensions_score_id_fkey" FOREIGN KEY ("score_id") REFERENCES "scores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actual_entries" ADD CONSTRAINT "actual_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actual_entries" ADD CONSTRAINT "actual_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analysis_runs" ADD CONSTRAINT "ai_analysis_runs_study_version_id_fkey" FOREIGN KEY ("study_version_id") REFERENCES "study_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analysis_runs" ADD CONSTRAINT "ai_analysis_runs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "viability_studies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Immutability guard: a published study version and all artifacts derived from it
-- are append-only. New analyses can be inserted, but existing snapshots cannot be
-- rewritten or removed.
CREATE OR REPLACE FUNCTION prevent_study_version_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'study versions are immutable; create a new version instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER study_versions_immutable
BEFORE UPDATE OR DELETE ON "study_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_study_version_mutation();

CREATE OR REPLACE FUNCTION prevent_locked_version_artifact_mutation()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "study_versions"
    WHERE "id" = OLD."study_version_id" AND "status" = 'LOCKED'
  ) THEN
    RAISE EXCEPTION 'locked study version artifacts are immutable';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assumption_snapshots_immutable BEFORE UPDATE OR DELETE ON "assumption_snapshots" FOR EACH ROW EXECUTE FUNCTION prevent_locked_version_artifact_mutation();
CREATE TRIGGER scenarios_immutable BEFORE UPDATE OR DELETE ON "scenarios" FOR EACH ROW EXECUTE FUNCTION prevent_locked_version_artifact_mutation();
CREATE TRIGGER calculation_runs_immutable BEFORE UPDATE OR DELETE ON "calculation_runs" FOR EACH ROW EXECUTE FUNCTION prevent_locked_version_artifact_mutation();
CREATE TRIGGER sensitivity_analyses_immutable BEFORE UPDATE OR DELETE ON "sensitivity_analyses" FOR EACH ROW EXECUTE FUNCTION prevent_locked_version_artifact_mutation();
CREATE TRIGGER red_team_runs_immutable BEFORE UPDATE OR DELETE ON "red_team_runs" FOR EACH ROW EXECUTE FUNCTION prevent_locked_version_artifact_mutation();
CREATE TRIGGER scores_immutable BEFORE UPDATE OR DELETE ON "scores" FOR EACH ROW EXECUTE FUNCTION prevent_locked_version_artifact_mutation();
CREATE TRIGGER ai_analysis_runs_immutable BEFORE UPDATE OR DELETE ON "ai_analysis_runs" FOR EACH ROW EXECUTE FUNCTION prevent_locked_version_artifact_mutation();

CREATE OR REPLACE FUNCTION prevent_locked_run_artifact_mutation()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "calculation_runs" cr
    JOIN "study_versions" sv ON sv."id" = cr."study_version_id"
    WHERE cr."id" = OLD."calculation_run_id" AND sv."status" = 'LOCKED'
  ) THEN
    RAISE EXCEPTION 'locked calculation artifacts are immutable';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cash_flow_entries_immutable BEFORE UPDATE OR DELETE ON "cash_flow_entries" FOR EACH ROW EXECUTE FUNCTION prevent_locked_run_artifact_mutation();
CREATE TRIGGER financial_results_immutable BEFORE UPDATE OR DELETE ON "financial_results" FOR EACH ROW EXECUTE FUNCTION prevent_locked_run_artifact_mutation();
CREATE TRIGGER calculation_traces_immutable BEFORE UPDATE OR DELETE ON "calculation_traces" FOR EACH ROW EXECUTE FUNCTION prevent_locked_run_artifact_mutation();
CREATE TRIGGER risk_findings_immutable BEFORE UPDATE OR DELETE ON "risk_findings" FOR EACH ROW EXECUTE FUNCTION prevent_locked_run_artifact_mutation();
CREATE TRIGGER recommendations_immutable BEFORE UPDATE OR DELETE ON "recommendations" FOR EACH ROW EXECUTE FUNCTION prevent_locked_run_artifact_mutation();
