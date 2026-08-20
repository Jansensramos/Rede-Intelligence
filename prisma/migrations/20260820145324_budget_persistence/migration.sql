-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "study_version_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "base_date" DATE NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "total_budget" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_line_items" (
    "id" TEXT NOT NULL,
    "budget_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_cost" DECIMAL(20,2) NOT NULL,
    "total_cost" DECIMAL(20,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "cost_center" TEXT,
    "tower" TEXT,
    "origin" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budgets_organization_id_status_idx" ON "budgets"("organization_id", "status");

-- CreateIndex
CREATE INDEX "budgets_project_id_status_idx" ON "budgets"("project_id", "status");

-- CreateIndex
CREATE INDEX "budgets_study_version_id_idx" ON "budgets"("study_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_project_id_name_version_key" ON "budgets"("project_id", "name", "version");

-- CreateIndex
CREATE INDEX "budget_line_items_budget_id_phase_sort_order_idx" ON "budget_line_items"("budget_id", "phase", "sort_order");

-- CreateIndex
CREATE INDEX "budget_line_items_parent_id_idx" ON "budget_line_items"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_line_items_budget_id_code_key" ON "budget_line_items"("budget_id", "code");

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_study_version_id_fkey" FOREIGN KEY ("study_version_id") REFERENCES "study_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_line_items" ADD CONSTRAINT "budget_line_items_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_line_items" ADD CONSTRAINT "budget_line_items_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "budget_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
