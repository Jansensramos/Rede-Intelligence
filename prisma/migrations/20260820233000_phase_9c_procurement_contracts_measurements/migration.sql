-- CreateEnum
CREATE TYPE "SupplierQualificationStatus" AS ENUM ('PENDING', 'QUALIFIED', 'QUALIFIED_WITH_RESTRICTIONS', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProcurementNeedOrigin" AS ENUM ('BUDGET', 'ENGINEERING', 'SCHEDULE', 'BIM', 'VALUE_ENGINEERING', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ProcurementPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ProcurementNeedStatus" AS ENUM ('IDENTIFIED', 'VALIDATED', 'CONVERTED_TO_REQUISITION', 'DISCARDED');

-- CreateEnum
CREATE TYPE "PurchaseRequisitionStatus" AS ENUM ('DRAFT', 'REQUESTED', 'IN_APPROVAL', 'RETURNED', 'APPROVED_FOR_QUOTATION', 'IN_QUOTATION', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('PREPARING', 'OPEN', 'UNDER_ANALYSIS', 'DECIDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuotationInvitationStatus" AS ENUM ('INVITED', 'ACKNOWLEDGED', 'PROPOSAL_RECEIVED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SupplierProposalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REPLACED', 'WITHDRAWN', 'SELECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProposalComparability" AS ENUM ('COMPARABLE', 'COMPARABLE_WITH_ADJUSTMENTS', 'NOT_COMPARABLE');

-- CreateEnum
CREATE TYPE "SavingClassification" AS ENUM ('NEGOTIATED_SAVING', 'TECHNICAL_SAVING', 'SCOPE_CHANGE', 'QUANTITY_REDUCTION', 'COST_TRANSFER', 'VALIDATED_SAVING', 'UNCLASSIFIED_DIFFERENCE');

-- CreateEnum
CREATE TYPE "ApprovalActType" AS ENUM ('REQUISITION', 'PROCUREMENT_DECISION', 'PURCHASE_ORDER', 'CONTRACT', 'AMENDMENT', 'EXCEPTION', 'MEASUREMENT', 'CANCELLATION');

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalDecisionKind" AS ENUM ('APPROVE', 'REJECT', 'RETURN', 'ABSTAIN');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'IN_APPROVAL', 'APPROVED', 'ISSUED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "OperationalContractType" AS ENUM ('SUPPLY', 'SERVICE', 'CONSTRUCTION', 'DESIGN', 'CONSULTING', 'LEASE', 'ACQUISITION', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractBillingModel" AS ENUM ('MEASUREMENT', 'FIXED_INSTALLMENT', 'MONTHLY', 'MILESTONE', 'DELIVERY', 'ADVANCE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "OperationalContractStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'IN_APPROVAL', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'CANCELLED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "ContractAmendmentType" AS ENUM ('INCREASE', 'SUPPRESSION', 'TERM', 'SCOPE', 'READJUSTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractAmendmentStatus" AS ENUM ('DRAFT', 'IN_APPROVAL', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeviationCause" AS ENUM ('PRICE', 'QUANTITY', 'SCOPE', 'TERM', 'DESIGN', 'BUDGET_ERROR', 'MARKET', 'SUPPLIER', 'REWORK', 'PRODUCTIVITY', 'UNFORESEEN_CONDITION', 'LEGAL_CHANGE', 'OTHER');

-- CreateEnum
CREATE TYPE "MeasurementStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_TECHNICAL_REVIEW', 'TECHNICALLY_APPROVED', 'IN_APPROVAL', 'APPROVED', 'SENT_TO_FINANCE', 'RETURNED', 'REVERSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MeasurementAdjustmentType" AS ENUM ('CONTRACT_RETENTION', 'GUARANTEE', 'TECHNICAL_RETENTION', 'TAX', 'DISCOUNT', 'GLOSA', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractAdvanceStatus" AS ENUM ('PLANNED', 'RELEASED', 'PARTIALLY_AMORTIZED', 'AMORTIZED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FinancialIntegrationEventType" AS ENUM ('MEASUREMENT_APPROVED', 'MEASUREMENT_REVERSED', 'RETENTION_RELEASED', 'CONTRACT_COMMITMENT_UPDATED');

-- CreateEnum
CREATE TYPE "FinancialIntegrationEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'REVERSED');

-- CreateTable
CREATE TABLE "supplier_qualifications" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" "SupplierQualificationStatus" NOT NULL DEFAULT 'PENDING',
    "valid_from" DATE,
    "valid_until" DATE,
    "technical_capacity" TEXT,
    "insurance_notes" TEXT,
    "restrictions" TEXT,
    "evidence" JSONB,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_needs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT,
    "project_id" TEXT NOT NULL,
    "operating_unit_id" TEXT,
    "cost_center_id" TEXT,
    "economic_item_id" TEXT,
    "budget_line_item_id" TEXT,
    "schedule_activity_id" TEXT,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "specification" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "required_at" DATE NOT NULL,
    "expected_lead_days" INTEGER NOT NULL DEFAULT 30,
    "buffer_days" INTEGER NOT NULL DEFAULT 7,
    "priority" "ProcurementPriority" NOT NULL DEFAULT 'NORMAL',
    "origin" "ProcurementNeedOrigin" NOT NULL DEFAULT 'MANUAL',
    "origin_reference" TEXT,
    "origin_metadata" JSONB,
    "requester_id" TEXT NOT NULL,
    "technical_owner_id" TEXT,
    "status" "ProcurementNeedStatus" NOT NULL DEFAULT 'IDENTIFIED',
    "discarded_reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_needs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requisitions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT,
    "project_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "justification" TEXT,
    "status" "PurchaseRequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "requester_id" TEXT NOT NULL,
    "buyer_id" TEXT,
    "technical_owner_id" TEXT,
    "requested_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requisition_items" (
    "id" TEXT NOT NULL,
    "requisition_id" TEXT NOT NULL,
    "need_id" TEXT,
    "economic_item_id" TEXT,
    "budget_line_item_id" TEXT,
    "cost_center_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "estimated_unit_price" DECIMAL(20,2),
    "required_at" DATE,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_requisition_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_specifications" (
    "id" TEXT NOT NULL,
    "requisition_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "requirements" JSONB NOT NULL,
    "delivery_location" TEXT,
    "delivery_term" TEXT,
    "checksum" TEXT NOT NULL,
    "is_frozen" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procurement_specifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_processes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "requisition_id" TEXT NOT NULL,
    "specification_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'PREPARING',
    "response_deadline" TIMESTAMP(3),
    "buyer_id" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotation_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_invitations" (
    "id" TEXT NOT NULL,
    "quotation_process_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "status" "QuotationInvitationStatus" NOT NULL DEFAULT 'INVITED',
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    "invited_by_id" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "quotation_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_proposals" (
    "id" TEXT NOT NULL,
    "quotation_process_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "previous_proposal_id" TEXT,
    "version" INTEGER NOT NULL,
    "status" "SupplierProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "items_subtotal" DECIMAL(20,2) NOT NULL,
    "tax_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "freight_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(20,2) NOT NULL,
    "validity_until" DATE,
    "delivery_term_days" INTEGER,
    "payment_terms" TEXT,
    "warranty_terms" TEXT,
    "inclusions" JSONB,
    "exclusions" JSONB,
    "notes" TEXT,
    "checksum" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_proposal_items" (
    "id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "requisition_item_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_price" DECIMAL(20,2) NOT NULL,
    "tax_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "freight_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(20,2) NOT NULL,
    "normalized_total_amount" DECIMAL(20,2),
    "comparability" "ProposalComparability" NOT NULL DEFAULT 'COMPARABLE',
    "inclusions" JSONB,
    "exclusions" JSONB,
    "technical_notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "supplier_proposal_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_comparison_findings" (
    "id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "proposal_item_id" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "adjustment_amount" DECIMAL(20,2),
    "blocks_comparison" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_comparison_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_decisions" (
    "id" TEXT NOT NULL,
    "quotation_process_id" TEXT NOT NULL,
    "selected_proposal_id" TEXT NOT NULL,
    "technical_opinion" TEXT NOT NULL,
    "commercial_rationale" TEXT NOT NULL,
    "exceptions" JSONB,
    "decided_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),

    CONSTRAINT "procurement_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validated_savings" (
    "id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "economic_item_id" TEXT,
    "classification" "SavingClassification" NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_description" TEXT NOT NULL,
    "reference_amount" DECIMAL(20,2) NOT NULL,
    "contracted_comparable_amount" DECIMAL(20,2) NOT NULL,
    "nominal_amount" DECIMAL(20,2) NOT NULL,
    "percentage" DECIMAL(9,6) NOT NULL,
    "scope_comparable" BOOLEAN NOT NULL,
    "technical_validation" TEXT,
    "validated_by_id" TEXT,
    "validated_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validated_savings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_policies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "act_type" "ApprovalActType" NOT NULL,
    "company_id" TEXT,
    "project_id" TEXT,
    "category" TEXT,
    "minimum_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "maximum_amount" DECIMAL(20,2),
    "required_role" "MembershipRole" NOT NULL DEFAULT 'ADMIN',
    "required_approvals" INTEGER NOT NULL DEFAULT 1,
    "segregation_required" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "policy_id" TEXT,
    "act_type" "ApprovalActType" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "entity_version" INTEGER NOT NULL DEFAULT 1,
    "company_id" TEXT,
    "project_id" TEXT,
    "amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "category" TEXT,
    "snapshot" JSONB NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_decision_records" (
    "id" TEXT NOT NULL,
    "approval_request_id" TEXT NOT NULL,
    "decision" "ApprovalDecisionKind" NOT NULL,
    "decided_by_id" TEXT NOT NULL,
    "justification" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decision_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "quotation_process_id" TEXT,
    "selected_proposal_id" TEXT,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "original_amount" DECIMAL(20,2) NOT NULL,
    "delivery_at" DATE,
    "payment_terms" TEXT,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "issued_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "superseded_by_contract_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "economic_item_id" TEXT,
    "budget_line_item_id" TEXT,
    "cost_center_id" TEXT,
    "operating_unit_id" TEXT,
    "schedule_activity_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_price" DECIMAL(20,2) NOT NULL,
    "total_amount" DECIMAL(20,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_contracts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "quotation_process_id" TEXT,
    "selected_proposal_id" TEXT,
    "source_purchase_order_id" TEXT,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "OperationalContractType" NOT NULL,
    "billing_model" "ContractBillingModel" NOT NULL,
    "scope" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "original_amount" DECIMAL(20,2) NOT NULL,
    "starts_at" DATE NOT NULL,
    "ends_at" DATE NOT NULL,
    "responsible_id" TEXT NOT NULL,
    "payment_terms" TEXT,
    "readjustment_rule_id" TEXT,
    "retention_rate" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "warranty_terms" TEXT,
    "status" "OperationalContractStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operational_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_contract_items" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "economic_item_id" TEXT,
    "budget_line_item_id" TEXT,
    "cost_center_id" TEXT,
    "operating_unit_id" TEXT,
    "schedule_activity_id" TEXT,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_price" DECIMAL(20,2) NOT NULL,
    "original_amount" DECIMAL(20,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "operational_contract_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_amendments" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "type" "ContractAmendmentType" NOT NULL,
    "status" "ContractAmendmentStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT NOT NULL,
    "deviation_cause" "DeviationCause" NOT NULL,
    "scope_description" TEXT,
    "value" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "term_days" INTEGER NOT NULL DEFAULT 0,
    "effective_at" DATE,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_advances" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "original_amount" DECIMAL(20,2) NOT NULL,
    "released_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "status" "ContractAdvanceStatus" NOT NULL DEFAULT 'PLANNED',
    "due_at" DATE,
    "released_at" DATE,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_certificates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "competence_date" DATE NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "issued_at" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "responsible_id" TEXT NOT NULL,
    "gross_amount" DECIMAL(20,2) NOT NULL,
    "retention_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "advance_amortization_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(20,2) NOT NULL,
    "physical_progress" DECIMAL(9,6),
    "status" "MeasurementStatus" NOT NULL DEFAULT 'DRAFT',
    "technical_approved_by_id" TEXT,
    "technical_approved_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "reversed_at" TIMESTAMP(3),
    "reversal_reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "measurement_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_lines" (
    "id" TEXT NOT NULL,
    "measurement_id" TEXT NOT NULL,
    "contract_item_id" TEXT NOT NULL,
    "economic_item_id" TEXT,
    "budget_line_item_id" TEXT,
    "schedule_activity_id" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "contracted_quantity" DECIMAL(18,4) NOT NULL,
    "previous_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "period_quantity" DECIMAL(18,4) NOT NULL,
    "cumulative_quantity" DECIMAL(18,4) NOT NULL,
    "remaining_quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(20,2) NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "costCenterId" TEXT,

    CONSTRAINT "measurement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_adjustments" (
    "id" TEXT NOT NULL,
    "measurement_id" TEXT NOT NULL,
    "type" "MeasurementAdjustmentType" NOT NULL,
    "description" TEXT NOT NULL,
    "base_amount" DECIMAL(20,2) NOT NULL,
    "rate" DECIMAL(9,6),
    "amount" DECIMAL(20,2) NOT NULL,
    "expected_release_at" DATE,
    "released_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurement_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advance_amortizations" (
    "id" TEXT NOT NULL,
    "advance_id" TEXT NOT NULL,
    "measurement_id" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advance_amortizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_integration_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "measurement_id" TEXT,
    "financial_obligation_id" TEXT,
    "payable_account_id" TEXT,
    "event_type" "FinancialIntegrationEventType" NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_version" INTEGER NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "event_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload_checksum" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "FinancialIntegrationEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_integration_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_document_links" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_private" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procurement_document_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_qualifications_organization_id_status_valid_until_idx" ON "supplier_qualifications"("organization_id", "status", "valid_until");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_qualifications_supplier_id_category_key" ON "supplier_qualifications"("supplier_id", "category");

-- CreateIndex
CREATE INDEX "procurement_needs_organization_id_project_id_status_require_idx" ON "procurement_needs"("organization_id", "project_id", "status", "required_at");

-- CreateIndex
CREATE INDEX "procurement_needs_schedule_activity_id_required_at_idx" ON "procurement_needs"("schedule_activity_id", "required_at");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_needs_project_id_code_key" ON "procurement_needs"("project_id", "code");

-- CreateIndex
CREATE INDEX "purchase_requisitions_organization_id_project_id_status_idx" ON "purchase_requisitions"("organization_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisitions_project_id_number_key" ON "purchase_requisitions"("project_id", "number");

-- CreateIndex
CREATE INDEX "purchase_requisition_items_economic_item_id_idx" ON "purchase_requisition_items"("economic_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisition_items_requisition_id_need_id_key" ON "purchase_requisition_items"("requisition_id", "need_id");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_specifications_requisition_id_version_key" ON "procurement_specifications"("requisition_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_specifications_requisition_id_checksum_key" ON "procurement_specifications"("requisition_id", "checksum");

-- CreateIndex
CREATE INDEX "quotation_processes_organization_id_project_id_status_idx" ON "quotation_processes"("organization_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_processes_project_id_number_key" ON "quotation_processes"("project_id", "number");

-- CreateIndex
CREATE INDEX "quotation_invitations_supplier_id_status_idx" ON "quotation_invitations"("supplier_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_invitations_quotation_process_id_supplier_id_key" ON "quotation_invitations"("quotation_process_id", "supplier_id");

-- CreateIndex
CREATE INDEX "supplier_proposals_quotation_process_id_status_idx" ON "supplier_proposals"("quotation_process_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_proposals_quotation_process_id_supplier_id_version_key" ON "supplier_proposals"("quotation_process_id", "supplier_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_proposals_quotation_process_id_checksum_key" ON "supplier_proposals"("quotation_process_id", "checksum");

-- CreateIndex
CREATE INDEX "supplier_proposal_items_requisition_item_id_idx" ON "supplier_proposal_items"("requisition_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_proposal_items_proposal_id_requisition_item_id_key" ON "supplier_proposal_items"("proposal_id", "requisition_item_id");

-- CreateIndex
CREATE INDEX "proposal_comparison_findings_proposal_id_blocks_comparison_idx" ON "proposal_comparison_findings"("proposal_id", "blocks_comparison");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_decisions_quotation_process_id_key" ON "procurement_decisions"("quotation_process_id");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_decisions_selected_proposal_id_key" ON "procurement_decisions"("selected_proposal_id");

-- CreateIndex
CREATE INDEX "validated_savings_decision_id_classification_idx" ON "validated_savings"("decision_id", "classification");

-- CreateIndex
CREATE INDEX "validated_savings_economic_item_id_idx" ON "validated_savings"("economic_item_id");

-- CreateIndex
CREATE INDEX "approval_policies_organization_id_act_type_is_active_idx" ON "approval_policies"("organization_id", "act_type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "approval_policies_organization_id_name_version_key" ON "approval_policies"("organization_id", "name", "version");

-- CreateIndex
CREATE INDEX "approval_requests_organization_id_status_act_type_idx" ON "approval_requests"("organization_id", "status", "act_type");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_organization_id_entity_type_entity_id_ent_key" ON "approval_requests"("organization_id", "entity_type", "entity_id", "entity_version", "act_type");

-- CreateIndex
CREATE UNIQUE INDEX "approval_decision_records_approval_request_id_decided_by_id_key" ON "approval_decision_records"("approval_request_id", "decided_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_superseded_by_contract_id_key" ON "purchase_orders"("superseded_by_contract_id");

-- CreateIndex
CREATE INDEX "purchase_orders_organization_id_project_id_status_idx" ON "purchase_orders"("organization_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_id_status_idx" ON "purchase_orders"("supplier_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_project_id_number_key" ON "purchase_orders"("project_id", "number");

-- CreateIndex
CREATE INDEX "purchase_order_items_purchase_order_id_idx" ON "purchase_order_items"("purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_order_items_economic_item_id_idx" ON "purchase_order_items"("economic_item_id");

-- CreateIndex
CREATE INDEX "operational_contracts_organization_id_project_id_status_idx" ON "operational_contracts"("organization_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "operational_contracts_supplier_id_status_idx" ON "operational_contracts"("supplier_id", "status");

-- CreateIndex
CREATE INDEX "operational_contracts_ends_at_status_idx" ON "operational_contracts"("ends_at", "status");

-- CreateIndex
CREATE UNIQUE INDEX "operational_contracts_project_id_number_key" ON "operational_contracts"("project_id", "number");

-- CreateIndex
CREATE INDEX "operational_contract_items_economic_item_id_idx" ON "operational_contract_items"("economic_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "operational_contract_items_contract_id_code_key" ON "operational_contract_items"("contract_id", "code");

-- CreateIndex
CREATE INDEX "contract_amendments_contract_id_status_idx" ON "contract_amendments"("contract_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contract_amendments_contract_id_number_key" ON "contract_amendments"("contract_id", "number");

-- CreateIndex
CREATE INDEX "contract_advances_contract_id_status_idx" ON "contract_advances"("contract_id", "status");

-- CreateIndex
CREATE INDEX "measurement_certificates_organization_id_project_id_status_idx" ON "measurement_certificates"("organization_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "measurement_certificates_contract_id_competence_date_idx" ON "measurement_certificates"("contract_id", "competence_date");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_certificates_contract_id_number_version_key" ON "measurement_certificates"("contract_id", "number", "version");

-- CreateIndex
CREATE INDEX "measurement_lines_contract_item_id_idx" ON "measurement_lines"("contract_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_lines_measurement_id_contract_item_id_key" ON "measurement_lines"("measurement_id", "contract_item_id");

-- CreateIndex
CREATE INDEX "measurement_adjustments_measurement_id_type_idx" ON "measurement_adjustments"("measurement_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "advance_amortizations_advance_id_measurement_id_key" ON "advance_amortizations"("advance_id", "measurement_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_integration_events_financial_obligation_id_key" ON "financial_integration_events"("financial_obligation_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_integration_events_payable_account_id_key" ON "financial_integration_events"("payable_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_integration_events_event_id_key" ON "financial_integration_events"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_integration_events_idempotency_key_key" ON "financial_integration_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "financial_integration_events_organization_id_status_created_idx" ON "financial_integration_events"("organization_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "financial_integration_events_organization_id_source_type_so_key" ON "financial_integration_events"("organization_id", "source_type", "source_id", "source_version", "event_type");

-- CreateIndex
CREATE INDEX "procurement_document_links_organization_id_entity_type_enti_idx" ON "procurement_document_links"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_document_links_organization_id_entity_type_enti_key" ON "procurement_document_links"("organization_id", "entity_type", "entity_id", "document_type", "version");

-- AddForeignKey
ALTER TABLE "supplier_qualifications" ADD CONSTRAINT "supplier_qualifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_qualifications" ADD CONSTRAINT "supplier_qualifications_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_needs" ADD CONSTRAINT "procurement_needs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_needs" ADD CONSTRAINT "procurement_needs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_needs" ADD CONSTRAINT "procurement_needs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_needs" ADD CONSTRAINT "procurement_needs_operating_unit_id_fkey" FOREIGN KEY ("operating_unit_id") REFERENCES "project_operating_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_needs" ADD CONSTRAINT "procurement_needs_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_needs" ADD CONSTRAINT "procurement_needs_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_needs" ADD CONSTRAINT "procurement_needs_budget_line_item_id_fkey" FOREIGN KEY ("budget_line_item_id") REFERENCES "budget_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_needs" ADD CONSTRAINT "procurement_needs_schedule_activity_id_fkey" FOREIGN KEY ("schedule_activity_id") REFERENCES "schedule_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_need_id_fkey" FOREIGN KEY ("need_id") REFERENCES "procurement_needs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_budget_line_item_id_fkey" FOREIGN KEY ("budget_line_item_id") REFERENCES "budget_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_specifications" ADD CONSTRAINT "procurement_specifications_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_processes" ADD CONSTRAINT "quotation_processes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_processes" ADD CONSTRAINT "quotation_processes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_processes" ADD CONSTRAINT "quotation_processes_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_processes" ADD CONSTRAINT "quotation_processes_specification_id_fkey" FOREIGN KEY ("specification_id") REFERENCES "procurement_specifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_invitations" ADD CONSTRAINT "quotation_invitations_quotation_process_id_fkey" FOREIGN KEY ("quotation_process_id") REFERENCES "quotation_processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_invitations" ADD CONSTRAINT "quotation_invitations_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_proposals" ADD CONSTRAINT "supplier_proposals_quotation_process_id_fkey" FOREIGN KEY ("quotation_process_id") REFERENCES "quotation_processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_proposals" ADD CONSTRAINT "supplier_proposals_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_proposals" ADD CONSTRAINT "supplier_proposals_previous_proposal_id_fkey" FOREIGN KEY ("previous_proposal_id") REFERENCES "supplier_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_proposal_items" ADD CONSTRAINT "supplier_proposal_items_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "supplier_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_proposal_items" ADD CONSTRAINT "supplier_proposal_items_requisition_item_id_fkey" FOREIGN KEY ("requisition_item_id") REFERENCES "purchase_requisition_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_comparison_findings" ADD CONSTRAINT "proposal_comparison_findings_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "supplier_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_comparison_findings" ADD CONSTRAINT "proposal_comparison_findings_proposal_item_id_fkey" FOREIGN KEY ("proposal_item_id") REFERENCES "supplier_proposal_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_decisions" ADD CONSTRAINT "procurement_decisions_quotation_process_id_fkey" FOREIGN KEY ("quotation_process_id") REFERENCES "quotation_processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_decisions" ADD CONSTRAINT "procurement_decisions_selected_proposal_id_fkey" FOREIGN KEY ("selected_proposal_id") REFERENCES "supplier_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validated_savings" ADD CONSTRAINT "validated_savings_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "procurement_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validated_savings" ADD CONSTRAINT "validated_savings_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "approval_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decision_records" ADD CONSTRAINT "approval_decision_records_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_quotation_process_id_fkey" FOREIGN KEY ("quotation_process_id") REFERENCES "quotation_processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_selected_proposal_id_fkey" FOREIGN KEY ("selected_proposal_id") REFERENCES "supplier_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_superseded_by_contract_id_fkey" FOREIGN KEY ("superseded_by_contract_id") REFERENCES "operational_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_budget_line_item_id_fkey" FOREIGN KEY ("budget_line_item_id") REFERENCES "budget_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_operating_unit_id_fkey" FOREIGN KEY ("operating_unit_id") REFERENCES "project_operating_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_schedule_activity_id_fkey" FOREIGN KEY ("schedule_activity_id") REFERENCES "schedule_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_contracts" ADD CONSTRAINT "operational_contracts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_contracts" ADD CONSTRAINT "operational_contracts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_contracts" ADD CONSTRAINT "operational_contracts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_contracts" ADD CONSTRAINT "operational_contracts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_contracts" ADD CONSTRAINT "operational_contracts_quotation_process_id_fkey" FOREIGN KEY ("quotation_process_id") REFERENCES "quotation_processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_contracts" ADD CONSTRAINT "operational_contracts_selected_proposal_id_fkey" FOREIGN KEY ("selected_proposal_id") REFERENCES "supplier_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_contracts" ADD CONSTRAINT "operational_contracts_readjustment_rule_id_fkey" FOREIGN KEY ("readjustment_rule_id") REFERENCES "correction_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_contract_items" ADD CONSTRAINT "operational_contract_items_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "operational_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_contract_items" ADD CONSTRAINT "operational_contract_items_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_contract_items" ADD CONSTRAINT "operational_contract_items_budget_line_item_id_fkey" FOREIGN KEY ("budget_line_item_id") REFERENCES "budget_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_contract_items" ADD CONSTRAINT "operational_contract_items_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_contract_items" ADD CONSTRAINT "operational_contract_items_operating_unit_id_fkey" FOREIGN KEY ("operating_unit_id") REFERENCES "project_operating_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_contract_items" ADD CONSTRAINT "operational_contract_items_schedule_activity_id_fkey" FOREIGN KEY ("schedule_activity_id") REFERENCES "schedule_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "operational_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_advances" ADD CONSTRAINT "contract_advances_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "operational_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_certificates" ADD CONSTRAINT "measurement_certificates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_certificates" ADD CONSTRAINT "measurement_certificates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_certificates" ADD CONSTRAINT "measurement_certificates_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "operational_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_lines" ADD CONSTRAINT "measurement_lines_measurement_id_fkey" FOREIGN KEY ("measurement_id") REFERENCES "measurement_certificates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_lines" ADD CONSTRAINT "measurement_lines_contract_item_id_fkey" FOREIGN KEY ("contract_item_id") REFERENCES "operational_contract_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_lines" ADD CONSTRAINT "measurement_lines_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_lines" ADD CONSTRAINT "measurement_lines_budget_line_item_id_fkey" FOREIGN KEY ("budget_line_item_id") REFERENCES "budget_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_lines" ADD CONSTRAINT "measurement_lines_schedule_activity_id_fkey" FOREIGN KEY ("schedule_activity_id") REFERENCES "schedule_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_lines" ADD CONSTRAINT "measurement_lines_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_adjustments" ADD CONSTRAINT "measurement_adjustments_measurement_id_fkey" FOREIGN KEY ("measurement_id") REFERENCES "measurement_certificates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_amortizations" ADD CONSTRAINT "advance_amortizations_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "contract_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_amortizations" ADD CONSTRAINT "advance_amortizations_measurement_id_fkey" FOREIGN KEY ("measurement_id") REFERENCES "measurement_certificates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_integration_events" ADD CONSTRAINT "financial_integration_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_integration_events" ADD CONSTRAINT "financial_integration_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_integration_events" ADD CONSTRAINT "financial_integration_events_measurement_id_fkey" FOREIGN KEY ("measurement_id") REFERENCES "measurement_certificates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_integration_events" ADD CONSTRAINT "financial_integration_events_financial_obligation_id_fkey" FOREIGN KEY ("financial_obligation_id") REFERENCES "financial_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_integration_events" ADD CONSTRAINT "financial_integration_events_payable_account_id_fkey" FOREIGN KEY ("payable_account_id") REFERENCES "payable_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_document_links" ADD CONSTRAINT "procurement_document_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
