-- CreateEnum
CREATE TYPE "RedTeamAgentType" AS ENUM ('FINANCE_FUNDING', 'ENGINEERING_COST', 'COMMERCIAL_MARKET', 'LEGAL_STRUCTURING', 'INVESTOR_CFO', 'DEVELOPER_OPERATOR');

-- CreateEnum
CREATE TYPE "RedTeamFindingSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RedTeamConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "RedTeamFindingStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'MITIGATED', 'ACCEPTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "RedTeamFindingType" AS ENUM ('RISK', 'INCONSISTENCY', 'MISSING_EVIDENCE', 'ASSUMPTION_CHALLENGE', 'OPPORTUNITY', 'POLICY_BREACH', 'DECISION_BLOCKER');

-- CreateEnum
CREATE TYPE "AssumptionSupport" AS ENUM ('SUPPORTED', 'WEAKLY_SUPPORTED', 'UNSUPPORTED', 'AGGRESSIVE', 'INCONSISTENT');

-- CreateEnum
CREATE TYPE "CrossReviewDecision" AS ENUM ('CONFIRM', 'REDUCE', 'ESCALATE', 'DISAGREE');

-- CreateEnum
CREATE TYPE "RedTeamDisagreementStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "RedTeamDecision" AS ENUM ('ADVANCE', 'ADVANCE_WITH_CONDITIONS', 'RESTRUCTURE', 'DO_NOT_ADVANCE', 'INSUFFICIENT_EVIDENCE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AnalysisRunStatus" ADD VALUE 'QUEUED';
ALTER TYPE "AnalysisRunStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "red_team_runs" ADD COLUMN     "calls" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "conclusion" JSONB NOT NULL,
ADD COLUMN     "duration_ms" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "engine_version" TEXT NOT NULL,
ADD COLUMN     "error" TEXT,
ADD COLUMN     "evidence_pack" JSONB NOT NULL,
ADD COLUMN     "finished_at" TIMESTAMP(3),
ADD COLUMN     "input_tokens" INTEGER,
ADD COLUMN     "organization_id" TEXT NOT NULL,
ADD COLUMN     "output_tokens" INTEGER,
ADD COLUMN     "red_team_version" TEXT NOT NULL,
ADD COLUMN     "retries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scenario_id" TEXT NOT NULL,
ADD COLUMN     "score_version" TEXT NOT NULL,
ADD COLUMN     "started_at" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "agent_type" DROP NOT NULL,
ALTER COLUMN "provider" SET NOT NULL,
ALTER COLUMN "prompt_version" SET NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'PENDING',
ALTER COLUMN "output" SET NOT NULL;

-- CreateTable
CREATE TABLE "red_team_agent_results" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "agent" "RedTeamAgentType" NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "confidence" "RedTeamConfidence" NOT NULL,
    "opinion" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "provider_used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "red_team_agent_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "red_team_evidence_items" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "trust" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "red_team_evidence_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "red_team_findings" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "agent" "RedTeamAgentType" NOT NULL,
    "category" TEXT NOT NULL,
    "type" "RedTeamFindingType" NOT NULL,
    "severity" "RedTeamFindingSeverity" NOT NULL,
    "confidence" "RedTeamConfidence" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "implication" TEXT NOT NULL,
    "recommended_action" TEXT NOT NULL,
    "status" "RedTeamFindingStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "red_team_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "red_team_finding_evidence" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "evidence_item_id" TEXT NOT NULL,
    "evidence_ref" TEXT NOT NULL,

    CONSTRAINT "red_team_finding_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "red_team_assumption_challenges" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "assumption_key" TEXT NOT NULL,
    "classification" "AssumptionSupport" NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence_refs" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "red_team_assumption_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "red_team_evidence_requests" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "requested_document" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "priority" "RedTeamFindingSeverity" NOT NULL,
    "related_finding_id" TEXT,
    "evidence_refs" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "red_team_evidence_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "red_team_cross_reviews" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "original_agent" "RedTeamAgentType" NOT NULL,
    "reviewer_agent" "RedTeamAgentType" NOT NULL,
    "decision" "CrossReviewDecision" NOT NULL,
    "rationale" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "red_team_cross_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "red_team_disagreements" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "finding_a_id" TEXT NOT NULL,
    "finding_b_id" TEXT NOT NULL,
    "agents" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "resolution" TEXT NOT NULL,
    "status" "RedTeamDisagreementStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "red_team_disagreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "red_team_executive_conclusions" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "decision" "RedTeamDecision" NOT NULL,
    "confidence" "RedTeamConfidence" NOT NULL,
    "dominant_risk" TEXT NOT NULL,
    "top_finding_ids" JSONB NOT NULL,
    "decision_blocker_ids" JSONB NOT NULL,
    "required_actions" JSONB NOT NULL,
    "evidence_request_ids" JSONB NOT NULL,
    "disagreement_ids" JSONB NOT NULL,
    "strengths" JSONB NOT NULL,
    "mitigations" JSONB NOT NULL,
    "residual_risk" TEXT NOT NULL,
    "what_would_change_decision" JSONB NOT NULL,
    "engine_position" TEXT NOT NULL,
    "executive_summary" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "red_team_executive_conclusions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "red_team_agent_results_run_id_agent_key" ON "red_team_agent_results"("run_id", "agent");

-- CreateIndex
CREATE INDEX "red_team_evidence_items_run_id_kind_idx" ON "red_team_evidence_items"("run_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "red_team_evidence_items_run_id_ref_key" ON "red_team_evidence_items"("run_id", "ref");

-- CreateIndex
CREATE INDEX "red_team_findings_run_id_severity_status_idx" ON "red_team_findings"("run_id", "severity", "status");

-- CreateIndex
CREATE UNIQUE INDEX "red_team_findings_run_id_code_key" ON "red_team_findings"("run_id", "code");

-- CreateIndex
CREATE INDEX "red_team_finding_evidence_evidence_item_id_idx" ON "red_team_finding_evidence"("evidence_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "red_team_finding_evidence_finding_id_evidence_ref_key" ON "red_team_finding_evidence"("finding_id", "evidence_ref");

-- CreateIndex
CREATE INDEX "red_team_assumption_challenges_run_id_assumption_key_idx" ON "red_team_assumption_challenges"("run_id", "assumption_key");

-- CreateIndex
CREATE UNIQUE INDEX "red_team_assumption_challenges_run_id_code_key" ON "red_team_assumption_challenges"("run_id", "code");

-- CreateIndex
CREATE INDEX "red_team_evidence_requests_run_id_priority_status_idx" ON "red_team_evidence_requests"("run_id", "priority", "status");

-- CreateIndex
CREATE UNIQUE INDEX "red_team_evidence_requests_run_id_code_key" ON "red_team_evidence_requests"("run_id", "code");

-- CreateIndex
CREATE INDEX "red_team_cross_reviews_finding_id_idx" ON "red_team_cross_reviews"("finding_id");

-- CreateIndex
CREATE UNIQUE INDEX "red_team_cross_reviews_run_id_code_key" ON "red_team_cross_reviews"("run_id", "code");

-- CreateIndex
CREATE INDEX "red_team_disagreements_finding_a_id_idx" ON "red_team_disagreements"("finding_a_id");

-- CreateIndex
CREATE INDEX "red_team_disagreements_finding_b_id_idx" ON "red_team_disagreements"("finding_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "red_team_disagreements_run_id_code_key" ON "red_team_disagreements"("run_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "red_team_executive_conclusions_run_id_key" ON "red_team_executive_conclusions"("run_id");

-- CreateIndex
CREATE INDEX "red_team_runs_organization_id_status_created_at_idx" ON "red_team_runs"("organization_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "red_team_runs_study_version_id_scenario_id_red_team_version_key" ON "red_team_runs"("study_version_id", "scenario_id", "red_team_version");

-- AddForeignKey
ALTER TABLE "red_team_runs" ADD CONSTRAINT "red_team_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_team_runs" ADD CONSTRAINT "red_team_runs_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "scenarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_team_agent_results" ADD CONSTRAINT "red_team_agent_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "red_team_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_team_evidence_items" ADD CONSTRAINT "red_team_evidence_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "red_team_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_team_findings" ADD CONSTRAINT "red_team_findings_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "red_team_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_team_finding_evidence" ADD CONSTRAINT "red_team_finding_evidence_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "red_team_findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_team_finding_evidence" ADD CONSTRAINT "red_team_finding_evidence_evidence_item_id_fkey" FOREIGN KEY ("evidence_item_id") REFERENCES "red_team_evidence_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_team_assumption_challenges" ADD CONSTRAINT "red_team_assumption_challenges_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "red_team_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_team_evidence_requests" ADD CONSTRAINT "red_team_evidence_requests_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "red_team_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_team_evidence_requests" ADD CONSTRAINT "red_team_evidence_requests_related_finding_id_fkey" FOREIGN KEY ("related_finding_id") REFERENCES "red_team_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_team_cross_reviews" ADD CONSTRAINT "red_team_cross_reviews_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "red_team_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_team_cross_reviews" ADD CONSTRAINT "red_team_cross_reviews_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "red_team_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_team_disagreements" ADD CONSTRAINT "red_team_disagreements_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "red_team_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_team_disagreements" ADD CONSTRAINT "red_team_disagreements_finding_a_id_fkey" FOREIGN KEY ("finding_a_id") REFERENCES "red_team_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_team_disagreements" ADD CONSTRAINT "red_team_disagreements_finding_b_id_fkey" FOREIGN KEY ("finding_b_id") REFERENCES "red_team_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_team_executive_conclusions" ADD CONSTRAINT "red_team_executive_conclusions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "red_team_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every Red Team artifact is append-only once its StudyVersion is a SNAPSHOT.
CREATE OR REPLACE FUNCTION prevent_snapshot_red_team_child_mutation()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "red_team_runs" run
    JOIN "study_versions" sv ON sv."id" = run."study_version_id"
    WHERE run."id" = OLD."run_id" AND sv."status" = 'SNAPSHOT'
  ) THEN
    RAISE EXCEPTION 'snapshot red team artifacts are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_snapshot_red_team_finding_evidence_mutation()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "red_team_findings" finding
    JOIN "red_team_runs" run ON run."id" = finding."run_id"
    JOIN "study_versions" sv ON sv."id" = run."study_version_id"
    WHERE finding."id" = OLD."finding_id" AND sv."status" = 'SNAPSHOT'
  ) THEN
    RAISE EXCEPTION 'snapshot red team finding evidence is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER red_team_agent_results_immutable BEFORE UPDATE OR DELETE ON "red_team_agent_results" FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_red_team_child_mutation();
CREATE TRIGGER red_team_evidence_items_immutable BEFORE UPDATE OR DELETE ON "red_team_evidence_items" FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_red_team_child_mutation();
CREATE TRIGGER red_team_findings_immutable BEFORE UPDATE OR DELETE ON "red_team_findings" FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_red_team_child_mutation();
CREATE TRIGGER red_team_assumption_challenges_immutable BEFORE UPDATE OR DELETE ON "red_team_assumption_challenges" FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_red_team_child_mutation();
CREATE TRIGGER red_team_evidence_requests_immutable BEFORE UPDATE OR DELETE ON "red_team_evidence_requests" FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_red_team_child_mutation();
CREATE TRIGGER red_team_cross_reviews_immutable BEFORE UPDATE OR DELETE ON "red_team_cross_reviews" FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_red_team_child_mutation();
CREATE TRIGGER red_team_disagreements_immutable BEFORE UPDATE OR DELETE ON "red_team_disagreements" FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_red_team_child_mutation();
CREATE TRIGGER red_team_executive_conclusions_immutable BEFORE UPDATE OR DELETE ON "red_team_executive_conclusions" FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_red_team_child_mutation();
CREATE TRIGGER red_team_finding_evidence_immutable BEFORE UPDATE OR DELETE ON "red_team_finding_evidence" FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_red_team_finding_evidence_mutation();
