-- CreateEnum
CREATE TYPE "AIConversationScope" AS ENUM ('ORGANIZATION', 'PROJECT', 'STUDY', 'VERSION', 'INVESTMENT_CASE', 'DOCUMENT', 'GLOBAL_PROJECT_CONTEXT');

-- CreateEnum
CREATE TYPE "AIMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');

-- CreateEnum
CREATE TYPE "AIResponseMode" AS ENUM ('EXECUTIVE', 'DETAILED', 'TECHNICAL');

-- CreateEnum
CREATE TYPE "AITaskType" AS ENUM ('CHAT', 'ANALYSIS', 'SYNTHESIS', 'DOCUMENT_SUMMARY', 'COMPARE', 'TOOL_ORCHESTRATION', 'EXTRACTION', 'RED_TEAM_ASSIST', 'REPORT_NARRATIVE');

-- CreateEnum
CREATE TYPE "AIExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'LIMITED');

-- CreateEnum
CREATE TYPE "AIActionStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'EXECUTING', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "AISourceType" AS ENUM ('ENGINE', 'SCORE', 'RED_TEAM', 'LAND', 'ZONING', 'DOCUMENT', 'COMMITTEE', 'DATA_ROOM', 'USER_INPUT', 'SIMULATION', 'POLICY', 'MARKET_DATA', 'OTHER');

-- CreateEnum
CREATE TYPE "AIConfidenceLevel" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'NOT_AVAILABLE');

-- CreateEnum
CREATE TYPE "AIFeedbackRating" AS ENUM ('POSITIVE', 'NEGATIVE');

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "study_id" TEXT,
    "study_version_id" TEXT,
    "investment_case_id" TEXT,
    "document_id" TEXT,
    "title" TEXT NOT NULL,
    "scope" "AIConversationScope" NOT NULL,
    "response_mode" "AIResponseMode" NOT NULL DEFAULT 'EXECUTIVE',
    "audience" TEXT NOT NULL DEFAULT 'INTERNAL',
    "active_scenario" TEXT NOT NULL DEFAULT 'base',
    "active_urban_scenario" TEXT,
    "context_snapshot" JSONB NOT NULL,
    "summary" TEXT,
    "source_study_version_number" INTEGER,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" "AIMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "structured_content" JSONB,
    "evidence_refs" JSONB,
    "tool_calls" JSONB,
    "model" TEXT,
    "provider" TEXT,
    "prompt_version" TEXT,
    "context_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_response_evidence" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "statement_id" TEXT NOT NULL,
    "source_type" "AISourceType" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "field" TEXT,
    "version" TEXT,
    "scenario" TEXT,
    "document_id" TEXT,
    "evidence_ref" TEXT NOT NULL,
    "confidence" "AIConfidenceLevel" NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT,
    "location" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_response_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_execution_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "message_id" TEXT,
    "task" "AITaskType" NOT NULL,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "AIExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "duration_ms" INTEGER,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,
    "prompt_version" TEXT NOT NULL,
    "tools_version" TEXT NOT NULL,
    "context_builder_version" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_tool_call_logs" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "result_summary" JSONB,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "duration_ms" INTEGER,
    "status" "AIExecutionStatus" NOT NULL,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_tool_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_pending_actions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "source_message_id" TEXT,
    "action_type" TEXT NOT NULL,
    "preview" JSONB NOT NULL,
    "arguments" JSONB NOT NULL,
    "status" "AIActionStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "idempotency_key" TEXT NOT NULL,
    "result" JSONB,
    "affected_entity_type" TEXT,
    "affected_entity_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_pending_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_insights" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "source_message_id" TEXT NOT NULL,
    "project_id" TEXT,
    "study_version_id" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_feedback" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rating" "AIFeedbackRating" NOT NULL,
    "reason" TEXT,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_task_policies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "task" "AITaskType" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "max_tokens" INTEGER NOT NULL DEFAULT 1800,
    "temperature" DECIMAL(3,2) NOT NULL DEFAULT 0.1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_task_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_budgets" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "monthly_limit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "per_user_monthly_limit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "warning_threshold" DECIMAL(5,2) NOT NULL DEFAULT 80,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "max_requests_per_minute" INTEGER NOT NULL DEFAULT 20,
    "max_tool_steps" INTEGER NOT NULL DEFAULT 8,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_document_chunks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "investment_case_id" TEXT NOT NULL,
    "document_version" INTEGER NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "location" TEXT,
    "token_count" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT NOT NULL,
    "metadata" JSONB,
    "untrusted" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_favorite_prompts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_favorite_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_organization_prompts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_organization_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_system_prompt_versions" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_system_prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_feature_flags" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_conversations_organization_id_updated_at_idx" ON "ai_conversations"("organization_id", "updated_at");

-- CreateIndex
CREATE INDEX "ai_conversations_organization_id_project_id_updated_at_idx" ON "ai_conversations"("organization_id", "project_id", "updated_at");

-- CreateIndex
CREATE INDEX "ai_conversations_organization_id_investment_case_id_updated_idx" ON "ai_conversations"("organization_id", "investment_case_id", "updated_at");

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_response_evidence_message_id_statement_id_idx" ON "ai_response_evidence"("message_id", "statement_id");

-- CreateIndex
CREATE INDEX "ai_response_evidence_document_id_idx" ON "ai_response_evidence"("document_id");

-- CreateIndex
CREATE INDEX "ai_execution_logs_organization_id_created_at_idx" ON "ai_execution_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_execution_logs_conversation_id_created_at_idx" ON "ai_execution_logs"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_execution_logs_organization_id_user_id_created_at_idx" ON "ai_execution_logs"("organization_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_tool_call_logs_organization_id_tool_created_at_idx" ON "ai_tool_call_logs"("organization_id", "tool", "created_at");

-- CreateIndex
CREATE INDEX "ai_tool_call_logs_execution_id_idx" ON "ai_tool_call_logs"("execution_id");

-- CreateIndex
CREATE INDEX "ai_pending_actions_organization_id_status_created_at_idx" ON "ai_pending_actions"("organization_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_pending_actions_organization_id_idempotency_key_key" ON "ai_pending_actions"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "ai_insights_organization_id_project_id_created_at_idx" ON "ai_insights"("organization_id", "project_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_feedback_organization_id_created_at_idx" ON "ai_feedback"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_feedback_message_id_user_id_key" ON "ai_feedback"("message_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_task_policies_organization_id_task_key" ON "ai_task_policies"("organization_id", "task");

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_budgets_organization_id_key" ON "ai_usage_budgets"("organization_id");

-- CreateIndex
CREATE INDEX "ai_document_chunks_organization_id_investment_case_id_idx" ON "ai_document_chunks"("organization_id", "investment_case_id");

-- CreateIndex
CREATE INDEX "ai_document_chunks_organization_id_document_id_idx" ON "ai_document_chunks"("organization_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_document_chunks_document_id_chunk_index_key" ON "ai_document_chunks"("document_id", "chunk_index");

-- CreateIndex
CREATE INDEX "ai_favorite_prompts_organization_id_user_id_created_at_idx" ON "ai_favorite_prompts"("organization_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_organization_prompts_organization_id_category_idx" ON "ai_organization_prompts"("organization_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "ai_system_prompt_versions_version_key" ON "ai_system_prompt_versions"("version");

-- CreateIndex
CREATE INDEX "ai_system_prompt_versions_active_created_at_idx" ON "ai_system_prompt_versions"("active", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_feature_flags_organization_id_key_key" ON "ai_feature_flags"("organization_id", "key");

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_response_evidence" ADD CONSTRAINT "ai_response_evidence_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_execution_logs" ADD CONSTRAINT "ai_execution_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_tool_call_logs" ADD CONSTRAINT "ai_tool_call_logs_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "ai_execution_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_pending_actions" ADD CONSTRAINT "ai_pending_actions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
