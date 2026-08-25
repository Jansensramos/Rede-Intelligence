-- Fase 9K.4 — Fechamento Comercial 360 (Crédito → Proposta → Contrato → Assinatura → Recebíveis)
-- PROPOSTA PARA REVISÃO (v2 — ajustada após revisão) — NÃO EXECUTADA.
-- Nenhum `prisma migrate`/`db push`/`generate`/reset foi rodado. Único comando executado: `prisma validate`.

-- CreateEnum
CREATE TYPE "ContractTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContractTemplateVersionStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "ContractDocumentKind" AS ENUM ('MODEL_RENDER', 'ATTACHMENT', 'SIGNED_FINAL');

-- CreateEnum
CREATE TYPE "ContractDocumentStatus" AS ENUM ('DRAFT', 'FINAL');

-- CreateEnum
CREATE TYPE "SignatureProviderCode" AS ENUM ('MOCK', 'CLICKSIGN', 'MANUAL_UPLOAD');

-- CreateEnum
CREATE TYPE "SignatureRequestStatus" AS ENUM ('PREPARADO', 'ENVIADO', 'AGUARDANDO_ASSINATURAS', 'ASSINADO', 'RECUSADO', 'CANCELADO', 'ERRO');

-- CreateEnum
CREATE TYPE "SignatoryRole" AS ENUM ('BUYER', 'CO_BUYER', 'REPRESENTATIVE', 'GUARANTOR', 'SELLER', 'WITNESS');

-- CreateEnum
CREATE TYPE "SignaturePartyStatus" AS ENUM ('PENDING', 'SIGNED', 'DECLINED');

-- CreateEnum
CREATE TYPE "SignatureEventType" AS ENUM ('CREATED', 'SENT', 'PARTY_SIGNED', 'PARTY_DECLINED', 'COMPLETED', 'CANCELLED', 'ERROR');

-- CreateEnum
CREATE TYPE "CreditBureauProviderCode" AS ENUM ('MOCK', 'SERASA_EXPERIAN');

-- CreateEnum
CREATE TYPE "CreditConsultationPurpose" AS ENUM ('SALE_PROPOSAL_ANALYSIS', 'CONTRACT_RENEWAL', 'OTHER');

-- CreateEnum
CREATE TYPE "CreditConsultationStatus" AS ENUM ('REQUESTED', 'COMPLETED', 'ERROR');

-- CreateEnum
CREATE TYPE "CreditConsultationResult" AS ENUM ('SEM_RESTRICAO', 'COM_RESTRICAO', 'REQUER_ANALISE');

-- AlterTable (SalesContract ganha vínculo opcional com a versão de modelo usada)
ALTER TABLE "sales_contracts" ADD COLUMN "template_version_id" TEXT;

-- CreateTable
CREATE TABLE "contract_templates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ContractTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_template_versions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "variables" JSONB,
    "status" "ContractTemplateVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable (metadado + referência de storage — NUNCA o binário do documento)
CREATE TABLE "contract_documents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "template_version_id" TEXT,
    "kind" "ContractDocumentKind" NOT NULL,
    "status" "ContractDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "storage_provider" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "provider" "SignatureProviderCode" NOT NULL DEFAULT 'MOCK',
    "external_id" TEXT,
    "status" "SignatureRequestStatus" NOT NULL DEFAULT 'PREPARADO',
    "document_checksum" TEXT NOT NULL,
    "final_document_id" TEXT,
    "error_message" TEXT,
    "prepared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancelled_reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signature_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature_parties" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "external_party_id" TEXT,
    "display_name" TEXT NOT NULL,
    "email" TEXT,
    "role" "SignatoryRole" NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 1,
    "status" "SignaturePartyStatus" NOT NULL DEFAULT 'PENDING',
    "auth_method" TEXT,
    "evidence" JSONB,
    "signed_at" TIMESTAMP(3),
    "declined_at" TIMESTAMP(3),
    "declined_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signature_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable (projeção de domínio — append-only; sem colunas de processamento operacional, isso é do IntegrationInboxEvent/9H)
CREATE TABLE "signature_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "source_inbox_event_id" TEXT,
    "event_type" "SignatureEventType" NOT NULL,
    "payload" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signature_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_bureau_consultations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "customer_id" TEXT NOT NULL,
    "proposal_id" TEXT,
    "provider" "CreditBureauProviderCode" NOT NULL DEFAULT 'MOCK',
    "purpose" "CreditConsultationPurpose" NOT NULL DEFAULT 'SALE_PROPOSAL_ANALYSIS',
    "status" "CreditConsultationStatus" NOT NULL DEFAULT 'REQUESTED',
    "cpf_masked" TEXT NOT NULL,
    "external_reference" TEXT,
    "score" INTEGER,
    "findings_summary" JSONB,
    "result" "CreditConsultationResult",
    "error_message" TEXT,
    "requested_by_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "retention_until" TIMESTAMP(3),

    CONSTRAINT "credit_bureau_consultations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_contracts_template_version_id_idx" ON "sales_contracts"("template_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_templates_project_id_name_key" ON "contract_templates"("project_id", "name");

-- CreateIndex
CREATE INDEX "contract_templates_organization_id_status_idx" ON "contract_templates"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contract_template_versions_template_id_version_key" ON "contract_template_versions"("template_id", "version");

-- CreateIndex
CREATE INDEX "contract_template_versions_template_id_status_idx" ON "contract_template_versions"("template_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contract_documents_contract_id_kind_version_key" ON "contract_documents"("contract_id", "kind", "version");

-- CreateIndex
CREATE INDEX "contract_documents_contract_id_kind_idx" ON "contract_documents"("contract_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "signature_requests_final_document_id_key" ON "signature_requests"("final_document_id");

-- CreateIndex (item 2: externalId é único POR TENANT+PROVIDER, nunca globalmente)
CREATE UNIQUE INDEX "signature_requests_organization_id_provider_external_id_key" ON "signature_requests"("organization_id", "provider", "external_id");

-- CreateIndex
CREATE INDEX "signature_requests_organization_id_status_idx" ON "signature_requests"("organization_id", "status");

-- CreateIndex
CREATE INDEX "signature_requests_contract_id_idx" ON "signature_requests"("contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "signature_parties_request_id_order_key" ON "signature_parties"("request_id", "order");

-- CreateIndex
CREATE INDEX "signature_parties_request_id_status_idx" ON "signature_parties"("request_id", "status");

-- CreateIndex
CREATE INDEX "signature_parties_customer_id_idx" ON "signature_parties"("customer_id");

-- CreateIndex (item 3: no máximo uma projeção de domínio por IntegrationInboxEvent já processado)
CREATE UNIQUE INDEX "signature_events_source_inbox_event_id_key" ON "signature_events"("source_inbox_event_id");

-- CreateIndex
CREATE INDEX "signature_events_request_id_recorded_at_idx" ON "signature_events"("request_id", "recorded_at");

-- CreateIndex
CREATE INDEX "credit_bureau_consultations_organization_id_customer_id_idx" ON "credit_bureau_consultations"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "credit_bureau_consultations_proposal_id_idx" ON "credit_bureau_consultations"("proposal_id");

-- AddForeignKey
ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "contract_template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_template_versions" ADD CONSTRAINT "contract_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "contract_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "sales_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "contract_template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "sales_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "contract_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (item 8: documento final é evidência histórica crítica — RESTRICT, não SET NULL)
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_final_document_id_fkey" FOREIGN KEY ("final_document_id") REFERENCES "contract_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_parties" ADD CONSTRAINT "signature_parties_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "signature_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (item 5/8: cross-reference auxiliar — snapshot no próprio registro é a evidência)
ALTER TABLE "signature_parties" ADD CONSTRAINT "signature_parties_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_events" ADD CONSTRAINT "signature_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "signature_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (item 3: vínculo opcional 1:1 com o evento cru já idempotente da 9H)
ALTER TABLE "signature_events" ADD CONSTRAINT "signature_events_source_inbox_event_id_fkey" FOREIGN KEY ("source_inbox_event_id") REFERENCES "integration_inbox_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_bureau_consultations" ADD CONSTRAINT "credit_bureau_consultations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_bureau_consultations" ADD CONSTRAINT "credit_bureau_consultations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_bureau_consultations" ADD CONSTRAINT "credit_bureau_consultations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_bureau_consultations" ADD CONSTRAINT "credit_bureau_consultations_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "sales_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
