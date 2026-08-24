-- CreateEnum
CREATE TYPE "MarketAreaType" AS ENUM ('RADIUS', 'NEIGHBORHOOD', 'MUNICIPALITY', 'CUSTOM_POLYGON', 'ISOCHRONE');

-- CreateEnum
CREATE TYPE "MarketDevelopmentStage" AS ENUM ('BREVE_LANCAMENTO', 'LANCAMENTO', 'EM_OBRAS', 'PRONTO_NOVO', 'PRONTO_USADO');

-- CreateEnum
CREATE TYPE "MarketProductStandard" AS ENUM ('ECONOMICO_MCMV', 'MEDIO_BAIXO', 'MEDIO', 'MEDIO_ALTO', 'ALTO', 'LUXO');

-- CreateEnum
CREATE TYPE "MarketPriceType" AS ENUM ('LIST_PRICE', 'ADVERTISED', 'NEGOTIATED', 'TRANSACTED_REGISTRY', 'REDE_ACTUAL_SALE');

-- CreateEnum
CREATE TYPE "ProductScenarioKind" AS ENUM ('CONSERVATIVE', 'BASE', 'AGGRESSIVE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ProductLifecycleStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'RECOMMENDED', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "market_areas" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "land_asset_id" TEXT,
    "project_id" TEXT,
    "name" TEXT NOT NULL,
    "type" "MarketAreaType" NOT NULL DEFAULT 'RADIUS',
    "center_latitude" DECIMAL(11,8) NOT NULL,
    "center_longitude" DECIMAL(11,8) NOT NULL,
    "radius_meters" INTEGER,
    "polygon_geometry" JSONB,
    "neighborhood" TEXT,
    "city" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demographic_observations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "market_area_id" TEXT NOT NULL,
    "reference_year" INTEGER NOT NULL,
    "total_population" INTEGER NOT NULL,
    "projected_population" INTEGER,
    "annual_growth_rate" DECIMAL(6,4),
    "total_households" INTEGER NOT NULL,
    "persons_per_household" DECIMAL(4,2) NOT NULL,
    "urbanization_rate" DECIMAL(6,4),
    "age_distribution" JSONB NOT NULL,
    "household_composition" JSONB NOT NULL,
    "education_levels" JSONB,
    "source_provider" TEXT NOT NULL,
    "confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "provenance" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demographic_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "income_observations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "market_area_id" TEXT NOT NULL,
    "reference_year" INTEGER NOT NULL,
    "average_household_income" DECIMAL(14,2) NOT NULL,
    "median_household_income" DECIMAL(14,2) NOT NULL,
    "per_capita_income" DECIMAL(14,2),
    "total_income_mass_monthly" DECIMAL(18,2),
    "income_bracket_distribution" JSONB NOT NULL,
    "source_provider" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "income_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affordability_policies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "max_commitment_rate" DECIMAL(6,4) NOT NULL,
    "annual_interest_rate" DECIMAL(6,4) NOT NULL,
    "term_months" INTEGER NOT NULL,
    "min_down_payment_rate" DECIMAL(6,4) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affordability_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_comparability_policies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "distance_weight" DECIMAL(6,4) NOT NULL,
    "standard_weight" DECIMAL(6,4) NOT NULL,
    "typology_weight" DECIMAL(6,4) NOT NULL,
    "price_point_weight" DECIMAL(6,4) NOT NULL,
    "recency_weight" DECIMAL(6,4) NOT NULL,
    "minimum_sample_size" INTEGER NOT NULL DEFAULT 3,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_comparability_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "amenity_catalog_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "estimated_cost_per_m2" DECIMAL(12,2) NOT NULL,
    "area_required_m2" DECIMAL(10,2) NOT NULL,
    "relevance_rate" DECIMAL(6,4),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "amenity_catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_developments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "market_area_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "developer_name" TEXT,
    "builder_name" TEXT,
    "address" TEXT NOT NULL,
    "neighborhood" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "latitude" DECIMAL(11,8) NOT NULL,
    "longitude" DECIMAL(11,8) NOT NULL,
    "distance_meters" INTEGER NOT NULL,
    "stage" "MarketDevelopmentStage" NOT NULL DEFAULT 'LANCAMENTO',
    "standard" "MarketProductStandard" NOT NULL DEFAULT 'MEDIO',
    "launch_date" DATE,
    "expected_delivery_date" DATE,
    "total_towers" INTEGER NOT NULL DEFAULT 1,
    "total_floors" INTEGER,
    "total_units" INTEGER NOT NULL,
    "amenities" JSONB,
    "is_canonical" BOOLEAN NOT NULL DEFAULT true,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "provenance" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_developments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_price_observations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "development_id" TEXT NOT NULL,
    "typology_description" TEXT NOT NULL,
    "bedrooms" INTEGER NOT NULL,
    "suites" INTEGER NOT NULL DEFAULT 0,
    "bathrooms" INTEGER NOT NULL DEFAULT 1,
    "parking_spaces" INTEGER NOT NULL DEFAULT 1,
    "private_area_m2" DECIMAL(10,2) NOT NULL,
    "total_price" DECIMAL(14,2) NOT NULL,
    "price_per_sqm" DECIMAL(12,2) NOT NULL,
    "price_type" "MarketPriceType" NOT NULL DEFAULT 'LIST_PRICE',
    "discount_rate" DECIMAL(6,4),
    "observed_at" DATE NOT NULL,
    "source_provider" TEXT NOT NULL,
    "confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "provenance" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_price_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_inventory_snapshots" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "development_id" TEXT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "total_units" INTEGER NOT NULL,
    "available_units" INTEGER NOT NULL,
    "sold_units" INTEGER NOT NULL,
    "reserved_units" INTEGER NOT NULL DEFAULT 0,
    "vso_period_percentage" DECIMAL(6,4),
    "months_of_inventory" DECIMAL(6,2),
    "source_provider" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_inventory_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_launch_history" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "development_id" TEXT NOT NULL,
    "launch_date" DATE NOT NULL,
    "launched_vgv" DECIMAL(18,2) NOT NULL,
    "units_offered" INTEGER NOT NULL,
    "average_price_per_sqm_at_launch" DECIMAL(12,2) NOT NULL,
    "velocity_curve_first_6_months" JSONB NOT NULL,
    "source_provider" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_launch_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_scenarios" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "market_area_id" TEXT NOT NULL,
    "land_asset_id" TEXT,
    "project_id" TEXT,
    "name" TEXT NOT NULL,
    "kind" "ProductScenarioKind" NOT NULL DEFAULT 'BASE',
    "status" "ProductLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "standard" "MarketProductStandard" NOT NULL DEFAULT 'MEDIO',
    "positioning" TEXT,
    "total_units" INTEGER NOT NULL,
    "total_private_area_m2" DECIMAL(12,2) NOT NULL,
    "average_unit_area_m2" DECIMAL(8,2) NOT NULL,
    "target_vgv" DECIMAL(18,2) NOT NULL,
    "average_price_per_sqm" DECIMAL(12,2) NOT NULL,
    "average_ticket" DECIMAL(14,2) NOT NULL,
    "expected_velocity_units_month" DECIMAL(6,2) NOT NULL,
    "estimated_sales_duration_months" INTEGER NOT NULL,
    "confidence_level" "ConfidenceLevel" NOT NULL DEFAULT 'MEDIUM',
    "confidence_score" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT NOT NULL,
    "explainability_json" JSONB NOT NULL,
    "engine_assumptions_json" JSONB,
    "engine_results_json" JSONB,
    "amenities" JSONB,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_scenario_mix_lines" (
    "id" TEXT NOT NULL,
    "scenario_id" TEXT NOT NULL,
    "typology_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bedrooms" INTEGER NOT NULL,
    "suites" INTEGER NOT NULL DEFAULT 0,
    "bathrooms" INTEGER NOT NULL DEFAULT 1,
    "parking_spaces" INTEGER NOT NULL DEFAULT 1,
    "private_area_m2" DECIMAL(8,2) NOT NULL,
    "unit_count" INTEGER NOT NULL,
    "mix_percentage" DECIMAL(6,4) NOT NULL,
    "target_price_per_sqm" DECIMAL(12,2) NOT NULL,
    "target_unit_price" DECIMAL(14,2) NOT NULL,
    "expected_monthly_sales" DECIMAL(6,2),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_scenario_mix_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_decision_records" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "scenario_id" TEXT NOT NULL,
    "recommended_snapshot" JSONB NOT NULL,
    "approved_snapshot" JSONB NOT NULL,
    "deltas_json" JSONB NOT NULL,
    "decision" "ProductLifecycleStatus" NOT NULL,
    "decision_rationale" TEXT NOT NULL,
    "decided_by_id" TEXT NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "engine_version" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,

    CONSTRAINT "product_decision_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "market_areas_organization_id_city_state_idx" ON "market_areas"("organization_id", "city", "state");

-- CreateIndex
CREATE INDEX "market_areas_organization_id_land_asset_id_idx" ON "market_areas"("organization_id", "land_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "demographic_observations_organization_id_market_area_id_ref_key" ON "demographic_observations"("organization_id", "market_area_id", "reference_year", "source_provider");

-- CreateIndex
CREATE UNIQUE INDEX "income_observations_organization_id_market_area_id_referenc_key" ON "income_observations"("organization_id", "market_area_id", "reference_year", "source_provider");

-- CreateIndex
CREATE UNIQUE INDEX "affordability_policies_organization_id_name_version_key" ON "affordability_policies"("organization_id", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "market_comparability_policies_organization_id_name_version_key" ON "market_comparability_policies"("organization_id", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "amenity_catalog_items_organization_id_code_key" ON "amenity_catalog_items"("organization_id", "code");

-- CreateIndex
CREATE INDEX "market_developments_organization_id_market_area_id_stage_idx" ON "market_developments"("organization_id", "market_area_id", "stage");

-- CreateIndex
CREATE INDEX "market_developments_organization_id_latitude_longitude_idx" ON "market_developments"("organization_id", "latitude", "longitude");

-- CreateIndex
CREATE INDEX "market_price_observations_organization_id_development_id_ob_idx" ON "market_price_observations"("organization_id", "development_id", "observed_at");

-- CreateIndex
CREATE UNIQUE INDEX "market_inventory_snapshots_organization_id_development_id_a_key" ON "market_inventory_snapshots"("organization_id", "development_id", "as_of_date", "source_provider");

-- CreateIndex
CREATE INDEX "market_launch_history_organization_id_development_id_idx" ON "market_launch_history"("organization_id", "development_id");

-- CreateIndex
CREATE INDEX "product_scenarios_organization_id_status_idx" ON "product_scenarios"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_scenarios_organization_id_market_area_id_name_versi_key" ON "product_scenarios"("organization_id", "market_area_id", "name", "version");

-- CreateIndex
CREATE INDEX "product_scenario_mix_lines_scenario_id_idx" ON "product_scenario_mix_lines"("scenario_id");

-- CreateIndex
CREATE INDEX "product_decision_records_organization_id_decided_at_idx" ON "product_decision_records"("organization_id", "decided_at");

-- AddForeignKey
ALTER TABLE "market_areas" ADD CONSTRAINT "market_areas_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_areas" ADD CONSTRAINT "market_areas_land_asset_id_fkey" FOREIGN KEY ("land_asset_id") REFERENCES "land_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_areas" ADD CONSTRAINT "market_areas_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demographic_observations" ADD CONSTRAINT "demographic_observations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demographic_observations" ADD CONSTRAINT "demographic_observations_market_area_id_fkey" FOREIGN KEY ("market_area_id") REFERENCES "market_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_observations" ADD CONSTRAINT "income_observations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_observations" ADD CONSTRAINT "income_observations_market_area_id_fkey" FOREIGN KEY ("market_area_id") REFERENCES "market_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_developments" ADD CONSTRAINT "market_developments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_developments" ADD CONSTRAINT "market_developments_market_area_id_fkey" FOREIGN KEY ("market_area_id") REFERENCES "market_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_price_observations" ADD CONSTRAINT "market_price_observations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_price_observations" ADD CONSTRAINT "market_price_observations_development_id_fkey" FOREIGN KEY ("development_id") REFERENCES "market_developments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_inventory_snapshots" ADD CONSTRAINT "market_inventory_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_inventory_snapshots" ADD CONSTRAINT "market_inventory_snapshots_development_id_fkey" FOREIGN KEY ("development_id") REFERENCES "market_developments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_launch_history" ADD CONSTRAINT "market_launch_history_development_id_fkey" FOREIGN KEY ("development_id") REFERENCES "market_developments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_scenarios" ADD CONSTRAINT "product_scenarios_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_scenarios" ADD CONSTRAINT "product_scenarios_market_area_id_fkey" FOREIGN KEY ("market_area_id") REFERENCES "market_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_scenarios" ADD CONSTRAINT "product_scenarios_land_asset_id_fkey" FOREIGN KEY ("land_asset_id") REFERENCES "land_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_scenarios" ADD CONSTRAINT "product_scenarios_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_scenario_mix_lines" ADD CONSTRAINT "product_scenario_mix_lines_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "product_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_decision_records" ADD CONSTRAINT "product_decision_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_decision_records" ADD CONSTRAINT "product_decision_records_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "product_scenarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

