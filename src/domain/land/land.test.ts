import { beforeAll, describe, expect, it } from "vitest";
import { BarueriMunicipalityAdapter, BARUERI_SOURCES, barueriSrmParameters } from "@/infrastructure/adapters/land/barueri";
import { ManualMunicipalityAdapter } from "@/infrastructure/adapters/land/manual";
import { calculateBuildableEnvelope } from "./envelope";
import { polygonArea, polygonFromGeoJSON, polygonToGeoJSON, validatePolygon } from "./geometry";
import { createDemoLandSnapshot, DEMO_CURRENT_SCENARIO, DEMO_LAND_ASSET } from "./demo";
import { createSimulatedScenario } from "./engine";
import { LAND_ENGINE_VERSION } from "./types";
import type { LandStudySnapshot } from "./types";

let snapshot: LandStudySnapshot;

beforeAll(() => {
  snapshot = createDemoLandSnapshot("org-test", 1);
});

describe("Land geometry and envelope", () => {
  it("validates a parcel polygon and round-trips GeoJSON", () => {
    expect(validatePolygon(DEMO_LAND_ASSET.polygon)).toEqual({ valid: true, errors: [] });
    expect(polygonArea(DEMO_LAND_ASSET.polygon)).toBe(14_000);
    expect(polygonArea(polygonFromGeoJSON(polygonToGeoJSON(DEMO_LAND_ASSET.polygon)))).toBe(14_000);
  });

  it("rejects self-intersection and malformed GeoJSON", () => {
    const bow = { type: "Polygon" as const, coordinates: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }] };
    expect(validatePolygon(bow).valid).toBe(false);
    expect(() => polygonFromGeoJSON({ type: "Point", coordinates: [0, 0] })).toThrow("Apenas GeoJSON Polygon");
  });

  it("applies setbacks, FAR, occupancy, height and missing-parameter warnings deterministically", () => {
    const envelope = calculateBuildableEnvelope(DEMO_LAND_ASSET, DEMO_CURRENT_SCENARIO);
    expect(envelope.version).toBe(LAND_ENGINE_VERSION);
    expect(envelope.maximumFootprintArea).toBeLessThanOrEqual(7_000);
    expect(envelope.maximumComputableArea).toBeLessThanOrEqual(70_000);
    expect(envelope.buildableGroundPolygon.coordinates.length).toBe(4);
    expect(envelope.warnings.some((warning) => warning.code === "MISSING_PARAMETER")).toBe(true);
    expect(envelope.warnings.some((warning) => warning.code === "RESTRICTION_NOT_VERIFIED")).toBe(true);
  });

  it("never invents a missing restriction geometry", () => {
    const envelope = calculateBuildableEnvelope(DEMO_LAND_ASSET, DEMO_CURRENT_SCENARIO);
    expect(DEMO_CURRENT_SCENARIO.restrictions[0].geometry).toBeNull();
    expect(envelope.regulatoryConstraints.some((item) => item.includes("CA máximo"))).toBe(true);
  });
});

describe("Zoning Lab and economic integration", () => {
  it("keeps current legal and simulated scenarios explicitly separated", () => {
    const [current, proposed] = snapshot.scenarios;
    expect(current.type).toBe("CURRENT_LEGAL");
    expect(current.isHypothetical).toBe(false);
    expect(proposed.isHypothetical).toBe(true);
    expect(proposed.disclaimer).toContain("não representam direito construtivo adquirido");
    expect(proposed.parameters.maximumFAR.sourceId).toBe("BARUERI_MANUAL_PARCEL");
  });

  it("generates massing, phases and an area schedule from geometry", () => {
    const option = snapshot.options.find((item) => item.id === "land-option-a")!;
    expect(option.massing.buildings.filter((building) => building.kind === "TOWER")).toHaveLength(12);
    expect(option.masterplan.phases.length).toBeGreaterThanOrEqual(2);
    expect(option.areaSchedule.privateArea).toBeGreaterThan(0);
    expect(option.areaSchedule.legalComputablePotential).toBe(option.envelope.maximumComputableArea);
    expect(option.areaSchedule.densityUnitsPerHectare).toBeGreaterThan(800);
  });

  it("uses REDE Engine and REDE Score for every alternative", () => {
    expect(snapshot.options).toHaveLength(4);
    snapshot.options.forEach((option) => {
      expect(option.financialResult.engineVersion).toBe("1.0.0");
      expect(Number.isFinite(Number(option.financialResult.metrics.vgv))).toBe(true);
      expect(Number(option.financialResult.metrics.vgv)).toBeGreaterThan(0);
      expect(option.score.policyVersion).toBe("REDE_SCORE_V1.0.0");
      expect(option.score.totalScore).toBeGreaterThanOrEqual(0);
      expect(option.score.totalScore).toBeLessThanOrEqual(100);
    });
  });

  it("calculates reverse zoning, regulatory gaps, uplift and Pareto metadata", () => {
    expect(snapshot.reverseZoning.requiredFAR).toBeGreaterThan(0);
    expect(snapshot.reverseZoning.requiredFloors).toBeGreaterThan(0);
    expect(snapshot.gapAnalysis.items.some((item) => item.status === "NOT_VERIFIED" || item.status === "CHANGE_REQUIRED")).toBe(true);
    expect(snapshot.upliftAnalysis.additionalUnits).toBe(150);
    expect(snapshot.upliftAnalysis.proposedScenarioId).toBe(snapshot.options.find((option) => option.id === snapshot.selectedOptionId)?.scenarioId);
    expect(snapshot.options.filter((option) => option.scenarioId === snapshot.scenarios[1].id).some((option) => option.paretoEfficient)).toBe(true);
  });

  it("recalculates the complete cascade for a custom simulated scenario", () => {
    const changed = createSimulatedScenario(DEMO_CURRENT_SCENARIO, "custom", "Custom", { permittedUses: ["Uso misto"], maximumFAR: 7, maximumHeight: 80, maximumFloors: 26 });
    const envelope = calculateBuildableEnvelope(DEMO_LAND_ASSET, changed);
    expect(envelope.maximumHeight).toBe(80);
    expect(changed.isHypothetical).toBe(true);
    expect(changed.parameters.maximumFAR.value).toBe(7);
    expect(changed.parameters.permittedUses.value).toEqual(["Uso misto"]);
    expect(changed.parameters.permittedUses.confidence).toBe("MANUAL");
    const mixed = createDemoLandSnapshot("org-test", 2, undefined, { targetUnits: 1000, averageUnitArea: 45, numberOfTowers: 10, unitsPerFloor: 8, floors: 13, efficiency: 76, parkingRatio: 0.6, compactShare: 40 });
    const parametricOption = mixed.options.find((option) => option.id === "land-option-a")!;
    expect(parametricOption.product.unitMix[0].quantity).toBe(400);
    expect(parametricOption.product.unitMix[1].quantity).toBe(600);
  });

  it("keeps provenance resolvable and confidence independent from economics", () => {
    const sourceIds = new Set(BARUERI_SOURCES.map((source) => source.id));
    const parameters = barueriSrmParameters();
    expect(sourceIds.has(parameters.maximumFAR.sourceId)).toBe(true);
    expect(snapshot.regulatoryConfidence.score).toBeGreaterThan(0);
    expect(snapshot.regulatoryConfidence.missing).toContain("Altura");
  });
});

describe("Municipality adapters", () => {
  it("uses official Barueri metadata but requires manual parcel confirmation", async () => {
    const adapter = new BarueriMunicipalityAdapter();
    expect((await adapter.identifyParcel({ address: "Barueri" })).status).toBe("MANUAL_REQUIRED");
    const zoning = await adapter.getZoning({ confirmedZoningCode: "SRM" });
    expect(zoning.status).toBe("PARTIAL");
    const parameters = await adapter.getUrbanParameters("SRM");
    expect(parameters.data?.maximumFAR.value).toBe(5);
    expect((await adapter.getUrbanParameters("UNKNOWN")).status).toBe("MANUAL_REQUIRED");
    expect((await adapter.getSourceMetadata()).some((source) => source.type === "OFFICIAL_LAW")).toBe(true);
  });

  it("supports a provider-independent manual fallback", async () => {
    const adapter = new ManualMunicipalityAdapter("Cidade sem integração");
    expect((await adapter.getUrbanParameters("Z1")).status).toBe("MANUAL_REQUIRED");
    expect((await adapter.getRestrictions({})).data).toEqual([]);
  });
});
