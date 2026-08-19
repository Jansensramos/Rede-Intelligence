-- CreateEnum
CREATE TYPE "DesignPackageStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'PARTIALLY_PROCESSED', 'UNDER_REVIEW', 'REVIEWED', 'SUPERSEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "DesignDiscipline" AS ENUM ('ARCHITECTURE', 'URBANISM', 'STRUCTURAL', 'FOUNDATION', 'ELECTRICAL', 'PLUMBING', 'HVAC', 'FIRE', 'ACCESSIBILITY', 'LANDSCAPE', 'INTERIORS', 'PARKING', 'INFRASTRUCTURE', 'DRAINAGE', 'ROAD', 'GEOTECHNICAL', 'TOPOGRAPHY', 'BIM', 'COST', 'SCHEDULE', 'SPECIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "DesignFileStatus" AS ENUM ('RECEIVED', 'VALIDATED', 'PROCESSING', 'READY', 'PARTIAL', 'UNSUPPORTED', 'FAILED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DesignJobStatus" AS ENUM ('QUEUED', 'VALIDATING', 'EXTRACTING', 'ANALYZING', 'INDEXING', 'GEOMETRY', 'FINALIZING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DesignScaleConfidence" AS ENUM ('CONFIRMED', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DesignDataOrigin" AS ENUM ('CONFIRMED', 'EXTRACTED', 'CALCULATED', 'INFERRED', 'USER_PROVIDED', 'NOT_VERIFIED');

-- CreateEnum
CREATE TYPE "DesignConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'NOT_VERIFIED');

-- CreateEnum
CREATE TYPE "DesignFindingType" AS ENUM ('ERROR', 'INCONSISTENCY', 'INEFFICIENCY', 'CODE_CHECK', 'URBAN_CONFLICT', 'AREA_MISMATCH', 'DESIGN_OPPORTUNITY', 'COST_OPPORTUNITY', 'PRODUCT_OPPORTUNITY', 'CONSTRUCTABILITY', 'COORDINATION', 'MISSING_INFORMATION', 'DOCUMENTATION', 'VALUE_ENGINEERING', 'COMMERCIAL_OPPORTUNITY', 'OTHER');

-- CreateEnum
CREATE TYPE "DesignFindingSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DesignFindingStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX', 'SUPERSEDED', 'POSSIBLY_RESOLVED');

-- CreateEnum
CREATE TYPE "DesignReviewMode" AS ENUM ('EXECUTIVE_REVIEW', 'ARCHITECTURAL_REVIEW', 'URBAN_REVIEW', 'PRODUCT_REVIEW', 'EFFICIENCY_REVIEW', 'COST_REVIEW', 'VALUE_ENGINEERING', 'COMMERCIAL_REVIEW', 'CONSTRUCTABILITY_REVIEW', 'BIM_COORDINATION', 'INVESTOR_REVIEW', 'FULL_REVIEW');

-- CreateEnum
CREATE TYPE "DesignPreflightStatus" AS ENUM ('READY', 'READY_WITH_LIMITATIONS', 'NOT_READY');

-- CreateEnum
CREATE TYPE "DesignReviewRoundStatus" AS ENUM ('DRAFT', 'AUTOMATED_REVIEW', 'HUMAN_REVIEW', 'AWAITING_RESPONSE', 'RECHECK', 'CLOSED');

-- CreateEnum
CREATE TYPE "VECategory" AS ENUM ('AREA_EFFICIENCY', 'CORE', 'CIRCULATION', 'STRUCTURE', 'FACADE', 'PARKING', 'UNIT_LAYOUT', 'WET_AREAS', 'MATERIAL', 'STANDARDIZATION', 'CONSTRUCTION_METHOD', 'PHASING', 'PRODUCT', 'INFRASTRUCTURE', 'OTHER');

-- CreateEnum
CREATE TYPE "VEOpportunityStatus" AS ENUM ('IDENTIFIED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'SIMULATING', 'IMPLEMENTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DesignEffort" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "DesignAlternativeStatus" AS ENUM ('DRAFT', 'SIMULATING', 'CALCULATED', 'SELECTED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DesignRuleCheckStatus" AS ENUM ('PASS', 'FAIL', 'WARNING', 'NOT_APPLICABLE', 'NOT_VERIFIED');

-- CreateEnum
CREATE TYPE "DesignRequirementStatus" AS ENUM ('MET', 'PARTIALLY_MET', 'NOT_MET', 'NOT_VERIFIED');

-- CreateEnum
CREATE TYPE "DesignChangeKind" AS ENUM ('ADDED', 'REMOVED', 'MODIFIED', 'UNCHANGED');

-- CreateTable
CREATE TABLE "design_project_packages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "investment_case_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "discipline_set" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "template" TEXT NOT NULL DEFAULT 'RESIDENTIAL_VERTICAL',
    "status" "DesignPackageStatus" NOT NULL DEFAULT 'UPLOADING',
    "review_mode" "DesignReviewMode" NOT NULL DEFAULT 'FULL_REVIEW',
    "preflight_status" "DesignPreflightStatus" NOT NULL DEFAULT 'NOT_READY',
    "preflight_limits" JSONB,
    "current_revision_id" TEXT,
    "baseline_revision_id" TEXT,
    "brief" JSONB,
    "targets" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_project_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_revisions" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "DesignPackageStatus" NOT NULL DEFAULT 'UPLOADING',
    "source_revision_id" TEXT,
    "content_hash" TEXT,
    "issued_at" DATE,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_files" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "revision_id" TEXT NOT NULL,
    "document_id" TEXT,
    "previous_file_id" TEXT,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "discipline" "DesignDiscipline" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "revision" TEXT NOT NULL,
    "issue_date" DATE,
    "sheet_number" TEXT,
    "title" TEXT,
    "status" "DesignFileStatus" NOT NULL DEFAULT 'RECEIVED',
    "checksum" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "storage_provider" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_status" "DesignJobStatus" NOT NULL DEFAULT 'QUEUED',
    "processing_metadata" JSONB,

    CONSTRAINT "design_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_sheets" (
    "id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "page_number" INTEGER NOT NULL,
    "sheet_number" TEXT,
    "title" TEXT,
    "revision" TEXT,
    "discipline" "DesignDiscipline" NOT NULL,
    "width_points" DECIMAL(12,4),
    "height_points" DECIMAL(12,4),
    "scale_denominator" DECIMAL(12,4),
    "scale_confidence" "DesignScaleConfidence" NOT NULL DEFAULT 'UNKNOWN',
    "calibration" JSONB,
    "extracted_text" TEXT,
    "text_confidence" "DesignConfidence" NOT NULL DEFAULT 'NOT_VERIFIED',
    "thumbnail_key" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_processing_jobs" (
    "id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "status" "DesignJobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "adapter" TEXT,
    "adapter_version" TEXT,
    "result" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_metrics" (
    "id" TEXT NOT NULL,
    "revision_id" TEXT NOT NULL,
    "sheet_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "name" TEXT NOT NULL,
    "value" DECIMAL(20,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "origin" "DesignDataOrigin" NOT NULL,
    "confidence" "DesignConfidence" NOT NULL,
    "source_file_id" TEXT,
    "source_sheet_id" TEXT,
    "method" TEXT NOT NULL,
    "evidence" JSONB,
    "verified_by_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_findings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "revision_id" TEXT NOT NULL,
    "file_id" TEXT,
    "sheet_id" TEXT,
    "discipline" "DesignDiscipline" NOT NULL,
    "category" TEXT NOT NULL,
    "type" "DesignFindingType" NOT NULL,
    "severity" "DesignFindingSeverity" NOT NULL,
    "confidence" "DesignConfidence" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "implication" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "evidence_refs" JSONB NOT NULL,
    "geometry_ref" JSONB,
    "element_refs" JSONB,
    "related_metric" TEXT,
    "potential_impact" JSONB,
    "status" "DesignFindingStatus" NOT NULL DEFAULT 'OPEN',
    "owner_id" TEXT,
    "due_date" DATE,
    "priority" "DesignFindingSeverity" NOT NULL DEFAULT 'MEDIUM',
    "source_rule_key" TEXT,
    "promoted_entity_type" TEXT,
    "promoted_entity_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_finding_evidence" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT,
    "source_type" "DesignDataOrigin" NOT NULL,
    "confidence" "DesignConfidence" NOT NULL,
    "location" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_finding_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_finding_responses" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "status" "DesignFindingStatus" NOT NULL,
    "evidence" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_finding_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_review_rounds" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "revision_id" TEXT NOT NULL,
    "round_number" INTEGER NOT NULL,
    "mode" "DesignReviewMode" NOT NULL,
    "status" "DesignReviewRoundStatus" NOT NULL DEFAULT 'DRAFT',
    "preflight_status" "DesignPreflightStatus" NOT NULL,
    "limitations" JSONB NOT NULL,
    "summary" JSONB,
    "started_by_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_review_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ve_opportunities" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "revision_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "VECategory" NOT NULL,
    "current_condition" TEXT NOT NULL,
    "proposed_condition" TEXT NOT NULL,
    "evidence_refs" JSONB NOT NULL,
    "related_finding_ids" JSONB NOT NULL,
    "design_impact" JSONB NOT NULL,
    "cost_impact" DECIMAL(20,2),
    "revenue_impact" DECIMAL(20,2),
    "schedule_impact_months" INTEGER,
    "risk_impact" TEXT NOT NULL,
    "confidence" "DesignConfidence" NOT NULL,
    "effort" "DesignEffort" NOT NULL,
    "requires_professional_validation" BOOLEAN NOT NULL DEFAULT true,
    "status" "VEOpportunityStatus" NOT NULL DEFAULT 'IDENTIFIED',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ve_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_alternatives" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "source_revision_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "geometry_changes" JSONB,
    "product_changes" JSONB NOT NULL,
    "area_changes" JSONB NOT NULL,
    "financial_impact" JSONB,
    "score_impact" JSONB,
    "status" "DesignAlternativeStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_alternatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_simulation_impacts" (
    "id" TEXT NOT NULL,
    "alternative_id" TEXT NOT NULL,
    "study_version_id" TEXT,
    "engine_version" TEXT,
    "delta" JSONB NOT NULL,
    "assumptions" JSONB,
    "engine_result" JSONB,
    "score_result" JSONB,
    "calculated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_simulation_impacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_changes" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "revision_from_id" TEXT NOT NULL,
    "revision_to_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_key" TEXT NOT NULL,
    "kind" "DesignChangeKind" NOT NULL,
    "description" TEXT NOT NULL,
    "affected_files" JSONB NOT NULL,
    "affected_metrics" JSONB NOT NULL,
    "delta" JSONB,
    "reason" TEXT,
    "author_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_baselines" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "revision_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targets" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "frozen_by_id" TEXT NOT NULL,
    "frozen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_requirements" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "required_value" JSONB NOT NULL,
    "measured_value" JSONB,
    "tolerance" DECIMAL(12,6),
    "status" "DesignRequirementStatus" NOT NULL DEFAULT 'NOT_VERIFIED',
    "evidence_refs" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_rule_sets" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "package_id" TEXT,
    "name" TEXT NOT NULL,
    "municipality" TEXT,
    "state" CHAR(2),
    "typology" TEXT,
    "discipline" "DesignDiscipline",
    "version" TEXT NOT NULL,
    "effective_date" DATE,
    "source" TEXT NOT NULL,
    "confidence" "DesignConfidence" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_rules" (
    "id" TEXT NOT NULL,
    "rule_set_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "applicability" JSONB NOT NULL,
    "comparator" TEXT NOT NULL,
    "required_value" DECIMAL(20,6),
    "unit" TEXT,
    "tolerance" DECIMAL(12,6),
    "source_ref" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "design_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_rule_checks" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "revision_id" TEXT NOT NULL,
    "status" "DesignRuleCheckStatus" NOT NULL,
    "measured_value" DECIMAL(20,6),
    "required_value" DECIMAL(20,6),
    "evidence" JSONB NOT NULL,
    "confidence" "DesignConfidence" NOT NULL,
    "review_required" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_rule_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detected_units" (
    "id" TEXT NOT NULL,
    "revision_id" TEXT NOT NULL,
    "source_file_id" TEXT,
    "source_sheet_id" TEXT,
    "unit_key" TEXT NOT NULL,
    "unit_type" TEXT NOT NULL,
    "floor" TEXT,
    "tower" TEXT,
    "private_area" DECIMAL(12,4),
    "balcony_area" DECIMAL(12,4),
    "rooms" INTEGER,
    "bathrooms" INTEGER,
    "parking_association" TEXT,
    "confidence" "DesignConfidence" NOT NULL,
    "origin" "DesignDataOrigin" NOT NULL,
    "geometry_ref" JSONB,

    CONSTRAINT "detected_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_clashes" (
    "id" TEXT NOT NULL,
    "revision_id" TEXT NOT NULL,
    "clash_type" TEXT NOT NULL,
    "element_a" JSONB NOT NULL,
    "element_b" JSONB NOT NULL,
    "geometry" JSONB NOT NULL,
    "severity" "DesignFindingSeverity" NOT NULL,
    "confidence" "DesignConfidence" NOT NULL,
    "status" "DesignFindingStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_clashes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_decisions" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "revision_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "impact" JSONB,
    "approved_by_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_audit_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "design_project_packages_organization_id_status_updated_at_idx" ON "design_project_packages"("organization_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "design_project_packages_project_id_updated_at_idx" ON "design_project_packages"("project_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "design_project_packages_organization_id_project_id_name_ver_key" ON "design_project_packages"("organization_id", "project_id", "name", "version");

-- CreateIndex
CREATE INDEX "design_revisions_package_id_created_at_idx" ON "design_revisions"("package_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "design_revisions_package_id_version_number_key" ON "design_revisions"("package_id", "version_number");

-- CreateIndex
CREATE INDEX "design_files_package_id_discipline_status_idx" ON "design_files"("package_id", "discipline", "status");

-- CreateIndex
CREATE INDEX "design_files_revision_id_uploaded_at_idx" ON "design_files"("revision_id", "uploaded_at");

-- CreateIndex
CREATE UNIQUE INDEX "design_files_package_id_checksum_revision_id_key" ON "design_files"("package_id", "checksum", "revision_id");

-- CreateIndex
CREATE INDEX "design_sheets_file_id_sheet_number_idx" ON "design_sheets"("file_id", "sheet_number");

-- CreateIndex
CREATE UNIQUE INDEX "design_sheets_file_id_page_number_key" ON "design_sheets"("file_id", "page_number");

-- CreateIndex
CREATE INDEX "design_processing_jobs_status_created_at_idx" ON "design_processing_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "design_processing_jobs_file_id_created_at_idx" ON "design_processing_jobs"("file_id", "created_at");

-- CreateIndex
CREATE INDEX "design_metrics_revision_id_entity_type_name_idx" ON "design_metrics"("revision_id", "entity_type", "name");

-- CreateIndex
CREATE INDEX "design_metrics_source_file_id_source_sheet_id_idx" ON "design_metrics"("source_file_id", "source_sheet_id");

-- CreateIndex
CREATE INDEX "design_findings_organization_id_project_id_status_idx" ON "design_findings"("organization_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "design_findings_package_id_revision_id_severity_status_idx" ON "design_findings"("package_id", "revision_id", "severity", "status");

-- CreateIndex
CREATE INDEX "design_findings_file_id_sheet_id_idx" ON "design_findings"("file_id", "sheet_id");

-- CreateIndex
CREATE UNIQUE INDEX "design_finding_evidence_finding_id_ref_key" ON "design_finding_evidence"("finding_id", "ref");

-- CreateIndex
CREATE INDEX "design_finding_responses_finding_id_created_at_idx" ON "design_finding_responses"("finding_id", "created_at");

-- CreateIndex
CREATE INDEX "design_review_rounds_revision_id_status_idx" ON "design_review_rounds"("revision_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "design_review_rounds_package_id_round_number_key" ON "design_review_rounds"("package_id", "round_number");

-- CreateIndex
CREATE INDEX "ve_opportunities_package_id_status_category_idx" ON "ve_opportunities"("package_id", "status", "category");

-- CreateIndex
CREATE INDEX "ve_opportunities_revision_id_confidence_effort_idx" ON "ve_opportunities"("revision_id", "confidence", "effort");

-- CreateIndex
CREATE INDEX "design_alternatives_source_revision_id_status_idx" ON "design_alternatives"("source_revision_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "design_alternatives_package_id_name_key" ON "design_alternatives"("package_id", "name");

-- CreateIndex
CREATE INDEX "design_simulation_impacts_alternative_id_calculated_at_idx" ON "design_simulation_impacts"("alternative_id", "calculated_at");

-- CreateIndex
CREATE INDEX "design_simulation_impacts_study_version_id_idx" ON "design_simulation_impacts"("study_version_id");

-- CreateIndex
CREATE INDEX "design_changes_package_id_revision_from_id_revision_to_id_idx" ON "design_changes"("package_id", "revision_from_id", "revision_to_id");

-- CreateIndex
CREATE INDEX "design_baselines_revision_id_idx" ON "design_baselines"("revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "design_baselines_package_id_name_key" ON "design_baselines"("package_id", "name");

-- CreateIndex
CREATE INDEX "design_requirements_package_id_status_idx" ON "design_requirements"("package_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "design_requirements_package_id_key_key" ON "design_requirements"("package_id", "key");

-- CreateIndex
CREATE INDEX "design_rule_sets_organization_id_active_municipality_state_idx" ON "design_rule_sets"("organization_id", "active", "municipality", "state");

-- CreateIndex
CREATE UNIQUE INDEX "design_rule_sets_organization_id_name_version_key" ON "design_rule_sets"("organization_id", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "design_rules_rule_set_id_key_key" ON "design_rules"("rule_set_id", "key");

-- CreateIndex
CREATE INDEX "design_rule_checks_revision_id_status_idx" ON "design_rule_checks"("revision_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "design_rule_checks_rule_id_revision_id_key" ON "design_rule_checks"("rule_id", "revision_id");

-- CreateIndex
CREATE INDEX "detected_units_revision_id_tower_floor_unit_type_idx" ON "detected_units"("revision_id", "tower", "floor", "unit_type");

-- CreateIndex
CREATE UNIQUE INDEX "detected_units_revision_id_unit_key_key" ON "detected_units"("revision_id", "unit_key");

-- CreateIndex
CREATE INDEX "design_clashes_revision_id_status_severity_idx" ON "design_clashes"("revision_id", "status", "severity");

-- CreateIndex
CREATE INDEX "design_decisions_package_id_revision_id_created_at_idx" ON "design_decisions"("package_id", "revision_id", "created_at");

-- CreateIndex
CREATE INDEX "design_audit_logs_organization_id_package_id_created_at_idx" ON "design_audit_logs"("organization_id", "package_id", "created_at");

-- CreateIndex
CREATE INDEX "design_audit_logs_entity_type_entity_id_idx" ON "design_audit_logs"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "design_project_packages" ADD CONSTRAINT "design_project_packages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_project_packages" ADD CONSTRAINT "design_project_packages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_revisions" ADD CONSTRAINT "design_revisions_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "design_project_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_files" ADD CONSTRAINT "design_files_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "design_project_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_files" ADD CONSTRAINT "design_files_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "design_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_sheets" ADD CONSTRAINT "design_sheets_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "design_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_processing_jobs" ADD CONSTRAINT "design_processing_jobs_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "design_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_metrics" ADD CONSTRAINT "design_metrics_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "design_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_findings" ADD CONSTRAINT "design_findings_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "design_project_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_findings" ADD CONSTRAINT "design_findings_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "design_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_finding_evidence" ADD CONSTRAINT "design_finding_evidence_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "design_findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_finding_responses" ADD CONSTRAINT "design_finding_responses_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "design_findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_review_rounds" ADD CONSTRAINT "design_review_rounds_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "design_project_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_review_rounds" ADD CONSTRAINT "design_review_rounds_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "design_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ve_opportunities" ADD CONSTRAINT "ve_opportunities_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "design_project_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ve_opportunities" ADD CONSTRAINT "ve_opportunities_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "design_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_alternatives" ADD CONSTRAINT "design_alternatives_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "design_project_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_alternatives" ADD CONSTRAINT "design_alternatives_source_revision_id_fkey" FOREIGN KEY ("source_revision_id") REFERENCES "design_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_simulation_impacts" ADD CONSTRAINT "design_simulation_impacts_alternative_id_fkey" FOREIGN KEY ("alternative_id") REFERENCES "design_alternatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_changes" ADD CONSTRAINT "design_changes_revision_from_id_fkey" FOREIGN KEY ("revision_from_id") REFERENCES "design_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_changes" ADD CONSTRAINT "design_changes_revision_to_id_fkey" FOREIGN KEY ("revision_to_id") REFERENCES "design_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_baselines" ADD CONSTRAINT "design_baselines_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "design_project_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_baselines" ADD CONSTRAINT "design_baselines_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "design_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_requirements" ADD CONSTRAINT "design_requirements_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "design_project_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_rule_sets" ADD CONSTRAINT "design_rule_sets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_rule_sets" ADD CONSTRAINT "design_rule_sets_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "design_project_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_rules" ADD CONSTRAINT "design_rules_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "design_rule_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_rule_checks" ADD CONSTRAINT "design_rule_checks_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "design_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_rule_checks" ADD CONSTRAINT "design_rule_checks_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "design_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detected_units" ADD CONSTRAINT "detected_units_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "design_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_clashes" ADD CONSTRAINT "design_clashes_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "design_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_decisions" ADD CONSTRAINT "design_decisions_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "design_project_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_decisions" ADD CONSTRAINT "design_decisions_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "design_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_audit_logs" ADD CONSTRAINT "design_audit_logs_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "design_project_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
