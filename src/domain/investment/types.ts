import type { ProjectAssumptions, FinancialResult, ScenarioKey } from "@/domain/financial/types";
import type { RedeScoreResult } from "@/domain/score";
import type { SensitivityResult } from "@/domain/sensitivity";
import type { RedTeamReport } from "@/domain/red-team";
import type { LandStudySnapshot } from "@/domain/land";

export const INVESTMENT_BUNDLE_VERSION = "INVESTMENT_BUNDLE_V1.0.0";
export const DOCUMENT_MODEL_VERSION = "REDE_DOCUMENT_MODEL_V1.0.0";

export type InvestmentCaseStatus = "DRAFT" | "READY_FOR_REVIEW" | "IN_COMMITTEE" | "APPROVED" | "APPROVED_WITH_CONDITIONS" | "RESTRUCTURE" | "REJECTED" | "ON_HOLD" | "SUPERSEDED";
export type CommitteeDecisionType = "APPROVE" | "APPROVE_WITH_CONDITIONS" | "RESTRUCTURE" | "REJECT" | "ON_HOLD";
export type DecisionConfidence = "LOW" | "MEDIUM" | "HIGH";
export type ReviewRoundStatus = "DRAFT" | "SUBMITTED" | "IN_COMMITTEE" | "DECIDED" | "SUPERSEDED";
export type CommitteeRole = "CHAIR" | "VOTING_MEMBER" | "REVIEWER" | "OBSERVER";
export type CommitteeVoteDecision = "APPROVE" | "APPROVE_WITH_CONDITIONS" | "RESTRUCTURE" | "REJECT" | "ABSTAIN";
export type InvestmentConditionStatus = "OPEN" | "IN_PROGRESS" | "SUBMITTED" | "VERIFIED" | "WAIVED" | "REJECTED" | "CLOSED";
export type InvestmentConditionCategory = "URBAN" | "LEGAL" | "ENGINEERING" | "COMMERCIAL" | "FINANCIAL" | "FUNDING" | "CORPORATE" | "ENVIRONMENTAL" | "DOCUMENTATION" | "OTHER";
export type InvestmentPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type StudioArtifactType = "INVESTMENT_BOOK" | "INVESTMENT_MEMO" | "INVESTOR_DECK" | "ONE_PAGE" | "COMMITTEE_MEMO" | "URBAN_CASE" | "EXECUTIVE_REPORT" | "RED_TEAM_REPORT" | "DATA_ROOM_INDEX" | "INVESTOR_QA_PACK" | "MANAGEMENT_SUMMARY" | "BOARD_SUMMARY" | "MUNICIPALITY_PRESENTATION" | "LANDOWNER_PRESENTATION" | "FINANCIER_PACK" | "MASTER_REPORT" | "DESIGN_REVIEW_REPORT";
export type StudioArtifactStatus = "DRAFT" | "UNDER_REVIEW" | "APPROVED" | "FINAL" | "SUPERSEDED";
export type ArtifactGenerationStatus = "QUEUED" | "GENERATING" | "COMPLETED" | "FAILED";
export type ArtifactWatermark = "DRAFT" | "CONFIDENTIAL" | "FINAL";
export type DocumentStatus = "REQUESTED" | "RECEIVED" | "UNDER_REVIEW" | "VERIFIED" | "EXPIRED" | "SUPERSEDED" | "REJECTED";
export type DocumentConfidentiality = "PUBLIC_INTERNAL" | "CONFIDENTIAL" | "STRICTLY_CONFIDENTIAL";
export type DataRoomCategory = "01_TERRENO" | "02_URBANISTICO" | "03_JURIDICO" | "04_PROJETOS" | "05_ENGENHARIA" | "06_ORCAMENTO" | "07_MERCADO" | "08_COMERCIAL" | "09_FINANCEIRO" | "10_FUNDING" | "11_SOCIETARIO" | "12_AMBIENTAL" | "13_COMITE" | "14_RELATORIOS" | "15_OUTROS";
export type UrbanImpactDirection = "POSITIVE" | "NEGATIVE" | "NEUTRAL";
export type UrbanImpactCategory = "MOBILITY" | "TRAFFIC" | "SANITATION" | "DRAINAGE" | "ENERGY" | "EDUCATION" | "HEALTH" | "ENVIRONMENT" | "PUBLIC_SPACE" | "COMMERCE" | "EMPLOYMENT" | "HOUSING" | "SOCIAL" | "FISCAL" | "OTHER";
export type UrbanContributionCategory = "ROAD" | "MOBILITY" | "PUBLIC_SPACE" | "PARK" | "DRAINAGE" | "SANITATION" | "EDUCATION" | "HEALTH" | "AFFORDABLE_HOUSING" | "ENVIRONMENT" | "UTILITY" | "OTHER";
export type UrbanApprovalStatus = "NOT_STARTED" | "IN_PREPARATION" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "APPROVED_WITH_CONDITIONS" | "REJECTED" | "EXPIRED";
export type StageGateDecision = "GO" | "GO_WITH_CONDITIONS" | "HOLD" | "STOP";
export type AudienceProfile = "INTERNAL" | "INVESTMENT_COMMITTEE" | "BOARD" | "INVESTOR" | "FINANCIER" | "MUNICIPALITY" | "LANDOWNER";
export type AssumptionRegisterStatus = "ACTIVE" | "CHALLENGED" | "VALIDATED" | "SUPERSEDED";
export type ClaimStatus = "DRAFT" | "SUPPORTED" | "CHALLENGED" | "RETRACTED";
export type IssueStatus = "OPEN" | "IN_PROGRESS" | "BLOCKED" | "RESOLVED" | "CLOSED";

export interface BundleDocument {
  id: string;
  category: DataRoomCategory;
  title: string;
  version: number;
  status: DocumentStatus;
  checksum: string;
}

export interface TransformationEconomicImpact {
  includedCost: number;
  classification: "URBAN_TRANSFORMATION_COST";
  base: FinancialResult;
  adjusted: FinancialResult;
  evidenceRefs: string[];
}

export interface InvestmentSnapshotBundle {
  bundleVersion: string;
  frozenAt: string;
  organizationId: string;
  projectId: string;
  studyId: string;
  studyVersionId: string;
  studyVersionNumber: number;
  landStudyVersionId: string | null;
  landVersionNumber: number | null;
  redTeamRunId: string | null;
  scenario: ScenarioKey;
  project: { name: string; city: string; state: string };
  assumptions: ProjectAssumptions;
  engineResults: Record<ScenarioKey, FinancialResult>;
  cashFlow: FinancialResult["cashFlow"];
  scores: Record<ScenarioKey, RedeScoreResult>;
  sensitivity: SensitivityResult;
  redTeam: RedTeamReport | null;
  land: LandStudySnapshot | null;
  documents: BundleDocument[];
  missingEvidence: string[];
  transformationEconomics: TransformationEconomicImpact | null;
}

export interface ReadinessDimension {
  key: "FINANCIAL" | "URBAN" | "LEGAL" | "ENGINEERING" | "COMMERCIAL" | "FUNDING" | "DOCUMENTATION" | "RISK";
  score: number;
  evidenceRefs: string[];
  missing: string[];
}

export interface InvestmentReadiness {
  score: number;
  dimensions: ReadinessDimension[];
  blockers: string[];
  label: "READY" | "PARTIALLY_READY" | "NOT_READY";
}

export interface DataRoomChecklistItemView {
  id: string;
  category: DataRoomCategory;
  title: string;
  required: boolean;
  critical: boolean;
  source: "DEFAULT" | "RED_TEAM" | "COMMITTEE";
  status: DocumentStatus;
  documentId: string | null;
}

export interface DataRoomCompleteness {
  overall: number;
  categories: { category: DataRoomCategory; score: number; received: number; total: number }[];
  warning: string;
}

export interface ApprovalPathItem {
  id: string;
  title: string;
  source: "ENGINE" | "POLICY" | "SENSITIVITY" | "BREAK_EVEN" | "RED_TEAM" | "CONDITION" | "URBAN";
  evidenceRef: string;
  target: string;
  blocker: boolean;
  resolved: boolean;
}

export interface NarrativeEvidenceRef {
  ref: string;
  label: string;
  sourceVersion: string;
}

export interface NarrativeBlock {
  id: string;
  text: string;
  origin: "SYSTEM_GENERATED" | "USER_EDITED";
  evidenceRefs: NarrativeEvidenceRef[];
}

export interface LockedMetric {
  key: string;
  label: string;
  value: string;
  unit: string;
  sourceRef: string;
  sourceVersion: string;
  locked: true;
}

export type DocumentBlock =
  | { type: "NARRATIVE"; narrative: NarrativeBlock }
  | { type: "METRICS"; metrics: LockedMetric[] }
  | { type: "TABLE"; headers: string[]; rows: string[][]; evidenceRefs: string[] }
  | { type: "CHART"; chartType: "CASH_FLOW" | "COSTS" | "SCORE" | "SENSITIVITY" | "UPLIFT" | "PHASING" | "VALUE_BRIDGE"; title: string; labels: string[]; values: number[]; evidenceRefs: string[] }
  | { type: "MASSING"; title: string; current: { x: number; y: number; width: number; depth: number; floors: number }[]; proposed: { x: number; y: number; width: number; depth: number; floors: number }[]; evidenceRefs: string[] }
  | { type: "DISCLAIMER"; text: string };

export interface DocumentSection {
  key: string;
  title: string;
  order: number;
  blocks: DocumentBlock[];
}

export interface IntermediateDocumentModel {
  schemaVersion: string;
  artifactType: StudioArtifactType;
  title: string;
  subtitle: string;
  metadata: Record<string, string>;
  sections: DocumentSection[];
  disclaimers: string[];
  sources: { ref: string; title: string; url: string | null }[];
  generatedAt: string;
  audience: AudienceProfile;
  confidentialityBySection: Record<string, DocumentConfidentiality>;
}

export interface OrganizationBrandConfig {
  organizationName: string;
  monogram: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontHeading: string;
  fontBody: string;
  footer: string;
  disclaimer: string;
  contactInfo: string;
}

export interface CommitteeDecisionView {
  id: string;
  roundNumber: number;
  decision: CommitteeDecisionType;
  confidence: DecisionConfidence;
  rationale: string;
  dominantRisk: string;
  decidedAt: string;
  approvedBy: string;
}

export interface InvestmentConditionView {
  id: string;
  title: string;
  description: string;
  category: InvestmentConditionCategory;
  priority: InvestmentPriority;
  status: InvestmentConditionStatus;
  isBlocker: boolean;
  evidenceRequired: string;
  ownerName: string | null;
  dueDate: string | null;
}

export interface ReviewRoundView {
  id: string;
  roundNumber: number;
  status: ReviewRoundStatus;
  submittedAt: string | null;
  decidedAt: string | null;
  bundleId: string;
}

export interface StudioArtifactView {
  id: string;
  type: StudioArtifactType;
  version: number;
  status: StudioArtifactStatus;
  generationStatus: ArtifactGenerationStatus;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  pageCount: number | null;
  checksum: string | null;
  generatedAt: string | null;
  snapshotBundleId: string;
  sourceOutdated: boolean;
}

export interface ProjectDocumentView extends BundleDocument {
  fileName: string;
  mimeType: string;
  fileSize: number;
  confidentiality: DocumentConfidentiality;
  uploadedAt: string;
}

export interface UrbanTransformationView {
  inhabitantsPerUnit: number;
  estimatedPopulation: number;
  readiness: number;
  readinessLabel: string;
  infrastructure: { id: string; category: string; description: string; status: string; confidence: string; source: string }[];
  impacts: { id: string; category: UrbanImpactCategory; direction: UrbanImpactDirection; magnitude: string; description: string; confidence: string; evidence: string; mitigation: string }[];
  contributions: { id: string; category: UrbanContributionCategory; title: string; estimatedCost: number | null; phase: string; status: string; required: boolean; voluntary: boolean }[];
  costs: { id: string; category: string; title: string; amount: number; includedInEngine: boolean }[];
  milestones: { id: string; title: string; authority: string; status: UrbanApprovalStatus; plannedDate: string | null }[];
  stageGates: { id: string; gateNumber: number; title: string; decision: StageGateDecision; rationale: string; decidedAt: string }[];
  risks: { id: string; title: string; severity: InvestmentPriority; mitigation: string; evidenceRef: string }[];
}

export interface AssumptionRegisterItemView {
  id: string;
  key: string;
  category: string;
  value: string;
  unit: string;
  status: AssumptionRegisterStatus;
  ownerName: string | null;
  evidenceRef: string;
  sourceVersion: string;
}

export interface ClaimView {
  id: string;
  statement: string;
  status: ClaimStatus;
  evidenceRefs: string[];
  ownerName: string | null;
}

export interface DecisionLedgerEntryView {
  id: string;
  title: string;
  decision: string;
  rationale: string;
  decidedAt: string;
  decidedBy: string;
  evidenceRefs: string[];
}

export interface ProjectIssueView {
  id: string;
  title: string;
  status: IssueStatus;
  priority: InvestmentPriority;
  ownerName: string | null;
  dueDate: string | null;
  nextAction: string;
}

export interface DecisionSandboxView {
  id: string;
  name: string;
  status: "DRAFT" | "CALCULATED" | "PROMOTED" | "DISCARDED";
  changes: Record<string, string | number>;
  output: FinancialResult | null;
  promotedStudyVersionId: string | null;
}

export interface InvestmentCaseWorkspace {
  id: string;
  organizationId: string;
  title: string;
  description: string;
  status: InvestmentCaseStatus;
  createdAt: string;
  updatedAt: string;
  bundleId: string;
  bundleChecksum: string;
  bundle: InvestmentSnapshotBundle;
  bundleHistory: { id: string; version: number; checksum: string; studyVersionNumber: number; landVersionNumber: number | null; frozenAt: string }[];
  changeReport: { metric: string; previous: string; current: string; delta: number | null; previousBundleId: string; currentBundleId: string }[];
  readiness: InvestmentReadiness;
  dataRoomCompleteness: DataRoomCompleteness;
  approvalPath: ApprovalPathItem[];
  rounds: ReviewRoundView[];
  decisions: CommitteeDecisionView[];
  conditions: InvestmentConditionView[];
  checklist: DataRoomChecklistItemView[];
  documents: ProjectDocumentView[];
  artifacts: StudioArtifactView[];
  brand: OrganizationBrandConfig;
  urbanTransformation: UrbanTransformationView;
  assumptionsRegister: AssumptionRegisterItemView[];
  claims: ClaimView[];
  decisionLedger: DecisionLedgerEntryView[];
  issues: ProjectIssueView[];
  sandboxes: DecisionSandboxView[];
}
