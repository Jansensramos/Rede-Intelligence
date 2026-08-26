-- Fase 9N — Capital & Funding Intelligence.
-- PROPOSTA PARA REVISÃO (v3 — desembolso ligado a fato financeiro real do 9B + idempotência do
-- serviço da dívida com schedule_version/installment_number separados) — NÃO EXECUTADA.
-- Nenhum `prisma migrate`/`db push`/`generate`/reset foi rodado. Comandos executados: `prisma
-- validate` e `prisma format`. Esta pasta existe só para dar a revisão humana um `migration.sql`
-- concreto para ler (mesmo padrão já usado em 20260825120000_phase_9k_commercial_closing) — a
-- pasta não foi registrada em `_prisma_migrations` porque nenhum comando de migração rodou.

-- CreateEnum
CREATE TYPE "FundingProposalKind" AS ENUM ('EQUITY_PROPRIO', 'INVESTIDOR', 'MUTUO', 'BANCO', 'FINANCIAMENTO_PRODUCAO', 'SBPE', 'FGTS', 'CRI', 'SECURITIZACAO', 'FUNDO', 'MEZANINO', 'PERMUTA_FINANCEIRA', 'PERMUTA_ECONOMICA', 'HIBRIDO', 'OUTRO');

-- CreateEnum
CREATE TYPE "FundingIndexer" AS ENUM ('CDI', 'IPCA', 'IGPM', 'TR', 'SELIC', 'PRE_FIXADO', 'OUTRO');

-- CreateEnum
CREATE TYPE "FundingAmortizationSystem" AS ENUM ('PRICE', 'SAC', 'BULLET');

-- CreateEnum (hoje só MONTHLY é suportado pelo motor — ver comentário no schema.prisma)
CREATE TYPE "FundingPaymentFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'BULLET_AT_MATURITY');

-- CreateEnum
CREATE TYPE "FundingProposalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "FundingGuaranteeType" AS ENUM ('GARANTIA_REAL', 'CESSAO_FIDUCIARIA', 'RECEBIVEIS', 'QUOTAS_ACOES', 'AVAL_FIANCA', 'CONTA_VINCULADA', 'OUTRA');

-- CreateEnum
CREATE TYPE "FundingGuaranteeStatus" AS ENUM ('PENDING', 'FORMALIZED', 'ACTIVE', 'RELEASED');

-- CreateEnum
CREATE TYPE "FundingCovenantStatus" AS ENUM ('OK', 'WARNING', 'BREACHED', 'WAIVED');

-- CreateEnum
CREATE TYPE "FundingConditionCategory" AS ENUM ('DOCUMENTO', 'LICENCA', 'REGISTRO', 'GARANTIA', 'SEGURO', 'APORTE', 'VENDA_MINIMA', 'OBRA_MINIMA', 'OUTRO');

-- CreateEnum
CREATE TYPE "FundingConditionStatus" AS ENUM ('PENDING', 'SATISFIED', 'WAIVED', 'REJECTED');

-- CreateEnum (item 4: só DISBURSED pode virar caixa realizado)
CREATE TYPE "FundingDisbursementStatus" AS ENUM ('PLANNED', 'REQUESTED', 'APPROVED', 'DISBURSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FundingFinancialEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'REVERSED', 'FAILED');

-- CreateTable (item 2/3: version+previousVersionId em vez de sobrescrever termos aprovados; taxas sempre em pontos percentuais)
CREATE TABLE "funding_proposals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "previous_version_id" TEXT,
    "provider_name" TEXT NOT NULL,
    "kind" "FundingProposalKind" NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "indexer" "FundingIndexer" NOT NULL,
    "spread_rate" DECIMAL(8,4) NOT NULL,
    "indexer_rate_snapshot" DECIMAL(8,4),
    "annual_nominal_rate" DECIMAL(8,4) NOT NULL,
    "term_months" INTEGER NOT NULL,
    "grace_months" INTEGER NOT NULL,
    "amortization_system" "FundingAmortizationSystem" NOT NULL,
    "payment_frequency" "FundingPaymentFrequency" NOT NULL DEFAULT 'MONTHLY',
    "upfront_fee_rate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "recurring_fee_rate_annual" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "iof_rate" DECIMAL(6,4),
    "disbursement_schedule" JSONB,
    "valid_until" DATE,
    "notes" TEXT,
    "status" "FundingProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "decision_snapshot" JSONB,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable (item 4: expected* planejado vs actual* só quando DISBURSED; bank_transaction_id é o
-- fato financeiro real do 9B que confirma o desembolso — sem segunda tesouraria)
CREATE TABLE "funding_disbursements" (
    "id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "expected_date" DATE NOT NULL,
    "expected_amount" DECIMAL(20,2) NOT NULL,
    "status" "FundingDisbursementStatus" NOT NULL DEFAULT 'PLANNED',
    "requested_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "bank_transaction_id" TEXT,
    "actual_date" TIMESTAMP(3),
    "actual_amount" DECIMAL(20,2),
    "external_reference" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_disbursements_pkey" PRIMARY KEY ("id")
);

-- CreateTable (item 1/9: distinta de LegalGuarantee — beneficiário é o financiador, não a SPE; evidência via ProcurementDocumentLink)
CREATE TABLE "funding_guarantees" (
    "id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "type" "FundingGuaranteeType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(20,2),
    "beneficiary" TEXT,
    "status" "FundingGuaranteeStatus" NOT NULL DEFAULT 'PENDING',
    "evidence_document_ids" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_guarantees_pkey" PRIMARY KEY ("id")
);

-- CreateTable (item 7: cache do teste mais recente — histórico completo em funding_covenant_evaluations)
CREATE TABLE "funding_covenants" (
    "id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "threshold_operator" TEXT NOT NULL,
    "threshold_value" TEXT NOT NULL,
    "periodicity" TEXT NOT NULL,
    "next_test_date" DATE,
    "status" "FundingCovenantStatus" NOT NULL DEFAULT 'OK',
    "last_checked_at" TIMESTAMP(3),
    "last_value" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_covenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable (item 7: um registro por teste — append-only, nunca update)
CREATE TABLE "funding_covenant_evaluations" (
    "id" TEXT NOT NULL,
    "covenant_id" TEXT NOT NULL,
    "tested_at" DATE NOT NULL,
    "observed_value" TEXT NOT NULL,
    "result" "FundingCovenantStatus" NOT NULL,
    "evidence" JSONB,
    "tested_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funding_covenant_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable (item 8: distinta de LegalContractCondition/InvestmentCondition; source_type/source_id apontam para a 9D quando aplicável)
CREATE TABLE "funding_conditions" (
    "id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" "FundingConditionCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "FundingConditionStatus" NOT NULL DEFAULT 'PENDING',
    "due_at" DATE,
    "responsible_id" TEXT,
    "source_type" TEXT,
    "source_id" TEXT,
    "evidence" JSONB,
    "satisfied_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable (item 6: só ponte idempotente para 9B — nunca cria payable diretamente.
-- schedule_version e installment_number são conceitos separados: installment_number é a posição
-- estável da parcela na vida do empréstimo, schedule_version é a versão do cronograma inteiro)
CREATE TABLE "funding_financial_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "schedule_version" INTEGER NOT NULL DEFAULT 1,
    "installment_number" INTEGER NOT NULL,
    "financial_obligation_id" TEXT,
    "payable_account_id" TEXT,
    "event_type" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload_checksum" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "FundingFinancialEventStatus" NOT NULL DEFAULT 'PENDING',
    "processed_at" TIMESTAMP(3),
    "reversed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_financial_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (item 2: identificador humano estável, único por projeto+versão — mesmo padrão de legal_licenses)
CREATE UNIQUE INDEX "funding_proposals_project_id_code_version_key" ON "funding_proposals"("project_id", "code", "version");

-- CreateIndex
CREATE INDEX "funding_proposals_organization_id_project_id_status_idx" ON "funding_proposals"("organization_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "funding_disbursements_proposal_id_sequence_key" ON "funding_disbursements"("proposal_id", "sequence");

-- CreateIndex (item 1: uma transação bancária confirma no máximo um desembolso)
CREATE UNIQUE INDEX "funding_disbursements_bank_transaction_id_key" ON "funding_disbursements"("bank_transaction_id");

-- CreateIndex
CREATE INDEX "funding_disbursements_proposal_id_status_idx" ON "funding_disbursements"("proposal_id", "status");

-- CreateIndex
CREATE INDEX "funding_guarantees_proposal_id_status_idx" ON "funding_guarantees"("proposal_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "funding_covenants_proposal_id_code_key" ON "funding_covenants"("proposal_id", "code");

-- CreateIndex
CREATE INDEX "funding_covenants_proposal_id_status_next_test_date_idx" ON "funding_covenants"("proposal_id", "status", "next_test_date");

-- CreateIndex (item 7: no máximo um teste de covenant por data)
CREATE UNIQUE INDEX "funding_covenant_evaluations_covenant_id_tested_at_key" ON "funding_covenant_evaluations"("covenant_id", "tested_at");

-- CreateIndex
CREATE INDEX "funding_covenant_evaluations_covenant_id_result_idx" ON "funding_covenant_evaluations"("covenant_id", "result");

-- CreateIndex
CREATE UNIQUE INDEX "funding_conditions_proposal_id_code_key" ON "funding_conditions"("proposal_id", "code");

-- CreateIndex
CREATE INDEX "funding_conditions_proposal_id_status_due_at_idx" ON "funding_conditions"("proposal_id", "status", "due_at");

-- CreateIndex (item 6: idempotência real — replay do mesmo evento nunca duplica)
CREATE UNIQUE INDEX "funding_financial_events_idempotency_key_key" ON "funding_financial_events"("idempotency_key");

-- CreateIndex (item 2: no máximo um evento por proposta+tipo+versão de cronograma+parcela — zero dupla obrigação por construção)
CREATE UNIQUE INDEX "funding_financial_events_proposal_id_event_type_schedule_v_key" ON "funding_financial_events"("proposal_id", "event_type", "schedule_version", "installment_number");

-- CreateIndex
CREATE INDEX "funding_financial_events_organization_id_project_id_status_idx" ON "funding_financial_events"("organization_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "funding_financial_events_proposal_id_installment_number_idx" ON "funding_financial_events"("proposal_id", "installment_number");

-- AddForeignKey (item 10: tenant obrigatório em todo fato de topo)
ALTER TABLE "funding_proposals" ADD CONSTRAINT "funding_proposals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_proposals" ADD CONSTRAINT "funding_proposals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (item 2: versão anterior nunca é apagada silenciosamente — RESTRICT, não CASCADE/SET NULL)
ALTER TABLE "funding_proposals" ADD CONSTRAINT "funding_proposals_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "funding_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (item 11: histórico crítico — RESTRICT em toda filha, nunca CASCADE)
ALTER TABLE "funding_disbursements" ADD CONSTRAINT "funding_disbursements_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "funding_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (item 1: mesma tesouraria do 9B — sem tabela de transação bancária paralela)
ALTER TABLE "funding_disbursements" ADD CONSTRAINT "funding_disbursements_bank_transaction_id_fkey" FOREIGN KEY ("bank_transaction_id") REFERENCES "bank_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_guarantees" ADD CONSTRAINT "funding_guarantees_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "funding_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_covenants" ADD CONSTRAINT "funding_covenants_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "funding_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_covenant_evaluations" ADD CONSTRAINT "funding_covenant_evaluations_covenant_id_fkey" FOREIGN KEY ("covenant_id") REFERENCES "funding_covenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_conditions" ADD CONSTRAINT "funding_conditions_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "funding_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_financial_events" ADD CONSTRAINT "funding_financial_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_financial_events" ADD CONSTRAINT "funding_financial_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_financial_events" ADD CONSTRAINT "funding_financial_events_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "funding_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
