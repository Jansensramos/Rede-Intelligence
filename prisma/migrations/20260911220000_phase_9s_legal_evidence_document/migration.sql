-- Fase 9S — correção estrutural final: evidência jurídica canônica.
-- Additive only — nenhuma migration anterior é editada. Aplicar somente após
-- backup real de dev e teste, restaurado e validado em banco isolado.
--
-- Contexto (ver docs/PHASE_9S_CONTRACT.md §21): LegalDocumentRequest.documentLinkId,
-- LegalChecklistItem.evidenceDocumentIds e LegalAssetRegistration.sourceDocumentLinkId
-- continuam sendo strings livres sem FK e sem verificação — não são tocados, não são
-- migrados automaticamente e NUNCA passam a satisfazer o gate. Esta migration cria uma
-- fonte de evidência canônica e verificável (LegalEvidenceDocument) que o gate 9S deve
-- consultar para qualquer decisão positiva daqui em diante (rewiring de aplicação fora
-- desta migration).
--
-- Nenhum conteúdo binário entra no Postgres — só metadado do FileStorageProvider
-- genérico já existente (storage_provider + storage_key + checksum + size_bytes).
--
-- Estados: PENDING_REVIEW (mutável), VERIFIED (imutável exceto a transição para
-- REVOKED), REJECTED (imutável, terminal), REVOKED (imutável, terminal). Enums
-- existentes (DocumentStatus, LegalItemStatus) foram avaliados e rejeitados — nenhum
-- tem semântica de VERIFIED-com-prova-de-existência nem REVOKED; ver contrato §21.3.
--
-- Integridade estrutural que FK simples não expressa (organização/projeto/caso e
-- vínculo documentRequestId/checklistItemId pertencerem ao MESMO caso) é garantida por
-- trigger BEFORE INSERT OR UPDATE, mesmo padrão de
-- rede_validate_signature_reconciliation_evidence
-- (20260905220000_phase_9p3a_immutable_signature_evidence). Exatamente um vínculo
-- semântico (documentRequestId XOR checklistItemId) é exigido por CHECK — combinação
-- ambígua é rejeitada por não haver justificativa de domínio para permitir ambos.
--
-- Imutabilidade: mesmo padrão condicional-ao-estado-terminal de
-- 20260910151500_phase_9r_structural_immutability, com uma única exceção adicional —
-- a técnica de "protected column diff" de rede_protect_signature_evidence_context —
-- que permite VERIFIED -> REVOKED alterando apenas status/revoked_by_id/revoked_at/
-- revoked_reason/updated_at, preservando o snapshot histórico original em vez de
-- sobrescrevê-lo. REJECTED e REVOKED são totalmente imutáveis. DELETE só é permitido
-- enquanto PENDING_REVIEW. TRUNCATE é sempre bloqueado.

-- CreateEnum
CREATE TYPE "LegalEvidenceDocumentStatus" AS ENUM ('PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'REVOKED');

-- CreateTable
CREATE TABLE "legal_evidence_documents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "diligence_case_id" TEXT NOT NULL,
    "document_request_id" TEXT,
    "checklist_item_id" TEXT,
    "storage_provider" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "LegalEvidenceDocumentStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "uploaded_by_id" TEXT NOT NULL,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "revoked_by_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_evidence_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legal_evidence_documents_checksum_check" CHECK ("checksum" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "legal_evidence_documents_storage_key_check" CHECK (length(btrim("storage_key")) > 0),
    CONSTRAINT "legal_evidence_documents_content_type_check" CHECK (length(btrim("content_type")) > 0),
    CONSTRAINT "legal_evidence_documents_storage_provider_check" CHECK (length(btrim("storage_provider")) > 0),
    CONSTRAINT "legal_evidence_documents_size_bytes_check" CHECK ("size_bytes" > 0),
    CONSTRAINT "legal_evidence_documents_link_xor_check" CHECK ((("document_request_id" IS NOT NULL))::int + (("checklist_item_id" IS NOT NULL))::int = 1),
    CONSTRAINT "legal_evidence_documents_status_consistency_check" CHECK (
      ("status" = 'PENDING_REVIEW' AND "reviewed_by_id" IS NULL AND "reviewed_at" IS NULL AND "revoked_by_id" IS NULL AND "revoked_at" IS NULL AND "revoked_reason" IS NULL)
      OR ("status" IN ('VERIFIED', 'REJECTED') AND "reviewed_by_id" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "revoked_by_id" IS NULL AND "revoked_at" IS NULL AND "revoked_reason" IS NULL)
      OR ("status" = 'REVOKED' AND "reviewed_by_id" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "revoked_by_id" IS NOT NULL AND "revoked_at" IS NOT NULL AND "revoked_reason" IS NOT NULL AND length(btrim("revoked_reason")) > 0)
    )
);

-- CreateIndex
CREATE INDEX "legal_evidence_documents_organization_id_project_id_diligen_idx" ON "legal_evidence_documents"("organization_id", "project_id", "diligence_case_id");

-- CreateIndex
CREATE INDEX "legal_evidence_documents_document_request_id_status_idx" ON "legal_evidence_documents"("document_request_id", "status");

-- CreateIndex
CREATE INDEX "legal_evidence_documents_checklist_item_id_status_idx" ON "legal_evidence_documents"("checklist_item_id", "status");

-- AddForeignKey
ALTER TABLE "legal_evidence_documents" ADD CONSTRAINT "legal_evidence_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_evidence_documents" ADD CONSTRAINT "legal_evidence_documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_evidence_documents" ADD CONSTRAINT "legal_evidence_documents_diligence_case_id_fkey" FOREIGN KEY ("diligence_case_id") REFERENCES "legal_due_diligence_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_evidence_documents" ADD CONSTRAINT "legal_evidence_documents_document_request_id_fkey" FOREIGN KEY ("document_request_id") REFERENCES "legal_document_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_evidence_documents" ADD CONSTRAINT "legal_evidence_documents_checklist_item_id_fkey" FOREIGN KEY ("checklist_item_id") REFERENCES "legal_checklist_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_evidence_documents" ADD CONSTRAINT "legal_evidence_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_evidence_documents" ADD CONSTRAINT "legal_evidence_documents_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_evidence_documents" ADD CONSTRAINT "legal_evidence_documents_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integridade estrutural cross-tabela que FK simples não expressa: organização/
-- projeto do caso devem coincidir com organização/projeto da evidência, e
-- document_request_id/checklist_item_id, quando presentes, devem pertencer ao MESMO
-- diligence_case_id. Mesmo padrão de rede_validate_signature_reconciliation_evidence.
CREATE FUNCTION rede_validate_legal_evidence_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM legal_due_diligence_cases c
    WHERE c.id = NEW.diligence_case_id
      AND c.organization_id = NEW.organization_id
      AND c.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'LEGAL_EVIDENCE_DOCUMENT_CASE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF NEW.document_request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM legal_document_requests r
    WHERE r.id = NEW.document_request_id AND r.diligence_case_id = NEW.diligence_case_id
  ) THEN
    RAISE EXCEPTION 'LEGAL_EVIDENCE_DOCUMENT_REQUEST_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF NEW.checklist_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM legal_checklist_items i
    WHERE i.id = NEW.checklist_item_id AND i.diligence_case_id = NEW.diligence_case_id
  ) THEN
    RAISE EXCEPTION 'LEGAL_EVIDENCE_DOCUMENT_CHECKLIST_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER legal_evidence_document_validate BEFORE INSERT OR UPDATE ON legal_evidence_documents
FOR EACH ROW EXECUTE FUNCTION rede_validate_legal_evidence_document();

-- Imutabilidade estrutural: PENDING_REVIEW é livremente mutável (submissão/revisão
-- ainda em curso); VERIFIED permite APENAS a transição para REVOKED, e só nos campos
-- de revogação (protected-column-diff, mesma técnica de
-- rede_protect_signature_evidence_context); REJECTED e REVOKED são terminais e
-- totalmente imutáveis; DELETE só é permitido enquanto PENDING_REVIEW; TRUNCATE é
-- sempre bloqueado.
CREATE FUNCTION rede_legal_evidence_document_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'LEGAL_EVIDENCE_DOCUMENT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'PENDING_REVIEW' THEN
      RAISE EXCEPTION 'LEGAL_EVIDENCE_DOCUMENT_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'PENDING_REVIEW' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'VERIFIED' AND NEW.status = 'REVOKED' THEN
    IF (to_jsonb(NEW) - ARRAY['status','revoked_by_id','revoked_at','revoked_reason','updated_at']) IS NOT DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','revoked_by_id','revoked_at','revoked_reason','updated_at']) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'LEGAL_EVIDENCE_DOCUMENT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RAISE EXCEPTION 'LEGAL_EVIDENCE_DOCUMENT_IMMUTABLE' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER legal_evidence_document_immutable BEFORE UPDATE OR DELETE ON legal_evidence_documents
FOR EACH ROW EXECUTE FUNCTION rede_legal_evidence_document_immutable();
CREATE TRIGGER legal_evidence_document_no_truncate BEFORE TRUNCATE ON legal_evidence_documents
FOR EACH STATEMENT EXECUTE FUNCTION rede_legal_evidence_document_immutable();
