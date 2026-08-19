export type DesignOrigin = "CONFIRMED" | "EXTRACTED" | "CALCULATED" | "INFERRED" | "USER_PROVIDED" | "NOT_VERIFIED";
export type DesignConfidence = "HIGH" | "MEDIUM" | "LOW" | "NOT_VERIFIED";
export type DesignSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type DesignFindingStatus = "OPEN" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED" | "IN_PROGRESS" | "RESOLVED" | "WONT_FIX" | "SUPERSEDED" | "POSSIBLY_RESOLVED";
export type DesignFileSupport = "SUPPORTED" | "PARTIAL" | "CONVERSION_REQUIRED" | "UNSUPPORTED";

export interface DesignEvidence {
  ref: string;
  label: string;
  value?: string;
  origin: DesignOrigin;
  confidence: DesignConfidence;
  fileId?: string;
  sheetId?: string;
  page?: number;
  region?: { x: number; y: number; width: number; height: number };
  elementId?: string;
  method: string;
}

export interface DesignMetricInput {
  name: string;
  value: number;
  unit: string;
  entityType?: string;
  entityId?: string;
  origin: DesignOrigin;
  confidence: DesignConfidence;
  evidence: DesignEvidence[];
}

export interface DesignDocumentInput {
  id: string;
  name: string;
  extension: string;
  discipline: string;
  pageCount?: number;
  scaleConfidence?: "CONFIRMED" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  support: DesignFileSupport;
}

export interface DesignBriefInput {
  targetUnits?: number;
  targetPrivateAreaM2?: number;
  targetBuiltAreaM2?: number;
  targetEfficiencyRate?: number;
  maximumCirculationRate?: number;
  maximumCoreRate?: number;
  targetParkingSpaces?: number;
  targetCost?: number;
  plannedUnitMix?: Record<string, number>;
}

export interface DesignUrbanContext {
  scenarioType: "CURRENT_LEGAL" | "TARGET" | "OPTIMIZED" | "CUSTOM";
  maximumFloorAreaRatio?: number;
  maximumFootprintRate?: number;
  minimumPermeabilityRate?: number;
  sourceRef?: string;
  confidence: DesignConfidence;
}

export interface DesignEconomicsContext {
  engineBuiltAreaM2?: number;
  enginePrivateAreaM2?: number;
  engineUnits?: number;
  constructionCostPerM2?: number;
  averageRevenuePerPrivateM2?: number;
  engineEvidenceRef?: string;
}

export interface DesignReviewInput {
  revisionId: string;
  projectName: string;
  reviewMode: string;
  documents: DesignDocumentInput[];
  metrics: DesignMetricInput[];
  brief?: DesignBriefInput;
  urban?: DesignUrbanContext;
  economics?: DesignEconomicsContext;
  areaToleranceRate?: number;
  areaToleranceM2?: number;
}

export interface DesignFindingDraft {
  key: string;
  discipline: string;
  category: string;
  type: string;
  severity: DesignSeverity;
  confidence: DesignConfidence;
  title: string;
  description: string;
  implication: string;
  recommendation: string;
  evidence: DesignEvidence[];
  relatedMetric?: string;
  potentialImpact?: Record<string, number | string | null>;
  status: DesignFindingStatus;
}

export interface VEOpportunityDraft {
  key: string;
  title: string;
  category: string;
  currentCondition: string;
  proposedCondition: string;
  evidence: DesignEvidence[];
  relatedFindingKeys: string[];
  designImpact: Record<string, number | string | null>;
  costImpact: number | null;
  revenueImpact: number | null;
  scheduleImpactMonths: number | null;
  riskImpact: string;
  confidence: DesignConfidence;
  effort: "LOW" | "MEDIUM" | "HIGH";
  requiresProfessionalValidation: true;
  valueRank: number;
}

export interface DesignScorecardDimension {
  key: "AREA_EFFICIENCY" | "PRODUCT_ALIGNMENT" | "URBAN_ALIGNMENT" | "CONSTRUCTABILITY" | "COST_OPPORTUNITY" | "DOCUMENT_COMPLETENESS" | "COORDINATION";
  label: string;
  status: "POSITIVE" | "ATTENTION" | "CRITICAL" | "NOT_VERIFIED";
  value: number | null;
  explanation: string;
  evidenceRefs: string[];
}

export interface DesignReviewOutput {
  schemaVersion: "REDE_DESIGN_REVIEW_V1";
  preflight: {
    status: "READY" | "READY_WITH_LIMITATIONS" | "NOT_READY";
    limitations: string[];
    missingInformation: string[];
    dataQuality: DesignConfidence;
  };
  calculatedMetrics: DesignMetricInput[];
  findings: DesignFindingDraft[];
  opportunities: VEOpportunityDraft[];
  scorecard: DesignScorecardDimension[];
  insights: string[];
  summary: {
    criticalFindings: number;
    openFindings: number;
    quantifiedOpportunities: number;
    efficiencyRate: number | null;
    designDriftRate: number | null;
  };
}

export interface DesignAdapterSheet {
  pageNumber: number;
  widthPoints?: number;
  heightPoints?: number;
  title?: string;
  sheetNumber?: string;
  revision?: string;
  scaleDenominator?: number;
  scaleConfidence: "CONFIRMED" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  extractedText?: string;
  textConfidence: DesignConfidence;
  metadata?: Record<string, unknown>;
}

export interface DesignAdapterResult {
  adapter: string;
  version: string;
  support: DesignFileSupport;
  status: "COMPLETED" | "PARTIAL";
  fileType: string;
  metadata: Record<string, unknown>;
  sheets: DesignAdapterSheet[];
  extracted: Array<{ kind: string; key: string; value: string | number; unit?: string; origin: DesignOrigin; confidence: DesignConfidence; method: string }>;
  limitations: string[];
}

export interface DesignFileAdapter {
  readonly name: string;
  readonly version: string;
  canHandle(input: { extension: string; mimeType: string; bytes: Uint8Array }): boolean;
  process(input: { fileName: string; extension: string; mimeType: string; bytes: Uint8Array }): Promise<DesignAdapterResult>;
}

export interface DesignWorkspaceView {
  package: {
    id: string;
    projectId: string;
    name: string;
    description: string;
    status: string;
    template: string;
    reviewMode: string;
    preflightStatus: string;
    limitations: string[];
  };
  revision: { id: string; label: string; versionNumber: number; status: string };
  revisions: Array<{ id: string; label: string; versionNumber: number; status: string; createdAt: string }>;
  revisionDiff: Array<{ name: string; unit: string; from: number | null; to: number | null; delta: number | null; deltaRate: number | null; kind: "ADDED" | "REMOVED" | "MODIFIED" | "UNCHANGED"; confidence: DesignConfidence; evidenceRefs: string[] }>;
  files: Array<{
    id: string;
    name: string;
    type: string;
    mimeType: string;
    discipline: string;
    status: string;
    processingStatus: string;
    size: number;
    metadata?: Record<string, unknown>;
    sheets: Array<{ id: string; pageNumber: number; title: string | null; sheetNumber: string | null; scaleConfidence: string }>;
  }>;
  metrics: Array<{ id: string; name: string; value: number; unit: string; origin: DesignOrigin; confidence: DesignConfidence; evidenceRefs: string[] }>;
  findings: Array<DesignFindingDraft & { id: string; fileId?: string; sheetId?: string; ownerId?: string; dueDate?: string }>;
  opportunities: Array<VEOpportunityDraft & { id: string; status: string }>;
  alternatives: Array<{ id: string; name: string; description: string; status: string; changes: Record<string, unknown>; financialImpact: Record<string, unknown> | null; scoreImpact: Record<string, unknown> | null }>;
  scorecard: DesignScorecardDimension[];
  summary: DesignReviewOutput["summary"];
  insights: string[];
  supportedFormats: Array<{ extension: string; support: DesignFileSupport; note: string }>;
}
