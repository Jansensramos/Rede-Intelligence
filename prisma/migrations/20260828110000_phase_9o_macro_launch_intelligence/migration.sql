-- FASE 9O — Inteligência Macroeconômica e Momento de Lançamento
-- Migration aprovada e aplicada após backup persistente pré-9O validado.
-- Estrutura aditiva, tenant-safe e sem qualquer escrita automática em
-- Budget, OperationalBaseline, FundingProposal ou decisão de lançamento.

-- CreateEnum
CREATE TYPE "MacroIndicatorFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'IRREGULAR');
CREATE TYPE "MacroIndicatorVisibility" AS ENUM ('GLOBAL', 'ORGANIZATION');
CREATE TYPE "MacroRegionLevel" AS ENUM ('NATIONAL', 'STATE', 'MUNICIPALITY', 'MARKET_AREA', 'CUSTOM');
CREATE TYPE "LaunchScenarioKind" AS ENUM ('BASE', 'FAVORABLE', 'STRESSED', 'CUSTOM');
CREATE TYPE "LaunchScenarioStatus" AS ENUM ('DRAFT', 'CALCULATED', 'UNDER_REVIEW', 'LOCKED', 'SUPERSEDED');
CREATE TYPE "LaunchRecommendation" AS ENUM ('FAVORABLE_TO_LAUNCH', 'LAUNCH_WITH_CONDITIONS', 'PHASE', 'REVIEW_PRODUCT_PRICE', 'WAIT', 'INSUFFICIENT_EVIDENCE');
CREATE TYPE "LaunchTriggerOperator" AS ENUM ('LT', 'LTE', 'GT', 'GTE', 'BETWEEN');
CREATE TYPE "LaunchTriggerStatus" AS ENUM ('ACTIVE', 'PAUSED', 'SUPERSEDED');
CREATE TYPE "LaunchHumanDecision" AS ENUM ('LAUNCH', 'LAUNCH_WITH_CONDITIONS', 'PHASE', 'REVIEW_PRODUCT_PRICE', 'WAIT', 'REJECT');

-- ProductScenario já expõe organization_id e project_id. A chave auxiliar
-- permite FK composta completa. ProductScenario de mercado sem project_id não
-- pode ser vinculado a um LaunchScenario contextualizado ao empreendimento.
CREATE UNIQUE INDEX "product_scenarios_org_project_id_key"
  ON "product_scenarios"("organization_id", "project_id", "id");

-- CreateTable: catálogo canônico. GLOBAL é curado por provider/system;
-- ORGANIZATION pertence a um tenant e exige membership/capability no service.
CREATE TABLE "macro_indicator_series" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "canonical_unit" TEXT NOT NULL,
  "frequency" "MacroIndicatorFrequency" NOT NULL,
  "visibility" "MacroIndicatorVisibility" NOT NULL,
  "expected_freshness_days" INTEGER NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "macro_indicator_series_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "macro_indicator_series_scope_check" CHECK (
    ("visibility" = 'GLOBAL' AND "organization_id" IS NULL) OR
    ("visibility" = 'ORGANIZATION' AND "organization_id" IS NOT NULL)
  ),
  CONSTRAINT "macro_indicator_series_freshness_check" CHECK ("expected_freshness_days" > 0),
  CONSTRAINT "macro_indicator_series_code_check" CHECK (btrim("code") <> ''),
  CONSTRAINT "macro_indicator_series_unit_check" CHECK (btrim("canonical_unit") <> '')
);

-- NULL não participa de unique comum no PostgreSQL; índices parciais impedem
-- duplicação tanto no catálogo global quanto no catálogo de cada organização.
CREATE UNIQUE INDEX "macro_indicator_series_global_code_key"
  ON "macro_indicator_series"("code")
  WHERE "organization_id" IS NULL;

CREATE UNIQUE INDEX "macro_indicator_series_org_code_key"
  ON "macro_indicator_series"("organization_id", "code")
  WHERE "organization_id" IS NOT NULL;

CREATE INDEX "macro_indicator_series_org_active_idx"
  ON "macro_indicator_series"("organization_id", "is_active");

-- CreateTable: histórico append-only. A observação vigente é o único leaf da
-- cadeia série + período + geografia (linha sem correção que a referencie).
CREATE TABLE "macro_indicator_observations" (
  "id" TEXT NOT NULL,
  "series_id" TEXT NOT NULL,
  "previous_observation_id" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "is_correction" BOOLEAN NOT NULL DEFAULT false,
  "reference_date" DATE NOT NULL,
  "collected_at" TIMESTAMP(3) NOT NULL,
  "region_level" "MacroRegionLevel" NOT NULL,
  "region_code" TEXT NOT NULL,
  "raw_value" DECIMAL(20,8) NOT NULL,
  "raw_unit" TEXT NOT NULL,
  "normalized_value" DECIMAL(20,8) NOT NULL,
  "canonical_unit" TEXT NOT NULL,
  "normalization_key" TEXT NOT NULL,
  "normalization_metadata" JSONB NOT NULL,
  "source_provider" TEXT NOT NULL,
  "source_url" TEXT,
  "source_method" TEXT NOT NULL,
  "confidence_level" "ConfidenceLevel" NOT NULL,
  "confidence_score" DOUBLE PRECISION,
  "provenance" JSONB NOT NULL,
  "checksum" TEXT NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "macro_indicator_observations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "macro_observations_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "macro_observations_confidence_check" CHECK (
    "confidence_score" IS NULL OR ("confidence_score" >= 0 AND "confidence_score" <= 1)
  ),
  CONSTRAINT "macro_observations_units_check" CHECK (
    btrim("raw_unit") <> '' AND btrim("canonical_unit") <> '' AND btrim("normalization_key") <> ''
  ),
  CONSTRAINT "macro_observations_region_check" CHECK (
    ("region_level" = 'NATIONAL' AND "region_code" = 'BR') OR
    ("region_level" = 'STATE' AND "region_code" ~ '^BR-[A-Z]{2}$') OR
    ("region_level" = 'MUNICIPALITY' AND "region_code" ~ '^[0-9]{7}$') OR
    ("region_level" = 'MARKET_AREA' AND "region_code" LIKE 'market-area:%') OR
    ("region_level" = 'CUSTOM' AND btrim("region_code") <> '')
  )
);

CREATE UNIQUE INDEX "macro_observations_previous_observation_id_key"
  ON "macro_indicator_observations"("previous_observation_id");

CREATE UNIQUE INDEX "macro_observations_series_id_id_key"
  ON "macro_indicator_observations"("series_id", "id");

CREATE UNIQUE INDEX "macro_observations_period_revision_key"
  ON "macro_indicator_observations"("series_id", "reference_date", "region_level", "region_code", "revision");

CREATE UNIQUE INDEX "macro_observations_checksum_key"
  ON "macro_indicator_observations"("series_id", "checksum");

CREATE INDEX "macro_observations_history_idx"
  ON "macro_indicator_observations"("series_id", "reference_date", "region_level", "region_code");

-- CreateTable: cenário versionado por series_key, não pelo nome visível.
CREATE TABLE "launch_scenarios" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "product_scenario_id" TEXT,
  "series_key" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "previous_scenario_id" TEXT,
  "name" TEXT NOT NULL,
  "kind" "LaunchScenarioKind" NOT NULL,
  "status" "LaunchScenarioStatus" NOT NULL DEFAULT 'DRAFT',
  "reference_date" DATE NOT NULL,
  "rationale" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "locked_at" TIMESTAMP(3),

  CONSTRAINT "launch_scenarios_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "launch_scenarios_version_check" CHECK ("version" > 0),
  CONSTRAINT "launch_scenarios_series_key_check" CHECK (btrim("series_key") <> ''),
  CONSTRAINT "launch_scenarios_locked_at_check" CHECK (
    ("status" IN ('LOCKED', 'SUPERSEDED') AND "locked_at" IS NOT NULL) OR
    ("status" NOT IN ('LOCKED', 'SUPERSEDED') AND "locked_at" IS NULL)
  )
);

CREATE UNIQUE INDEX "launch_scenarios_previous_scenario_id_key"
  ON "launch_scenarios"("previous_scenario_id");

CREATE UNIQUE INDEX "launch_scenarios_org_project_id_key"
  ON "launch_scenarios"("organization_id", "project_id", "id");

CREATE UNIQUE INDEX "launch_scenarios_series_version_key"
  ON "launch_scenarios"("organization_id", "project_id", "series_key", "version");

CREATE INDEX "launch_scenarios_org_project_status_kind_idx"
  ON "launch_scenarios"("organization_id", "project_id", "status", "kind");

CREATE INDEX "launch_scenarios_product_scenario_idx"
  ON "launch_scenarios"("product_scenario_id");

-- CreateTable: keys são validadas pelo registry determinístico em código.
CREATE TABLE "launch_scenario_assumptions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "scenario_id" TEXT NOT NULL,
  "assumption_key" TEXT NOT NULL,
  "original_value" JSONB NOT NULL,
  "adjusted_value" JSONB NOT NULL,
  "unit" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_ref" TEXT,
  "confidence_level" "ConfidenceLevel" NOT NULL,
  "justification" TEXT,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "launch_scenario_assumptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "launch_assumptions_key_check" CHECK (btrim("assumption_key") <> ''),
  CONSTRAINT "launch_assumptions_unit_check" CHECK (btrim("unit") <> '')
);

CREATE UNIQUE INDEX "launch_assumptions_scenario_key"
  ON "launch_scenario_assumptions"("scenario_id", "assumption_key");

CREATE INDEX "launch_assumptions_org_project_key_idx"
  ON "launch_scenario_assumptions"("organization_id", "project_id", "assumption_key");

-- CreateTable: avaliação determinística e append-only. O mesmo cenário e o
-- mesmo checksum retornam a mesma avaliação; cenários distintos podem ter
-- inputs idênticos sem colisão.
CREATE TABLE "launch_evaluations" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "scenario_id" TEXT NOT NULL,
  "recommendation" "LaunchRecommendation" NOT NULL,
  "confidence_level" "ConfidenceLevel" NOT NULL,
  "confidence_score" DOUBLE PRECISION,
  "favorable_factors" JSONB NOT NULL,
  "unfavorable_factors" JSONB NOT NULL,
  "critical_factors" JSONB NOT NULL,
  "missing_evidence" JSONB NOT NULL,
  "economic_impact_snapshot" JSONB NOT NULL,
  "indicator_snapshot" JSONB NOT NULL,
  "conditions_for_change" JSONB NOT NULL,
  "engine_version" TEXT NOT NULL,
  "input_checksum" TEXT NOT NULL,
  "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" TEXT NOT NULL,

  CONSTRAINT "launch_evaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "launch_evaluations_confidence_check" CHECK (
    "confidence_score" IS NULL OR ("confidence_score" >= 0 AND "confidence_score" <= 1)
  ),
  CONSTRAINT "launch_evaluations_checksum_check" CHECK (btrim("input_checksum") <> '')
);

CREATE UNIQUE INDEX "launch_evaluations_org_project_id_key"
  ON "launch_evaluations"("organization_id", "project_id", "id");

CREATE UNIQUE INDEX "launch_evaluations_scenario_checksum_key"
  ON "launch_evaluations"("organization_id", "project_id", "scenario_id", "input_checksum");

CREATE INDEX "launch_evaluations_org_project_calculated_idx"
  ON "launch_evaluations"("organization_id", "project_id", "calculated_at");

-- CreateTable: configuração versionada. O engine deve resolver metric_key no
-- registry e só avaliar unidade compatível, evidência fresca e confiança mínima.
CREATE TABLE "launch_triggers" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "series_key" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "previous_trigger_id" TEXT,
  "code" TEXT NOT NULL,
  "status" "LaunchTriggerStatus" NOT NULL DEFAULT 'ACTIVE',
  "metric_key" TEXT NOT NULL,
  "operator" "LaunchTriggerOperator" NOT NULL,
  "threshold_value" DECIMAL(20,8) NOT NULL,
  "threshold_value_end" DECIMAL(20,8),
  "unit" TEXT NOT NULL,
  "minimum_confidence" "ConfidenceLevel",
  "recommendation_on_match" "LaunchRecommendation",
  "rationale" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "launch_triggers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "launch_triggers_version_check" CHECK ("version" > 0),
  CONSTRAINT "launch_triggers_keys_check" CHECK (
    btrim("series_key") <> '' AND btrim("code") <> '' AND btrim("metric_key") <> '' AND btrim("unit") <> ''
  ),
  CONSTRAINT "launch_triggers_between_check" CHECK (
    ("operator" = 'BETWEEN' AND "threshold_value_end" IS NOT NULL AND "threshold_value_end" >= "threshold_value") OR
    ("operator" <> 'BETWEEN' AND "threshold_value_end" IS NULL)
  )
);

CREATE UNIQUE INDEX "launch_triggers_previous_trigger_id_key"
  ON "launch_triggers"("previous_trigger_id");

CREATE UNIQUE INDEX "launch_triggers_org_project_id_key"
  ON "launch_triggers"("organization_id", "project_id", "id");

CREATE UNIQUE INDEX "launch_triggers_series_version_key"
  ON "launch_triggers"("organization_id", "project_id", "series_key", "version");

CREATE INDEX "launch_triggers_org_project_status_idx"
  ON "launch_triggers"("organization_id", "project_id", "status");

-- CreateTable: uma decisão imutável por avaliação. Mudança de decisão exige
-- novo cenário/avaliação/ciclo, nunca UPDATE da memória anterior.
CREATE TABLE "launch_decisions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "evaluation_id" TEXT NOT NULL,
  "recommendation_snapshot" JSONB NOT NULL,
  "human_decision" "LaunchHumanDecision" NOT NULL,
  "rationale" TEXT NOT NULL,
  "evidence_refs" JSONB NOT NULL,
  "decided_by_id" TEXT NOT NULL,
  "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checksum" TEXT NOT NULL,

  CONSTRAINT "launch_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "launch_decisions_checksum_check" CHECK (btrim("checksum") <> '')
);

CREATE UNIQUE INDEX "launch_decisions_evaluation_id_key"
  ON "launch_decisions"("evaluation_id");

CREATE UNIQUE INDEX "launch_decisions_org_project_checksum_key"
  ON "launch_decisions"("organization_id", "project_id", "checksum");

CREATE INDEX "launch_decisions_org_project_decided_idx"
  ON "launch_decisions"("organization_id", "project_id", "decided_at");

-- Foreign keys: nenhum histórico usa CASCADE para delete.
ALTER TABLE "macro_indicator_series"
  ADD CONSTRAINT "macro_indicator_series_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "macro_indicator_series"
  ADD CONSTRAINT "macro_indicator_series_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "macro_indicator_observations"
  ADD CONSTRAINT "macro_observations_series_id_fkey"
  FOREIGN KEY ("series_id") REFERENCES "macro_indicator_series"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "macro_indicator_observations"
  ADD CONSTRAINT "macro_observations_previous_lineage_fkey"
  FOREIGN KEY ("series_id", "previous_observation_id")
  REFERENCES "macro_indicator_observations"("series_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "macro_indicator_observations"
  ADD CONSTRAINT "macro_observations_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "launch_scenarios"
  ADD CONSTRAINT "launch_scenarios_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "launch_scenarios"
  ADD CONSTRAINT "launch_scenarios_project_tenant_fkey"
  FOREIGN KEY ("organization_id", "project_id")
  REFERENCES "projects"("organization_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "launch_scenarios"
  ADD CONSTRAINT "launch_scenarios_product_scenario_tenant_fkey"
  FOREIGN KEY ("organization_id", "project_id", "product_scenario_id")
  REFERENCES "product_scenarios"("organization_id", "project_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "launch_scenarios"
  ADD CONSTRAINT "launch_scenarios_previous_tenant_fkey"
  FOREIGN KEY ("organization_id", "project_id", "previous_scenario_id")
  REFERENCES "launch_scenarios"("organization_id", "project_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "launch_scenarios"
  ADD CONSTRAINT "launch_scenarios_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "launch_scenario_assumptions"
  ADD CONSTRAINT "launch_assumptions_scenario_tenant_fkey"
  FOREIGN KEY ("organization_id", "project_id", "scenario_id")
  REFERENCES "launch_scenarios"("organization_id", "project_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "launch_scenario_assumptions"
  ADD CONSTRAINT "launch_assumptions_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "launch_evaluations"
  ADD CONSTRAINT "launch_evaluations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "launch_evaluations"
  ADD CONSTRAINT "launch_evaluations_project_tenant_fkey"
  FOREIGN KEY ("organization_id", "project_id")
  REFERENCES "projects"("organization_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "launch_evaluations"
  ADD CONSTRAINT "launch_evaluations_scenario_tenant_fkey"
  FOREIGN KEY ("organization_id", "project_id", "scenario_id")
  REFERENCES "launch_scenarios"("organization_id", "project_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "launch_evaluations"
  ADD CONSTRAINT "launch_evaluations_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "launch_triggers"
  ADD CONSTRAINT "launch_triggers_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "launch_triggers"
  ADD CONSTRAINT "launch_triggers_project_tenant_fkey"
  FOREIGN KEY ("organization_id", "project_id")
  REFERENCES "projects"("organization_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "launch_triggers"
  ADD CONSTRAINT "launch_triggers_previous_tenant_fkey"
  FOREIGN KEY ("organization_id", "project_id", "previous_trigger_id")
  REFERENCES "launch_triggers"("organization_id", "project_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "launch_triggers"
  ADD CONSTRAINT "launch_triggers_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "launch_decisions"
  ADD CONSTRAINT "launch_decisions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "launch_decisions"
  ADD CONSTRAINT "launch_decisions_project_tenant_fkey"
  FOREIGN KEY ("organization_id", "project_id")
  REFERENCES "projects"("organization_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "launch_decisions"
  ADD CONSTRAINT "launch_decisions_evaluation_tenant_fkey"
  FOREIGN KEY ("organization_id", "project_id", "evaluation_id")
  REFERENCES "launch_evaluations"("organization_id", "project_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "launch_decisions"
  ADD CONSTRAINT "launch_decisions_decided_by_id_fkey"
  FOREIGN KEY ("decided_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Revision chain and normalization invariant. Corrections are new rows; the
-- old observation is never updated. UNIQUE(previous_observation_id) prevents
-- branching, so the leaf is deterministic.
CREATE OR REPLACE FUNCTION enforce_macro_observation_revision()
RETURNS trigger AS $$
DECLARE
  canonical TEXT;
  previous_row RECORD;
BEGIN
  SELECT "canonical_unit" INTO canonical
    FROM "macro_indicator_series"
   WHERE "id" = NEW."series_id";

  IF canonical IS NULL THEN
    RAISE EXCEPTION 'macro indicator series not found';
  END IF;

  IF NEW."canonical_unit" <> canonical THEN
    RAISE EXCEPTION 'observation canonical unit must match the series canonical unit';
  END IF;

  IF NEW."raw_unit" = NEW."canonical_unit" THEN
    IF NEW."normalization_key" <> 'IDENTITY' OR NEW."normalized_value" <> NEW."raw_value" THEN
      RAISE EXCEPTION 'same-unit macro observations require IDENTITY normalization without value changes';
    END IF;
  ELSIF NEW."normalization_key" = 'IDENTITY' THEN
    RAISE EXCEPTION 'different macro units require a registered deterministic normalization';
  END IF;

  IF NEW."previous_observation_id" IS NULL THEN
    IF NEW."revision" <> 1 OR NEW."is_correction" THEN
      RAISE EXCEPTION 'initial macro observation must be revision 1 and not a correction';
    END IF;
  ELSE
    SELECT * INTO previous_row
      FROM "macro_indicator_observations"
     WHERE "series_id" = NEW."series_id"
       AND "id" = NEW."previous_observation_id"
     FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'previous macro observation not found in the same series';
    END IF;

    IF NOT NEW."is_correction"
       OR NEW."revision" <> previous_row."revision" + 1
       OR NEW."reference_date" <> previous_row."reference_date"
       OR NEW."region_level" <> previous_row."region_level"
       OR NEW."region_code" <> previous_row."region_code" THEN
      RAISE EXCEPTION 'macro correction must preserve series, period and geography and increment revision by one';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "macro_observations_revision_guard"
BEFORE INSERT ON "macro_indicator_observations"
FOR EACH ROW EXECUTE FUNCTION enforce_macro_observation_revision();

CREATE OR REPLACE FUNCTION prevent_macro_observation_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'macro indicator observations are append-only; insert a correction revision';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "macro_observations_append_only"
BEFORE UPDATE OR DELETE ON "macro_indicator_observations"
FOR EACH ROW EXECUTE FUNCTION prevent_macro_observation_mutation();

-- Lineage tenant-safe e series_key estável. ProductScenario 9J já está fechado
-- pela FK composta organização + projeto + id acima.
CREATE OR REPLACE FUNCTION enforce_launch_scenario_lineage()
RETURNS trigger AS $$
DECLARE
  previous_row RECORD;
BEGIN
  IF NEW."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'new launch scenarios must start as DRAFT';
  END IF;

  IF NEW."previous_scenario_id" IS NULL THEN
    IF NEW."version" <> 1 THEN
      RAISE EXCEPTION 'initial launch scenario version must be 1';
    END IF;
  ELSE
    SELECT * INTO previous_row
      FROM "launch_scenarios"
     WHERE "organization_id" = NEW."organization_id"
       AND "project_id" = NEW."project_id"
       AND "id" = NEW."previous_scenario_id"
     FOR KEY SHARE;

    IF NOT FOUND
       OR previous_row."series_key" <> NEW."series_key"
       OR NEW."version" <> previous_row."version" + 1
       OR previous_row."status" <> 'LOCKED' THEN
      RAISE EXCEPTION 'launch scenario lineage must continue the same locked tenant/project series without gaps';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "launch_scenarios_lineage_guard"
BEFORE INSERT ON "launch_scenarios"
FOR EACH ROW EXECUTE FUNCTION enforce_launch_scenario_lineage();

-- Explicit state machine. LOCKED content is immutable; the only permitted
-- change is status LOCKED -> SUPERSEDED after a new version is created.
CREATE OR REPLACE FUNCTION protect_launch_scenario()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'calculated or historical launch scenarios cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW."organization_id" <> OLD."organization_id"
     OR NEW."project_id" <> OLD."project_id"
     OR NEW."series_key" <> OLD."series_key"
     OR NEW."version" <> OLD."version"
     OR NEW."previous_scenario_id" IS DISTINCT FROM OLD."previous_scenario_id" THEN
    RAISE EXCEPTION 'launch scenario identity and lineage are immutable';
  END IF;

  IF OLD."status" = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'superseded launch scenarios are immutable';
  END IF;

  IF OLD."status" = 'LOCKED' THEN
    IF NEW."status" <> 'SUPERSEDED'
       OR (to_jsonb(NEW) - ARRAY['status', 'updated_at']) IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['status', 'updated_at']) THEN
      RAISE EXCEPTION 'locked launch scenario content is immutable; create a new version';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD."status" = 'DRAFT' AND NEW."status" IN ('DRAFT', 'CALCULATED', 'SUPERSEDED')) OR
    (OLD."status" = 'CALCULATED' AND NEW."status" IN ('CALCULATED', 'UNDER_REVIEW', 'LOCKED', 'SUPERSEDED')) OR
    (OLD."status" = 'UNDER_REVIEW' AND NEW."status" IN ('UNDER_REVIEW', 'LOCKED', 'SUPERSEDED'))
  ) THEN
    RAISE EXCEPTION 'invalid launch scenario status transition';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "launch_scenarios_immutable"
BEFORE UPDATE OR DELETE ON "launch_scenarios"
FOR EACH ROW EXECUTE FUNCTION protect_launch_scenario();

CREATE OR REPLACE FUNCTION protect_locked_launch_assumption()
RETURNS trigger AS $$
DECLARE
  parent_status "LaunchScenarioStatus";
  parent_id TEXT;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."scenario_id" ELSE NEW."scenario_id" END;
  SELECT "status" INTO parent_status
    FROM "launch_scenarios"
   WHERE "id" = parent_id;

  IF parent_status IN ('LOCKED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'assumptions of locked launch scenarios are immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "launch_assumptions_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "launch_scenario_assumptions"
FOR EACH ROW EXECUTE FUNCTION protect_locked_launch_assumption();

CREATE OR REPLACE FUNCTION protect_launch_evaluation()
RETURNS trigger AS $$
DECLARE
  parent_status "LaunchScenarioStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'launch evaluations are append-only';
  END IF;

  SELECT "status" INTO parent_status
    FROM "launch_scenarios"
   WHERE "organization_id" = NEW."organization_id"
     AND "project_id" = NEW."project_id"
     AND "id" = NEW."scenario_id";

  IF parent_status NOT IN ('CALCULATED', 'UNDER_REVIEW', 'LOCKED') THEN
    RAISE EXCEPTION 'launch evaluation requires a calculated scenario';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "launch_evaluations_append_only"
BEFORE INSERT OR UPDATE OR DELETE ON "launch_evaluations"
FOR EACH ROW EXECUTE FUNCTION protect_launch_evaluation();

-- Trigger configuration is versioned. Only pause/reactivate/supersede may
-- update an existing version; any threshold/key change requires a new row.
CREATE OR REPLACE FUNCTION enforce_launch_trigger_lineage()
RETURNS trigger AS $$
DECLARE
  previous_row RECORD;
BEGIN
  IF NEW."previous_trigger_id" IS NULL THEN
    IF NEW."version" <> 1 THEN
      RAISE EXCEPTION 'initial launch trigger version must be 1';
    END IF;
  ELSE
    SELECT * INTO previous_row
      FROM "launch_triggers"
     WHERE "organization_id" = NEW."organization_id"
       AND "project_id" = NEW."project_id"
       AND "id" = NEW."previous_trigger_id"
     FOR KEY SHARE;

    IF NOT FOUND
       OR previous_row."series_key" <> NEW."series_key"
       OR NEW."version" <> previous_row."version" + 1
       OR previous_row."status" = 'SUPERSEDED' THEN
      RAISE EXCEPTION 'launch trigger lineage must continue the same active tenant/project series without gaps';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "launch_triggers_lineage_guard"
BEFORE INSERT ON "launch_triggers"
FOR EACH ROW EXECUTE FUNCTION enforce_launch_trigger_lineage();

CREATE OR REPLACE FUNCTION protect_launch_trigger_version()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'launch trigger history cannot be deleted';
  END IF;

  IF OLD."status" = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'superseded launch triggers are immutable';
  END IF;

  IF NEW."status" NOT IN ('ACTIVE', 'PAUSED', 'SUPERSEDED')
     OR (to_jsonb(NEW) - ARRAY['status', 'updated_at']) IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['status', 'updated_at']) THEN
    RAISE EXCEPTION 'launch trigger configuration is immutable; create a new version';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "launch_triggers_versioned"
BEFORE UPDATE OR DELETE ON "launch_triggers"
FOR EACH ROW EXECUTE FUNCTION protect_launch_trigger_version();

CREATE OR REPLACE FUNCTION protect_launch_decision()
RETURNS trigger AS $$
DECLARE
  scenario_status "LaunchScenarioStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'launch decisions are append-only; create a new scenario and evaluation cycle';
  END IF;

  SELECT scenario."status" INTO scenario_status
    FROM "launch_evaluations" evaluation
    JOIN "launch_scenarios" scenario
      ON scenario."organization_id" = evaluation."organization_id"
     AND scenario."project_id" = evaluation."project_id"
     AND scenario."id" = evaluation."scenario_id"
   WHERE evaluation."organization_id" = NEW."organization_id"
     AND evaluation."project_id" = NEW."project_id"
     AND evaluation."id" = NEW."evaluation_id";

  IF scenario_status <> 'LOCKED' THEN
    RAISE EXCEPTION 'human launch decision requires a locked scenario';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "launch_decisions_append_only"
BEFORE INSERT OR UPDATE OR DELETE ON "launch_decisions"
FOR EACH ROW EXECUTE FUNCTION protect_launch_decision();

-- A observação vigente é explicitamente o leaf da cadeia. O service aplica
-- freshness/confiança/unidade e a precedência: ORGANIZATION fresca e válida;
-- senão GLOBAL fresca e válida; senão SEM EVIDÊNCIA.
CREATE VIEW "current_macro_indicator_observations" AS
SELECT observation.*
  FROM "macro_indicator_observations" observation
 WHERE NOT EXISTS (
   SELECT 1
     FROM "macro_indicator_observations" correction
    WHERE correction."previous_observation_id" = observation."id"
 );
