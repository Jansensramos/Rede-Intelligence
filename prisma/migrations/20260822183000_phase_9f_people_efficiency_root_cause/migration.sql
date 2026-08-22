-- CreateEnum
CREATE TYPE "ProfessionalProfileStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "EmploymentRelationshipType" AS ENUM ('EMPLOYEE', 'CONTRACTOR', 'PARTNER', 'INTERN', 'TEMPORARY', 'OUTSOURCED');

-- CreateEnum
CREATE TYPE "EmploymentRelationshipStatus" AS ENUM ('PLANNED', 'ACTIVE', 'SUSPENDED', 'ENDED');

-- CreateEnum
CREATE TYPE "TeamType" AS ENUM ('CORPORATE', 'PROJECT', 'TEMPORARY');

-- CreateEnum
CREATE TYPE "WorkAllocationCriterion" AS ENUM ('PERCENTAGE', 'HOURS', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "AdministrativeCostPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AdministrativeAllocationDriver" AS ENUM ('HEADCOUNT', 'REVENUE', 'DIRECT_COST', 'AREA', 'FIXED_PERCENTAGE', 'MANUAL');

-- CreateEnum
CREATE TYPE "EfficiencyAnalysisStatus" AS ENUM ('DRAFT', 'COMPLETED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "PerformanceVarianceType" AS ENUM ('CASH', 'COMMITMENT', 'PHYSICAL', 'PRODUCTIVITY', 'QUALITY', 'DEADLINE');

-- CreateEnum
CREATE TYPE "PerformanceVarianceStatus" AS ENUM ('UNCLASSIFIED', 'UNDER_ANALYSIS', 'CLASSIFIED', 'VALIDATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RootCauseConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "CausalHypothesisStatus" AS ENUM ('PROPOSED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RootCauseCategory" AS ENUM ('PROCESS', 'PEOPLE', 'PLANNING', 'SUPPLIER', 'TECHNICAL', 'COMMERCIAL', 'LEGAL', 'EXTERNAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ExternalDependencyStatus" AS ENUM ('OPEN', 'MONITORED', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CorrectiveActionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'BLOCKED', 'COMPLETED', 'VERIFIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CorrectiveActionPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncentivePolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "IncentiveSimulationStatus" AS ENUM ('DRAFT', 'CALCULATED', 'APPROVED_FOR_REFERENCE', 'CANCELLED');

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT,
    "parent_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cost_center_code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "department_id" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "level" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_profiles" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT,
    "full_name" TEXT NOT NULL,
    "preferred_name" TEXT,
    "professional_id" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "status" "ProfessionalProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_relationships" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "position_id" TEXT,
    "department_id" TEXT,
    "manager_id" TEXT,
    "type" "EmploymentRelationshipType" NOT NULL,
    "status" "EmploymentRelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "weekly_hours" DECIMAL(8,2),
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employment_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT,
    "project_id" TEXT,
    "department_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TeamType" NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_memberships" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "relationship_id" TEXT NOT NULL,
    "role" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "allocation_rate" DECIMAL(9,6),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_allocations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "relationship_id" TEXT NOT NULL,
    "team_id" TEXT,
    "cost_center_id" TEXT,
    "economic_item_id" TEXT,
    "schedule_activity_id" TEXT,
    "criterion" "WorkAllocationCriterion" NOT NULL DEFAULT 'PERCENTAGE',
    "allocation_rate" DECIMAL(9,6),
    "allocated_hours" DECIMAL(12,2),
    "allocated_amount" DECIMAL(20,2),
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "over_allocation_justification" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationship_cost_snapshots" (
    "id" TEXT NOT NULL,
    "relationship_id" TEXT NOT NULL,
    "reference_month" DATE NOT NULL,
    "base_cost" DECIMAL(20,2) NOT NULL,
    "burden_cost" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "benefits_cost" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "other_cost" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(20,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relationship_cost_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "administrative_cost_plans" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT,
    "project_id" TEXT,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AdministrativeCostPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "reference_from" DATE NOT NULL,
    "reference_to" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "administrative_cost_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "administrative_cost_plan_lines" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "cost_center_id" TEXT,
    "economic_item_id" TEXT,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "planned_amount" DECIMAL(20,2) NOT NULL,
    "actual_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "committed_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "administrative_cost_plan_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "administrative_cost_allocation_rules" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "driver" "AdministrativeAllocationDriver" NOT NULL,
    "driver_snapshot" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "administrative_cost_allocation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "administrative_cost_allocation_snapshots" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "reference_month" DATE NOT NULL,
    "source_amount" DECIMAL(20,2) NOT NULL,
    "allocated_amount" DECIMAL(20,2) NOT NULL,
    "residual_amount" DECIMAL(20,2) NOT NULL,
    "proof_zero" BOOLEAN NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "administrative_cost_allocation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "administrative_cost_allocation_lines" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "plan_line_id" TEXT NOT NULL,
    "target_project_id" TEXT NOT NULL,
    "driver_value" DECIMAL(20,6) NOT NULL,
    "allocation_rate" DECIMAL(9,6) NOT NULL,
    "allocated_amount" DECIMAL(20,2) NOT NULL,

    CONSTRAINT "administrative_cost_allocation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "efficiency_analysis_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "reference_from" DATE NOT NULL,
    "reference_to" DATE NOT NULL,
    "status" "EfficiencyAnalysisStatus" NOT NULL DEFAULT 'DRAFT',
    "methodology_version" TEXT NOT NULL,
    "input_snapshot" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "efficiency_analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "efficiency_metric_results" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "metric_key" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "planned_value" DECIMAL(20,6),
    "committed_value" DECIMAL(20,6),
    "measured_value" DECIMAL(20,6),
    "actual_value" DECIMAL(20,6),
    "forecast_value" DECIMAL(20,6),
    "result_value" DECIMAL(20,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "confidence" "RootCauseConfidence" NOT NULL DEFAULT 'MEDIUM',
    "evidence_refs" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "efficiency_metric_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_variance_cases" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "analysis_run_id" TEXT NOT NULL,
    "metric_result_id" TEXT,
    "cost_center_id" TEXT,
    "economic_item_id" TEXT,
    "schedule_activity_id" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "PerformanceVarianceType" NOT NULL,
    "status" "PerformanceVarianceStatus" NOT NULL DEFAULT 'UNCLASSIFIED',
    "planned_amount" DECIMAL(20,2) NOT NULL,
    "committed_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "measured_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "actual_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "forecast_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "planned_progress" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "actual_progress" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "cash_variance" DECIMAL(20,2) NOT NULL,
    "commitment_variance" DECIMAL(20,2) NOT NULL,
    "physical_variance" DECIMAL(9,6) NOT NULL,
    "expected_cost_at_progress" DECIMAL(20,2) NOT NULL,
    "saving_eligible" BOOLEAN NOT NULL DEFAULT false,
    "owner_id" TEXT,
    "due_date" DATE,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_variance_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "root_cause_investigations" (
    "id" TEXT NOT NULL,
    "variance_case_id" TEXT NOT NULL,
    "problem_statement" TEXT NOT NULL,
    "scope" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluded_at" TIMESTAMP(3),
    "responsible_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "root_cause_investigations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "causal_hypotheses" (
    "id" TEXT NOT NULL,
    "investigation_id" TEXT NOT NULL,
    "category" "RootCauseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "CausalHypothesisStatus" NOT NULL DEFAULT 'PROPOSED',
    "confidence" "RootCauseConfidence" NOT NULL DEFAULT 'LOW',
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "causal_hypotheses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "causal_evidence" (
    "id" TEXT NOT NULL,
    "hypothesis_id" TEXT NOT NULL,
    "evidence_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "source_ref" TEXT NOT NULL,
    "source_version" TEXT,
    "observed_at" TIMESTAMP(3),
    "supports" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "causal_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "root_cause_allocations" (
    "id" TEXT NOT NULL,
    "investigation_id" TEXT NOT NULL,
    "hypothesis_id" TEXT NOT NULL,
    "contribution_rate" DECIMAL(9,6) NOT NULL,
    "amount_impact" DECIMAL(20,2),
    "rationale" TEXT NOT NULL,
    "validated_by_id" TEXT,
    "validated_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "root_cause_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_dependencies" (
    "id" TEXT NOT NULL,
    "investigation_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "owner" TEXT,
    "due_date" DATE,
    "status" "ExternalDependencyStatus" NOT NULL DEFAULT 'OPEN',
    "evidence_ref" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corrective_actions" (
    "id" TEXT NOT NULL,
    "investigation_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "CorrectiveActionPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "CorrectiveActionStatus" NOT NULL DEFAULT 'DRAFT',
    "responsible_id" TEXT NOT NULL,
    "due_date" DATE,
    "expected_impact" DECIMAL(20,2),
    "implementation_cost" DECIMAL(20,2),
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "verified_by_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corrective_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corrective_action_evidence" (
    "id" TEXT NOT NULL,
    "action_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source_ref" TEXT NOT NULL,
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corrective_action_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_policies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "IncentivePolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "pool_rate" DECIMAL(9,6) NOT NULL,
    "reserve_rate" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "minimum_pool" DECIMAL(20,2),
    "maximum_pool" DECIMAL(20,2),
    "rules" JSONB NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incentive_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_simulations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "validated_saving_id" TEXT,
    "name" TEXT NOT NULL,
    "status" "IncentiveSimulationStatus" NOT NULL DEFAULT 'DRAFT',
    "validated_saving_amount" DECIMAL(20,2) NOT NULL,
    "implementation_cost" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "reversal_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "eligible_base" DECIMAL(20,2) NOT NULL,
    "simulated_pool" DECIMAL(20,2) NOT NULL,
    "input_snapshot" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incentive_simulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_allocations" (
    "id" TEXT NOT NULL,
    "simulation_id" TEXT NOT NULL,
    "relationship_id" TEXT NOT NULL,
    "contribution_rate" DECIMAL(9,6) NOT NULL,
    "simulated_amount" DECIMAL(20,2) NOT NULL,
    "evidence_refs" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,

    CONSTRAINT "incentive_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "departments_company_id_is_active_idx" ON "departments"("company_id", "is_active");

-- CreateIndex
CREATE INDEX "departments_parent_id_idx" ON "departments"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_organization_id_code_key" ON "departments"("organization_id", "code");

-- CreateIndex
CREATE INDEX "positions_department_id_is_active_idx" ON "positions"("department_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "positions_organization_id_code_key" ON "positions"("organization_id", "code");

-- CreateIndex
CREATE INDEX "person_profiles_organization_id_status_idx" ON "person_profiles"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "person_profiles_organization_id_professional_id_key" ON "person_profiles"("organization_id", "professional_id");

-- CreateIndex
CREATE UNIQUE INDEX "person_profiles_organization_id_user_id_key" ON "person_profiles"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "employment_relationships_organization_id_status_idx" ON "employment_relationships"("organization_id", "status");

-- CreateIndex
CREATE INDEX "employment_relationships_company_id_department_id_idx" ON "employment_relationships"("company_id", "department_id");

-- CreateIndex
CREATE INDEX "employment_relationships_person_id_start_date_idx" ON "employment_relationships"("person_id", "start_date");

-- CreateIndex
CREATE INDEX "employment_relationships_manager_id_idx" ON "employment_relationships"("manager_id");

-- CreateIndex
CREATE INDEX "teams_project_id_is_active_idx" ON "teams"("project_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "teams_organization_id_code_key" ON "teams"("organization_id", "code");

-- CreateIndex
CREATE INDEX "team_memberships_relationship_id_start_date_end_date_idx" ON "team_memberships"("relationship_id", "start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "team_memberships_team_id_relationship_id_start_date_key" ON "team_memberships"("team_id", "relationship_id", "start_date");

-- CreateIndex
CREATE INDEX "work_allocations_organization_id_project_id_start_date_idx" ON "work_allocations"("organization_id", "project_id", "start_date");

-- CreateIndex
CREATE INDEX "work_allocations_relationship_id_start_date_end_date_idx" ON "work_allocations"("relationship_id", "start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "relationship_cost_snapshots_relationship_id_reference_month_key" ON "relationship_cost_snapshots"("relationship_id", "reference_month");

-- CreateIndex
CREATE INDEX "administrative_cost_plans_company_id_status_idx" ON "administrative_cost_plans"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "administrative_cost_plans_organization_id_name_version_key" ON "administrative_cost_plans"("organization_id", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "administrative_cost_plan_lines_plan_id_code_key" ON "administrative_cost_plan_lines"("plan_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "administrative_cost_allocation_rules_plan_id_name_key" ON "administrative_cost_allocation_rules"("plan_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "administrative_cost_allocation_snapshots_plan_id_rule_id_re_key" ON "administrative_cost_allocation_snapshots"("plan_id", "rule_id", "reference_month");

-- CreateIndex
CREATE INDEX "administrative_cost_allocation_lines_target_project_id_idx" ON "administrative_cost_allocation_lines"("target_project_id");

-- CreateIndex
CREATE UNIQUE INDEX "administrative_cost_allocation_lines_snapshot_id_plan_line__key" ON "administrative_cost_allocation_lines"("snapshot_id", "plan_line_id", "target_project_id");

-- CreateIndex
CREATE INDEX "efficiency_analysis_runs_organization_id_project_id_referen_idx" ON "efficiency_analysis_runs"("organization_id", "project_id", "reference_to");

-- CreateIndex
CREATE UNIQUE INDEX "efficiency_metric_results_run_id_metric_key_subject_type_su_key" ON "efficiency_metric_results"("run_id", "metric_key", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "performance_variance_cases_organization_id_status_type_idx" ON "performance_variance_cases"("organization_id", "status", "type");

-- CreateIndex
CREATE UNIQUE INDEX "performance_variance_cases_project_id_code_key" ON "performance_variance_cases"("project_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "root_cause_investigations_variance_case_id_key" ON "root_cause_investigations"("variance_case_id");

-- CreateIndex
CREATE INDEX "causal_hypotheses_investigation_id_status_idx" ON "causal_hypotheses"("investigation_id", "status");

-- CreateIndex
CREATE INDEX "causal_evidence_hypothesis_id_supports_idx" ON "causal_evidence"("hypothesis_id", "supports");

-- CreateIndex
CREATE UNIQUE INDEX "root_cause_allocations_investigation_id_hypothesis_id_key" ON "root_cause_allocations"("investigation_id", "hypothesis_id");

-- CreateIndex
CREATE INDEX "external_dependencies_investigation_id_status_idx" ON "external_dependencies"("investigation_id", "status");

-- CreateIndex
CREATE INDEX "corrective_actions_investigation_id_status_priority_idx" ON "corrective_actions"("investigation_id", "status", "priority");

-- CreateIndex
CREATE INDEX "corrective_action_evidence_action_id_created_at_idx" ON "corrective_action_evidence"("action_id", "created_at");

-- CreateIndex
CREATE INDEX "incentive_policies_organization_id_status_idx" ON "incentive_policies"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "incentive_policies_organization_id_name_version_key" ON "incentive_policies"("organization_id", "name", "version");

-- CreateIndex
CREATE INDEX "incentive_simulations_organization_id_project_id_status_idx" ON "incentive_simulations"("organization_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "incentive_simulations_validated_saving_id_idx" ON "incentive_simulations"("validated_saving_id");

-- CreateIndex
CREATE UNIQUE INDEX "incentive_allocations_simulation_id_relationship_id_key" ON "incentive_allocations"("simulation_id", "relationship_id");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_profiles" ADD CONSTRAINT "person_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_relationships" ADD CONSTRAINT "employment_relationships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_relationships" ADD CONSTRAINT "employment_relationships_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_relationships" ADD CONSTRAINT "employment_relationships_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_relationships" ADD CONSTRAINT "employment_relationships_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_relationships" ADD CONSTRAINT "employment_relationships_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_relationships" ADD CONSTRAINT "employment_relationships_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employment_relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "employment_relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_allocations" ADD CONSTRAINT "work_allocations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_allocations" ADD CONSTRAINT "work_allocations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_allocations" ADD CONSTRAINT "work_allocations_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "employment_relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_allocations" ADD CONSTRAINT "work_allocations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_allocations" ADD CONSTRAINT "work_allocations_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_allocations" ADD CONSTRAINT "work_allocations_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_allocations" ADD CONSTRAINT "work_allocations_schedule_activity_id_fkey" FOREIGN KEY ("schedule_activity_id") REFERENCES "schedule_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_cost_snapshots" ADD CONSTRAINT "relationship_cost_snapshots_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "employment_relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrative_cost_plans" ADD CONSTRAINT "administrative_cost_plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrative_cost_plans" ADD CONSTRAINT "administrative_cost_plans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrative_cost_plans" ADD CONSTRAINT "administrative_cost_plans_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrative_cost_plan_lines" ADD CONSTRAINT "administrative_cost_plan_lines_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "administrative_cost_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrative_cost_plan_lines" ADD CONSTRAINT "administrative_cost_plan_lines_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrative_cost_plan_lines" ADD CONSTRAINT "administrative_cost_plan_lines_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrative_cost_allocation_rules" ADD CONSTRAINT "administrative_cost_allocation_rules_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "administrative_cost_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrative_cost_allocation_snapshots" ADD CONSTRAINT "administrative_cost_allocation_snapshots_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "administrative_cost_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrative_cost_allocation_snapshots" ADD CONSTRAINT "administrative_cost_allocation_snapshots_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "administrative_cost_allocation_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrative_cost_allocation_lines" ADD CONSTRAINT "administrative_cost_allocation_lines_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "administrative_cost_allocation_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrative_cost_allocation_lines" ADD CONSTRAINT "administrative_cost_allocation_lines_plan_line_id_fkey" FOREIGN KEY ("plan_line_id") REFERENCES "administrative_cost_plan_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrative_cost_allocation_lines" ADD CONSTRAINT "administrative_cost_allocation_lines_target_project_id_fkey" FOREIGN KEY ("target_project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "efficiency_analysis_runs" ADD CONSTRAINT "efficiency_analysis_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "efficiency_analysis_runs" ADD CONSTRAINT "efficiency_analysis_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "efficiency_metric_results" ADD CONSTRAINT "efficiency_metric_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "efficiency_analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_variance_cases" ADD CONSTRAINT "performance_variance_cases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_variance_cases" ADD CONSTRAINT "performance_variance_cases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_variance_cases" ADD CONSTRAINT "performance_variance_cases_analysis_run_id_fkey" FOREIGN KEY ("analysis_run_id") REFERENCES "efficiency_analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_variance_cases" ADD CONSTRAINT "performance_variance_cases_metric_result_id_fkey" FOREIGN KEY ("metric_result_id") REFERENCES "efficiency_metric_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_variance_cases" ADD CONSTRAINT "performance_variance_cases_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_variance_cases" ADD CONSTRAINT "performance_variance_cases_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_variance_cases" ADD CONSTRAINT "performance_variance_cases_schedule_activity_id_fkey" FOREIGN KEY ("schedule_activity_id") REFERENCES "schedule_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "root_cause_investigations" ADD CONSTRAINT "root_cause_investigations_variance_case_id_fkey" FOREIGN KEY ("variance_case_id") REFERENCES "performance_variance_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "causal_hypotheses" ADD CONSTRAINT "causal_hypotheses_investigation_id_fkey" FOREIGN KEY ("investigation_id") REFERENCES "root_cause_investigations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "causal_evidence" ADD CONSTRAINT "causal_evidence_hypothesis_id_fkey" FOREIGN KEY ("hypothesis_id") REFERENCES "causal_hypotheses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "root_cause_allocations" ADD CONSTRAINT "root_cause_allocations_investigation_id_fkey" FOREIGN KEY ("investigation_id") REFERENCES "root_cause_investigations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "root_cause_allocations" ADD CONSTRAINT "root_cause_allocations_hypothesis_id_fkey" FOREIGN KEY ("hypothesis_id") REFERENCES "causal_hypotheses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_dependencies" ADD CONSTRAINT "external_dependencies_investigation_id_fkey" FOREIGN KEY ("investigation_id") REFERENCES "root_cause_investigations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_investigation_id_fkey" FOREIGN KEY ("investigation_id") REFERENCES "root_cause_investigations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_action_evidence" ADD CONSTRAINT "corrective_action_evidence_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "corrective_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_policies" ADD CONSTRAINT "incentive_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_simulations" ADD CONSTRAINT "incentive_simulations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_simulations" ADD CONSTRAINT "incentive_simulations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_simulations" ADD CONSTRAINT "incentive_simulations_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "incentive_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_simulations" ADD CONSTRAINT "incentive_simulations_validated_saving_id_fkey" FOREIGN KEY ("validated_saving_id") REFERENCES "validated_savings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_allocations" ADD CONSTRAINT "incentive_allocations_simulation_id_fkey" FOREIGN KEY ("simulation_id") REFERENCES "incentive_simulations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_allocations" ADD CONSTRAINT "incentive_allocations_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "employment_relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

