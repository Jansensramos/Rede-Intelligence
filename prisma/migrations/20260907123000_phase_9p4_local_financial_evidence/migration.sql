CREATE TABLE "financial_provider_evidence" (
 "id" TEXT PRIMARY KEY,
 "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "installation_id" TEXT NOT NULL REFERENCES "connector_installations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "job_id" TEXT NOT NULL,
 "operation" TEXT NOT NULL CHECK ("operation" IN ('BANK_SYNC','BUREAU_CONSULT','FUNDING_SUBMIT','FUNDING_STATUS')),
 "target_id" TEXT NOT NULL,
 "external_key_hash" TEXT NOT NULL CHECK ("external_key_hash" ~ '^[0-9a-f]{64}$'),
 "content_hash" TEXT NOT NULL CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
 "encrypted_payload" TEXT NOT NULL,
 "simulated" BOOLEAN NOT NULL DEFAULT true CHECK ("simulated" = true),
 "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expires_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "financial_evidence_retention" CHECK ("expires_at" > "recorded_at" AND "expires_at" <= "recorded_at" + INTERVAL '180 days')
);
CREATE UNIQUE INDEX "financial_provider_evidence_installation_id_operation_target__key" ON "financial_provider_evidence"("installation_id", "operation", "target_id", "external_key_hash");
CREATE INDEX "financial_provider_evidence_organization_id_installation_id_e_idx" ON "financial_provider_evidence"("organization_id", "installation_id", "expires_at");
CREATE FUNCTION financial_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
   IF NOT EXISTS (SELECT 1 FROM connector_installations i JOIN integration_jobs j ON j.installation_id=i.id WHERE i.id=NEW.installation_id AND i.organization_id=NEW.organization_id AND j.id=NEW.job_id AND j.organization_id=NEW.organization_id AND j.job_type='FINANCIAL_PROVIDER') THEN
     RAISE EXCEPTION 'FINANCIAL_EVIDENCE_SCOPE_INVALID';
   END IF;
   RETURN NEW;
 END IF;
 IF TG_OP = 'DELETE' AND OLD.expires_at <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'FINANCIAL_EVIDENCE_IMMUTABLE';
END $$;
CREATE TRIGGER financial_evidence_insert BEFORE INSERT ON financial_provider_evidence FOR EACH ROW EXECUTE FUNCTION financial_evidence_guard();
CREATE TRIGGER financial_evidence_immutable BEFORE UPDATE OR DELETE ON financial_provider_evidence FOR EACH ROW EXECUTE FUNCTION financial_evidence_guard();
CREATE TRIGGER financial_evidence_no_truncate BEFORE TRUNCATE ON financial_provider_evidence FOR EACH STATEMENT EXECUTE FUNCTION financial_evidence_guard();
