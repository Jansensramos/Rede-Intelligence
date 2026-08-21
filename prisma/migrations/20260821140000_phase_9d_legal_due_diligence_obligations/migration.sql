-- CreateEnum
CREATE TYPE "LegalRecordProvenance" AS ENUM ('OFFICIAL_DOCUMENT', 'MUNICIPAL_PORTAL', 'REGISTRY_OFFICE', 'CONTRACT', 'USER_CONFIRMED', 'MANUAL');

-- CreateEnum
CREATE TYPE "LegalDiligenceStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'UNDER_REVIEW', 'COMPLETED', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LegalDecisionStatus" AS ENUM ('PROCEED', 'PROCEED_WITH_CONDITIONS', 'HOLD', 'DO_NOT_PROCEED', 'INSUFFICIENT_EVIDENCE');

-- CreateEnum
CREATE TYPE "LegalItemStatus" AS ENUM ('NOT_STARTED', 'REQUESTED', 'RECEIVED', 'UNDER_REVIEW', 'COMPLIANT', 'NON_COMPLIANT', 'WAIVED', 'EXPIRED', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LegalCriticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "LegalObligationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DUE_SOON', 'OVERDUE', 'FULFILLED', 'WAIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LegalAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "LegalLicenseStatus" AS ENUM ('NOT_STARTED', 'IN_PREPARATION', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED', 'SUSPENDED', 'EXPIRED', 'RENEWAL_REQUIRED');

-- CreateEnum
CREATE TYPE "LegalFinancialEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'REVERSED', 'FAILED');

-- CreateTable
CREATE TABLE "legal_due_diligence_cases" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "land_asset_id" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" "LegalDiligenceStatus" NOT NULL DEFAULT 'DRAFT',
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "started_at" DATE,
    "target_completion_at" DATE,
    "completed_at" DATE,
    "responsible_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_due_diligence_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_asset_registrations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "land_asset_id" TEXT NOT NULL,
    "registry_office" TEXT NOT NULL,
    "registration_number" TEXT NOT NULL,
    "book" TEXT,
    "sheet" TEXT,
    "version" INTEGER NOT NULL,
    "status" "LegalItemStatus" NOT NULL DEFAULT 'UNDER_REVIEW',
    "provenance" "LegalRecordProvenance" NOT NULL,
    "source_document_link_id" TEXT,
    "registered_owner" TEXT NOT NULL,
    "area" DECIMAL(20,4),
    "entries" JSONB NOT NULL,
    "effective_at" DATE,
    "verified_at" TIMESTAMP(3),
    "responsible_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_asset_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_party_links" (
    "id" TEXT NOT NULL,
    "diligence_case_id" TEXT NOT NULL,
    "party_type" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name_snapshot" TEXT NOT NULL,
    "tax_id_snapshot" TEXT,
    "provenance" "LegalRecordProvenance" NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_party_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_checklist_items" (
    "id" TEXT NOT NULL,
    "diligence_case_id" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "template_version" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "criticality" "LegalCriticality" NOT NULL,
    "status" "LegalItemStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "responsible_id" TEXT NOT NULL,
    "due_at" DATE,
    "evidence_document_ids" JSONB,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_document_requests" (
    "id" TEXT NOT NULL,
    "diligence_case_id" TEXT NOT NULL,
    "checklist_item_id" TEXT,
    "code" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "requested_from_party_id" TEXT,
    "status" "LegalItemStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_at" DATE NOT NULL,
    "due_at" DATE,
    "received_at" TIMESTAMP(3),
    "document_link_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "responsible_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_document_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_findings" (
    "id" TEXT NOT NULL,
    "diligence_case_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "LegalCriticality" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "recommendation" TEXT NOT NULL,
    "status" "LegalItemStatus" NOT NULL DEFAULT 'UNDER_REVIEW',
    "risk_finding_id" TEXT,
    "owner_id" TEXT NOT NULL,
    "target_date" DATE,
    "resolved_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_decisions" (
    "id" TEXT NOT NULL,
    "diligence_case_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "decision" "LegalDecisionStatus" NOT NULL,
    "executive_conclusion" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "blockers" JSONB NOT NULL,
    "finding_snapshot" JSONB NOT NULL,
    "decided_by_id" TEXT NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "municipal_property_records" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "land_asset_id" TEXT NOT NULL,
    "municipality_code" TEXT NOT NULL,
    "municipal_registration" TEXT NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "assessed_value" DECIMAL(20,2),
    "property_tax_amount" DECIMAL(20,2),
    "debt_status" TEXT NOT NULL,
    "debt_amount" DECIMAL(20,2),
    "provenance" "LegalRecordProvenance" NOT NULL,
    "source_ref" TEXT NOT NULL,
    "source_snapshot" JSONB,
    "verified_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "municipal_property_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_deadline_policies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "milestones" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_deadline_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_obligations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "operational_contract_id" TEXT,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "authority" TEXT,
    "criticality" "LegalCriticality" NOT NULL,
    "status" "LegalObligationStatus" NOT NULL DEFAULT 'DRAFT',
    "due_at" DATE NOT NULL,
    "recurrence_rule" JSONB,
    "amount" DECIMAL(20,2),
    "supplier_id" TEXT,
    "company_id" TEXT,
    "cost_center_id" TEXT,
    "economic_item_id" TEXT,
    "budget_line_item_id" TEXT,
    "schedule_activity_id" TEXT,
    "provenance" "LegalRecordProvenance" NOT NULL,
    "source_ref" TEXT NOT NULL,
    "responsible_id" TEXT NOT NULL,
    "fulfilled_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_alerts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "legal_obligation_id" TEXT,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "milestone_code" TEXT NOT NULL,
    "criticality" "LegalCriticality" NOT NULL,
    "status" "LegalAlertStatus" NOT NULL DEFAULT 'OPEN',
    "trigger_at" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "responsible_id" TEXT NOT NULL,
    "acknowledged_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_licenses" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "process_number" TEXT,
    "status" "LegalLicenseStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "issued_at" DATE,
    "valid_from" DATE,
    "expires_at" DATE,
    "renewal_lead_days" INTEGER NOT NULL DEFAULT 90,
    "document_link_id" TEXT,
    "provenance" "LegalRecordProvenance" NOT NULL,
    "responsible_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_license_conditions" (
    "id" TEXT NOT NULL,
    "license_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "LegalItemStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "due_at" DATE,
    "responsible_id" TEXT NOT NULL,
    "evidence" JSONB,
    "fulfilled_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_license_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_authority_processes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "process_number" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "LegalLicenseStatus" NOT NULL DEFAULT 'IN_PREPARATION',
    "submitted_at" DATE,
    "expected_decision_at" DATE,
    "last_movement_at" DATE,
    "movements" JSONB NOT NULL,
    "provenance" "LegalRecordProvenance" NOT NULL,
    "responsible_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_authority_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_timeline_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "schedule_activity_id" TEXT,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "planned_at" DATE NOT NULL,
    "actual_at" DATE,
    "status" "LegalItemStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "blocks_schedule" BOOLEAN NOT NULL DEFAULT false,
    "impact_days" INTEGER NOT NULL DEFAULT 0,
    "criticality" "LegalCriticality" NOT NULL,
    "responsible_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_contract_conditions" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "LegalItemStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "due_at" DATE,
    "responsible_id" TEXT NOT NULL,
    "evidence" JSONB,
    "satisfied_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_contract_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_guarantees" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "beneficiary" TEXT NOT NULL,
    "amount" DECIMAL(20,2),
    "starts_at" DATE,
    "expires_at" DATE,
    "status" "LegalItemStatus" NOT NULL,
    "document_link_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_guarantees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_financial_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "legal_obligation_id" TEXT NOT NULL,
    "financial_obligation_id" TEXT,
    "payable_account_id" TEXT,
    "event_type" TEXT NOT NULL,
    "source_version" INTEGER NOT NULL DEFAULT 1,
    "idempotency_key" TEXT NOT NULL,
    "payload_checksum" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "LegalFinancialEventStatus" NOT NULL DEFAULT 'PENDING',
    "processed_at" TIMESTAMP(3),
    "reversed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_financial_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_due_diligence_cases_organization_id_project_id_status_idx" ON "legal_due_diligence_cases"("organization_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "legal_due_diligence_cases_organization_id_code_key" ON "legal_due_diligence_cases"("organization_id", "code");

-- CreateIndex
CREATE INDEX "legal_asset_registrations_organization_id_registration_numb_idx" ON "legal_asset_registrations"("organization_id", "registration_number");

-- CreateIndex
CREATE UNIQUE INDEX "legal_asset_registrations_land_asset_id_registration_number_key" ON "legal_asset_registrations"("land_asset_id", "registration_number", "version");

-- CreateIndex
CREATE INDEX "legal_party_links_party_type_party_id_idx" ON "legal_party_links"("party_type", "party_id");

-- CreateIndex
CREATE UNIQUE INDEX "legal_party_links_diligence_case_id_party_type_party_id_rol_key" ON "legal_party_links"("diligence_case_id", "party_type", "party_id", "role");

-- CreateIndex
CREATE INDEX "legal_checklist_items_diligence_case_id_status_criticality_idx" ON "legal_checklist_items"("diligence_case_id", "status", "criticality");

-- CreateIndex
CREATE UNIQUE INDEX "legal_checklist_items_diligence_case_id_code_key" ON "legal_checklist_items"("diligence_case_id", "code");

-- CreateIndex
CREATE INDEX "legal_document_requests_diligence_case_id_status_due_at_idx" ON "legal_document_requests"("diligence_case_id", "status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "legal_document_requests_diligence_case_id_code_version_key" ON "legal_document_requests"("diligence_case_id", "code", "version");

-- CreateIndex
CREATE INDEX "legal_findings_diligence_case_id_severity_status_idx" ON "legal_findings"("diligence_case_id", "severity", "status");

-- CreateIndex
CREATE UNIQUE INDEX "legal_findings_diligence_case_id_code_key" ON "legal_findings"("diligence_case_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "legal_decisions_diligence_case_id_version_key" ON "legal_decisions"("diligence_case_id", "version");

-- CreateIndex
CREATE INDEX "municipal_property_records_organization_id_municipality_cod_idx" ON "municipal_property_records"("organization_id", "municipality_code", "fiscal_year");

-- CreateIndex
CREATE UNIQUE INDEX "municipal_property_records_land_asset_id_fiscal_year_versio_key" ON "municipal_property_records"("land_asset_id", "fiscal_year", "version");

-- CreateIndex
CREATE INDEX "legal_deadline_policies_organization_id_is_active_idx" ON "legal_deadline_policies"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "legal_deadline_policies_organization_id_name_version_key" ON "legal_deadline_policies"("organization_id", "name", "version");

-- CreateIndex
CREATE INDEX "legal_obligations_organization_id_project_id_status_due_at_idx" ON "legal_obligations"("organization_id", "project_id", "status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "legal_obligations_organization_id_code_key" ON "legal_obligations"("organization_id", "code");

-- CreateIndex
CREATE INDEX "legal_alerts_organization_id_project_id_status_trigger_at_idx" ON "legal_alerts"("organization_id", "project_id", "status", "trigger_at");

-- CreateIndex
CREATE UNIQUE INDEX "legal_alerts_organization_id_source_type_source_id_mileston_key" ON "legal_alerts"("organization_id", "source_type", "source_id", "milestone_code");

-- CreateIndex
CREATE INDEX "legal_licenses_organization_id_project_id_status_expires_at_idx" ON "legal_licenses"("organization_id", "project_id", "status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "legal_licenses_project_id_code_version_key" ON "legal_licenses"("project_id", "code", "version");

-- CreateIndex
CREATE INDEX "legal_license_conditions_license_id_status_due_at_idx" ON "legal_license_conditions"("license_id", "status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "legal_license_conditions_license_id_code_key" ON "legal_license_conditions"("license_id", "code");

-- CreateIndex
CREATE INDEX "legal_authority_processes_organization_id_project_id_status_idx" ON "legal_authority_processes"("organization_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "legal_authority_processes_organization_id_authority_process_key" ON "legal_authority_processes"("organization_id", "authority", "process_number");

-- CreateIndex
CREATE INDEX "legal_timeline_events_organization_id_project_id_status_pla_idx" ON "legal_timeline_events"("organization_id", "project_id", "status", "planned_at");

-- CreateIndex
CREATE UNIQUE INDEX "legal_timeline_events_organization_id_source_type_source_id_key" ON "legal_timeline_events"("organization_id", "source_type", "source_id", "code");

-- CreateIndex
CREATE INDEX "legal_contract_conditions_contract_id_status_due_at_idx" ON "legal_contract_conditions"("contract_id", "status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "legal_contract_conditions_contract_id_code_key" ON "legal_contract_conditions"("contract_id", "code");

-- CreateIndex
CREATE INDEX "legal_guarantees_contract_id_status_expires_at_idx" ON "legal_guarantees"("contract_id", "status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "legal_guarantees_contract_id_code_key" ON "legal_guarantees"("contract_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "legal_financial_events_idempotency_key_key" ON "legal_financial_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "legal_financial_events_organization_id_project_id_status_idx" ON "legal_financial_events"("organization_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "legal_financial_events_legal_obligation_id_event_type_sourc_key" ON "legal_financial_events"("legal_obligation_id", "event_type", "source_version");

-- AddForeignKey
ALTER TABLE "legal_due_diligence_cases" ADD CONSTRAINT "legal_due_diligence_cases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_due_diligence_cases" ADD CONSTRAINT "legal_due_diligence_cases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_due_diligence_cases" ADD CONSTRAINT "legal_due_diligence_cases_land_asset_id_fkey" FOREIGN KEY ("land_asset_id") REFERENCES "land_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_asset_registrations" ADD CONSTRAINT "legal_asset_registrations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_asset_registrations" ADD CONSTRAINT "legal_asset_registrations_land_asset_id_fkey" FOREIGN KEY ("land_asset_id") REFERENCES "land_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_party_links" ADD CONSTRAINT "legal_party_links_diligence_case_id_fkey" FOREIGN KEY ("diligence_case_id") REFERENCES "legal_due_diligence_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_checklist_items" ADD CONSTRAINT "legal_checklist_items_diligence_case_id_fkey" FOREIGN KEY ("diligence_case_id") REFERENCES "legal_due_diligence_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_document_requests" ADD CONSTRAINT "legal_document_requests_diligence_case_id_fkey" FOREIGN KEY ("diligence_case_id") REFERENCES "legal_due_diligence_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_findings" ADD CONSTRAINT "legal_findings_diligence_case_id_fkey" FOREIGN KEY ("diligence_case_id") REFERENCES "legal_due_diligence_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_decisions" ADD CONSTRAINT "legal_decisions_diligence_case_id_fkey" FOREIGN KEY ("diligence_case_id") REFERENCES "legal_due_diligence_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "municipal_property_records" ADD CONSTRAINT "municipal_property_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "municipal_property_records" ADD CONSTRAINT "municipal_property_records_land_asset_id_fkey" FOREIGN KEY ("land_asset_id") REFERENCES "land_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_deadline_policies" ADD CONSTRAINT "legal_deadline_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_obligations" ADD CONSTRAINT "legal_obligations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_obligations" ADD CONSTRAINT "legal_obligations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_alerts" ADD CONSTRAINT "legal_alerts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_alerts" ADD CONSTRAINT "legal_alerts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_alerts" ADD CONSTRAINT "legal_alerts_legal_obligation_id_fkey" FOREIGN KEY ("legal_obligation_id") REFERENCES "legal_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_licenses" ADD CONSTRAINT "legal_licenses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_licenses" ADD CONSTRAINT "legal_licenses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_license_conditions" ADD CONSTRAINT "legal_license_conditions_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "legal_licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_authority_processes" ADD CONSTRAINT "legal_authority_processes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_authority_processes" ADD CONSTRAINT "legal_authority_processes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_timeline_events" ADD CONSTRAINT "legal_timeline_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_timeline_events" ADD CONSTRAINT "legal_timeline_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_timeline_events" ADD CONSTRAINT "legal_timeline_events_schedule_activity_id_fkey" FOREIGN KEY ("schedule_activity_id") REFERENCES "schedule_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_contract_conditions" ADD CONSTRAINT "legal_contract_conditions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "operational_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_guarantees" ADD CONSTRAINT "legal_guarantees_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "operational_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_financial_events" ADD CONSTRAINT "legal_financial_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_financial_events" ADD CONSTRAINT "legal_financial_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_financial_events" ADD CONSTRAINT "legal_financial_events_legal_obligation_id_fkey" FOREIGN KEY ("legal_obligation_id") REFERENCES "legal_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
