-- Fase 9R — Repasse bancário, Chaves (gates de entrega + condomínio) e Assistência
-- técnica. Aditiva, aplicada somente após backup real verificado (ver
-- docs/PHASE_9R_AUDIT_RECORD.md). Não altera nenhuma migration/tabela antiga.
--
-- Nota: `prisma migrate diff` também reportou 6 alterações pré-existentes e não
-- relacionadas a esta fase (tipo da coluna `funding_proposals.currency`, renomeação de
-- uma foreign key de `auto_budget_line_review_evidence` e 4 renomeações de índice por
-- truncamento de identificador do PostgreSQL) — confirmado por diff contra o HEAD
-- original (sem nenhuma mudança da 9R) antes desta migration ser escrita. Essas 6
-- alterações são drift pré-existente entre schema.prisma e o histórico de migrations,
-- não pertencem à 9R e foram deliberadamente excluídas deste arquivo.

-- CreateEnum
CREATE TYPE "PostSaleEvidenceKind" AS ENUM ('BEFORE', 'AFTER');

-- CreateEnum
CREATE TYPE "BankFinancingDisbursementType" AS ENUM ('FINANCING', 'FGTS', 'SUBSIDY', 'OTHER');

-- CreateEnum
CREATE TYPE "BankFinancingDisbursementStatus" AS ENUM ('PENDING', 'REQUESTED', 'DISBURSED', 'RECONCILED', 'DIVERGENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CondominiumSetupStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'IMPLEMENTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "post_sale_requests" ADD COLUMN     "actual_cost" DECIMAL(20,2),
ADD COLUMN     "estimated_cost" DECIMAL(20,2),
ADD COLUMN     "recurrence_of_id" TEXT,
ADD COLUMN     "supplier_id" TEXT;

-- AlterTable
ALTER TABLE "post_sale_updates" ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "evidence_kind" "PostSaleEvidenceKind",
ADD COLUMN     "file_name" TEXT,
ADD COLUMN     "file_size" INTEGER,
ADD COLUMN     "mime_type" TEXT,
ADD COLUMN     "storage_key" TEXT;

-- CreateTable
CREATE TABLE "bank_financing_disbursements" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "financial_institution_id" TEXT NOT NULL,
    "disbursement_type" "BankFinancingDisbursementType" NOT NULL,
    "expected_amount" DECIMAL(20,2) NOT NULL,
    "disbursed_amount" DECIMAL(20,2),
    "bank_reference" TEXT,
    "status" "BankFinancingDisbursementStatus" NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMP(3),
    "disbursed_at" TIMESTAMP(3),
    "reconciled_at" TIMESTAMP(3),
    "reconciled_installment_id" TEXT,
    "reconciled_payment_id" TEXT,
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_financing_disbursements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "condominium_setups" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "status" "CondominiumSetupStatus" NOT NULL DEFAULT 'PLANNED',
    "administrator_supplier_id" TEXT,
    "responsible_id" TEXT NOT NULL,
    "constituted_at" TIMESTAMP(3),
    "transferred_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "condominium_setups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_financing_disbursements_organization_id_sale_id_idx" ON "bank_financing_disbursements"("organization_id", "sale_id");

-- CreateIndex
CREATE INDEX "bank_financing_disbursements_organization_id_status_idx" ON "bank_financing_disbursements"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "condominium_setups_project_id_key" ON "condominium_setups"("project_id");

-- CreateIndex
CREATE INDEX "condominium_setups_organization_id_status_idx" ON "condominium_setups"("organization_id", "status");

-- CreateIndex
CREATE INDEX "post_sale_requests_supplier_id_idx" ON "post_sale_requests"("supplier_id");

-- CreateIndex
CREATE INDEX "post_sale_requests_recurrence_of_id_idx" ON "post_sale_requests"("recurrence_of_id");

-- AddForeignKey
ALTER TABLE "post_sale_requests" ADD CONSTRAINT "post_sale_requests_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_sale_requests" ADD CONSTRAINT "post_sale_requests_recurrence_of_id_fkey" FOREIGN KEY ("recurrence_of_id") REFERENCES "post_sale_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_financing_disbursements" ADD CONSTRAINT "bank_financing_disbursements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_financing_disbursements" ADD CONSTRAINT "bank_financing_disbursements_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_financing_disbursements" ADD CONSTRAINT "bank_financing_disbursements_financial_institution_id_fkey" FOREIGN KEY ("financial_institution_id") REFERENCES "financial_institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "condominium_setups" ADD CONSTRAINT "condominium_setups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "condominium_setups" ADD CONSTRAINT "condominium_setups_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "condominium_setups" ADD CONSTRAINT "condominium_setups_administrator_supplier_id_fkey" FOREIGN KEY ("administrator_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
