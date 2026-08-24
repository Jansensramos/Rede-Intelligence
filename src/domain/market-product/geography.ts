import type { GeoPoint } from "./types";

const EARTH_RADIUS_METERS = 6_371_000;
const METERS_PER_DEGREE_LATITUDE = 111_320;

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

// Fórmula de Haversine determinística (plano 9J, seção F.1) — distância geodésica em metros
// entre dois pontos WGS84. Sem dependência de PostGIS: refino em memória após bounding box.
export function haversineDistanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const centralAngle = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  return EARTH_RADIUS_METERS * centralAngle;
}

export function isWithinRadius(center: GeoPoint, point: GeoPoint, radiusMeters: number): boolean {
  return haversineDistanceMeters(center, point) <= radiusMeters;
}

export interface BoundingBox {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

// Caixa delimitadora indexável por B-Tree para filtragem preliminar (plano 9J, seção F.1);
// o refino exato por raio sempre usa haversineDistanceMeters em seguida.
export function boundingBoxDegrees(center: GeoPoint, radiusMeters: number): BoundingBox {
  const latDelta = radiusMeters / METERS_PER_DEGREE_LATITUDE;
  const metersPerDegreeLongitude = METERS_PER_DEGREE_LATITUDE * Math.cos(toRadians(center.latitude));
  const lonDelta = radiusMeters / (metersPerDegreeLongitude === 0 ? METERS_PER_DEGREE_LATITUDE : metersPerDegreeLongitude);
  return {
    minLatitude: center.latitude - latDelta,
    maxLatitude: center.latitude + latDelta,
    minLongitude: center.longitude - lonDelta,
    maxLongitude: center.longitude + lonDelta,
  };
}
