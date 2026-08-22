-- CreateEnum
CREATE TYPE "ApiClientStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CircuitBreakerStatusDb" AS ENUM ('CLOSED', 'OPEN', 'HALF_OPEN');

-- CreateTable
CREATE TABLE "api_clients" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "api_key_hash" TEXT NOT NULL,
    "fingerprint" TEXT,
    "status" "ApiClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_idempotency_records" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "api_client_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_checksum" TEXT NOT NULL,
    "response_snapshot" JSONB NOT NULL,
    "status_code" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_rate_limit_states" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "blocked_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_rate_limit_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_circuit_breaker_states" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "status" "CircuitBreakerStatusDb" NOT NULL DEFAULT 'CLOSED',
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "opened_at" TIMESTAMP(3),
    "half_open_probe_in_flight" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_circuit_breaker_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_api_key_hash_key" ON "api_clients"("api_key_hash");

-- CreateIndex
CREATE INDEX "api_clients_organization_id_status_idx" ON "api_clients"("organization_id", "status");

-- CreateIndex
CREATE INDEX "api_idempotency_records_organization_id_created_at_idx" ON "api_idempotency_records"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_idempotency_records_api_client_id_idempotency_key_key" ON "api_idempotency_records"("api_client_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "integration_rate_limit_states_organization_id_scope_key_key" ON "integration_rate_limit_states"("organization_id", "scope_key");

-- CreateIndex
CREATE UNIQUE INDEX "integration_circuit_breaker_states_organization_id_scope_ke_key" ON "integration_circuit_breaker_states"("organization_id", "scope_key");

-- AddForeignKey
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_idempotency_records" ADD CONSTRAINT "api_idempotency_records_api_client_id_fkey" FOREIGN KEY ("api_client_id") REFERENCES "api_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

