-- FASE 9I (continuação) — Fundação de Quantidades BIM, Composições e campos
-- de reprodutibilidade do AnalyticalDatasetVersion. Migration aditiva; não
-- altera nenhuma migration anterior. analytical_dataset_versions está vazia
-- nesta base (nenhum dataset foi gerado ainda), por isso as novas colunas
-- podem ser NOT NULL sem valor padrão.

-- AlterTable
ALTER TABLE "analytical_dataset_versions"
  ADD COLUMN "snapshot_date" DATE NOT NULL,
  ADD COLUMN "source_versions" JSONB NOT NULL,
  ADD COLUMN "parameters" JSONB NOT NULL,
  ADD COLUMN "features" JSONB NOT NULL,
  ADD COLUMN "lineage" JSONB NOT NULL,
  ADD COLUMN "quality" JSONB NOT NULL,
  ADD COLUMN "engine_version" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "analytical_dataset_versions_organization_id_checksum_idx" ON "analytical_dataset_versions"("organization_id", "checksum");

-- CreateEnum
CREATE TYPE "BimQuantityKind" AS ENUM ('LENGTH', 'AREA', 'VOLUME', 'WEIGHT', 'COUNT');

-- CreateEnum
CREATE TYPE "QuantityExtractionMethod" AS ENUM ('MANUAL', 'IFC_PROPERTY', 'GEOMETRY_DERIVED');

-- CreateEnum
CREATE TYPE "HumanReviewStatus" AS ENUM ('DRAFT', 'REVIEWED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CompositionInputType" AS ENUM ('MATERIAL', 'LABOR', 'EQUIPMENT');

-- CreateTable
CREATE TABLE "bim_quantity_mappings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "bim_element_id" TEXT NOT NULL,
    "economic_item_id" TEXT NOT NULL,
    "ifc_classification" TEXT NOT NULL,
    "quantity_kind" "BimQuantityKind" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "extraction_method" "QuantityExtractionMethod" NOT NULL,
    "confidence_level" "ConfidenceLevel" NOT NULL,
    "provenance" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "HumanReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "checksum" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bim_quantity_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_composition_definitions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "output_description" TEXT NOT NULL,
    "output_unit" TEXT NOT NULL,
    "region" TEXT,
    "product_standard" TEXT,
    "constructive_method" TEXT,
    "economic_item_id" TEXT,
    "source" TEXT NOT NULL,
    "status" "MetricStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "checksum" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_composition_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_composition_items" (
    "id" TEXT NOT NULL,
    "composition_id" TEXT NOT NULL,
    "input_type" "CompositionInputType" NOT NULL,
    "economic_item_id" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "coefficient" DECIMAL(18,6) NOT NULL,
    "productivity" DECIMAL(18,6),
    "wastage_rate" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cost_composition_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bim_quantity_mappings_organization_id_bim_element_id_econ_key" ON "bim_quantity_mappings"("organization_id", "bim_element_id", "economic_item_id", "version");

-- CreateIndex
CREATE INDEX "bim_quantity_mappings_organization_id_project_id_status_idx" ON "bim_quantity_mappings"("organization_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "bim_quantity_mappings_economic_item_id_idx" ON "bim_quantity_mappings"("economic_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_composition_definitions_organization_id_key_version_key" ON "cost_composition_definitions"("organization_id", "key", "version");

-- CreateIndex
CREATE INDEX "cost_composition_definitions_organization_id_status_idx" ON "cost_composition_definitions"("organization_id", "status");

-- CreateIndex
CREATE INDEX "cost_composition_items_composition_id_idx" ON "cost_composition_items"("composition_id");

-- AddForeignKey
ALTER TABLE "bim_quantity_mappings" ADD CONSTRAINT "bim_quantity_mappings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bim_quantity_mappings" ADD CONSTRAINT "bim_quantity_mappings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bim_quantity_mappings" ADD CONSTRAINT "bim_quantity_mappings_bim_element_id_fkey" FOREIGN KEY ("bim_element_id") REFERENCES "bim_elements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bim_quantity_mappings" ADD CONSTRAINT "bim_quantity_mappings_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_composition_definitions" ADD CONSTRAINT "cost_composition_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_composition_definitions" ADD CONSTRAINT "cost_composition_definitions_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_composition_items" ADD CONSTRAINT "cost_composition_items_composition_id_fkey" FOREIGN KEY ("composition_id") REFERENCES "cost_composition_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_composition_items" ADD CONSTRAINT "cost_composition_items_economic_item_id_fkey" FOREIGN KEY ("economic_item_id") REFERENCES "economic_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
