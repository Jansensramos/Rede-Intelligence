-- CreateEnum
CREATE TYPE "InvestmentCaseStatus" AS ENUM ('DRAFT', 'READY_FOR_REVIEW', 'IN_COMMITTEE', 'APPROVED', 'APPROVED_WITH_CONDITIONS', 'RESTRUCTURE', 'REJECTED', 'ON_HOLD', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ReviewRoundStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_COMMITTEE', 'DECIDED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "CommitteeDecisionType" AS ENUM ('APPROVE', 'APPROVE_WITH_CONDITIONS', 'RESTRUCTURE', 'REJECT', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "DecisionConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "CommitteeRole" AS ENUM ('CHAIR', 'VOTING_MEMBER', 'REVIEWER', 'OBSERVER');

-- CreateEnum
CREATE TYPE "CommitteeVoteDecision" AS ENUM ('APPROVE', 'APPROVE_WITH_CONDITIONS', 'RESTRUCTURE', 'REJECT', 'ABSTAIN');

-- CreateEnum
CREATE TYPE "InvestmentConditionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'SUBMITTED', 'VERIFIED', 'WAIVED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "InvestmentPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "StudioArtifactType" AS ENUM ('INVESTMENT_BOOK', 'INVESTMENT_MEMO', 'INVESTOR_DECK', 'ONE_PAGE', 'COMMITTEE_MEMO', 'URBAN_CASE', 'EXECUTIVE_REPORT', 'RED_TEAM_REPORT', 'DATA_ROOM_INDEX', 'INVESTOR_QA_PACK', 'MANAGEMENT_SUMMARY', 'BOARD_SUMMARY', 'MUNICIPALITY_PRESENTATION', 'LANDOWNER_PRESENTATION', 'FINANCIER_PACK', 'MASTER_REPORT');

-- CreateEnum
CREATE TYPE "StudioArtifactStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'FINAL', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ArtifactGenerationStatus" AS ENUM ('QUEUED', 'GENERATING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('REQUESTED', 'RECEIVED', 'UNDER_REVIEW', 'VERIFIED', 'EXPIRED', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentConfidentiality" AS ENUM ('PUBLIC_INTERNAL', 'CONFIDENTIAL', 'STRICTLY_CONFIDENTIAL');

-- CreateEnum
CREATE TYPE "MasterReportLevel" AS ENUM ('EXECUTIVE', 'COMPLETE', 'FULL_DOSSIER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MasterReportJobStatus" AS ENUM ('QUEUED', 'VALIDATING', 'RENDERING', 'ASSEMBLING', 'FINALIZING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UrbanApprovalStatus" AS ENUM ('NOT_STARTED', 'IN_PREPARATION', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "StageGateDecision" AS ENUM ('GO', 'GO_WITH_CONDITIONS', 'HOLD', 'STOP');

-- CreateEnum
CREATE TYPE "GovernanceItemStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CHALLENGED', 'VALIDATED', 'SUPPORTED', 'RETRACTED', 'IN_PROGRESS', 'BLOCKED', 'RESOLVED', 'CLOSED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "investment_cases" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "study_version_id" TEXT NOT NULL,
    "land_study_version_id" TEXT,
    "red_team_run_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "InvestmentCaseStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_snapshot_bundles" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schema_version" TEXT NOT NULL,
    "study_version_id" TEXT NOT NULL,
    "land_study_version_id" TEXT,
    "red_team_run_id" TEXT,
    "scenario" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "frozen_at" TIMESTAMP(3) NOT NULL,
    "frozen_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_snapshot_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_review_rounds" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "snapshot_bundle_id" TEXT NOT NULL,
    "round_number" INTEGER NOT NULL,
    "status" "ReviewRoundStatus" NOT NULL DEFAULT 'DRAFT',
    "agenda" TEXT,
    "submitted_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_review_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committee_decisions" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "review_round_id" TEXT NOT NULL,
    "decision" "CommitteeDecisionType" NOT NULL,
    "confidence" "DecisionConfidence" NOT NULL,
    "rationale" TEXT NOT NULL,
    "dominant_risk" TEXT NOT NULL,
    "recommended_action" TEXT NOT NULL,
    "decided_by_id" TEXT NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "committee_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_conditions" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" "InvestmentPriority" NOT NULL,
    "status" "InvestmentConditionStatus" NOT NULL DEFAULT 'OPEN',
    "is_blocker" BOOLEAN NOT NULL DEFAULT false,
    "evidence_required" TEXT NOT NULL,
    "owner_id" TEXT,
    "due_date" DATE,
    "verified_by_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committee_members" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "CommitteeRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "committee_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committee_votes" (
    "id" TEXT NOT NULL,
    "review_round_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "decision" "CommitteeVoteDecision" NOT NULL,
    "rationale" TEXT NOT NULL,
    "cast_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "committee_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committee_minutes" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "review_round_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "attendance" JSONB NOT NULL,
    "discussion" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "approved_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "committee_minutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committee_questions" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "status" "GovernanceItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "owner_id" TEXT,
    "evidence_refs" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "committee_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_brand_configs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_brand_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_artifacts" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "snapshot_bundle_id" TEXT NOT NULL,
    "config_id" TEXT,
    "report_id" TEXT,
    "type" "StudioArtifactType" NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "StudioArtifactStatus" NOT NULL DEFAULT 'DRAFT',
    "generation_status" "ArtifactGenerationStatus" NOT NULL DEFAULT 'QUEUED',
    "document_model" JSONB NOT NULL,
    "template_version" TEXT NOT NULL,
    "file_name" TEXT,
    "mime_type" TEXT,
    "content" BYTEA,
    "file_size" INTEGER,
    "page_count" INTEGER,
    "checksum_algorithm" TEXT,
    "checksum" TEXT,
    "confidentiality" "DocumentConfidentiality" NOT NULL,
    "generated_by_id" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_documents" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "source_artifact_id" TEXT,
    "previous_version_id" TEXT,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'RECEIVED',
    "confidentiality" "DocumentConfidentiality" NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "content" BYTEA,
    "file_size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "effective_date" DATE,
    "expires_at" DATE,
    "source" TEXT,
    "metadata" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_checklist_items" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "document_id" TEXT,
    "condition_id" TEXT,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'REQUESTED',
    "evidence_request_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_audit_logs" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "urban_transformation_profiles" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "inhabitants_per_unit" DECIMAL(8,4) NOT NULL,
    "estimated_population" INTEGER NOT NULL,
    "readiness" DECIMAL(5,2) NOT NULL,
    "readiness_label" TEXT NOT NULL,
    "as_is" JSONB NOT NULL,
    "to_be" JSONB NOT NULL,
    "benefits" JSONB NOT NULL,
    "value_bridge" JSONB NOT NULL,
    "downcase" JSONB NOT NULL,
    "option_economics" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "urban_transformation_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "urban_infrastructure_assessments" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "urban_infrastructure_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "urban_impact_assessments" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "magnitude" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "mitigation" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "urban_impact_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "urban_contributions" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "estimated_cost" DECIMAL(20,2),
    "phase" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "voluntary" BOOLEAN NOT NULL DEFAULT false,
    "evidence_refs" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "urban_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "urban_transformation_costs" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "included_in_engine" BOOLEAN NOT NULL DEFAULT false,
    "evidence_refs" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "urban_transformation_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "urban_approval_milestones" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "dependency_id" TEXT,
    "title" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "status" "UrbanApprovalStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "duration_months" INTEGER,
    "planned_date" DATE,
    "evidence_refs" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "urban_approval_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "urban_stage_gates" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "gate_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "decision" "StageGateDecision" NOT NULL,
    "rationale" TEXT NOT NULL,
    "kill_criteria" JSONB NOT NULL,
    "decided_by_id" TEXT NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "urban_stage_gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "urban_risk_items" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" "InvestmentPriority" NOT NULL,
    "status" "GovernanceItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT NOT NULL,
    "owner_id" TEXT,
    "mitigation" TEXT NOT NULL,
    "evidence_ref" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "urban_risk_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assumption_register_items" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "status" "GovernanceItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "owner_id" TEXT,
    "evidence_ref" TEXT NOT NULL,
    "source_version" TEXT NOT NULL,
    "effective_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assumption_register_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_claims" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "status" "GovernanceItemStatus" NOT NULL DEFAULT 'DRAFT',
    "evidence_refs" JSONB NOT NULL,
    "owner_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_ledger_entries" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidence_refs" JSONB NOT NULL,
    "decided_by_id" TEXT NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "predevelopment_budget_items" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "at_risk" BOOLEAN NOT NULL DEFAULT true,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "evidence_refs" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "predevelopment_budget_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "land_control_strategies" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "structure_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "upfront_amount" DECIMAL(20,2) NOT NULL,
    "contingent_amount" DECIMAL(20,2) NOT NULL,
    "expires_at" DATE,
    "status" "GovernanceItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "land_control_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_stakeholders" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "influence" TEXT NOT NULL,
    "interest" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "engagement_plan" TEXT NOT NULL,
    "owner_id" TEXT,
    "internal_only" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_stakeholders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_issues" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "GovernanceItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "priority" "InvestmentPriority" NOT NULL,
    "owner_id" TEXT,
    "due_date" DATE,
    "next_action" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_structures" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capital_stack" JSONB NOT NULL,
    "sources_and_uses" JSONB NOT NULL,
    "terms" JSONB NOT NULL,
    "fees" JSONB NOT NULL,
    "is_selected" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_sandboxes" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "source_study_version_id" TEXT NOT NULL,
    "promoted_study_version_id" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "changes" JSONB NOT NULL,
    "output" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_sandboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_report_configs" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "snapshot_bundle_id" TEXT NOT NULL,
    "level" "MasterReportLevel" NOT NULL,
    "audience" TEXT NOT NULL,
    "confidentiality" "DocumentConfidentiality" NOT NULL,
    "config" JSONB NOT NULL,
    "config_digest" TEXT NOT NULL,
    "frozen_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "master_report_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_report_jobs" (
    "id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "artifact_id" TEXT,
    "status" "MasterReportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "current_step" TEXT NOT NULL DEFAULT 'QUEUED',
    "section_errors" JSONB NOT NULL,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_report_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "investment_cases_organization_id_updated_at_idx" ON "investment_cases"("organization_id", "updated_at");

-- CreateIndex
CREATE INDEX "investment_cases_project_id_status_idx" ON "investment_cases"("project_id", "status");

-- CreateIndex
CREATE INDEX "investment_cases_study_version_id_idx" ON "investment_cases"("study_version_id");

-- CreateIndex
CREATE INDEX "investment_snapshot_bundles_study_version_id_idx" ON "investment_snapshot_bundles"("study_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "investment_snapshot_bundles_investment_case_id_version_key" ON "investment_snapshot_bundles"("investment_case_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "investment_snapshot_bundles_investment_case_id_checksum_key" ON "investment_snapshot_bundles"("investment_case_id", "checksum");

-- CreateIndex
CREATE INDEX "investment_review_rounds_snapshot_bundle_id_idx" ON "investment_review_rounds"("snapshot_bundle_id");

-- CreateIndex
CREATE UNIQUE INDEX "investment_review_rounds_investment_case_id_round_number_key" ON "investment_review_rounds"("investment_case_id", "round_number");

-- CreateIndex
CREATE INDEX "committee_decisions_investment_case_id_decided_at_idx" ON "committee_decisions"("investment_case_id", "decided_at");

-- CreateIndex
CREATE UNIQUE INDEX "committee_decisions_review_round_id_key" ON "committee_decisions"("review_round_id");

-- CreateIndex
CREATE INDEX "investment_conditions_investment_case_id_status_is_blocker_idx" ON "investment_conditions"("investment_case_id", "status", "is_blocker");

-- CreateIndex
CREATE UNIQUE INDEX "committee_members_investment_case_id_user_id_key" ON "committee_members"("investment_case_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "committee_votes_review_round_id_member_id_key" ON "committee_votes"("review_round_id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "committee_minutes_review_round_id_key" ON "committee_minutes"("review_round_id");

-- CreateIndex
CREATE INDEX "committee_questions_investment_case_id_status_idx" ON "committee_questions"("investment_case_id", "status");

-- CreateIndex
CREATE INDEX "organization_brand_configs_organization_id_is_default_idx" ON "organization_brand_configs"("organization_id", "is_default");

-- CreateIndex
CREATE UNIQUE INDEX "organization_brand_configs_organization_id_name_key" ON "organization_brand_configs"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "studio_artifacts_report_id_key" ON "studio_artifacts"("report_id");

-- CreateIndex
CREATE INDEX "studio_artifacts_snapshot_bundle_id_type_idx" ON "studio_artifacts"("snapshot_bundle_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "studio_artifacts_investment_case_id_type_version_key" ON "studio_artifacts"("investment_case_id", "type", "version");

-- CreateIndex
CREATE INDEX "project_documents_investment_case_id_status_category_idx" ON "project_documents"("investment_case_id", "status", "category");

-- CreateIndex
CREATE UNIQUE INDEX "project_documents_investment_case_id_category_title_version_key" ON "project_documents"("investment_case_id", "category", "title", "version");

-- CreateIndex
CREATE INDEX "document_checklist_items_investment_case_id_category_status_idx" ON "document_checklist_items"("investment_case_id", "category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "document_checklist_items_investment_case_id_code_key" ON "document_checklist_items"("investment_case_id", "code");

-- CreateIndex
CREATE INDEX "investment_audit_logs_investment_case_id_created_at_idx" ON "investment_audit_logs"("investment_case_id", "created_at");

-- CreateIndex
CREATE INDEX "investment_audit_logs_entity_type_entity_id_idx" ON "investment_audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "urban_transformation_profiles_investment_case_id_version_key" ON "urban_transformation_profiles"("investment_case_id", "version");

-- CreateIndex
CREATE INDEX "urban_infrastructure_assessments_investment_case_id_categor_idx" ON "urban_infrastructure_assessments"("investment_case_id", "category");

-- CreateIndex
CREATE INDEX "urban_impact_assessments_investment_case_id_category_idx" ON "urban_impact_assessments"("investment_case_id", "category");

-- CreateIndex
CREATE INDEX "urban_contributions_investment_case_id_status_idx" ON "urban_contributions"("investment_case_id", "status");

-- CreateIndex
CREATE INDEX "urban_transformation_costs_investment_case_id_included_in_e_idx" ON "urban_transformation_costs"("investment_case_id", "included_in_engine");

-- CreateIndex
CREATE INDEX "urban_approval_milestones_investment_case_id_status_idx" ON "urban_approval_milestones"("investment_case_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "urban_stage_gates_investment_case_id_gate_number_key" ON "urban_stage_gates"("investment_case_id", "gate_number");

-- CreateIndex
CREATE INDEX "urban_risk_items_investment_case_id_status_severity_idx" ON "urban_risk_items"("investment_case_id", "status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "assumption_register_items_investment_case_id_key_source_ver_key" ON "assumption_register_items"("investment_case_id", "key", "source_version");

-- CreateIndex
CREATE INDEX "investment_claims_investment_case_id_status_idx" ON "investment_claims"("investment_case_id", "status");

-- CreateIndex
CREATE INDEX "decision_ledger_entries_investment_case_id_decided_at_idx" ON "decision_ledger_entries"("investment_case_id", "decided_at");

-- CreateIndex
CREATE INDEX "predevelopment_budget_items_investment_case_id_at_risk_idx" ON "predevelopment_budget_items"("investment_case_id", "at_risk");

-- CreateIndex
CREATE INDEX "land_control_strategies_investment_case_id_status_idx" ON "land_control_strategies"("investment_case_id", "status");

-- CreateIndex
CREATE INDEX "investment_stakeholders_investment_case_id_type_idx" ON "investment_stakeholders"("investment_case_id", "type");

-- CreateIndex
CREATE INDEX "investment_issues_investment_case_id_status_priority_idx" ON "investment_issues"("investment_case_id", "status", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "deal_structures_investment_case_id_name_key" ON "deal_structures"("investment_case_id", "name");

-- CreateIndex
CREATE INDEX "decision_sandboxes_investment_case_id_status_idx" ON "decision_sandboxes"("investment_case_id", "status");

-- CreateIndex
CREATE INDEX "master_report_configs_investment_case_id_created_at_idx" ON "master_report_configs"("investment_case_id", "created_at");

-- CreateIndex
CREATE INDEX "master_report_jobs_investment_case_id_status_created_at_idx" ON "master_report_jobs"("investment_case_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "investment_cases" ADD CONSTRAINT "investment_cases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_snapshot_bundles" ADD CONSTRAINT "investment_snapshot_bundles_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_review_rounds" ADD CONSTRAINT "investment_review_rounds_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_review_rounds" ADD CONSTRAINT "investment_review_rounds_snapshot_bundle_id_fkey" FOREIGN KEY ("snapshot_bundle_id") REFERENCES "investment_snapshot_bundles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_decisions" ADD CONSTRAINT "committee_decisions_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_decisions" ADD CONSTRAINT "committee_decisions_review_round_id_fkey" FOREIGN KEY ("review_round_id") REFERENCES "investment_review_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_conditions" ADD CONSTRAINT "investment_conditions_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_members" ADD CONSTRAINT "committee_members_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_votes" ADD CONSTRAINT "committee_votes_review_round_id_fkey" FOREIGN KEY ("review_round_id") REFERENCES "investment_review_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_votes" ADD CONSTRAINT "committee_votes_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "committee_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_minutes" ADD CONSTRAINT "committee_minutes_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_minutes" ADD CONSTRAINT "committee_minutes_review_round_id_fkey" FOREIGN KEY ("review_round_id") REFERENCES "investment_review_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_questions" ADD CONSTRAINT "committee_questions_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_brand_configs" ADD CONSTRAINT "organization_brand_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_artifacts" ADD CONSTRAINT "studio_artifacts_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_artifacts" ADD CONSTRAINT "studio_artifacts_snapshot_bundle_id_fkey" FOREIGN KEY ("snapshot_bundle_id") REFERENCES "investment_snapshot_bundles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_source_artifact_id_fkey" FOREIGN KEY ("source_artifact_id") REFERENCES "studio_artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "project_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_checklist_items" ADD CONSTRAINT "document_checklist_items_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_checklist_items" ADD CONSTRAINT "document_checklist_items_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "project_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_checklist_items" ADD CONSTRAINT "document_checklist_items_condition_id_fkey" FOREIGN KEY ("condition_id") REFERENCES "investment_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_audit_logs" ADD CONSTRAINT "investment_audit_logs_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urban_transformation_profiles" ADD CONSTRAINT "urban_transformation_profiles_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urban_infrastructure_assessments" ADD CONSTRAINT "urban_infrastructure_assessments_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urban_impact_assessments" ADD CONSTRAINT "urban_impact_assessments_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urban_contributions" ADD CONSTRAINT "urban_contributions_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urban_transformation_costs" ADD CONSTRAINT "urban_transformation_costs_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urban_approval_milestones" ADD CONSTRAINT "urban_approval_milestones_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urban_stage_gates" ADD CONSTRAINT "urban_stage_gates_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urban_risk_items" ADD CONSTRAINT "urban_risk_items_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assumption_register_items" ADD CONSTRAINT "assumption_register_items_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_claims" ADD CONSTRAINT "investment_claims_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_ledger_entries" ADD CONSTRAINT "decision_ledger_entries_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predevelopment_budget_items" ADD CONSTRAINT "predevelopment_budget_items_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "land_control_strategies" ADD CONSTRAINT "land_control_strategies_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_stakeholders" ADD CONSTRAINT "investment_stakeholders_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_issues" ADD CONSTRAINT "investment_issues_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_structures" ADD CONSTRAINT "deal_structures_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_sandboxes" ADD CONSTRAINT "decision_sandboxes_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_report_configs" ADD CONSTRAINT "master_report_configs_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_report_configs" ADD CONSTRAINT "master_report_configs_snapshot_bundle_id_fkey" FOREIGN KEY ("snapshot_bundle_id") REFERENCES "investment_snapshot_bundles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_report_jobs" ADD CONSTRAINT "master_report_jobs_investment_case_id_fkey" FOREIGN KEY ("investment_case_id") REFERENCES "investment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_report_jobs" ADD CONSTRAINT "master_report_jobs_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "master_report_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_report_jobs" ADD CONSTRAINT "master_report_jobs_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "studio_artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Frozen bundles are append-only. Reassessment creates a new bundle and review round.
CREATE OR REPLACE FUNCTION prevent_investment_bundle_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Investment Snapshot Bundles are immutable; create a new version instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER investment_bundle_immutable_update
BEFORE UPDATE ON "investment_snapshot_bundles"
FOR EACH ROW EXECUTE FUNCTION prevent_investment_bundle_mutation();

CREATE TRIGGER investment_bundle_immutable_delete
BEFORE DELETE ON "investment_snapshot_bundles"
FOR EACH ROW EXECUTE FUNCTION prevent_investment_bundle_mutation();

-- A FINAL generated artifact is a historical record and cannot be replaced in place.
CREATE OR REPLACE FUNCTION prevent_final_artifact_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'FINAL' THEN
    RAISE EXCEPTION 'Final Studio artifacts are immutable; generate a new version instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER studio_artifact_final_immutable
BEFORE UPDATE OR DELETE ON "studio_artifacts"
FOR EACH ROW EXECUTE FUNCTION prevent_final_artifact_mutation();
