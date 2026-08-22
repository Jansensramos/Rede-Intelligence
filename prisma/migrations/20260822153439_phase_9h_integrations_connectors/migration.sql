-- CreateEnum
CREATE TYPE "ConnectorCategory" AS ENUM ('STORAGE', 'ERP', 'CRM', 'BANKING', 'GOVERNMENT', 'REGISTRY', 'ACCOUNTING', 'CONSTRUCTION_CDE', 'PRICE_INTELLIGENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "ConnectorAuthMethod" AS ENUM ('OAUTH2', 'API_KEY', 'SERVICE_ACCOUNT', 'CERTIFICATE', 'MANUAL', 'NONE');

-- CreateEnum
CREATE TYPE "IntegrationLifecycleStatus" AS ENUM ('ACTIVE', 'DEPRECATED', 'RETIRED');

-- CreateEnum
CREATE TYPE "IntegrationDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'BIDIRECTIONAL');

-- CreateEnum
CREATE TYPE "ConnectorInstallationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ERROR', 'REVOKED');

-- CreateEnum
CREATE TYPE "IntegrationHealthStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'DOWN', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "OAuthGrantState" AS ENUM ('PENDING_CONSENT', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "ConflictPolicyType" AS ENUM ('EXTERNAL_WINS', 'REDE_WINS', 'NEWEST_WINS', 'MANUAL_REVIEW', 'FIELD_OWNER_WINS', 'MERGE_BY_RULE');

-- CreateEnum
CREATE TYPE "OwnershipRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "MappingProfileStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "IntegrationConflictStatus" AS ENUM ('OPEN', 'RESOLVED_AUTO', 'RESOLVED_MANUAL', 'IGNORED');

-- CreateEnum
CREATE TYPE "SyncRunMode" AS ENUM ('MANUAL', 'SCHEDULED', 'WEBHOOK', 'INCREMENTAL', 'FULL', 'REPLAY');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncItemResult" AS ENUM ('APPLIED', 'SKIPPED', 'CONFLICT', 'ERROR', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "InboxEventStatus" AS ENUM ('RECEIVED', 'VALIDATED', 'REJECTED', 'PROCESSING', 'PROCESSED', 'FAILED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'DELIVERING', 'DELIVERED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "WebhookSubscriptionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REVOKED');

-- CreateEnum
CREATE TYPE "EventClassification" AS ENUM ('INTERNAL', 'PARTNER', 'PUBLIC');

-- CreateEnum
CREATE TYPE "JobPriority" AS ENUM ('CRITICAL', 'NORMAL', 'LOW');

-- CreateEnum
CREATE TYPE "IntegrationJobStatus" AS ENUM ('QUEUED', 'LEASED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "IntegrationErrorClass" AS ENUM ('AUTHENTICATION', 'AUTHORIZATION', 'RATE_LIMIT', 'VALIDATION', 'MAPPING', 'DUPLICATE', 'CONFLICT', 'NETWORK', 'PROVIDER', 'BUSINESS_RULE', 'STORAGE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DeadLetterSourceType" AS ENUM ('JOB', 'INBOX_EVENT', 'SYNC_ITEM', 'OUTBOX_EVENT');

-- CreateEnum
CREATE TYPE "QuarantineStatus" AS ENUM ('PENDING', 'REVIEWED', 'REPROCESSED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "DocumentReferenceMode" AS ENUM ('REFERENCE', 'COPY');

-- CreateTable
CREATE TABLE "connector_definitions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "category" "ConnectorCategory" NOT NULL,
    "auth_method" "ConnectorAuthMethod" NOT NULL,
    "capabilities" JSONB NOT NULL,
    "source_of_truth_default" JSONB,
    "adapter_version" TEXT NOT NULL,
    "contract_version" TEXT NOT NULL,
    "sandbox_available" BOOLEAN NOT NULL DEFAULT true,
    "deprecation_status" "IntegrationLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "documentation_url" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_installations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "connector_definition_id" TEXT NOT NULL,
    "economic_group_id" TEXT,
    "company_id" TEXT,
    "project_id" TEXT,
    "name" TEXT NOT NULL,
    "status" "ConnectorInstallationStatus" NOT NULL DEFAULT 'DRAFT',
    "direction" "IntegrationDirection" NOT NULL,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "health_status" "IntegrationHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
    "last_sync_at" TIMESTAMP(3),
    "next_sync_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential_references" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "method" "ConnectorAuthMethod" NOT NULL,
    "secret_ref" TEXT NOT NULL,
    "fingerprint" TEXT,
    "status" "CredentialStatus" NOT NULL DEFAULT 'PENDING',
    "scopes" JSONB,
    "expires_at" TIMESTAMP(3),
    "last_rotated_at" TIMESTAMP(3),
    "rotated_from_id" TEXT,
    "metadata" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credential_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_grants" (
    "id" TEXT NOT NULL,
    "credential_reference_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "external_tenant" TEXT,
    "scopes" JSONB NOT NULL,
    "state" "OAuthGrantState" NOT NULL DEFAULT 'PENDING_CONSENT',
    "consented_at" TIMESTAMP(3),
    "last_refreshed_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_ownership_policies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "field_pattern" TEXT,
    "master_system" TEXT NOT NULL,
    "allowed_sources" JSONB NOT NULL,
    "consumers" JSONB NOT NULL,
    "direction" "IntegrationDirection" NOT NULL,
    "conflict_policy" "ConflictPolicyType" NOT NULL,
    "risk_level" "OwnershipRiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "version" INTEGER NOT NULL DEFAULT 1,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_ownership_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_entity_references" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "external_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "external_version" TEXT,
    "company_id" TEXT,
    "project_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_entity_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapping_profiles" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "MappingProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "rules" JSONB NOT NULL,
    "identity_rules" JSONB,
    "created_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mapping_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_conflicts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "external_reference_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "field_name" TEXT NOT NULL,
    "local_value" JSONB,
    "external_value" JSONB,
    "local_updated_at" TIMESTAMP(3),
    "external_updated_at" TIMESTAMP(3),
    "policy_applied" "ConflictPolicyType" NOT NULL,
    "status" "IntegrationConflictStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" JSONB,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "sync_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sync_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "mode" "SyncRunMode" NOT NULL,
    "direction" "IntegrationDirection" NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "cursor_before" TEXT,
    "cursor_after" TEXT,
    "items_read" INTEGER NOT NULL DEFAULT 0,
    "items_applied" INTEGER NOT NULL DEFAULT 0,
    "items_ignored" INTEGER NOT NULL DEFAULT 0,
    "items_errored" INTEGER NOT NULL DEFAULT 0,
    "items_conflicted" INTEGER NOT NULL DEFAULT 0,
    "correlation_id" TEXT NOT NULL,
    "triggered_by_id" TEXT,
    "error_summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sync_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sync_run_id" TEXT NOT NULL,
    "external_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "resolved_entity_type" TEXT,
    "resolved_entity_id" TEXT,
    "result" "SyncItemResult" NOT NULL,
    "error_message" TEXT,
    "checksum" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_sync_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_cursors" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "partition_key" TEXT NOT NULL DEFAULT 'default',
    "cursor_value" TEXT,
    "last_success_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_inbox_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "signature_valid" BOOLEAN NOT NULL DEFAULT false,
    "payload_checksum" TEXT NOT NULL,
    "payload" JSONB,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "InboxEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "processed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "sync_run_id" TEXT,

    CONSTRAINT "integration_inbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_outbox_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "event_version" INTEGER NOT NULL DEFAULT 1,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "subscription_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_subscriptions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "endpoint_url" TEXT NOT NULL,
    "secret_ref" TEXT NOT NULL,
    "events" JSONB NOT NULL,
    "status" "WebhookSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_catalog_entries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "owner" TEXT NOT NULL,
    "schema" JSONB NOT NULL,
    "classification" "EventClassification" NOT NULL DEFAULT 'INTERNAL',
    "contains_pii" BOOLEAN NOT NULL DEFAULT false,
    "guarantees" TEXT,
    "ordering_guarantee" TEXT,
    "deprecation_status" "IntegrationLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_catalog_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_jobs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "installation_id" TEXT,
    "job_type" TEXT NOT NULL,
    "priority" "JobPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "IntegrationJobStatus" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "scheduled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "last_error" TEXT,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_dead_letters" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source_type" "DeadLetterSourceType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "installation_id" TEXT,
    "reason" TEXT NOT NULL,
    "error_class" "IntegrationErrorClass" NOT NULL,
    "payload" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" TEXT,
    "resolution_notes" TEXT,

    CONSTRAINT "integration_dead_letters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_quarantine_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "external_type" TEXT,
    "external_id" TEXT,
    "reason" TEXT NOT NULL,
    "error_class" "IntegrationErrorClass" NOT NULL,
    "payload" JSONB,
    "status" "QuarantineStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reprocessed_sync_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_quarantine_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_health_snapshots" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availability" DOUBLE PRECISION,
    "success_rate" DOUBLE PRECISION,
    "avg_latency_ms" INTEGER,
    "freshness_seconds" INTEGER,
    "backlog_count" INTEGER NOT NULL DEFAULT 0,
    "health_score" DOUBLE PRECISION NOT NULL,
    "components" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_health_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_document_references" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "external_reference_id" TEXT,
    "provider" TEXT NOT NULL,
    "external_file_id" TEXT NOT NULL,
    "external_version_id" TEXT,
    "name" TEXT NOT NULL,
    "mime_type" TEXT,
    "size" INTEGER,
    "web_url" TEXT,
    "checksum" TEXT,
    "modified_at_source" TIMESTAMP(3),
    "reference_mode" "DocumentReferenceMode" NOT NULL DEFAULT 'REFERENCE',
    "copied_document_link_id" TEXT,
    "company_id" TEXT,
    "project_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_document_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_price_observations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "item_code" TEXT,
    "item_description" TEXT NOT NULL,
    "specification" TEXT,
    "region" TEXT,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(18,4),
    "unit" TEXT,
    "price" DECIMAL(18,4) NOT NULL,
    "freight" DECIMAL(18,4),
    "taxes" DECIMAL(18,4),
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "supplier_name" TEXT,
    "source_provider" TEXT NOT NULL,
    "source_url" TEXT,
    "evidence_checksum" TEXT,
    "confidence" DOUBLE PRECISION,
    "license_note" TEXT,
    "mapped_economic_item_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_price_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "connector_definitions_code_key" ON "connector_definitions"("code");

-- CreateIndex
CREATE INDEX "connector_definitions_category_idx" ON "connector_definitions"("category");

-- CreateIndex
CREATE INDEX "connector_installations_organization_id_connector_definitio_idx" ON "connector_installations"("organization_id", "connector_definition_id");

-- CreateIndex
CREATE INDEX "connector_installations_organization_id_status_idx" ON "connector_installations"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "credential_references_installation_id_key" ON "credential_references"("installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "credential_references_secret_ref_key" ON "credential_references"("secret_ref");

-- CreateIndex
CREATE UNIQUE INDEX "credential_references_rotated_from_id_key" ON "credential_references"("rotated_from_id");

-- CreateIndex
CREATE INDEX "credential_references_organization_id_status_idx" ON "credential_references"("organization_id", "status");

-- CreateIndex
CREATE INDEX "oauth_grants_credential_reference_id_state_idx" ON "oauth_grants"("credential_reference_id", "state");

-- CreateIndex
CREATE INDEX "data_ownership_policies_organization_id_domain_entity_type_idx" ON "data_ownership_policies"("organization_id", "domain", "entity_type");

-- CreateIndex
CREATE INDEX "external_entity_references_organization_id_entity_type_enti_idx" ON "external_entity_references"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_entity_references_installation_id_external_type_ex_key" ON "external_entity_references"("installation_id", "external_type", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "mapping_profiles_installation_id_capability_version_key" ON "mapping_profiles"("installation_id", "capability", "version");

-- CreateIndex
CREATE INDEX "integration_conflicts_organization_id_status_idx" ON "integration_conflicts"("organization_id", "status");

-- CreateIndex
CREATE INDEX "integration_conflicts_installation_id_idx" ON "integration_conflicts"("installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_sync_runs_correlation_id_key" ON "integration_sync_runs"("correlation_id");

-- CreateIndex
CREATE INDEX "integration_sync_runs_organization_id_installation_id_creat_idx" ON "integration_sync_runs"("organization_id", "installation_id", "created_at");

-- CreateIndex
CREATE INDEX "integration_sync_items_sync_run_id_idx" ON "integration_sync_items"("sync_run_id");

-- CreateIndex
CREATE INDEX "integration_sync_items_organization_id_external_type_extern_idx" ON "integration_sync_items"("organization_id", "external_type", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_cursors_installation_id_capability_partition_ke_key" ON "integration_cursors"("installation_id", "capability", "partition_key");

-- CreateIndex
CREATE INDEX "integration_inbox_events_organization_id_status_idx" ON "integration_inbox_events"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_inbox_events_installation_id_provider_event_id_key" ON "integration_inbox_events"("installation_id", "provider", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_outbox_events_idempotency_key_key" ON "integration_outbox_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "integration_outbox_events_organization_id_status_created_at_idx" ON "integration_outbox_events"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "webhook_subscriptions_organization_id_status_idx" ON "webhook_subscriptions"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "event_catalog_entries_name_version_key" ON "event_catalog_entries"("name", "version");

-- CreateIndex
CREATE INDEX "integration_jobs_organization_id_status_scheduled_at_idx" ON "integration_jobs"("organization_id", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "integration_dead_letters_organization_id_source_type_idx" ON "integration_dead_letters"("organization_id", "source_type");

-- CreateIndex
CREATE INDEX "integration_quarantine_items_organization_id_status_idx" ON "integration_quarantine_items"("organization_id", "status");

-- CreateIndex
CREATE INDEX "integration_health_snapshots_installation_id_captured_at_idx" ON "integration_health_snapshots"("installation_id", "captured_at");

-- CreateIndex
CREATE INDEX "connector_document_references_organization_id_project_id_idx" ON "connector_document_references"("organization_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "connector_document_references_installation_id_external_file_key" ON "connector_document_references"("installation_id", "external_file_id");

-- CreateIndex
CREATE INDEX "external_price_observations_organization_id_item_code_obser_idx" ON "external_price_observations"("organization_id", "item_code", "observed_at");

-- AddForeignKey
ALTER TABLE "connector_installations" ADD CONSTRAINT "connector_installations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_installations" ADD CONSTRAINT "connector_installations_connector_definition_id_fkey" FOREIGN KEY ("connector_definition_id") REFERENCES "connector_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_installations" ADD CONSTRAINT "connector_installations_economic_group_id_fkey" FOREIGN KEY ("economic_group_id") REFERENCES "economic_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_installations" ADD CONSTRAINT "connector_installations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_installations" ADD CONSTRAINT "connector_installations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_references" ADD CONSTRAINT "credential_references_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_references" ADD CONSTRAINT "credential_references_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "connector_installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_references" ADD CONSTRAINT "credential_references_rotated_from_id_fkey" FOREIGN KEY ("rotated_from_id") REFERENCES "credential_references"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_credential_reference_id_fkey" FOREIGN KEY ("credential_reference_id") REFERENCES "credential_references"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_ownership_policies" ADD CONSTRAINT "data_ownership_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_entity_references" ADD CONSTRAINT "external_entity_references_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_entity_references" ADD CONSTRAINT "external_entity_references_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "connector_installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapping_profiles" ADD CONSTRAINT "mapping_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapping_profiles" ADD CONSTRAINT "mapping_profiles_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "connector_installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_conflicts" ADD CONSTRAINT "integration_conflicts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_conflicts" ADD CONSTRAINT "integration_conflicts_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "connector_installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "connector_installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_items" ADD CONSTRAINT "integration_sync_items_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "integration_sync_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_cursors" ADD CONSTRAINT "integration_cursors_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "connector_installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_inbox_events" ADD CONSTRAINT "integration_inbox_events_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "connector_installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_outbox_events" ADD CONSTRAINT "integration_outbox_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_jobs" ADD CONSTRAINT "integration_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_jobs" ADD CONSTRAINT "integration_jobs_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "connector_installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_dead_letters" ADD CONSTRAINT "integration_dead_letters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_quarantine_items" ADD CONSTRAINT "integration_quarantine_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_quarantine_items" ADD CONSTRAINT "integration_quarantine_items_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "connector_installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_health_snapshots" ADD CONSTRAINT "integration_health_snapshots_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "connector_installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_document_references" ADD CONSTRAINT "connector_document_references_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_document_references" ADD CONSTRAINT "connector_document_references_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "connector_installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_document_references" ADD CONSTRAINT "connector_document_references_external_reference_id_fkey" FOREIGN KEY ("external_reference_id") REFERENCES "external_entity_references"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_price_observations" ADD CONSTRAINT "external_price_observations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

