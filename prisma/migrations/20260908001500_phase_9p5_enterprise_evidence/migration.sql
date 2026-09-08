ALTER TABLE external_entity_references ADD COLUMN enterprise_source_key TEXT;
CREATE UNIQUE INDEX enterprise_crosswalk_source_key ON external_entity_references(organization_id, enterprise_source_key, external_type, external_id);

CREATE TABLE enterprise_sync_evidence (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 installation_id TEXT NOT NULL REFERENCES connector_installations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 job_id TEXT NOT NULL REFERENCES integration_jobs(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 reference_id TEXT NOT NULL REFERENCES external_entity_references(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 version_hash TEXT NOT NULL CHECK (version_hash ~ '^[0-9a-f]{64}$'),
 content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
 local_hash TEXT NOT NULL CHECK (local_hash ~ '^[0-9a-f]{64}$'),
 encrypted_payload TEXT NOT NULL,
 divergent BOOLEAN NOT NULL,
 simulated BOOLEAN NOT NULL DEFAULT true CHECK (simulated = true),
 recorded_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at TIMESTAMP(3) NOT NULL,
 CONSTRAINT enterprise_retention CHECK (expires_at > recorded_at AND expires_at <= recorded_at + INTERVAL '180 days')
);
CREATE UNIQUE INDEX enterprise_evidence_version_key ON enterprise_sync_evidence(installation_id, reference_id, version_hash);
CREATE INDEX enterprise_evidence_retention_idx ON enterprise_sync_evidence(organization_id, installation_id, expires_at);
CREATE TABLE enterprise_evidence_reviews (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL,
 evidence_id TEXT NOT NULL UNIQUE REFERENCES enterprise_sync_evidence(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 decision TEXT NOT NULL CHECK (decision IN ('PROPOSE_REVISION', 'REJECT')),
 recorded_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION enterprise_crosswalk_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'TRUNCATE' THEN
   IF EXISTS (SELECT 1 FROM external_entity_references WHERE enterprise_source_key IS NOT NULL) THEN RAISE EXCEPTION 'ENTERPRISE_CROSSWALK_IMMUTABLE'; END IF;
   RETURN NULL;
 END IF;
 IF TG_OP IN ('UPDATE','DELETE') AND OLD.enterprise_source_key IS NOT NULL THEN RAISE EXCEPTION 'ENTERPRISE_CROSSWALK_IMMUTABLE'; END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 IF NEW.enterprise_source_key IS NULL THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'ENTERPRISE_CROSSWALK_IMMUTABLE'; END IF;
 IF NEW.external_id !~ '^[0-9a-f]{64}$' OR NOT EXISTS (
   SELECT 1 FROM connector_installations i JOIN connector_definitions d ON d.id=i.connector_definition_id
   WHERE i.id=NEW.installation_id AND i.organization_id=NEW.organization_id AND i.project_id=NEW.project_id
     AND d.code='ENTERPRISE_LOCAL_V1' AND NEW.enterprise_source_key=(i.configuration->>'capability') || ':' || (i.configuration->>'sourceKey')
 ) THEN RAISE EXCEPTION 'ENTERPRISE_SCOPE_INVALID'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enterprise_crosswalk_rows BEFORE INSERT OR UPDATE OR DELETE ON external_entity_references FOR EACH ROW EXECUTE FUNCTION enterprise_crosswalk_guard();
CREATE TRIGGER enterprise_crosswalk_truncate BEFORE TRUNCATE ON external_entity_references FOR EACH STATEMENT EXECUTE FUNCTION enterprise_crosswalk_guard();
CREATE FUNCTION enterprise_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
   IF NOT EXISTS (SELECT 1 FROM external_entity_references r JOIN integration_jobs j ON j.installation_id=r.installation_id
     WHERE r.id=NEW.reference_id AND r.organization_id=NEW.organization_id AND r.installation_id=NEW.installation_id
       AND r.enterprise_source_key IS NOT NULL AND j.id=NEW.job_id AND j.organization_id=NEW.organization_id AND j.job_type='ENTERPRISE_SYNC')
     THEN RAISE EXCEPTION 'ENTERPRISE_SCOPE_INVALID'; END IF;
   RETURN NEW;
 END IF;
 IF TG_OP='DELETE' AND OLD.expires_at <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_IMMUTABLE';
END $$;
CREATE TRIGGER enterprise_evidence_rows BEFORE INSERT OR UPDATE OR DELETE ON enterprise_sync_evidence FOR EACH ROW EXECUTE FUNCTION enterprise_evidence_guard();
CREATE TRIGGER enterprise_evidence_truncate BEFORE TRUNCATE ON enterprise_sync_evidence FOR EACH STATEMENT EXECUTE FUNCTION enterprise_evidence_guard();
CREATE FUNCTION enterprise_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NOT EXISTS (SELECT 1 FROM enterprise_sync_evidence e WHERE e.id=NEW.evidence_id AND e.organization_id=NEW.organization_id AND e.divergent=true AND e.expires_at > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) THEN RAISE EXCEPTION 'ENTERPRISE_REVIEW_INVALID'; END IF;
   RETURN NEW;
 END IF;
 IF TG_OP='DELETE' AND EXISTS (SELECT 1 FROM enterprise_sync_evidence e WHERE e.id=OLD.evidence_id AND e.expires_at <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'ENTERPRISE_REVIEW_IMMUTABLE';
END $$;
CREATE TRIGGER enterprise_review_rows BEFORE INSERT OR UPDATE OR DELETE ON enterprise_evidence_reviews FOR EACH ROW EXECUTE FUNCTION enterprise_review_guard();
CREATE TRIGGER enterprise_review_truncate BEFORE TRUNCATE ON enterprise_evidence_reviews FOR EACH STATEMENT EXECUTE FUNCTION enterprise_review_guard();

CREATE FUNCTION enterprise_context_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='connector_installations' THEN
   IF EXISTS (SELECT 1 FROM external_entity_references WHERE installation_id=OLD.id AND enterprise_source_key IS NOT NULL)
     AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.connector_definition_id IS DISTINCT FROM OLD.connector_definition_id OR NEW.configuration->>'sourceKey' IS DISTINCT FROM OLD.configuration->>'sourceKey' OR NEW.configuration->>'capability' IS DISTINCT FROM OLD.configuration->>'capability')
     THEN RAISE EXCEPTION 'ENTERPRISE_CONTEXT_IMMUTABLE'; END IF;
 ELSE
   IF EXISTS (SELECT 1 FROM enterprise_sync_evidence WHERE job_id=OLD.id)
     AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.installation_id IS DISTINCT FROM OLD.installation_id OR NEW.job_type IS DISTINCT FROM OLD.job_type)
     THEN RAISE EXCEPTION 'ENTERPRISE_CONTEXT_IMMUTABLE'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enterprise_installation_context BEFORE UPDATE ON connector_installations FOR EACH ROW EXECUTE FUNCTION enterprise_context_guard();
CREATE TRIGGER enterprise_job_context BEFORE UPDATE ON integration_jobs FOR EACH ROW EXECUTE FUNCTION enterprise_context_guard();

CREATE FUNCTION enterprise_conflict_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE evidence_key TEXT;
BEGIN
 IF TG_OP='TRUNCATE' THEN
   IF EXISTS (SELECT 1 FROM integration_conflicts WHERE field_name='ENTERPRISE_SNAPSHOT_V1') THEN RAISE EXCEPTION 'ENTERPRISE_CONFLICT_PROTECTED'; END IF;
   RETURN NULL;
 END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.field_name='ENTERPRISE_SNAPSHOT_V1' AND NOT EXISTS (SELECT 1 FROM enterprise_sync_evidence e WHERE e.id=NEW.local_value->>'evidenceId' AND e.organization_id=NEW.organization_id AND e.installation_id=NEW.installation_id AND e.reference_id=NEW.external_reference_id AND e.divergent=true AND NEW.id='ec_' || e.id AND NEW.status='OPEN' AND NEW.policy_applied='MANUAL_REVIEW') THEN RAISE EXCEPTION 'ENTERPRISE_CONFLICT_PROTECTED'; END IF;
   RETURN NEW;
 END IF;
 IF OLD.field_name<>'ENTERPRISE_SNAPSHOT_V1' THEN
   IF TG_OP='UPDATE' AND NEW.field_name='ENTERPRISE_SNAPSHOT_V1' THEN RAISE EXCEPTION 'ENTERPRISE_CONFLICT_PROTECTED'; END IF;
   IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
 END IF;
 evidence_key := OLD.local_value->>'evidenceId';
 IF TG_OP='DELETE' THEN
   IF EXISTS (SELECT 1 FROM enterprise_sync_evidence e WHERE e.id=evidence_key AND e.expires_at <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'ENTERPRISE_CONFLICT_PROTECTED';
 END IF;
 IF (to_jsonb(NEW) - ARRAY['status','resolution','resolved_by_id','resolved_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','resolution','resolved_by_id','resolved_at']) THEN RAISE EXCEPTION 'ENTERPRISE_CONFLICT_PROTECTED'; END IF;
 IF NOT EXISTS (SELECT 1 FROM enterprise_evidence_reviews r WHERE r.evidence_id=evidence_key AND r.organization_id=OLD.organization_id AND r.id=NEW.resolution->>'reviewId' AND r.user_id=NEW.resolved_by_id AND r.decision=NEW.resolution->>'decision' AND NEW.status='RESOLVED_MANUAL') THEN RAISE EXCEPTION 'ENTERPRISE_REVIEW_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enterprise_conflict_rows BEFORE INSERT OR UPDATE OR DELETE ON integration_conflicts FOR EACH ROW EXECUTE FUNCTION enterprise_conflict_guard();
CREATE TRIGGER enterprise_conflict_truncate BEFORE TRUNCATE ON integration_conflicts FOR EACH STATEMENT EXECUTE FUNCTION enterprise_conflict_guard();

CREATE FUNCTION enterprise_quarantine_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='TRUNCATE' THEN
   IF EXISTS (SELECT 1 FROM integration_quarantine_items WHERE capability='ENTERPRISE_SYNC') THEN RAISE EXCEPTION 'ENTERPRISE_QUARANTINE_PROTECTED'; END IF;
   RETURN NULL;
 END IF;
 IF OLD.capability<>'ENTERPRISE_SYNC' THEN
   IF TG_OP='UPDATE' AND NEW.capability='ENTERPRISE_SYNC' THEN RAISE EXCEPTION 'ENTERPRISE_QUARANTINE_PROTECTED'; END IF;
   IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN
   IF (OLD.payload->>'expiresAt')::timestamptz <= CURRENT_TIMESTAMP THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'ENTERPRISE_QUARANTINE_PROTECTED';
 END IF;
 IF (to_jsonb(NEW) - ARRAY['status','reviewed_by_id','reviewed_at','reprocessed_sync_run_id']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','reviewed_by_id','reviewed_at','reprocessed_sync_run_id']) THEN RAISE EXCEPTION 'ENTERPRISE_QUARANTINE_PROTECTED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enterprise_quarantine_rows BEFORE UPDATE OR DELETE ON integration_quarantine_items FOR EACH ROW EXECUTE FUNCTION enterprise_quarantine_guard();
CREATE TRIGGER enterprise_quarantine_truncate BEFORE TRUNCATE ON integration_quarantine_items FOR EACH STATEMENT EXECUTE FUNCTION enterprise_quarantine_guard();
