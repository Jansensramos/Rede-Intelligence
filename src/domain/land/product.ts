import { polygonArea, polygonBounds } from "./geometry";
import type { AreaSchedule, BuildableEnvelope, DevelopmentPhase, EnvelopeWarning, LandAsset, MassingBuilding, MassingModel, MassingType, Masterplan, ProductStrategy } from "./types";

export function productUnits(product: ProductStrategy) {
  return product.unitMix.reduce((sum, unit) => sum + unit.quantity, 0);
}

export function productPrivateArea(product: ProductStrategy) {
  return product.unitMix.reduce((sum, unit) => sum + unit.quantity * unit.privateArea, 0);
}

export function weightedUnitPrice(product: ProductStrategy) {
  const units = productUnits(product);
  if (!units) return 0;
  return product.unitMix.reduce((sum, unit) => sum + unit.quantity * unit.targetPrice, 0) / units;
}

export function calculateAreaSchedule(asset: LandAsset, envelope: BuildableEnvelope, product: ProductStrategy): AreaSchedule {
  const units = productUnits(product);
  const privateArea = productPrivateArea(product);
  const efficiency = Math.max(0.1, Math.min(0.95, product.targetEfficiency / 100));
  const residentialGross = privateArea / efficiency;
  const commonArea = Math.max(0, residentialGross - privateArea);
  const circulationArea = commonArea * 0.55;
  const technicalArea = commonArea * 0.2;
  const parkingSpaces = Math.ceil(units * product.parkingRatio);
  const garageArea = parkingSpaces * 25;
  const amenityArea = product.amenityArea;
  const totalBuiltArea = residentialGross + product.commercialArea + garageArea + amenityArea;
  const nonComputableArea = garageArea + amenityArea + technicalArea;
  const computableArea = Math.max(0, totalBuiltArea - nonComputableArea);
  const floors = Math.max(1, product.floors);
  const footprintArea = (residentialGross + product.commercialArea) / floors;
  const landArea = polygonArea(asset.polygon);
  const legalComputablePotential = envelope.maximumComputableArea;
  return {
    landArea,
    footprintArea,
    computableArea,
    nonComputableArea,
    totalBuiltArea,
    privateArea,
    commonArea,
    technicalArea,
    garageArea,
    amenityArea,
    circulationArea,
    efficiency: privateArea / Math.max(1, totalBuiltArea - garageArea - amenityArea) * 100,
    units,
    parkingSpaces,
    averageUnitArea: units ? privateArea / units : 0,
    legalComputablePotential,
    potentialUtilization: computableArea / Math.max(1, legalComputablePotential) * 100,
    densityUnitsPerHectare: units / Math.max(1, landArea) * 10000,
    privateAreaPerLandArea: privateArea / Math.max(1, landArea),
    farUtilization: computableArea / Math.max(1, landArea),
    occupancyUtilization: footprintArea / Math.max(1, landArea) * 100,
    commonAreaPerUnit: units ? commonArea / units : 0,
    amenityAreaPerUnit: units ? amenityArea / units : 0,
  };
}

function createPhases(towerIds: string[], units: number, constructionMonths: number): DevelopmentPhase[] {
  const phaseCount = Math.min(3, Math.max(1, Math.ceil(towerIds.length / 4)));
  return Array.from({ length: phaseCount }, (_, phaseIndex) => {
    const ids = towerIds.filter((_, index) => index % phaseCount === phaseIndex);
    const phaseUnits = phaseIndex === phaseCount - 1 ? units - Math.floor(units / phaseCount) * phaseIndex : Math.floor(units / phaseCount);
    return { id: `PHASE-${phaseIndex + 1}`, name: `Fase ${phaseIndex + 1}`, order: phaseIndex + 1, towerIds: ids, units: phaseUnits, startMonth: phaseIndex * 12, constructionMonths };
  });
}

export function generateMassing(asset: LandAsset, envelope: BuildableEnvelope, product: ProductStrategy, type: MassingType): { massing: MassingModel; masterplan: Masterplan } {
  const towerCount = Math.max(1, product.numberOfTowers);
  const bounds = polygonBounds(envelope.buildableGroundPolygon.coordinates.length ? envelope.buildableGroundPolygon : asset.polygon);
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const depth = Math.max(1, bounds.maxY - bounds.minY);
  const columns = Math.ceil(Math.sqrt(towerCount * width / depth));
  const rows = Math.ceil(towerCount / columns);
  const cellWidth = width / columns;
  const cellDepth = depth / rows;
  const schedule = calculateAreaSchedule(asset, envelope, product);
  const targetFootprint = Math.min(envelope.maximumFootprintArea / towerCount * 0.9, schedule.footprintArea / towerCount);
  const aspect = type === "SLAB" ? 2.8 : type === "COURTYARD" ? 1.5 : 1.15;
  const buildingWidth = Math.min(cellWidth * 0.72, Math.sqrt(Math.max(1, targetFootprint) * aspect));
  const buildingDepth = Math.min(cellDepth * 0.68, Math.max(4, targetFootprint / Math.max(1, buildingWidth)));
  const towerIds = Array.from({ length: towerCount }, (_, index) => `TOWER-${index + 1}`);
  const phases = createPhases(towerIds, productUnits(product), Math.max(18, Math.ceil(product.floors * 1.1)));
  const buildings: MassingBuilding[] = towerIds.map((id, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const phase = phases.find((item) => item.towerIds.includes(id))!;
    return {
      id,
      name: `Torre ${index + 1}`,
      phaseId: phase.id,
      kind: "TOWER",
      x: bounds.minX + column * cellWidth + (cellWidth - buildingWidth) / 2,
      y: bounds.minY + row * cellDepth + (cellDepth - buildingDepth) / 2,
      width: buildingWidth,
      depth: buildingDepth,
      floors: product.floors,
      floorHeight: 3.05,
      rotation: type === "COURTYARD" ? (index % 2) * 90 : 0,
    };
  });
  if (type === "PODIUM_TOWER") buildings.unshift({ id: "PODIUM-1", name: "Embasamento", phaseId: phases[0].id, kind: "PODIUM", x: bounds.minX + width * 0.12, y: bounds.minY + depth * 0.12, width: width * 0.76, depth: depth * 0.76, floors: 2, floorHeight: 3.5, rotation: 0 });
  const totalFootprint = buildings.reduce((sum, building) => sum + building.width * building.depth, 0);
  const masterplan: Masterplan = {
    phases,
    buildings,
    sharedInfrastructureArea: asset.area * 0.06,
    amenityAreas: product.amenityArea,
    roadsArea: asset.area * (towerCount > 4 ? 0.08 : 0.04),
    openSpacesArea: Math.max(0, asset.area - totalFootprint),
    parkingStructures: Math.ceil(schedule.parkingSpaces / 350),
  };
  return { massing: { type, buildings, sitePolygon: asset.polygon, envelopePolygon: envelope.buildableGroundPolygon, totalFootprint, totalFloors: buildings.reduce((sum, item) => sum + item.floors, 0) }, masterplan };
}

export function validateProductAgainstEnvelope(schedule: AreaSchedule, product: ProductStrategy, envelope: BuildableEnvelope, parkingRequirement: number | null): EnvelopeWarning[] {
  const warnings: EnvelopeWarning[] = [...envelope.warnings];
  if (schedule.computableArea > envelope.maximumComputableArea + 0.01) warnings.push({ code: "FAR_EXCEEDED", severity: "BLOCKER", message: `A proposta excede o potencial computável em ${(schedule.computableArea - envelope.maximumComputableArea).toFixed(0)} m².` });
  if (schedule.footprintArea > envelope.maximumFootprintArea + 0.01) warnings.push({ code: "OCCUPANCY_EXCEEDED", severity: "BLOCKER", message: `A projeção excede o envelope em ${(schedule.footprintArea - envelope.maximumFootprintArea).toFixed(0)} m².` });
  if (product.floors * 3.05 > envelope.maximumHeight + 0.01) warnings.push({ code: "HEIGHT_EXCEEDED", severity: "BLOCKER", message: `Altura estimada de ${(product.floors * 3.05).toFixed(1)}m supera o limite utilizado de ${envelope.maximumHeight.toFixed(1)}m.` });
  if (parkingRequirement !== null && product.parkingRatio < parkingRequirement) warnings.push({ code: "PARKING_INCOMPATIBLE", severity: "BLOCKER", message: `Vagas por unidade abaixo do parâmetro de ${parkingRequirement.toFixed(2)}.` });
  return warnings;
}
