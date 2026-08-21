import type { LandAsset, UrbanParameters, UrbanRestriction, UrbanSource } from "@/domain/land";

export interface ParcelLookupInput {
  address?: string;
  latitude?: number;
  longitude?: number;
  cadastralIdentifier?: string;
}

export interface MunicipalPropertyData {
  municipalRegistration: string;
  fiscalYear: number;
  assessedValue?: number;
  propertyTaxAmount?: number;
  debtStatus: "CLEAR" | "HAS_DEBT" | "NOT_VERIFIED";
  debtAmount?: number;
  sourceRef: string;
}

export interface AdapterResult<T> {
  status: "FOUND" | "PARTIAL" | "MANUAL_REQUIRED" | "UNAVAILABLE";
  data: T | null;
  sourceIds: string[];
  warnings: string[];
}

export interface MunicipalityAdapter {
  readonly municipalityCode: string;
  readonly municipalityName: string;
  identifyParcel(input: ParcelLookupInput): Promise<AdapterResult<Partial<LandAsset>>>;
  getZoning(input: ParcelLookupInput & { confirmedZoningCode?: string }): Promise<AdapterResult<{ zoningCode: string; zoningName: string }>>;
  getUrbanParameters(zoningCode: string): Promise<AdapterResult<UrbanParameters>>;
  getRestrictions(input: ParcelLookupInput): Promise<AdapterResult<UrbanRestriction[]>>;
  getSourceMetadata(): Promise<UrbanSource[]>;
  getMunicipalProperty(input: ParcelLookupInput & { fiscalYear: number }): Promise<AdapterResult<MunicipalPropertyData>>;
}

export interface GeocoderProvider {
  geocode(address: string): Promise<AdapterResult<{ latitude: number; longitude: number }>>;
}

export interface ParcelProvider {
  identifyParcel(input: ParcelLookupInput): Promise<AdapterResult<Partial<LandAsset>>>;
}

export interface UrbanDataProvider {
  getUrbanParameters(zoningCode: string): Promise<AdapterResult<UrbanParameters>>;
}

export interface MapProvider {
  getMapStyle(): Promise<AdapterResult<{ styleUrl: string }>>;
}

export interface TerrainProvider {
  getElevation(polygon: LandAsset["polygon"]): Promise<AdapterResult<{ minimum: number; maximum: number; average: number }>>;
}
