-- CreateEnum
CREATE TYPE "MetricStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "MetricAggregation" AS ENUM ('SUM', 'AVERAGE', 'RATIO', 'MEDIAN', 'PERCENTILE', 'LAST');

-- CreateEnum
CREATE TYPE "AnalyticsFactType" AS ENUM ('COST', 'PROCUREMENT_PRICE', 'MEASUREMENT', 'FINANCIAL_SETTLEMENT', 'SALES', 'SCHEDULE_PROGRESS', 'PRICE_OBSERVATION', 'FORECAST', 'PRODUCTIVITY', 'LEGAL_CYCLE', 'ACCOUNTING');

-- CreateEnum
CREATE TYPE "EconomicStage" AS ENUM ('ESTIMATED', 'BUDGETED', 'QUOTED', 'CONTRACTED', 'MEASURED', 'ACCRUED', 'ACCOUNTED', 'PAID');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "OutlierDecision" AS ENUM ('PENDING', 'VALID', 'ERROR', 'EXTRAORDINARY', 'DIFFERENT_SCOPE', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "ForecastHorizonStage" AS ENUM ('LAND', 'APPROVAL', 'CONSTRUCTION_START', 'CONSTRUCTION_MID', 'CONSTRUCTION_LATE', 'DELIVERED');

-- CreateEnum
CREATE TYPE "ForecastBias" AS ENUM ('OPTIMISTIC', 'PESSIMISTIC', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "DataQualityDimension" AS ENUM ('COMPLETENESS', 'CONSISTENCY', 'VALIDITY', 'UNIQUENESS', 'FRESHNESS', 'PROVENANCE');

-- CreateEnum
CREATE TYPE "DataQualitySeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DataQualityIssueStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'WONT_FIX');

-- CreateEnum
CREATE TYPE "AutoBudgetProposalStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "PortfolioScopeType" AS ENUM ('GROUP', 'COMPANY', 'PROJECT');

-- CreateEnum
CREATE TYPE "BenchmarkSubjectType" AS ENUM ('ECONOMIC_ITEM', 'PROJECT', 'SUPPLIER', 'SCHEDULE_ACTIVITY');

-- CreateEnum
CREATE TYPE "AnalyticsRefreshStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "DatasetClassification" AS ENUM ('PUBLIC_INTERNAL', 'CONFIDENTIAL', 'RESTRICTED_PII');

-- CreateEnum
CREATE TYPE "NormalizationMethod" AS ENUM ('NOMINAL', 'CORRECTED');

-- CreateTable
CREATE TABLE "analytics_data_contracts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "source_module" TEXT NOT NULL,
    "source_entities" JSONB NOT NULL,
    "grain" TEXT NOT NULL,
    "dimensions" JSONB NOT NULL,
    "measure_definition" JSONB NOT NULL,
    "temporality" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "status" "MetricStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE NOT NULL,
    "deprecated_at" TIMESTAMP(3),
    "checksum" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_data_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_definitions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "definition" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "aggregation" "MetricAggregation" NOT NULL,
    "grain" TEXT NOT NULL,
    "dimensions" JSONB NOT NULL,
    "numerator" TEXT,
    "denominator" TEXT,
    "owner_id" TEXT NOT NULL,
    "status" "MetricStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE NOT NULL,
    "deprecated_at" TIMESTAMP(3),
    "supersedes_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metric_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "metric_definition_id" TEXT NOT NULL,
    "project_id" TEXT,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "period_start" DATE,
    "period_end" DATE,
    "value" DECIMAL(20,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "dimensions" JSONB NOT NULL,
    "input_refs" JSONB NOT NULL,
    "engine_version" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_unit_conversions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "dimension_type" TEXT NOT NULL,
    "from_unit" TEXT NOT NULL,
    "to_unit" TEXT NOT NULL,
    "factor" DECIMAL(24,12) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_unit_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_currency_normalizations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source_amount" DECIMAL(20,2) NOT NULL,
    "source_currency" CHAR(3) NOT NULL,
    "source_date" DATE NOT NULL,
    "target_currency" CHAR(3) NOT NULL,
    "target_date" DATE NOT NULL,
    "method" "NormalizationMethod" NOT NULL DEFAULT 'CORRECTED',
    "index_name" "FinancialIndexName",
    "index_source_ref" TEXT,
    "factor" DECIMAL(14,8) NOT NULL,
    "normalized_amount" DECIMAL(20,2) NOT NULL,
    "checksum" TEXT NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_currency_normalizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_facts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "fact_type" "AnalyticsFactType" NOT NULL,
    "economic_stage" "EconomicStage",
    "grain_key" TEXT NOT NULL,
    "source_module" TEXT NOT NULL,
    "source_entity_type" TEXT NOT NULL,
    "source_entity_id" TEXT NOT NULL,
    "source_version" TEXT,
    "economic_item_id" TEXT,
    "cost_center_id" TEXT,
    "operating_unit_id" TEXT,
    "event_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "amount" DECIMAL(20,2),
    "quantity" DECIMAL(18,4),
    "unit" TEXT,
    "measures" JSONB NOT NULL,
    "dimensions" JSONB NOT NULL,
    "provenance" JSONB NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checksum" TEXT NOT NULL,

    CONSTRAINT "analytics_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comparability_policies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "eligibility_rules" JSONB NOT NULL,
    "similarity_weights" JSONB NOT NULL,
    "confidence_weights" JSONB NOT NULL,
    "outlier_method" TEXT NOT NULL,
    "outlier_thresholds" JSONB NOT NULL,
    "minimum_sample_size" INTEGER NOT NULL,
    "status" "MetricStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comparability_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "metric_definition_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "subject_type" "BenchmarkSubjectType" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "filters" JSONB NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "eligible_count" INTEGER NOT NULL,
    "median" DECIMAL(20,6),
    "mean" DECIMAL(20,6),
    "p25" DECIMAL(20,6),
    "p75" DECIMAL(20,6),
    "std_dev" DECIMAL(20,6),
    "unit" TEXT NOT NULL,
    "confidence_level" "ConfidenceLevel" NOT NULL,
    "confidence_score" DOUBLE PRECISION NOT NULL,
    "confidence_factors" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "benchmark_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_members" (
    "id" TEXT NOT NULL,
    "benchmark_run_id" TEXT NOT NULL,
    "fact_id" TEXT,
    "source_entity_type" TEXT NOT NULL,
    "source_entity_id" TEXT NOT NULL,
    "project_id" TEXT,
    "raw_value" DECIMAL(20,6) NOT NULL,
    "normalized_value" DECIMAL(20,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "similarity_score" DOUBLE PRECISION NOT NULL,
    "similarity_factors" JSONB NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT true,
    "exclusion_reason" TEXT,
    "included_in_stats" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "benchmark_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_outliers" (
    "id" TEXT NOT NULL,
    "benchmark_run_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "score" DECIMAL(12,6) NOT NULL,
    "decision" "OutlierDecision" NOT NULL DEFAULT 'PENDING',
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "rationale" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "benchmark_outliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecast_evaluations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "metric_definition_id" TEXT NOT NULL,
    "forecast_source_type" TEXT NOT NULL,
    "forecast_source_id" TEXT NOT NULL,
    "forecast_version" INTEGER NOT NULL,
    "predicted_value" DECIMAL(20,6) NOT NULL,
    "predicted_as_of_date" DATE NOT NULL,
    "horizon_stage" "ForecastHorizonStage" NOT NULL,
    "horizon_days" INTEGER,
    "actual_value" DECIMAL(20,6),
    "actual_as_of_date" DATE,
    "actual_source_type" TEXT,
    "actual_source_id" TEXT,
    "unit" TEXT NOT NULL,
    "absolute_error" DECIMAL(20,6),
    "percent_error" DECIMAL(12,6),
    "bias" "ForecastBias",
    "evaluated" BOOLEAN NOT NULL DEFAULT false,
    "checksum" TEXT NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecast_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_quality_rules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dataset_key" TEXT NOT NULL,
    "dimension" "DataQualityDimension" NOT NULL,
    "severity" "DataQualitySeverity" NOT NULL DEFAULT 'WARNING',
    "config" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "MetricStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_quality_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_quality_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "dataset_key" TEXT NOT NULL,
    "executed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rows_evaluated" INTEGER NOT NULL,
    "rows_failed" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "summary" JSONB NOT NULL,

    CONSTRAINT "data_quality_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_quality_issues" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "severity" "DataQualitySeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "DataQualityIssueStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_quality_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_snapshots" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "scope_type" "PortfolioScopeType" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "metrics" JSONB NOT NULL,
    "scorecard" JSONB NOT NULL,
    "data_quality" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "portfolio_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_budget_proposals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AutoBudgetProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "policy_id" TEXT NOT NULL,
    "previous_proposal_id" TEXT,
    "rationale" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auto_budget_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_budget_proposal_lines" (
    "id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "economic_item_id" TEXT,
    "benchmark_run_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "suggested_unit_cost" DECIMAL(20,2) NOT NULL,
    "suggested_total_cost" DECIMAL(20,2) NOT NULL,
    "range_low" DECIMAL(20,2),
    "range_high" DECIMAL(20,2),
    "confidence_level" "ConfidenceLevel" NOT NULL,
    "rationale" TEXT NOT NULL,
    "exceptions" JSONB NOT NULL,
    "reviewed_unit_cost" DECIMAL(20,2),
    "review_note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "auto_budget_proposal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_refresh_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "status" "AnalyticsRefreshStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "rows_processed" INTEGER NOT NULL DEFAULT 0,
    "facts_created" INTEGER NOT NULL DEFAULT 0,
    "facts_updated" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "triggered_by_id" TEXT NOT NULL,

    CONSTRAINT "analytics_refresh_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytical_dataset_versions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "population_description" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "schema" JSONB NOT NULL,
    "row_count" INTEGER NOT NULL,
    "classification" "DatasetClassification" NOT NULL DEFAULT 'PUBLIC_INTERNAL',
    "pii_treatment" TEXT NOT NULL,
    "quality_score" DOUBLE PRECISION,
    "checksum" TEXT NOT NULL,
    "status" "MetricStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytical_dataset_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analytics_data_contracts_organization_id_status_idx" ON "analytics_data_contracts"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_data_contracts_organization_id_key_version_key" ON "analytics_data_contracts"("organization_id", "key", "version");

-- CreateIndex
CREATE INDEX "metric_definitions_organization_id_status_idx" ON "metric_definitions"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "metric_definitions_organization_id_key_version_key" ON "metric_definitions"("organization_id", "key", "version");

-- CreateIndex
CREATE INDEX "metric_runs_organization_id_scope_type_scope_id_idx" ON "metric_runs"("organization_id", "scope_type", "scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "metric_runs_organization_id_metric_definition_id_scope_type_key" ON "metric_runs"("organization_id", "metric_definition_id", "scope_type", "scope_id", "as_of_date");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_unit_conversions_organization_id_from_unit_to_uni_key" ON "analytics_unit_conversions"("organization_id", "from_unit", "to_unit", "version");

-- CreateIndex
CREATE INDEX "analytics_currency_normalizations_organization_id_source_cu_idx" ON "analytics_currency_normalizations"("organization_id", "source_currency", "target_currency");

-- CreateIndex
CREATE INDEX "analytics_facts_organization_id_project_id_fact_type_event__idx" ON "analytics_facts"("organization_id", "project_id", "fact_type", "event_date");

-- CreateIndex
CREATE INDEX "analytics_facts_economic_item_id_idx" ON "analytics_facts"("economic_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_facts_organization_id_fact_type_source_entity_typ_key" ON "analytics_facts"("organization_id", "fact_type", "source_entity_type", "source_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "comparability_policies_organization_id_key_version_key" ON "comparability_policies"("organization_id", "key", "version");

-- CreateIndex
CREATE INDEX "benchmark_runs_organization_id_subject_type_subject_id_as_o_idx" ON "benchmark_runs"("organization_id", "subject_type", "subject_id", "as_of_date");

-- CreateIndex
CREATE INDEX "benchmark_members_benchmark_run_id_idx" ON "benchmark_members"("benchmark_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "benchmark_outliers_benchmark_run_id_member_id_key" ON "benchmark_outliers"("benchmark_run_id", "member_id");

-- CreateIndex
CREATE INDEX "forecast_evaluations_organization_id_project_id_evaluated_idx" ON "forecast_evaluations"("organization_id", "project_id", "evaluated");

-- CreateIndex
CREATE UNIQUE INDEX "forecast_evaluations_organization_id_forecast_source_type_f_key" ON "forecast_evaluations"("organization_id", "forecast_source_type", "forecast_source_id", "forecast_version", "metric_definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "data_quality_rules_organization_id_key_version_key" ON "data_quality_rules"("organization_id", "key", "version");

-- CreateIndex
CREATE INDEX "data_quality_runs_organization_id_dataset_key_executed_at_idx" ON "data_quality_runs"("organization_id", "dataset_key", "executed_at");

-- CreateIndex
CREATE INDEX "data_quality_issues_run_id_status_idx" ON "data_quality_issues"("run_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_snapshots_organization_id_scope_type_scope_id_as__key" ON "portfolio_snapshots"("organization_id", "scope_type", "scope_id", "as_of_date");

-- CreateIndex
CREATE INDEX "auto_budget_proposals_organization_id_project_id_status_idx" ON "auto_budget_proposals"("organization_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "auto_budget_proposal_lines_proposal_id_idx" ON "auto_budget_proposal_lines"("proposal_id");

-- CreateIndex
CREATE INDEX "analytics_refresh_runs_organization_id_scope_key_started_at_idx" ON "analytics_refresh_runs"("organization_id", "scope_key", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "analytical_dataset_versions_organization_id_key_version_key" ON "analytical_dataset_versions"("organization_id", "key", "version");

-- AddForeignKey
ALTER TABLE "analytics_data_contracts" ADD CONSTRAINT "analytics_data_contracts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "analytics_data_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "metric_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_runs" ADD CONSTRAINT "metric_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_runs" ADD CONSTRAINT "metric_runs_metric_definition_id_fkey" FOREIGN KEY ("metric_definition_id") REFERENCES "metric_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_runs" ADD CONSTRAINT "metric_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_unit_conversions" ADD CONSTRAINT "analytics_unit_conversions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_currency_normalizations" ADD CONSTRAINT "analytics_currency_normalizations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_facts" ADD CONSTRAINT "analytics_facts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_facts" ADD CONSTRAINT "analytics_facts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_facts" ADD CONSTRAINT "analytics_facts_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "analytics_data_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_facts" ADD CONSTRAINT "analytics_facts_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_facts" ADD CONSTRAINT "analytics_facts_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_facts" ADD CONSTRAINT "analytics_facts_operating_unit_id_fkey" FOREIGN KEY ("operating_unit_id") REFERENCES "project_operating_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparability_policies" ADD CONSTRAINT "comparability_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_runs" ADD CONSTRAINT "benchmark_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_runs" ADD CONSTRAINT "benchmark_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_runs" ADD CONSTRAINT "benchmark_runs_metric_definition_id_fkey" FOREIGN KEY ("metric_definition_id") REFERENCES "metric_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_runs" ADD CONSTRAINT "benchmark_runs_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "comparability_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_members" ADD CONSTRAINT "benchmark_members_benchmark_run_id_fkey" FOREIGN KEY ("benchmark_run_id") REFERENCES "benchmark_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_members" ADD CONSTRAINT "benchmark_members_fact_id_fkey" FOREIGN KEY ("fact_id") REFERENCES "analytics_facts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_outliers" ADD CONSTRAINT "benchmark_outliers_benchmark_run_id_fkey" FOREIGN KEY ("benchmark_run_id") REFERENCES "benchmark_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_outliers" ADD CONSTRAINT "benchmark_outliers_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "benchmark_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_evaluations" ADD CONSTRAINT "forecast_evaluations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_evaluations" ADD CONSTRAINT "forecast_evaluations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_evaluations" ADD CONSTRAINT "forecast_evaluations_metric_definition_id_fkey" FOREIGN KEY ("metric_definition_id") REFERENCES "metric_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_quality_rules" ADD CONSTRAINT "data_quality_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_quality_runs" ADD CONSTRAINT "data_quality_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_quality_runs" ADD CONSTRAINT "data_quality_runs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "data_quality_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_quality_issues" ADD CONSTRAINT "data_quality_issues_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "data_quality_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_budget_proposals" ADD CONSTRAINT "auto_budget_proposals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_budget_proposals" ADD CONSTRAINT "auto_budget_proposals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_budget_proposals" ADD CONSTRAINT "auto_budget_proposals_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "comparability_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_budget_proposals" ADD CONSTRAINT "auto_budget_proposals_previous_proposal_id_fkey" FOREIGN KEY ("previous_proposal_id") REFERENCES "auto_budget_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_budget_proposal_lines" ADD CONSTRAINT "auto_budget_proposal_lines_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "auto_budget_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_budget_proposal_lines" ADD CONSTRAINT "auto_budget_proposal_lines_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_budget_proposal_lines" ADD CONSTRAINT "auto_budget_proposal_lines_benchmark_run_id_fkey" FOREIGN KEY ("benchmark_run_id") REFERENCES "benchmark_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_refresh_runs" ADD CONSTRAINT "analytics_refresh_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytical_dataset_versions" ADD CONSTRAINT "analytical_dataset_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

