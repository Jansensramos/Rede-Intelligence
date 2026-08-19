-- Structured assumptions, scenario deltas, policies and DRAFT -> SNAPSHOT lifecycle.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssumptionCategory') THEN
    CREATE TYPE "AssumptionCategory" AS ENUM (
      'IDENTIFICATION', 'PRODUCT', 'LAND', 'REVENUE', 'COST', 'TAX',
      'SALES', 'FUNDING', 'TIMELINE', 'POLICY', 'OTHER'
    );
  END IF;
END $migration$;

-- Replace the original LOCKED-only enum while preserving published records.
-- The conditional also makes recovery safe if the enum conversion committed
-- before a later statement failed.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'StudyVersionStatus' AND e.enumlabel = 'LOCKED'
  ) THEN
    EXECUTE 'CREATE TYPE "StudyVersionStatus_new" AS ENUM (''DRAFT'', ''SNAPSHOT'')';
    EXECUTE 'ALTER TABLE "study_versions" ALTER COLUMN "status" DROP DEFAULT';
    EXECUTE 'ALTER TABLE "study_versions" ALTER COLUMN "status" TYPE "StudyVersionStatus_new" USING (CASE WHEN "status"::text = ''LOCKED'' THEN ''SNAPSHOT'' ELSE ''DRAFT'' END)::"StudyVersionStatus_new"';
    EXECUTE 'ALTER TYPE "StudyVersionStatus" RENAME TO "StudyVersionStatus_old"';
    EXECUTE 'ALTER TYPE "StudyVersionStatus_new" RENAME TO "StudyVersionStatus"';
    EXECUTE 'DROP TYPE "StudyVersionStatus_old"';
  END IF;
END $migration$;
ALTER TABLE "study_versions" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- Update legacy guards before any backfill touches snapshot artifacts.
CREATE OR REPLACE FUNCTION prevent_study_version_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'SNAPSHOT' THEN
    RAISE EXCEPTION 'study snapshots are immutable; create a new version instead';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_locked_version_artifact_mutation()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "study_versions" WHERE "id" = OLD."study_version_id" AND "status" = 'SNAPSHOT') THEN
    RAISE EXCEPTION 'snapshot study version artifacts are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_locked_run_artifact_mutation()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "calculation_runs" cr
    JOIN "study_versions" sv ON sv."id" = cr."study_version_id"
    WHERE cr."id" = OLD."calculation_run_id" AND sv."status" = 'SNAPSHOT'
  ) THEN
    RAISE EXCEPTION 'snapshot calculation artifacts are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE "investment_policies" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "minimum_margin_rate" DECIMAL(9,6),
  "minimum_roi_rate" DECIMAL(9,6),
  "minimum_irr_rate" DECIMAL(9,6),
  "maximum_exposure" DECIMAL(20,2),
  "maximum_payback_months" INTEGER,
  "minimum_pre_sales_rate" DECIMAL(9,6),
  "created_by_id" TEXT NOT NULL,
  "updated_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "investment_policies_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "study_versions"
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "policy_id" TEXT,
  ALTER COLUMN "locked_at" DROP NOT NULL,
  ALTER COLUMN "locked_at" DROP DEFAULT;

CREATE TABLE "assumption_entries" (
  "id" TEXT NOT NULL,
  "assumption_snapshot_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "category" "AssumptionCategory" NOT NULL,
  "value" JSONB NOT NULL,
  "unit" TEXT NOT NULL,
  "source" TEXT,
  "notes" TEXT,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assumption_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "scenario_assumption_overrides" (
  "id" TEXT NOT NULL,
  "scenario_id" TEXT NOT NULL,
  "assumption_key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "unit" TEXT NOT NULL,
  "source" TEXT,
  "notes" TEXT,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scenario_assumption_overrides_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "calculated_metrics" (
  "id" TEXT NOT NULL,
  "calculation_run_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "unit" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "calculated_metrics_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "financial_results" ADD COLUMN "funding_need" DECIMAL(20,2);
ALTER TABLE "financial_results" DISABLE TRIGGER "financial_results_immutable";
UPDATE "financial_results" fr
SET "funding_need" = COALESCE((
  SELECT SUM(cfe."financing_draw")
  FROM "cash_flow_entries" cfe
  WHERE cfe."calculation_run_id" = fr."calculation_run_id"
), 0);
ALTER TABLE "financial_results" ENABLE TRIGGER "financial_results_immutable";
ALTER TABLE "financial_results" ALTER COLUMN "funding_need" SET NOT NULL;

ALTER TABLE "risk_findings" RENAME COLUMN "rule_id" TO "code";
ALTER TABLE "risk_findings"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "metric" TEXT,
  ADD COLUMN "actual_value" DECIMAL(20,8),
  ADD COLUMN "threshold_value" DECIMAL(20,8),
  ADD COLUMN "scenario_id" TEXT;

ALTER TABLE "risk_findings" DISABLE TRIGGER "risk_findings_immutable";
UPDATE "risk_findings" rf
SET
  "description" = rf."evidence",
  "scenario_id" = cr."scenario_id"
FROM "calculation_runs" cr
WHERE cr."id" = rf."calculation_run_id";
ALTER TABLE "risk_findings" ENABLE TRIGGER "risk_findings_immutable";

ALTER TABLE "risk_findings"
  ALTER COLUMN "description" SET NOT NULL,
  ALTER COLUMN "scenario_id" SET NOT NULL;

CREATE INDEX "investment_policies_organization_id_is_active_idx" ON "investment_policies"("organization_id", "is_active");
CREATE UNIQUE INDEX "investment_policies_organization_id_name_version_key" ON "investment_policies"("organization_id", "name", "version");
CREATE INDEX "assumption_entries_category_key_idx" ON "assumption_entries"("category", "key");
CREATE UNIQUE INDEX "assumption_entries_assumption_snapshot_id_key_key" ON "assumption_entries"("assumption_snapshot_id", "key");
CREATE UNIQUE INDEX "scenario_assumption_overrides_scenario_id_assumption_key_key" ON "scenario_assumption_overrides"("scenario_id", "assumption_key");
CREATE UNIQUE INDEX "calculated_metrics_calculation_run_id_key_key" ON "calculated_metrics"("calculation_run_id", "key");
CREATE INDEX "calculated_metrics_key_category_idx" ON "calculated_metrics"("key", "category");
CREATE INDEX "risk_findings_scenario_id_code_idx" ON "risk_findings"("scenario_id", "code");

ALTER TABLE "investment_policies" ADD CONSTRAINT "investment_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "investment_policies" ADD CONSTRAINT "investment_policies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "investment_policies" ADD CONSTRAINT "investment_policies_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "study_versions" ADD CONSTRAINT "study_versions_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "investment_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assumption_entries" ADD CONSTRAINT "assumption_entries_assumption_snapshot_id_fkey" FOREIGN KEY ("assumption_snapshot_id") REFERENCES "assumption_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assumption_entries" ADD CONSTRAINT "assumption_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scenario_assumption_overrides" ADD CONSTRAINT "scenario_assumption_overrides_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "scenarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scenario_assumption_overrides" ADD CONSTRAINT "scenario_assumption_overrides_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calculated_metrics" ADD CONSTRAINT "calculated_metrics_calculation_run_id_fkey" FOREIGN KEY ("calculation_run_id") REFERENCES "calculation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "risk_findings" ADD CONSTRAINT "risk_findings_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "scenarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Published snapshots are immutable; DRAFT may transition to SNAPSHOT once.
CREATE OR REPLACE FUNCTION prevent_study_version_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'SNAPSHOT' THEN
    RAISE EXCEPTION 'study snapshots are immutable; create a new version instead';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_locked_version_artifact_mutation()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "study_versions"
    WHERE "id" = OLD."study_version_id" AND "status" = 'SNAPSHOT'
  ) THEN
    RAISE EXCEPTION 'snapshot study version artifacts are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_locked_run_artifact_mutation()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "calculation_runs" cr
    JOIN "study_versions" sv ON sv."id" = cr."study_version_id"
    WHERE cr."id" = OLD."calculation_run_id" AND sv."status" = 'SNAPSHOT'
  ) THEN
    RAISE EXCEPTION 'snapshot calculation artifacts are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_snapshot_assumption_entry_mutation()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "assumption_snapshots" a
    JOIN "study_versions" sv ON sv."id" = a."study_version_id"
    WHERE a."id" = OLD."assumption_snapshot_id" AND sv."status" = 'SNAPSHOT'
  ) THEN
    RAISE EXCEPTION 'snapshot assumption entries are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_snapshot_scenario_override_mutation()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "scenarios" s
    JOIN "study_versions" sv ON sv."id" = s."study_version_id"
    WHERE s."id" = OLD."scenario_id" AND sv."status" = 'SNAPSHOT'
  ) THEN
    RAISE EXCEPTION 'snapshot scenario overrides are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assumption_entries_immutable BEFORE UPDATE OR DELETE ON "assumption_entries" FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_assumption_entry_mutation();
CREATE TRIGGER scenario_assumption_overrides_immutable BEFORE UPDATE OR DELETE ON "scenario_assumption_overrides" FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_scenario_override_mutation();
CREATE TRIGGER calculated_metrics_immutable BEFORE UPDATE OR DELETE ON "calculated_metrics" FOR EACH ROW EXECUTE FUNCTION prevent_locked_run_artifact_mutation();

-- A policy version may be deactivated, but its thresholds cannot be rewritten.
CREATE OR REPLACE FUNCTION prevent_investment_policy_definition_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD."organization_id" IS DISTINCT FROM NEW."organization_id"
    OR OLD."name" IS DISTINCT FROM NEW."name"
    OR OLD."version" IS DISTINCT FROM NEW."version"
    OR OLD."minimum_margin_rate" IS DISTINCT FROM NEW."minimum_margin_rate"
    OR OLD."minimum_roi_rate" IS DISTINCT FROM NEW."minimum_roi_rate"
    OR OLD."minimum_irr_rate" IS DISTINCT FROM NEW."minimum_irr_rate"
    OR OLD."maximum_exposure" IS DISTINCT FROM NEW."maximum_exposure"
    OR OLD."maximum_payback_months" IS DISTINCT FROM NEW."maximum_payback_months"
    OR OLD."minimum_pre_sales_rate" IS DISTINCT FROM NEW."minimum_pre_sales_rate" THEN
    RAISE EXCEPTION 'investment policy versions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER investment_policy_definition_immutable BEFORE UPDATE ON "investment_policies" FOR EACH ROW EXECUTE FUNCTION prevent_investment_policy_definition_mutation();
