import { describe, expect, it } from "vitest";
import { boundsFromPositions, calculatedQuantities, compareBimElements, detectBimClashes, elementFingerprint, transformVertex, type BimElementGeometry } from "./bim-geometry";

function element(expressId: number, min: [number, number, number], max: [number, number, number], overrides: Partial<BimElementGeometry> = {}): BimElementGeometry {
  const bounds = { min, max };
  return {
    expressId,
    ifcGuid: `guid-${expressId}`,
    ifcType: "IFCWALL",
    name: `Parede ${expressId}`,
    properties: {},
    quantities: calculatedQuantities(bounds, [0, 1, 2]),
    chunks: [],
    bounds,
    centroid: [0, 1, 2].map((axis) => (min[axis] + max[axis]) / 2) as [number, number, number],
    fingerprint: elementFingerprint({ ifcType: "IFCWALL", name: `Parede ${expressId}`, bounds }),
    ...overrides,
  };
}

describe("geometria BIM", () => {
  it("transforma vértices e calcula limites e quantitativos com proveniência", () => {
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1];
    expect(transformVertex([1, 2, 3], matrix)).toEqual([11, 22, 33]);
    const bounds = boundsFromPositions([0, 0, 0, 4, 5, 3]);
    expect(bounds).toEqual({ min: [0, 0, 0], max: [4, 5, 3] });
    expect(calculatedQuantities(bounds, [0, 1, 2, 2, 3, 0])).toMatchObject({
      boundingArea: { value: 20, unit: "m²", origin: "CALCULATED", confidence: "LOW" },
      boundingVolume: { value: 60, unit: "m³" },
      triangles: { value: 2, origin: "EXTRACTED", confidence: "HIGH" },
    });
  });

  it("detecta interferência rígida, afastamento e duplicidade", () => {
    const hard = detectBimClashes([
      element(1, [0, 0, 0], [2, 2, 0], { chunks: [{ positions: [0, 0, 0, 2, 0, 0, 0, 2, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2], color: [1, 1, 1, 1] }] }),
      element(2, [.5, .5, -1], [.5, 2, 1], { chunks: [{ positions: [.5, .5, -1, .5, .5, 1, .5, 2, 0], normals: [1, 0, 0, 1, 0, 0, 1, 0, 0], indices: [0, 1, 2], color: [1, 1, 1, 1] }] }),
    ]);
    expect(hard).toMatchObject([{ type: "HARD", a: 1, b: 2, severity: "HIGH" }]);

    const clearance = detectBimClashes([element(3, [0, 0, 0], [1, 1, 1]), element(4, [1.05, 0, 0], [2, 1, 1])], 0.1);
    expect(clearance).toMatchObject([{ type: "CLEARANCE", severity: "MEDIUM" }]);

    const original = element(5, [0, 0, 0], [1, 1, 1], { name: "Coincidente" });
    const duplicate = { ...original, expressId: 6, ifcGuid: "guid-6" };
    expect(detectBimClashes([original, duplicate])).toMatchObject([{ type: "DUPLICATE", confidence: "HIGH" }]);
  });

  it("compara revisões por GUID e fingerprint sem inventar equivalência", () => {
    const unchanged = element(1, [0, 0, 0], [1, 1, 1]);
    const modified = { ...element(2, [0, 0, 0], [1, 1, 1]), fingerprint: "alterado" };
    const result = compareBimElements([unchanged, element(2, [0, 0, 0], [1, 1, 1]), element(3, [0, 0, 0], [1, 1, 1])], [unchanged, modified, element(4, [0, 0, 0], [1, 1, 1])]);
    expect(result.map(({ key, kind }) => ({ key, kind }))).toEqual([
      { key: "guid-1", kind: "UNCHANGED" },
      { key: "guid-2", kind: "MODIFIED" },
      { key: "guid-3", kind: "REMOVED" },
      { key: "guid-4", kind: "ADDED" },
    ]);
  });
});
