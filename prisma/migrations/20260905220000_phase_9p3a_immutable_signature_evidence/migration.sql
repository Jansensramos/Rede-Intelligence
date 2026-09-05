-- Additive only. Apply only after a real backup has been restored and verified.
-- No historical JSON is promoted into evidence: old claims must be reconciled again.
CREATE TABLE "signature_reconciliation_evidence" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "installation_id" TEXT NOT NULL REFERENCES "connector_installations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "request_id" TEXT NOT NULL REFERENCES "signature_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "party_id" TEXT NOT NULL UNIQUE REFERENCES "signature_parties"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "signature_event_id" TEXT NOT NULL UNIQUE REFERENCES "signature_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "source_inbox_event_id" TEXT REFERENCES "integration_inbox_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "source" TEXT NOT NULL DEFAULT 'PROVIDER_RECONCILIATION' CHECK ("source" = 'PROVIDER_RECONCILIATION'),
  "kind" TEXT NOT NULL DEFAULT 'SIGN_EVENT' CHECK ("kind" = 'SIGN_EVENT'),
  "provider" "SignatureProviderCode" NOT NULL CHECK ("provider" = 'CLICKSIGN'),
  "evidence_ref" TEXT NOT NULL CHECK ("evidence_ref" ~ '^[a-f0-9]{64}$'),
  "document_ref" TEXT NOT NULL CHECK ("document_ref" ~ '^[a-f0-9]{64}$'),
  "envelope_ref" TEXT NOT NULL CHECK ("envelope_ref" ~ '^[a-f0-9]{64}$'),
  "signer_ref" TEXT NOT NULL CHECK ("signer_ref" ~ '^[a-f0-9]{64}$'),
  "document_checksum" TEXT NOT NULL,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "signature_reconciliation_evidence_organization_id_request_id_idx" ON "signature_reconciliation_evidence" ("organization_id", "request_id");
CREATE INDEX "signature_reconciliation_evidence_source_inbox_event_id_idx" ON "signature_reconciliation_evidence" ("source_inbox_event_id");

CREATE FUNCTION rede_validate_signature_reconciliation_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM signature_requests r
    JOIN signature_parties p ON p.request_id = r.id
    JOIN signature_events e ON e.request_id = r.id AND e.organization_id = r.organization_id
    JOIN connector_installations i ON i.id = NEW.installation_id AND i.organization_id = r.organization_id
    JOIN connector_definitions d ON d.id = i.connector_definition_id
    WHERE r.id = NEW.request_id AND r.organization_id = NEW.organization_id
      AND r.provider = NEW.provider AND d.provider = 'CLICKSIGN'
      AND r.document_checksum = NEW.document_checksum
      AND p.id = NEW.party_id AND p.status = 'SIGNED'
      AND e.id = NEW.signature_event_id AND e.event_type = 'PARTY_SIGNED'
      AND e.payload->>'partyId' = p.id
  ) THEN RAISE EXCEPTION 'SIGNATURE_EVIDENCE_CONTEXT_INVALID' USING ERRCODE = '23514'; END IF;
  IF NEW.source_inbox_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM integration_inbox_events b JOIN signature_requests r ON r.id = NEW.request_id
    WHERE b.id = NEW.source_inbox_event_id AND b.organization_id = NEW.organization_id
      AND b.installation_id = NEW.installation_id AND b.provider = 'CLICKSIGN' AND b.signature_valid
      AND b.status IN ('RECEIVED', 'VALIDATED', 'PROCESSING', 'PROCESSED')
      AND b.payload->>'eventId' = b.event_id AND b.payload->>'eventType' = 'ENVELOPE_CLOSED'
      AND b.payload->>'envelopeId' = r.external_id
  ) THEN RAISE EXCEPTION 'SIGNATURE_EVIDENCE_SOURCE_INVALID' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER signature_reconciliation_evidence_validate BEFORE INSERT ON signature_reconciliation_evidence
FOR EACH ROW EXECUTE FUNCTION rede_validate_signature_reconciliation_evidence();

CREATE FUNCTION rede_signature_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'SIGNATURE_EVIDENCE_IMMUTABLE' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER signature_reconciliation_evidence_immutable BEFORE UPDATE OR DELETE ON signature_reconciliation_evidence
FOR EACH ROW EXECUTE FUNCTION rede_signature_evidence_immutable();
CREATE TRIGGER signature_reconciliation_evidence_no_truncate BEFORE TRUNCATE ON signature_reconciliation_evidence
FOR EACH STATEMENT EXECUTE FUNCTION rede_signature_evidence_immutable();

-- Protect referenced facts while allowing operational inbox status/retry metadata to change.
CREATE FUNCTION rede_protect_signature_evidence_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE protected BOOLEAN := FALSE;
BEGIN
  IF TG_TABLE_NAME = 'signature_events' THEN
    SELECT EXISTS(SELECT 1 FROM signature_reconciliation_evidence WHERE signature_event_id = OLD.id) INTO protected;
  ELSIF TG_TABLE_NAME = 'signature_parties' THEN
    SELECT EXISTS(SELECT 1 FROM signature_reconciliation_evidence WHERE party_id = OLD.id) INTO protected;
  ELSIF TG_TABLE_NAME = 'integration_inbox_events' THEN
    IF (to_jsonb(NEW) - ARRAY['status','processed_at','error_message','sync_run_id']) IS NOT DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','processed_at','error_message','sync_run_id']) THEN RETURN NEW; END IF;
    SELECT EXISTS(SELECT 1 FROM signature_reconciliation_evidence WHERE source_inbox_event_id = OLD.id) INTO protected;
  ELSIF TG_TABLE_NAME = 'signature_requests' THEN
    IF (to_jsonb(NEW) - ARRAY['status','completed_at','final_document_id','error_message','updated_at','cancelled_at','cancelled_reason']) IS NOT DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','completed_at','final_document_id','error_message','updated_at','cancelled_at','cancelled_reason']) THEN RETURN NEW; END IF;
    SELECT EXISTS(SELECT 1 FROM signature_reconciliation_evidence WHERE request_id = OLD.id) INTO protected;
  END IF;
  IF protected THEN RAISE EXCEPTION 'SIGNATURE_EVIDENCE_CONTEXT_IMMUTABLE' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER signature_evidence_protect_event BEFORE UPDATE ON signature_events FOR EACH ROW EXECUTE FUNCTION rede_protect_signature_evidence_context();
CREATE TRIGGER signature_evidence_protect_party BEFORE UPDATE ON signature_parties FOR EACH ROW EXECUTE FUNCTION rede_protect_signature_evidence_context();
CREATE TRIGGER signature_evidence_protect_inbox BEFORE UPDATE ON integration_inbox_events FOR EACH ROW EXECUTE FUNCTION rede_protect_signature_evidence_context();
CREATE TRIGGER signature_evidence_protect_request BEFORE UPDATE ON signature_requests FOR EACH ROW EXECUTE FUNCTION rede_protect_signature_evidence_context();
