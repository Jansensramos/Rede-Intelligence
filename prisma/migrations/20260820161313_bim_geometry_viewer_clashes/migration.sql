-- CreateEnum
CREATE TYPE "BimModelStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'PROCESSED', 'ERROR');

-- CreateEnum
CREATE TYPE "BimClashType" AS ENUM ('HARD', 'CLEARANCE', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "BimClashStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'ACCEPTED', 'RESOLVED', 'DISCARDED');

-- AlterTable
ALTER TABLE "design_clashes" ADD COLUMN     "clearance_mm" DECIMAL(12,4),
ADD COLUMN     "coordinate" JSONB,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "element_a_id" TEXT,
ADD COLUMN     "element_b_id" TEXT,
ADD COLUMN     "finding_id" TEXT,
ADD COLUMN     "model_id" TEXT,
ADD COLUMN     "origin" "DesignDataOrigin" NOT NULL DEFAULT 'CALCULATED',
ADD COLUMN     "owner_id" TEXT,
ADD COLUMN     "resolved_at" TIMESTAMP(3),
ADD COLUMN     "updated_at" TIMESTAMP(3);

-- Preserve every existing clash while normalizing legacy free-text values.
UPDATE "design_clashes" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "design_clashes" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "design_clashes"
ALTER COLUMN "clash_type" TYPE "BimClashType"
USING CASE UPPER("clash_type")
  WHEN 'CLEARANCE' THEN 'CLEARANCE'::"BimClashType"
  WHEN 'DUPLICATE' THEN 'DUPLICATE'::"BimClashType"
  ELSE 'HARD'::"BimClashType"
END;

ALTER TABLE "design_clashes" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "design_clashes"
ALTER COLUMN "status" TYPE "BimClashStatus"
USING CASE "status"::text
  WHEN 'OPEN' THEN 'OPEN'::"BimClashStatus"
  WHEN 'UNDER_REVIEW' THEN 'UNDER_REVIEW'::"BimClashStatus"
  WHEN 'ACCEPTED' THEN 'ACCEPTED'::"BimClashStatus"
  WHEN 'RESOLVED' THEN 'RESOLVED'::"BimClashStatus"
  ELSE 'DISCARDED'::"BimClashStatus"
END;
ALTER TABLE "design_clashes" ALTER COLUMN "status" SET DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE "bim_models" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "revision_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "status" "BimModelStatus" NOT NULL DEFAULT 'UPLOADED',
    "ifc_schema" TEXT,
    "geometry_key" TEXT,
    "geometry_checksum" TEXT,
    "spatial_tree" JSONB,
    "bounds" JSONB,
    "element_count" INTEGER NOT NULL DEFAULT 0,
    "triangle_count" INTEGER NOT NULL DEFAULT 0,
    "fragment_count" INTEGER NOT NULL DEFAULT 0,
    "processing_ms" INTEGER,
    "load_estimate_ms" INTEGER,
    "error_message" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bim_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bim_elements" (
    "id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "express_id" INTEGER NOT NULL,
    "ifc_guid" TEXT,
    "ifc_type" TEXT NOT NULL,
    "name" TEXT,
    "code" TEXT,
    "discipline" TEXT,
    "parent_express_id" INTEGER,
    "building" TEXT,
    "tower" TEXT,
    "storey" TEXT,
    "space" TEXT,
    "geometry" JSONB,
    "bounds" JSONB,
    "centroid" JSONB,
    "properties" JSONB,
    "quantities" JSONB,
    "fingerprint" TEXT NOT NULL,
    "confidence" "DesignConfidence" NOT NULL DEFAULT 'HIGH',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bim_elements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bim_revision_comparisons" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "revision_from_id" TEXT NOT NULL,
    "revision_to_id" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "tolerance" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bim_revision_comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bim_models_file_id_key" ON "bim_models"("file_id");

-- CreateIndex
CREATE INDEX "bim_models_organization_id_project_id_status_idx" ON "bim_models"("organization_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "bim_models_package_id_revision_id_idx" ON "bim_models"("package_id", "revision_id");

-- CreateIndex
CREATE INDEX "bim_elements_model_id_ifc_guid_idx" ON "bim_elements"("model_id", "ifc_guid");

-- CreateIndex
CREATE INDEX "bim_elements_model_id_ifc_type_storey_idx" ON "bim_elements"("model_id", "ifc_type", "storey");

-- CreateIndex
CREATE UNIQUE INDEX "bim_elements_model_id_express_id_key" ON "bim_elements"("model_id", "express_id");

-- CreateIndex
CREATE UNIQUE INDEX "bim_revision_comparisons_package_id_revision_from_id_revisi_key" ON "bim_revision_comparisons"("package_id", "revision_from_id", "revision_to_id");

-- AddForeignKey
ALTER TABLE "bim_models" ADD CONSTRAINT "bim_models_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bim_models" ADD CONSTRAINT "bim_models_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bim_models" ADD CONSTRAINT "bim_models_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "design_project_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bim_models" ADD CONSTRAINT "bim_models_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "design_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bim_models" ADD CONSTRAINT "bim_models_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "design_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bim_elements" ADD CONSTRAINT "bim_elements_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "bim_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bim_revision_comparisons" ADD CONSTRAINT "bim_revision_comparisons_revision_from_id_fkey" FOREIGN KEY ("revision_from_id") REFERENCES "design_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bim_revision_comparisons" ADD CONSTRAINT "bim_revision_comparisons_revision_to_id_fkey" FOREIGN KEY ("revision_to_id") REFERENCES "design_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_clashes" ADD CONSTRAINT "design_clashes_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "bim_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_clashes" ADD CONSTRAINT "design_clashes_element_a_id_fkey" FOREIGN KEY ("element_a_id") REFERENCES "bim_elements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_clashes" ADD CONSTRAINT "design_clashes_element_b_id_fkey" FOREIGN KEY ("element_b_id") REFERENCES "bim_elements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
