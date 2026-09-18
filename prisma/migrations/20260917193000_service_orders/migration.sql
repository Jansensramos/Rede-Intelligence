-- Ordens de Serviço vinculadas a contratos operacionais.
-- Implementação aditiva: não altera semântica dos contratos/medições existentes.

CREATE TABLE "service_orders" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "starts_at" DATE,
    "ends_at" DATE,
    "responsible_id" TEXT NOT NULL,
    "authorized_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "issued_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_orders_status_check" CHECK ("status" IN ('DRAFT','IN_APPROVAL','APPROVED','ISSUED','IN_PROGRESS','COMPLETED','CANCELLED'))
);

CREATE TABLE "service_order_items" (
    "id" TEXT NOT NULL,
    "service_order_id" TEXT NOT NULL,
    "contract_item_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_price" DECIMAL(20,2) NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "service_order_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "measurement_certificates" ADD COLUMN "service_order_id" TEXT;

CREATE UNIQUE INDEX "service_orders_project_id_number_key" ON "service_orders"("project_id", "number");
CREATE INDEX "service_orders_organization_project_status_idx" ON "service_orders"("organization_id", "project_id", "status");
CREATE INDEX "service_orders_contract_id_status_idx" ON "service_orders"("contract_id", "status");
CREATE INDEX "service_order_items_service_order_id_idx" ON "service_order_items"("service_order_id");
CREATE INDEX "service_order_items_contract_item_id_idx" ON "service_order_items"("contract_item_id");
CREATE INDEX "measurement_certificates_service_order_id_idx" ON "measurement_certificates"("service_order_id");

ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "operational_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_order_items" ADD CONSTRAINT "service_order_items_service_order_id_fkey" FOREIGN KEY ("service_order_id") REFERENCES "service_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_order_items" ADD CONSTRAINT "service_order_items_contract_item_id_fkey" FOREIGN KEY ("contract_item_id") REFERENCES "operational_contract_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "measurement_certificates" ADD CONSTRAINT "measurement_certificates_service_order_id_fkey" FOREIGN KEY ("service_order_id") REFERENCES "service_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
