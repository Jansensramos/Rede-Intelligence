import type { Point2D, PolygonGeometry } from "./types";

const EPSILON = 1e-8;

export function normalizedPoints(polygon: PolygonGeometry): Point2D[] {
  const points = polygon.coordinates.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
  if (points.length > 1) {
    const first = points[0];
    const last = points.at(-1)!;
    if (Math.abs(first.x - last.x) < EPSILON && Math.abs(first.y - last.y) < EPSILON) points.pop();
  }
  return points;
}

export function signedPolygonArea(polygon: PolygonGeometry): number {
  const points = normalizedPoints(polygon);
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

export function polygonArea(polygon: PolygonGeometry): number {
  return Math.abs(signedPolygonArea(polygon));
}

export function polygonCentroid(polygon: PolygonGeometry): Point2D {
  const points = normalizedPoints(polygon);
  const signedArea = signedPolygonArea(polygon);
  if (Math.abs(signedArea) < EPSILON) {
    return points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 });
  }
  let x = 0;
  let y = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const cross = point.x * next.y - next.x * point.y;
    x += (point.x + next.x) * cross;
    y += (point.y + next.y) * cross;
  });
  return { x: x / (6 * signedArea), y: y / (6 * signedArea) };
}

function orientation(a: Point2D, b: Point2D, c: Point2D) {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function onSegment(a: Point2D, b: Point2D, c: Point2D) {
  return b.x <= Math.max(a.x, c.x) + EPSILON && b.x + EPSILON >= Math.min(a.x, c.x) && b.y <= Math.max(a.y, c.y) + EPSILON && b.y + EPSILON >= Math.min(a.y, c.y);
}

function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON)) && ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))) return true;
  if (Math.abs(o1) <= EPSILON && onSegment(a, c, b)) return true;
  if (Math.abs(o2) <= EPSILON && onSegment(a, d, b)) return true;
  if (Math.abs(o3) <= EPSILON && onSegment(c, a, d)) return true;
  if (Math.abs(o4) <= EPSILON && onSegment(c, b, d)) return true;
  return false;
}

export function validatePolygon(polygon: PolygonGeometry): { valid: boolean; errors: string[] } {
  const points = normalizedPoints(polygon);
  const errors: string[] = [];
  if (polygon.type !== "Polygon") errors.push("A geometria deve ser Polygon.");
  if (points.length < 3) errors.push("O polígono precisa de pelo menos três vértices.");
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) errors.push("O polígono contém coordenadas inválidas.");
  if (new Set(points.map((point) => `${point.x}:${point.y}`)).size < 3) errors.push("O polígono precisa de três vértices distintos.");
  if (points.length >= 3 && polygonArea(polygon) < EPSILON) errors.push("O polígono possui área nula.");
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j += 1) {
      if (j === i || (j + 1) % points.length === i || (i + 1) % points.length === j) continue;
      const c = points[j];
      const d = points[(j + 1) % points.length];
      if (segmentsIntersect(a, b, c, d)) errors.push("O polígono possui auto-interseção.");
    }
  }
  return { valid: errors.length === 0, errors: Array.from(new Set(errors)) };
}

interface OffsetLine { point: Point2D; direction: Point2D }

function lineIntersection(a: OffsetLine, b: OffsetLine): Point2D | null {
  const cross = a.direction.x * b.direction.y - a.direction.y * b.direction.x;
  if (Math.abs(cross) < EPSILON) return null;
  const delta = { x: b.point.x - a.point.x, y: b.point.y - a.point.y };
  const t = (delta.x * b.direction.y - delta.y * b.direction.x) / cross;
  return { x: a.point.x + t * a.direction.x, y: a.point.y + t * a.direction.y };
}

export function insetPolygon(polygon: PolygonGeometry, edgeOffsets: number[]): PolygonGeometry {
  const validation = validatePolygon(polygon);
  if (!validation.valid) throw new Error(validation.errors[0]);
  const original = normalizedPoints(polygon);
  const points = signedPolygonArea(polygon) > 0 ? original : [...original].reverse();
  const lines = points.map((point, index): OffsetLine => {
    const next = points[(index + 1) % points.length];
    const direction = { x: next.x - point.x, y: next.y - point.y };
    const length = Math.hypot(direction.x, direction.y);
    const inward = { x: -direction.y / length, y: direction.x / length };
    const distance = Math.max(0, edgeOffsets[index] ?? edgeOffsets.at(-1) ?? 0);
    return { point: { x: point.x + inward.x * distance, y: point.y + inward.y * distance }, direction };
  });
  const inset = lines.map((line, index) => lineIntersection(lines[(index - 1 + lines.length) % lines.length], line)).filter((point): point is Point2D => point !== null);
  const result: PolygonGeometry = { type: "Polygon", coordinates: inset };
  if (!validatePolygon(result).valid || polygonArea(result) >= polygonArea(polygon)) throw new Error("Os recuos eliminam ou invalidam a área edificável.");
  return result;
}

export function scalePolygonToArea(polygon: PolygonGeometry, targetArea: number): PolygonGeometry {
  const current = polygonArea(polygon);
  if (targetArea >= current || current <= EPSILON) return polygon;
  const center = polygonCentroid(polygon);
  const scale = Math.sqrt(Math.max(0, targetArea) / current);
  return { type: "Polygon", coordinates: normalizedPoints(polygon).map((point) => ({ x: center.x + (point.x - center.x) * scale, y: center.y + (point.y - center.y) * scale })) };
}

export function polygonBounds(polygon: PolygonGeometry) {
  const points = normalizedPoints(polygon);
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

export function polygonToGeoJSON(polygon: PolygonGeometry) {
  const points = normalizedPoints(polygon);
  const ring = [...points, points[0]].map((point) => [point.x, point.y]);
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } } as const;
}

export function polygonFromGeoJSON(input: unknown): PolygonGeometry {
  if (!input || typeof input !== "object") throw new Error("GeoJSON inválido.");
  const value = input as { type?: string; geometry?: { type?: string; coordinates?: unknown }; coordinates?: unknown };
  const geometry = value.type === "Feature" ? value.geometry : value;
  if (geometry?.type !== "Polygon" || !Array.isArray(geometry.coordinates)) throw new Error("Apenas GeoJSON Polygon é suportado nesta fase.");
  const ring = geometry.coordinates[0];
  if (!Array.isArray(ring)) throw new Error("Anel GeoJSON ausente.");
  const polygon: PolygonGeometry = { type: "Polygon", coordinates: ring.map((coordinate) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) throw new Error("Coordenada GeoJSON inválida.");
    return { x: Number(coordinate[0]), y: Number(coordinate[1]) };
  }) };
  const validation = validatePolygon(polygon);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  return { type: "Polygon", coordinates: normalizedPoints(polygon) };
}
