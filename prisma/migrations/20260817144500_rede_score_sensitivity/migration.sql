-- DropIndex
DROP INDEX "score_dimensions_score_id_name_key";

-- AlterTable
ALTER TABLE "assumption_snapshots" ADD COLUMN     "sales_start_delay_months" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "score_dimensions" ADD COLUMN     "key" TEXT NOT NULL,
ADD COLUMN     "weighted_score" DECIMAL(5,2) NOT NULL;

-- AlterTable
ALTER TABLE "scores" ADD COLUMN     "classification" TEXT NOT NULL,
ADD COLUMN     "gates" JSONB NOT NULL,
ADD COLUMN     "penalties" JSONB NOT NULL,
ADD COLUMN     "raw_score" DECIMAL(5,2) NOT NULL,
ADD COLUMN     "scenario_id" TEXT NOT NULL,
ADD COLUMN     "score_after_penalties" DECIMAL(5,2) NOT NULL;

-- AlterTable
ALTER TABLE "sensitivity_analyses" ADD COLUMN     "base_scenario_id" TEXT,
ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "config_version" TEXT NOT NULL,
ADD COLUMN     "engine_version" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "sensitivity_cases" (
    "id" TEXT NOT NULL,
    "sensitivity_analysis_id" TEXT NOT NULL,
    "variable" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "variation" DECIMAL(12,6) NOT NULL,
    "variation_unit" TEXT NOT NULL,
    "base_value" TEXT NOT NULL,
    "stressed_value" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "policy_violations" JSONB NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "classification" TEXT NOT NULL,
    "score_delta" DECIMAL(5,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sensitivity_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_even_results" (
    "id" TEXT NOT NULL,
    "sensitivity_analysis_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "variable" TEXT NOT NULL,
    "value" DECIMAL(18,8) NOT NULL,
    "unit" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "iterations" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_even_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stress_test_results" (
    "id" TEXT NOT NULL,
    "sensitivity_analysis_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "adjustments" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "violated_policies" JSONB NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "classification" TEXT NOT NULL,
    "score_delta" DECIMAL(5,2) NOT NULL,
    "recommendation_status" TEXT NOT NULL,
    "recommendation_label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stress_test_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_rule_results" (
    "id" TEXT NOT NULL,
    "score_id" TEXT NOT NULL,
    "dimension_key" TEXT NOT NULL,
    "rule_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "tone" TEXT NOT NULL,
    "actual_value" TEXT NOT NULL,
    "benchmark" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_rule_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sensitivity_cases_sensitivity_analysis_id_variable_idx" ON "sensitivity_cases"("sensitivity_analysis_id", "variable");

-- CreateIndex
CREATE UNIQUE INDEX "break_even_results_sensitivity_analysis_id_key_key" ON "break_even_results"("sensitivity_analysis_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "stress_test_results_sensitivity_analysis_id_key_key" ON "stress_test_results"("sensitivity_analysis_id", "key");

-- CreateIndex
CREATE INDEX "score_rule_results_score_id_dimension_key_idx" ON "score_rule_results"("score_id", "dimension_key");

-- CreateIndex
CREATE UNIQUE INDEX "score_rule_results_score_id_rule_key_key" ON "score_rule_results"("score_id", "rule_key");

-- CreateIndex
CREATE UNIQUE INDEX "score_dimensions_score_id_key_key" ON "score_dimensions"("score_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "scores_study_version_id_scenario_id_policy_version_key" ON "scores"("study_version_id", "scenario_id", "policy_version");

-- CreateIndex
CREATE INDEX "sensitivity_analyses_base_scenario_id_idx" ON "sensitivity_analyses"("base_scenario_id");

-- AddForeignKey
ALTER TABLE "sensitivity_analyses" ADD CONSTRAINT "sensitivity_analyses_base_scenario_id_fkey" FOREIGN KEY ("base_scenario_id") REFERENCES "scenarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensitivity_cases" ADD CONSTRAINT "sensitivity_cases_sensitivity_analysis_id_fkey" FOREIGN KEY ("sensitivity_analysis_id") REFERENCES "sensitivity_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_even_results" ADD CONSTRAINT "break_even_results_sensitivity_analysis_id_fkey" FOREIGN KEY ("sensitivity_analysis_id") REFERENCES "sensitivity_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stress_test_results" ADD CONSTRAINT "stress_test_results_sensitivity_analysis_id_fkey" FOREIGN KEY ("sensitivity_analysis_id") REFERENCES "sensitivity_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "scenarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_rule_results" ADD CONSTRAINT "score_rule_results_score_id_fkey" FOREIGN KEY ("score_id") REFERENCES "scores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Score and sensitivity details belong to an immutable published snapshot.
CREATE OR REPLACE FUNCTION prevent_snapshot_score_child_mutation()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "scores" score
    JOIN "study_versions" sv ON sv."id" = score."study_version_id"
    WHERE score."id" = OLD."score_id" AND sv."status" = 'SNAPSHOT'
  ) THEN
    RAISE EXCEPTION 'snapshot score details are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_snapshot_sensitivity_child_mutation()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "sensitivity_analyses" analysis
    JOIN "study_versions" sv ON sv."id" = analysis."study_version_id"
    WHERE analysis."id" = OLD."sensitivity_analysis_id" AND sv."status" = 'SNAPSHOT'
  ) THEN
    RAISE EXCEPTION 'snapshot sensitivity details are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER score_dimensions_immutable BEFORE UPDATE OR DELETE ON "score_dimensions" FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_score_child_mutation();
CREATE TRIGGER score_rule_results_immutable BEFORE UPDATE OR DELETE ON "score_rule_results" FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_score_child_mutation();
CREATE TRIGGER sensitivity_cases_immutable BEFORE UPDATE OR DELETE ON "sensitivity_cases" FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_sensitivity_child_mutation();
CREATE TRIGGER break_even_results_immutable BEFORE UPDATE OR DELETE ON "break_even_results" FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_sensitivity_child_mutation();
CREATE TRIGGER stress_test_results_immutable BEFORE UPDATE OR DELETE ON "stress_test_results" FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_sensitivity_child_mutation();
