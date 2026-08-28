-- Fase 9M — Engenharia, Parecer Técnico e Orçamento Inteligente.
-- PROPOSTA FINAL PARA REVISÃO — NÃO EXECUTADA.
-- Esta migration é aditiva, exceto pelo aumento de escala dos custos unitários
-- de DECIMAL(20,2) para DECIMAL(20,4) e pela substituição de FKs simples por
-- FKs compostas que impedem referências entre organizações/empreendimentos.

-- CreateEnum
CREATE TYPE "EngineeringOpinionStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'VALIDATED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "EngineeringOpinionItemStatus" AS ENUM ('PENDING', 'VALIDATED', 'REJECTED', 'REVISION_REQUESTED');

-- CreateEnum
CREATE TYPE "EngineeringOpinionTopic" AS ENUM ('TOPOGRAPHY', 'SOIL_INVESTIGATION', 'SOIL', 'FOUNDATIONS', 'RETAINING_STRUCTURES', 'DRAINAGE', 'STRUCTURE', 'WATERPROOFING', 'INSTALLATIONS', 'CONSTRUCTION_LOGISTICS', 'ACCESS', 'NEIGHBORS', 'INTERFERENCES', 'SAFETY', 'CONSTRUCTION_METHOD', 'SCHEDULE_RISK', 'COST_RISK', 'OTHER');

-- CreateEnum
CREATE TYPE "AutoBudgetLineReviewDecision" AS ENUM ('ACCEPTED', 'ADJUSTED', 'REJECTED', 'REVISION_REQUESTED');

-- CreateEnum
CREATE TYPE "CostEvidenceStatus" AS ENUM ('VALIDATED_PRICE', 'COMPARABLE_HISTORICAL_PRICE', 'ESTIMATED_PRICE', 'NO_EVIDENCE');

-- Compound candidate keys used by tenant-safe foreign keys.
CREATE UNIQUE INDEX "projects_organization_id_id_key" ON "projects"("organization_id", "id");
CREATE UNIQUE INDEX "budgets_organization_project_id_key" ON "budgets"("organization_id", "project_id", "id");
CREATE UNIQUE INDEX "economic_items_organization_project_id_key" ON "economic_items"("organization_id", "project_id", "id");
CREATE UNIQUE INDEX "design_findings_organization_project_id_key" ON "design_findings"("organization_id", "project_id", "id");
CREATE UNIQUE INDEX "external_price_observations_org_id_key" ON "external_price_observations"("organization_id", "id");
CREATE UNIQUE INDEX "comparability_policies_org_id_key" ON "comparability_policies"("organization_id", "id");
CREATE UNIQUE INDEX "bim_quantity_mappings_org_project_id_key" ON "bim_quantity_mappings"("organization_id", "project_id", "id");
CREATE UNIQUE INDEX "cost_composition_definitions_org_id_key" ON "cost_composition_definitions"("organization_id", "id");

-- ExtendTable: lineage, idempotency, technical origin and Budget 9A destination.
ALTER TABLE "auto_budget_proposals"
    ADD COLUMN "series_key" TEXT,
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "technical_opinion_id" TEXT,
    ADD COLUMN "source_budget_id" TEXT,
    ADD COLUMN "approved_budget_id" TEXT,
    ADD COLUMN "base_date" DATE,
    ADD COLUMN "input_checksum" TEXT;

-- Preserve any lineage already represented by previous_proposal_id.
WITH RECURSIVE proposal_lineage AS (
    SELECT p."id", p."id" AS "series_key", 1 AS "version"
      FROM "auto_budget_proposals" p
     WHERE p."previous_proposal_id" IS NULL
    UNION ALL
    SELECT child."id", parent."series_key", parent."version" + 1
      FROM "auto_budget_proposals" child
      JOIN proposal_lineage parent
        ON child."previous_proposal_id" = parent."id"
)
UPDATE "auto_budget_proposals" target
   SET "series_key" = lineage."series_key",
       "version" = lineage."version"
  FROM proposal_lineage lineage
 WHERE target."id" = lineage."id";

-- Cyclic/orphaned legacy rows remain isolated and will fail explicit lineage
-- validation in the application before a new version can reference them.
UPDATE "auto_budget_proposals"
   SET "series_key" = "id"
 WHERE "series_key" IS NULL;

ALTER TABLE "auto_budget_proposals"
    ALTER COLUMN "series_key" SET NOT NULL;

ALTER TABLE "auto_budget_proposals"
    ADD CONSTRAINT "auto_budget_proposals_version_check" CHECK ("version" > 0),
    ADD CONSTRAINT "auto_budget_proposals_approval_audit_check"
      CHECK (
        "status" <> 'APPROVED'
        OR (
          "approved_by_id" IS NOT NULL
          AND "approved_at" IS NOT NULL
          AND "approved_budget_id" IS NOT NULL
        )
      ) NOT VALID;

-- ExtendTable: economic inputs and frozen provenance per proposed line.
ALTER TABLE "auto_budget_proposal_lines"
    ADD COLUMN "organization_id" TEXT,
    ADD COLUMN "project_id" TEXT,
    ADD COLUMN "bim_quantity_mapping_id" TEXT,
    ADD COLUMN "composition_id" TEXT,
    ADD COLUMN "price_observation_id" TEXT,
    ADD COLUMN "evidence_status" "CostEvidenceStatus" NOT NULL DEFAULT 'NO_EVIDENCE',
    ADD COLUMN "evidence_required" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "price_base_date" DATE,
    ADD COLUMN "source_snapshot" JSONB,
    ADD COLUMN "input_checksum" TEXT,
    ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "updated_at" TIMESTAMP(3);

UPDATE "auto_budget_proposal_lines" line
   SET "organization_id" = proposal."organization_id",
       "project_id" = proposal."project_id",
       "updated_at" = CURRENT_TIMESTAMP
  FROM "auto_budget_proposals" proposal
 WHERE line."proposal_id" = proposal."id";

ALTER TABLE "auto_budget_proposal_lines"
    ALTER COLUMN "organization_id" SET NOT NULL,
    ALTER COLUMN "project_id" SET NOT NULL,
    ALTER COLUMN "updated_at" SET NOT NULL,
    ALTER COLUMN "suggested_unit_cost" TYPE DECIMAL(20,4),
    ALTER COLUMN "reviewed_unit_cost" TYPE DECIMAL(20,4),
    ADD CONSTRAINT "auto_budget_lines_quantity_check" CHECK ("quantity" >= 0),
    ADD CONSTRAINT "auto_budget_lines_unit_cost_check" CHECK ("suggested_unit_cost" >= 0),
    ADD CONSTRAINT "auto_budget_lines_total_cost_check" CHECK ("suggested_total_cost" >= 0),
    ADD CONSTRAINT "auto_budget_lines_snapshot_object_check"
      CHECK ("source_snapshot" IS NULL OR jsonb_typeof("source_snapshot") = 'object');

-- CreateTable: formal, versioned engineering opinion.
CREATE TABLE "engineering_technical_opinions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "series_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "previous_opinion_id" TEXT,
    "design_revision_id" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" "EngineeringOpinionStatus" NOT NULL DEFAULT 'DRAFT',
    "checksum" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "submitted_by_id" TEXT,
    "submitted_at" TIMESTAMP(3),
    "validated_by_id" TEXT,
    "validated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engineering_technical_opinions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "engineering_opinions_version_check" CHECK ("version" > 0),
    CONSTRAINT "engineering_opinions_validation_audit_check" CHECK (
      "status" <> 'VALIDATED'
      OR ("validated_by_id" IS NOT NULL AND "validated_at" IS NOT NULL)
    )
);

-- CreateTable: deterministic technical topics and severity for Operation Live.
CREATE TABLE "engineering_technical_opinion_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "opinion_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "topic" "EngineeringOpinionTopic" NOT NULL,
    "observed_condition" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "severity" "DesignFindingSeverity" NOT NULL,
    "impact" JSONB NOT NULL,
    "recommendation" TEXT NOT NULL,
    "source_type" "DesignDataOrigin" NOT NULL,
    "confidence" "DesignConfidence" NOT NULL,
    "source_finding_id" TEXT,
    "technical_responsible_id" TEXT,
    "validation_status" "EngineeringOpinionItemStatus" NOT NULL DEFAULT 'PENDING',
    "validated_by_id" TEXT,
    "validated_at" TIMESTAMP(3),
    "reference_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engineering_technical_opinion_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "engineering_opinion_items_sequence_check" CHECK ("sequence" >= 0),
    CONSTRAINT "engineering_opinion_items_validation_audit_check" CHECK (
      "validation_status" <> 'VALIDATED'
      OR ("validated_by_id" IS NOT NULL AND "validated_at" IS NOT NULL)
    )
);

-- Lightweight reference/provenance only; no parallel file/document storage.
CREATE TABLE "engineering_technical_opinion_evidence" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT,
    "source_type" "DesignDataOrigin" NOT NULL,
    "confidence" "DesignConfidence" NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engineering_technical_opinion_evidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "engineering_opinion_evidence_reference_check" CHECK (length(btrim("reference")) > 0)
);

-- CreateTable: append-only human review preserving original and revised values.
CREATE TABLE "auto_budget_line_reviews" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "decision" "AutoBudgetLineReviewDecision" NOT NULL,
    "original_quantity" DECIMAL(18,4) NOT NULL,
    "revised_quantity" DECIMAL(18,4),
    "original_composition_id" TEXT,
    "revised_composition_id" TEXT,
    "original_unit_cost" DECIMAL(20,4) NOT NULL,
    "revised_unit_cost" DECIMAL(20,4),
    "justification" TEXT NOT NULL,
    "reviewed_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_budget_line_reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auto_budget_line_reviews_revision_check" CHECK ("revision_number" > 0),
    CONSTRAINT "auto_budget_line_reviews_original_quantity_check" CHECK ("original_quantity" >= 0),
    CONSTRAINT "auto_budget_line_reviews_revised_quantity_check" CHECK ("revised_quantity" IS NULL OR "revised_quantity" >= 0),
    CONSTRAINT "auto_budget_line_reviews_original_cost_check" CHECK ("original_unit_cost" >= 0),
    CONSTRAINT "auto_budget_line_reviews_revised_cost_check" CHECK ("revised_unit_cost" IS NULL OR "revised_unit_cost" >= 0),
    CONSTRAINT "auto_budget_line_reviews_justification_check" CHECK (length(btrim("justification")) > 0),
    CONSTRAINT "auto_budget_line_reviews_adjustment_check" CHECK (
      "decision" <> 'ADJUSTED'
      OR "revised_quantity" IS NOT NULL
      OR "revised_unit_cost" IS NOT NULL
      OR "revised_composition_id" IS DISTINCT FROM "original_composition_id"
    )
);

-- Lightweight evidence attached to an immutable review event.
CREATE TABLE "auto_budget_line_review_evidence" (
    "id" TEXT NOT NULL,
    "review_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT,
    "source_type" "DesignDataOrigin" NOT NULL,
    "confidence" "DesignConfidence" NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_budget_line_review_evidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auto_budget_review_evidence_reference_check" CHECK (length(btrim("reference")) > 0)
);

-- Unique constraints. Standard PostgreSQL UNIQUE semantics allow multiple NULL
-- checksums while DRAFT and enforce uniqueness once a checksum exists. This is
-- intentionally not a partial index, matching Prisma @@unique without drift.
CREATE UNIQUE INDEX "auto_budget_proposals_previous_proposal_id_key" ON "auto_budget_proposals"("previous_proposal_id");
CREATE UNIQUE INDEX "auto_budget_proposals_org_project_id_key" ON "auto_budget_proposals"("organization_id", "project_id", "id");
CREATE UNIQUE INDEX "auto_budget_proposals_series_version_key" ON "auto_budget_proposals"("organization_id", "project_id", "series_key", "version");
CREATE UNIQUE INDEX "auto_budget_proposals_input_checksum_key" ON "auto_budget_proposals"("organization_id", "project_id", "input_checksum");
CREATE UNIQUE INDEX "auto_budget_proposals_approved_budget_key" ON "auto_budget_proposals"("organization_id", "project_id", "approved_budget_id");
CREATE UNIQUE INDEX "auto_budget_lines_org_project_id_key" ON "auto_budget_proposal_lines"("organization_id", "project_id", "id");
CREATE UNIQUE INDEX "auto_budget_lines_proposal_checksum_key" ON "auto_budget_proposal_lines"("proposal_id", "input_checksum");
CREATE UNIQUE INDEX "engineering_opinions_previous_opinion_id_key" ON "engineering_technical_opinions"("previous_opinion_id");
CREATE UNIQUE INDEX "engineering_opinions_org_project_id_key" ON "engineering_technical_opinions"("organization_id", "project_id", "id");
CREATE UNIQUE INDEX "engineering_opinions_series_version_key" ON "engineering_technical_opinions"("organization_id", "project_id", "series_key", "version");
CREATE UNIQUE INDEX "engineering_opinions_checksum_key" ON "engineering_technical_opinions"("organization_id", "project_id", "checksum");
CREATE UNIQUE INDEX "engineering_opinion_items_org_project_id_key" ON "engineering_technical_opinion_items"("organization_id", "project_id", "id");
CREATE UNIQUE INDEX "engineering_opinion_items_sequence_key" ON "engineering_technical_opinion_items"("opinion_id", "sequence");
CREATE UNIQUE INDEX "engineering_opinion_evidence_reference_key" ON "engineering_technical_opinion_evidence"("item_id", "reference");
CREATE UNIQUE INDEX "auto_budget_line_reviews_revision_key" ON "auto_budget_line_reviews"("line_id", "revision_number");
CREATE UNIQUE INDEX "auto_budget_review_evidence_reference_key" ON "auto_budget_line_review_evidence"("review_id", "reference");

-- Read-path indexes.
CREATE INDEX "auto_budget_proposals_source_budget_idx" ON "auto_budget_proposals"("source_budget_id");
CREATE INDEX "auto_budget_proposals_technical_opinion_idx" ON "auto_budget_proposals"("technical_opinion_id");
CREATE INDEX "auto_budget_lines_proposal_sort_idx" ON "auto_budget_proposal_lines"("proposal_id", "sort_order");
CREATE INDEX "auto_budget_lines_org_project_evidence_idx" ON "auto_budget_proposal_lines"("organization_id", "project_id", "evidence_status");
CREATE INDEX "auto_budget_lines_economic_item_idx" ON "auto_budget_proposal_lines"("economic_item_id");
CREATE INDEX "auto_budget_lines_bim_quantity_idx" ON "auto_budget_proposal_lines"("bim_quantity_mapping_id");
CREATE INDEX "auto_budget_lines_composition_idx" ON "auto_budget_proposal_lines"("composition_id");
CREATE INDEX "engineering_opinions_org_project_status_idx" ON "engineering_technical_opinions"("organization_id", "project_id", "status");
CREATE INDEX "engineering_opinions_design_revision_idx" ON "engineering_technical_opinions"("design_revision_id");
CREATE INDEX "engineering_opinion_items_risk_status_idx" ON "engineering_technical_opinion_items"("organization_id", "project_id", "severity", "validation_status");
CREATE INDEX "engineering_opinion_items_responsible_idx" ON "engineering_technical_opinion_items"("technical_responsible_id", "validation_status");
CREATE INDEX "auto_budget_line_reviews_org_project_decision_idx" ON "auto_budget_line_reviews"("organization_id", "project_id", "decision");

-- Replace legacy simple FKs with tenant/project-safe composite FKs where the
-- referenced model exposes organization/project directly.
ALTER TABLE "auto_budget_proposals" DROP CONSTRAINT "auto_budget_proposals_project_id_fkey";
ALTER TABLE "auto_budget_proposals" DROP CONSTRAINT "auto_budget_proposals_policy_id_fkey";
ALTER TABLE "auto_budget_proposals" DROP CONSTRAINT "auto_budget_proposals_previous_proposal_id_fkey";
ALTER TABLE "auto_budget_proposal_lines" DROP CONSTRAINT "auto_budget_proposal_lines_proposal_id_fkey";
ALTER TABLE "auto_budget_proposal_lines" DROP CONSTRAINT "auto_budget_proposal_lines_economic_item_id_fkey";
ALTER TABLE "auto_budget_proposal_lines" DROP CONSTRAINT "auto_budget_proposal_lines_benchmark_run_id_fkey";

ALTER TABLE "auto_budget_proposals" ADD CONSTRAINT "auto_budget_proposals_project_tenant_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auto_budget_proposals" ADD CONSTRAINT "auto_budget_proposals_policy_tenant_fkey" FOREIGN KEY ("organization_id", "policy_id") REFERENCES "comparability_policies"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auto_budget_proposals" ADD CONSTRAINT "auto_budget_proposals_previous_tenant_fkey" FOREIGN KEY ("organization_id", "project_id", "previous_proposal_id") REFERENCES "auto_budget_proposals"("organization_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auto_budget_proposals" ADD CONSTRAINT "auto_budget_proposals_source_budget_tenant_fkey" FOREIGN KEY ("organization_id", "project_id", "source_budget_id") REFERENCES "budgets"("organization_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auto_budget_proposals" ADD CONSTRAINT "auto_budget_proposals_approved_budget_tenant_fkey" FOREIGN KEY ("organization_id", "project_id", "approved_budget_id") REFERENCES "budgets"("organization_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auto_budget_proposals" ADD CONSTRAINT "auto_budget_proposals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auto_budget_proposals" ADD CONSTRAINT "auto_budget_proposals_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auto_budget_proposals" ADD CONSTRAINT "auto_budget_proposals_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "auto_budget_proposal_lines" ADD CONSTRAINT "auto_budget_lines_proposal_tenant_fkey" FOREIGN KEY ("organization_id", "project_id", "proposal_id") REFERENCES "auto_budget_proposals"("organization_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auto_budget_proposal_lines" ADD CONSTRAINT "auto_budget_lines_economic_item_tenant_fkey" FOREIGN KEY ("organization_id", "project_id", "economic_item_id") REFERENCES "economic_items"("organization_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auto_budget_proposal_lines" ADD CONSTRAINT "auto_budget_lines_benchmark_run_id_fkey" FOREIGN KEY ("benchmark_run_id") REFERENCES "benchmark_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auto_budget_proposal_lines" ADD CONSTRAINT "auto_budget_lines_bim_quantity_tenant_fkey" FOREIGN KEY ("organization_id", "project_id", "bim_quantity_mapping_id") REFERENCES "bim_quantity_mappings"("organization_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auto_budget_proposal_lines" ADD CONSTRAINT "auto_budget_lines_composition_tenant_fkey" FOREIGN KEY ("organization_id", "composition_id") REFERENCES "cost_composition_definitions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auto_budget_proposal_lines" ADD CONSTRAINT "auto_budget_lines_price_observation_tenant_fkey" FOREIGN KEY ("organization_id", "price_observation_id") REFERENCES "external_price_observations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- New model FKs. RESTRICT preserves historical records across entities.
ALTER TABLE "engineering_technical_opinions" ADD CONSTRAINT "engineering_opinions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engineering_technical_opinions" ADD CONSTRAINT "engineering_opinions_project_tenant_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engineering_technical_opinions" ADD CONSTRAINT "engineering_opinions_previous_tenant_fkey" FOREIGN KEY ("organization_id", "project_id", "previous_opinion_id") REFERENCES "engineering_technical_opinions"("organization_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engineering_technical_opinions" ADD CONSTRAINT "engineering_opinions_design_revision_id_fkey" FOREIGN KEY ("design_revision_id") REFERENCES "design_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engineering_technical_opinions" ADD CONSTRAINT "engineering_opinions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engineering_technical_opinions" ADD CONSTRAINT "engineering_opinions_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engineering_technical_opinions" ADD CONSTRAINT "engineering_opinions_validated_by_id_fkey" FOREIGN KEY ("validated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "engineering_technical_opinion_items" ADD CONSTRAINT "engineering_opinion_items_opinion_tenant_fkey" FOREIGN KEY ("organization_id", "project_id", "opinion_id") REFERENCES "engineering_technical_opinions"("organization_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engineering_technical_opinion_items" ADD CONSTRAINT "engineering_opinion_items_finding_tenant_fkey" FOREIGN KEY ("organization_id", "project_id", "source_finding_id") REFERENCES "design_findings"("organization_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engineering_technical_opinion_items" ADD CONSTRAINT "engineering_opinion_items_responsible_id_fkey" FOREIGN KEY ("technical_responsible_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engineering_technical_opinion_items" ADD CONSTRAINT "engineering_opinion_items_validated_by_id_fkey" FOREIGN KEY ("validated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engineering_technical_opinion_evidence" ADD CONSTRAINT "engineering_opinion_evidence_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "engineering_technical_opinion_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "auto_budget_line_reviews" ADD CONSTRAINT "auto_budget_line_reviews_line_tenant_fkey" FOREIGN KEY ("organization_id", "project_id", "line_id") REFERENCES "auto_budget_proposal_lines"("organization_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auto_budget_line_reviews" ADD CONSTRAINT "auto_budget_line_reviews_original_composition_fkey" FOREIGN KEY ("organization_id", "original_composition_id") REFERENCES "cost_composition_definitions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auto_budget_line_reviews" ADD CONSTRAINT "auto_budget_line_reviews_revised_composition_fkey" FOREIGN KEY ("organization_id", "revised_composition_id") REFERENCES "cost_composition_definitions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auto_budget_line_reviews" ADD CONSTRAINT "auto_budget_line_reviews_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auto_budget_line_review_evidence" ADD CONSTRAINT "auto_budget_review_evidence_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "auto_budget_line_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "auto_budget_proposals" ADD CONSTRAINT "auto_budget_proposals_technical_opinion_tenant_fkey" FOREIGN KEY ("organization_id", "project_id", "technical_opinion_id") REFERENCES "engineering_technical_opinions"("organization_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Application validation remains mandatory where the legacy target cannot
-- expose a safe compound FK: DesignRevision -> package -> project and
-- BenchmarkRun.projectId (nullable). Integration tests must reject mismatches.

-- Immutability follows the existing snapshot pattern: services reject first;
-- these triggers are the database backstop.
CREATE OR REPLACE FUNCTION protect_validated_engineering_opinion()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'VALIDATED' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'validated engineering opinion is immutable; create a new version';
    END IF;
    IF NEW."status" NOT IN ('VALIDATED', 'SUPERSEDED')
       OR (to_jsonb(NEW) - ARRAY['status', 'updated_at']) IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['status', 'updated_at']) THEN
      RAISE EXCEPTION 'validated engineering opinion is immutable; create a new version';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "engineering_opinions_immutable"
BEFORE UPDATE OR DELETE ON "engineering_technical_opinions"
FOR EACH ROW EXECUTE FUNCTION protect_validated_engineering_opinion();

CREATE OR REPLACE FUNCTION protect_validated_engineering_opinion_child()
RETURNS trigger AS $$
DECLARE
  parent_status "EngineeringOpinionStatus";
  parent_id TEXT;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."opinion_id" ELSE NEW."opinion_id" END;
  SELECT "status" INTO parent_status
    FROM "engineering_technical_opinions"
   WHERE "id" = parent_id;
  IF parent_status IN ('VALIDATED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'validated engineering opinion items are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "engineering_opinion_items_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "engineering_technical_opinion_items"
FOR EACH ROW EXECUTE FUNCTION protect_validated_engineering_opinion_child();

CREATE OR REPLACE FUNCTION protect_engineering_opinion_evidence()
RETURNS trigger AS $$
DECLARE
  parent_status "EngineeringOpinionStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'engineering opinion evidence is append-only';
  END IF;
  SELECT opinion."status" INTO parent_status
    FROM "engineering_technical_opinion_items" item
    JOIN "engineering_technical_opinions" opinion ON opinion."id" = item."opinion_id"
   WHERE item."id" = NEW."item_id";
  IF parent_status IN ('VALIDATED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'validated engineering opinion evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "engineering_opinion_evidence_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "engineering_technical_opinion_evidence"
FOR EACH ROW EXECUTE FUNCTION protect_engineering_opinion_evidence();

CREATE OR REPLACE FUNCTION protect_approved_auto_budget_proposal()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'APPROVED' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'approved auto budget proposal is immutable; create a new version';
    END IF;
    IF NEW."status" NOT IN ('APPROVED', 'SUPERSEDED')
       OR (to_jsonb(NEW) - ARRAY['status', 'updated_at']) IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['status', 'updated_at']) THEN
      RAISE EXCEPTION 'approved auto budget proposal is immutable; create a new version';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "auto_budget_proposals_immutable"
BEFORE UPDATE OR DELETE ON "auto_budget_proposals"
FOR EACH ROW EXECUTE FUNCTION protect_approved_auto_budget_proposal();

CREATE OR REPLACE FUNCTION protect_approved_auto_budget_line()
RETURNS trigger AS $$
DECLARE
  parent_status "AutoBudgetProposalStatus";
  parent_id TEXT;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."proposal_id" ELSE NEW."proposal_id" END;
  SELECT "status" INTO parent_status
    FROM "auto_budget_proposals"
   WHERE "id" = parent_id;
  IF parent_status IN ('APPROVED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'approved auto budget lines are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "auto_budget_lines_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "auto_budget_proposal_lines"
FOR EACH ROW EXECUTE FUNCTION protect_approved_auto_budget_line();

CREATE OR REPLACE FUNCTION protect_auto_budget_line_review()
RETURNS trigger AS $$
DECLARE
  parent_status "AutoBudgetProposalStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'auto budget line reviews are append-only';
  END IF;
  SELECT proposal."status" INTO parent_status
    FROM "auto_budget_proposal_lines" line
    JOIN "auto_budget_proposals" proposal ON proposal."id" = line."proposal_id"
   WHERE line."id" = NEW."line_id";
  IF parent_status IN ('APPROVED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'approved auto budget reviews are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "auto_budget_line_reviews_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "auto_budget_line_reviews"
FOR EACH ROW EXECUTE FUNCTION protect_auto_budget_line_review();

CREATE OR REPLACE FUNCTION protect_auto_budget_review_evidence()
RETURNS trigger AS $$
DECLARE
  parent_status "AutoBudgetProposalStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'auto budget review evidence is append-only';
  END IF;
  SELECT proposal."status" INTO parent_status
    FROM "auto_budget_line_reviews" review
    JOIN "auto_budget_proposal_lines" line ON line."id" = review."line_id"
    JOIN "auto_budget_proposals" proposal ON proposal."id" = line."proposal_id"
   WHERE review."id" = NEW."review_id";
  IF parent_status IN ('APPROVED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'approved auto budget evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "auto_budget_review_evidence_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "auto_budget_line_review_evidence"
FOR EACH ROW EXECUTE FUNCTION protect_auto_budget_review_evidence();

-- Approval gates that span proposal lines/review history remain in the 9M
-- application service transaction: no pending/rejected/revision-requested
-- latest review, no mandatory NO_EVIDENCE, and source_snapshot required for
-- every approved line. Approval creates a new Budget 9A version and never
-- writes OperationalBaseline.
