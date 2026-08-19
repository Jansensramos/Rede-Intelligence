import { insetPolygon, polygonArea, scalePolygonToArea, validatePolygon } from "./geometry";
import { LAND_ENGINE_VERSION, type BuildableEnvelope, type EnvelopeWarning, type LandAsset, type UrbanScenario } from "./types";

function numeric(value: number | null, fallback: number, label: string, warnings: EnvelopeWarning[]) {
  if (value === null || !Number.isFinite(value)) {
    warnings.push({ code: "MISSING_PARAMETER", severity: "WARNING", message: `${label} não verificado; utilizada hipótese técnica de ${fallback}.` });
    return fallback;
  }
  return value;
}

export function calculateBuildableEnvelope(asset: LandAsset, scenario: UrbanScenario): BuildableEnvelope {
  const warnings: EnvelopeWarning[] = [];
  const validation = validatePolygon(asset.polygon);
  if (!validation.valid) {
    return {
      version: LAND_ENGINE_VERSION,
      scenarioId: scenario.id,
      buildableGroundPolygon: { type: "Polygon", coordinates: [] },
      maximumFootprintArea: 0,
      maximumComputableArea: 0,
      estimatedNonComputableArea: 0,
      maximumTotalArea: 0,
      maximumHeight: 0,
      estimatedFloors: 0,
      regulatoryConstraints: validation.errors,
      warnings: validation.errors.map((message) => ({ code: "INVALID_GEOMETRY", severity: "BLOCKER", message })),
    };
  }

  const parameters = scenario.parameters;
  const maximumFar = numeric(parameters.maximumFAR.value, 1, "CA máximo", warnings);
  const occupancyRate = numeric(parameters.occupancyRate.value, 50, "taxa de ocupação", warnings);
  const permeabilityRate = numeric(parameters.permeabilityRate.value, 15, "taxa de permeabilidade", warnings);
  const maximumHeight = numeric(parameters.maximumHeight.value, 30, "altura máxima", warnings);
  const heightFloors = Math.max(1, Math.floor(maximumHeight / 3.05));
  const maximumFloors = Math.max(1, Math.floor(numeric(parameters.maximumFloors.value, heightFloors, "número máximo de pavimentos", warnings)));
  const estimatedFloors = Math.min(maximumFloors, heightFloors);
  const setbacks = parameters.setbacks.value;
  const effectiveSetbacks = {
    front: Math.max(setbacks.front, maximumHeight / 6),
    side: Math.max(setbacks.side, maximumHeight / 8),
    rear: Math.max(setbacks.rear, maximumHeight / 10),
    betweenBuildings: Math.max(setbacks.betweenBuildings, maximumHeight / 6),
  };
  const points = asset.polygon.coordinates;
  const rearEdge = Math.floor(points.length / 2);
  const edgeOffsets = points.map((_, index) => index === 0 ? effectiveSetbacks.front : index === rearEdge ? effectiveSetbacks.rear : effectiveSetbacks.side);
  let setbackPolygon = asset.polygon;
  try {
    setbackPolygon = insetPolygon(asset.polygon, edgeOffsets);
  } catch (error) {
    warnings.push({ code: "SETBACK_VIOLATED", severity: "BLOCKER", message: error instanceof Error ? error.message : "Recuos eliminam a área edificável." });
  }

  const landArea = polygonArea(asset.polygon);
  const setbackArea = warnings.some((item) => item.code === "SETBACK_VIOLATED" && item.severity === "BLOCKER") ? 0 : polygonArea(setbackPolygon);
  const verifiedExclusionArea = scenario.restrictions
    .filter((restriction) => restriction.verificationStatus === "VERIFIED" && restriction.geometry && (restriction.severity === "HIGH" || restriction.severity === "CRITICAL"))
    .reduce((sum, restriction) => sum + polygonArea(restriction.geometry!), 0);
  if (scenario.restrictions.some((restriction) => restriction.verificationStatus === "NOT_VERIFIED")) {
    warnings.push({ code: "RESTRICTION_NOT_VERIFIED", severity: "WARNING", message: "Há categorias de restrição ainda não verificadas; nenhuma geometria foi inventada ou descontada." });
  }
  const occupancyLimit = landArea * Math.max(0, Math.min(100, occupancyRate)) / 100;
  const permeabilityLimit = landArea * Math.max(0, Math.min(100, 100 - permeabilityRate)) / 100;
  const maximumFootprintArea = Math.max(0, Math.min(setbackArea, occupancyLimit, permeabilityLimit) - verifiedExclusionArea);
  const buildableGroundPolygon = maximumFootprintArea > 0 ? scalePolygonToArea(setbackPolygon, maximumFootprintArea) : { type: "Polygon" as const, coordinates: [] };
  const maximumComputableArea = Math.min(landArea * maximumFar, maximumFootprintArea * estimatedFloors);
  const nonComputableRate = numeric(parameters.nonComputableAreaRate.value, 15, "áreas não computáveis", warnings) / 100;
  const estimatedNonComputableArea = maximumComputableArea * Math.max(0, nonComputableRate);
  const maximumTotalArea = maximumComputableArea + estimatedNonComputableArea;

  return {
    version: LAND_ENGINE_VERSION,
    scenarioId: scenario.id,
    buildableGroundPolygon,
    maximumFootprintArea,
    maximumComputableArea,
    estimatedNonComputableArea,
    maximumTotalArea,
    maximumHeight,
    estimatedFloors,
    regulatoryConstraints: [
      `CA máximo ${maximumFar.toFixed(2)}`,
      `TO máxima ${occupancyRate.toFixed(1)}%`,
      `Permeabilidade mínima ${permeabilityRate.toFixed(1)}%`,
      `Recuos efetivos F ${effectiveSetbacks.front.toFixed(1)}m · L ${effectiveSetbacks.side.toFixed(1)}m · Fundos ${effectiveSetbacks.rear.toFixed(1)}m`,
      `Entre edifícios ${effectiveSetbacks.betweenBuildings.toFixed(1)}m`,
    ],
    warnings,
  };
}
