import type { ProjectAssumptions, ScenarioKey } from "@/domain/financial/types";
import type { RedeScoreResult } from "@/domain/score";
import type { SensitivityResult } from "@/domain/sensitivity";
import type { RedTeamReport } from "@/domain/red-team";

export interface PersistedAnalytics {
  scores: Record<ScenarioKey, RedeScoreResult>;
  sensitivity: SensitivityResult;
}

export interface PersistedStudyView {
  projectId: string;
  studyId: string;
  studyVersionId: string;
  versionNumber: number;
  assumptions: ProjectAssumptions;
  analytics: PersistedAnalytics;
  redTeam: RedTeamReport | null;
}

export interface WorkspaceIdentity {
  userName: string;
  organizationName: string;
}

export type StudyActionResult =
  | { ok: true; data: PersistedStudyView }
  | { ok: false; error: string };
