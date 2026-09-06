CREATE TABLE "drive_document_versions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "installation_id" TEXT NOT NULL REFERENCES "connector_installations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "scope" TEXT NOT NULL CHECK ("scope" ~ '^[a-f0-9]{64}$'),
  "external_file_id" TEXT NOT NULL,
  "revision_key" TEXT NOT NULL CHECK ("revision_key" ~ '^[a-f0-9]{64}$'),
  "available" BOOLEAN NOT NULL,
  "metadata" JSONB NOT NULL,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "drive_document_versions_installation_id_scope_external_file_i_key"
  ON "drive_document_versions"("installation_id", "scope", "external_file_id", "revision_key");
CREATE INDEX "drive_document_versions_organization_id_installation_id_idx" ON "drive_document_versions"("organization_id", "installation_id");
CREATE FUNCTION drive_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Drive versions are immutable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM connector_installations i WHERE i.id = NEW.installation_id AND i.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'Drive version tenant mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER drive_version_insert BEFORE INSERT ON drive_document_versions FOR EACH ROW EXECUTE FUNCTION drive_version_guard();
CREATE TRIGGER drive_version_immutable BEFORE UPDATE OR DELETE ON drive_document_versions FOR EACH ROW EXECUTE FUNCTION drive_version_guard();
CREATE TRIGGER drive_version_no_truncate BEFORE TRUNCATE ON drive_document_versions FOR EACH STATEMENT EXECUTE FUNCTION drive_version_guard();
