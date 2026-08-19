CREATE TYPE "LandVersionStatus" AS ENUM ('DRAFT', 'SNAPSHOT');
CREATE TYPE "LandAnalysisStatus" AS ENUM ('PRELIMINARY', 'PARTIALLY_VERIFIED', 'VERIFIED_INPUTS', 'ARCHITECT_REVIEWED', 'SUPERSEDED');
CREATE TYPE "UrbanScenarioType" AS ENUM ('CURRENT_LEGAL', 'CONSERVATIVE_CHANGE', 'PROPOSED', 'TARGET', 'OPTIMIZED', 'MAXIMUM_POTENTIAL', 'CUSTOM');
CREATE TYPE "UrbanSourceType" AS ENUM ('OFFICIAL_API', 'OFFICIAL_MAP', 'OFFICIAL_LAW', 'OFFICIAL_DOCUMENT', 'USER_DOCUMENT', 'USER_INPUT', 'DERIVED', 'INFERRED');
CREATE TYPE "UrbanConfidence" AS ENUM ('CONFIRMED', 'HIGH', 'MEDIUM', 'LOW', 'MANUAL');
CREATE TYPE "UrbanRestrictionType" AS ENUM ('ROAD', 'ENVIRONMENTAL', 'WATERCOURSE', 'APP', 'EASEMENT', 'POWER_LINE', 'PIPELINE', 'HERITAGE', 'AVIATION', 'TOPOGRAPHY', 'GEOLOGICAL', 'FLOOD', 'MUNICIPAL', 'REGISTRY', 'OTHER');

CREATE TABLE "land_assets" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT,
  "name" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "neighborhood" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "state" CHAR(2) NOT NULL,
  "postal_code" TEXT NOT NULL,
  "latitude" DECIMAL(11,8) NOT NULL,
  "longitude" DECIMAL(11,8) NOT NULL,
  "cadastral_identifier" TEXT,
  "municipal_registration" TEXT,
  "area" DECIMAL(20,4) NOT NULL,
  "frontage" DECIMAL(20,4) NOT NULL,
  "polygon_geometry" JSONB NOT NULL,
  "source_ref" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "updated_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "land_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "land_studies" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "land_asset_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "current_version_number" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" TEXT NOT NULL,
  "updated_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "land_studies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "land_study_versions" (
  "id" TEXT NOT NULL,
  "land_study_id" TEXT NOT NULL,
  "version_number" INTEGER NOT NULL,
  "version_status" "LandVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "analysis_status" "LandAnalysisStatus" NOT NULL DEFAULT 'PRELIMINARY',
  "land_engine_version" TEXT NOT NULL,
  "zoning_solver_version" TEXT NOT NULL,
  "input_hash" TEXT NOT NULL,
  "selected_scenario_code" TEXT NOT NULL,
  "selected_option_code" TEXT NOT NULL,
  "regulatory_confidence" DECIMAL(5,2) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  CONSTRAINT "land_study_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "urban_sources" (
  "id" TEXT NOT NULL,
  "land_study_version_id" TEXT NOT NULL,
  "source_ref" TEXT NOT NULL,
  "type" "UrbanSourceType" NOT NULL,
  "authority" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "url" TEXT,
  "legislation" TEXT,
  "effective_date" DATE,
  "accessed_at" TIMESTAMP(3) NOT NULL,
  "version" TEXT NOT NULL,
  "confidence" "UrbanConfidence" NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "urban_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "urban_scenarios" (
  "id" TEXT NOT NULL,
  "land_study_version_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "UrbanScenarioType" NOT NULL,
  "status" "LandAnalysisStatus" NOT NULL,
  "zoning_code" TEXT NOT NULL,
  "is_hypothetical" BOOLEAN NOT NULL,
  "disclaimer" TEXT,
  "parameters" JSONB NOT NULL,
  "source_refs" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "urban_scenarios_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "urban_restrictions" (
  "id" TEXT NOT NULL,
  "urban_scenario_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "type" "UrbanRestrictionType" NOT NULL,
  "severity" "RedTeamFindingSeverity" NOT NULL,
  "geometry" JSONB,
  "description" TEXT NOT NULL,
  "source_ref" TEXT NOT NULL,
  "confidence" "UrbanConfidence" NOT NULL,
  "impact" TEXT NOT NULL,
  "verification" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "urban_restrictions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "buildable_envelopes" (
  "id" TEXT NOT NULL,
  "urban_scenario_id" TEXT NOT NULL,
  "engine_version" TEXT NOT NULL,
  "ground_polygon" JSONB NOT NULL,
  "maximum_footprint_area" DECIMAL(20,4) NOT NULL,
  "maximum_computable_area" DECIMAL(20,4) NOT NULL,
  "estimated_non_computable" DECIMAL(20,4) NOT NULL,
  "maximum_total_area" DECIMAL(20,4) NOT NULL,
  "maximum_height" DECIMAL(12,4) NOT NULL,
  "estimated_floors" INTEGER NOT NULL,
  "constraints" JSONB NOT NULL,
  "warnings" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "buildable_envelopes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "land_options" (
  "id" TEXT NOT NULL,
  "land_study_version_id" TEXT NOT NULL,
  "urban_scenario_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "massing_type" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "pareto_efficient" BOOLEAN NOT NULL,
  "product" JSONB NOT NULL,
  "masterplan" JSONB NOT NULL,
  "massing" JSONB NOT NULL,
  "area_schedule" JSONB NOT NULL,
  "engine_assumptions" JSONB NOT NULL,
  "engine_result" JSONB NOT NULL,
  "score_result" JSONB NOT NULL,
  "warnings" JSONB NOT NULL,
  "engine_version" TEXT NOT NULL,
  "score_version" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "land_options_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reverse_zoning_runs" (
  "id" TEXT NOT NULL,
  "land_study_version_id" TEXT NOT NULL,
  "solver_version" TEXT NOT NULL,
  "target" JSONB NOT NULL,
  "result" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reverse_zoning_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "urban_gap_analyses" (
  "id" TEXT NOT NULL,
  "land_study_version_id" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "urban_gap_analyses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "urban_uplift_analyses" (
  "id" TEXT NOT NULL,
  "land_study_version_id" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "urban_uplift_analyses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "land_documents" (
  "id" TEXT NOT NULL,
  "land_asset_id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "storage_key" TEXT,
  "source_type" "UrbanSourceType" NOT NULL,
  "metadata" JSONB,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "land_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "land_audit_logs" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "land_study_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "parameter" TEXT NOT NULL,
  "previous_value" JSONB,
  "new_value" JSONB NOT NULL,
  "origin" "UrbanSourceType" NOT NULL,
  "justification" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "land_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "land_assets_organization_id_city_state_idx" ON "land_assets"("organization_id", "city", "state");
CREATE INDEX "land_assets_project_id_idx" ON "land_assets"("project_id");
CREATE INDEX "land_studies_organization_id_updated_at_idx" ON "land_studies"("organization_id", "updated_at");
CREATE UNIQUE INDEX "land_studies_land_asset_id_name_key" ON "land_studies"("land_asset_id", "name");
CREATE INDEX "land_study_versions_land_study_id_created_at_idx" ON "land_study_versions"("land_study_id", "created_at");
CREATE UNIQUE INDEX "land_study_versions_land_study_id_version_number_key" ON "land_study_versions"("land_study_id", "version_number");
CREATE INDEX "urban_sources_land_study_version_id_type_idx" ON "urban_sources"("land_study_version_id", "type");
CREATE UNIQUE INDEX "urban_sources_land_study_version_id_source_ref_key" ON "urban_sources"("land_study_version_id", "source_ref");
CREATE INDEX "urban_scenarios_land_study_version_id_type_idx" ON "urban_scenarios"("land_study_version_id", "type");
CREATE UNIQUE INDEX "urban_scenarios_land_study_version_id_code_key" ON "urban_scenarios"("land_study_version_id", "code");
CREATE UNIQUE INDEX "urban_restrictions_urban_scenario_id_code_key" ON "urban_restrictions"("urban_scenario_id", "code");
CREATE UNIQUE INDEX "buildable_envelopes_urban_scenario_id_key" ON "buildable_envelopes"("urban_scenario_id");
CREATE INDEX "land_options_urban_scenario_id_rank_idx" ON "land_options"("urban_scenario_id", "rank");
CREATE UNIQUE INDEX "land_options_land_study_version_id_code_key" ON "land_options"("land_study_version_id", "code");
CREATE INDEX "reverse_zoning_runs_land_study_version_id_created_at_idx" ON "reverse_zoning_runs"("land_study_version_id", "created_at");
CREATE INDEX "urban_gap_analyses_land_study_version_id_created_at_idx" ON "urban_gap_analyses"("land_study_version_id", "created_at");
CREATE INDEX "urban_uplift_analyses_land_study_version_id_created_at_idx" ON "urban_uplift_analyses"("land_study_version_id", "created_at");
CREATE INDEX "land_documents_land_asset_id_category_idx" ON "land_documents"("land_asset_id", "category");
CREATE INDEX "land_audit_logs_organization_id_created_at_idx" ON "land_audit_logs"("organization_id", "created_at");
CREATE INDEX "land_audit_logs_land_study_id_parameter_idx" ON "land_audit_logs"("land_study_id", "parameter");

ALTER TABLE "land_assets" ADD CONSTRAINT "land_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "land_assets" ADD CONSTRAINT "land_assets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "land_assets" ADD CONSTRAINT "land_assets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "land_assets" ADD CONSTRAINT "land_assets_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "land_studies" ADD CONSTRAINT "land_studies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "land_studies" ADD CONSTRAINT "land_studies_land_asset_id_fkey" FOREIGN KEY ("land_asset_id") REFERENCES "land_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "land_studies" ADD CONSTRAINT "land_studies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "land_studies" ADD CONSTRAINT "land_studies_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "land_study_versions" ADD CONSTRAINT "land_study_versions_land_study_id_fkey" FOREIGN KEY ("land_study_id") REFERENCES "land_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "land_study_versions" ADD CONSTRAINT "land_study_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "urban_sources" ADD CONSTRAINT "urban_sources_land_study_version_id_fkey" FOREIGN KEY ("land_study_version_id") REFERENCES "land_study_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "urban_scenarios" ADD CONSTRAINT "urban_scenarios_land_study_version_id_fkey" FOREIGN KEY ("land_study_version_id") REFERENCES "land_study_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "urban_restrictions" ADD CONSTRAINT "urban_restrictions_urban_scenario_id_fkey" FOREIGN KEY ("urban_scenario_id") REFERENCES "urban_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "buildable_envelopes" ADD CONSTRAINT "buildable_envelopes_urban_scenario_id_fkey" FOREIGN KEY ("urban_scenario_id") REFERENCES "urban_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "land_options" ADD CONSTRAINT "land_options_land_study_version_id_fkey" FOREIGN KEY ("land_study_version_id") REFERENCES "land_study_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "land_options" ADD CONSTRAINT "land_options_urban_scenario_id_fkey" FOREIGN KEY ("urban_scenario_id") REFERENCES "urban_scenarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reverse_zoning_runs" ADD CONSTRAINT "reverse_zoning_runs_land_study_version_id_fkey" FOREIGN KEY ("land_study_version_id") REFERENCES "land_study_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "urban_gap_analyses" ADD CONSTRAINT "urban_gap_analyses_land_study_version_id_fkey" FOREIGN KEY ("land_study_version_id") REFERENCES "land_study_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "urban_uplift_analyses" ADD CONSTRAINT "urban_uplift_analyses_land_study_version_id_fkey" FOREIGN KEY ("land_study_version_id") REFERENCES "land_study_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "land_documents" ADD CONSTRAINT "land_documents_land_asset_id_fkey" FOREIGN KEY ("land_asset_id") REFERENCES "land_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "land_documents" ADD CONSTRAINT "land_documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "land_audit_logs" ADD CONSTRAINT "land_audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "land_audit_logs" ADD CONSTRAINT "land_audit_logs_land_study_id_fkey" FOREIGN KEY ("land_study_id") REFERENCES "land_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "land_audit_logs" ADD CONSTRAINT "land_audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_land_snapshot_version_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD.version_status = 'SNAPSHOT' THEN
    RAISE EXCEPTION 'LandStudyVersion snapshot is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER land_snapshot_version_immutable
BEFORE UPDATE OR DELETE ON land_study_versions
FOR EACH ROW EXECUTE FUNCTION prevent_land_snapshot_version_mutation();

CREATE OR REPLACE FUNCTION prevent_land_snapshot_child_mutation()
RETURNS trigger AS $$
DECLARE
  parent_id TEXT;
  parent_status "LandVersionStatus";
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.land_study_version_id ELSE NEW.land_study_version_id END;
  SELECT version_status INTO parent_status FROM land_study_versions WHERE id = parent_id;
  IF parent_status = 'SNAPSHOT' THEN
    RAISE EXCEPTION 'Land snapshot artifact is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER urban_sources_snapshot_immutable BEFORE UPDATE OR DELETE ON urban_sources FOR EACH ROW EXECUTE FUNCTION prevent_land_snapshot_child_mutation();
CREATE TRIGGER urban_scenarios_snapshot_immutable BEFORE UPDATE OR DELETE ON urban_scenarios FOR EACH ROW EXECUTE FUNCTION prevent_land_snapshot_child_mutation();
CREATE TRIGGER land_options_snapshot_immutable BEFORE UPDATE OR DELETE ON land_options FOR EACH ROW EXECUTE FUNCTION prevent_land_snapshot_child_mutation();
CREATE TRIGGER reverse_zoning_snapshot_immutable BEFORE UPDATE OR DELETE ON reverse_zoning_runs FOR EACH ROW EXECUTE FUNCTION prevent_land_snapshot_child_mutation();
CREATE TRIGGER urban_gap_snapshot_immutable BEFORE UPDATE OR DELETE ON urban_gap_analyses FOR EACH ROW EXECUTE FUNCTION prevent_land_snapshot_child_mutation();
CREATE TRIGGER urban_uplift_snapshot_immutable BEFORE UPDATE OR DELETE ON urban_uplift_analyses FOR EACH ROW EXECUTE FUNCTION prevent_land_snapshot_child_mutation();

CREATE OR REPLACE FUNCTION prevent_land_snapshot_scenario_child_mutation()
RETURNS trigger AS $$
DECLARE
  scenario_id TEXT;
  parent_status "LandVersionStatus";
BEGIN
  scenario_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.urban_scenario_id ELSE NEW.urban_scenario_id END;
  SELECT v.version_status INTO parent_status
  FROM land_study_versions v JOIN urban_scenarios s ON s.land_study_version_id = v.id
  WHERE s.id = scenario_id;
  IF parent_status = 'SNAPSHOT' THEN
    RAISE EXCEPTION 'Land scenario artifact is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER urban_restrictions_snapshot_immutable BEFORE UPDATE OR DELETE ON urban_restrictions FOR EACH ROW EXECUTE FUNCTION prevent_land_snapshot_scenario_child_mutation();
CREATE TRIGGER buildable_envelopes_snapshot_immutable BEFORE UPDATE OR DELETE ON buildable_envelopes FOR EACH ROW EXECUTE FUNCTION prevent_land_snapshot_scenario_child_mutation();
