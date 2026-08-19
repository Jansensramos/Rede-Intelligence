import { BARUERI_SOURCES, barueriSrmParameters } from "@/infrastructure/adapters/land/barueri";
import { polygonArea } from "./geometry";
import { calculateRegulatoryConfidence, createSimulatedScenario, evaluateLandOption, finalizeLandOptions, type LandFinancialTemplate } from "./engine";
import { calculateGapAnalysis, calculateUplift, solveReverseZoning } from "./solver";
import { LAND_ENGINE_VERSION, type LandAsset, type LandStudySnapshot, type PolygonGeometry, type ProductStrategy, type ReverseZoningTarget, type UrbanRestriction, type UrbanScenario } from "./types";

const calculatedAt = "2026-08-17T12:00:00.000Z";

export const DEMO_LAND_ASSET: LandAsset = {
  id: "land-demo-barueri",
  organizationId: "seed-organization",
  projectId: null,
  name: "Masterplan Barueri — Gleba Norte",
  address: "Avenida de referência — polígono demonstrativo",
  number: "s/n",
  neighborhood: "Barueri",
  city: "Barueri",
  state: "SP",
  postalCode: "06400-000",
  latitude: -23.5114,
  longitude: -46.8761,
  cadastralIdentifier: "DEMO — confirmar cadastro municipal",
  municipalRegistration: null,
  area: 14000,
  frontage: 140,
  polygon: { type: "Polygon", coordinates: [{ x: 0, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 100 }, { x: 0, y: 100 }] },
  sourceId: "BARUERI_MANUAL_PARCEL",
};

const unverifiedRestriction: UrbanRestriction = {
  id: "restriction-unverified",
  type: "OTHER",
  severity: "MEDIUM",
  geometry: null,
  description: "Restrições ambientais, viárias, registrais e de infraestrutura ainda não verificadas.",
  sourceId: "BARUERI_MANUAL_PARCEL",
  confidence: "MANUAL",
  impact: "Não descontado do envelope até existir evidência e geometria verificável.",
  verificationStatus: "NOT_VERIFIED",
};

export const DEMO_CURRENT_SCENARIO: UrbanScenario = {
  id: "urban-current-srm",
  landAssetId: DEMO_LAND_ASSET.id,
  name: "Referência legal vigente — SRM",
  type: "CURRENT_LEGAL",
  status: "PARTIALLY_VERIFIED",
  parameters: barueriSrmParameters(),
  restrictions: [unverifiedRestriction],
  sourceIds: ["BARUERI_LC565_2023", "BARUERI_ZONING_MAP", "BARUERI_MANUAL_PARCEL", "LAND_DERIVED"],
  isHypothetical: false,
  disclaimer: null,
};

export const DEMO_PROPOSED_SCENARIO = createSimulatedScenario(DEMO_CURRENT_SCENARIO, "urban-proposed-masterplan", "Cenário proposto — Masterplan 1.300", {
  zoningCode: "SRM-SIM 5.8",
  zoningName: "Simulação residencial de alta densidade",
  permittedUses: ["Residencial plurifamiliar vertical"],
  maximumFAR: 5.8,
  occupancyRate: 52,
  permeabilityRate: 20,
  maximumHeight: 55,
  maximumFloors: 18,
  frontSetback: 15,
  rearSetback: 6,
  sideSetback: 7,
  betweenBuildings: 10,
  parkingRequirement: 0.55,
  residentialDensity: 930,
}, "TARGET");

const financialTemplate: LandFinancialTemplate = {
  landPrice: 35_000_000,
  constructionCostPerM2: 2_850,
  indirectCostsRate: 9,
  contingencyRate: 6,
  taxRate: 2,
  commissionRate: 5,
  marketingRate: 2,
  approvalMonths: 18,
  constructionMonths: 42,
  financingLimit: 65_000_000,
  annualFinancingRate: 14,
  annualDiscountRate: 18,
  policy: { minimumMarginRate: "25", minimumRoiRate: "30", minimumIrrRate: "22", maximumExposure: "90000000", minimumContingencyRate: "5" },
};

function product(units: number, averageUnitArea: number, price: number, towers: number, floors: number, unitsPerFloor: number, efficiency: number, parkingRatio: number, compactShare = 65): ProductStrategy {
  const compactUnits = Math.round(units * compactShare / 100);
  const familyUnits = units - compactUnits;
  return {
    use: "RESIDENTIAL",
    unitMix: [
      { name: `Compacto ${averageUnitArea - 3} m²`, privateArea: averageUnitArea - 3, quantity: compactUnits, bedrooms: 2, bathrooms: 1, parkingSpaces: parkingRatio < 0.75 ? 0 : 1, balconyArea: 2, targetPrice: price * 0.94, targetPricePerSqm: price * 0.94 / (averageUnitArea - 3) },
      { name: `Família ${averageUnitArea + 6} m²`, privateArea: averageUnitArea + 6, quantity: familyUnits, bedrooms: averageUnitArea >= 50 ? 3 : 2, bathrooms: 2, parkingSpaces: 1, balconyArea: 4, targetPrice: price * 1.11, targetPricePerSqm: price * 1.11 / (averageUnitArea + 6) },
    ],
    averageUnitArea,
    parkingRatio,
    targetEfficiency: efficiency,
    commonAreaRatio: 100 - efficiency,
    amenityArea: Math.max(1800, units * 2.4),
    commercialArea: 0,
    numberOfTowers: towers,
    unitsPerFloor,
    floors,
    elevators: Math.max(2, Math.ceil(unitsPerFloor / 4)),
    stairs: 2,
  };
}

const reverseTarget: ReverseZoningTarget = { units: 1300, averageUnitArea: 47, minimumMarginRate: 25, minimumScore: 75, maximumExposure: 90_000_000, numberOfTowers: 12, efficiency: 76, unitsPerFloor: 8, parkingRatio: 0.55 };

export interface DemoProductOverrides {
  targetUnits: number;
  averageUnitArea: number;
  numberOfTowers: number;
  unitsPerFloor: number;
  floors: number;
  efficiency: number;
  parkingRatio: number;
  compactShare?: number;
}

export function createDemoLandSnapshot(organizationId = "seed-organization", versionNumber = 1, scenarioOverrides?: Parameters<typeof createSimulatedScenario>[3], productOverrides?: DemoProductOverrides, polygonOverride?: PolygonGeometry): LandStudySnapshot {
  const polygon = polygonOverride ?? DEMO_LAND_ASSET.polygon;
  const asset = { ...DEMO_LAND_ASSET, organizationId, polygon, area: polygonArea(polygon) };
  const current = { ...DEMO_CURRENT_SCENARIO, landAssetId: asset.id };
  const proposedBase = scenarioOverrides ? createSimulatedScenario(current, DEMO_PROPOSED_SCENARIO.id, DEMO_PROPOSED_SCENARIO.name, {
    maximumFAR: scenarioOverrides.maximumFAR ?? DEMO_PROPOSED_SCENARIO.parameters.maximumFAR.value ?? 5.8,
    occupancyRate: scenarioOverrides.occupancyRate ?? DEMO_PROPOSED_SCENARIO.parameters.occupancyRate.value ?? 52,
    permeabilityRate: scenarioOverrides.permeabilityRate ?? DEMO_PROPOSED_SCENARIO.parameters.permeabilityRate.value ?? 20,
    maximumHeight: scenarioOverrides.maximumHeight ?? DEMO_PROPOSED_SCENARIO.parameters.maximumHeight.value ?? 55,
    maximumFloors: scenarioOverrides.maximumFloors ?? DEMO_PROPOSED_SCENARIO.parameters.maximumFloors.value ?? 18,
    frontSetback: scenarioOverrides.frontSetback ?? DEMO_PROPOSED_SCENARIO.parameters.setbacks.value.front,
    rearSetback: scenarioOverrides.rearSetback ?? DEMO_PROPOSED_SCENARIO.parameters.setbacks.value.rear,
    sideSetback: scenarioOverrides.sideSetback ?? DEMO_PROPOSED_SCENARIO.parameters.setbacks.value.side,
    betweenBuildings: scenarioOverrides.betweenBuildings ?? DEMO_PROPOSED_SCENARIO.parameters.setbacks.value.betweenBuildings,
    parkingRequirement: scenarioOverrides.parkingRequirement ?? DEMO_PROPOSED_SCENARIO.parameters.parkingRequirement.value ?? 0.55,
    residentialDensity: scenarioOverrides.residentialDensity ?? DEMO_PROPOSED_SCENARIO.parameters.residentialDensity.value ?? 930,
  }, "TARGET") : { ...DEMO_PROPOSED_SCENARIO, landAssetId: asset.id };
  const currentOption = evaluateLandOption({ id: "land-option-current", name: "Atual · 800 unidades", asset, scenario: current, product: product(800, 47, 485_000, 10, 10, 8, 74, 0.7), massingType: "MULTIPLE_TOWERS", financialTemplate, calculatedAt });
  const target = productOverrides ?? { targetUnits: 1300, averageUnitArea: 42, numberOfTowers: 12, unitsPerFloor: 8, floors: 14, efficiency: 76, parkingRatio: 0.55, compactShare: 65 };
  const proposedOptions = [
    evaluateLandOption({ id: "land-option-a", name: `Alternativa A · ${target.targetUnits.toLocaleString("pt-BR")} paramétrica`, asset, scenario: proposedBase, product: product(target.targetUnits, target.averageUnitArea, 435_000 * target.averageUnitArea / 42, target.numberOfTowers, target.floors, target.unitsPerFloor, target.efficiency, target.parkingRatio, target.compactShare), massingType: "MULTIPLE_TOWERS", financialTemplate, calculatedAt }),
    evaluateLandOption({ id: "land-option-b", name: "Alternativa B · 1.150 equilibradas", asset, scenario: proposedBase, product: product(1150, 47, 505_000, 10, 15, 8, 77, 0.65), massingType: "PODIUM_TOWER", financialTemplate, calculatedAt }),
    evaluateLandOption({ id: "land-option-c", name: "Alternativa C · 950 amplas", asset, scenario: proposedBase, product: product(950, 55, 620_000, 8, 16, 8, 78, 0.8), massingType: "COURTYARD", financialTemplate, calculatedAt }),
  ];
  const options = [currentOption, ...finalizeLandOptions(proposedOptions, "BALANCED")];
  const bestProposed = options.filter((option) => option.scenarioId === proposedBase.id).sort((a, b) => a.rank - b.rank)[0];
  const reverseZoning = solveReverseZoning(asset, { ...reverseTarget, units: target.targetUnits, averageUnitArea: target.averageUnitArea, numberOfTowers: target.numberOfTowers, efficiency: target.efficiency, unitsPerFloor: target.unitsPerFloor, parkingRatio: target.parkingRatio });
  return {
    version: LAND_ENGINE_VERSION,
    id: `land-snapshot-${versionNumber}`,
    landStudyId: "land-study-barueri",
    versionNumber,
    status: "PRELIMINARY",
    createdAt: new Date(new Date(calculatedAt).getTime() + versionNumber - 1).toISOString(),
    landAsset: asset,
    sources: BARUERI_SOURCES,
    scenarios: [current, proposedBase],
    options,
    selectedScenarioId: proposedBase.id,
    selectedOptionId: bestProposed.id,
    regulatoryConfidence: calculateRegulatoryConfidence(current, BARUERI_SOURCES),
    reverseZoning,
    gapAnalysis: calculateGapAnalysis(current, proposedBase, reverseZoning),
    upliftAnalysis: calculateUplift(currentOption, bestProposed),
  };
}
