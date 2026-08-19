import type { LandAsset, LandOption, OptimizationObjective, ReverseZoningResult, ReverseZoningTarget, UrbanGapAnalysis, UrbanScenario, UrbanUpliftAnalysis } from "./types";
import { ZONING_SOLVER_VERSION } from "./types";

export function solveReverseZoning(asset: LandAsset, target: ReverseZoningTarget): ReverseZoningResult {
  const privateArea = target.units * target.averageUnitArea;
  const requiredTotalBuiltArea = privateArea / Math.max(0.1, target.efficiency / 100) + target.units * target.parkingRatio * 25;
  const requiredComputableArea = privateArea / Math.max(0.1, target.efficiency / 100);
  const requiredFloors = Math.max(1, Math.ceil(target.units / Math.max(1, target.numberOfTowers * target.unitsPerFloor)));
  const requiredHeight = requiredFloors * 3.05;
  const requiredFootprint = requiredComputableArea / requiredFloors;
  const requiredFAR = requiredComputableArea / Math.max(1, asset.area);
  const requiredOccupancyRate = requiredFootprint / Math.max(1, asset.area) * 100;
  const warnings: string[] = [];
  if (requiredOccupancyRate > 100) warnings.push("O programa exigiria projeção maior que a área do terreno.");
  if (requiredFloors > 60) warnings.push("O gabarito estimado está fora do intervalo seguro do solver preliminar.");
  return {
    version: ZONING_SOLVER_VERSION,
    feasible: requiredOccupancyRate <= 100 && requiredFloors <= 60,
    requiredFAR,
    requiredOccupancyRate,
    requiredHeight,
    requiredFloors,
    requiredDensity: target.units / Math.max(1, asset.area) * 10000,
    requiredComputableArea,
    requiredTotalBuiltArea,
    requiredParkingSpaces: Math.ceil(target.units * target.parkingRatio),
    landUtilization: requiredFootprint / Math.max(1, asset.area) * 100,
    warnings,
  };
}

export function calculateGapAnalysis(current: UrbanScenario, targetScenario: UrbanScenario, reverse: ReverseZoningResult): UrbanGapAnalysis {
  const currentFar = current.parameters.maximumFAR.value;
  const currentOccupancy = current.parameters.occupancyRate.value;
  const currentHeight = current.parameters.maximumHeight.value;
  const currentFloors = current.parameters.maximumFloors.value;
  const rows = [
    { key: "FAR", label: "CA máximo", current: currentFar, required: reverse.requiredFAR, unit: "x" },
    { key: "OCCUPANCY", label: "Taxa de ocupação", current: currentOccupancy, required: reverse.requiredOccupancyRate, unit: "%" },
    { key: "HEIGHT", label: "Gabarito", current: currentHeight, required: reverse.requiredHeight, unit: "m" },
    { key: "FLOORS", label: "Pavimentos", current: currentFloors, required: reverse.requiredFloors, unit: "pav." },
    { key: "DENSITY", label: "Densidade", current: current.parameters.residentialDensity.value, required: reverse.requiredDensity, unit: "un./ha" },
  ].map((item) => ({ ...item, gap: item.current === null ? null : Number(item.required) - Number(item.current), status: item.current === null ? "NOT_VERIFIED" as const : Number(item.current) + 1e-8 >= Number(item.required) ? "MEETS" as const : "CHANGE_REQUIRED" as const }));
  const changes = rows.filter((item) => item.status === "CHANGE_REQUIRED");
  return { currentScenarioId: current.id, targetScenarioId: targetScenario.id, items: rows, minimumChangeScore: changes.reduce((sum, item) => sum + Math.abs(item.gap ?? 0), 0) };
}

export function calculateUplift(current: LandOption, proposed: LandOption): UrbanUpliftAnalysis {
  return {
    currentScenarioId: current.scenarioId,
    proposedScenarioId: proposed.scenarioId,
    additionalComputableArea: proposed.areaSchedule.computableArea - current.areaSchedule.computableArea,
    additionalPrivateArea: proposed.areaSchedule.privateArea - current.areaSchedule.privateArea,
    additionalUnits: proposed.areaSchedule.units - current.areaSchedule.units,
    additionalVGV: Number(proposed.financialResult.metrics.vgv) - Number(current.financialResult.metrics.vgv),
    changeInProfit: Number(proposed.financialResult.metrics.profit) - Number(current.financialResult.metrics.profit),
    changeInNPV: Number(proposed.financialResult.metrics.npv) - Number(current.financialResult.metrics.npv),
    changeInEquity: Number(proposed.financialResult.metrics.equityCapitalRequired) - Number(current.financialResult.metrics.equityCapitalRequired),
    changeInScore: proposed.score.totalScore - current.score.totalScore,
  };
}

function dominates(a: LandOption, b: LandOption) {
  const betterOrEqual = a.score.totalScore >= b.score.totalScore && Number(a.financialResult.metrics.npv) >= Number(b.financialResult.metrics.npv) && Number(a.financialResult.metrics.maximumCashExposure) <= Number(b.financialResult.metrics.maximumCashExposure);
  const strictlyBetter = a.score.totalScore > b.score.totalScore || Number(a.financialResult.metrics.npv) > Number(b.financialResult.metrics.npv) || Number(a.financialResult.metrics.maximumCashExposure) < Number(b.financialResult.metrics.maximumCashExposure);
  return betterOrEqual && strictlyBetter;
}

export function markParetoFrontier(options: LandOption[]) {
  return options.map((option) => ({ ...option, paretoEfficient: !options.some((candidate) => candidate.id !== option.id && dominates(candidate, option)) }));
}

export function rankLandOptions(options: LandOption[], objective: OptimizationObjective): LandOption[] {
  const value = (option: LandOption) => {
    const metrics = option.financialResult.metrics;
    if (objective === "MAXIMUM_UNITS") return option.areaSchedule.units;
    if (objective === "MAXIMUM_NPV") return Number(metrics.npv);
    if (objective === "MAXIMUM_MARGIN") return Number(metrics.marginOnVgv);
    if (objective === "MAXIMUM_ROI") return Number(metrics.roi ?? -Infinity);
    if (objective === "MAXIMUM_SCORE") return option.score.totalScore;
    if (objective === "MINIMUM_EQUITY") return -Number(metrics.equityCapitalRequired);
    if (objective === "MINIMUM_PEAK_EXPOSURE") return -Number(metrics.maximumCashExposure);
    if (objective === "MINIMUM_REGULATORY_CHANGE") return -option.warnings.filter((warning) => warning.severity === "BLOCKER").length;
    return option.score.totalScore + Number(metrics.marginOnVgv) * 40 + Number(metrics.npv) / 10_000_000 - Number(metrics.maximumCashExposure) / 20_000_000;
  };
  return [...options].sort((a, b) => value(b) - value(a)).map((option, index) => ({ ...option, rank: index + 1 }));
}
