-- Fase 9S — encerramento do empreendimento, governança e resultado realizado.
-- Additive only — nenhuma migration anterior é editada. Aplicar somente após backup
-- real de dev e teste, restaurado e validado em banco isolado.
--
-- Só duas entidades novas (project_closure_results, project_closure_distributions) +
-- um valor novo em ProjectStatus (CLOSED). Nenhuma outra alteração de schema.
--
-- Imutabilidade estrutural incluída já na migration inicial (diferente do que
-- aconteceu na 9R, corrigida só depois de uma reauditoria): trigger condicional ao
-- estado terminal (OLD.status = 'FINAL'/'APPROVED') para UPDATE/DELETE — permite toda
-- transição legítima anterior e a própria transição PARA o estado terminal — e
-- bloqueio incondicional de TRUNCATE. Mesmo padrão de
-- 20260910151500_phase_9r_structural_immutability.

-- CreateEnum
CREATE TYPE "ProjectClosureResultStatus" AS ENUM ('DRAFT', 'FINAL');

-- CreateEnum
CREATE TYPE "ProjectClosureDistributionStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "ProjectDistributionBeneficiaryType" AS ENUM ('OWNER', 'PARTNER', 'INVESTOR');

-- CreateEnum
CREATE TYPE "ProjectDistributionNature" AS ENUM ('CAPITAL_CONTRIBUTION', 'CAPITAL_RETURN', 'REMUNERATION', 'RESULT_DISTRIBUTION', 'RETENTION', 'PROVISION');

-- AlterEnum
ALTER TYPE "ProjectStatus" ADD VALUE 'CLOSED';

-- CreateTable
CREATE TABLE "project_closure_results" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" TEXT,
    "status" "ProjectClosureResultStatus" NOT NULL DEFAULT 'DRAFT',
    "realized_vgv" DECIMAL(20,2),
    "realized_revenue" DECIMAL(20,2),
    "realized_cost" DECIMAL(20,2),
    "realized_expenses" DECIMAL(20,2),
    "realized_taxes" DECIMAL(20,2),
    "realized_financial_costs" DECIMAL(20,2),
    "realized_funding_disbursed" DECIMAL(20,2),
    "realized_capital_contributed" DECIMAL(20,2),
    "realized_refunds" DECIMAL(20,2),
    "realized_rescissions_amount" DECIMAL(20,2),
    "realized_rescissions_count" INTEGER,
    "realized_delinquency" DECIMAL(20,2),
    "realized_provisions" DECIMAL(20,2),
    "realized_result" DECIMAL(20,2),
    "realized_margin_on_vgv" DECIMAL(12,8),
    "realized_margin_on_net_revenue" DECIMAL(12,8),
    "realized_roi" DECIMAL(12,8),
    "realized_irr" DECIMAL(12,8),
    "evidence_status" JSONB NOT NULL,
    "revenue_recognition_run_id" TEXT,
    "financial_result_id" TEXT,
    "forecast_evaluation_ids" JSONB,
    "accounting_period_ids" JSONB,
    "assumption_snapshot_id" TEXT,
    "decision_refs" JSONB,
    "materialized_risk_refs" JSONB,
    "audit_log_milestone_ids" JSONB,
    "legal_due_diligence_case_id" TEXT,
    "gate_snapshot" JSONB,
    "key_deviations_notes" TEXT,
    "lessons_learned" TEXT,
    "correlation_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),

    CONSTRAINT "project_closure_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_closure_distributions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "closure_result_id" TEXT NOT NULL,
    "status" "ProjectClosureDistributionStatus" NOT NULL DEFAULT 'DRAFT',
    "beneficiary_name" TEXT NOT NULL,
    "beneficiary_tax_id" TEXT NOT NULL,
    "beneficiary_type" "ProjectDistributionBeneficiaryType" NOT NULL,
    "nature" "ProjectDistributionNature" NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "event_date" DATE NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "evidence_refs" JSONB NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),

    CONSTRAINT "project_closure_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_closure_results_supersedes_id_key" ON "project_closure_results"("supersedes_id");

-- CreateIndex
CREATE INDEX "project_closure_results_organization_id_project_id_status_idx" ON "project_closure_results"("organization_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_closure_results_organization_id_project_id_version_key" ON "project_closure_results"("organization_id", "project_id", "version");

-- CreateIndex
CREATE INDEX "project_closure_distributions_organization_id_project_id_st_idx" ON "project_closure_distributions"("organization_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "project_closure_distributions_closure_result_id_idx" ON "project_closure_distributions"("closure_result_id");

-- AddForeignKey
ALTER TABLE "project_closure_results" ADD CONSTRAINT "project_closure_results_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_closure_results" ADD CONSTRAINT "project_closure_results_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_closure_results" ADD CONSTRAINT "project_closure_results_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "project_closure_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_closure_distributions" ADD CONSTRAINT "project_closure_distributions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_closure_distributions" ADD CONSTRAINT "project_closure_distributions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_closure_distributions" ADD CONSTRAINT "project_closure_distributions_closure_result_id_fkey" FOREIGN KEY ("closure_result_id") REFERENCES "project_closure_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Imutabilidade estrutural — mesmo padrão de 20260910151500_phase_9r_structural_immutability.
CREATE FUNCTION rede_project_closure_result_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'PROJECT_CLOSURE_RESULT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'FINAL' THEN
    RAISE EXCEPTION 'PROJECT_CLOSURE_RESULT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER project_closure_result_immutable BEFORE UPDATE OR DELETE ON project_closure_results
FOR EACH ROW EXECUTE FUNCTION rede_project_closure_result_immutable();
CREATE TRIGGER project_closure_result_no_truncate BEFORE TRUNCATE ON project_closure_results
FOR EACH STATEMENT EXECUTE FUNCTION rede_project_closure_result_immutable();

CREATE FUNCTION rede_project_closure_distribution_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'PROJECT_CLOSURE_DISTRIBUTION_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'APPROVED' THEN
    RAISE EXCEPTION 'PROJECT_CLOSURE_DISTRIBUTION_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER project_closure_distribution_immutable BEFORE UPDATE OR DELETE ON project_closure_distributions
FOR EACH ROW EXECUTE FUNCTION rede_project_closure_distribution_immutable();
CREATE TRIGGER project_closure_distribution_no_truncate BEFORE TRUNCATE ON project_closure_distributions
FOR EACH STATEMENT EXECUTE FUNCTION rede_project_closure_distribution_immutable();
