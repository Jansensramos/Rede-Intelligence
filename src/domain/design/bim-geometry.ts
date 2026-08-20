import { createHash } from "node:crypto";

export interface BimBounds { min: [number, number, number]; max: [number, number, number] }
export interface BimGeometryChunk { positions: number[]; normals: number[]; indices: number[]; color: [number, number, number, number] }
export interface BimElementGeometry {
  expressId: number;
  ifcGuid?: string;
  ifcType: string;
  name?: string;
  code?: string;
  building?: string;
  tower?: string;
  storey?: string;
  space?: string;
  parentExpressId?: number;
  properties: Record<string, unknown>;
  quantities: Record<string, { value: number; unit: string; origin: "EXTRACTED" | "CALCULATED" | "USER_PROVIDED"; confidence: "HIGH" | "MEDIUM" | "LOW" }>;
  chunks: BimGeometryChunk[];
  bounds: BimBounds;
  centroid: [number, number, number];
  fingerprint: string;
}

export interface BimGeometryArtifact {
  version: "REDE_BIM_GEOMETRY_V1";
  schema: string;
  units: "m";
  elements: BimElementGeometry[];
  bounds: BimBounds;
  triangleCount: number;
  spatialTree: unknown;
  processing: { durationMs: number; sourceBytes: number; adapter: string; adapterVersion: string };
}

const rounded = (value: number, digits = 6) => Number(value.toFixed(digits));

export function boundsFromPositions(positions: number[]): BimBounds {
  const bounds: BimBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      bounds.min[axis] = Math.min(bounds.min[axis], positions[index + axis]);
      bounds.max[axis] = Math.max(bounds.max[axis], positions[index + axis]);
    }
  }
  if (!Number.isFinite(bounds.min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min: bounds.min.map((value) => rounded(value)) as BimBounds["min"], max: bounds.max.map((value) => rounded(value)) as BimBounds["max"] };
}

export function mergeBounds(values: BimBounds[]): BimBounds {
  if (!values.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  return {
    min: [0, 1, 2].map((axis) => Math.min(...values.map((item) => item.min[axis]))) as BimBounds["min"],
    max: [0, 1, 2].map((axis) => Math.max(...values.map((item) => item.max[axis]))) as BimBounds["max"],
  };
}

export function transformVertex(position: [number, number, number], matrix: number[]): [number, number, number] {
  const [x, y, z] = position;
  return [
    rounded(matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]),
    rounded(matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]),
    rounded(matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]),
  ];
}

export function calculatedQuantities(bounds: BimBounds, indices: number[]) {
  const dx = Math.max(0, bounds.max[0] - bounds.min[0]);
  const dy = Math.max(0, bounds.max[1] - bounds.min[1]);
  const dz = Math.max(0, bounds.max[2] - bounds.min[2]);
  return {
    boundingLength: { value: rounded(Math.max(dx, dy, dz), 4), unit: "m", origin: "CALCULATED" as const, confidence: "MEDIUM" as const },
    boundingArea: { value: rounded(dx * dy, 4), unit: "m²", origin: "CALCULATED" as const, confidence: "LOW" as const },
    boundingSurfaceArea: { value: rounded(2 * (dx * dy + dx * dz + dy * dz), 4), unit: "m²", origin: "CALCULATED" as const, confidence: "LOW" as const },
    boundingVolume: { value: rounded(dx * dy * dz, 4), unit: "m³", origin: "CALCULATED" as const, confidence: "LOW" as const },
    triangles: { value: Math.floor(indices.length / 3), unit: "triângulos", origin: "EXTRACTED" as const, confidence: "HIGH" as const },
  };
}

export function elementFingerprint(input: { ifcType: string; name?: string; bounds: BimBounds; properties?: Record<string, unknown> }) {
  return createHash("sha256").update(JSON.stringify({ type: input.ifcType, name: input.name ?? null, bounds: input.bounds, properties: input.properties ?? {} })).digest("hex");
}

export function boundsIntersect(a: BimBounds, b: BimBounds, tolerance = 0) {
  return [0, 1, 2].every((axis) => a.min[axis] < b.max[axis] + tolerance && a.max[axis] > b.min[axis] - tolerance);
}

export function intersectionBounds(a: BimBounds, b: BimBounds): BimBounds | null {
  if (!boundsIntersect(a, b)) return null;
  return { min: [0, 1, 2].map((axis) => Math.max(a.min[axis], b.min[axis])) as BimBounds["min"], max: [0, 1, 2].map((axis) => Math.min(a.max[axis], b.max[axis])) as BimBounds["max"] };
}

type Vector3 = [number, number, number];
const subtract = (a: Vector3, b: Vector3): Vector3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vector3, b: Vector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector3, b: Vector3): Vector3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function segmentIntersectsTriangle(start: Vector3, end: Vector3, a: Vector3, b: Vector3, c: Vector3) {
  const epsilon = 1e-8; const direction = subtract(end, start); const edgeA = subtract(b, a); const edgeB = subtract(c, a); const h = cross(direction, edgeB); const determinant = dot(edgeA, h);
  if (Math.abs(determinant) < epsilon) return false;
  const inverse = 1 / determinant; const s = subtract(start, a); const u = inverse * dot(s, h);
  if (u < -epsilon || u > 1 + epsilon) return false;
  const q = cross(s, edgeA); const v = inverse * dot(direction, q);
  if (v < -epsilon || u + v > 1 + epsilon) return false;
  const distance = inverse * dot(edgeB, q);
  return distance >= -epsilon && distance <= 1 + epsilon;
}

function trianglesFromElement(element: BimElementGeometry) {
  const result: Array<[Vector3, Vector3, Vector3]> = [];
  for (const chunk of element.chunks) for (let index = 0; index < chunk.indices.length; index += 3) {
    const points = [chunk.indices[index], chunk.indices[index + 1], chunk.indices[index + 2]].map((vertex) => chunk.positions.slice(vertex * 3, vertex * 3 + 3) as Vector3);
    if (points.length === 3) result.push(points as [Vector3, Vector3, Vector3]);
  }
  return result;
}

export function geometryIntersects(a: BimElementGeometry, b: BimElementGeometry) {
  const trianglesA = trianglesFromElement(a); const trianglesB = trianglesFromElement(b); let checked = 0;
  for (const left of trianglesA) for (const right of trianglesB) {
    if (++checked > 1_000_000) return false;
    const leftBounds = boundsFromPositions(left.flat()); const rightBounds = boundsFromPositions(right.flat());
    if (!boundsIntersect(leftBounds, rightBounds, 1e-7)) continue;
    const leftEdges: Array<[Vector3, Vector3]> = [[left[0], left[1]], [left[1], left[2]], [left[2], left[0]]];
    const rightEdges: Array<[Vector3, Vector3]> = [[right[0], right[1]], [right[1], right[2]], [right[2], right[0]]];
    if (leftEdges.some(([start, end]) => segmentIntersectsTriangle(start, end, ...right)) || rightEdges.some(([start, end]) => segmentIntersectsTriangle(start, end, ...left))) return true;
  }
  return false;
}

export function detectBimClashes(elements: BimElementGeometry[], clearanceM = 0) {
  const clashes: Array<{ type: "HARD" | "CLEARANCE" | "DUPLICATE"; a: number; b: number; coordinate: [number, number, number]; severity: "LOW" | "MEDIUM" | "HIGH"; confidence: "HIGH" | "MEDIUM" }> = [];
  const maximumPairs = 250_000;
  let pairs = 0;
  for (let left = 0; left < elements.length; left += 1) for (let right = left + 1; right < elements.length; right += 1) {
    if (++pairs > maximumPairs) return clashes;
    const a = elements[left]; const b = elements[right];
    if (a.expressId === b.expressId || (a.storey && b.storey && a.storey !== b.storey)) continue;
    const overlap = intersectionBounds(a.bounds, b.bounds);
    const duplicate = a.ifcType === b.ifcType && a.fingerprint === b.fingerprint;
    const hardIntersection = Boolean(overlap && geometryIntersects(a, b));
    const withinClearance = !hardIntersection && clearanceM > 0 && boundsIntersect(a.bounds, b.bounds, clearanceM);
    if (!hardIntersection && !duplicate && !withinClearance) continue;
    const bounds = overlap ?? mergeBounds([a.bounds, b.bounds]);
    clashes.push({ type: duplicate ? "DUPLICATE" : hardIntersection ? "HARD" : "CLEARANCE", a: a.expressId, b: b.expressId, coordinate: [0, 1, 2].map((axis) => rounded((bounds.min[axis] + bounds.max[axis]) / 2)) as [number, number, number], severity: hardIntersection ? "HIGH" : "MEDIUM", confidence: duplicate ? "HIGH" : "MEDIUM" });
  }
  return clashes;
}

export function compareBimElements(previous: BimElementGeometry[], current: BimElementGeometry[]) {
  const before = new Map(previous.map((item) => [item.ifcGuid || `EXPRESS:${item.expressId}`, item]));
  const after = new Map(current.map((item) => [item.ifcGuid || `EXPRESS:${item.expressId}`, item]));
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].map((key) => {
    const from = before.get(key); const to = after.get(key);
    const kind = !from ? "ADDED" : !to ? "REMOVED" : from.fingerprint === to.fingerprint ? "UNCHANGED" : "MODIFIED";
    return { key, kind, fromExpressId: from?.expressId ?? null, toExpressId: to?.expressId ?? null, ifcType: to?.ifcType ?? from?.ifcType ?? "UNKNOWN", confidence: key.startsWith("EXPRESS:") ? "MEDIUM" : "HIGH" };
  });
}
