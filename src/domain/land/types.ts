import type { FinancialResult, ProjectAssumptions } from "@/domain/financial/types";
import type { RedeScoreResult } from "@/domain/score";

export const LAND_ENGINE_VERSION = "REDE_LAND_V1.0.0";
export const ZONING_SOLVER_VERSION = "REDE_ZONING_SOLVER_V1.0.0";

export type UrbanSourceType = "OFFICIAL_API" | "OFFICIAL_MAP" | "OFFICIAL_LAW" | "OFFICIAL_DOCUMENT" | "USER_DOCUMENT" | "USER_INPUT" | "DERIVED" | "INFERRED";
export type UrbanConfidence = "CONFIRMED" | "HIGH" | "MEDIUM" | "LOW" | "MANUAL";
export type LandAnalysisStatus = "PRELIMINARY" | "PARTIALLY_VERIFIED" | "VERIFIED_INPUTS" | "ARCHITECT_REVIEWED" | "SUPERSEDED";
export type UrbanScenarioType = "CURRENT_LEGAL" | "CONSERVATIVE_CHANGE" | "PROPOSED" | "TARGET" | "OPTIMIZED" | "MAXIMUM_POTENTIAL" | "CUSTOM";
export type UrbanRestrictionType = "ROAD" | "ENVIRONMENTAL" | "WATERCOURSE" | "APP" | "EASEMENT" | "POWER_LINE" | "PIPELINE" | "HERITAGE" | "AVIATION" | "TOPOGRAPHY" | "GEOLOGICAL" | "FLOOD" | "MUNICIPAL" | "REGISTRY" | "OTHER";
export type UrbanRestrictionSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type MassingType = "SINGLE_TOWER" | "MULTIPLE_TOWERS" | "SLAB" | "PODIUM_TOWER" | "COURTYARD" | "CUSTOM";
export type OptimizationObjective = "MINIMUM_REGULATORY_CHANGE" | "MAXIMUM_UNITS" | "MAXIMUM_NPV" | "MAXIMUM_MARGIN" | "MAXIMUM_ROI" | "MAXIMUM_SCORE" | "MINIMUM_EQUITY" | "MINIMUM_PEAK_EXPOSURE" | "BALANCED";

export interface Point2D { x: number; y: number }
export interface PolygonGeometry { type: "Polygon"; coordinates: Point2D[] }

export interface UrbanSource {
  id: string;
  type: UrbanSourceType;
  authority: string;
  title: string;
  url: string | null;
  legislation: string | null;
  effectiveDate: string | null;
  accessedAt: string;
  version: string;
  confidence: UrbanConfidence;
  notes?: string;
}

export interface SourcedUrbanValue<T> {
  value: T;
  sourceId: string;
  confidence: UrbanConfidence;
  notes?: string;
}

export interface UrbanSetbacks {
  front: number;
  rear: number;
  side: number;
  betweenBuildings: number;
}

export interface UrbanParameters {
  zoningCode: SourcedUrbanValue<string>;
  zoningName: SourcedUrbanValue<string>;
  permittedUses: SourcedUrbanValue<string[]>;
  conditionalUses: SourcedUrbanValue<string[]>;
  prohibitedUses: SourcedUrbanValue<string[]>;
  minimumLotArea: SourcedUrbanValue<number | null>;
  minimumFrontage: SourcedUrbanValue<number | null>;
  basicFAR: SourcedUrbanValue<number | null>;
  maximumFAR: SourcedUrbanValue<number | null>;
  occupancyRate: SourcedUrbanValue<number | null>;
  permeabilityRate: SourcedUrbanValue<number | null>;
  maximumHeight: SourcedUrbanValue<number | null>;
  maximumFloors: SourcedUrbanValue<number | null>;
  setbacks: SourcedUrbanValue<UrbanSetbacks>;
  parkingRequirement: SourcedUrbanValue<number | null>;
  bicycleRequirement: SourcedUrbanValue<number | null>;
  residentialDensity: SourcedUrbanValue<number | null>;
  commercialAllowance: SourcedUrbanValue<boolean | null>;
  mixedUseAllowance: SourcedUrbanValue<boolean | null>;
  nonComputableAreaRate: SourcedUrbanValue<number | null>;
  customParameters: Record<string, SourcedUrbanValue<unknown>>;
}

export interface UrbanRestriction {
  id: string;
  type: UrbanRestrictionType;
  severity: UrbanRestrictionSeverity;
  geometry: PolygonGeometry | null;
  description: string;
  sourceId: string;
  confidence: UrbanConfidence;
  impact: string;
  verificationStatus: "VERIFIED" | "NOT_VERIFIED" | "NOT_APPLICABLE";
}

export interface LandAsset {
  id: string;
  organizationId: string;
  projectId: string | null;
  name: string;
  address: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  cadastralIdentifier: string | null;
  municipalRegistration: string | null;
  area: number;
  frontage: number;
  polygon: PolygonGeometry;
  sourceId: string;
}

export interface UrbanScenario {
  id: string;
  landAssetId: string;
  name: string;
  type: UrbanScenarioType;
  status: LandAnalysisStatus;
  parameters: UrbanParameters;
  restrictions: UrbanRestriction[];
  sourceIds: string[];
  isHypothetical: boolean;
  disclaimer: string | null;
}

export interface EnvelopeWarning {
  code: "INVALID_GEOMETRY" | "MISSING_PARAMETER" | "FAR_EXCEEDED" | "OCCUPANCY_EXCEEDED" | "PERMEABILITY_INSUFFICIENT" | "HEIGHT_EXCEEDED" | "SETBACK_VIOLATED" | "PARKING_INCOMPATIBLE" | "RESTRICTION_NOT_VERIFIED" | "STALE_SOURCE";
  severity: "INFO" | "WARNING" | "BLOCKER";
  message: string;
}

export interface BuildableEnvelope {
  version: string;
  scenarioId: string;
  buildableGroundPolygon: PolygonGeometry;
  maximumFootprintArea: number;
  maximumComputableArea: number;
  estimatedNonComputableArea: number;
  maximumTotalArea: number;
  maximumHeight: number;
  estimatedFloors: number;
  regulatoryConstraints: string[];
  warnings: EnvelopeWarning[];
}

export interface UnitType {
  name: string;
  privateArea: number;
  quantity: number;
  bedrooms: number;
  bathrooms: number;
  parkingSpaces: number;
  balconyArea?: number;
  targetPrice: number;
  targetPricePerSqm: number;
}

export interface ProductStrategy {
  use: "RESIDENTIAL" | "MIXED_USE";
  unitMix: UnitType[];
  averageUnitArea: number;
  parkingRatio: number;
  targetEfficiency: number;
  commonAreaRatio: number;
  amenityArea: number;
  commercialArea: number;
  numberOfTowers: number;
  unitsPerFloor: number;
  floors: number;
  elevators: number;
  stairs: number;
}

export interface DevelopmentPhase {
  id: string;
  name: string;
  order: number;
  towerIds: string[];
  units: number;
  startMonth: number;
  constructionMonths: number;
}

export interface MassingBuilding {
  id: string;
  name: string;
  phaseId: string;
  kind: "TOWER" | "PODIUM" | "PARKING" | "AMENITY";
  x: number;
  y: number;
  width: number;
  depth: number;
  floors: number;
  floorHeight: number;
  rotation: number;
}

export interface Masterplan {
  phases: DevelopmentPhase[];
  buildings: MassingBuilding[];
  sharedInfrastructureArea: number;
  amenityAreas: number;
  roadsArea: number;
  openSpacesArea: number;
  parkingStructures: number;
}

export interface MassingModel {
  type: MassingType;
  buildings: MassingBuilding[];
  sitePolygon: PolygonGeometry;
  envelopePolygon: PolygonGeometry;
  totalFootprint: number;
  totalFloors: number;
}

export interface AreaSchedule {
  landArea: number;
  footprintArea: number;
  computableArea: number;
  nonComputableArea: number;
  totalBuiltArea: number;
  privateArea: number;
  commonArea: number;
  technicalArea: number;
  garageArea: number;
  amenityArea: number;
  circulationArea: number;
  efficiency: number;
  units: number;
  parkingSpaces: number;
  averageUnitArea: number;
  legalComputablePotential: number;
  potentialUtilization: number;
  densityUnitsPerHectare: number;
  privateAreaPerLandArea: number;
  farUtilization: number;
  occupancyUtilization: number;
  commonAreaPerUnit: number;
  amenityAreaPerUnit: number;
}

export interface LandOption {
  id: string;
  name: string;
  scenarioId: string;
  massingType: MassingType;
  product: ProductStrategy;
  masterplan: Masterplan;
  envelope: BuildableEnvelope;
  massing: MassingModel;
  areaSchedule: AreaSchedule;
  engineAssumptions: ProjectAssumptions;
  financialResult: FinancialResult;
  score: RedeScoreResult;
  warnings: EnvelopeWarning[];
  rank: number;
  paretoEfficient: boolean;
}

export interface ReverseZoningTarget {
  units: number;
  averageUnitArea: number;
  minimumMarginRate: number;
  minimumScore: number;
  maximumExposure: number;
  numberOfTowers: number;
  efficiency: number;
  unitsPerFloor: number;
  parkingRatio: number;
}

export interface ReverseZoningResult {
  version: string;
  feasible: boolean;
  requiredFAR: number;
  requiredOccupancyRate: number;
  requiredHeight: number;
  requiredFloors: number;
  requiredDensity: number;
  requiredComputableArea: number;
  requiredTotalBuiltArea: number;
  requiredParkingSpaces: number;
  landUtilization: number;
  warnings: string[];
}

export interface UrbanGapItem {
  key: string;
  label: string;
  current: string | number | null;
  required: string | number | null;
  gap: number | null;
  unit: string;
  status: "MEETS" | "CHANGE_REQUIRED" | "NOT_VERIFIED";
}

export interface UrbanGapAnalysis {
  currentScenarioId: string;
  targetScenarioId: string;
  items: UrbanGapItem[];
  minimumChangeScore: number;
}

export interface UrbanUpliftAnalysis {
  currentScenarioId: string;
  proposedScenarioId: string;
  additionalComputableArea: number;
  additionalPrivateArea: number;
  additionalUnits: number;
  additionalVGV: number;
  changeInProfit: number;
  changeInNPV: number;
  changeInEquity: number;
  changeInScore: number;
}

export interface RegulatoryConfidence {
  score: number;
  label: "ALTA CONFIANÇA" | "VERIFICAÇÃO COMPLEMENTAR NECESSÁRIA" | "BAIXA CONFIANÇA";
  completeness: number;
  sourceQuality: number;
  missing: string[];
}

export interface LandStudySnapshot {
  version: string;
  id: string;
  landStudyId: string;
  versionNumber: number;
  status: LandAnalysisStatus;
  createdAt: string;
  landAsset: LandAsset;
  sources: UrbanSource[];
  scenarios: UrbanScenario[];
  options: LandOption[];
  selectedScenarioId: string;
  selectedOptionId: string;
  regulatoryConfidence: RegulatoryConfidence;
  reverseZoning: ReverseZoningResult;
  gapAnalysis: UrbanGapAnalysis;
  upliftAnalysis: UrbanUpliftAnalysis;
}

export interface LandWorkspaceView {
  landStudyId: string;
  versionId: string;
  versionNumber: number;
  snapshot: LandStudySnapshot;
}
