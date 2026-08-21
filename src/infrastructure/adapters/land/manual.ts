import type { MunicipalityAdapter, ParcelLookupInput } from "./contracts";

export class ManualMunicipalityAdapter implements MunicipalityAdapter {
  readonly municipalityCode = "MANUAL";
  constructor(readonly municipalityName: string) {}
  async identifyParcel(input: ParcelLookupInput) { void input; return { status: "MANUAL_REQUIRED" as const, data: null, sourceIds: ["MANUAL"], warnings: ["Desenhe ou importe o lote em GeoJSON."] }; }
  async getZoning(input: ParcelLookupInput & { confirmedZoningCode?: string }) { void input; return { status: "MANUAL_REQUIRED" as const, data: null, sourceIds: ["MANUAL"], warnings: ["Informe o zoneamento e anexe a fonte."] }; }
  async getUrbanParameters(zoningCode: string) { void zoningCode; return { status: "MANUAL_REQUIRED" as const, data: null, sourceIds: ["MANUAL"], warnings: ["Preencha parâmetros, unidades, fonte e confiança."] }; }
  async getRestrictions(input: ParcelLookupInput) { void input; return { status: "MANUAL_REQUIRED" as const, data: [], sourceIds: ["MANUAL"], warnings: ["Informe somente restrições sustentadas por evidência."] }; }
  async getSourceMetadata() { return []; }
  async getMunicipalProperty(input: ParcelLookupInput & { fiscalYear: number }) { void input; return { status: "MANUAL_REQUIRED" as const, data: null, sourceIds: ["MANUAL"], warnings: ["Informe IPTU, cadastro municipal, exercício e evidência da consulta."] }; }
}
